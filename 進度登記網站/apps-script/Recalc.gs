/**
 * 重算「網站每日數量」與設定期初
 *
 * 規則（規劃稿第 3 節）：
 *   位置完成量 = 圖面數量 × 完成%
 *   累計(D)    = 每個位置取「施工日期 ≤ D 的最新一筆」（同一天以時間戳較晚者為準），沒有紀錄算 0
 *   當日完成量 = 累計(D) − 累計(前一個日期欄)；上線日那一欄減的是「上線日前一天」的累計（＝期初推估）
 *   只寫上線日之後（含）的日期欄；E～I 欄是公式，不寫。J 欄期初只由「設定期初」寫入。
 */

/** 讀「網站每日數量」表頭日期與層級列對照 */
function dailyLayout_() {
  var sh = sheet_(CFG.SH.DAILY);
  var lastCol = sh.getLastColumn();
  var lastRow = sh.getLastRow();
  var hdr = sh.getRange(CFG.HEADER_ROWS, CFG.COL_FIRST_DATE, 1, Math.max(lastCol - CFG.COL_FIRST_DATE + 1, 1)).getValues()[0];
  var dates = hdr.map(dateStr_);
  while (dates.length && !dates[dates.length - 1]) dates.pop();
  var rowOf = {};
  if (lastRow > CFG.HEADER_ROWS) {
    sh.getRange(CFG.HEADER_ROWS + 1, 1, lastRow - CFG.HEADER_ROWS, 1).getValues().forEach(function (r, i) {
      var lv = trim_(r[0]);
      if (lv && rowOf[lv] == null) rowOf[lv] = CFG.HEADER_ROWS + 1 + i;
    });
  }
  return { sh: sh, dates: dates, rowOf: rowOf };
}

/** 依層級分組讀取「進度紀錄」：{ 層級: { 位置ID: [{d, t, p}] (已排序) } } */
function loadLogsByLevel_(levels) {
  var want = {};
  levels.forEach(function (lv) { want[lv] = 1; });
  var sh = sheet_(CFG.SH.LOG);
  var n = sh.getLastRow() - 1;
  var out = {};
  if (n <= 0) return out;
  var v = sh.getRange(2, 1, n, LOG_COL.TS).getValues();
  v.forEach(function (r, i) {
    var lv = trim_(r[LOG_COL.LV - 1]);
    if (!want[lv]) return;
    var id = trim_(r[LOG_COL.ID - 1]);
    var d = dateStr_(r[LOG_COL.DATE - 1]);
    if (!id || !d) return;
    var ts = r[LOG_COL.TS - 1];
    var t = ts instanceof Date ? ts.getTime() : i; // 沒有時間戳時以列序代替
    var g = out[lv] || (out[lv] = {});
    (g[id] || (g[id] = [])).push({ d: d, t: t, i: i, p: fromFrac_(r[LOG_COL.PCT - 1]) });
  });
  Object.keys(out).forEach(function (lv) {
    Object.keys(out[lv]).forEach(function (id) {
      out[lv][id].sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t - b.t) || (a.i - b.i); });
    });
  });
  return out;
}

/** 重算指定層級的逐日完成量，寫到「網站每日數量」 */
function recalcLevels_(levels) {
  var goLive = goLive_();
  if (!goLive || !levels.length) return { skipped: goLive ? 0 : '尚未設定上線日', levels: 0 };
  var today = todayStr_();
  var lay = dailyLayout_();
  var startIdx = -1;
  for (var k = 0; k < lay.dates.length; k++) { if (lay.dates[k] && lay.dates[k] >= goLive) { startIdx = k; break; } }
  if (startIdx < 0) return { skipped: '「網站每日數量」沒有上線日之後的日期欄', levels: 0 };
  var cols = lay.dates.slice(startIdx);

  var L = loadLocations_();
  var locsByLv = {};
  L.locs.forEach(function (l) { (locsByLv[l.lv] || (locsByLv[l.lv] = [])).push(l); });
  var logs = loadLogsByLevel_(levels);
  var base = addDays_(goLive, -1);
  var done = 0, missing = [];

  levels.forEach(function (lv) {
    var row = lay.rowOf[lv];
    if (!row) { missing.push(lv); return; }
    var locs = locsByLv[lv] || [];
    var g = logs[lv] || {};
    // 每個位置一個指標，隨日期前進
    var st = locs.map(function (l) { return { q: l.q, recs: g[l.id] || [], k: -1 }; });
    var cumAt = function (D) {
      var s = 0;
      st.forEach(function (x) {
        while (x.k + 1 < x.recs.length && x.recs[x.k + 1].d <= D) x.k++;
        if (x.k >= 0) s += x.q * x.recs[x.k].p / 100;
      });
      return s;
    };
    var prev = cumAt(base);
    var out = cols.map(function (D) {
      if (!D || D > today) return '';
      var c = cumAt(D);
      var v = round_(c - prev, 3);
      prev = c;
      return v === 0 ? '' : v;
    });
    lay.sh.getRange(row, CFG.COL_FIRST_DATE + startIdx, 1, out.length).setValues([out]);
    done++;
  });
  return { levels: done, missing: missing };
}

/** 所有網站管理的層級 */
function managedLevels_() {
  return loadLocations_().items.map(function (it) { return it.lv; });
}

function recalcAll_() {
  clearLocCache_();
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    return recalcLevels_(managedLevels_());
  } finally { lock.releaseLock(); }
}

/** 選單：全部重算 */
function menuRecalcAll() {
  var r = recalcAll_();
  if (r.skipped) return alert_('沒有重算：' + r.skipped);
  alert_('已重算 ' + r.levels + ' 個層級的每日完成量。' + (r.missing && r.missing.length ? '\n「網站每日數量」找不到：' + r.missing.join('、') : ''));
}

/**
 * 選單：設定期初
 * 期初 = 上線日之前正式版的使用數量（本表主表中，日期 < 上線日的日期欄合計）。
 * 期初% = 期初 ÷ 圖面合計（上限 100%），平均設到該層級每個位置，施工日期記為上線日前一天、登記人「系統（期初推估）」。
 * J 欄寫期初數量（不設上限），所以上線當天「網站累計」＝正式版使用數量。
 */
function menuSetOpening() {
  var goLive = goLive_();
  if (!goLive) return alert_('請先在「設定」表填「上線日」。');
  var ui = ui_();
  var logSh = sheet_(CFG.SH.LOG);
  var already = false;
  if (logSh.getLastRow() > 1) {
    already = logSh.getRange(2, LOG_COL.LEVEL, logSh.getLastRow() - 1, 1).getValues()
      .some(function (r) { return r[0] === CFG.OPENING_LEVEL; });
  }
  if (ui) {
    var msg = '以上線日 ' + goLive + ' 前正式版的使用數量設定期初。\n' +
      (already ? '⚠ 已經設定過期初；再設一次會新增一批期初紀錄（取代舊的期初），工程師已登記的不受影響。\n' : '') + '要繼續嗎？';
    if (ui.alert('設定期初', msg, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  }
  var r = setOpening_(goLive);
  alert_('已設定 ' + r.levels + ' 個層級、' + r.locs + ' 個位置的期初。' +
    (r.over.length ? '\n\n上線前使用數量超過圖面合計（期初以 100% 計）：\n' + r.over.join('\n') : '') +
    (r.missing.length ? '\n\n主表找不到：' + r.missing.join('、') : ''));
}

function setOpening_(goLive) {
  clearLocCache_();
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var L = loadLocations_();
    var main = sheet_(CFG.SH.MAIN);
    var lastCol = main.getLastColumn();
    var nRows = main.getLastRow() - CFG.HEADER_ROWS;
    var hdr = main.getRange(CFG.HEADER_ROWS, CFG.COL_FIRST_DATE, 1, lastCol - CFG.COL_FIRST_DATE + 1).getValues()[0].map(dateStr_);
    var body = main.getRange(CFG.HEADER_ROWS + 1, 1, nRows, lastCol).getValues();
    var usedBefore = {};
    body.forEach(function (r) {
      var lv = trim_(r[0]);
      if (!lv || !L.itemByLv[lv] || usedBefore[lv] != null) return;
      var s = 0;
      for (var j = 0; j < hdr.length; j++) {
        if (hdr[j] && hdr[j] < goLive) s += num_(r[CFG.COL_FIRST_DATE - 1 + j]);
      }
      usedBefore[lv] = round_(s, 4);
    });

    var locsByLv = {};
    L.locs.forEach(function (l) { (locsByLv[l.lv] || (locsByLv[l.lv] = [])).push(l); });
    var cur = loadCurrent_();
    var day = addDays_(goLive, -1);
    var now = new Date();
    var rows = [], over = [], missing = [], nLv = 0;
    var lay = dailyLayout_();
    var openingWrites = [];

    L.items.forEach(function (it) {
      if (usedBefore[it.lv] == null) { missing.push(it.lv); return; }
      var locs = locsByLv[it.lv] || [];
      var total = locs.reduce(function (s, l) { return s + l.q; }, 0);
      var used = usedBefore[it.lv];
      var pct = total > 0 ? round_(Math.min(100, Math.max(0, used / total * 100)), 2) : 0;
      if (used > total * 1.0001) over.push(it.code + '（' + it.lv + '）已用 ' + used + '／圖面 ' + round_(total, 2));
      locs.forEach(function (l) {
        var tag = l.kind === '單樘' ? it.tag : null;
        var c = cur.byId[l.id] || { p: '', f: '', s: '', d: '', by: '' };
        rows.push([it.lv, it.name, it.unit, l.fl, l.rid, l.id, tag ? tag[0][0] + ' ' + pct + '%／' + tag[1][0] + ' ' + pct + '%' : '期初推估',
          toFrac_(pct), toFrac_(c.p), round_(l.q * pct / 100, 4), day, CFG.OPENING_LEVEL, CFG.OPENING_BY, now, Utilities.getUuid(),
          '期初% = 上線前正式版使用數量 ' + used + ' ÷ 圖面合計 ' + round_(total, 4), '']);
        // 目前進度：還沒有上線後的登記才改成期初
        if (!c.d || c.d < goLive) {
          cur.byId[l.id] = { row: c.row, p: pct, f: tag ? pct : '', s: tag ? pct : '', d: day, by: CFG.OPENING_BY, ts: now };
        }
      });
      var row = lay.rowOf[it.lv];
      if (row) openingWrites.push([row, used]);
      nLv++;
    });

    if (rows.length) {
      logSh_append_(rows);
      writeCurrent_(cur, L);
    }
    openingWrites.forEach(function (w) { lay.sh.getRange(w[0], CFG.COL_OPENING).setValue(w[1]); });
    SpreadsheetApp.flush();
    recalcLevels_(L.items.map(function (it) { return it.lv; }));
    return { levels: nLv, locs: rows.length, over: over, missing: missing };
  } finally { lock.releaseLock(); }
}

function logSh_append_(rows) {
  var sh = sheet_(CFG.SH.LOG);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_WIDTH).setValues(rows);
}

/**
 * 從「進度紀錄」重建「目前進度」：每個位置取施工日期最新（同日以時間戳較晚）的一筆；沒有紀錄的位置清空。
 * 用在手動刪改「進度紀錄」之後（例如清掉測試登記）。不寫 J 欄公式。
 */
function rebuildCurrent_() {
  clearLocCache_();
  var L = loadLocations_();
  var cur = loadCurrent_();
  var sh = sheet_(CFG.SH.LOG);
  var n = sh.getLastRow() - 1;
  var latest = Object.create(null);
  if (n > 0) {
    sh.getRange(2, 1, n, LOG_WIDTH).getValues().forEach(function (r, i) {
      var id = trim_(r[LOG_COL.ID - 1]);
      var d = dateStr_(r[LOG_COL.DATE - 1]);
      if (!id || !d) return;
      var ts = r[LOG_COL.TS - 1];
      var t = ts instanceof Date ? ts.getTime() : 0;
      var o = latest[id];
      if (!o || d > o.d || (d === o.d && (t > o.t || (t === o.t && i > o.i)))) latest[id] = { d: d, t: t, i: i, r: r };
    });
  }
  var people = peopleMap_();
  var count = 0;
  Object.keys(cur.byId).forEach(function (id) {
    var c = cur.byId[id], o = latest[id], loc = L.byId[id];
    if (!o) { cur.byId[id] = { row: c.row, p: '', f: '', s: '', d: '', by: '', ts: '' }; return; }
    var r = o.r, p = fromFrac_(r[LOG_COL.PCT - 1]), f = '', s = '';
    if (loc && loc.tag) {
      var m = String(r[LOG_COL.DETAIL - 1]).match(/([\d.]+)%[^\d]*([\d.]+)%/);
      f = m ? Number(m[1]) : p; s = m ? Number(m[2]) : p;
    }
    var by = String(r[LOG_COL.BY - 1]);
    var pp = people[by.toLowerCase()];
    cur.byId[id] = { row: c.row, p: p, f: f, s: s, d: o.d, by: (pp && pp.name) || by, ts: r[LOG_COL.TS - 1] };
    count++;
  });
  writeCurrent_(cur, L);
  return count;
}

/** 選單：從進度紀錄重建目前進度 */
function menuRebuildCurrent() {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var n = rebuildCurrent_();
    alert_('已從「進度紀錄」重建「目前進度」：' + n + ' 個位置有登記，其餘清空。');
  } finally { lock.releaseLock(); }
}
