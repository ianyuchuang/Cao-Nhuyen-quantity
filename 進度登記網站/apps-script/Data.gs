/**
 * 讀寫工作表的共用函式
 */

/** 讀「位置」：只取狀態「有效」；回傳 items（依表中順序）、locs、byId、itemByLv */
function loadLocations_() {
  var sh = sheet_(CFG.SH.LOC);
  var n = sh.getLastRow() - 1;
  // 快取鍵含列數：「位置」增刪列（例如合併部位）後立即失效；只改數量則最多 2 分鐘後生效（或選單「清除位置快取」）
  var cached = cacheGetBig_('locs');
  if (cached && cached.n === n) return indexLocations_(cached);
  var raw = { n: n, items: [], locs: [] };
  if (n > 0) {
    var v = sh.getRange(2, 1, n, 14).getValues();
    var seenLv = Object.create(null);
    v.forEach(function (r) {
      var state = trim_(r[LOC_COL.STATE - 1]);
      var id = trim_(r[LOC_COL.ID - 1]);
      var lv = trim_(r[LOC_COL.LV - 1]);
      if (!id || !lv || (state && state !== '有效')) return;
      var kind = trim_(r[LOC_COL.KIND - 1]);
      if (!seenLv[lv]) {
        seenLv[lv] = 1;
        raw.items.push({ lv: lv, name: String(r[LOC_COL.NAME - 1]), unit: trim_(r[LOC_COL.UNIT - 1]),
          cat: trim_(r[LOC_COL.CAT - 1]), code: trim_(r[LOC_COL.CODE - 1]), tag: null });
      }
      if (kind === '單樘') {
        var it = raw.items[raw.items.length - 1].lv === lv ? raw.items[raw.items.length - 1] : raw.items.filter(function (x) { return x.lv === lv; })[0];
        it.tag = tagStepsFor_(it.name);
      }
      raw.locs.push({ id: id, lv: lv, fl: trim_(r[LOC_COL.FL - 1]), rid: trim_(r[LOC_COL.RID - 1]), nm: trim_(r[LOC_COL.NM - 1]),
        kind: kind, q: round_(num_(r[LOC_COL.QTY - 1]), 4), room: trim_(r[LOC_COL.ROOM - 1]) });
    });
  }
  cachePutBig_('locs', raw, 120);
  return indexLocations_(raw);
}

function indexLocations_(raw) {
  var itemByLv = Object.create(null), byId = Object.create(null);
  raw.items.forEach(function (it) { itemByLv[it.lv] = it; });
  raw.locs.forEach(function (l) {
    var it = itemByLv[l.lv];
    byId[l.id] = { id: l.id, lv: l.lv, name: it.name, unit: it.unit, fl: l.fl, rid: l.rid, q: l.q, kind: l.kind,
      tag: l.kind === '單樘' ? it.tag : null };
  });
  return { items: raw.items, locs: raw.locs, itemByLv: itemByLv, byId: byId };
}

function clearLocCache_() { cacheRemoveBig_('locs'); }

/** 讀「目前進度」：byId 位置ID → { row(0 起算資料列), p, f, s, d, by, ts } */
function loadCurrent_() {
  var sh = sheet_(CFG.SH.CUR);
  var n = sh.getLastRow() - 1;
  var out = { byId: Object.create(null), n: Math.max(n, 0), raw: [], dirty: false };
  if (n <= 0) return out;
  var v = sh.getRange(2, 1, n, 13).getValues();
  out.raw = v;
  v.forEach(function (r, i) {
    var id = trim_(r[CUR_COL.ID - 1]);
    if (!id) return;
    out.byId[id] = { row: i, p: fromFrac_(r[CUR_COL.PCT - 1]),
      f: fromFrac_(r[CUR_COL.FRAME - 1]),
      s: fromFrac_(r[CUR_COL.LEAF - 1]),
      d: dateStr_(r[CUR_COL.DATE - 1]), by: trim_(r[CUR_COL.BY - 1]), ts: r[CUR_COL.TS - 1] };
  });
  return out;
}

/**
 * 寫回「目前進度」：只寫 G～I（完成%、框、扇）與 K～M（日期、登記人、時間）；
 * J 欄「完成量」是公式，不寫。表中沒有的位置（數量改版新增）附加在最後。
 */
function writeCurrent_(cur, L) {
  var sh = sheet_(CFG.SH.CUR);
  var gi = [], km = [], add = [];
  cur.raw.forEach(function (r) {
    gi.push([r[CUR_COL.PCT - 1], r[CUR_COL.FRAME - 1], r[CUR_COL.LEAF - 1]]);
    km.push([r[CUR_COL.DATE - 1], r[CUR_COL.BY - 1], r[CUR_COL.TS - 1]]);
  });
  Object.keys(cur.byId).forEach(function (id) {
    var c = cur.byId[id];
    var g = [toFrac_(c.p), toFrac_(c.f), toFrac_(c.s)], k = [c.d, c.by, c.ts || ''];
    if (c.row == null) {
      var l = L.byId[id];
      if (!l) return;
      add.push([l.lv, l.name, l.unit, l.fl, l.rid, id].concat(g));
      add[add.length - 1].kmv = k;
      return;
    }
    gi[c.row] = g;
    km[c.row] = k;
  });
  if (gi.length) {
    sh.getRange(2, CUR_COL.PCT, gi.length, 3).setValues(gi);
    sh.getRange(2, CUR_COL.DATE, km.length, 3).setValues(km);
  }
  if (add.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, add.length, 9).setValues(add.map(function (a) { return a.slice(0, 9); }));
    sh.getRange(start, CUR_COL.DATE, add.length, 3).setValues(add.map(function (a) { return a.kmv; }));
  }
}

/** 讀某欄所有 UUID → { uuid: 1 } */
function uuidSet_(sh, col) {
  var set = Object.create(null);
  var n = sh.getLastRow() - 1;
  if (n <= 0) return set;
  sh.getRange(2, col, n, 1).getValues().forEach(function (r) { if (r[0]) set[String(r[0])] = 1; });
  return set;
}

/** 「網站每日數量」G 網站累計、H 正式版使用數量、J 期初 → { 層級: {web, official, opening} } */
function dailySummary_() {
  var sh = sheet_(CFG.SH.DAILY);
  var n = sh.getLastRow() - CFG.HEADER_ROWS;
  var out = {};
  if (n <= 0) return out;
  var v = sh.getRange(CFG.HEADER_ROWS + 1, 1, n, CFG.COL_OPENING).getValues();
  v.forEach(function (r) {
    var lv = trim_(r[0]);
    if (!lv || r[4] === '') return; // E 圖面數量空白＝非網站管理的層級
    var f = function (x) { return x === '' || x == null || isNaN(Number(x)) ? null : round_(Number(x), 3); };
    out[lv] = { web: f(r[6]), official: f(r[7]), opening: f(r[9]) };
  });
  return out;
}

/** 「進料」→ { 層級: {sum, last} } */
function materialSummary_() {
  var sh = sheet_(CFG.SH.MAT);
  var n = sh.getLastRow() - 1;
  var out = {};
  if (n <= 0) return out;
  sh.getRange(2, 1, n, 5).getValues().forEach(function (r) {
    var lv = trim_(r[0]);
    if (!lv) return;
    var o = out[lv] || (out[lv] = { sum: 0, last: '' });
    o.sum += num_(r[4]);
    var d = dateStr_(r[3]);
    if (d > o.last) o.last = d;
  });
  return out;
}

// ---------- 大物件快取（CacheService 每個 key 上限 100KB，切塊存放） ----------
function cachePutBig_(key, obj, ttl) {
  try {
    var s = JSON.stringify(obj);
    var size = 90000, parts = Math.ceil(s.length / size);
    if (parts > 50) return;
    var map = {};
    for (var i = 0; i < parts; i++) map[key + '_' + i] = s.substr(i * size, size);
    map[key + '_n'] = String(parts);
    CacheService.getScriptCache().putAll(map, ttl);
  } catch (e) { /* 快取失敗不影響功能 */ }
}
function cacheGetBig_(key) {
  try {
    var c = CacheService.getScriptCache();
    var n = Number(c.get(key + '_n'));
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var got = c.getAll(keys), s = '';
    for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}
function cacheRemoveBig_(key) {
  var c = CacheService.getScriptCache();
  var n = Number(c.get(key + '_n')) || 0;
  var keys = [key + '_n'];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  c.removeAll(keys);
}
