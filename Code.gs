// Code.gs - server-side logic for Employee Review Web App

const USERS_SHEET = 'USERS';
const REVIEWS_SHEET = 'REVIEWS';
const MEETINGS_SHEET = 'MEETINGS';
const CONFIG_SHEET = 'CONFIG';
const QUESTIONS_SHEET = 'QUESTIONS';
const COMP_SHEET = 'COMP_ADJUST';
const CACHE_KEY = 'SESSION';
const SESSION_DURATION = 60 * 60 * 8; // 8 hours
const DEV_PASSWORD = 'changeme'; // replace in prod
const ADMIN_SHEET_ID = '17lpaLBAL9XidYqiMhKNWRhZdEIqa0OzuVP7SYYc6VfQ';
const DEV_USERS = ['skhun@dublincleaners.com','ss.sku@protonmail.com'];
const REVIEW_FOLDER_NAME = 'EAReviewData';

/** Return the spreadsheet used by the app */
function getSpreadsheet(){
  const ss = SpreadsheetApp.getActive();
  if (ss) return ss;
  return SpreadsheetApp.openById(ADMIN_SHEET_ID);
}

/** Retrieve or create the Drive folder that stores review data */
function getReviewFolder(){
  const folders = DriveApp.getFoldersByName(REVIEW_FOLDER_NAME);
  if(folders.hasNext()) return folders.next();
  return DriveApp.createFolder(REVIEW_FOLDER_NAME);
}

/** Load all review objects from Drive */
function loadAllReviews(){
  const folder = getReviewFolder();
  const files = folder.getFiles();
  const list = [];
  while(files.hasNext()){
    const f = files.next();
    try{
      const obj = JSON.parse(f.getBlob().getDataAsString());
      list.push(obj);
    }catch(e){
      // ignore malformed file
    }
  }
  return list;
}

/** Create salted password hash */
function createHash(pwd) {
  const salt = Utilities.getUuid();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pwd, Utilities.Charset.UTF_8);
  const hashHex = digest.map(b=>('0'+(b&0xff).toString(16)).slice(-2)).join('');
  return {saltHex:salt, hashHex:hashHex};
}

/** Verify password against stored salt/hash */
function verifyPwd(pwd, salt, hash) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pwd, Utilities.Charset.UTF_8);
  const hex = digest.map(b=>('0'+(b&0xff).toString(16)).slice(-2)).join('');
  return hex === hash;
}

/** Create session token and store */
function createSession(uid) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put('sid_'+token, uid, SESSION_DURATION);
  PropertiesService.getScriptProperties().setProperty('sid_'+token, uid);
  return token;
}

/** Serve the web app */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index');
}

/** Authenticate user by user ID */
function login(userId, pwd) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(USERS_SHEET);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [id, uid, name, role, managerId, lang, hash, salt] = rows[i];
    if (uid === userId) {
      if (verifyPwd(pwd, salt, hash)) {
        const cache = CacheService.getUserCache();
        cache.put(CACHE_KEY, JSON.stringify({id:id, userId:uid, name:name, role:role, managerId:managerId, lang:lang}), SESSION_DURATION);
        const token = createSession(id);
        return {success:true, token:token, user:{id:id,userId:uid,name:name,role:role,lang:lang}};
      } else {
        return {success:false, error:'invalid_password'};
      }
    }
  }
  return {success:false, error:'user_not_found'};
}

/** Logout */
function logout() {
  CacheService.getUserCache().remove(CACHE_KEY);
}

/** Get current session user */
function getSession() {
  const cache = CacheService.getUserCache();
  const data = cache.get(CACHE_KEY);
  if (data) return JSON.parse(data);
  const email = Session.getActiveUser().getEmail();
  if (email) {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(USERS_SHEET);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const [id, uid, name, role, managerId, lang] = rows[i];
      if (uid === email) {
        const user = {id:id,userId:uid,name:name,role:role,managerId:managerId,lang:lang};
        cache.put(CACHE_KEY, JSON.stringify(user), SESSION_DURATION);
        return user;
      }
    }
  }
  return null;
}

/** Save language preference */
function saveLang(lang) {
  const user = getSession();
  if (!user) return;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(USERS_SHEET);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == user.id) {
      sheet.getRange(i+1, 6).setValue(lang);
      user.lang = lang;
      CacheService.getUserCache().put(CACHE_KEY, JSON.stringify(user), SESSION_DURATION);
      return;
    }
  }
}

/** Load config translations */
function loadConfig() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_SHEET);
  const rows = sheet.getDataRange().getValues();
  const cfg = {};
  rows.forEach(r => { cfg[r[0]] = {en:r[1], es:r[2]}; });
  return cfg;
}

/** List reviews for session user */
function listReviews() {
  const user = getSession();
  if (!user) throw new Error('not auth');
  const all = loadAllReviews();
  const res = [];
  all.forEach(r => {
    if (user.role === 'HR' || user.role === 'DEV' || r.employeeId == user.id || (user.role === 'MANAGER' && r.employeeId in getDirectReports(user.id))) {
      res.push(r);
    }
  });
  return res;
}

/** Get a specific year's self review for the session user */
function getReviewByYear(year){
  const user = getSession();
  if(!user) throw new Error('not auth');
  const all = loadAllReviews();
  for(let i=0;i<all.length;i++){
    const r = all[i];
    if(r.employeeId == user.id && r.type === 'SELF' && Number(r.data.year) === Number(year)){
      return r;
    }
  }
  return null;
}

/** Helper to get direct reports */
function getDirectReports(managerId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(USERS_SHEET);
  const rows = sheet.getDataRange().getValues();
  const map = {};
  rows.forEach((r,i)=>{ if (i>0 && r[4]==managerId) map[r[0]] = true; });
  return map;
}

/** Save or update review */
function saveReview(review) {
  const user = getSession();
  if (!user) throw new Error('not auth');
  const folder = getReviewFolder();
  let file = null;
  if(review.id){
    const files = folder.getFilesByName(review.id + '.json');
    if(files.hasNext()) file = files.next();
  } else {
    const files = folder.getFiles();
    while(files.hasNext()){
      const f = files.next();
      try{
        const data = JSON.parse(f.getBlob().getDataAsString());
        if(data.employeeId == review.employeeId && data.type == review.type && data.data.year == review.data.year){
          file = f;
          review.id = data.id;
          break;
        }
      }catch(e){}
    }
  }
  review.ts = new Date();
  const content = JSON.stringify(review);
  if(file){
    file.setContent(content);
  } else {
    review.id = review.id || new Date().getTime();
    folder.createFile(review.id + '.json', content, 'application/json');
  }
  return review;
}

/** Schedule meeting */
function scheduleMeeting(mtg) {
  const user = getSession();
  if (!user) throw new Error('not auth');
  const start = new Date(mtg.start);
  const end = new Date(mtg.end);
  if ((end - start) != 30*60*1000) throw new Error('Slot must be 30m');
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(MEETINGS_SHEET);
  const rows = sheet.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    const existingStart = new Date(rows[i][3]);
    const existingEnd = new Date(rows[i][4]);
    if ((start < existingEnd) && (end > existingStart)) {
      throw new Error('Time conflict');
    }
  }
  const midday = new Date(start);
  if (midday.getHours()==12 || (midday.getHours()==13 && midday.getMinutes()<30)) {
    throw new Error('Blocked time');
  }
  const id = new Date().getTime();
  sheet.appendRow([id, mtg.employeeId, mtg.managerId, start, end, mtg.location, mtg.notes]);
  CalendarApp.createEvent('Review Meeting', start, end, {guests: mtg.employeeEmail+','+mtg.managerEmail, location: mtg.location});
  return id;
}

/** Get dashboard data */
function getDashboard() {
  const user = getSession();
  if (!user || (user.role !== 'HR' && user.role !== 'DEV')) throw new Error('denied');
  const reviews = loadAllReviews();
  let completed = 0; let total = reviews.length;
  const scores = {};
  reviews.forEach(r=>{
    const data = r.data || {};
    if (r.status === 'FINAL') completed++;
    Object.keys(data).forEach(k=>{
      scores[k]=scores[k]||[];
      scores[k].push(+data[k].score||0);
    });
  });
  const avgScores = {};
  Object.keys(scores).forEach(k=>{
    const arr=scores[k]; avgScores[k]=arr.reduce((a,b)=>a+b,0)/arr.length;
  });
  return {completion: total ? completed/total : 0, avgScores: avgScores};
}

/** Export reviews CSV */
function exportCSV() {
  const reviews = loadAllReviews();
  const header = ['ID','EMPLOYEE_ID','TYPE','DATA','STATUS','TIMESTAMP'];
  const rows = reviews.map(r=>[r.id,r.employeeId,r.type,JSON.stringify(r.data),r.status,r.ts]);
  const csvRows = [header.join(',')];
  rows.forEach(r=>{ csvRows.push(r.join(',')); });
  return csvRows.join('\n');
}

/** Simple admin to add user (DEV only) */
function addUser(user) {
  const session = getSession();
  if (!session || session.role !== 'DEV') throw new Error('denied');
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(USERS_SHEET);
  const id = new Date().getTime();
  sheet.appendRow([id, user.userId, user.name, user.role, user.managerId||'', user.lang||'en']);
}

/** Check if session user is in DEV_USERS */
function isAuthorizedDev() {
  const email = Session.getActiveUser().getEmail();
  return DEV_USERS.indexOf(email) !== -1;
}

/** Admin panel API to add simple user entry */
function addNewUser(user) {
  if (!isAuthorizedDev()) throw new Error('denied');
  if (!user.userId || !user.password || !user.role) {
    throw new Error('missing required fields');
  }
  const ss = SpreadsheetApp.openById(ADMIN_SHEET_ID);
  let sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET);
    sheet.appendRow(['ID','EMAIL','NAME','ROLE','MANAGER_ID','LANG','HASH','SALT','CREATED']);
  }
  const id = new Date().getTime();
  const h = createHash(user.password);
  sheet.appendRow([id, user.userId, user.name || '', user.role, user.managerId || '', user.lang || 'en', h.hashHex, h.saltHex, new Date()]);
  return {id:id};
}

/** Trigger daily to send reminders */
function dailyNotifications() {
  const ss = getSpreadsheet();
  const usersSheet = ss.getSheetByName(USERS_SHEET);
  const users = usersSheet.getDataRange().getValues();
  const userMap = {};
  users.forEach((r,i)=>{ if(i>0) userMap[r[0]]=r; });

  const reviews = loadAllReviews();
  const now = new Date();
  reviews.forEach(r=>{
    const user = userMap[r.employeeId];
    if(!user) return;
    if(r.type==='SELF' && r.status!=='FINAL'){
      const openDate = new Date(r.ts);
      if((now-openDate)/(1000*60*60*24) > 7){
        GmailApp.sendEmail(user[1], 'Reminder to submit self-review', 'Please submit your self-review.');
      }
    }
  });
}

/** Retrieve review questions */
function getQuestions() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(QUESTIONS_SHEET);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const list = [];
  rows.forEach((r,i)=>{ if(i>0) list.push({id:r[0], en:r[1], es:r[2], extra:r[3]}); });
  return list;
}

/** Overwrite questions list (DEV only) */
function saveQuestions(list) {
  const user = getSession();
  if (!user || user.role !== 'DEV') throw new Error('denied');
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(QUESTIONS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(QUESTIONS_SHEET);
    sheet.appendRow(['ID','EN','ES','EXTRA']);
  }
  sheet.getRange(2,1,sheet.getLastRow(),4).clearContent();
  list.forEach((q,i)=>{
    sheet.getRange(i+2,1,1,4).setValues([[q.id||('q'+(i+1)), q.en, q.es, q.extra||'']]);
  });
  return true;
}

/** Save compensation adjustment for a review */
function saveCompAdjustment(reviewId, adj) {
  const user = getSession();
  if (!user || (['MANAGER','HR','DEV'].indexOf(user.role)===-1)) throw new Error('denied');
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(COMP_SHEET);
  if(!sheet){
    sheet = ss.insertSheet(COMP_SHEET);
    sheet.appendRow(['ReviewID','EmployeeID','Current','New','Pct','ManagerID','Timestamp']);
  }
  sheet.appendRow([reviewId, adj.employeeId, adj.current, adj.new, adj.pct, user.id, new Date()]);
  return true;
}

/** Save final expectation for a review */
function saveFinalExpectation(reviewId, exp) {
  const user = getSession();
  if (!user) throw new Error('not auth');
  const folder = getReviewFolder();
  const files = folder.getFilesByName(reviewId + '.json');
  if(!files.hasNext()) throw new Error('review not found');
  const file = files.next();
  let data;
  try{
    data = JSON.parse(file.getBlob().getDataAsString());
  }catch(e){
    data = {id:reviewId};
  }
  data.data = data.data || {};
  data.data.finalExpectation = exp;
  data.ts = new Date();
  file.setContent(JSON.stringify(data));
  return true;
}
