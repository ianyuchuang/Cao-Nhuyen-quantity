/**
 * 從正式版同步主表「施工-實際進度」（只讀正式版）
 *
 * 權限範圍只有 spreadsheets.currentonly（只能改本試算表）＋ spreadsheets.readonly（其他試算表只能讀），
 * 所以正式版由 Google 權限保證唯讀。SpreadsheetApp 開其他試算表需要完整權限不能用，
 * 改用 Sheets API（進階服務 Sheets）的 spreadsheets.get / values.get 讀取。
 * 做法：讀正式版「施工-實際進度 (修訂2版)」算好的數值（不帶公式：正式版公式參照它自己的其他工作表，帶過來會變 #REF!），
 * 寫進本表主表。主表的格式保留不動（正式版新增列時，新列沿用上一列格式）；凍結列欄跟正式版一致。
 * 主表工作表本身不刪除，其他工作表對它的參照不會失效。
 * 接著：
 *   1. 主表中網站管理的層級 A～C 標淺藍；
 *   2. 「網站每日數量」若列順序或日期欄與主表不同，依層級重排（J 期初與逐日數量跟著層級走）；
 *   3. 重寫「網站每日數量」E、G、H、I 欄的公式（主表列數改變時範圍跟著調整）；
 *   4. 正式版使用數量 ≥ 圖面合計 50% 的代號自動補進料（autoMaterialFromOfficial_）。
 */
function syncFromOfficial() {
  var lock = LockService.getScriptLock();
  lock.waitLock(120000);
  var ss = ss_(), t0 = Date.now();
  try {
    var off = readOfficial_();               // 只讀
    var snap = snapshotDaily_();             // 先記下網站每日數量（依層級）
    var main = ss.getSheetByName(CFG.SH.MAIN) || ss.insertSheet(CFG.SH.MAIN, 0);
    var R = off.R, C = off.C;
    if (main.getMaxRows() < R) main.insertRowsAfter(main.getMaxRows(), R - main.getMaxRows());
    if (main.getMaxRows() > R) main.deleteRows(R + 1, main.getMaxRows() - R);
    if (main.getMaxColumns() < C) main.insertColumnsAfter(main.getMaxColumns(), C - main.getMaxColumns());
    if (main.getMaxColumns() > C) main.deleteColumns(C + 1, main.getMaxColumns() - C);
    var to = main.getRange(1, 1, R, C);
    to.clearContent();
    to.setValues(protectRows_(off.values));
    main.setFrozenRows(off.frozenRows);
    main.setFrozenColumns(off.frozenCols);
    SpreadsheetApp.flush();

    highlightManaged_(main);
    var moved = realignDaily_(main, snap);
    var auto = autoMaterialFromOfficial_(main);  // 正式版 ≥ 50% → 自動補進料
    PropertiesService.getScriptProperties().setProperty('LAST_SYNC', new Date().toISOString());
    console.log('同步主表完成：' + R + ' 列 × ' + C + ' 欄，' + Math.round((Date.now() - t0) / 1000) + ' 秒');
    toast_('已從正式版同步主表' + (moved ? '，並重排「網站每日數量」' : '') + '。');
    return { ok: true, realigned: moved, autoMat: auto };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 讀正式版（唯讀）：回傳 { R, C, frozenRows, frozenCols, values }，values 補滿成 R × C。
 * 數值用 UNFORMATTED_VALUE；表頭日期列（第 HEADER_ROWS 列、日期欄起）由序號轉回日期。
 */
function readOfficial_() {
  var meta = Sheets.Spreadsheets.get(CFG.OFFICIAL_ID,
    { fields: 'sheets(properties(title,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)))' });
  var p = (meta.sheets || []).map(function (s) { return s.properties; })
    .filter(function (x) { return x.title === CFG.OFFICIAL_SHEET; })[0];
  if (!p) throw new Error('正式版找不到工作表「' + CFG.OFFICIAL_SHEET + '」');
  var g = p.gridProperties || {};
  var R = g.rowCount, C = g.columnCount;
  var res = Sheets.Spreadsheets.Values.get(CFG.OFFICIAL_ID, "'" + CFG.OFFICIAL_SHEET.replace(/'/g, "''") + "'",
    { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', majorDimension: 'ROWS' });
  var raw = res.values || [];
  var values = [];
  for (var i = 0; i < R; i++) {
    var src = raw[i] || [], row = new Array(C);
    for (var j = 0; j < C; j++) {
      var v = j < src.length && src[j] != null ? src[j] : '';
      if (i === CFG.HEADER_ROWS - 1 && j >= CFG.COL_FIRST_DATE - 1 && typeof v === 'number' && v > 30000) v = serialToDate_(v);
      row[j] = v;
    }
    values.push(row);
  }
  return { R: R, C: C, frozenRows: g.frozenRowCount || 0, frozenCols: g.frozenColumnCount || 0, values: values };
}

/** 試算表日期序號 → 本地（Asia/Taipei）當天 0 時的 Date */
function serialToDate_(n) {
  var u = new Date(Math.round((n - 25569) * 86400000));
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

/**
 * 檢查用（在 Apps Script 編輯器執行）：確認權限範圍沒有「編輯所有試算表」，並試讀正式版。只讀，不寫入正式版。
 */
function officialAccessCheck() {
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(ScriptApp.getOAuthToken()),
    { muteHttpExceptions: true });
  var scopes = String((JSON.parse(res.getContentText() || '{}').scope) || '').split(' ').filter(String).sort();
  var full = scopes.filter(function (x) { return /\/auth\/(spreadsheets|drive|drive\.file)$/.test(x); });
  var off = readOfficial_();
  var msg = '權限範圍：' + scopes.map(function (x) { return x.replace('https://www.googleapis.com/auth/', ''); }).join('、') +
    '\n可編輯所有試算表／雲端硬碟的範圍：' + (full.length ? full.join('、') + '（不應出現）' : '無') +
    '\n正式版「' + CFG.OFFICIAL_SHEET + '」：' + off.R + ' 列 × ' + off.C + ' 欄，A' + (CFG.HEADER_ROWS + 1) + '＝' + off.values[CFG.HEADER_ROWS][0] +
    '，第一個日期欄＝' + off.values[CFG.HEADER_ROWS - 1][CFG.COL_FIRST_DATE - 1];
  console.log(msg);
  return msg;
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
    daily.getRange(CFG.HEADER_ROWS + 1, 1, mainA.length, 3).setValues(protectRows_(mainA));
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
