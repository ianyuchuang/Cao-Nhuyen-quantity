/**
 * 身分驗證與權限
 * 1. 前端送來 Google ID token。先在本機檢查格式、aud、exp（擋掉垃圾 token，不浪費 UrlFetch 配額），
 *    再向 Google tokeninfo 驗證 aud（＝「設定」表的 OAuth 用戶端 ID）、簽發者、email 已驗證、未過期。
 *    驗證失敗的 token 負快取 60 秒；驗證成功的快取到憑證到期；向 Google 驗證全域每分鐘／每小時有上限
 *    （TOKENINFO_PER_*），擋偽造憑證耗光 UrlFetch 配額。每個帳號每分鐘最多 RATE_PER_MIN 次請求（含未授權者）。
 * 2. 權限來源（「設定」表「權限來源」）：
 *    - 「試算表共用」（預設）：本試算表編輯者（含擁有者）→ editor；檢視者／加註者 → viewer。
 *    - 「人員表」：本試算表編輯者 → editor；「人員」表 D 欄「核准」有勾選的帳號 → viewer。
 *      工程師不必共用試算表，就看不到主表的單價、複價（建議）。
 *    編輯者／共用名單快取 10 分鐘；人員表快取 PEOPLE_TTL 秒，而且在試算表編輯「人員」「設定」表時
 *    onEdit 會立即清掉（選單「清除權限快取」也可以手動清）。
 */

var RATE_PER_MIN = 60;

function verifyToken_(token) {
  if (!token || typeof token !== 'string') throw apiError_('auth', '請先用 Google 帳號登入');
  if (token.length > 4096 || token.split('.').length !== 3) throw apiError_('auth', '登入憑證格式錯誤，請重新登入');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + sha_(token);
  var hit = cache.get(key);
  if (hit === 'BAD') throw apiError_('auth', '登入已過期或憑證無效，請重新登入');
  if (hit) return JSON.parse(hit);

  var clientId = trim_(getSetting_('OAuth 用戶端 ID'));
  if (!clientId) throw apiError_('config', '管理者尚未在「設定」表填入 OAuth 用戶端 ID');
  var now = Math.floor(Date.now() / 1000);

  // 本機預檢（不可信，只用來擋垃圾；真正驗證靠 tokeninfo）
  var pre = null;
  try { pre = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split('.')[1] + '==='.slice((token.split('.')[1].length + 3) % 4))).getDataAsString()); } catch (e) { pre = null; }
  if (!pre || pre.aud !== clientId || !(Number(pre.exp) > now)) {
    cache.put(key, 'BAD', 60);
    throw apiError_('auth', '登入已過期或憑證無效，請重新登入');
  }

  tokeninfoBudget_(cache);
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { cache.put(key, 'BAD', 60); throw apiError_('auth', '登入已過期或憑證無效，請重新登入'); }
  var info = JSON.parse(res.getContentText());

  var fail = '';
  if (info.aud !== clientId) fail = '登入憑證不是發給本網站的，請重新登入';
  else if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') fail = '登入憑證簽發者不正確';
  else if (String(info.email_verified) !== 'true') fail = '這個 Google 帳號的 email 尚未驗證';
  else if (!(Number(info.exp) > now)) fail = '登入已過期，請重新登入';
  if (fail) { cache.put(key, 'BAD', 60); throw apiError_('auth', fail); }

  var exp = Number(info.exp);
  var user = { email: String(info.email).toLowerCase(), gname: safeText_(info.name || '', 60) };
  var ttl = Math.min(21600, exp - now - 5); // 快取到憑證到期（CacheService 上限 6 小時）
  if (ttl > 5) cache.put(key, JSON.stringify(user), ttl);
  return user;
}

/** 向 Google tokeninfo 驗證的全域次數上限（每分鐘、每小時），超過就請使用者稍後再試 */
function tokeninfoBudget_(cache) {
  var t = Date.now();
  var km = 'ti_m_' + Math.floor(t / 60000), kh = 'ti_h_' + Math.floor(t / 3600000);
  var got = cache.getAll([km, kh]);
  var m = Number(got[km]) || 0, h = Number(got[kh]) || 0;
  if (m >= CFG.TOKENINFO_PER_MIN || h >= CFG.TOKENINFO_PER_HOUR) {
    console.warn('tokeninfo 驗證次數達上限：本分鐘 ' + m + '、本小時 ' + h);
    throw apiError_('busy', '登入驗證太頻繁，請稍後再試');
  }
  cache.put(km, String(m + 1), 120);
  cache.put(kh, String(h + 1), 7200);
}

/** 每個帳號每分鐘請求上限 */
function rateLimit_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + sha_(email) + '_' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key)) || 0;
  if (n >= RATE_PER_MIN) throw apiError_('busy', '請求太頻繁，請稍後再試');
  cache.put(key, String(n + 1), 120);
}

function sha_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}

/** 回傳 'editor'、'viewer' 或 null */
function roleOf_(email) {
  var acl = acl_();
  email = String(email).toLowerCase();
  if (acl.editors.indexOf(email) >= 0) return 'editor';
  if (acl.src === 'people') {
    var m = peopleMap_();
    return Object.prototype.hasOwnProperty.call(m, email) && m[email].ok ? 'viewer' : null;
  }
  if (acl.viewers.indexOf(email) >= 0) return 'viewer';
  return null;
}

function aclSource_() {
  return trim_(getSetting_('權限來源')) === '人員表' ? 'people' : 'share';
}

/**
 * 編輯者與（試算表共用模式的）檢視者名單，快取 ACL_TTL。
 * 人員表模式的檢視者不放在這裡，每次由 peopleMap_()（短快取）判斷，核准後很快生效。
 */
function acl_() {
  var cache = CacheService.getScriptCache();
  var src = aclSource_();
  var hit = cache.get('acl');
  if (hit) {
    var c = JSON.parse(hit);
    if (c.src === src) return c;
  }
  var ss = ss_();
  var low = function (u) { return String(u.getEmail() || '').toLowerCase(); };
  var editors = ss.getEditors().map(low);
  try { var o = ss.getOwner(); if (o) editors.push(low(o)); } catch (e) { /* 共用雲端硬碟沒有擁有者 */ }
  var viewers = src === 'people' ? [] : ss.getViewers().map(low); // 含加註者
  var acl = { src: src, editors: editors.filter(String), viewers: viewers.filter(String) };
  cache.put('acl', JSON.stringify(acl), CFG.ACL_TTL);
  return acl;
}

/** 選單：清除權限快取（剛移除共用、改了人員表，要立即生效時用） */
function clearAclCache() {
  clearAclCache_();
  toast_('已清除權限快取，新的名單立即生效。');
}
function clearAclCache_() {
  CacheService.getScriptCache().removeAll(['acl', 'people']);
}

/** 除錯用：在 Apps Script 編輯器執行，建立權限快取（模擬有人剛用過網站） */
function warmAclCache() {
  acl_(); peopleMap_();
  return aclCacheStatus();
}

/** 除錯用：在 Apps Script 編輯器執行，記錄權限快取目前是否存在（不會產生快取） */
function aclCacheStatus() {
  var c = CacheService.getScriptCache().getAll(['acl', 'people']);
  var s = 'acl 快取：' + (c.acl ? '有' : '無') + '；people 快取：' + (c.people ? '有' : '無');
  if (c.people) {
    var m = JSON.parse(c.people);
    s += '（人員 ' + Object.keys(m).length + ' 人，核准 ' + Object.keys(m).filter(function (e) { return m[e].ok; }).length + ' 人）';
  }
  console.log(s);
  return s;
}

/**
 * 「人員」表：A Google 帳號、B 顯示名稱、C 備註、D 核准（勾選框）
 * 只有「核准」欄勾選（TRUE）＝可用；未勾選、空白或任何文字＝不可用（白名單）。
 * 「核准」欄依第 1 列表頭找（找不到就用 D 欄），欄位調整時不會認錯欄。
 * 回傳 { email: { name, ok, status } }
 */
var PEOPLE_OK_COL = 4;
function peopleOkCol_(sh) {
  var w = Math.min(sh.getMaxColumns(), 10);
  var h = sh.getRange(1, 1, 1, w).getValues()[0];
  for (var j = 0; j < h.length; j++) if (trim_(h[j]) === '核准') return j + 1;
  return PEOPLE_OK_COL;
}

function peopleMap_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('people');
  if (hit) return JSON.parse(hit);
  var map = {};
  var sh = ss_().getSheetByName(CFG.SH.PEOPLE);
  if (sh && sh.getLastRow() > 1) {
    var oc = peopleOkCol_(sh);
    var cols = Math.min(Math.max(oc, 2), sh.getMaxColumns());
    sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues().forEach(function (r) {
      var e = trim_(r[0]).toLowerCase();
      if (!e || e.indexOf('@') <= 0 || map[e]) return;
      var ok = cols >= oc && r[oc - 1] === true;
      map[e] = { name: safeText_(r[1], 60), status: ok ? '核准' : '未核准', ok: ok };
    });
  }
  cache.put('people', JSON.stringify(map), CFG.PEOPLE_TTL);
  return map;
}

/** email → 顯示名稱（人員表有名稱就用名稱，否則原樣） */
function nameOfEmail_(by) {
  var m = peopleMap_(), k = String(by).toLowerCase();
  return Object.prototype.hasOwnProperty.call(m, k) && m[k].name ? m[k].name : String(by);
}

function displayName_(user) {
  var m = peopleMap_();
  var p = Object.prototype.hasOwnProperty.call(m, user.email) ? m[user.email] : null;
  return (p && p.name) || user.gname || user.email;
}

/**
 * 權限來源為「人員表」時，沒有權限的人登入就把帳號寫進「人員」表、「核准」未勾選，
 * 管理者勾選後即可使用（onEdit 立即清快取；最慢 PEOPLE_TTL 秒）。
 * 回傳 'added'（剛加入）、'pending'（已在名單、未勾選）、'full'（待核准名額已滿）、'busy'（搶不到鎖）或 ''（不適用）
 */
var MAX_PENDING = 200;
function registerPending_(user) {
  if (aclSource_() !== 'people') return '';
  if (Object.prototype.hasOwnProperty.call(peopleMap_(), user.email)) return 'pending';
  var cache = CacheService.getScriptCache(), fullKey = 'pfull_' + sha_(user.email);
  if (cache.get(fullKey)) return 'full';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'busy';
  try {
    var sh = sheet_(CFG.SH.PEOPLE);
    if (sh.getMaxColumns() < PEOPLE_OK_COL) sh.insertColumnsAfter(sh.getMaxColumns(), PEOPLE_OK_COL - sh.getMaxColumns());
    var oc = peopleOkCol_(sh);
    if (!trim_(sh.getRange(1, oc).getValue())) sh.getRange(1, oc).setValue('核准');
    var n = sh.getLastRow() - 1;
    var rows = n > 0 ? sh.getRange(2, 1, n, oc).getValues() : [];
    var pending = 0;
    for (var i = 0; i < rows.length; i++) {
      if (trim_(rows[i][0]).toLowerCase() === user.email) return 'pending';
      if (rows[i][oc - 1] !== true) pending++;
    }
    if (pending >= MAX_PENDING) { cache.put(fullKey, '1', CFG.PENDING_FULL_TTL); return 'full'; }
    var r = sh.getLastRow() + 1;
    var row = [safeText_(user.email, 120), safeText_(user.gname, 60), '網站登入自動加入 ' + todayStr_()];
    while (row.length < oc - 1) row.push('');
    row.push(false);
    sh.getRange(r, 1, 1, oc).setValues(protectRows_([row]));
    try { sh.getRange(r, oc).insertCheckboxes(); } catch (e) { /* 已有勾選框驗證時忽略 */ }
    clearAclCache_();
    return 'added';
  } finally { lock.releaseLock(); }
}
