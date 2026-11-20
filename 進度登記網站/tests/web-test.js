// 網頁共用邏輯測試：node tests/web-test.js
const assert = require('assert');
const { roomOf } = require('../web/rooms.js');
const ok = (c, m) => { assert.ok(c, m); console.log('✓', m); };
const door = { cat: '門窗', code: 'DA', short: 'DA 複壁檢修門 40* 40cm' };

let r = roomOf({ fl: 'B3F', rid: 'B3F-DA01', nm: 'B302 進氣機房', kind: '單樘', room: '門窗|B3F|B302' }, door);
ok(r.key === '門窗|B3F|B302' && r.rid === 'B302' && r.nm === '進氣機房' && r.kind === '房間' && r.door, '門窗已對應房號 → 歸到房間 B302「進氣機房」');

r = roomOf({ fl: '1F', rid: '1F-D1022', nm: '', kind: '單樘', room: '門窗|1F|D10' }, { cat: '門窗', code: 'D10', short: 'D10 鋼板門 70*180cm' });
ok(r.key === '門窗|1F|D10' && r.rid === 'D10' && r.kind === '代號組' && /^未對應房號・/.test(r.nm), '門窗未對應房號（房間ID 第三段＝代號）→ 以代號為組，標未對應房號');

r = roomOf({ fl: '3F', rid: '3F-D2201', nm: '304b 走廊', kind: '單樘', room: '門窗|3F|304b' }, { cat: '門窗', code: 'D22', short: 'D22' });
ok(r.rid === '304b' && r.nm === '走廊', '房號帶英文字母（304b）也能正確拆出空間名稱');

r = roomOf({ fl: '1F', rid: '1F-D1001', nm: '說明不是房號開頭', kind: '單樘', room: '門窗|1F|114' }, { cat: '門窗', code: 'D10', short: 'D10' });
ok(r.rid === '114' && r.nm === '說明不是房號開頭', 'H 欄不是「房號 名稱」格式時，空間名稱保留原文字');

const tags = ['門窗|B1F|B109', '門窗|B1F|B109'].map((room, i) => roomOf({ fl: 'B1F', rid: 'B1F-D0' + i, nm: 'B109 發電機室', kind: '單樘', room }, { cat: '門窗', code: 'D' + i, short: '' }).key);
ok(tags[0] === tags[1], '同一房間不同代號的門窗分在同一組（房間內再依代號排）');

r = roomOf({ fl: '2F', rid: '201', nm: '辦公室', kind: '房間', room: '天花板|2F|201' }, { cat: '天花板', code: 'C6', short: '' });
ok(r.key === '天花板|2F|201' && r.rid === '201' && r.nm === '辦公室' && r.kind === '房間' && !r.door, '非門窗位置照原樣分組');

r = roomOf({ fl: '代號層', rid: 'C3梯背', nm: 'x', kind: '不分樓層', room: '' }, { cat: '油漆', code: 'C3梯背', short: '' });
ok(r.key === '油漆|代號層|C3梯背' && r.nm === '不分樓層', '沒有房間ID 時以「工項|樓層|房號」為鍵，不分樓層顯示「不分樓層」');
// ---------- 離線佇列讀回檢查（web/outbox.js） ----------
const { cleanOutbox } = require('../web/outbox.js');
const goodSubmit = { type: 'submit', created: 1, prev: [['A.1|1F|101', null], ['A.1|1F|102', { p: 50, f: '', s: '', d: '2026-11-19', by: 'x' }]],
  payload: { date: '2026-11-20', level: '房間', label: '101', reason: '', force: false, items: [{ uuid: 'a', id: 'A.1|1F|101', p: 80, old: { p: 0 } }] } };
const goodMat = { type: 'material', created: 2, payload: { uuid: 'b', lv: 'A.1', date: '2026-11-20', qty: 3.5, note: '' } };
let ob = cleanOutbox(JSON.stringify([goodSubmit, goodMat]));
ok(ob.list.length === 2 && ob.dropped === 0, '正常的離線佇列（登記＋進料）全部保留');
ok(cleanOutbox(null).list.length === 0 && cleanOutbox(null).dropped === 0, '沒有離線資料 → 空佇列');
ob = cleanOutbox('{"type":"submit"}');
ok(ob.list.length === 0 && ob.dropped === 1, '佇列被改成非陣列 → 丟掉，不會讓畫面卡住');
ob = cleanOutbox('not json');
ok(ob.list.length === 0 && ob.dropped === 1, '佇列不是 JSON → 丟掉');
ob = cleanOutbox(JSON.stringify([goodSubmit, null, 5, { type: 'submit', payload: { date: '2026-11-20', items: 'x' } },
  { type: 'material', payload: { uuid: 'c', lv: 'A.1', date: '2026-11-20', qty: '3' } },
  Object.assign({}, goodSubmit, { prev: [{ id: 'x' }] }), { type: 'evil', payload: {} }, goodMat]));
ok(ob.list.length === 2 && ob.dropped === 6, '形狀不對的批次（null、數字、items 不是陣列、qty 是字串、prev 不是陣列對、未知類型）逐批丟掉，正常的保留');

// ---------- CSP 只允許連到本部署 ----------
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const cfgSrc = fs.readFileSync(path.join(__dirname, '../web/config.js'), 'utf8');
const apiUrl = /API_URL:\s*'([^']+)'/.exec(cfgSrc)[1];
const connect = /connect-src ([^;]+)/.exec(html)[1].split(/\s+/);
const gs = connect.filter(x => x.startsWith('https://script.google.com'));
ok(gs.length === 1 && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/$/.test(gs[0]) && apiUrl.startsWith(gs[0]), 'CSP connect-src 的 script.google.com 縮到 config.js 這個部署的路徑（換部署要一起改）');
ok(/<script src="outbox\.js"><\/script>\s*<script src="app\.js">/.test(html), 'index.html 在 app.js 之前載入 outbox.js');

console.log('\n全部通過');
