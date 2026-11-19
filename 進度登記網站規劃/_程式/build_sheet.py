# 產生要匯入 Google 試算表「工項進度登記」的「位置」「分層進度」工作表（xlsx），層級、項目、單位照每日施工內容 CSV 原文
# 用法：python build_sheet.py（先跑 extract.py 產生 data.json）
import csv, json, os, re, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
CSV = os.path.join(ROOT, '高軟每日施工內容(正式版) - 施工-實際進度 (修訂2版).csv')
OUT = os.path.join(HERE, '工項進度登記_匯入.xlsx')
VERSION = '2026-11-18'
FLOORS = ['代號層', '筏基層', 'B3F', 'B2F', 'B1F', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '11F', '屋突層']
fl_idx = lambda f: FLOORS.index(f) if f in FLOORS else 99

csv_rows = list(csv.reader(open(CSV, encoding='utf-8-sig')))
order, text = {}, {}
for i, r in enumerate(csv_rows[3:]):
    no = r[0].strip()
    if no:
        order[no] = i
        text[no] = (r[1], r[2])

data = json.load(open(os.path.join(HERE, 'data.json'), encoding='utf-8'))
locs, items = [], []
for c in data:
    for it in c['items']:
        no = it['no']
        if no not in text:
            raise SystemExit(f'CSV 找不到層級 {no}')
        name, unit = text[no]
        items.append((order[no], no, name, unit, c['cat'], it['code']))
        prop = 0
        rows = [list(r) for r in it['rows']]
        # 樓梯踢面併入同層的樓梯房間（2026-11-19 使用者要求）：「A梯踢面」→ 同層名稱以「A梯」開頭的房間（多間取房號最小者），B梯同理
        for r in [x for x in rows if re.match(r'^[AB]梯踢面$', x[1])]:
            room = sorted([x for x in rows if x[0] == r[0] and x is not r and x[2].startswith(r[1][0] + '梯')
                           and re.match(r'^[A-Z]?\d{2,4}[a-z]?$', x[1], re.I)], key=lambda x: x[1])
            if not room:
                raise SystemExit(f'{it["code"]} {r[0]} {r[1]} 找不到同層的{r[1][0]}梯房間')
            room[0][3] += r[3]
            rows.remove(r)
        for r in rows:
            fl, rid, nm, q = r[0], r[1], r[2], r[3]
            if '比例分配' in rid:
                prop += q
                continue
            if it.get('tagSteps'):
                kind, room = '單樘', it['code']
            elif c['cat'] == '防水閘門':
                kind, room = '標籤', rid
            elif re.match(r'^[A-Z]?\d{2,4}[a-z]?(\+\d+[a-z]?)?$', rid, re.I):
                kind, room = '房間', rid
            else:
                kind, room = '部位', rid
            locs.append([order[no], fl_idx(fl), no, name, unit, c['cat'], it['code'], fl, rid, nm, kind, round(q, 4), room])
        if prop:
            locs.append([order[no], 0, no, name, unit, c['cat'], it['code'], '代號層', it['code'], '不分樓層（比例分配）', '不分樓層', round(prop, 4), it['code']])

locs.sort(key=lambda x: (x[0], x[1], [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', x[8])]))
items.sort()

wb = Workbook()
head_font = Font(bold=True, color='FFFFFF')
head_fill = PatternFill('solid', fgColor='1F4E79')

ws = wb.active
ws.title = '位置'
hdr = ['層級', '項目', '單位', '工項', '代號', '樓層', '房號／標籤序號', '空間名稱／位置說明', '類型', '圖面數量', '位置ID', '房間ID', '數量版本', '狀態']
ws.append(hdr)
ids = set()
for l in locs:
    _, _, no, name, unit, cat, code, fl, rid, nm, kind, q, room = l
    lid = f'{no}|{fl}|{rid}'
    if lid in ids:
        raise SystemExit(f'位置ID 重複：{lid}')
    ids.add(lid)
    ws.append([no, name, unit, cat, code, fl, rid, nm, kind, q, lid, f'{cat}|{fl}|{room}', VERSION, '有效'])

ws2 = wb.create_sheet('分層進度')
hdr2 = ['層級', '項目', '單位', '工項', '代號', '圖面合計', '完成量', '完成%'] + FLOORS
ws2.append(hdr2)
for _, no, name, unit, cat, code in items:
    ws2.append([no, name, unit, cat, code])

for w in (ws, ws2):
    for c in w[1]:
        c.font, c.fill, c.alignment = head_font, head_fill, Alignment(horizontal='center')
    w.freeze_panes = 'D2'
wb.save(OUT)
print('位置', len(locs), '代號', len(items), OUT, file=sys.stderr)
