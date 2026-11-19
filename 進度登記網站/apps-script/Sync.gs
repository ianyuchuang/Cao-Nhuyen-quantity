/**
 * 從正式版同步主表「施工-實際進度」（只讀正式版）
 *
 * 做法：把正式版「施工-實際進度 (修訂2版)」整張複製成本試算表的暫存工作表（copyTo 只寫入目的地，不會改動正式版），
 * 再把暫存表整個範圍（值、公式、格式）貼到本表主表，最後刪掉暫存表。
 * 主表工作表本身不刪除，其他工作表對它的參照不會失效。
 * 接著：
 *   1. 主表中網站管理的層級 A～C 標淺藍；
 *   2. 「網站每日數量」若列順序或日期欄與主表不同，依層級重排（J 期初與逐日數量跟著層級走）；
 *   3. 重寫「網站每日數量」E、G、H、I 欄的公式（主表列數改變時範圍跟著調整）。
 */
function syncFromOfficial() {
  var lock = LockService.getScriptLock();
  lock.waitLock(120000);
  var ss = ss_(), tmp = null;
  try {
    var src = SpreadsheetApp.openById(CFG.OFFICIAL_ID).getSheetByName(CFG.OFFICIAL_SHEET);
    if (!src) throw new Error('正式版找不到工作表「' + CFG.OFFICIAL_SHEET + '」');

    var snap = snapshotDaily_();             // 先記下網站每日數量（依層級）
    tmp = src.copyTo(ss);                    // 只寫入本試算表
    tmp.setName('_同步暫存_' + Date.now());
    var main = ss.getSheetByName(CFG.SH.MAIN) || ss.insertSheet(CFG.SH.MAIN, 0);
    var R = tmp.getMaxRows(), C = tmp.getMaxColumns();
    if (main.getMaxRows() < R) main.insertRowsAfter(main.getMaxRows(), R - main.getMaxRows());
    if (main.getMaxRows() > R) main.deleteRows(R + 1, main.getMaxRows() - R);
    if (main.getMaxColumns() < C) main.insertColumnsAfter(main.getMaxColumns(), C - main.getMaxColumns());
    if (main.getMaxColumns() > C) main.deleteColumns(C + 1, main.getMaxColumns() - C);
    main.getRange(1, 1, R, C).clear();
    tmp.getRange(1, 1, R, C).copyTo(main.getRange(1, 1), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    main.setFrozenRows(src.getFrozenRows());
    main.setFrozenColumns(src.getFrozenColumns());
    ss.deleteSheet(tmp);
    tmp = null;
    SpreadsheetApp.flush();

    highlightManaged_(main);
    var moved = realignDaily_(main, snap);
    PropertiesService.getScriptProperties().setProperty('LAST_SYNC', new Date().toISOString());
    toast_('已從正式版同步主表' + (moved ? '，並重排「網站每日數量」' : '') + '。');
    return { ok: true, realigned: moved };
  } finally {
    if (tmp) { try { ss.deleteSheet(tmp); } catch (e) { /* 忽略 */ } }
    lock.releaseLock();
  }
}

/** 網站每日數量：{ 層級: { J: 期初, d: {yyyy-MM-dd: 數量} } } */
function snapshotDaily_() {
  var sh = sheet_(CFG.SH.DAILY);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var out = { order: [], dates: [], byLv: {} };
  if (lastRow <= CFG.HEADER_ROWS) return out;
  out.dates = sh.getRange(CFG.HEADER_ROWS, CFG.COL_FIRST_DATE, 1, lastCol - CFG.COL_FIRST_DATE + 1).getValues()[0].map(dateStr_);
  var a = sh.getRange(CFG.HEADER_ROWS + 1, 1, lastRow - CFG.HEADER_ROWS, 1).getValues();
  var body = sh.getRange(CFG.HEADER_ROWS + 1, CFG.COL_OPENING, lastRow - CFG.HEADER_ROWS, lastCol - CFG.COL_OPENING + 1).getValues();
  a.forEach(function (r, i) {
    var lv = trim_(r[0]);
    out.order.push(lv);
    if (!lv || out.byLv[lv]) return;
    var row = body[i], d = {}, any = row[0] !== '';
    for (var j = 1; j < row.length; j++) {
      if (row[j] !== '' && out.dates[j - 1]) { d[out.dates[j - 1]] = row[j]; any = true; }
    }
    if (any) out.byLv[lv] = { J: row[0], d: d };
  });
  return out;
}

function highlightManaged_(main) {
  var lv = {};
  managedLevels_().forEach(function (x) { lv[x] = 1; });
  var n = main.getLastRow() - CFG.HEADER_ROWS;
  if (n <= 0) return;
  var a = main.getRange(CFG.HEADER_ROWS + 1, 1, n, 1).getValues();
  var list = [];
  a.forEach(function (r, i) { if (lv[trim_(r[0])]) list.push('A' + (CFG.HEADER_ROWS + 1 + i) + ':C' + (CFG.HEADER_ROWS + 1 + i)); });
  if (list.length) main.getRangeList(list).setBackground(CFG.MANAGED_BG);
}

/** 讓「網站每日數量」與主表列、日期欄對齊；有重排回 true */
function realignDaily_(main, snap) {
  var daily = sheet_(CFG.SH.DAILY);
  var rows = main.getLastRow(), cols = main.getLastColumn();
  // 尺寸至少與主表相同
  if (daily.getMaxRows() < rows) daily.insertRowsAfter(daily.getMaxRows(), rows - daily.getMaxRows());
  if (daily.getMaxColumns() < cols) daily.insertColumnsAfter(daily.getMaxColumns(), cols - daily.getMaxColumns());

  var mainA = main.getRange(CFG.HEADER_ROWS + 1, 1, rows - CFG.HEADER_ROWS, 3).getValues();
  var mainDatesRaw = main.getRange(CFG.HEADER_ROWS, CFG.COL_FIRST_DATE, 1, cols - CFG.COL_FIRST_DATE + 1).getValues()[0];
  var mainDates = mainDatesRaw.map(dateStr_);

  var same = snap.order.length === mainA.length &&
    mainA.every(function (r, i) { return trim_(r[0]) === snap.order[i]; }) &&
    mainDates.length <= snap.dates.length &&
    mainDates.every(function (d, i) { return d === snap.dates[i]; });

  if (!same) {
    var dailyCols = daily.getMaxColumns();
    var nOld = Math.max(daily.getLastRow() - CFG.HEADER_ROWS, 0);
    if (nOld > 0) {
      daily.getRange(CFG.HEADER_ROWS + 1, 1, nOld, 3).clearContent();
      daily.getRange(CFG.HEADER_ROWS + 1, CFG.COL_OPENING, nOld, dailyCols - CFG.COL_OPENING + 1).clearContent();
    }
    // 表頭日期
    daily.getRange(CFG.HEADER_ROWS, CFG.COL_FIRST_DATE, 1, dailyCols - CFG.COL_FIRST_DATE + 1).clearContent();
    daily.getRange(CFG.HEADER_ROWS, CFG.COL_FIRST_DATE, 1, mainDatesRaw.length).setValues([mainDatesRaw])
      .setNumberFormat('m/d');
    // 層級、項目、單位
    daily.getRange(CFG.HEADER_ROWS + 1, 1, mainA.length, 3).setValues(mainA);
    // J 期初＋逐日
    var width = 1 + mainDates.length;
    var block = mainA.map(function (r) {
      var o = snap.byLv[trim_(r[0])];
      var row = new Array(width);
      for (var j = 0; j < width; j++) row[j] = '';
      if (o) {
        row[0] = o.J;
        mainDates.forEach(function (d, j) { if (d && o.d[d] != null) row[1 + j] = o.d[d]; });
      }
      return row;
    });
    daily.getRange(CFG.HEADER_ROWS + 1, CFG.COL_OPENING, block.length, width).setValues(block);
  }
  writeDailyFormulas_(daily, rows, cols);
  return !same;
}

/** 重寫「網站每日數量」E、G、H、I 的陣列公式（第 4 列） */
function writeDailyFormulas_(daily, lastRow, lastCol) {
  var r0 = CFG.HEADER_ROWS + 1, N = lastRow, L = colLetter_(lastCol);
  var M = "'" + CFG.SH.MAIN + "'", Y = "'" + CFG.SH.LAYER + "'";
  // 先清掉第 5 列以下，避免陣列公式被擋住
  if (lastRow > r0) {
    [5, 7, 8, 9].forEach(function (c) { daily.getRange(r0 + 1, c, lastRow - r0, 1).clearContent(); });
  }
  daily.getRange(r0, 5).setFormula('=ARRAYFORMULA(IF(LEN(A' + r0 + ':A' + N + '),IFERROR(XLOOKUP(TRIM(A' + r0 + ':A' + N + '),' + Y + '!A2:A300,' + Y + '!F2:F300),""),""))');
  daily.getRange(r0, 7).setFormula('=MAP(E' + r0 + ':E' + N + ',J' + r0 + ':J' + N + ',BYROW(K' + r0 + ':' + L + N + ',LAMBDA(r,SUM(r))),LAMBDA(e,j,s,IF(e="","",ROUND(N(j)+s,3))))');
  daily.getRange(r0, 8).setFormula('=ARRAYFORMULA(IF(E' + r0 + ':E' + N + '="","",' + M + '!G' + r0 + ':G' + N + '))');
  daily.getRange(r0, 9).setFormula('=ARRAYFORMULA(IF(E' + r0 + ':E' + N + '="","",G' + r0 + ':G' + N + '-H' + r0 + ':H' + N + '))');
}
