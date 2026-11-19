// 示範模式：隨機產生的假資料＋模擬 Apps Script API（不連線、不寫入試算表）
// 資料只存在這台裝置的 localStorage；工項、代號、房號、數量全部是虛構的。
(function () {
  'use strict';
  var KEY = 'progress-demo-v1';
  var OPENING_BY = '系統（期初推估）';
  var TAGS = {
    '門': [['門框', 0.6], ['門扇及五金', 0.4]],
    '窗': [['窗框', 0.6], ['玻璃／百葉及五金', 0.4]],
    '捲門': [['導軌及捲軸箱', 0.6], ['門片及電動機', 0.4]]
  };
  var pad = function (n) { return ('0' + n).slice(-2); };
  var dstr = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var addDays = function (s, n) { var p = s.split('-'); return dstr(new Date(+p[0], +p[1] - 1, +p[2] + n)); };
  var uuid = function () { return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); };
  var r2 = function (x) { return Math.round(x * 100) / 100; };

  function generate() {
    var s = 20261119;
    var rnd = function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var today = dstr(new Date());
    var goLive = addDays(today, -14);
    var floors = ['B1F', '1F', '2F', '3F', '4F'];
    var roomNames = ['辦公室', '會議室', '走道', '梯廳', '廁所', '儲藏室', '機房', '茶水間', '值班室', '電梯廳'];
    var rooms = {};
    floors.forEach(function (fl, fi) {
      var n = 6 + Math.floor(rnd() * 4), base = fl === 'B1F' ? 'B1' : String(fi);
      rooms[fl] = [];
      for (var k = 1; k <= n; k++) rooms[fl].push([base + pad(k), pick(roomNames)]);
    });
    var cats = [
      { cat: '天花板（示範）', codes: [['C1', 'M2', '天花板，C1-明架礦纖板天花（示範）'], ['C2', 'M2', '天花板，C2-矽酸鈣板天花（示範）'], ['C3', 'M2', '天花板，C3-防潮石膏板天花（示範）']] },
      { cat: '油漆（示範）', codes: [['P1', 'M2', '油漆，P1-水泥漆（示範）'], ['P2', 'M2', '油漆，P2-乳膠漆（示範）'], ['P3', 'M', '油漆，P3-踢腳線（示範）'], ['P9', 'M2', '油漆，P9-樑面塗裝（示範，比例分配）', 'prop']] },
      { cat: '防水（示範）', codes: [['WP1', 'M2', '防水，WP1-地坪防水（示範）'], ['WP2', 'M2', '防水，WP2-筏基防水（示範，比例分配）', 'prop']] },
      { cat: '門窗（示範）', codes: [['D1', '樘', '金屬門扇及門樘，D1 鋼板門（示範）', '門'], ['D2', '樘', '金屬門扇及門樘，D2 蜂巢推門（示範）', '門'], ['W1', '樘', '金屬製品，W1 鋁窗（示範）', '窗'], ['SD1', '樘', '鐵捲門，SD1 電動捲門（示範）', '捲門']] },
      { cat: '欄杆（示範）', codes: [['R1', 'M', '欄杆，R1-不銹鋼扶手（示範）'], ['R2', 'M', '欄杆，R2-樓梯扶手（示範，比例分配）', 'prop']] }
    ];
    var items = [], locs = [], cur = {}, mats = [], logs = [];
    cats.forEach(function (c, ci) {
      c.codes.forEach(function (x, k) {
        var lv = 'DEMO.' + (ci + 1) + '.' + (k + 1);
        var tag = TAGS[x[3]] || null;
        var it = { lv: lv, name: x[2], unit: x[1], cat: c.cat, code: x[0], tag: tag };
        var ii = items.length;
        items.push(it);
        var my = [];
        if (x[3] === 'prop') {
          my.push([lv + '|代號層|' + x[0], ii, '代號層', x[0], '不分樓層（比例分配）', '不分樓層', r2(80 + rnd() * 400), c.cat + '|代號層|' + x[0]]);
        } else if (tag) {
          floors.forEach(function (fl) {
            var n = 1 + Math.floor(rnd() * 5);
            for (var t = 1; t <= n; t++) {
              var rid = fl + '-' + x[0] + pad(t);
              my.push([lv + '|' + fl + '|' + rid, ii, fl, rid, pick(['東側', '西側', '北側', '南側']) + pick(roomNames), '單樘', 1, c.cat + '|' + fl + '|' + x[0]]);
            }
          });
        } else if (x[0] === 'R1') {
          floors.forEach(function (fl) {
            my.push([lv + '|' + fl + '|樓梯', ii, fl, '樓梯', 'A梯扶手', '部位', r2(6 + rnd() * 6), c.cat + '|' + fl + '|樓梯']);
          });
        } else {
          floors.forEach(function (fl) {
            rooms[fl].forEach(function (rm) {
              if (rnd() < 0.55) my.push([lv + '|' + fl + '|' + rm[0], ii, fl, rm[0], rm[1], '房間', r2(x[1] === 'M' ? 10 + rnd() * 40 : 8 + rnd() * 120), c.cat + '|' + fl + '|' + rm[0]]);
            });
          });
        }
        Array.prototype.push.apply(locs, my);
        // 期初與幾筆上線後的登記
        var open = Math.round(rnd() * 60);
        my.forEach(function (l, j) {
          var p = open, f = tag ? open : '', sv = tag ? open : '';
          cur[l[0]] = [p, f, sv, addDays(goLive, -1), OPENING_BY];
          logs.push({ id: l[0], lv: lv, detail: '期初推估', p: p, old: '', date: addDays(goLive, -1), level: '期初', by: OPENING_BY, ts: addDays(goLive, -1) + ' 00:00', uuid: uuid(), reason: '期初% = 上線前使用數量 ÷ 圖面合計', note: '' });
          if (rnd() < 0.35) {
            var np = tag ? null : pick([50, 75, 100]);
            var nf = tag ? 100 : '', ns = tag ? pick([0, 100]) : '';
            if (tag) np = r2(nf * tag[0][1] + ns * tag[1][1]);
            if (np >= p) {
              var dd = addDays(goLive, Math.floor(rnd() * 13));
              cur[l[0]] = [np, nf, ns, dd, '王工程師（示範）'];
              logs.push({ id: l[0], lv: lv, detail: tag ? tag[0][0] + ' ' + nf + '%／' + tag[1][0] + ' ' + ns + '%' : '', p: np, old: p, date: dd, level: '代號', by: 'wang@example.com', ts: dd + ' 16:20', uuid: uuid(), reason: '', note: '' });
            }
          }
        });
        if (!tag && rnd() < 0.7) mats.push({ lv: lv, date: addDays(goLive, 3), qty: Math.round(my.reduce(function (a, l) { return a + l[6]; }, 0) * 0.5), by: 'wang@example.com', note: '' });
      });
    });
    var total = {};
    locs.forEach(function (l) { total[l[1]] = (total[l[1]] || 0) + l[6]; });
    items.forEach(function (it, i) { it.official = r2(total[i] * (0.2 + rnd() * 0.5)); it.opening = r2(it.official * 0.8); });
    return { v: 1, goLive: goLive, items: items, locs: locs, cur: cur, logs: logs, mats: mats, offline: false };
  }

  var st = null;
  function load() {
    if (st) return st;
    try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    if (!st || st.v !== 1) { st = generate(); save(); }
    return st;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 忽略 */ } }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var me = { email: 'demo@example.com', name: '示範工程師', role: 'editor' };

  function webCum(ii) {
    var s = 0;
    st.locs.forEach(function (l) { if (l[1] === ii && st.cur[l[0]]) s += l[6] * st.cur[l[0]][0] / 100; });
    return r2(s);
  }

  var api = {
    bootstrap: function () {
      return { ok: true, user: me, goLive: st.goLive, today: dstr(new Date()), version: '示範',
        items: st.items.map(function (it, i) {
          var m = st.mats.filter(function (x) { return x.lv === it.lv; });
          var last = m.reduce(function (a, x) { return x.date > a ? x.date : a; }, '');
          return [it.lv, it.name, it.unit, it.cat, it.code, it.tag, webCum(i), it.official, it.opening, m.reduce(function (a, x) { return a + x.qty; }, 0), last];
        }),
        locs: st.locs, cur: st.cur };
    },
    submit: function (req) {
      var byId = {};
      st.locs.forEach(function (l) { byId[l[0]] = l; });
      var seen = {};
      st.logs.forEach(function (g) { seen[g.uuid] = 1; });
      var out = { ok: true, saved: [], dup: [], conflicts: [], rejected: [], cur: {} };
      var today = dstr(new Date());
      if (!req.date || req.date > today) return { ok: false, error: 'bad_request', message: '施工日期不能晚於今天' };
      if (req.date < st.goLive) return { ok: false, error: 'bad_request', message: '施工日期不能早於上線日 ' + st.goLive };
      (req.items || []).forEach(function (it) {
        var l = byId[it.id];
        if (seen[it.uuid]) { out.dup.push(it.uuid); out.cur[it.id] = st.cur[it.id]; return; }
        if (!l) { out.rejected.push({ uuid: it.uuid, id: it.id, why: '找不到這個位置' }); return; }
        var tag = l[5] === '單樘' ? st.items[l[1]].tag : null;
        var c = st.cur[it.id] || [0, '', '', '', ''];
        var p, f = '', s = '';
        if (tag) { f = clamp(it.f); s = clamp(it.s); p = r2(f * tag[0][1] + s * tag[1][1]); } else p = clamp(it.p);
        if (!req.force && it.old) {
          var differ = tag ? (+it.old.f !== +(c[1] === '' ? c[0] : c[1]) || +it.old.s !== +(c[2] === '' ? c[0] : c[2])) : +it.old.p !== +c[0];
          if (differ) { out.conflicts.push({ uuid: it.uuid, id: it.id, server: c }); return; }
        }
        var reason = it.reason || req.reason || '';
        if (p < c[0] && !reason) { out.rejected.push({ uuid: it.uuid, id: it.id, why: '完成% 比上次低，需填原因' }); return; }
        st.logs.push({ id: it.id, lv: st.items[l[1]].lv, detail: tag ? tag[0][0] + ' ' + f + '%／' + tag[1][0] + ' ' + s + '%' : '', p: p, old: c[0], date: req.date,
          level: req.level || '代號', by: me.email, ts: new Date().toLocaleString('sv').slice(0, 16), uuid: it.uuid, reason: reason, note: it.note || '' });
        seen[it.uuid] = 1;
        out.saved.push(it.uuid);
        if (!c[3] || req.date >= c[3]) st.cur[it.id] = [p, f, s, req.date, me.name];
        out.cur[it.id] = st.cur[it.id];
      });
      save();
      return out;
    },
    material: function (req) {
      var dup = st.mats.some(function (m) { return m.uuid === req.uuid; });
      if (!dup) st.mats.push({ lv: req.lv, date: req.date, qty: +req.qty, by: me.email, note: req.note || '', uuid: req.uuid });
      save();
      var m = st.mats.filter(function (x) { return x.lv === req.lv; });
      return { ok: true, dup: dup, lv: req.lv, sum: m.reduce(function (a, x) { return a + x.qty; }, 0), last: m.reduce(function (a, x) { return x.date > a ? x.date : a; }, '') };
    },
    history: function (req) {
      var ids = {};
      (req.ids || []).forEach(function (i) { ids[i] = 1; });
      var recs = st.logs.filter(function (g) { return ids[g.id]; }).slice(-200).reverse();
      var mats = req.lv ? st.mats.filter(function (m) { return m.lv === req.lv; }).slice().reverse() : [];
      return { ok: true, records: recs, materials: mats, all: true };
    },
    recalc: function () { return { ok: true, result: { levels: st.items.length } }; }
  };
  function clamp(v) { var n = Number(v); if (!isFinite(n)) n = 0; return r2(Math.max(0, Math.min(100, n))); }

  window.Demo = {
    call: function (action, payload) {
      load();
      return wait(250 + Math.random() * 350).then(function () {
        if (st.offline) throw new TypeError('Failed to fetch（示範：模擬斷線）');
        var fn = api[action];
        if (!fn) return { ok: false, error: 'bad_request', message: '未知的動作' };
        return JSON.parse(JSON.stringify(fn(payload || {})));
      });
    },
    toggleOffline: function () { load(); st.offline = !st.offline; save(); return st.offline; },
    isOffline: function () { load(); return !!st.offline; },
    /** 模擬別人同時修改：伺服器端改 5 筆，網頁還不知道 */
    otherUser: function () {
      load();
      var picked = st.locs.filter(function (l) { return l[5] !== '單樘'; }).sort(function () { return Math.random() - 0.5; }).slice(0, 5);
      picked.forEach(function (l) {
        var c = st.cur[l[0]] || [0, '', '', '', ''];
        st.cur[l[0]] = [Math.min(100, (c[0] || 0) + 10), '', '', dstr(new Date()), '李工程師（示範）'];
      });
      save();
      return picked.map(function (l) { return l[3]; });
    },
    reset: function () { st = generate(); save(); }
  };
})();
