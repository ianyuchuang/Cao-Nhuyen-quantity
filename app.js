// 工項進度登記 － 前端（GitHub Pages 靜態網頁）
// 資料一律在登入後由 Apps Script API 取得；網頁本身不含任何數量或單價。
(function () {
  'use strict';
  // 不允許被其他網站嵌入（GitHub Pages 無法設 frame-ancestors 標頭）
  if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location = window.self.location.href; } catch (e) { /* 忽略 */ } return; }

  // ================= 常數與工具 =================
  const CFG = window.APP_CONFIG || {};
  const CODE_FL = '代號層';
  const FLOORS = [CODE_FL, '筏基層', 'B3F', 'B2F', 'B1F', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '11F', '屋突層'];
  const flIdx = f => { const i = FLOORS.indexOf(f); return i < 0 ? 99 : i; };
  const unitTxt = u => ({ M2: 'm²', M: 'm', m2: 'm²', m: 'm' }[u] || u);
  const cmpRid = (a, b) => String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = x => Math.round(x * 100) / 100;
  const clamp = v => { let n = Number(v); if (!isFinite(n)) n = 0; return r2(Math.max(0, Math.min(100, n))); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const pad = n => ('0' + n).slice(-2);
  const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fmt = (x, u) => { x = Number(x) || 0; const d = u === '樘' ? 0 : Math.abs(x) >= 100 ? 1 : 2; return x.toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: u === '樘' ? 0 : Math.min(d, 1) }); };
  const fp = p => p == null || isNaN(p) ? '—' : (Math.round(p * 10) / 10).toString().replace(/\.0$/, '') + '%';
  const $ = id => document.getElementById(id);

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3000);
  }

  // ================= 狀態 =================
  let DEMO = false;
  let ME = null, GOLIVE = '', TODAY = localToday(), VERSION = '';
  let CATS = [], ITEMS = [], LOCS = [], ROOMS = [], IDX = {}, LVIDX = {};
  let CUR = {};             // li → {p,f,s,d,by,pend}
  let OUTBOX = [];          // 待送批次
  let CONFLICTS = [];       // {li, mine:{p|f,s}, server:[...], reason}
  let NET = 'on';           // on | off | busy | auth
  let CF = null;            // 覆蓋確認 {changes, label, level, diff, n}
  const S = {
    tab: 'A', date: localToday(),
    a: { view: 'cat', ci: null, fl: null, ri: null, q: '', draft: {} },
    c: { ci: 0, fl: null },
    e: { ci: 0, open: null }
  };

  // ================= 登入（Google Identity Services） =================
  const AUTH = { token: null, exp: 0 };
  function decodeJwt(t) {
    try {
      let p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), c => c.charCodeAt(0))));
    } catch (e) { return {}; }
  }
  function setToken(t) {
    const p = decodeJwt(t);
    AUTH.token = t; AUTH.exp = (p.exp || 0) * 1000;
    try { sessionStorage.setItem('idtoken', t); } catch (e) { /* 忽略 */ }
  }
  function tokenValid() { return AUTH.token && AUTH.exp - Date.now() > 60000; }
  let gisReady = null;
  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error('無法載入 Google 登入元件，請確認網路'));
      document.head.appendChild(s);
    }).then(() => {
      google.accounts.id.initialize({
        client_id: CFG.CLIENT_ID, callback: r => onCredential(r.credential),
        auto_select: false, cancel_on_tap_outside: false, use_fedcm_for_prompt: true, ux_mode: 'popup'
      });
    });
    return gisReady;
  }
  let afterLogin = null;
  function showLogin(msg) {
    $('login').hidden = false; $('app').hidden = true;
    $('loginMsg').textContent = msg || '';
    if (!CFG.API_URL || !CFG.CLIENT_ID) {
      $('gbtn').innerHTML = '<p class="muted">網站尚未設定 API 網址與 OAuth 用戶端 ID（web/config.js），目前只能使用示範模式。</p>';
      return;
    }
    loadGis().then(() => {
      google.accounts.id.renderButton($('gbtn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'zh-TW', shape: 'rectangular' });
      google.accounts.id.prompt();
    }).catch(e => { $('loginMsg').textContent = e.message; });
  }
  function onCredential(cred) {
    setToken(cred);
    $('login').hidden = true; $('app').hidden = false;
    if (afterLogin) { const f = afterLogin; afterLogin = null; f(); }
    else start();
  }
  function needLogin(msg) {
    NET = 'auth'; setNet();
    afterLogin = () => { NET = 'on'; setNet(); flush(); };
    showLogin(msg || '登入已過期，請再登入一次（未送出的資料會保留）。');
  }

  // ================= API 與離線佇列 =================
  async function api(action, payload) {
    if (DEMO) {
      let j;
      try { j = await window.Demo.call(action, payload); } catch (e) { throw { net: true, message: e.message }; }
      if (!j.ok) throw { code: j.error, message: j.message };
      return j;
    }
    if (!tokenValid()) throw { code: 'auth', message: '登入已過期' };
    let r;
    try {
      r = await fetch(CFG.API_URL, {
        method: 'POST', redirect: 'follow', credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, token: AUTH.token }, payload || {}))
      });
    } catch (e) { throw { net: true, message: '無法連線' }; }
    if (!r.ok) throw { net: true, message: '伺服器暫時無法回應（' + r.status + '）' };
    let j;
    try { j = await r.json(); } catch (e) { throw { net: true, message: '伺服器回應格式錯誤' }; }
    if (!j.ok) throw { code: j.error, message: j.message, email: j.email };
    return j;
  }
  const obKey = () => 'progress-outbox:' + (DEMO ? 'demo' : (ME && ME.email) || String(decodeJwt(AUTH.token || '').email || 'anon').toLowerCase());
  function loadOutbox() { try { OUTBOX = JSON.parse(localStorage.getItem(obKey()) || '[]'); } catch (e) { OUTBOX = []; } }
  function saveOutbox() { try { localStorage.setItem(obKey(), JSON.stringify(OUTBOX)); } catch (e) { toast('裝置儲存空間不足，離線資料可能無法保留'); } }

  let flushing = false;
  async function flush() {
    if (flushing || !OUTBOX.length) { setNet(); return; }
    flushing = true; setNet();
    try {
      while (OUTBOX.length) {
        const b = OUTBOX[0];
        let res;
        try { res = await api(b.type, b.payload); }
        catch (e) {
          if (e.net) { NET = 'off'; break; }
          if (e.code === 'auth') { needLogin(); break; }
          if (e.code === 'busy') { NET = 'busy'; break; }
          OUTBOX.shift(); saveOutbox(); revertBatch(b);
          toast('未儲存：' + (e.message || e.code), 6000);
          continue;
        }
        OUTBOX.shift(); saveOutbox(); NET = 'on';
        applyResult(b, res);
      }
    } finally { flushing = false; setNet(); render(); }
  }
  setInterval(() => { if (OUTBOX.length && NET !== 'auth') flush(); }, 30000);
  window.addEventListener('online', () => flush());

  function revertBatch(b) {
    if (b.type !== 'submit') { if (b.type === 'material') { const ii = LVIDX[b.payload.lv]; if (ii != null) ITEMS[ii].mat -= +b.payload.qty; } return; }
    (b.prev || []).forEach(([id, st]) => { const li = IDX[id]; if (li != null) { if (st) CUR[li] = st; else delete CUR[li]; } });
  }
  function serverToCur(arr) { return arr ? { p: Number(arr[0]) || 0, f: arr[1] === '' ? '' : Number(arr[1]), s: arr[2] === '' ? '' : Number(arr[2]), d: arr[3] || '', by: arr[4] || '' } : null; }
  function applyResult(b, res) {
    if (b.type === 'material') {
      const ii = LVIDX[res.lv]; if (ii != null) { ITEMS[ii].mat = +res.sum; ITEMS[ii].matLast = res.last; }
      toast(res.dup ? '這筆進料先前已登記' : '進料已登記');
      return;
    }
    Object.keys(res.cur || {}).forEach(id => { const li = IDX[id]; if (li != null) CUR[li] = serverToCur(res.cur[id]); });
    const byUuid = {};
    b.payload.items.forEach(it => { byUuid[it.uuid] = it; });
    (res.conflicts || []).forEach(c => {
      const li = IDX[c.id]; if (li == null) return;
      const mine = byUuid[c.uuid];
      CUR[li] = serverToCur(c.server);
      CONFLICTS = CONFLICTS.filter(x => x.li !== li);
      CONFLICTS.push({ li, mine: LOCS[li].tag ? { f: mine.f, s: mine.s } : { p: mine.p }, server: c.server, reason: mine.reason || b.payload.reason || '', level: b.payload.level });
    });
    (res.rejected || []).forEach(r => {
      const li = IDX[r.id];
      const prev = (b.prev || []).find(x => x[0] === r.id);
      if (li != null && prev && !res.cur[r.id]) { if (prev[1]) CUR[li] = prev[1]; else delete CUR[li]; }
    });
    const n = (res.saved || []).length + (res.dup || []).length;
    const msg = [];
    if (n) msg.push('已儲存 ' + n + ' 筆');
    if ((res.conflicts || []).length) msg.push(res.conflicts.length + ' 筆被別人改過，請確認');
    if ((res.rejected || []).length) msg.push(res.rejected.length + ' 筆未儲存：' + res.rejected[0].why);
    if (msg.length) toast(msg.join('；'), (res.rejected || []).length ? 6000 : 3000);
  }

  function setNet() {
    const n = $('net'); if (!n) return;
    const q = OUTBOX.reduce((s, b) => s + (b.type === 'submit' ? b.payload.items.length : 1), 0);
    let txt, cls;
    if (NET === 'off') { txt = '○ 離線' + (q ? '・' + q + ' 筆待送' : ''); cls = 'off'; }
    else if (NET === 'auth') { txt = '需重新登入' + (q ? '・' + q + ' 筆待送' : ''); cls = 'off'; }
    else if (NET === 'busy' || flushing) { txt = '● 傳送中' + (q ? '・' + q + ' 筆' : ''); cls = 'busy'; }
    else { txt = '● 已連線' + (q ? '・' + q + ' 筆待送' : ''); cls = 'on'; }
    n.textContent = txt; n.className = 'net ' + cls;
  }

  // ================= 資料整理 =================
  function ingest(j) {
    ME = j.user; GOLIVE = j.goLive || ''; TODAY = j.today || localToday(); VERSION = j.version || '';
    CATS = []; ITEMS = []; LOCS = []; ROOMS = []; IDX = {}; LVIDX = {}; CUR = {};
    const catIdx = {}, rmap = {};
    j.items.forEach((a, ii) => {
      const [lv, name, unit, cat, code, tag, web, official, opening, matSum, matLast] = a;
      let ci = catIdx[cat];
      if (ci == null) { ci = catIdx[cat] = CATS.length; CATS.push({ ci, cat, items: [], rooms: [] }); }
      ITEMS.push({ ii, ci, lv, name, short: String(name).replace(/^[^，]*，/, ''), unit: unitTxt(unit), code, tag: tag || null,
        web, official, opening, mat: Number(matSum) || 0, matLast: matLast || '', locs: [], total: 0 });
      CATS[ci].items.push(ii); LVIDX[lv] = ii;
    });
    j.locs.forEach(a => {
      const [id, ii, fl, rid, nm, kind, q, room] = a;
      const o = ITEMS[ii]; if (!o) return;
      const tag = kind === '單樘';
      const rkey = room || (CATS[o.ci].cat + '|' + fl + '|' + (tag ? o.code : rid));
      let ri = rmap[rkey];
      if (ri == null) {
        ri = rmap[rkey] = ROOMS.length;
        ROOMS.push({ ri, ci: o.ci, fl, rid: tag ? o.code : rid, nm: tag ? o.short.slice(0, 26) : (kind === '不分樓層' ? '不分樓層' : nm), kind: tag ? '代號組' : kind, locs: [] });
        CATS[o.ci].rooms.push(ri);
      }
      const li = LOCS.length;
      LOCS.push({ li, id, ii, ci: o.ci, ri, fl, rid, nm, q: Number(q) || 0, kind, tag });
      o.locs.push(li); ROOMS[ri].locs.push(li); IDX[id] = li; o.total += Number(q) || 0;
    });
    Object.keys(j.cur || {}).forEach(id => { const li = IDX[id]; if (li != null) CUR[li] = serverToCur(j.cur[id]); });
    CATS.forEach(C => {
      C.floors = [...new Set(C.rooms.map(r => ROOMS[r].fl))].filter(f => f !== CODE_FL).sort((a, b) => flIdx(a) - flIdx(b));
      C.hasTag = C.items.some(i => ITEMS[i].tag);
      C.hasCodeLevel = C.items.some(i => codeLoc(i) != null);
    });
    ITEMS.forEach(o => { o.floors = [...new Set(o.locs.map(l => LOCS[l].fl))].sort((a, b) => flIdx(a) - flIdx(b)); });
    // 重新套用未送出的批次（離線時重新整理頁面）
    OUTBOX.forEach(b => {
      if (b.type === 'submit') b.payload.items.forEach(it => {
        const li = IDX[it.id]; if (li == null) return;
        const l = LOCS[li];
        CUR[li] = l.tag ? { p: tagP(l, it.f, it.s), f: it.f, s: it.s, d: b.payload.date, by: ME.name, pend: true } : { p: it.p, f: '', s: '', d: b.payload.date, by: ME.name, pend: true };
      });
      else if (b.type === 'material') { const ii = LVIDX[b.payload.lv]; if (ii != null) ITEMS[ii].mat += +b.payload.qty; }
    });
  }

  const codeLoc = ii => ITEMS[ii].locs.find(l => LOCS[l].fl === CODE_FL);
  const floorRooms = (ci, fl) => CATS[ci].rooms.map(r => ROOMS[r]).filter(r => r.fl === fl).sort((a, b) => cmpRid(a.rid, b.rid));
  const floorLocs = (ci, fl) => floorRooms(ci, fl).flatMap(r => r.locs);
  const itemFloorLocs = (ii, fl) => ITEMS[ii].locs.filter(l => LOCS[l].fl === fl);
  const tagP = (l, f, s) => { const w = ITEMS[l.ii].tag; return r2(f * w[0][1] + s * w[1][1]); };
  const val = li => (CUR[li] ? Number(CUR[li].p) || 0 : 0);
  const tagVals = li => { const c = CUR[li]; if (!c) return [0, 0]; const p = Number(c.p) || 0; return [c.f === '' || c.f == null ? p : Number(c.f), c.s === '' || c.s == null ? p : Number(c.s)]; };
  // 完成% ＝ 進料 50% × 進料比例（代號層整批）＋ 施作 50% × 施作完成%（各位置填的值）
  const MAT_W = 0.5;
  const matRatio = ii => { const o = ITEMS[ii]; return o.total > 0 ? Math.max(0, Math.min(1, o.mat / o.total)) : 0; };
  const eff = li => MAT_W * 100 * matRatio(LOCS[li].ii) + (1 - MAT_W) * val(li);
  function sum(locs) {
    const units = new Set(locs.map(l => ITEMS[LOCS[l].ii].unit));
    let q = 0, d = 0;
    locs.forEach(l => { q += LOCS[l].q; d += LOCS[l].q * eff(l) / 100; });
    const done = locs.filter(l => eff(l) >= 99.995).length;
    return { mixed: units.size > 1, unit: [...units].join('、'), q, d, p: units.size > 1 ? null : (q ? d / q * 100 : 0), done, n: locs.length };
  }
  const sumTxt = s => s.mixed ? `完成 ${s.done}/${s.n} 筆` : fp(s.p);
  /** 各單位的圖面數量合計，例如「605.96 m²」或「120.5 m²＋30 m」 */
  const qtyTotal = locs => {
    const by = {};
    locs.forEach(l => { const u = ITEMS[LOCS[l].ii].unit; by[u] = (by[u] || 0) + LOCS[l].q; });
    const order = u => ({ 'm²': 0, 'm': 1, '樘': 2 }[u] ?? 3);
    return Object.keys(by).sort((a, b) => order(a) - order(b)).map(u => `${fmt(by[u], u)} ${esc(u)}`).join('＋');
  };
  const bar = p => p == null ? '' : `<div class="pbar ${p >= 99.5 ? 'done' : ''}"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></div>`;
  const heat = p => p <= 0 ? 'var(--h0)' : p < 20 ? 'var(--h1)' : p < 45 ? 'var(--h2)' : p < 70 ? 'var(--h3)' : p < 99.5 ? 'var(--h4)' : 'var(--h5)';
  const heatInk = p => p >= 70 ? '#fff' : 'var(--ink)';
  const kindTag = k => k === '房間' || k === '代號組' ? '' : `<span class="kind">${esc(k)}</span>`;
  const pendTag = li => CUR[li] && CUR[li].pend ? '<span class="pend">待送</span>' : '';
  const roomTitle = r => `<b class="mono">${esc(r.rid)}</b> ${esc(r.nm)}${r.kind === '代號組' ? '' : kindTag(r.kind)}`;
  const roomCodes = r => {
    if (r.kind === '代號組') { const g = sum(r.locs); return `<span class="codes"><span class="${g.done === g.n ? 'ok' : ''}">${g.n} 樘・完成 ${g.done}</span></span>`; }
    return `<span class="codes">${r.locs.map(l => `<span class="${eff(l) >= 99.995 ? 'ok' : ''}">${esc(ITEMS[LOCS[l].ii].code)}</span>`).join('')}</span>`;
  };

  // ================= 變更、確認、送出 =================
  /** 完成% v → 變更；門窗依框先、扇後換算，使合計等於 v */
  function changeFor(li, v) {
    const l = LOCS[li]; v = clamp(v);
    if (!l.tag) return { li, p: v };
    const w0 = ITEMS[l.ii].tag[0][1] * 100;
    return { li, f: r2(Math.min(100, v / w0 * 100)), s: r2(Math.max(0, (v - w0) / (100 - w0) * 100)) };
  }
  const newP = c => LOCS[c.li].tag ? tagP(LOCS[c.li], c.f, c.s) : c.p;
  const isNoop = c => { const l = LOCS[c.li]; if (l.tag) { const t = tagVals(c.li); return CUR[c.li] && t[0] === c.f && t[1] === c.s; } return CUR[c.li] && val(c.li) === c.p; };

  /** 上層覆蓋底下：有不同的既有值就先提示 */
  function askBulk(locs, v, label, level) {
    const changes = locs.map(li => changeFor(li, v));
    const diff = locs.filter(l => val(l) > 0 && Math.abs(val(l) - clamp(v)) > 0.001).length;
    if (diff) { CF = { changes, label, level, v: clamp(v), diff, n: locs.length }; render(); return; }
    commit(changes, { level, label });
  }

  async function commit(changes, meta, opt) {
    opt = opt || {};
    if (!opt.force) changes = changes.filter(c => !isNoop(c));
    if (!changes.length) { toast('沒有需要儲存的變更'); return false; }
    if (GOLIVE && S.date < GOLIVE) { toast('施工日期不能早於上線日 ' + GOLIVE); return false; }
    if (S.date > TODAY) { toast('施工日期不能晚於今天'); return false; }
    let reason = opt.reason || '';
    const lowering = changes.filter(c => newP(c) < val(c.li) - 1e-9);
    if (lowering.length && !reason) {
      reason = await askReason(lowering.length, meta.label);
      if (reason == null) return false;
    }
    const b = { type: 'submit', created: Date.now(), prev: [], payload: { date: S.date, level: meta.level || '代號', label: meta.label || '', reason, force: !!opt.force, items: [] } };
    changes.forEach(c => {
      const l = LOCS[c.li];
      const t = tagVals(c.li);
      b.prev.push([l.id, CUR[c.li] ? Object.assign({}, CUR[c.li]) : null]);
      b.payload.items.push(Object.assign({ uuid: uuid(), id: l.id }, l.tag ? { f: c.f, s: c.s, old: { f: t[0], s: t[1] } } : { p: c.p, old: { p: val(c.li) } }));
      CUR[c.li] = { p: newP(c), f: l.tag ? c.f : '', s: l.tag ? c.s : '', d: S.date, by: ME.name, pend: true };
    });
    OUTBOX.push(b); saveOutbox();
    render(); flush();
    return true;
  }

  function submitMaterial(ii, qty, note) {
    const o = ITEMS[ii];
    qty = Number(qty);
    if (!isFinite(qty) || qty === 0) { toast('請填到貨數量'); return; }
    if (S.date > TODAY) { toast('日期不能晚於今天'); return; }
    OUTBOX.push({ type: 'material', created: Date.now(), payload: { uuid: uuid(), lv: o.lv, date: S.date, qty, note: note || '' } });
    o.mat += qty; saveOutbox(); render(); flush();
  }

  // ---------- 對話框 ----------
  function dialog(html, onOpen) {
    const d = $('dlg'), f = $('dlgForm');
    f.innerHTML = html;
    return new Promise(res => {
      const close = () => { d.removeEventListener('close', close); res(d.returnValue); };
      d.addEventListener('close', close);
      d.returnValue = '';
      d.showModal();
      if (onOpen) onOpen(f);
    });
  }
  async function askReason(n, label) {
    const rv = await dialog(`<h3>完成% 比上次低</h3><p>${label ? esc(label) + '：' : ''}有 ${n} 筆會調低，請填原因（例如：拆除重做、上次填錯）。</p>
      <textarea id="reasonTxt" rows="3" maxlength="200" required></textarea>
      <div class="acts"><button class="btn" value="cancel" formnovalidate>取消</button><button class="btn pri" value="ok" id="reasonOk">確定</button></div>`,
      f => { f.querySelector('#reasonTxt').focus(); });
    if (rv !== 'ok') return null;
    const t = $('reasonTxt').value.trim();
    if (!t) { toast('沒有填原因，未儲存'); return null; }
    return t;
  }
  async function showHistory(ids, lv, title) {
    dialog(`<h3>${esc(title)}・修改紀錄</h3><div class="list" id="histList"><p class="muted">讀取中…</p></div><div class="acts"><button class="btn" value="close">關閉</button></div>`);
    try {
      const j = await api('history', { ids, lv });
      const nameOf = id => { const li = IDX[id]; if (li == null) return id; const l = LOCS[li]; return l.tag ? l.rid : ITEMS[l.ii].code + ' ' + l.rid; };
      const rows = j.records.map(r => `<div><span class="mono">${esc(r.date)}</span><span><b>${esc(nameOf(r.id))}</b> ${esc(fp(r.old === '' ? null : Number(r.old)))} → <b>${esc(fp(Number(r.p)))}</b> ${esc(r.detail || '')}<br><span class="muted">${esc(r.level)}・${esc(r.by)}・${esc(r.ts)}${r.reason ? '・原因：' + esc(r.reason) : ''}${r.note ? '・' + esc(r.note) : ''}</span></span></div>`);
      const mats = (j.materials || []).map(m => `<div><span class="mono">${esc(m.date)}</span><span>進料 <b class="mono">${esc(fmt(m.qty))}</b><br><span class="muted">${esc(m.by)}${m.note ? '・' + esc(m.note) : ''}</span></span></div>`);
      const el = $('histList');
      if (el) el.innerHTML = (rows.concat(mats).join('') || '<p class="muted">沒有紀錄。</p>') + (j.all ? '' : '<p class="muted">檢視者只看得到自己與期初推估的紀錄。</p>');
    } catch (e) {
      const el = $('histList'); if (el) el.innerHTML = `<p class="muted">讀取失敗：${esc(e.message || e.code)}</p>`;
    }
  }

  // ================= 輸入元件 =================
  function chips(li, cur, draft, attr) {
    attr = attr || 'set';
    const v = draft != null ? draft : cur;
    return `<div class="chips">${[0, 25, 50, 75, 100].map(x => `<button type="button" data-${attr}="${li}" data-v="${x}" class="${Math.abs(v - x) < 0.001 ? (draft != null && draft !== cur ? 'draft' : 'on') : ''}" aria-label="${x}%">${x}</button>`).join('')}<input class="pin" type="number" inputmode="decimal" min="0" max="100" step="1" value="${r2(v)}" data-${attr}in="${li}" id="in-${attr}-${li}" aria-label="完成百分比"></div>`;
  }
  function toggles(li, draft) {
    const st = ITEMS[LOCS[li].ii].tag, cur = tagVals(li), v = draft || cur;
    return `<div class="tg">${st.map((s, k) => {
      const on = v[k] >= 99.995, part = !on && v[k] > 0;
      const dr = draft && Math.abs(draft[k] - cur[k]) > 0.001;
      return `<button type="button" data-tg="${li}" data-k="${k}" class="${dr ? 'draft' : on ? 'on' : part ? 'part' : ''}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(s[0])}${part ? ' ' + fp(v[k]) : ''}</button>`;
    }).join('')}</div>`;
  }
  function bulkBar(label, scope) {
    return `<div class="bulk"><span>${esc(label)}</span><div class="chips">${[0, 25, 50, 75, 100].map(x => `<button type="button" data-bulk="${scope}" data-v="${x}">${x}</button>`).join('')}</div></div>`;
  }
  function codeLevel(ci, only) {
    const ids = only != null ? [only] : CATS[ci].items;
    return ids.map(i => {
      const o = ITEMS[i], cl = codeLoc(i);
      const g = sum(o.locs);
      return `<div class="mat"><div class="top"><span><span class="code">${esc(o.code)}</span><span class="muted" style="font-size:.78rem">${esc(o.short.slice(0, 24))}</span></span><span class="qty">圖面 ${fmt(o.total, o.unit)} ${esc(o.unit)}・完成 <b class="pct">${fp(g.p)}</b></span></div>
        <div class="row"><span><b>進料（佔 50%）</b> 累計 <b class="mono">${fmt(o.mat, o.unit)}</b>・進料比例 <b class="pct">${fp(matRatio(i) * 100)}</b>${o.matLast ? '・最後 ' + esc(o.matLast) : ''}</span><span style="flex:1"></span>
        <input class="pin" type="number" inputmode="decimal" step="any" placeholder="今日到貨" id="mat-${i}" aria-label="${esc(o.code)} 進料數量"><button type="button" class="btn" data-mat="${i}">登記進料</button><button type="button" class="btn sm" data-mhist="${i}">紀錄</button></div>
        ${cl != null ? `<div style="display:grid;gap:4px"><span style="font-size:.78rem">不分樓層（比例分配）${fmt(LOCS[cl].q, o.unit)} ${esc(o.unit)}・<b>施作完成 %</b>（佔 50%）${pendTag(cl)}</span>${chips(cl, val(cl), null, 'cl')}</div>` : ''}</div>`;
    }).join('');
  }

  // ================= 提示列 =================
  function bars() {
    let h = '';
    if (CF) h += `<div class="cf" role="alert"><span>將「${esc(CF.label)}」共 ${CF.n} 筆設為 <b>${CF.v}%</b>，其中 ${CF.diff} 筆原本是其他值，會被覆蓋。</span><button type="button" class="btn" data-cf="no">取消</button><button type="button" class="btn pri" data-cf="ok">確定覆蓋</button></div>`;
    if (CONFLICTS.length) {
      const ex = CONFLICTS.slice(0, 3).map(c => {
        const l = LOCS[c.li], o = ITEMS[l.ii];
        const mine = l.tag ? tagP(l, c.mine.f, c.mine.s) : c.mine.p;
        return `${esc(l.fl)} ${esc(l.tag ? l.rid : l.rid + ' ' + o.code)}：你 ${fp(mine)}／目前 ${fp(Number(c.server[0]))}（${esc(c.server[4] || '')}）`;
      }).join('；');
      h += `<div class="cf bad" role="alert"><span>${CONFLICTS.length} 筆在你送出前已被別人修改，未儲存。${ex}${CONFLICTS.length > 3 ? '…' : ''}</span><button type="button" class="btn" data-cfl="server">採用目前值</button><button type="button" class="btn pri" data-cfl="mine">以我的為準重送</button></div>`;
    }
    if (GOLIVE && TODAY < GOLIVE) h += `<div class="cf"><span>尚未到上線日 ${esc(GOLIVE)}，目前不能登記。</span></div>`;
    return h;
  }

  // ================= 版面 A：手機逐層點選 =================
  function renderA() {
    const s = S.a; let crumb = [], title = '', body = '', back = '', foot = '', sub = '';
    if (s.view === 'cat') {
      title = '選擇工項';
      body = `<div class="grid">${CATS.map(C => { const g = sum(C.rooms.flatMap(r => ROOMS[r].locs)); return `<button type="button" class="tile" data-a="cat" data-ci="${C.ci}"><b>${esc(C.cat)}</b><span class="muted" style="font-size:.74rem">${C.items.length} 個代號・${C.floors.length} 層</span>${bar(g.p)}<span class="pct" style="font-size:.8rem">${sumTxt(g)}</span></button>`; }).join('')}</div>`;
    } else if (s.view === 'fl') {
      const C = CATS[s.ci]; title = C.cat; back = 'cat'; crumb = [['cat', '工項']];
      body = `<p class="note">完成% ＝ 進料 50%（代號層整批登記到貨數量）＋ 施作 50%（各房間填的「施作完成 %」）</p><button type="button" class="rowbtn" data-a="fl" data-fl="${CODE_FL}"><div class="top"><span><b>代號層</b>　<span class="muted" style="font-size:.78rem">進料${C.hasCodeLevel ? '・不分樓層' : ''}</span></span><span class="muted" style="font-size:.78rem">${C.items.length} 個代號 ›</span></div></button>` +
        C.floors.map(f => { const R = floorRooms(s.ci, f), g = sum(R.flatMap(r => r.locs)); return `<button type="button" class="rowbtn" data-a="fl" data-fl="${esc(f)}"><div class="top"><span><b class="mono">${esc(f)}</b>　<span class="muted" style="font-size:.78rem">${R.length} ${C.hasTag ? '組' : '間'}・${g.n} 筆</span></span><span><span class="qty" style="font-size:.78rem;margin-right:8px">${qtyTotal(R.flatMap(r => r.locs))}</span><span class="pct">${sumTxt(g)}</span></span></div>${bar(g.p)}</button>`; }).join('');
    } else if (s.view === 'code') {
      const C = CATS[s.ci]; title = C.cat + '・代號層'; back = 'fl'; crumb = [['cat', '工項'], ['fl', C.cat]];
      body = codeLevel(s.ci);
    } else if (s.view === 'room') {
      const C = CATS[s.ci]; title = C.cat + '・' + s.fl; back = 'fl'; crumb = [['cat', '工項'], ['fl', C.cat]];
      const q = s.q.toLowerCase();
      const R = floorRooms(s.ci, s.fl).filter(r => !q || (r.rid + ' ' + r.nm + ' ' + r.locs.map(l => LOCS[l].tag ? LOCS[l].rid + LOCS[l].nm : ITEMS[LOCS[l].ii].code).join(' ')).toLowerCase().includes(q));
      body = bulkBar(`整層施作設為（${floorLocs(s.ci, s.fl).length} 筆）`, 'a-floor') +
        `<div class="search"><input id="a-search" type="search" placeholder="${C.hasTag ? '搜尋代號或標籤' : '搜尋房號、空間或代號'}" value="${esc(s.q)}" data-asearch="1" aria-label="搜尋"></div>` +
        (R.length ? R.map(r => { const g = sum(r.locs); return `<button type="button" class="rowbtn" data-a="room" data-ri="${r.ri}"><div class="top"><span class="nm">${roomTitle(r)}</span><span class="pct">${sumTxt(g)}</span></div>${roomCodes(r)}</button>`; }).join('') : '<p class="empty">沒有符合的項目。</p>');
    } else {
      const r = ROOMS[s.ri], C = CATS[s.ci];
      title = r.kind === '代號組' ? r.rid + '・' + s.fl : r.rid + ' ' + r.nm; back = 'room'; crumb = [['cat', '工項'], ['fl', C.cat], ['room', s.fl]];
      sub = `<div class="crumb" style="margin-top:2px">${esc(r.fl)}・施工日期 <span class="mono">${esc(S.date)}</span>・<button type="button" data-a="hist">修改紀錄</button></div>`;
      body = bulkBar(r.kind === '代號組' ? `整組施作設為（${r.locs.length} 樘）` : '整間施作設為', 'a-room') + r.locs.map(li => {
        const l = LOCS[li], o = ITEMS[l.ii], dr = s.draft[li];
        const curV = l.tag ? tagVals(li) : val(li);
        const ch = dr != null && JSON.stringify(dr) !== JSON.stringify(curV);
        const last = `<span class="sub">${l.tag ? '施作（框／扇）' : '施作完成 %'}（佔 50%）・含進料 ${fp(matRatio(l.ii) * 100)} 後完成 ${fp(eff(li))}${CUR[li] && CUR[li].d ? `・最後 ${esc(CUR[li].d)} ${esc(CUR[li].by)}` : ''}</span>`;
        const head = l.tag
          ? `<span><b class="mono">${esc(l.rid)}</b> <span class="muted" style="font-size:.75rem">${esc(l.nm)}</span>${pendTag(li)}</span><span class="area"><small>施作</small> ${fp(dr ? tagP(l, dr[0], dr[1]) : val(li))}</span>`
          : `<span><span class="code">${esc(o.code)}</span><span class="muted" style="font-size:.78rem">${esc(o.short.slice(0, 20))}</span>${pendTag(li)}</span><span class="area">${fmt(l.q, o.unit)} <small>${esc(o.unit)}</small></span>`;
        return `<div class="codeRow ${ch ? 'changed' : ''}"><div class="top">${head}</div>${l.tag ? toggles(li, dr) : chips(li, val(li), dr)}${last}</div>`;
      }).join('');
      const n = Object.keys(s.draft).filter(k => { const l = LOCS[k]; return JSON.stringify(s.draft[k]) !== JSON.stringify(l.tag ? tagVals(+k) : val(+k)); }).length;
      foot = `<div class="ft"><span class="sp">${n ? `${n} 筆未儲存` : '改過的會標黃，按儲存才送出'}</span>${n ? '<button type="button" class="btn" data-a="cancel">取消</button>' : ''}<button type="button" class="btn pri" data-a="save" ${n ? '' : 'disabled'}>儲存</button></div>`;
    }
    return `<div class="pa"><div class="hd">${crumb.length ? `<div class="crumb">${crumb.map(([v, t]) => `<button type="button" data-a="go" data-v="${v}">${esc(t)}</button><span>›</span>`).join('')}</div>` : ''}<div class="ttl">${back ? `<button type="button" class="back" data-a="go" data-v="${back}" aria-label="上一層">‹</button>` : ''}<span class="nm">${esc(title)}</span></div>${sub}</div><div class="body" data-keep="a-body">${body}</div>${foot}</div>`;
  }

  // ================= 版面 C：房間 × 代號矩陣 =================
  function renderC() {
    const s = S.c, C = CATS[s.ci];
    if (!s.fl || (s.fl !== CODE_FL && !C.floors.includes(s.fl))) s.fl = C.floors[0] || CODE_FL;
    const flChips = `<div class="flchips"><button type="button" class="${s.fl === CODE_FL ? 'on' : ''}" data-c="fl" data-fl="${CODE_FL}" style="font-family:var(--font)">代號層<small>進料</small></button>${C.floors.map(f => `<button type="button" class="${f === s.fl ? 'on' : ''}" data-c="fl" data-fl="${esc(f)}">${esc(f)}<small>${sumTxt(sum(floorLocs(s.ci, f)))}</small></button>`).join('')}</div>`;
    let sheet;
    if (s.fl === CODE_FL) sheet = codeLevel(s.ci);
    else if (C.hasTag) {
      const R = floorRooms(s.ci, s.fl);
      sheet = `<table class="mx"><thead><tr><th>代號</th><th>標籤</th><th>位置</th><th class="cc">框</th><th class="cc">扇／五金</th><th class="n">完成</th></tr></thead><tbody>${R.map(r => r.locs.map((li, k) => {
        const l = LOCS[li], st = ITEMS[l.ii].tag, t = tagVals(li);
        return `<tr>${k === 0 ? `<td rowspan="${r.locs.length}" class="mono" style="vertical-align:top"><b>${esc(r.rid)}</b><br><button type="button" class="btn sm" data-c="row" data-ri="${r.ri}">整組 100</button></td>` : ''}<td class="mono">${esc(l.rid)}${pendTag(li)}</td><td class="muted" style="font-size:.78rem">${esc(l.nm)}</td>${st.map((x, j) => `<td class="cell"><label style="display:flex;gap:4px;align-items:center;justify-content:center;font-size:.74rem;cursor:pointer"><input type="checkbox" ${t[j] >= 99.995 ? 'checked' : ''} data-tgc="${li}" data-k="${j}" id="c-tg-${li}-${j}">${esc(x[0].slice(0, 5))}${t[j] > 0 && t[j] < 99.995 ? ' ' + fp(t[j]) : ''}</label></td>`).join('')}<td class="n">${fp(val(li))}</td></tr>`;
      }).join('')).join('')}</tbody></table>`;
    } else {
      const R = floorRooms(s.ci, s.fl);
      const codes = C.items.filter(i => ITEMS[i].floors.includes(s.fl));
      const g = sum(R.flatMap(r => r.locs));
      const cell = (r, i) => {
        const li = r.locs.find(l => LOCS[l].ii === i);
        if (li == null) return '<td class="na">·</td>';
        const o = ITEMS[i];
        return `<td class="cell ${val(li) >= 99.995 ? 'done' : ''}"><input class="pin" type="number" inputmode="decimal" min="0" max="100" step="1" value="${r2(val(li))}" data-setin="${li}" id="c-in-${li}" aria-label="${esc(r.rid)} ${esc(o.code)}"><small>${fmt(LOCS[li].q, o.unit)}${CUR[li] && CUR[li].pend ? '・待送' : ''}</small></td>`;
      };
      sheet = `<table class="mx"><thead><tr><th class="sticky">房號</th><th>空間</th>${codes.map(i => { const o = ITEMS[i]; return `<th class="cc" title="${esc(o.name)}">${esc(o.code)}<small>${esc(o.unit)}</small><button type="button" class="btn sm" data-c="col" data-ii="${i}">整欄施作 100</button></th>`; }).join('')}<th class="n" title="含進料 50%">房間完成</th><th></th></tr></thead>
        <tbody>${R.map(r => `<tr><td class="mono sticky"><b>${esc(r.rid)}</b></td><td>${esc(r.nm)}${kindTag(r.kind)}</td>${codes.map(i => cell(r, i)).join('')}<td class="n">${sumTxt(sum(r.locs))}</td><td><button type="button" class="btn sm" data-c="row" data-ri="${r.ri}">整列施作 100</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2" style="text-align:left">本層代號完成率</td>${codes.map(i => `<td>${fp(sum(itemFloorLocs(i, s.fl)).p)}</td>`).join('')}<td>${sumTxt(g)}</td><td></td></tr></tfoot></table>`;
    }
    return `<div class="pc"><div class="tools"><select class="sel" id="c-cat" data-csel="cat" aria-label="工項">${CATS.map(x => `<option value="${x.ci}" ${x.ci === s.ci ? 'selected' : ''}>${esc(x.cat)}</option>`).join('')}</select>${flChips}</div>
      ${s.fl === CODE_FL ? '' : bulkBar(`${s.fl} 整層施作設為（${floorLocs(s.ci, s.fl).length} 筆）`, 'c-floor')}
      ${s.fl === CODE_FL ? '' : '<p class="note">格子裡填的是「施作完成 %」（佔 50%）；右側「房間完成」與下方本層完成率已含進料 50%（依代號層進料比例）。</p>'}
      <div class="sheet" data-keep="c-sheet">${sheet}</div></div>`;
  }

  // ================= 版面 E：熱力圖總覽 =================
  function renderE() {
    const s = S.e, C = CATS[s.ci];
    const fls = (C.hasCodeLevel ? [CODE_FL] : []).concat(C.floors);
    const all = C.rooms.flatMap(r => ROOMS[r].locs);
    const g = sum(all);
    const rooms = C.rooms.map(r => ROOMS[r]).filter(r => r.fl !== CODE_FL);
    const roomsDone = rooms.filter(r => r.locs.every(l => eff(l) >= 99.995)).length;
    const itemsDone = C.items.filter(i => sum(ITEMS[i].locs).p >= 99.995).length;
    const fa = C.floors.map(f => { const L = floorLocs(s.ci, f); const x = sum(L); return { f, p: x.mixed ? L.reduce((a, l) => a + val(l), 0) / L.length : x.p, mixed: x.mixed }; }).sort((a, b) => a.p - b.p)[0];
    let drawer = '';
    if (s.open) {
      const [ii, f] = s.open, o = ITEMS[ii];
      if (f === CODE_FL) {
        drawer = `<div class="dh"><div style="flex:1;min-width:0"><div class="muted" style="font-size:.74rem">${esc(C.cat)}・代號層</div><b><span class="code">${esc(o.code)}</span>${esc(o.short.slice(0, 26))}</b></div><button type="button" class="btn" data-e="close" aria-label="關閉">✕</button></div><div class="db">${codeLevel(s.ci, ii)}</div>`;
      } else {
        const R = floorRooms(s.ci, f).filter(r => r.locs.some(l => LOCS[l].ii === ii));
        const x = sum(itemFloorLocs(ii, f));
        drawer = `<div class="dh"><div style="flex:1;min-width:0"><div class="muted" style="font-size:.74rem">${esc(C.cat)}・${esc(f)}</div><b><span class="code">${esc(o.code)}</span>${esc(o.short.slice(0, 26))}</b><div class="qty" style="font-size:.76rem">${fmt(x.d, o.unit)} / ${fmt(x.q, o.unit)} ${esc(o.unit)}（${fp(x.p)}）・${R.length} ${C.hasTag ? '組' : '間'}</div></div><button type="button" class="btn" data-e="close" aria-label="關閉">✕</button></div>
          ${bulkBar(`${o.code} ${f} 整層施作設為`, 'e-cell')}
          <div class="db" data-keep="e-db">${R.map(r => `<div style="padding:9px 14px;border-bottom:1px solid var(--line2);display:grid;gap:6px"><span>${roomTitle(r)}</span>${r.locs.filter(li => LOCS[li].ii === ii).map(li => { const l = LOCS[li]; return `<div class="hl" style="display:grid;gap:3px;padding:4px 6px"><span style="font-size:.78rem">${l.tag ? `<b class="mono">${esc(l.rid)}</b> <span class="muted">${esc(l.nm)}</span>` : `<span class="code">${esc(o.code)}</span><span class="qty">${fmt(l.q, o.unit)} ${esc(o.unit)}</span>`}${pendTag(li)}</span>${l.tag ? toggles(li) : chips(li, val(li), null, 'set')}</div>`; }).join('')}</div>`).join('')}</div>`;
      }
    }
    return `<div class="pe"><div class="kpis"><div><b>${g.mixed ? g.done + '/' + g.n : fp(g.p)}</b><span>${esc(C.cat)} ${g.mixed ? '完成筆數（單位不同不加權）' : '數量完成率'}</span></div><div><b>${roomsDone} / ${rooms.length}</b><span>${C.hasTag ? '全部完成的代號組' : '全部代號完成的房間'}</span></div><div><b>${itemsDone} / ${C.items.length}</b><span>已完成代號</span></div><div><b>${fa ? esc(fa.f) + '・' + fp(fa.p) : '—'}</b><span>最落後樓層${fa && fa.mixed ? '（各筆平均）' : ''}</span></div></div>
      <div class="tools"><div class="flchips">${CATS.map(x => `<button type="button" class="${x.ci === s.ci ? 'on' : ''}" data-e="cat" data-ci="${x.ci}" style="font-family:var(--font)">${esc(x.cat)}<small>${sumTxt(sum(x.rooms.flatMap(r => ROOMS[r].locs)))}</small></button>`).join('')}</div></div>
      <div class="hm" data-keep="e-hm"><table><thead><tr><th class="rh">代號 ＼ 樓層</th>${fls.map(f => `<th>${esc(f)}</th>`).join('')}<th>網站</th><th>正式版</th><th title="網站累計 − 正式版使用數量（載入時）">差異</th></tr></thead><tbody>${C.items.map(i => {
        const o = ITEMS[i];
        const w = sum(o.locs).p;
        const op = o.official != null && o.total ? o.official / o.total * 100 : null;
        let diff = o.web != null && o.official != null ? r2(o.web - o.official) : null;
        if (diff != null && Math.abs(diff) < 0.005) diff = 0;
        return `<tr><th class="rh" title="${esc(o.name)}"><span class="code">${esc(o.code)}</span><span class="muted">${esc(o.short.slice(0, 14))}</span></th>${fls.map(f => {
          const L = itemFloorLocs(i, f);
          if (!L.length) return f === CODE_FL ? `<td><button type="button" data-e="cell" data-ii="${i}" data-fl="${CODE_FL}" style="background:transparent;border:1px dashed var(--line)" aria-label="${esc(o.code)} 進料">進料</button></td>` : '<td><span class="na"></span></td>';
          const p = sum(L).p;
          return `<td><button type="button" data-e="cell" data-ii="${i}" data-fl="${esc(f)}" style="background:${heat(p)};color:${heatInk(p)}" aria-label="${esc(o.code)} ${esc(f)} ${fp(p)}">${Math.round(p)}</button></td>`;
        }).join('')}<td class="v pct">${fp(w)}</td><td class="v ${op > 100.01 ? 'diffbad' : ''}" title="正式版使用數量 ${o.official == null ? '—' : fmt(o.official, o.unit)} ÷ 圖面 ${fmt(o.total, o.unit)}">${fp(op)}</td><td class="v ${diff ? 'diffbad' : ''}">${diff == null ? '—' : fmt(diff, o.unit)}</td></tr>`;
      }).join('')}</tbody></table>
      <p class="muted" style="font-size:.74rem;margin-top:8px">網站＝圖面完成率（進料 50% × 進料比例 ＋ 施作 50% × 施作完成%）；格子＝各層完成率（含進料）；正式版＝正式版使用數量 ÷ 圖面合計（紅字超過 100%）；差異＝網站累計 − 正式版使用數量（數量，載入時的值，非 0 標紅由內業判斷）。上線日 ${esc(GOLIVE || '未設定')}・數量版本 ${esc(VERSION)}</p></div>
      <div class="drawer ${s.open ? 'open' : ''}">${drawer}</div></div>`;
  }

  // ================= 繪製 =================
  const stage = () => $('stage');
  function render() {
    if ($('app').hidden || !ME) return;
    $('bars').innerHTML = bars();
    const st = stage();
    const keep = {};
    st.querySelectorAll('[data-keep]').forEach(n => { keep[n.dataset.keep] = [n.scrollTop, n.scrollLeft]; });
    const ae = document.activeElement, fid = ae && st.contains(ae) ? ae.id : null;
    const y = window.scrollY;
    st.innerHTML = { A: renderA, C: renderC, E: renderE }[S.tab]();
    st.querySelectorAll('[data-keep]').forEach(n => { const k = keep[n.dataset.keep]; if (k) { n.scrollTop = k[0]; n.scrollLeft = k[1]; } });
    window.scrollTo(0, y);
    if (fid) { const n = $(fid); if (n) { n.focus({ preventScroll: true }); if (n.type === 'search') n.setSelectionRange(n.value.length, n.value.length); } }
    [...$('tabs').children].forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
    setNet();
  }

  function bulkScope(scope) {
    if (scope === 'a-floor') return [floorLocs(S.a.ci, S.a.fl), `${CATS[S.a.ci].cat} ${S.a.fl} 整層`, '樓層'];
    if (scope === 'c-floor') return [floorLocs(S.c.ci, S.c.fl), `${CATS[S.c.ci].cat} ${S.c.fl} 整層`, '樓層'];
    if (scope === 'e-cell') { const [ii, f] = S.e.open; return [itemFloorLocs(ii, f), `${ITEMS[ii].code} ${f} 整層`, '樓層']; }
  }
  function draftFromV(li, v) { const c = changeFor(li, v); return LOCS[li].tag ? [c.f, c.s] : c.p; }

  // ================= 事件 =================
  function wire() {
    $('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; CF = null; render(); });
    $('workDate').addEventListener('change', e => {
      const v = e.target.value;
      if (!v || v > TODAY || (GOLIVE && v < GOLIVE)) { toast(GOLIVE ? `施工日期要在 ${GOLIVE} 到 ${TODAY} 之間` : '施工日期不能晚於今天'); e.target.value = S.date; return; }
      S.date = v; render();
    });
    $('bars').addEventListener('click', onClick);
    stage().addEventListener('click', onClick);
    stage().addEventListener('change', onChange);
    stage().addEventListener('input', e => { if (e.target.dataset.asearch) { S.a.q = e.target.value; render(); } });
    stage().addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('mat-')) { e.preventDefault(); const i = +e.target.id.slice(4); submitMaterial(i, e.target.value); }
    });
    const menu = $('menu'), mb = $('menuBtn');
    mb.addEventListener('click', () => { menu.hidden = !menu.hidden; mb.setAttribute('aria-expanded', !menu.hidden); });
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== mb) { menu.hidden = true; mb.setAttribute('aria-expanded', 'false'); } });
    menu.addEventListener('click', async e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      menu.hidden = true; mb.setAttribute('aria-expanded', 'false');
      const m = b.dataset.m;
      if (m === 'reload') reload();
      else if (m === 'flush') { NET = 'on'; flush(); }
      else if (m === 'recalc') { try { const j = await api('recalc', {}); toast('已重算 ' + (j.result.levels || 0) + ' 個層級'); } catch (er) { toast('重算失敗：' + (er.message || er.code)); } }
      else if (m === 'demoOffline') { const off = window.Demo.toggleOffline(); toast(off ? '示範：已模擬斷線，登記會留在待送佇列' : '示範：已恢復連線'); if (!off) { NET = 'on'; flush(); } }
      else if (m === 'demoOther') { const r = window.Demo.otherUser(); toast('示範：別人剛改了 ' + r.join('、') + '，網頁還不知道；去改這些房間試試衝突提示', 6000); }
      else if (m === 'demoReset') { window.Demo.reset(); OUTBOX = []; saveOutbox(); CONFLICTS = []; reload(); }
      else if (m === 'logout') logout();
    });
  }

  async function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.cf) { if (d.cf === 'ok' && CF) { const c = CF; CF = null; render(); commit(c.changes, { level: c.level, label: c.label }); } else { CF = null; render(); } return; }
    if (d.cfl) {
      const list = CONFLICTS; CONFLICTS = [];
      if (d.cfl === 'mine') {
        const reason = list.map(c => c.reason).find(Boolean) || '';
        await commit(list.map(c => Object.assign({ li: c.li }, c.mine)), { level: list[0].level, label: '衝突重送' }, { force: true, reason });
      } else render();
      return;
    }
    if (d.bulk) {
      if (d.bulk === 'a-room') { ROOMS[S.a.ri].locs.forEach(li => { S.a.draft[li] = draftFromV(li, +d.v); }); render(); return; }
      const [locs, label, level] = bulkScope(d.bulk); askBulk(locs, +d.v, label, level); return;
    }
    if (d.set !== undefined) {
      const li = +d.set;
      if (S.tab === 'A' && S.a.view === 'loc') { S.a.draft[li] = draftFromV(li, +d.v); render(); }
      else commit([changeFor(li, +d.v)], { level: '代號', label: ITEMS[LOCS[li].ii].code + ' ' + LOCS[li].rid });
      return;
    }
    if (d.cl !== undefined) { const li = +d.cl; commit([changeFor(li, +d.v)], { level: '代號層', label: ITEMS[LOCS[li].ii].code + ' 不分樓層' }); return; }
    if (d.tg !== undefined) {
      const li = +d.tg, k = +d.k;
      if (S.tab === 'A' && S.a.view === 'loc') { const base = (S.a.draft[li] || tagVals(li)).slice(); base[k] = base[k] >= 99.995 ? 0 : 100; S.a.draft[li] = base; render(); }
      else { const t2 = tagVals(li).slice(); t2[k] = t2[k] >= 99.995 ? 0 : 100; commit([{ li, f: t2[0], s: t2[1] }], { level: '代號', label: LOCS[li].rid }); }
      return;
    }
    if (d.mat !== undefined) { const n = $('mat-' + d.mat); submitMaterial(+d.mat, n && n.value); return; }
    if (d.mhist !== undefined) { const o = ITEMS[+d.mhist]; const cl = codeLoc(+d.mhist); showHistory(cl != null ? [LOCS[cl].id] : [], o.lv, o.code + ' 代號層'); return; }
    if (d.a) {
      const s = S.a; CF = null;
      if (d.a === 'cat') { s.ci = +d.ci; s.view = 'fl'; }
      else if (d.a === 'fl') { s.fl = d.fl; s.view = d.fl === CODE_FL ? 'code' : 'room'; s.q = ''; }
      else if (d.a === 'room') { s.ri = +d.ri; s.view = 'loc'; s.draft = {}; }
      else if (d.a === 'go') { if (Object.keys(s.draft).length && !confirm('有未儲存的變更，確定離開？')) return; s.view = d.v; s.draft = {}; }
      else if (d.a === 'cancel') s.draft = {};
      else if (d.a === 'hist') { const r = ROOMS[s.ri]; showHistory(r.locs.map(l => LOCS[l].id), '', r.rid + ' ' + r.nm); return; }
      else if (d.a === 'save') {
        const ch = [];
        Object.keys(s.draft).forEach(k => { const li = +k, v = s.draft[k]; ch.push(LOCS[li].tag ? { li, f: v[0], s: v[1] } : { li, p: v }); });
        const r = ROOMS[s.ri];
        const ok = await commit(ch, { level: '房間', label: `${CATS[s.ci].cat} ${r.fl} ${r.rid}` });
        if (ok) s.draft = {};
      }
      window.scrollTo(0, 0);
      render(); return;
    }
    if (d.c) {
      const s = S.c;
      if (d.c === 'fl') { s.fl = d.fl; CF = null; render(); }
      else if (d.c === 'col') askBulk(itemFloorLocs(+d.ii, s.fl), 100, `${ITEMS[+d.ii].code} ${s.fl} 整欄`, '樓層');
      else if (d.c === 'row') { const r = ROOMS[+d.ri]; askBulk(r.locs, 100, `${r.rid} 整列`, '房間'); }
      return;
    }
    if (d.e) {
      const s = S.e; CF = null;
      if (d.e === 'cat') { s.ci = +d.ci; s.open = null; }
      else if (d.e === 'cell') s.open = [+d.ii, d.fl];
      else if (d.e === 'close') s.open = null;
      render(); return;
    }
  }

  function onChange(e) {
    const t = e.target, d = t.dataset;
    if (d.setin !== undefined) {
      const li = +d.setin;
      if (t.value === '') { t.value = r2(val(li)); return; }
      if (S.tab === 'A' && S.a.view === 'loc') { S.a.draft[li] = draftFromV(li, t.value); render(); }
      else commit([changeFor(li, t.value)], { level: '代號', label: ITEMS[LOCS[li].ii].code + ' ' + LOCS[li].rid }).then(ok => { if (!ok) render(); });
    } else if (d.clin !== undefined) {
      const li = +d.clin; commit([changeFor(li, t.value)], { level: '代號層', label: ITEMS[LOCS[li].ii].code + ' 不分樓層' }).then(ok => { if (!ok) render(); });
    } else if (d.tgc !== undefined) {
      const li = +d.tgc, k = +d.k; const t2 = tagVals(li).slice(); t2[k] = t.checked ? 100 : 0;
      commit([{ li, f: t2[0], s: t2[1] }], { level: '代號', label: LOCS[li].rid }).then(ok => { if (!ok) render(); });
    } else if (d.csel === 'cat') { S.c.ci = +t.value; S.c.fl = null; CF = null; render(); }
  }

  // ================= 啟動 =================
  async function start() {
    $('login').hidden = true; $('app').hidden = false;
    $('demoTag').hidden = !DEMO;
    document.querySelectorAll('[data-m^="demo"]').forEach(b => { b.hidden = !DEMO; });
    $('stage').innerHTML = '<p class="empty">讀取資料中…</p>';
    try {
      const j = await api('bootstrap', {});
      ME = j.user;
      loadOutbox();
      ingest(j);
    } catch (e) {
      if (e.code === 'forbidden') { showLogin(`${e.email || ''} 沒有權限：${e.message || '請向管理者申請權限'}`); return; }
      if (e.code === 'auth') { needLogin(e.message); afterLogin = start; return; }
      let pending = 0;
      try { pending = JSON.parse(localStorage.getItem(obKey()) || '[]').length; } catch (x) { /* 忽略 */ }
      $('stage').innerHTML = `<p class="empty">讀取失敗：${esc(e.message || e.code)}。${pending ? `手機裡還有 ${pending} 批未送出的登記，連線後按重試會自動送出。` : ''}<button type="button" class="btn" id="retryBtn">重試</button></p>`;
      $('retryBtn').onclick = start;
      return;
    }
    $('who').textContent = ME.name + (ME.role === 'editor' ? '（編輯者）' : '');
    $('who').title = ME.email;
    document.querySelector('[data-m="recalc"]').hidden = ME.role !== 'editor';
    const wd = $('workDate');
    wd.max = TODAY; if (GOLIVE) wd.min = GOLIVE;
    if (S.date > TODAY) S.date = TODAY;
    if (GOLIVE && S.date < GOLIVE) S.date = TODAY;
    wd.value = S.date;
    if (S.a.ci != null && !CATS[S.a.ci]) S.a = { view: 'cat', ci: null, fl: null, ri: null, q: '', draft: {} };
    if (!CATS[S.c.ci]) S.c.ci = 0;
    if (!CATS[S.e.ci]) S.e.ci = 0;
    if (window.innerWidth >= 900 && !start.done) S.tab = 'E';
    start.done = true;
    render();
    flush();
  }
  async function reload() { CF = null; await start(); }
  function logout() {
    if (OUTBOX.length && !confirm(`還有 ${OUTBOX.length} 批登記沒送出，登出後會留在這支手機，下次用同一帳號登入時才會送出。確定登出？`)) return;
    try { sessionStorage.removeItem('idtoken'); sessionStorage.removeItem('demo'); } catch (e) { /* 忽略 */ }
    if (!DEMO && window.google && google.accounts) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  function boot() {
    wire();
    $('demoBtn').addEventListener('click', () => { DEMO = true; try { sessionStorage.setItem('demo', '1'); } catch (e) { /* 忽略 */ } start(); });
    const qs = new URLSearchParams(location.search);
    let demoSaved = false;
    try { demoSaved = sessionStorage.getItem('demo') === '1'; } catch (e) { /* 忽略 */ }
    if (qs.get('demo') === '1' || demoSaved) { DEMO = true; start(); return; }
    let t = null;
    try { t = sessionStorage.getItem('idtoken'); } catch (e) { /* 忽略 */ }
    if (t) { setToken(t); if (tokenValid()) { start(); return; } }
    showLogin();
  }
  boot();
})();
