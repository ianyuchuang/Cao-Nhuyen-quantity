/**
 * 網頁應用程式進入點
 * 前端一律用 POST、Content-Type: text/plain（避開 CORS 預檢），內容為 JSON：
 *   { action, token, ...參數 }
 * GET 只用來檢查服務是否上線，不接受 token（避免憑證留在網址與紀錄裡）。
 */

var MAX_BODY = 1024 * 1024; // 1 MB

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return json_({ ok: false, error: 'method', message: '請用 POST' });
  return json_({ ok: true, service: '工項進度登記 API' });
}

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) || '';
  if (body.length > MAX_BODY) return json_({ ok: false, error: 'bad_request', message: '請求太大' });
  var req;
  try { req = JSON.parse(body || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_request', message: '請求格式錯誤' }); }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return json_({ ok: false, error: 'bad_request', message: '請求格式錯誤' });
  return json_(handle_(req));
}

function handle_(req) {
  try {
    var user = verifyToken_(req.token);
    var role = roleOf_(user.email);
    if (!role) {
      var reg = registerPending_(user);
      var msg = reg === 'added' ? '已送出使用申請，請管理者在試算表「人員」表把你的狀態改成「核准」'
        : reg === 'pending' ? '使用申請等待管理者核准中（試算表「人員」表狀態改成「核准」後即可使用）'
        : reg === 'disabled' ? '這個帳號已被停用，請洽管理者' : '請向管理者申請權限';
      return { ok: false, error: 'forbidden', message: msg, email: user.email };
    }
    rateLimit_(user.email);
    user.role = role;
    user.name = displayName_(user);
    switch (req.action) {
      case 'bootstrap': return bootstrap_(user);
      case 'submit': return submit_(user, req);
      case 'material': return material_(user, req);
      case 'history': return history_(user, req);
      case 'recalc':
        if (role !== 'editor') return { ok: false, error: 'forbidden', message: '只有試算表編輯者可以全部重算' };
        return { ok: true, result: recalcAll_() };
      default: return { ok: false, error: 'bad_request', message: '未知的動作' };
    }
  } catch (err) {
    if (!err || !err.code) {
      console.error(err && err.stack || err);
      return { ok: false, error: 'server', message: '伺服器發生錯誤，請稍後再試' };
    }
    return { ok: false, error: err.code, message: err.message };
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- bootstrap ----------
/**
 * 回傳位置與目前進度（層級、項目、單位照表；不含單價、複價）。
 * items: [層級, 項目, 單位, 工項, 代號, 細項(門窗)或 null, 網站累計, 正式版使用數量, 期初, 進料累計, 最後進料日]
 * locs:  [位置ID, items 索引, 樓層, 房號／標籤序號, 空間名稱, 類型, 圖面數量, 房間ID]
 * cur:   { 位置ID: [完成%, 框, 扇, 最後施工日期, 最後登記人] }
 */
function bootstrap_(user) {
  var L = loadLocations_();
  var cur = loadCurrent_();
  var daily = dailySummary_();
  var mats = materialSummary_();

  var items = L.items.map(function (it) {
    var d = daily[it.lv] || {};
    var m = mats[it.lv] || { sum: 0, last: '' };
    return [it.lv, it.name, it.unit, it.cat, it.code, it.tag, d.web, d.official, d.opening, round_(m.sum, 3), m.last];
  });
  var idx = {};
  L.items.forEach(function (it, i) { idx[it.lv] = i; });
  var locs = L.locs.map(function (l) { return [l.id, idx[l.lv], l.fl, l.rid, l.nm, l.kind, l.q, l.room]; });
  var c = {};
  Object.keys(cur.byId).forEach(function (id) {
    var r = cur.byId[id];
    if (r.p === '' && !r.d) return;
    c[id] = [r.p === '' ? 0 : r.p, r.f, r.s, r.d, r.by];
  });
  return {
    ok: true,
    user: { email: user.email, name: user.name, role: user.role },
    goLive: goLive_(),
    today: todayStr_(),
    version: trim_(getSetting_('數量版本')),
    items: items, locs: locs, cur: c
  };
}

// ---------- submit ----------
/**
 * req: { date:'yyyy-MM-dd', level:'樓層'|'房間'|'代號'|'代號層'|..., label, reason, force,
 *        items:[{ uuid, id, p | (f, s), old:{p} | {f,s}, reason, note }] }
 * 回傳：saved（已寫入的 uuid）、dup（先前已寫入的 uuid）、conflicts、rejected、cur（最新狀態）
 */
function submit_(user, req) {
  var list = Array.isArray(req.items) ? req.items : [];
  if (!list.length) return { ok: true, saved: [], dup: [], conflicts: [], rejected: [], cur: {} };
  if (list.length > 3000) throw apiError_('bad_request', '一次最多 3000 筆');
  var date = dateStr_(req.date);
  var today = todayStr_();
  var goLive = goLive_();
  if (!date) throw apiError_('bad_request', '施工日期格式錯誤');
  if (date > today) throw apiError_('bad_request', '施工日期不能晚於今天');
  if (goLive && date < goLive) throw apiError_('bad_request', '施工日期不能早於上線日 ' + goLive);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw apiError_('busy', '目前登記的人較多，請稍後再試（資料已保留在手機，會自動重送）');
  try {
    var L = loadLocations_();
    var cur = loadCurrent_();
    var logSh = sheet_(CFG.SH.LOG);
    var seen = uuidSet_(logSh, LOG_COL.UUID);
    var now = new Date();
    var rows = [], saved = [], dup = [], conflicts = [], rejected = [], touched = Object.create(null), levels = Object.create(null);
    var batchReason = safeText_(req.reason);
    var level = ({ '樓層': 1, '房間': 1, '代號': 1, '代號層': 1 })[trim_(req.level)] ? trim_(req.level) : '代號';

    list.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var uuid = trim_(it.uuid);
      var loc = typeof it.id === 'string' ? L.byId[it.id] : null;
      if (!/^[A-Za-z0-9-]{8,64}$/.test(uuid)) { rejected.push({ uuid: uuid.slice(0, 64), id: String(it.id).slice(0, 200), why: 'UUID 格式錯誤' }); return; }
      if (seen[uuid]) { dup.push(uuid); if (loc) touched[loc.id] = 1; return; }
      if (!loc) { rejected.push({ uuid: uuid, id: String(it.id).slice(0, 200), why: '找不到這個位置（可能已改版）' }); return; }
      var c = cur.byId[loc.id] || { p: '', f: '', s: '', d: '', by: '' };
      var curP = c.p === '' ? 0 : Number(c.p);
      var tag = loc.tag;
      var p, f, s, detail = '';
      if (tag) {
        f = clampPct_(it.f); s = clampPct_(it.s);
        p = round_(f * tag[0][1] + s * tag[1][1], 2);
        detail = tag[0][0] + ' ' + f + '%／' + tag[1][0] + ' ' + s + '%';
      } else {
        p = clampPct_(it.p);
      }
      // 衝突：前端看到的舊值與伺服器不同
      if (!req.force && it.old) {
        var differ;
        if (tag) differ = num_(it.old.f) !== num_(c.f === '' ? curP : c.f) || num_(it.old.s) !== num_(c.s === '' ? curP : c.s);
        else differ = num_(it.old.p) !== curP;
        if (differ) { conflicts.push({ uuid: uuid, id: loc.id, server: curArr_(c) }); return; }
      }
      var reason = safeText_(it.reason) || batchReason;
      if (p < curP && !reason) { rejected.push({ uuid: uuid, id: loc.id, why: '完成% 比上次低，需填原因' }); return; }

      rows.push([loc.lv, loc.name, loc.unit, loc.fl, loc.rid, loc.id, detail, toFrac_(p), c.p === '' ? '' : toFrac_(curP),
        round_(loc.q * p / 100, 4), date, level, user.email, now, uuid, reason,
        (req.force ? '［衝突後以登記人為準］' : '') + safeText_(it.note)]);
      seen[uuid] = 1;
      saved.push(uuid);
      levels[loc.lv] = 1;
      touched[loc.id] = 1;
      // 目前進度：只在施工日期不早於目前最後施工日期時更新（補登較早日期只進紀錄與每日數量）
      if (!c.d || date >= c.d) {
        cur.byId[loc.id] = { row: c.row, p: p, f: tag ? f : '', s: tag ? s : '', d: date, by: user.name, ts: now };
        cur.dirty = true;
      }
    });

    if (rows.length) {
      logSh.getRange(logSh.getLastRow() + 1, 1, rows.length, LOG_WIDTH).setValues(rows);
      if (cur.dirty) writeCurrent_(cur, L);
      SpreadsheetApp.flush();
      recalcLevels_(Object.keys(levels));
    }
    var out = {};
    Object.keys(touched).forEach(function (id) { var c = cur.byId[id]; if (c) out[id] = curArr_(c); });
    return { ok: true, saved: saved, dup: dup, conflicts: conflicts, rejected: rejected, cur: out };
  } finally {
    lock.releaseLock();
  }
}

function curArr_(c) { return [c.p === '' ? 0 : c.p, c.f, c.s, c.d || '', c.by || '']; }

// ---------- material ----------
/** req: { uuid, lv, date, qty, note } 進料在代號層整批登記 */
function material_(user, req) {
  var date = dateStr_(req.date);
  var qty = Number(req.qty);
  if (!date) throw apiError_('bad_request', '日期格式錯誤');
  if (date > todayStr_()) throw apiError_('bad_request', '日期不能晚於今天');
  if (!isFinite(qty) || qty === 0) throw apiError_('bad_request', '請填到貨數量');
  var uuid = trim_(req.uuid);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(uuid)) throw apiError_('bad_request', 'UUID 格式錯誤');
  if (Math.abs(qty) > 1e7) throw apiError_('bad_request', '數量不合理');
  var L = loadLocations_();
  var it = typeof req.lv === 'string' ? L.itemByLv[trim_(req.lv)] : null;
  if (!it) throw apiError_('bad_request', '找不到層級 ' + req.lv);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw apiError_('busy', '目前登記的人較多，請稍後再試');
  try {
    var sh = sheet_(CFG.SH.MAT);
    var seen = uuidSet_(sh, MAT_COL.UUID);
    if (!seen[uuid]) {
      sh.getRange(sh.getLastRow() + 1, 1, 1, MAT_WIDTH).setValues([[it.lv, it.name, it.unit, date, round_(qty, 4), user.email, new Date(), uuid, safeText_(req.note)]]);
      SpreadsheetApp.flush();
      recalcLevels_([it.lv]); // 進料佔完成量 50%，到貨當天要計入每日數量
    }
    var m = materialSummary_()[it.lv] || { sum: 0, last: '' };
    return { ok: true, dup: !!seen[uuid], lv: it.lv, sum: round_(m.sum, 3), last: m.last };
  } finally {
    lock.releaseLock();
  }
}

// ---------- history ----------
/**
 * req: { ids:[位置ID...], lv }
 * 編輯者看到所有人的紀錄；檢視者只看到自己與期初推估的紀錄。
 */
function history_(user, req) {
  var ids = Object.create(null);
  (Array.isArray(req.ids) ? req.ids : []).slice(0, 2000).forEach(function (id) { if (typeof id === 'string') ids[id] = 1; });
  var sh = sheet_(CFG.SH.LOG);
  var n = sh.getLastRow() - 1;
  var recs = [];
  if (n > 0) {
    var v = sh.getRange(2, 1, n, LOG_WIDTH).getValues();
    for (var i = v.length - 1; i >= 0 && recs.length < 200; i--) {
      var r = v[i];
      if (!ids[r[LOG_COL.ID - 1]]) continue;
      var by = String(r[LOG_COL.BY - 1]);
      if (user.role !== 'editor' && by.toLowerCase() !== user.email && by !== CFG.OPENING_BY) continue;
      recs.push({ id: r[LOG_COL.ID - 1], detail: r[LOG_COL.DETAIL - 1], p: fromFrac_(r[LOG_COL.PCT - 1]), old: fromFrac_(r[LOG_COL.OLD - 1]),
        date: dateStr_(r[LOG_COL.DATE - 1]), level: r[LOG_COL.LEVEL - 1], by: by,
        ts: r[LOG_COL.TS - 1] instanceof Date ? Utilities.formatDate(r[LOG_COL.TS - 1], CFG.TZ, 'yyyy-MM-dd HH:mm') : String(r[LOG_COL.TS - 1]),
        reason: r[LOG_COL.REASON - 1], note: r[LOG_COL.NOTE - 1] });
    }
  }
  var mats = [];
  var lv = typeof req.lv === 'string' ? trim_(req.lv) : '';
  if (lv) {
    var ms = sheet_(CFG.SH.MAT);
    var mn = ms.getLastRow() - 1;
    if (mn > 0) {
      ms.getRange(2, 1, mn, MAT_WIDTH).getValues().forEach(function (r) {
        if (trim_(r[0]) !== lv) return;
        var by = String(r[MAT_COL.BY - 1]);
        if (user.role !== 'editor' && by.toLowerCase() !== user.email && by !== CFG.OPENING_BY) return;
        mats.push({ date: dateStr_(r[MAT_COL.DATE - 1]), qty: r[MAT_COL.QTY - 1], by: by, note: r[MAT_COL.NOTE - 1] });
      });
    }
    mats.reverse();
  }
  return { ok: true, records: recs, materials: mats.slice(0, 100), all: user.role === 'editor' };
}
