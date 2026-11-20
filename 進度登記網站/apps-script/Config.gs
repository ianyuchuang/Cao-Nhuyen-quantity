/**
 * 工項進度登記 API － 設定與共用工具
 *
 * 綁定試算表「工項進度登記」。
 * 正式版「高軟每日施工內容(正式版)」只讀：本程式任何地方都不寫入正式版。
 */

var CFG = {
  // 正式版（只讀）
  OFFICIAL_ID: '1oO2lMHtFcavM2qS63l1Cpny-SLgWkavh87AVmFcGJQI',
  OFFICIAL_SHEET: '施工-實際進度 (修訂2版)',

  // 本試算表的工作表名稱
  SH: {
    MAIN: '施工-實際進度',   // 正式版鏡像（只從正式版同步）
    DAILY: '網站每日數量',   // 列與主表對齊；J 期初、K 起逐日
    LAYER: '分層進度',
    LOC: '位置',
    CUR: '目前進度',
    LOG: '進度紀錄',
    MAT: '進料',
    PEOPLE: '人員',
    SET: '設定'
  },

  TZ: 'Asia/Taipei',
  HEADER_ROWS: 3,        // 主表與網站每日數量：天氣 2 列＋表頭 1 列
  COL_USED: 7,           // 主表 G 使用數量
  COL_OPENING: 10,       // 網站每日數量 J 期初（主表 J 是「已使用」）
  COL_FIRST_DATE: 11,    // K 起為日期欄
  ACL_TTL: 600,          // 編輯者／共用名單快取 10 分鐘
  PEOPLE_TTL: 30,        // 人員表快取 30 秒（編輯人員表時 onEdit 也會立即清掉）
  // 向 Google tokeninfo 驗證的全域上限（擋偽造憑證耗光 UrlFetch 每日配額；驗證成功的憑證快取到到期，不重複驗）
  TOKENINFO_PER_MIN: 60,
  TOKENINFO_PER_HOUR: 600,
  PENDING_FULL_TTL: 600, // 待核准名額已滿時，同一帳號 10 分鐘內直接回覆、不再搶鎖
  OPENING_BY: '系統（期初推估）',
  // 每日同步後：正式版使用數量 ≥ 圖面合計 × AUTO_MAT_RATIO → 視為進料完成，自動補進料到圖面合計（只補不減）
  AUTO_MAT_RATIO: 0.5,
  AUTO_MAT_BY: '系統（正式版≥50%）',
  OPENING_LEVEL: '期初',
  MANAGED_BG: '#ddebf7', // 主表中網站管理層級的 A～C 淺藍
  // 完成量＝圖面合計 × MAT_WEIGHT × 進料比例 ＋ Σ(位置圖面數量 × (1−MAT_WEIGHT) × 施作完成%)
  // 進料比例＝min(進料累計 ÷ 圖面合計, 1)；網站上填的完成% 只代表「施作」那一半（2026-11-19 使用者決定進料以 50% 計）
  MAT_WEIGHT: 0.5,
  // 期初時進料一律視為已全部到貨的工項／層級（使用者 2026-11-19：磁磚及 A梯、B梯欄杆進料已完成）
  OPENING_MAT_FULL_CATS: ['貼面磚'],
  OPENING_MAT_FULL_LVS: ['I.甲.壹.八.1', 'I.甲.壹.八.2', 'I.甲.壹.八.6', 'I.甲.壹.八.7']
};

// 「位置」欄（1 起算）
var LOC_COL = { LV: 1, NAME: 2, UNIT: 3, CAT: 4, CODE: 5, FL: 6, RID: 7, NM: 8, KIND: 9, QTY: 10, ID: 11, ROOM: 12, VER: 13, STATE: 14 };
// 「目前進度」欄
var CUR_COL = { LV: 1, NAME: 2, UNIT: 3, FL: 4, RID: 5, ID: 6, PCT: 7, FRAME: 8, LEAF: 9, QTY: 10, DATE: 11, BY: 12, TS: 13 };
// 「進度紀錄」欄
var LOG_COL = { LV: 1, NAME: 2, UNIT: 3, FL: 4, RID: 5, ID: 6, DETAIL: 7, PCT: 8, OLD: 9, QTY: 10, DATE: 11, LEVEL: 12, BY: 13, TS: 14, UUID: 15, REASON: 16, NOTE: 17 };
var LOG_WIDTH = 17;
// 「進料」欄
var MAT_COL = { LV: 1, NAME: 2, UNIT: 3, DATE: 4, QTY: 5, BY: 6, TS: 7, UUID: 8, NOTE: 9 };
var MAT_WIDTH = 9;

// 門窗逐樘的兩個施作細項與權重（依「項目」文字判斷類別）
var TAG_STEPS = {
  '門': [['門框', 0.6], ['門扇及五金', 0.4]],
  '窗': [['窗框', 0.6], ['玻璃／百葉及五金', 0.4]],
  '捲門': [['導軌及捲軸箱', 0.6], ['門片及電動機', 0.4]]
};
function tagStepsFor_(itemName) {
  var s = String(itemName || '');
  if (s.indexOf('捲門') >= 0) return TAG_STEPS['捲門'];
  if (s.indexOf('鋁') >= 0) return TAG_STEPS['窗'];   // 鋁窗、鋁百葉窗、鋁門窗、鋁玻璃門
  return TAG_STEPS['門'];
}

// ---------- 共用工具 ----------
/**
 * 本試算表。權限範圍只有 spreadsheets.currentonly（只能改綁定的這份）＋ spreadsheets.readonly（其他試算表只能讀），
 * 所以正式版由 Google 權限保證唯讀，程式就算寫錯也改不到。
 */
function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw apiError_('config', '找不到工作表「' + name + '」');
  return sh;
}
function apiError_(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}
function trim_(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
/** 使用者輸入的文字：限制長度，開頭是 = + - @ 時加 ' 讓試算表當文字（防公式注入） */
function safeText_(v, max) {
  var s = trim_(v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
/**
 * 寫入試算表前的保護：開頭是 = + - @ 的字串前面加 '，讓試算表一律當文字。
 * 試算表讀回時會吃掉這個 '，所以「讀出再寫回」的地方都要再套一次（否則文字會變成公式）。
 * 已經以 ' 開頭的字串不再加。
 */
function protect_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function protectRows_(rows) { return rows.map(function (r) { return r.map(protect_); }); }
function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function round_(x, d) { var k = Math.pow(10, d); return Math.round((x + (x >= 0 ? 1e-12 : -1e-12)) * k) / k; }
/** 試算表的完成% 欄是百分比格式：存 0～1 的小數；程式內部與 API 一律用 0～100 */
function toFrac_(p) { return p === '' || p == null ? '' : round_(Number(p) / 100, 6); }
function fromFrac_(v) { return v === '' || v == null ? '' : round_(num_(v) * 100, 4); }
function clampPct_(v) { var n = Number(v); if (!isFinite(n)) n = 0; return round_(Math.max(0, Math.min(100, n)), 2); }

/** 日期值（Date 或文字）→ 'yyyy-MM-dd'；空白回 '' */
function dateStr_(v) {
  if (v === '' || v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
  }
  if (typeof v === 'number') { // 試算表序號
    var d = new Date(Math.round((v - 25569) * 86400000));
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  }
  var m = String(v).trim().match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (!m) return '';
  var t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (t.getUTCFullYear() !== +m[1] || t.getUTCMonth() !== +m[2] - 1 || t.getUTCDate() !== +m[3]) return ''; // 例如 2026-02-31
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}
function todayStr_() { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'); }
function addDays_(ds, n) {
  var p = ds.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
/** 欄號 → 字母 */
function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function lastDataRow_(sh) { return Math.max(sh.getLastRow(), 1); }

// ---------- 「設定」表 ----------
function settings_() {
  var sh = sheet_(CFG.SH.SET);
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getValues();
  var out = {};
  for (var i = 1; i < v.length; i++) {
    var k = trim_(v[i][0]);
    if (k) out[k] = v[i][1];
  }
  return out;
}
function getSetting_(key) { var s = settings_(); return s[key] == null ? '' : s[key]; }
function goLive_() { return dateStr_(getSetting_('上線日')); }
