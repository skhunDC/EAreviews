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
const REVIEW_FOLDER_NAME = 'EAReviewData';
const CALENDAR_ID = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');

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

/** PBKDF2-SHA256 implementation */
function pbkdf2_(pwd, salt, iter){
  const keyBytes = Utilities.newBlob(pwd).getBytes();
  const saltBytes = Utilities.newBlob(salt + '\u0000\u0000\u0000\u0001').getBytes();
  let u = Utilities.computeHmacSha256Signature(saltBytes, keyBytes);
  let out = u.slice();
  for(let i=1;i<iter;i++){
    u = Utilities.computeHmacSha256Signature(u, keyBytes);
    for(let j=0;j<out.length;j++) out[j] ^= u[j];
  }
  return out.map(b=>("0"+ (b & 0xff).toString(16)).slice(-2)).join('');
}

/** Create salted password hash using PBKDF2-SHA256 */
function createHash(pwd) {
  const salt = Utilities.getUuid().replace(/-/g,'');
  const hashHex = pbkdf2_(pwd, salt, 1000);
  return {saltHex: salt, hashHex: hashHex};
}

/** Verify password against stored salt/hash using PBKDF2 */
function verifyPwd(pwd, salt, hash){
  return pbkdf2_(pwd, salt, 1000) === hash;
}

/** Create session token and store */
function createSession(uid) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put('sid_'+token, uid, SESSION_DURATION);
  PropertiesService.getScriptProperties().setProperty('sid_'+token, uid);
  return token;
}

/** Serve the web app or JSON endpoints */
function doGet(e) {
  const path = (e && e.pathInfo) || '';
  if (path === 'events') {
    return jsonResponse_(getEvents_(e));
  } else if (path === 'me') {
    return jsonResponse_(getCurrentUser_());
  }
  return HtmlService.createHtmlOutputFromFile('index');
}

/** Handle POST requests */
function doPost(e) {
  const path = (e && e.pathInfo) || '';
  if (path === 'book') {
    return jsonResponse_(bookSlot_(e));
  }
  return jsonResponse_({error:'not_found'});
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

/**
 * Get current session user. This simply returns any cached session.
 * If no session data exists, null is returned.
 */
function getSession() {
  const cache = CacheService.getUserCache();
  const data = cache.get(CACHE_KEY);
  if (data) return JSON.parse(data);
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
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const cfg = {};
  rows.forEach((r,i) => {
    if(i === 0) return; // skip header row
    if(!r[0]) return;
    cfg[r[0]] = {en:r[1], es:r[2]};
  });
  return cfg;
}

/** List reviews for session user */
function listReviews() {
  const user = getSession();
  if (!user) throw new Error('not auth');
  const all = loadAllReviews();
  const res = [];
  const reports = user.role === 'MANAGER' ? getDirectReports(user.id) : {};
  all.forEach(r => {
    if (
      user.role === 'HR' ||
      user.role === 'DEV' ||
      r.employeeId == user.id ||
      (user.role === 'MANAGER' && Object.prototype.hasOwnProperty.call(reports, r.employeeId))
    ) {
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
  if(!review.id){
    review.id = new Date().getTime();
  }
  review.ts = new Date();
  const content = JSON.stringify(review);
  if(file){
    file.setContent(content);
  } else {
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
  const h = createHash(user.password || DEV_PASSWORD);
  sheet.appendRow([id, user.userId, user.name, user.role, user.managerId||'', user.lang||'en', h.hashHex, h.saltHex, new Date()]);
}

/** Check if the current session belongs to a DEV role */
function isAuthorizedDev() {
  const session = getSession();
  return session && session.role === 'DEV';
}

/** OAuth check specifically for Dev link */
function authorizeDev(){
  const email = Session.getActiveUser().getEmail();
  if(email === 'skhun@dublincleaners.com' || email === 'ss.sku@protonmail.com'){
    const dev = {id:email, userId:email, name:email, role:'DEV', lang:'en'};
    CacheService.getUserCache().put(CACHE_KEY, JSON.stringify(dev), SESSION_DURATION);
    return {authorized:true, email:email};
  }
  return {authorized:false};
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
  const dev = getSession();
  logDevAction(dev ? dev.userId : 'unknown', 'add user', user.userId);
  return {id:id};
}

/** Return all users for developer console */
function getAllUsers(){
  if(!isAuthorizedDev()) throw new Error('denied');
  const sheet = SpreadsheetApp.openById(ADMIN_SHEET_ID).getSheetByName(USERS_SHEET);
  if(!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const dev = getSession();
  logDevAction(dev ? dev.userId : 'unknown', 'view users', '');
  return rows.slice(1).map(r=>({userId:r[1],role:r[3]}));
}

/** Delete all review files (DEV only) */
function deleteAllReviews(){
  if(!isAuthorizedDev()) throw new Error('denied');
  const folder = getReviewFolder();
  const files = folder.getFiles();
  while(files.hasNext()){
    files.next().setTrashed(true);
  }
  const dev = getSession();
  logDevAction(dev ? dev.userId : 'unknown','delete all reviews','');
  return true;
}

/** Update a user's ID */
function updateUserID(oldID, newID){
  if(!isAuthorizedDev()) throw new Error('denied');
  const sheet = SpreadsheetApp.openById(ADMIN_SHEET_ID).getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][1]==oldID){
      sheet.getRange(i+1,2).setValue(newID);
      const dev = getSession();
      logDevAction(dev ? dev.userId : 'unknown','change id',newID);
      return true;
    }
  }
  throw new Error('user_not_found');
}

/** Update a user's role */
function updateUserRole(userID, role){
  if(!isAuthorizedDev()) throw new Error('denied');
  const sheet = SpreadsheetApp.openById(ADMIN_SHEET_ID).getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][1]==userID){
      sheet.getRange(i+1,4).setValue(role);
      const dev = getSession();
      logDevAction(dev ? dev.userId : 'unknown','change role to '+role,userID);
      return true;
    }
  }
  throw new Error('user_not_found');
}

/** Reset a user's password */
function updateUserPassword(userID, newPwd){
  if(!isAuthorizedDev()) throw new Error('denied');
  const sheet = SpreadsheetApp.openById(ADMIN_SHEET_ID).getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][1]==userID){
      const h=createHash(newPwd);
      sheet.getRange(i+1,7).setValue(h.hashHex);
      sheet.getRange(i+1,8).setValue(h.saltHex);
      const dev = getSession();
      logDevAction(dev ? dev.userId : 'unknown','reset password',userID);
      return true;
    }
  }
  throw new Error('user_not_found');
}


/** Log developer actions */
function logDevAction(devEmail, action, userId){
  const ss = SpreadsheetApp.openById(ADMIN_SHEET_ID);
  let sheet = ss.getSheetByName('LOGS');
  if(!sheet){
    sheet = ss.insertSheet('LOGS');
    sheet.appendRow(['Timestamp','Developer','Action','UserID']);
  }
  sheet.appendRow([new Date(), devEmail, action, userId]);
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
  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 4).clearContent();
  }
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

/** Save review and optional compensation adjustment in one call */
function saveFullReview(review, compAdj){
  const saved = saveReview(review);
  if(compAdj){
    saveCompAdjustment(saved.id, compAdj);
  }
  return saved;
}

/** --- Scheduling Helpers & API Endpoints -------------------------------- */

/** Return a JSON text output */
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Verify current session and return user object */
function checkAuth_() {
  const user = getSession();
  if (!user) throw new Error('Unauthorized');
  return user;
}

/** Get calendar ID from script properties */
function getCalendar_() {
  if (!CALENDAR_ID) throw new Error('Missing CALENDAR_ID');
  return CALENDAR_ID;
}

/** Convert Date to ISO string */
function toIso_(d) {
  return Utilities.formatDate(new Date(d), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/** Parse JSON body */
function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch(err) {}
  }
  return {};
}

/** Return current user */
function getCurrentUser_() {
  return checkAuth_();
}

/** List booked events */
function getEvents_(e) {
  const user = checkAuth_();
  const calId = getCalendar_();
  const timeMin = e.parameter && e.parameter.timeMin ? e.parameter.timeMin : toIso_(new Date());
  const timeMax = e.parameter && e.parameter.timeMax ? e.parameter.timeMax : toIso_(new Date(new Date().getTime() + 14*24*60*60*1000));
  const resp = Calendar.Events.list(calId,{timeMin:timeMin,timeMax:timeMax,singleEvents:true});
  const events = [];
  if (resp.items) {
    resp.items.forEach(ev=>{
      let desc={};
      try{ if(ev.description) desc=JSON.parse(ev.description);}catch(e){}
      events.push({
        id: ev.id,
        title: ev.summary,
        start: ev.start.dateTime || ev.start.date,
        end: ev.end.dateTime || ev.end.date,
        editable: desc.uid == user.id
      });
    });
  }
  return events;
}

/** Book a new slot */
function bookSlot_(e) {
  const body = parseBody_(e);
  if (!body.start || !body.end) throw new Error('invalid');
  const user = checkAuth_();
  const calId = getCalendar_();
  const existing = Calendar.Events.list(calId, {timeMin: body.start, timeMax: body.end, singleEvents:true});
  if (existing.items && existing.items.length) {
    return {status:409};
  }
  const event = {
    summary: 'Review – ' + user.name,
    description: JSON.stringify({uid:user.id,lang:user.lang,createdAt:toIso_(new Date())}),
    start: {dateTime: body.start},
    end: {dateTime: body.end},
    attendees: [{email:user.userId}]
  };
  const created = Calendar.Events.insert(event, calId);
  return {
    status:201,
    id: created.id,
    title: created.summary,
    start: created.start.dateTime,
    end: created.end.dateTime,
    editable: true
  };
}
