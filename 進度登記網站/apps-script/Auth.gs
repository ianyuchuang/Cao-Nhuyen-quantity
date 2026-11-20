/**
 * 身分驗證與權限
 * 1. 前端送來 Google ID token，在 Apps Script 本機驗證（不呼叫 tokeninfo）：
 *    宣告（aud＝「設定」表的 OAuth 用戶端 ID、簽發者、未過期、email 已驗證）＋ RS256 簽章
 *    （Google 公開金鑰 JWKS 快取到 Cache-Control 期限，最多 6 小時；不認得的 kid 最多每 10 分鐘重抓一次）。
 *    偽造的憑證不會產生任何對外連線，所以沒有全域次數上限可被拿來擋住所有人登入。
 *    驗證成功的快取到憑證到期。每個帳號每分鐘最多 RATE_PER_MIN 次請求（含未授權者）。
 * 2. 權限來源（「設定」表「權限來源」）：
 *    - 「試算表共用」（預設）：本試算表編輯者（含擁有者）→ editor；檢視者／加註者 → viewer。
 *    - 「人員表」：本試算表編輯者 → editor；「人員」表 D 欄「核准」有勾選的帳號 → viewer。
 *      工程師不必共用試算表，就看不到主表的單價、複價（建議）。
 *    編輯者／共用名單快取 10 分鐘；人員表快取 PEOPLE_TTL 秒，而且在試算表編輯「人員」「設定」表時
 *    onEdit 會立即清掉（選單「清除權限快取」也可以手動清）。
 */

var RATE_PER_MIN = 60;

var GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
var SHA256_DIGESTINFO = '3031300d060960864801650304020105000420'; // PKCS#1 v1.5 的 SHA-256 DigestInfo 前綴

function verifyToken_(token) {
  if (!token || typeof token !== 'string') throw apiError_('auth', '請先用 Google 帳號登入');
  var parts = token.split('.');
  if (token.length > 4096 || parts.length !== 3) throw apiError_('auth', '登入憑證格式錯誤，請重新登入');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + sha_(token);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var clientId = trim_(getSetting_('OAuth 用戶端 ID'));
  if (!clientId) throw apiError_('config', '管理者尚未在「設定」表填入 OAuth 用戶端 ID');
  var now = Math.floor(Date.now() / 1000);
  var bad = function (msg) { throw apiError_('auth', msg || '登入已過期或憑證無效，請重新登入'); };

  var head = null, pay = null;
  try { head = JSON.parse(b64uText_(parts[0])); pay = JSON.parse(b64uText_(parts[1])); } catch (e) { head = null; }
  if (!head || !pay || typeof head !== 'object' || typeof pay !== 'object' || head.alg !== 'RS256' || typeof head.kid !== 'string') bad();
  // 先檢查宣告（便宜），再驗簽章
  if (pay.aud !== clientId) bad('登入憑證不是發給本網站的，請重新登入');
  if (pay.iss !== 'accounts.google.com' && pay.iss !== 'https://accounts.google.com') bad('登入憑證簽發者不正確');
  if (!(Number(pay.exp) > now)) bad('登入已過期，請重新登入');
  if (Number(pay.iat) > now + 300 || (pay.nbf != null && Number(pay.nbf) > now + 300)) bad();
  if (!(pay.email_verified === true || pay.email_verified === 'true')) bad('這個 Google 帳號的 email 尚未驗證');
  if (typeof pay.email !== 'string' || pay.email.indexOf('@') <= 0) bad();
  var jwk = googleKey_(head.kid);
  if (!jwk || !rs256Verify_(parts[0] + '.' + parts[1], parts[2], jwk)) bad();

  var exp = Number(pay.exp);
  var user = { email: String(pay.email).toLowerCase(), gname: safeText_(pay.name || '', 60) };
  var ttl = Math.min(21600, exp - now - 5); // 快取到憑證到期（CacheService 上限 6 小時）
  if (ttl > 5) cache.put(key, JSON.stringify(user), ttl);
  return user;
}

/** Google 的公開金鑰 { kid: {n, e} }，快取到 Cache-Control 期限（5 分鐘～6 小時） */
function googleKeys_(force) {
  var cache = CacheService.getScriptCache();
  if (!force) { var hit = cache.get('jwks'); if (hit) return JSON.parse(hit); }
  var res = UrlFetchApp.fetch(GOOGLE_JWKS_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw apiError_('busy', '暫時無法驗證登入（讀不到 Google 公開金鑰），請稍後再試');
  var keys = {};
  (JSON.parse(res.getContentText()).keys || []).forEach(function (k) {
    if (k && k.kty === 'RSA' && typeof k.kid === 'string' && k.n && k.e) keys[k.kid] = { n: k.n, e: k.e };
  });
  var h = res.getHeaders() || {}, cc = String(h['Cache-Control'] || h['cache-control'] || ''), m = cc.match(/max-age=(\d+)/);
  var ttl = m ? Math.max(300, Math.min(21600, Number(m[1]))) : 3600;
  cache.put('jwks', JSON.stringify(keys), ttl);
  return keys;
}

/** 依 kid 取金鑰；不認得的 kid（Google 可能剛換金鑰）最多每 10 分鐘重抓一次，偽造憑證帶亂數 kid 也不會一直對外連線 */
function googleKey_(kid) {
  var has = function (o) { return Object.prototype.hasOwnProperty.call(o, kid) ? o[kid] : null; };
  var k = has(googleKeys_(false));
  if (k) return k;
  var cache = CacheService.getScriptCache();
  if (cache.get('jwks_refetch')) return null;
  cache.put('jwks_refetch', '1', 600);
  return has(googleKeys_(true));
}

function b64uBytes_(s) { s = String(s); return Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4)); }
function b64uText_(s) { return Utilities.newBlob(b64uBytes_(s)).getDataAsString(); }
function bytesHex_(b) { return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join(''); }

function modPow_(b, e, m) {
  var r = BigInt(1), zero = BigInt(0), one = BigInt(1), two = BigInt(2);
  b = b % m;
  while (e > zero) {
    if (e % two === one) r = (r * b) % m;
    e = e / two;
    b = (b * b) % m;
  }
  return r;
}

/** RS256（RSASSA-PKCS1-v1_5 + SHA-256）簽章驗證；jwk = { n, e }（base64url） */
function rs256Verify_(signed, sigB64u, jwk) {
  var nHex = bytesHex_(b64uBytes_(jwk.n)).replace(/^(00)+/, '');
  var k = nHex.length / 2;
  var sigHex = bytesHex_(b64uBytes_(sigB64u));
  if (k < 256 || sigHex.length !== nHex.length) return false;       // 至少 2048 位元，簽章長度須等於模數長度
  var n = BigInt('0x' + nHex), e = BigInt('0x' + bytesHex_(b64uBytes_(jwk.e))), s = BigInt('0x' + sigHex);
  if (s >= n) return false;
  var em = modPow_(s, e, n).toString(16);
  while (em.length < k * 2) em = '0' + em;
  var tail = '00' + SHA256_DIGESTINFO + bytesHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signed, Utilities.Charset.UTF_8));
  var pad = k * 2 - 4 - tail.length;
  if (pad < 16) return false;
  return em === '0001' + new Array(pad + 1).join('f') + tail;
}

/**
 * 檢查用（在 Apps Script 編輯器執行）：確認本機簽章驗證在 Apps Script 上可用
 * （BigInt、Google 公開金鑰讀取），並用一組測試金鑰的已知簽章驗算一次（應為 true）與竄改後（應為 false）。
 */
function jwtSelfTest() {
  var keys = googleKeys_(true);
  var t = JWT_SELFTEST;
  var good = rs256Verify_(t.signed, t.sig, t.jwk);
  var badSig = rs256Verify_(t.signed + 'x', t.sig, t.jwk);
  var msg = 'Google 公開金鑰 ' + Object.keys(keys).length + ' 把；測試簽章驗證＝' + good + '（應為 true）；竄改後＝' + badSig + '（應為 false）';
  console.log(msg);
  return msg;
}

/** jwtSelfTest 用的固定測試向量：一次性產生的 2048 位元測試金鑰（私鑰已丟棄），與 Google 無關 */
var JWT_SELFTEST = {"signed":"eyJhbGciOiJSUzI1NiIsImtpZCI6InNlbGZ0ZXN0IiwidHlwIjoiSldUIn0.eyJpc3MiOiJzZWxmdGVzdCIsImF1ZCI6InNlbGZ0ZXN0IiwiZW1haWwiOiJzZWxmdGVzdEBleGFtcGxlLmludmFsaWQifQ","sig":"2W--BN1b1t1L2cGubP6R1oBPIal6H91uiK6bKFXPfmtwwTZaOotz68Jw0NVwPHX3J8fx8Ixuj-H7_u_uwRq-ick8O4R0wZUGO6URFruCNmIV3pKUEa0Vm1VIviXtOGTZujbXtl_kxPt2rnZfyNXWJHexxbz7jUsINWNC7RD5S2jldl6ux8yDTE3I_MXNlxPdYRNHfQqYdEHIsSv2pS7COssUzsMN1iNW9mwwcvoF0rS2hFQiHnyCj_8pIOSRF31DpZgm_vyrwzV7vSH2NT-7mTVDFQK0tq5tu-dYNMpKqxPSRYkTBSyql8txZ9sUHTg7lBkclewcL1P85Tgyx-SRNg","jwk":{"n":"5LEhOvNOMXIxnH9NxGIXiUeVINJtSfjmegwj2HIGwvNYvX4OPZ-sXjLT6_Ke73uBOgI4YRYYAu-c2cAVA5sbblMgQBqfY75YtsBSm-dCC5V357V-AqfVsanOqxG_DSdleQPbHEw22d-gqjijKQW9pNbfT1HHFB9Ko6g8IwsocxTa3bgxvho20QzKEB4CwEpY_OXRzJwHxn1p0vdQmpDDt8cEFzLPB6yxoIXQQIDIDPTjO1pE7GD4xk-TQKLgvR7_jCnkJYpB-vLTAs1K8EhxinKyKC3Ee3YbHHBrNk_mRh6DxCvMGEwHB7FjtpjfT0k-GdY1kMXtg3-xCY7yzAMukw","e":"AQAB"}};

/**
 * 每個帳號每分鐘請求上限。計數的「讀＋寫」包在鎖裡，並行請求也不會超過上限。
 * 用的鎖：document lock → user lock（網頁應用程式裡 document lock 可能是 null），都不能用就照舊計數（盡力而為）。
 * 這兩種鎖都不是登記用的 script lock，只鎖幾毫秒，不會卡住登記。
 */
function rateLimit_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + sha_(email) + '_' + Math.floor(Date.now() / 60000);
  withRateLock_(function () {
    var n = Number(cache.get(key)) || 0;
    if (n >= RATE_PER_MIN) throw apiError_('busy', '請求太頻繁，請稍後再試');
    cache.put(key, String(n + 1), 120);
  });
}

/** 在限流用的鎖內執行 fn(鎖的種類)；搶不到鎖回 busy；兩種鎖都不能用時不加鎖直接執行（kind＝'none'） */
function withRateLock_(fn) {
  var kinds = [['document', function () { return LockService.getDocumentLock(); }], ['user', function () { return LockService.getUserLock(); }]];
  for (var i = 0; i < kinds.length; i++) {
    var lock = null, got = false;
    try { lock = kinds[i][1](); if (!lock) continue; got = lock.tryLock(5000); } catch (e) { continue; }
    if (!got) throw apiError_('busy', '目前使用的人較多，請稍後再試');
    try { return fn(kinds[i][0]); } finally { lock.releaseLock(); }
  }
  return fn('none');
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
    var pending = 0, blankRow = 0;
    for (var i = 0; i < rows.length; i++) {
      if (!blankRow && !rows[i].slice(0, oc - 1).some(function (x) { return trim_(x); })) blankRow = i + 2; // 預先拉好的空白列（只有勾選框）
      if (trim_(rows[i][0]).toLowerCase() === user.email) return 'pending';
      if (trim_(rows[i][0]) && rows[i][oc - 1] !== true) pending++; // 只算有帳號的列（預先拉好的空白勾選框不算）
    }
    if (pending >= MAX_PENDING) { cache.put(fullKey, '1', CFG.PENDING_FULL_TTL); return 'full'; }
    var r = blankRow || sh.getLastRow() + 1; // 有預先拉好的空白列就填進去，不接在最後面
    var row = [safeText_(user.email, 120), safeText_(user.gname, 60), '網站登入自動加入 ' + todayStr_()];
    while (row.length < oc - 1) row.push('');
    row.push(false);
    sh.getRange(r, 1, 1, oc).setValues(protectRows_([row]));
    try { sh.getRange(r, oc).insertCheckboxes(); } catch (e) { /* 已有勾選框驗證時忽略 */ }
    clearAclCache_();
    return 'added';
  } finally { lock.releaseLock(); }
}
