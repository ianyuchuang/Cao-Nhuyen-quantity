// 以模擬的 SpreadsheetApp 執行 apps-script/*.gs 的單元測試。用法：node tests/gas-test.js apps-script
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const DIR = process.argv[2];

// ---------- 模擬 ----------
function fmtDate(d, tz, f) {
  const off = tz === 'Asia/Taipei' ? 8 : 0;
  const x = new Date(d.getTime() + off * 3600000);
  const p = n => String(n).padStart(2, '0');
  return f.replace('yyyy', x.getUTCFullYear()).replace('MM', p(x.getUTCMonth() + 1)).replace('dd', p(x.getUTCDate()))
    .replace('HH', p(x.getUTCHours())).replace('mm', p(x.getUTCMinutes()));
}
const tw = s => new Date(s + 'T00:00:00+08:00');
class Sheet {
  constructor(name, rows) { this.name = name; this.d = rows.map(r => r.slice()); this.f = {}; this.maxCols = Math.max(...rows.map(r => r.length), 1); }
  getName() { return this.name; }
  getLastRow() { for (let i = this.d.length - 1; i >= 0; i--) if (this.d[i].some(v => v !== '' && v != null)) return i + 1; return 0; }
  getLastColumn() { let m = 0; this.d.forEach(r => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] != null) { m = Math.max(m, j + 1); break; } }); return m; }
  getMaxRows() { return this.d.length; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(a, n) { for (let i = 0; i < n; i++) this.d.push([]); }
  insertColumnsAfter(a, n) { this.maxCols += n; }
  deleteRows(a, n) { this.d.splice(a - 1, n); }
  deleteColumns(a, n) { this.maxCols -= n; this.d.forEach(r => r.splice(a - 1, n)); }
  getRange(r, c, nr, nc) { if (typeof r === 'string') throw new Error('A1 not supported'); return new Range(this, r, c, nr || 1, nc || 1); }
  getRangeList(list) { return { setBackground: () => {} }; }
  getIndex() { return 1; }
  getColumnWidth() { return 100; } setColumnWidths() { return this; }
  setFrozenRows() {} setFrozenColumns() {} getFrozenRows() { return 3; } getFrozenColumns() { return 9; }
  get(r, c) { const row = this.d[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  set(r, c, v) { while (this.d.length < r) this.d.push([]); this.d[r - 1][c - 1] = v; if (c > this.maxCols) this.maxCols = c; }
}
// 試算表寫入字串的行為：' 開頭存成文字（讀回時沒有 '）；= + - @ 開頭（且不是數字）會被當成公式
const FORMULAS = [];
function sheetParse(sh, r, c, x) {
  if (typeof x !== 'string') return x;
  if (x.startsWith("'")) return x.slice(1);
  if (/^[=+\-@]/.test(x) && !isFinite(Number(x))) { FORMULAS.push(sh.name + '!R' + r + 'C' + c + ' ' + x); return '#公式#' + x; }
  return x;
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); o.push(row); } return o; }
  setValues(v) {
    assert.strictEqual(v.length, this.nr, 'setValues rows ' + this.sh.name); v.forEach((row, i) => { assert.strictEqual(row.length, this.nc, 'setValues cols ' + this.sh.name);
      row.forEach((x, j) => {
        // 模擬試算表把 yyyy-MM-dd 文字轉成日期
        if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) x = tw(x);
        x = sheetParse(this.sh, this.r + i, this.c + j, x);
        this.sh.set(this.r + i, this.c + j, x);
      }); }); return this;
  }
  setValue(x) { this.sh.set(this.r, this.c, sheetParse(this.sh, this.r, this.c, x)); return this; }
  getValue() { return this.sh.get(this.r, this.c); }
  setFormula(f) { this.sh.f[this.r + ',' + this.c] = f; return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
  clear() { return this.clearContent(); }
  setNumberFormat() { return this; } setBackground() { return this; }
  insertCheckboxes() { this.sh.cb = (this.sh.cb || 0) + 1; return this; }
  grid(v) { const o = []; for (let i = 0; i < this.nr; i++) o.push(new Array(this.nc).fill(v)); return o; }
  getNumberFormats() { return this.grid('General'); } getBackgrounds() { return this.grid('#ffffff'); }
  getFontWeights() { return this.grid('normal'); } getHorizontalAlignments() { return this.grid('general'); }
  getMergedRanges() { return []; } breakApart() { return this; } merge() { return this; }
  setNumberFormats() { return this; } setBackgrounds() { return this; } setFontWeights() { return this; } setHorizontalAlignments() { return this; }
  getSheet() { return this.sh; }
  copyTo(dest) { const v = this.getValues(); new Range(dest.sh, dest.r, dest.c, v.length, v[0].length).setValues(v); }
}
function makeSS(sheets) {
  const ss = { sheets, getId: () => 'SS', getSheetByName: n => sheets.find(s => s.name === n) || null,
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1), insertSheet: n => { const s = new Sheet(n, [[]]); sheets.push(s); return s; },
    toast: () => {}, setActiveSheet() {}, moveActiveSheet() {} };
  return ss;
}
const cache = new Map(); const cacheTtl = new Map();
const CacheMock = { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v, t) => { cache.set(k, v); cacheTtl.set(k, t); }, putAll: m => Object.keys(m).forEach(k => cache.set(k, m[k])),
  getAll: ks => { const o = {}; ks.forEach(k => { if (cache.has(k)) o[k] = cache.get(k); }); return o; }, remove: k => cache.delete(k), removeAll: ks => ks.forEach(k => cache.delete(k)) }) };

// ---------- 測試資料 ----------
const GOLIVE = '2026-11-10';
const dates = []; for (let d = new Date(Date.UTC(2026, 10, 1)); d <= new Date(Date.UTC(2026, 11, 31)); d = new Date(d.getTime() + 86400000)) dates.push(tw(d.toISOString().slice(0, 10)));
const hdr3 = ['層級', '項目', '單位', '單價', '數量', '複價', '使用數量', '剩餘數量', '執行率', '已使用'].concat(dates);
const mainRow = (lv, name, unit, used) => { const r = [lv, name, unit, 999, 100, 99900, '', '', '', '']; dates.forEach(d => r.push('')); r[10] = used; return r; }; // 11/1 欄放上線前使用數量
const W = hdr3.length;
const blank = () => new Array(W).fill('');
const main = new Sheet('施工-實際進度', [blank(), blank(), hdr3, [' I ', '統包工程費', ''].concat(new Array(W - 3).fill('')),
  mainRow('A.1', '天花板，C1-測試天花', 'M2', 30), mainRow('A.2', '金屬門扇及門樘，D1 鋼板門', '樘', 1), mainRow('A.3', '鋁門扇及門樘，DW9 鋁玻璃門', '樘', 5)]);
const dhdr = ['層級', '項目', '單位', '', '圖面數量', '', '網站累計', '正式版使用數量', '差異', '期初'].concat(dates);
const daily = new Sheet('網站每日數量', [blank(), blank(), dhdr, ['I', '統包工程費', ''].concat(new Array(W - 3).fill('')),
  ['A.1', '天花板', 'M2', '', 100].concat(new Array(W - 5).fill('')), ['A.2', '門', '樘', '', 2].concat(new Array(W - 5).fill('')), ['A.3', '窗', '樘', '', 1].concat(new Array(W - 5).fill(''))]);
const loc = new Sheet('位置', [['層級', '項目', '單位', '工項', '代號', '樓層', '房號', '空間', '類型', '圖面數量', '位置ID', '房間ID', '版本', '狀態'],
  ['A.1', '天花板，C1-測試天花', 'M2', '天花板', 'C1', '1F', '101', '辦公室', '房間', 60, 'A.1|1F|101', '天花板|1F|101', 'v', '有效'],
  ['A.1', '天花板，C1-測試天花', 'M2', '天花板', 'C1', '1F', '102', '會議室', '房間', 40, 'A.1|1F|102', '天花板|1F|102', 'v', '有效'],
  ['A.2', '金屬門扇及門樘，D1 鋼板門', '樘', '門窗', 'D1', '1F', '1F-D101', '東', '單樘', 1, 'A.2|1F|1F-D101', '門窗|1F|D1', 'v', '有效'],
  ['A.2', '金屬門扇及門樘，D1 鋼板門', '樘', '門窗', 'D1', '2F', '2F-D101', '西', '單樘', 1, 'A.2|2F|2F-D101', '門窗|2F|D1', 'v', '有效'],
  ['A.3', '鋁門扇及門樘，DW9 鋁玻璃門', '樘', '門窗', 'DW9', '1F', '1F-DW901', '北', '單樘', 1, 'A.3|1F|1F-DW901', '門窗|1F|DW9', 'v', '有效']]);
const cur = new Sheet('目前進度', [['層級', '項目', '單位', '樓層', '房號', '位置ID', '完成%', '框', '扇', '完成量', '日期', '登記人', '更新時間']].concat(
  loc.d.slice(1).map(r => [r[0], r[1], r[2], r[5], r[6], r[10], '', '', '', 0, '', '', ''])));
const log = new Sheet('進度紀錄', [['層級', '項目', '單位', '樓層', '房號', '位置ID', '細項', '完成%', '舊值', '完成量', '施工日期', '填寫層級', '登記人', '時間戳', 'UUID', '原因', '備註']]);
const mat = new Sheet('進料', [['層級', '項目', '單位', '日期', '到貨數量', '登記人', '時間戳', 'UUID', '備註']]);
const set = new Sheet('設定', [['項目', '值', '說明'], ['上線日', tw(GOLIVE), ''], ['數量版本', '2026-11-18', ''], ['OAuth 用戶端 ID', 'CID.apps.googleusercontent.com', '']]);
const people = new Sheet('人員', [['Google 帳號', '顯示名稱', '備註', '核准'], ['eng@x.com', '王工程師', '', true]]);
const layer = new Sheet('分層進度', [['層級']]);
const SS = makeSS([main, daily, layer, loc, cur, log, mat, people, set]);
SS.getEditors = () => [{ getEmail: () => 'boss@x.com' }]; SS.getOwner = () => ({ getEmail: () => 'owner@x.com' }); SS.getViewers = () => [{ getEmail: () => 'eng@x.com' }];

// 「今天」固定為 2026-11-20
const RealDate = Date;
const NOW = new RealDate('2026-11-20T10:00:00+08:00').getTime();
let tick = 0;
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW + (tick++) * 1000); } static now() { return NOW + (tick++) * 1000; } }

const tokensRaw = { tokE: { aud: 'CID.apps.googleusercontent.com', iss: 'https://accounts.google.com', email: 'Boss@x.com', email_verified: 'true', exp: String(NOW / 1000 + 3600), name: 'Boss' },
  tokV: { aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'eng@x.com', email_verified: 'true', exp: String(NOW / 1000 + 3600) },
  tokX: { aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'stranger@x.com', email_verified: 'true', exp: String(NOW / 1000 + 3600) },
  tokY: { aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'late@x.com', email_verified: 'true', exp: String(NOW / 1000 + 3600) },
  tokZ: { aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'nobody@x.com', email_verified: 'true', exp: String(NOW / 1000 + 3600) },
  tokBadAud: { aud: 'OTHER', iss: 'accounts.google.com', email: 'eng@x.com', email_verified: 'true', exp: String(NOW / 1000 + 3600) } };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
// 真的 RS256 簽章：測試用 RSA 金鑰，UrlFetch 模擬 Google JWKS
const nodeCrypto = require('crypto');
const KEYS = { k1: nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), k2: nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 }) };
let JWKS_KIDS = ['k1']; // Google 目前公布的金鑰
const sign = (payload, kid = 'k1', key = KEYS[kid].privateKey) => {
  const signed = b64({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + b64(Object.assign({ iat: NOW / 1000 - 60 }, payload));
  return signed + '.' + nodeCrypto.sign('sha256', Buffer.from(signed), key).toString('base64url');
};
const T = {};
Object.keys(tokensRaw).forEach(k => { T[k] = sign(tokensRaw[k]); });
const ctx = {
  console, JSON, Math, Object, Array, String, Number, Error, isFinite, isNaN, encodeURIComponent, Date: FakeDate,
  SpreadsheetApp: { getActiveSpreadsheet: () => SS, openById: () => { throw new Error('測試中不應開啟正式版'); }, flush() {}, getUi() { throw new Error('no ui'); }, CopyPasteType: { PASTE_NORMAL: 1 } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  CacheService: CacheMock,
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  Utilities: { formatDate: fmtDate, base64DecodeWebSafe: x => Array.from(Buffer.from(x.replace(/=+$/,''), 'base64url')), newBlob: a => ({ getDataAsString: () => Buffer.from(a).toString('utf8') }), getUuid: () => 'u-' + Math.random().toString(36).slice(2), computeDigest: (a, s) => Array.from(require('crypto').createHash('sha256').update(s).digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 } },
  UrlFetchApp: { fetch: url => {
    if (url !== 'https://www.googleapis.com/oauth2/v3/certs') throw new Error('不應連線到 ' + url);
    const keys = JWKS_KIDS.map(kid => Object.assign({ kid, alg: 'RS256', use: 'sig' }, KEYS[kid].publicKey.export({ format: 'jwk' })));
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ keys }), getHeaders: () => ({ 'Cache-Control': 'public, max-age=20000, must-revalidate' }) };
  } },
  ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
  ScriptApp: {}
};
vm.createContext(ctx);
fs.readdirSync(DIR).filter(f => f.endsWith('.gs')).forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
const call = req => ctx.handle_(req);
const dcol = ds => 11 + dates.findIndex(d => fmtDate(d, 'Asia/Taipei', 'yyyy-MM-dd') === ds);
const drow = lv => daily.d.findIndex(r => String(r[0]).trim() === lv) + 1;
const dval = (lv, ds) => daily.get(drow(lv), dcol(ds));
const ok = (c, m) => { assert.ok(c, m); console.log('✓', m); };

// ---------- 1. 權限 ----------
ok(call({ action: 'bootstrap' }).error === 'auth', '沒帶 token → auth');
ok(call({ action: 'bootstrap', token: T.tokBadAud }).error === 'auth', 'aud 不符 → auth');
ok(call({ action: 'bootstrap', token: T.tokX }).error === 'forbidden', '未共用 → forbidden');
ok(call({ action: 'recalc', token: T.tokV }).error === 'forbidden', '檢視者不能 recalc');
const b0 = call({ action: 'bootstrap', token: T.tokV });
ok(b0.ok && b0.user.role === 'viewer' && b0.user.name === '王工程師', '檢視者可 bootstrap，顯示名稱取自人員表');
ok(JSON.stringify(b0).indexOf('999') < 0 && JSON.stringify(b0).indexOf('99900') < 0, 'bootstrap 不含單價／複價');
ok(b0.items[1][5][0][0] === '門框' && b0.items[2][5][0][0] === '窗框', '門窗細項：D1 門、DW9 鋁玻璃門 → 窗');

// ---------- 2. 期初（進料 50%＋施作 50%） ----------
// A.1 天花板：圖面 100、已用 30 → 期初總 30% → 進料比例 60%、施作 0%、J＝100×50%×60%＝30
// A.2 門：圖面 2、已用 1 → 50% → 進料 100%、施作 0%、J＝1
// A.3 鋁玻璃門：圖面 1、已用 5（超過）→ 100% → 進料 100%、施作 100%、J＝1
const op = ctx.setOpening_(GOLIVE);
ok(op.levels === 3 && op.locs === 5 && op.mats === 3, '期初：3 層級 5 位置、進料期初 3 筆');
ok(op.over.length === 1 && /DW9/.test(op.over[0]), '期初超過圖面列出 DW9（已用 5 > 圖面 1）');
ok(op.detail['A.1'].mat === 60 && op.detail['A.1'].work === 0 && op.detail['A.3'].mat === 100 && op.detail['A.3'].work === 100, '期初拆分：A.1 進料 60%／施作 0%；A.3 進料 100%／施作 100%');
const matA1 = mat.d.find(r => r[0] === 'A.1' && r[5] === '系統（期初推估）');
ok(matA1 && matA1[4] === 60 && fmtDate(matA1[3], 'Asia/Taipei', 'yyyy-MM-dd') === '2026-11-09', '進料期初寫進「進料」表：A.1 到貨 60，日期＝上線日前一天');
ok(daily.get(drow('A.1'), 10) === 30 && daily.get(drow('A.2'), 10) === 1 && daily.get(drow('A.3'), 10) === 1, 'J 欄期初＝網站推估的上線前累計（A.3 以圖面計 1，不是已用 5）');
ok(cur.get(2, 7) === 0 && cur.get(4, 8) === 0 && cur.get(6, 7) === 1 && cur.get(6, 8) === 1, '目前進度只存施作%：C1 0、D1 框 0；DW9 施作 100%');
ok(dval('A.1', '2026-11-10') === '' && dval('A.1', '2026-11-20') === '', '期初後沒有新登記 → 日期欄空白');

// ---------- 3. 登記與重算（施作只佔 50%） ----------
let r = call({ action: 'submit', token: T.tokV, date: '2026-11-12', level: '房間', items: [
  { uuid: 'TEST-U1-0000', id: 'A.1|1F|101', p: 80, old: { p: 0 } },
  { uuid: 'TEST-U2-0000', id: 'A.2|1F|1F-D101', f: 100, s: 0, old: { f: 0, s: 0 } }] });
ok(r.ok && r.saved.length === 2, 'submit 兩筆成功');
ok(Math.abs(dval('A.1', '2026-11-12') - 24) < 1e-9, '11/12 天花板當日 = 60 × 50% × 80% = 24');
ok(Math.abs(dval('A.2', '2026-11-12') - 0.3) < 1e-9, '11/12 門當日 = 1 × 50% × 60%（框）= 0.3');
ok(cur.get(2, 7) === 0.8 && cur.get(4, 7) === 0.6 && cur.get(4, 8) === 1, '目前進度更新（門施作 60%，存 0.6）');
ok(log.d[log.getLastRow() - 1][7] === 0.6 && log.d[log.getLastRow() - 2][7] === 0.8 && log.d[log.getLastRow() - 2][8] === 0, '進度紀錄完成%／舊值存小數');
ok(cur.get(2, 10) === 0, '沒有寫到 J 欄完成量（公式欄）');

r = call({ action: 'submit', token: T.tokV, date: '2026-11-12', items: [{ uuid: 'TEST-U1-0000', id: 'A.1|1F|101', p: 80, old: { p: 0 } }] });
ok(r.dup.length === 1 && log.getLastRow() === 1 + 5 + 2, '同 UUID 重送 → dup，不重複寫入');

r = call({ action: 'submit', token: T.tokV, date: '2026-11-15', items: [{ uuid: 'TEST-U3-0000', id: 'A.1|1F|101', p: 90, old: { p: 70 } }] });
ok(r.conflicts.length === 1 && r.conflicts[0].server[0] === 80, '舊值不同 → 衝突，回傳伺服器值');
r = call({ action: 'submit', token: T.tokV, date: '2026-11-15', force: true, items: [{ uuid: 'TEST-U3-0000', id: 'A.1|1F|101', p: 90, old: { p: 70 } }] });
ok(r.saved.length === 1 && Math.abs(dval('A.1', '2026-11-15') - 3) < 1e-9, 'force 重送成功，11/15 = 60 × 50% × 10% = 3');

r = call({ action: 'submit', token: T.tokV, date: '2026-11-16', items: [{ uuid: 'TEST-U4-0000', id: 'A.1|1F|101', p: 50, old: { p: 90 } }] });
ok(r.rejected.length === 1, '調低沒填原因 → rejected');
r = call({ action: 'submit', token: T.tokV, date: '2026-11-16', reason: '拆除重做', items: [{ uuid: 'TEST-U4-0000', id: 'A.1|1F|101', p: 50, old: { p: 90 } }] });
ok(r.saved.length === 1 && Math.abs(dval('A.1', '2026-11-16') + 12) < 1e-9, '有原因可調低，11/16 = −12（負數照實）');

// 補登較早日期：不改目前進度，但改每日數量
r = call({ action: 'submit', token: T.tokV, date: '2026-11-11', items: [{ uuid: 'TEST-U5-0000', id: 'A.1|1F|102', p: 100, old: { p: 0 } }] });
ok(r.saved.length === 1 && Math.abs(dval('A.1', '2026-11-11') - 20) < 1e-9, '補登 11/11：40 × 50% × 100% = 20');
ok(cur.get(2, 7) === 0.5, '補登較早日期不影響其他位置的目前進度');
ok(r.cur['A.1|1F|102'][0] === 100, 'API 回傳的完成% 仍是 0～100');

ok(call({ action: 'submit', token: T.tokV, date: '2026-11-21', items: [{ uuid: 'TEST-U6-0000', id: 'A.1|1F|101', p: 60 }] }).error === 'bad_request', '未來日期 → 拒絕');
ok(call({ action: 'submit', token: T.tokV, date: '2026-11-09', items: [{ uuid: 'TEST-U7-0000', id: 'A.1|1F|101', p: 60 }] }).error === 'bad_request', '早於上線日 → 拒絕');

// 網站累計 = J + Σ日期欄 ＝ 圖面 × 50% × 進料比例 ＋ Σ 數量 × 50% × 施作%
const sumRow = lv => { let s = Number(daily.get(drow(lv), 10)) || 0; for (let c = 11; c <= W; c++) s += Number(daily.get(drow(lv), c)) || 0; return s; };
ok(Math.abs(sumRow('A.1') - (100 * 0.5 * 0.6 + 0.5 * (60 * 0.5 + 40 * 1))) < 1e-9, '天花板 J＋逐日合計 = 30（進料）＋ 35（施作）= 65');

// ---------- 4. 進料、history ----------
r = call({ action: 'material', token: T.tokV, uuid: 'TEST-M1-0000', lv: 'A.1', date: '2026-11-20', qty: 120 });
ok(r.ok && r.sum === 180, '進料寫入（期初 60＋120）');
ok(Math.abs(dval('A.1', '2026-11-20') - 20) < 1e-9, '進料到貨當天計入：進料比例 60%→100%，11/20 = 100 × 50% × 40% = 20');
r = call({ action: 'material', token: T.tokV, uuid: 'TEST-M1-0000', lv: 'A.1', date: '2026-11-20', qty: 120 });
ok(r.dup && r.sum === 180, '進料 UUID 去重');
call({ action: 'submit', token: T.tokE, date: '2026-11-20', items: [{ uuid: 'TEST-E1-0000', id: 'A.1|1F|102', p: 100, old: { p: 100 } }] });
const hv = call({ action: 'history', token: T.tokV, ids: ['A.1|1F|102'], lv: 'A.1' });
ok(hv.all === true && hv.records.some(x => x.by === 'boss@x.com') && hv.records.some(x => x.by === '王工程師') && hv.materials.some(m => m.by === '王工程師'), '檢視者 history 看得到所有人的紀錄與進料，登記人顯示人員表名稱');
const he = call({ action: 'history', token: T.tokE, ids: ['A.1|1F|102'] });
ok(he.all && he.records.some(x => x.by === 'boss@x.com'), '編輯者看得到所有人');

// ---------- 5. 同步重排 ----------
const snap = ctx.snapshotDaily_();
// 正式版在 A.1 前插入一列新層級，並交換 A.2/A.3
const newMain = new Sheet('施工-實際進度', [main.d[0], main.d[1], main.d[2], main.d[3], mainRow('A.0', '新項目', 'M2', 0), main.d[4], main.d[6], main.d[5]]);
const before = { J: daily.get(drow('A.1'), 10), d12: dval('A.1', '2026-11-12'), door: dval('A.2', '2026-11-12') };
const moved = ctx.realignDaily_(newMain, snap);
ok(moved, '列順序不同 → 重排');
ok(String(daily.get(5, 1)) === 'A.0' && String(daily.get(6, 1)) === 'A.1' && daily.get(6, 10) === before.J && dval('A.1', '2026-11-12') === before.d12, '重排後 A.1 的期初與逐日數量跟著層級移動');
ok(dval('A.2', '2026-11-12') === before.door && drow('A.2') === 8, 'A.2 跟著移到第 8 列');
ok(/G4:G8/.test(daily.f['4,8']) && /K4:[A-Z]+8/.test(daily.f['4,7']), '重寫 E/G/H/I 公式，範圍到最後一列');
ok(!ctx.realignDaily_(newMain, ctx.snapshotDaily_()), '已對齊時不重排');
// ---------- 6. 資安修正 ----------
ok(call({ action: 'bootstrap', token: 'garbage' }).error === 'auth', '非 JWT 格式 token → auth（不對外連線）');
let fetches = 0; const of = ctx.UrlFetchApp.fetch; ctx.UrlFetchApp.fetch = u => { fetches++; return of(u); };
const fake = 'h.' + b64({ aud: 'OTHER', exp: NOW / 1000 + 3600 }) + '.x';
call({ action: 'bootstrap', token: fake }); call({ action: 'bootstrap', token: fake });
ok(fetches === 0, 'aud 不符的 token 在本機就擋下，不對外連線');
ctx.UrlFetchApp.fetch = of;
r = call({ action: 'submit', token: T.tokV, date: '2026-11-20', reason: '=IMPORTXML("http://x","//a")', items: [{ uuid: 'INJ-00001', id: 'A.1|1F|101', p: 10, old: { p: 50 }, note: '+SUM(A1)' }] });
const last = log.d[log.getLastRow() - 1];
ok(r.saved.length === 1 && last[15] === '=IMPORTXML("http://x","//a")' && last[16] === '+SUM(A1)' && FORMULAS.length === 0, '原因／備註以 = + 開頭時存成文字（沒有變公式）');
ok(call({ action: 'submit', token: T.tokV, date: '2026-11-20', items: [{ uuid: '=1+1', id: 'A.1|1F|101', p: 10 }] }).rejected.length === 1, 'UUID 格式錯誤 → rejected');
ok(call({ action: 'submit', token: T.tokV, date: '2026-11-20', items: [{ uuid: 'PROTO-0001', id: 'constructor', p: 10 }] }).rejected.length === 1, '原型鍵位置 ID → rejected');
ok(call({ action: 'material', token: T.tokV, uuid: 'PROTO-0002', lv: '__proto__', date: '2026-11-20', qty: 1 }).error === 'bad_request', '原型鍵層級 → bad_request');
ok(ctx.dateStr_('2026-02-31') === '' && ctx.dateStr_('2026-2-3') === '2026-02-03', '不存在的日期 → 空白');
ok(JSON.parse(ctx.doGet({ parameter: { action: 'bootstrap', token: T.tokV } }).s).error === 'method', 'GET 不接受 token');
ok(JSON.parse(ctx.doPost({ postData: { contents: 'x'.repeat(1024 * 1024 + 1) } }).s).message === '請求太大', '超過 1MB 拒絕');
set.d.push(['權限來源', '人員表', '']); cache.clear();
ok(call({ action: 'bootstrap', token: T.tokV }).user.role === 'viewer', '人員表模式：人員表內的帳號 → viewer');
people.d = [['Google 帳號', '顯示名稱']]; cache.clear();
ok(call({ action: 'bootstrap', token: T.tokV }).error === 'forbidden', '人員表模式：不在人員表 → forbidden（即使是試算表檢視者）');
ok(call({ action: 'bootstrap', token: T.tokE }).user.role === 'editor', '人員表模式：試算表編輯者仍是 editor');
FakeDate.now = () => NOW; let rl = 0; for (let i = 0; i < 70; i++) if (call({ action: 'history', token: T.tokE, ids: [] }).error === 'busy') rl++;
ok(rl > 0, '每分鐘超過 60 次 → busy');

// ---------- 7. 人員表自動填入＋待核准 ----------
FakeDate.now = () => NOW + 120000; cache.clear(); people.cb = 0;
let rx = call({ action: 'bootstrap', token: T.tokX });
ok(rx.error === 'forbidden' && /送出使用申請/.test(rx.message), '未在人員表的人登入 → 自動加入並提示等待核准');
const prow = people.d.find(r => r[0] === 'stranger@x.com');
ok(prow && prow.length === 4 && prow[2].startsWith('網站登入自動加入') && prow[3] === false && people.get(1, 4) === '核准' && people.cb === 1, '人員表新增一列（A 帳號、B 名稱、C 備註、D 核准＝未勾選）並設勾選框');
rx = call({ action: 'bootstrap', token: T.tokX });
ok(/等待管理者核准/.test(rx.message) && /勾選/.test(rx.message) && people.d.filter(r => r[0] === 'stranger@x.com').length === 1, '再次登入不重複加入，訊息提示勾選核准');
prow[3] = '核准'; cache.clear();
ok(call({ action: 'bootstrap', token: T.tokX }).error === 'forbidden', '白名單：核准欄寫文字「核准」不算，只認勾選');
prow[3] = '拒絕'; cache.clear();
ok(call({ action: 'bootstrap', token: T.tokX }).error === 'forbidden', '白名單：其他文字一律不可用');
prow[3] = false; cache.clear();
ok(call({ action: 'bootstrap', token: T.tokX }).error === 'forbidden', '未勾選 → 不可用（同時建立權限快取）');
prow[3] = true;
ok(call({ action: 'bootstrap', token: T.tokX }).error === 'forbidden', '勾選但快取未清 → 仍沿用快取（模擬原本核准後要等的情況）');
ctx.onEdit({ range: new Range(people, 3, 4, 1, 1) });
ok(!cache.has('acl') && !cache.has('people'), '在「人員」表編輯 → onEdit 清除 acl 與 people 快取');
ok(call({ action: 'bootstrap', token: T.tokX }).user.role === 'viewer', '勾選核准後立即可登入');
prow[3] = false; ctx.onEdit({ range: new Range(people, 3, 4, 1, 1) });
ok(call({ action: 'bootstrap', token: T.tokX }).error === 'forbidden', '取消勾選後立即不可用');
call({ action: 'bootstrap', token: T.tokE }); ctx.onEdit({ range: new Range(log, 2, 1, 1, 1) });
ok(cache.has('acl'), '編輯其他表不清權限快取');
ok(/^acl 快取：有；people 快取：有（人員 \d+ 人，核准 \d+ 人）$/.test(ctx.aclCacheStatus()), 'aclCacheStatus 回報快取狀態');
const saveP = people.d.map(r => r.slice());
people.d = [['Google 帳號', '顯示名稱', '負責工項', '備註', '核准'], ['stranger@x.com', '', '', '', true]]; people.maxCols = 5; cache.clear();
ok(call({ action: 'bootstrap', token: T.tokX }).user.role === 'viewer', '核准欄依表頭找：舊版 E 欄「核准」仍讀得到');
people.d = saveP; people.maxCols = 4; cache.clear();

// ---------- 8. 從進度紀錄重建目前進度 ----------
const snap8 = () => cur.d.slice(1).map(r => r.slice(6, 9).concat([r[10]]).map(v => v instanceof Date ? fmtDate(v, 'Asia/Taipei', 'yyyy-MM-dd') : v));
const before8 = snap8();
for (let i = 2; i <= cur.getLastRow(); i++) for (const c of [7, 8, 9, 11, 12, 13]) cur.set(i, c, '');
const nre = ctx.rebuildCurrent_();
const after8 = snap8();
ok(nre === 5 && JSON.stringify(after8) === JSON.stringify(before8), '清空後從進度紀錄重建，目前進度（完成%、框、扇、日期）與原本相同');

// ---------- 9. 重設期初：舊期初列刪除、進料例外 ----------
ctx.CFG.OPENING_MAT_FULL_LVS.push('A.1');
const op2 = ctx.setOpening_(GOLIVE);
const openMats = mat.d.filter(r => r[5] === '系統（期初推估）');
const openLogs = log.d.filter(r => r[12] === '系統（期初推估）');
ok(openMats.length === 3 && openLogs.length === 5, '重設期初先刪舊期初列：進料 3 筆、進度紀錄 5 筆（不重複）');
ok(op2.detail['A.1'].mat === 100 && op2.detail['A.1'].work === 0 && openMats.find(r => r[0] === 'A.1')[4] === 100, '例外層級：期初總 30% 但進料比例＝100%（施作 0%）');
ok(daily.get(drow('A.1'), 10) === 50, '例外層級 J＝100 × 50% × 100% = 50（高於正式版已用 30，差異出現在 I 欄）');
ok(mat.d.some(r => r[0] === 'A.1' && r[4] === 120), '重設期初不影響工程師登記的進料');
// ---------- 10. Fable 第 1 項：讀出再寫回不會讓文字變公式 ----------
FakeDate.now = () => NOW + 600000; cache.clear();
FORMULAS.length = 0;
people.d.push(['eng2@x.com', '=HYPERLINK("http://evil","點我")', '', true]); cache.clear();
const tokE2 = sign({ aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'eng2@x.com', email_verified: true, exp: NOW / 1000 + 3600 });
r = call({ action: 'submit', token: tokE2, date: '2026-11-20', reason: '=TEXTJOIN(",",1,施工!D4:F9)', items: [{ uuid: 'INJ-00010', id: 'A.1|1F|102', p: 5, note: '@x' }] });
ok(r.ok && r.saved.length === 1, '名稱、原因、備註都以 = @ 開頭的登記寫入成功');
r = call({ action: 'material', token: tokE2, uuid: 'INJ-00011', lv: 'A.2', date: '2026-11-20', qty: 1, note: '=1+2' });
ok(r.ok, '進料備註以 = 開頭寫入成功');
call({ action: 'submit', token: T.tokE, date: '2026-11-20', items: [{ uuid: 'INJ-00012', id: 'A.2|1F|1F-D101', f: 100, s: 0 }] });
ok(FORMULAS.length === 0, '其他人登記（目前進度 K～M 整欄重寫）後沒有任何儲存格變成公式');
ctx.setOpening_(GOLIVE);
ok(FORMULAS.length === 0, '重設期初（刪舊期初列）後沒有任何儲存格變成公式');
ctx.rebuildCurrent_();
ok(FORMULAS.length === 0, '從進度紀錄重建目前進度後沒有任何儲存格變成公式');
const injLog = log.d.find(x => x[14] === 'INJ-00010');
const injMat = mat.d.find(x => x[7] === 'INJ-00011');
const injCur = cur.d.find(x => x[5] === 'A.1|1F|102');
ok(injLog && injLog[15] === '=TEXTJOIN(",",1,施工!D4:F9)' && injLog[16] === '@x', '進度紀錄的原因／備註仍是原文字');
ok(injMat && injMat[8] === '=1+2', '進料備註仍是原文字');
ok(injCur && injCur[11] === '=HYPERLINK("http://evil","點我")', '目前進度登記人（顯示名稱）仍是原文字');
const hx = call({ action: 'history', token: tokE2, ids: ['A.1|1F|102'], lv: 'A.1' });
ok(hx.records.some(x => x.reason === '=TEXTJOIN(",",1,施工!D4:F9)'), 'history 回傳原文字，不是公式結果');
ok(ctx.protect_('=x') === "'=x" && ctx.protect_("'=x") === "'=x" && ctx.protect_('-') === "'-" && ctx.protect_(5) === 5 && ctx.protect_('abc') === 'abc', 'protect_：= + - @ 開頭加 \'，已有 \' 不重複');

// ---------- 11. Fable 第 2 項：只有勾選 TRUE 才可用 ----------
const e2row = people.d.find(x => x[0] === 'eng2@x.com');
for (const v of ['TRUE', 'true', 1, '核准', 'v']) { e2row[3] = v; cache.clear(); ok(call({ action: 'bootstrap', token: tokE2 }).error === 'forbidden', '核准欄為 ' + JSON.stringify(v) + '（不是勾選）→ 不可用'); }
e2row[3] = true; cache.clear();
ok(call({ action: 'bootstrap', token: tokE2 }).user.role === 'viewer', '核准欄勾選 TRUE → 可用');

// ---------- 12. 登入憑證在本機驗 RS256 簽章（第三次審查第 2 項） ----------
ok(cacheTtl.get('tok_' + ctx.sha_(tokE2)) === 3600 - 600 - 5, '驗證成功的憑證快取到到期（剩 50 分鐘就快取 50 分鐘），不是 10 分鐘');
FakeDate.now = () => NOW + 1200000; cache.clear();
let jw = 0; const jwReal = ctx.UrlFetchApp.fetch; ctx.UrlFetchApp.fetch = u => { jw++; return jwReal(u); };
const okTok = sign({ aud: 'CID.apps.googleusercontent.com', iss: 'https://accounts.google.com', email: 'eng2@x.com', email_verified: true, exp: NOW / 1000 + 3600 });
ok(call({ action: 'bootstrap', token: okTok }).ok && jw === 1, '正確簽章 → 通過（第一次抓 Google 公開金鑰）');
ok(cacheTtl.get('jwks') === 20000, '公開金鑰快取到 Cache-Control max-age');
const otherTok = sign({ aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'eng@x.com', email_verified: 'true', exp: NOW / 1000 + 3000 });
call({ action: 'bootstrap', token: otherTok });
ok(jw === 1, '之後的憑證用快取的公開金鑰驗，不再對外連線');
const forgedKey = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const fr = []; for (let i = 0; i < 300; i++) fr.push(call({ action: 'bootstrap', token: sign({ aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'f' + i + '@x.com', email_verified: true, exp: NOW / 1000 + 3600 }, 'k1', forgedKey) }));
ok(fr.every(x => x.error === 'auth') && jw === 1, '偽造簽章 300 次 → 全部 auth，而且完全沒有對外連線（不再有全域上限可被拿來擋登入）');
ok(call({ action: 'bootstrap', token: okTok }).ok, '被大量偽造憑證攻擊後，正確的憑證仍可登入');
const parts = okTok.split('.');
const tampered = parts[0] + '.' + b64(Object.assign(JSON.parse(Buffer.from(parts[1], 'base64url')), { email: 'boss@x.com' })) + '.' + parts[2];
ok(call({ action: 'bootstrap', token: tampered }).error === 'auth', '竄改內容（改 email）→ 簽章不符 → auth');
ok(call({ action: 'bootstrap', token: b64({ alg: 'none', kid: 'k1' }) + '.' + parts[1] + '.' }).error === 'auth' &&
   call({ action: 'bootstrap', token: b64({ alg: 'HS256', kid: 'k1' }) + '.' + parts[1] + '.' + parts[2] }).error === 'auth', 'alg 不是 RS256（none、HS256）→ auth');
ok(call({ action: 'bootstrap', token: sign({ aud: 'CID.apps.googleusercontent.com', iss: 'evil.example', email: 'eng2@x.com', email_verified: true, exp: NOW / 1000 + 3600 }) }).error === 'auth', '簽發者不是 Google → auth');
ok(call({ action: 'bootstrap', token: sign({ aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'eng2@x.com', email_verified: false, exp: NOW / 1000 + 3600 }) }).error === 'auth', 'email 未驗證 → auth');
ok(call({ action: 'bootstrap', token: sign({ aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'eng2@x.com', email_verified: true, exp: NOW / 1000 - 10 }) }).error === 'auth', '已過期 → auth');
// Google 換金鑰：新 kid 第一次出現時重抓一次；亂數 kid 不會一直重抓
JWKS_KIDS = ['k1', 'k2'];
const k2Tok = sign({ aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'eng2@x.com', email_verified: true, exp: NOW / 1000 + 3500 }, 'k2');
const jwBefore = jw;
ok(call({ action: 'bootstrap', token: k2Tok }).ok && jw === jwBefore + 1, 'Google 換新金鑰（新 kid）→ 重抓一次公開金鑰後通過');
for (let i = 0; i < 50; i++) call({ action: 'bootstrap', token: sign({ aud: 'CID.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'r' + i + '@x.com', email_verified: true, exp: NOW / 1000 + 3600 }, 'rand' + i, forgedKey) });
ok(jw === jwBefore + 1, '帶亂數 kid 的偽造憑證 50 次 → 10 分鐘內不再重抓公開金鑰');
ok(ctx.rs256Verify_(ctx.JWT_SELFTEST.signed, ctx.JWT_SELFTEST.sig, ctx.JWT_SELFTEST.jwk) === true && ctx.rs256Verify_(ctx.JWT_SELFTEST.signed + 'x', ctx.JWT_SELFTEST.sig, ctx.JWT_SELFTEST.jwk) === false, 'jwtSelfTest 的固定測試向量：正確為 true、竄改為 false');
ctx.UrlFetchApp.fetch = jwReal;

// ---------- 13. Fable 第 4 項：未授權者先限流；名額滿訊息正確 ----------
FakeDate.now = () => NOW + 1500000; cache.clear();
let busyX = 0; for (let i = 0; i < 65; i++) if (call({ action: 'bootstrap', token: T.tokX }).error === 'busy') busyX++;
ok(busyX > 0, '未授權者每分鐘超過 60 次也會被限流');
FakeDate.now = () => NOW + 1800000; cache.clear();
ctx.MAX_PENDING = 1;
const nPeople = people.d.length;
const rf = call({ action: 'bootstrap', token: T.tokY });
ok(rf.error === 'forbidden' && /名額已滿/.test(rf.message) && !/等待/.test(rf.message) && people.d.length === nPeople, '待核准名額滿：不加入人員表，訊息說名額已滿（不是等待核准）');
let locks = 0; const realLock = ctx.LockService.getScriptLock; ctx.LockService.getScriptLock = () => { locks++; return realLock(); };
ok(/名額已滿/.test(call({ action: 'bootstrap', token: T.tokY }).message) && locks === 0, '名額滿後同一帳號短時間內直接回覆，不再搶鎖');
ctx.LockService.getScriptLock = () => ({ tryLock: () => false, waitLock() {}, releaseLock() {} });
ok(call({ action: 'bootstrap', token: T.tokZ }).error === 'busy', '搶不到鎖 → busy（不謊稱等待核准）');
ctx.LockService.getScriptLock = realLock; ctx.MAX_PENDING = 200;

// ---------- 14. Fable 第 5 項：進料輸入驗證 ----------
FakeDate.now = () => NOW + 2400000; cache.clear();
const mcall = (o) => call(Object.assign({ action: 'material', token: tokE2, date: '2026-11-20' }, o));
ok(/上線日/.test(mcall({ uuid: 'MAT5-00001', lv: 'A.1', qty: 1, date: '2026-11-09' }).message), '進料日期早於上線日 → 拒絕');
ok(/不能超過 200/.test(mcall({ uuid: 'MAT5-00002', lv: 'A.1', qty: 201 }).message), '單筆超過圖面合計 2 倍（100 × 2）→ 拒絕');
ok(/備註/.test(mcall({ uuid: 'MAT5-00003', lv: 'A.1', qty: -5 }).message), '負數進料沒寫備註 → 拒絕');
const sumA3 = Number(ctx.materialSummary_()['A.3'].sum);
ok(/小於 0/.test(mcall({ uuid: 'MAT5-00004', lv: 'A.3', qty: -(sumA3 + 0.5), note: '更正' }).message), '登記後進料累計小於 0 → 拒絕');
ok(mcall({ uuid: 'MAT5-00005', lv: 'A.1', qty: -1, note: '退料 1' }).ok, '負數進料有備註、累計不小於 0 → 可登記');
ok(mcall({ uuid: 'MAT5-00006', lv: 'x'.repeat(500), qty: 1 }).message.length < 80, '找不到層級的錯誤訊息會截斷，不回顯長字串');
let matBusy = 0; for (let i = 0; i < 12; i++) if (mcall({ uuid: 'MAT5-1' + String(i).padStart(4, '0'), lv: 'A.2', qty: 0.1 }).error === 'busy') matBusy++;
ok(matBusy >= 2, '進料每個帳號每分鐘最多 10 筆（這分鐘已用 1 筆，第 11、12 筆 busy）');

// ---------- 15. Fable 第 6 項：正式版只讀 ----------
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'appsscript.json'), 'utf8'));
ok(!manifest.oauthScopes.some(x => /\/auth\/(spreadsheets|drive|drive\.file)$/.test(x)) && manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly') && manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.currentonly'),
  '權限範圍：只有 spreadsheets.currentonly（本試算表）＋ spreadsheets.readonly（其他只讀），沒有可編輯所有試算表／雲端硬碟的範圍');
const allSrc = fs.readdirSync(DIR).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
ok(!/openById\(/.test(allSrc) && !/\.copyTo\(/.test(allSrc) && !/Sheets\.Spreadsheets\.(batchUpdate|create)|Values\.(update|append|clear|batchUpdate|batchClear)/.test(allSrc),
  '程式沒有 openById、copyTo，Sheets API 只用 get（沒有任何寫入呼叫）');
ok(manifest.dependencies.enabledAdvancedServices.some(x => x.serviceId === 'sheets'), '啟用 Sheets 進階服務（唯讀權限讀正式版）');
const official = main.d.map(r => r.slice());
official[5][6] = 77;
const toSerial = v => v instanceof Date ? (v.getTime() + 8 * 3600000) / 86400000 + 25569 : v;
const sheetsCalls = [];
ctx.Sheets = {
  Spreadsheets: new Proxy({
    get: (id, o) => { sheetsCalls.push('get ' + id); return { sheets: [{ properties: { title: ctx.CFG.OFFICIAL_SHEET, gridProperties: { rowCount: official.length, columnCount: W, frozenRowCount: 3, frozenColumnCount: 9 } } }] }; },
    Values: new Proxy({ get: (id, range, o) => { sheetsCalls.push('values.get ' + id + ' ' + range + ' ' + o.valueRenderOption); return { values: official.map(r => r.map(toSerial)) }; } },
      { get(t, k) { if (k in t) return t[k]; return () => { sheetsCalls.push('WRITE ' + String(k)); throw new Error('寫入正式版'); }; } })
  }, { get(t, k) { if (k in t) return t[k]; return () => { sheetsCalls.push('WRITE ' + String(k)); throw new Error('寫入正式版'); }; } })
};
const syncR = ctx.syncFromOfficial();
ok(syncR.ok && sheetsCalls.length === 2 && sheetsCalls.every(x => !x.startsWith('WRITE') && x.includes(ctx.CFG.OFFICIAL_ID)) && sheetsCalls[1].includes('UNFORMATTED_VALUE'),
  '同步主表：只對正式版呼叫 spreadsheets.get 與 values.get');
ok(main.get(6, 7) === 77 && JSON.stringify(main.d.slice(4, 7).map(r => r.slice(0, 6))) === JSON.stringify(official.slice(4, 7).map(r => r.slice(0, 6))), '同步後主表數值＝正式版');
const hdrOk = dates.every((d, i) => ctx.dateStr_(main.get(3, 11 + i)) === fmtDate(d, 'Asia/Taipei', 'yyyy-MM-dd'));
ok(hdrOk, '表頭日期由序號轉回日期，與正式版同一天');
const offHdr = official[2].slice();
official[2][6] = '複價'; official[2][5] = '使用數量';
const mainBefore = JSON.stringify(main.d);
let syncErr = ''; try { ctx.syncFromOfficial(); } catch (e) { syncErr = String(e.message); }
ok(/欄位與預期不同/.test(syncErr) && /G 欄是「複價」/.test(syncErr) && JSON.stringify(main.d) === mainBefore, '正式版欄位變動（使用數量與複價對調）→ 停止同步，主表不改');
official[2] = offHdr;
main.set(3, 7, '複價');
cache.clear();
const bsH = call({ action: 'bootstrap', token: tokE2 });
ok(bsH.ok && bsH.items.every(it => it[7] == null), '主表 G 欄表頭不是「使用數量」→ bootstrap 不回傳正式版使用數量（不會把複價送到網頁）');
main.set(3, 7, '使用數量');

// ---------- 16. 正式版 ≥ 50% 自動補進料 ----------
FakeDate.now = () => NOW + 3000000; cache.clear();
const lvRow = lv => main.d.findIndex(r => String(r[0]).trim() === lv) + 1;
const setUsed = (lv, v) => main.set(lvRow(lv), 7, v);
const autoRows = () => mat.d.filter(r => r[5] === ctx.CFG.AUTO_MAT_BY);
const matSum = lv => Number((ctx.materialSummary_()[lv] || { sum: 0 }).sum);
mat.d = mat.d.filter(r => !['A.1', 'A.2', 'A.3'].includes(String(r[0]))); // 測試用：清掉這三個代號的進料
['A.1', 'A.2', 'A.3'].forEach(lv => setUsed(lv, 0));
setUsed('A.2', 0.99);
let am = ctx.autoMaterialFromOfficial_(main);
ok(am.added.length === 0 && autoRows().length === 0, '正式版 49.5%（未達 50%）→ 不補');
setUsed('A.2', 1);
am = ctx.autoMaterialFromOfficial_(main);
const ar = autoRows();
ok(am.added.length === 1 && am.added[0].code === 'D1' && am.added[0].qty === 2 && am.added[0].ratio === 50 && ar.length === 1 && ar[0][4] === 2 && matSum('A.2') === 2,
  '正式版剛好 50% → 自動補進料到圖面合計（D1 補 2）');
ok(fmtDate(ar[0][3], 'Asia/Taipei', 'yyyy-MM-dd') === '2026-11-20' && /= 50%/.test(ar[0][8]) && /≥ 50%/.test(ar[0][8]), '補的那筆日期＝同步當天、備註寫正式版使用數量與比例');
am = ctx.autoMaterialFromOfficial_(main);
ok(am.added.length === 0 && autoRows().length === 1, '重跑不重複補（已補滿）');
setUsed('A.2', 0);
am = ctx.autoMaterialFromOfficial_(main);
ok(am.added.length === 0 && matSum('A.2') === 2, '正式版降回 0 → 不扣回');
setUsed('A.3', 5);
am = ctx.autoMaterialFromOfficial_(main);
ok(am.added.length === 1 && am.added[0].code === 'DW9' && am.added[0].qty === 1 && am.added[0].ratio === 500 && matSum('A.3') === 1, '正式版超過圖面（500%）→ 補到圖面合計，不超過');
mat.d.push(['A.1', '天花板', 'M2', tw('2026-11-20'), 30, 'eng@x.com', new FakeDate(), 'AUTO-T-0001', '']);
const realRecalc = ctx.recalcLevels_; let recalced = []; ctx.recalcLevels_ = lv => { recalced = recalced.concat(lv); return realRecalc(lv); };
setUsed('A.1', 60);
am = ctx.autoMaterialFromOfficial_(main);
ok(am.added.length === 1 && am.added[0].qty === 70 && matSum('A.1') === 100 && mat.d.some(r => r[7] === 'AUTO-T-0001' && r[4] === 30), '已有部分進料（30）→ 只補差額 70，工程師的進料不動');
ctx.recalcLevels_ = realRecalc;
ok(JSON.stringify(recalced) === JSON.stringify(['A.1']), '補進料後立即重算該代號的每日數量');
['A.1', 'A.2', 'A.3'].forEach(lv => setUsed(lv, 99));
mat.d = mat.d.filter(r => r[0] !== 'A.2');
main.set(3, 7, '複價');
am = ctx.autoMaterialFromOfficial_(main);
ok(am.added.length === 0 && /表頭/.test(am.skipped), '主表 G 欄表頭不是「使用數量」（正式版欄位變動）→ 整個略過');
main.set(3, 7, '使用數量');
const offA2 = official.findIndex(r => String(r[0]).trim() === 'A.2');
official[offA2][6] = 2;
const syncAuto = ctx.syncFromOfficial();
ok(syncAuto.autoMat && syncAuto.autoMat.added.some(x => x.lv === 'A.2' && x.qty === 2), '從正式版同步主表時一併自動補進料（每日同步與選單同步共用）');
ok(!ctx.CFG.AUTO_MAT_BY.includes('@'), '自動補的登記人不是 email，工程師登記（登記人一律是驗證過的 email）無法偽造');

console.log('\n全部通過');

