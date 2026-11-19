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
  setFrozenRows() {} setFrozenColumns() {} getFrozenRows() { return 3; } getFrozenColumns() { return 9; }
  get(r, c) { const row = this.d[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  set(r, c, v) { while (this.d.length < r) this.d.push([]); this.d[r - 1][c - 1] = v; if (c > this.maxCols) this.maxCols = c; }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); o.push(row); } return o; }
  setValues(v) {
    assert.strictEqual(v.length, this.nr, 'setValues rows ' + this.sh.name); v.forEach((row, i) => { assert.strictEqual(row.length, this.nc, 'setValues cols ' + this.sh.name);
      row.forEach((x, j) => {
        // 模擬試算表把 yyyy-MM-dd 文字轉成日期
        if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) x = tw(x);
        this.sh.set(this.r + i, this.c + j, x);
      }); }); return this;
  }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  getValue() { return this.sh.get(this.r, this.c); }
  setFormula(f) { this.sh.f[this.r + ',' + this.c] = f; return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
  clear() { return this.clearContent(); }
  setNumberFormat() { return this; } setBackground() { return this; }
  copyTo(dest) { const v = this.getValues(); new Range(dest.sh, dest.r, dest.c, v.length, v[0].length).setValues(v); }
}
function makeSS(sheets) {
  const ss = { sheets, getId: () => 'SS', getSheetByName: n => sheets.find(s => s.name === n) || null,
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1), insertSheet: n => { const s = new Sheet(n, [[]]); sheets.push(s); return s; },
    toast: () => {}, setActiveSheet() {}, moveActiveSheet() {} };
  return ss;
}
const cache = new Map();
const CacheMock = { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), putAll: m => Object.keys(m).forEach(k => cache.set(k, m[k])),
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
const people = new Sheet('人員', [['Google 帳號', '顯示名稱'], ['eng@x.com', '王工程師']]);
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
  tokBadAud: { aud: 'OTHER', iss: 'accounts.google.com', email: 'eng@x.com', email_verified: 'true', exp: String(NOW / 1000 + 3600) } };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokens = {}; const T = {};
Object.keys(tokensRaw).forEach(k => { const jwt = 'h.' + b64(tokensRaw[k]) + '.sig_' + k; tokens[jwt] = tokensRaw[k]; T[k] = jwt; });
const ctx = {
  console, JSON, Math, Object, Array, String, Number, Error, isFinite, isNaN, encodeURIComponent, Date: FakeDate,
  SpreadsheetApp: { getActiveSpreadsheet: () => SS, openById: () => { throw new Error('測試中不應開啟正式版'); }, flush() {}, getUi() { throw new Error('no ui'); }, CopyPasteType: { PASTE_NORMAL: 1 } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  CacheService: CacheMock,
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  Utilities: { formatDate: fmtDate, base64DecodeWebSafe: x => Array.from(Buffer.from(x.replace(/=+$/,''), 'base64url')), newBlob: a => ({ getDataAsString: () => Buffer.from(a).toString('utf8') }), getUuid: () => 'u-' + Math.random().toString(36).slice(2), computeDigest: (a, s) => Array.from(require('crypto').createHash('sha256').update(s).digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 } },
  UrlFetchApp: { fetch: url => { const t = decodeURIComponent(url.split('id_token=')[1]); const info = tokens[t]; return { getResponseCode: () => info ? 200 : 400, getContentText: () => JSON.stringify(info || {}) }; } },
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
ok(hv.records.some(x => x.p === 100) && hv.records.every(x => x.by === 'eng@x.com' || x.by === '系統（期初推估）') && !hv.all, '檢視者 history 只看到自己與期初');
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
ok(call({ action: 'bootstrap', token: 'garbage' }).error === 'auth', '非 JWT 格式 token → auth（不打 tokeninfo）');
let fetches = 0; const of = ctx.UrlFetchApp.fetch; ctx.UrlFetchApp.fetch = u => { fetches++; return of(u); };
const fake = 'h.' + b64({ aud: 'OTHER', exp: NOW / 1000 + 3600 }) + '.x';
call({ action: 'bootstrap', token: fake }); call({ action: 'bootstrap', token: fake });
ok(fetches === 0, 'aud 不符的 token 在本機就擋下，負快取');
ctx.UrlFetchApp.fetch = of;
r = call({ action: 'submit', token: T.tokV, date: '2026-11-20', reason: '=IMPORTXML("http://x","//a")', items: [{ uuid: 'INJ-00001', id: 'A.1|1F|101', p: 10, old: { p: 50 }, note: '+SUM(A1)' }] });
const last = log.d[log.getLastRow() - 1];
ok(r.saved.length === 1 && last[15].startsWith("'=") && last[16].startsWith("'+"), '原因／備註以 = + 開頭時存成文字');
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
FakeDate.now = () => NOW + 120000; cache.clear();
let rx = call({ action: 'bootstrap', token: T.tokX });
ok(rx.error === 'forbidden' && /送出使用申請/.test(rx.message), '未在人員表的人登入 → 自動加入並提示等待核准');
const prow = people.d.find(r => r[0] === 'stranger@x.com');
ok(prow && prow[4] === '待核准' && people.get(1, 5) === '狀態', '人員表新增一列，狀態「待核准」，E1 補上表頭');
rx = call({ action: 'bootstrap', token: T.tokX });
ok(/核准中/.test(rx.message) && people.d.filter(r => r[0] === 'stranger@x.com').length === 1, '再次登入不重複加入');
prow[4] = '核准'; cache.clear();
ok(call({ action: 'bootstrap', token: T.tokX }).user.role === 'viewer', '狀態改成「核准」後可登入');
prow[4] = '停用'; cache.clear();
ok(/停用/.test(call({ action: 'bootstrap', token: T.tokX }).message), '狀態「停用」→ 不能登入');

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
console.log('\n全部通過');
