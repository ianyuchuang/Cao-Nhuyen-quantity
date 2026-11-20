/**
 * 離線佇列（localStorage）讀回時的格式檢查。
 * 同一個 github.io 網域底下的其他頁面也能改 localStorage，所以讀回的資料不能直接相信：
 * 不是陣列、或任何一批形狀不對就丟掉那一批，避免畫面卡在「讀取資料中」。
 */
function isStr(v, max) { return typeof v === 'string' && v.length <= (max || 1000); }
function isPlainObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
function validBatch(b) {
  if (!isPlainObj(b) || !isPlainObj(b.payload)) return false;
  const p = b.payload;
  if (b.type === 'material') {
    return isStr(p.uuid, 64) && isStr(p.lv, 200) && isStr(p.date, 10) && typeof p.qty === 'number' && isFinite(p.qty) && (p.note == null || isStr(p.note, 1000));
  }
  if (b.type === 'submit') {
    if (!Array.isArray(p.items) || !p.items.length || p.items.length > 3000) return false;
    if (!isStr(p.date, 10) || (p.reason != null && !isStr(p.reason, 1000)) || (p.label != null && !isStr(p.label, 1000)) || (p.level != null && !isStr(p.level, 20))) return false;
    if (!p.items.every(it => isPlainObj(it) && isStr(it.uuid, 64) && isStr(it.id, 500) && (it.old == null || isPlainObj(it.old)))) return false;
    return b.prev == null || (Array.isArray(b.prev) && b.prev.every(x => Array.isArray(x) && isStr(x[0], 500) && (x[1] == null || isPlainObj(x[1]))));
  }
  return false;
}
/** 回傳 { list: 合格的批次, dropped: 丟掉幾批 } */
function cleanOutbox(raw) {
  let v;
  try { v = JSON.parse(raw || '[]'); } catch (e) { return { list: [], dropped: 1 }; }
  if (!Array.isArray(v)) return { list: [], dropped: 1 };
  const list = v.filter(validBatch);
  return { list, dropped: v.length - list.length };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { cleanOutbox, validBatch };
