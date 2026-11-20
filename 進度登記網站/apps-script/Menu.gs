/**
 * 試算表選單與定時觸發
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('進度登記')
    .addItem('全部重算（網站每日數量）', 'menuRecalcAll')
    .addItem('從正式版同步主表', 'menuSync')
    .addItem('設定期初', 'menuSetOpening')
    .addItem('從進度紀錄重建目前進度', 'menuRebuildCurrent')
    .addSeparator()
    .addItem('安裝每日同步觸發（每天 02:00）', 'installTriggers')
    .addItem('移除每日同步觸發', 'removeTriggers')
    .addItem('清除權限快取', 'clearAclCache')
    .addItem('清除位置快取（改了「位置」後）', 'menuClearLocCache')
    .addToUi();
}

/**
 * 簡單觸發：在試算表編輯「人員」或「設定」表時清除權限快取，核准（勾選）立即生效。
 * 只在試算表介面手動編輯時觸發；用 API 或程式改寫不會觸發（最慢 PEOPLE_TTL 秒生效）。
 */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    if (name !== CFG.SH.PEOPLE && name !== CFG.SH.SET) return;
    clearAclCache_();
    console.log('「' + name + '」已編輯，清除權限快取');
  } catch (err) { console.error(err); }
}

function menuSync() {
  var ui = ui_();
  if (ui && ui.alert('從正式版同步主表',
    '會以正式版「' + CFG.OFFICIAL_SHEET + '」覆蓋本表「' + CFG.SH.MAIN + '」（正式版只讀取、不會被修改）。\n約需 1～2 分鐘，要繼續嗎？',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var r = syncFromOfficial();
  var a = r.autoMat || { added: [] };
  alert_('同步完成。' + (r.realigned ? '\n正式版的列或日期欄有變動，「網站每日數量」已依層級重排。' : '') +
    (a.skipped ? '\n未自動補進料：' + a.skipped :
      a.added.length ? '\n正式版 ≥ 50% 自動補進料：\n' + a.added.map(function (x) { return x.code + ' 補 ' + x.qty + '（正式版 ' + x.ratio + '%）'; }).join('\n') : '\n沒有需要自動補進料的代號。'));
}

function menuClearLocCache() {
  clearLocCache_();
  toast_('已清除位置快取。');
}

/** 每天 02:00 從正式版同步（含正式版 ≥ 50% 自動補進料）；同步後全部重算 */
function installTriggers() {
  removeTriggers(true);
  ScriptApp.newTrigger('nightlyJob').timeBased().everyDays(1).atHour(2).inTimezone(CFG.TZ).create();
  alert_('已安裝：每天 02:00 從正式版同步主表並全部重算。');
}

function removeTriggers(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyJob' || t.getHandlerFunction() === 'syncFromOfficial') ScriptApp.deleteTrigger(t);
  });
  if (silent !== true) alert_('已移除每日同步觸發。');
}

function nightlyJob() {
  syncFromOfficial();
  recalcAll_();
}

// ---------- UI 小工具（觸發器或編輯器執行時沒有 UI，改寫到記錄） ----------
function ui_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}
function alert_(msg) {
  var ui = ui_();
  if (ui) ui.alert(msg); else console.log(msg);
}
function toast_(msg) {
  try { ss_().toast(msg, '進度登記', 5); } catch (e) { console.log(msg); }
}
