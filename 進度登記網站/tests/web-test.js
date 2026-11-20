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
console.log('\n全部通過');
