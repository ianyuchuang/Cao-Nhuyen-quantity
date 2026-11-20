/**
 * 位置 → 房間分組（網頁與測試共用）
 * - 一般位置：依「位置」L 欄房間ID 分組，房號、空間名稱照原樣。
 * - 門窗單樘：房間ID「門窗|樓層|房號」→ 歸到該房間（H 欄「房號 空間名稱」去掉房號當空間名稱）；
 *   房間ID 第三段等於代號（未對應房號）→ 以代號為組，標「未對應房號」。
 * loc：{ fl, rid, nm, kind, room }；item：{ cat, code, short }
 * 回傳 { key, rid, nm, kind, door }
 */
function roomOf(loc, item) {
  var tag = loc.kind === '單樘';
  var rid = loc.rid, nm = loc.kind === '不分樓層' ? '不分樓層' : loc.nm, kind = loc.kind;
  if (tag) {
    var seg = String(loc.room || '').split('|');
    var rn = seg.length >= 3 ? seg.slice(2).join('|') : '';
    if (rn && rn !== item.code) {
      var h = String(loc.nm || '');
      rid = rn; nm = h.indexOf(rn) === 0 ? h.slice(rn.length).trim() : h; kind = '房間';
    } else {
      rid = item.code; nm = '未對應房號・' + String(item.short || '').slice(0, 20); kind = '代號組';
    }
  }
  return { key: loc.room || (item.cat + '|' + loc.fl + '|' + rid), rid: rid, nm: nm, kind: kind, door: tag };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { roomOf: roomOf };
