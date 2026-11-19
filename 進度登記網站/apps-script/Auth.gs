/**
 * 身分驗證與權限
 * 1. 前端送來 Google ID token。先在本機檢查格式、aud、exp（擋掉垃圾 token，不浪費 UrlFetch 配額），
 *    再向 Google tokeninfo 驗證 aud（＝「設定」表的 OAuth 用戶端 ID）、簽發者、email 已驗證、未過期。
 *    驗證失敗的 token 負快取 60 秒；每個帳號每分鐘最多 RATE_PER_MIN 次請求。
 * 2. 權限來源（「設定」表「權限來源」）：
 *    - 「試算表共用」（預設）：本試算表編輯者（含擁有者）→ editor；檢視者／加註者 → viewer。
 *    - 「人員表」：本試算表編輯者 → editor；「人員」表列出的帳號 → viewer。
 *      工程師不必共用試算表，就看不到主表的單價、複價（建議）。
 *    名單快取 10 分鐘（可用選單「清除權限快取」立即生效）。
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
  var ttl = Math.min(CFG.ACL_TTL, exp - now - 5);
  if (ttl > 5) cache.put(key, JSON.stringify(user), ttl);
  return user;
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
  if (acl.viewers.indexOf(email) >= 0) return 'viewer';
  return null;
}

function aclSource_() {
  return trim_(getSetting_('權限來源')) === '人員表' ? 'people' : 'share';
}

function acl_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('acl');
  if (hit) return JSON.parse(hit);
  var ss = ss_();
  var low = function (u) { return String(u.getEmail() || '').toLowerCase(); };
  var editors = ss.getEditors().map(low);
  try { var o = ss.getOwner(); if (o) editors.push(low(o)); } catch (e) { /* 共用雲端硬碟沒有擁有者 */ }
  var viewers;
  if (aclSource_() === 'people') viewers = peopleOk_();
  else viewers = ss.getViewers().map(low); // 含加註者
  var acl = { editors: editors.filter(String), viewers: viewers.filter(String) };
  cache.put('acl', JSON.stringify(acl), CFG.ACL_TTL);
  return acl;
}

/** 選單：清除權限快取（剛移除共用、改了人員表，要立即生效時用） */
function clearAclCache() {
  CacheService.getScriptCache().removeAll(['acl', 'people']);
  toast_('已清除權限快取，新的名單立即生效。');
}

/**
 * 「人員」表：A Google 帳號、B 顯示名稱、C 負責工項、D 備註、E 狀態
 * 狀態：空白或「核准」＝可用；「待核准」「停用」＝不可用。
 * 回傳 { email: { name, ok, status } }
 */
function peopleMap_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('people');
  if (hit) return JSON.parse(hit);
  var map = {};
  var sh = ss_().getSheetByName(CFG.SH.PEOPLE);
  if (sh && sh.getLastRow() > 1) {
    var cols = Math.min(5, sh.getMaxColumns());
    sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues().forEach(function (r) {
      var e = trim_(r[0]).toLowerCase();
      if (!e || e.indexOf('@') <= 0 || map[e]) return;
      var st = cols >= 5 ? trim_(r[4]) : '';
      map[e] = { name: safeText_(r[1], 60), status: st, ok: st !== '待核准' && st !== '停用' };
    });
  }
  cache.put('people', JSON.stringify(map), CFG.ACL_TTL);
  return map;
}

function peopleOk_() {
  var m = peopleMap_();
  return Object.keys(m).filter(function (e) { return m[e].ok; });
}

function displayName_(user) {
  var m = peopleMap_();
  var p = Object.prototype.hasOwnProperty.call(m, user.email) ? m[user.email] : null;
  return (p && p.name) || user.gname || user.email;
}

/**
 * 權限來源為「人員表」時，沒有權限的人登入就把帳號寫進「人員」表、狀態「待核准」，
 * 管理者把狀態改成「核准」（或清空）後即可使用（最多 10 分鐘，或選單「清除權限快取」立即生效）。
 * 回傳 'added'（剛加入）、'pending'（已在等待）、'disabled'（已停用）或 ''（不適用）
 */
var MAX_PENDING = 200;
function registerPending_(user) {
  if (aclSource_() !== 'people') return '';
  var p = peopleMap_()[user.email];
  if (p) return p.status === '停用' ? 'disabled' : 'pending';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return 'pending';
  try {
    var sh = sheet_(CFG.SH.PEOPLE);
    if (sh.getMaxColumns() < 5) sh.insertColumnsAfter(sh.getMaxColumns(), 5 - sh.getMaxColumns());
    if (!trim_(sh.getRange(1, 5).getValue())) sh.getRange(1, 5).setValue('狀態');
    var n = sh.getLastRow() - 1;
    var rows = n > 0 ? sh.getRange(2, 1, n, 5).getValues() : [];
    var pending = 0;
    for (var i = 0; i < rows.length; i++) {
      if (trim_(rows[i][0]).toLowerCase() === user.email) return 'pending';
      if (trim_(rows[i][4]) === '待核准') pending++;
    }
    if (pending >= MAX_PENDING) return 'pending';
    sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setValues([[safeText_(user.email, 120), safeText_(user.gname, 60), '',
      '網站登入自動加入 ' + todayStr_(), '待核准']]);
    CacheService.getScriptCache().remove('people');
    return 'added';
  } finally { lock.releaseLock(); }
}
