// Code.gs - server-side logic for Employee Review Web App

const USERS_SHEET = 'USERS';
const REVIEWS_SHEET = 'REVIEWS';
const MEETINGS_SHEET = 'MEETINGS';
const CONFIG_SHEET = 'CONFIG';
const CACHE_KEY = 'SESSION';
const SESSION_DURATION = 60 * 60 * 8; // 8 hours
const DEV_PASSWORD = 'changeme'; // replace in prod

/** Serve the web app */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index');
}

/** Authenticate user with email/password */
function login(email, password) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(USERS_SHEET);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [id, em, name, role, managerId, lang, salt, hash] = rows[i];
    if (em === email) {
      const sha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password);
      const hashStr = sha.map(function(b){return ('0' + (b & 0xFF).toString(16)).slice(-2);}).join('');
      if (hashStr === hash) {
        const cache = CacheService.getUserCache();
        cache.put(CACHE_KEY, JSON.stringify({id:id, email:em, name:name, role:role, managerId:managerId, lang:lang}), SESSION_DURATION);
        return {success:true, user:{id:id,name:name,role:role,lang:lang}};
      }
    }
  }
  return {success:false};
}

/** Logout */
function logout() {
  CacheService.getUserCache().remove(CACHE_KEY);
}

/** Get current session user */
function getSession() {
  const data = CacheService.getUserCache().get(CACHE_KEY);
  if (data) return JSON.parse(data);
  return null;
}

/** Save language preference */
function saveLang(lang) {
  const user = getSession();
  if (!user) return;
  const ss = SpreadsheetApp.getActive();
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
  const ss = SpreadsheetApp.getActive();
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
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(REVIEWS_SHEET);
  const rows = sheet.getDataRange().getValues();
  const res = [];
  rows.forEach((r,i)=>{
    if (i===0) return;
    const [id, employeeId, type, data, status, ts] = r;
    if (user.role === 'HR' || user.role === 'DEV' || employeeId == user.id || (user.role === 'MANAGER' && employeeId in getDirectReports(user.id))) {
      res.push({id:id, employeeId:employeeId, type:type, data:JSON.parse(data||'{}'), status:status, ts:ts});
    }
  });
  return res;
}

/** Helper to get direct reports */
function getDirectReports(managerId) {
  const ss = SpreadsheetApp.getActive();
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
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(REVIEWS_SHEET);
  const rows = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i=1;i<rows.length;i++) {
    if (rows[i][0]==review.id) { rowIndex=i; break; }
  }
  const dataStr = JSON.stringify(review.data);
  if (rowIndex>0) {
    sheet.getRange(rowIndex+1,3,1,3).setValues([[review.type,dataStr,review.status]]);
    sheet.getRange(rowIndex+1,6).setValue(new Date());
  } else {
    const id = new Date().getTime();
    sheet.appendRow([id, review.employeeId, review.type, dataStr, review.status, new Date()]);
    review.id = id;
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
  const ss = SpreadsheetApp.getActive();
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
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(REVIEWS_SHEET);
  const rows = sheet.getDataRange().getValues();
  let completed = 0; let total = 0;
  const scores = {};
  rows.forEach((r,i)=>{
    if (i===0) return;
    const data = JSON.parse(r[3]||'{}');
    if (r[4]==='FINAL') completed++;
    total++;
    Object.keys(data).forEach(k=>{
      scores[k]=scores[k]||[]; scores[k].push(+data[k].score||0);
    });
  });
  const avgScores = {};
  Object.keys(scores).forEach(k=>{
    const arr=scores[k]; avgScores[k]=arr.reduce((a,b)=>a+b,0)/arr.length;
  });
  return {completion: completed/total, avgScores: avgScores};
}

/** Export reviews CSV */
function exportCSV() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(REVIEWS_SHEET);
  const csv = sheet.getDataRange().getDisplayValues().map(r=>r.join(',')).join('\n');
  return csv;
}

/** Simple admin to add user (DEV only) */
function addUser(user) {
  const session = getSession();
  if (!session || session.role !== 'DEV') throw new Error('denied');
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(USERS_SHEET);
  const salt = Utilities.getUuid();
  const sha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + user.password);
  const hash = sha.map(function(b){return ('0' + (b & 0xFF).toString(16)).slice(-2);}).join('');
  const id = new Date().getTime();
  sheet.appendRow([id, user.email, user.name, user.role, user.managerId||'', user.lang||'en', salt, hash]);
}

/** Trigger daily to send reminders */
function dailyNotifications() {
  const ss = SpreadsheetApp.getActive();
  const reviewSheet = ss.getSheetByName(REVIEWS_SHEET);
  const usersSheet = ss.getSheetByName(USERS_SHEET);
  const reviews = reviewSheet.getDataRange().getValues();
  const users = usersSheet.getDataRange().getValues();
  const userMap = {};
  users.forEach((r,i)=>{ if(i>0) userMap[r[0]]=r; });

  const now = new Date();
  reviews.forEach((r,i)=>{
    if(i===0) return;
    const [id, employeeId, type, data, status, ts] = r;
    const user = userMap[employeeId];
    if(!user) return;
    if(type==='SELF' && status!=='FINAL'){
      const openDate = new Date(ts);
      if((now-openDate)/(1000*60*60*24) > 7){
        GmailApp.sendEmail(user[1], 'Reminder to submit self-review', 'Please submit your self-review.');
      }
    }
  });
}
