# -*- coding: utf-8 -*-
r"""天然石材「立面」：內牆 W7a/W7/W8/W10、外牆石材帷幕牆、外牆基座。
先跑 ext_dwg.py（外牆，讀 A3-01_各向立面250304.dwg），再跑本程式。
讀 walls.json（內牆逐間資料，各平面 300 dpi 像素座標）與 ext_dwg_res.json，輸出：
天然石材_立面_數量計算表.xlsx、天然石材_立面_分層數量表.xlsx、天然石材_立面_各樓層A3.pdf、<樓層>\<樓層>_立面石材.png、立面\*.png"""
import json, os, sys, math, subprocess
import numpy as np, cv2, fitz
from PIL import Image, ImageDraw, ImageFont
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

sys.stdout.reconfigure(encoding='utf-8')
ROOT = r'D:\分層數量'
OUT = os.path.join(ROOT, '天然石材數量')
SP = os.path.dirname(os.path.abspath(__file__))
WALLS = json.load(open(os.path.join(SP, 'walls.json'), encoding='utf-8'))
EXT = json.load(open(os.path.join(SP, 'ext_dwg_res.json'), encoding='utf-8'))

FLOORS = ['B3F', 'B2F', 'B1F', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '11F', '屋突層']
SHEETS = ['A2-04', 'A2-05', 'A2-06', 'A2-07', 'A2-08', 'A2-09', 'A2-10', 'A2-11', 'A2-12', 'A2-13',
          'A2-14', 'A2-15', 'A2-16', 'A2-17', 'A2-18/19']
ITEMS = [('I.甲.壹.六.3.16', 'W7a', 'W7a-內牆1:3水泥砂漿打底貼2cm厚天然石材(米灰色亮面)B(依精裝修)', 152.0),
         ('I.甲.壹.六.3.17', 'W7', 'W7-內牆輕隔間(綠建材)批土+2cm厚天然石材(米灰色亮面)B(依精裝修)', 2308.0),
         ('I.甲.壹.六.3.18', 'W8', 'W8-內牆輕隔間(綠建材)批土+2cm厚天然石材(灰色大理石亮面)C(依精裝修)', 447.0),
         ('I.甲.壹.六.3.19', 'W10', 'W10-內牆輕隔間(綠建材)+2cm厚天然石材(白色亮面)E依精裝修)', 2190.0),
         ('I.甲.壹.六.4.17', '外牆石材', '外牆空縫石材帷幕牆(含固定鐵件、防水板、安裝及磨角處理)', 1184.0),
         ('I.甲.壹.六.4.5', '基座', '外牆粉刷貼石材(含磨角處理)(基座)', 153.0)]
CODES = [c for _, c, _, _ in ITEMS]
SUBS = {'W7a': [('進料', .5), ('牆面處理', .35), ('石材安裝', .15)],
        'W7': [('進料', .5), ('牆面處理', .35), ('石材安裝', .15)],
        'W8': [('進料', .5), ('牆面處理', .35), ('石材安裝', .15)],
        'W10': [('進料', .5), ('牆面處理', .35), ('石材安裝', .15)],
        '外牆石材': [('進料', .5), ('鐵件骨架安裝', .35), ('石材吊掛', .15)],
        '基座': [('進料', .5), ('牆面處理', .35), ('石材安裝', .15)]}
FACE_NM = {'N': '北向', 'S': '南向', 'E': '東向', 'W': '西向'}

def r2(v): return float(round(float(v) + 1e-9, 2))

QTY = {c: {f: 0.0 for f in FLOORS} for c in CODES}
for w in WALLS: QTY[w['code']][w['floor']] = r2(QTY[w['code']][w['floor']] + w['area_m2'])
for f, d in EXT.items():
    for k, v in d['stone'].items(): QTY['外牆石材'][k] = r2(QTY['外牆石材'][k] + v)
    QTY['基座']['1F'] = r2(QTY['基座']['1F'] + d['base'])
TOT = {c: r2(sum(QTY[c].values())) for c in CODES}
for c in CODES: print(c, TOT[c], {f: v for f, v in QTY[c].items() if v})

# ---------- Excel ----------
FN = '新細明體'
thin = Side(style='thin'); BD = Border(left=thin, right=thin, top=thin, bottom=thin)
HDR = PatternFill('solid', fgColor='FFDDEBF7'); GRY = PatternFill('solid', fgColor='FFF2F2F2')
ORG = PatternFill('solid', fgColor='FFF8CBAD'); ITM = PatternFill('solid', fgColor='FFFCE4D6')
PCT = PatternFill('solid', fgColor='FFF7FBFF')
NUM2 = '#,##0.00;\\-#,##0.00;"-"'; PC1 = '0.0%;\\-0.0%;"-"'

def cell(ws, ref, v, b=False, sz=11, fill=None, fmt=None, h=None, wrap=None, border=True):
    c = ws[ref]; c.value = v; c.font = Font(name=FN, sz=sz, b=b)
    if fill: c.fill = fill
    if fmt: c.number_format = fmt
    if h or wrap: c.alignment = Alignment(horizontal=h, vertical='center', wrap_text=wrap)
    if border: c.border = BD
    return c
def col(i): return openpyxl.utils.get_column_letter(i)
FCOL = {f: col(5 + i) for i, f in enumerate(FLOORS)}

def op_text(w):
    return '；'.join(f"{o['tag']} {o['width_m']:.2f}" + (f"×{o['height_m']:.2f}" if o.get('height_m') else '×2.10')
                     for o in w['openings']) if w['openings'] else '無'

wb = openpyxl.Workbook(); ws0 = wb.active; ws0.title = '總表'
ws = wb.create_sheet('計算式')
cell(ws, 'A1', '高雄軟體園區第二園區第一棟大樓 — 天然石材立面項目 數量計算式', b=True, sz=14, border=False)
ws.merge_cells('A2:H2')
cell(ws, 'A2', '內牆（W7a、W7、W8、W10）：牆面面積 = 有牆邊長 × CH − 開口；門扣「門寬 × 2.10」，電梯門寬推定 1.10 m，玻璃門窗（DW）扣「寬 × 高」（高於 CH 以 CH 計），捲門扣「寬 × CH」。'
     '牆長依各平面圖（300 dpi）描繪，房間範圍與地坪表一致；組合代號（W7+W21+W22 等）圖面無分界者整面計入石材。'
     '外牆：依「A3-01_各向立面250304.dwg」（LibreDWG 轉 DXF）圖層 W-石材、hatch-石材 填線計算，南向西端深灰石材只有分割線，依分割線範圍計入；'
     '以 1FL、2FL、3FL 標高切分樓層，1FL 以下（地面線至 1FL）為基座。各項照圖面實際數量填寫，不依合約數量調整。', border=False, wrap=True)
ws.row_dimensions[2].height = 105
r = 4; SUBREF = {}
for it, code, name, con in ITEMS:
    ws.merge_cells(f'A{r}:H{r}')
    cell(ws, f'A{r}', f'{it}\u3000{name}\u3000（單位：M2\u3000合約數量：{con:,.1f}）', b=True, fill=ITM, wrap=True); r += 1
    hd = ['樓層', '房號／立面', '空間名稱', 'CH(m)', '牆長(m)', '開口扣除', '備註', '數量(m²)']
    for i, t in enumerate(hd, 1): cell(ws, f'{col(i)}{r}', t, b=True, fill=HDR, h='center', wrap=True)
    r += 1; subs = []
    for fl in FLOORS:
        if code in ('外牆石材', '基座'):
            rows = []
            for f, d in EXT.items():
                v = d['stone'].get(fl, 0) if code == '外牆石材' else (d['base'] if fl == '1F' else 0)
                if v: rows.append((FACE_NM[f], v))
            if not rows: continue
            r0 = r
            for nm, v in rows:
                vals = [fl, nm + '立面', '1FL～2FL' if fl == '1F' and code == '外牆石材' else ('地面線～1FL' if code == '基座' else f'{fl}FL～{FLOORS[FLOORS.index(fl)+1]}FL' if fl != '3F' else '3FL～4FL（含女兒牆頂）'),
                        None, None, 'DWG 填線已扣門窗開口', 'A3-01 各向立面 DWG', v]
                for i, x in enumerate(vals, 1): cell(ws, f'{col(i)}{r}', x, fmt='#,##0.00' if i == 8 else None, wrap=True)
                r += 1
        else:
            ws_ = [w for w in WALLS if w['code'] == code and w['floor'] == fl]
            if not ws_: continue
            r0 = r
            for w in ws_:
                vals = [fl, w['room'], w['name'], w['ch_m'], w['wall_len_m'], op_text(w), w.get('note') or w.get('wall_desc'), w['area_m2']]
                for i, x in enumerate(vals, 1):
                    cell(ws, f'{col(i)}{r}', x, sz=10 if i in (6, 7) else 11,
                         fmt='#,##0.00' if i in (4, 5, 8) else None, wrap=True)
                ws.row_dimensions[r].height = 45; r += 1
        ws.merge_cells(f'B{r}:G{r}')
        cell(ws, f'A{r}', fl, b=True, fill=GRY, h='center'); cell(ws, f'B{r}', f'{fl} 小計', b=True, fill=GRY)
        cell(ws, f'H{r}', f'=SUM(H{r0}:H{r - 1})', b=True, fill=GRY, fmt='#,##0.00')
        SUBREF[(code, fl)] = f'計算式!H{r}'; subs.append(f'H{r}'); r += 1
    ws.merge_cells(f'A{r}:G{r}')
    cell(ws, f'A{r}', f'{code} 合計', b=True, fill=GRY); cell(ws, f'H{r}', '=' + '+'.join(subs), b=True, fill=GRY, fmt='#,##0.00')
    r += 2
for k, w in {'A': 8, 'B': 12, 'C': 22, 'D': 7, 'E': 9, 'F': 46, 'G': 46, 'H': 12}.items(): ws.column_dimensions[k].width = w
ws.freeze_panes = 'A4'

ws = ws0
cell(ws, 'A1', '天然石材立面項目 分層數量總表', b=True, sz=14, border=False)
ws.merge_cells('A2:W2')
cell(ws, 'A2', '數量連結自「計算式」工作表；單位 m²。各項照圖面實際數量填寫，合約數量僅供對照。', border=False, wrap=True)
cell(ws, 'A3', '一、各樓層數量', b=True, sz=12, border=False)
for i, t in enumerate(['項次', '代號', '品名', '單位'] + FLOORS + ['合計', '合約數量', '實際/合約', '備註'], 1):
    cell(ws, f'{col(i)}4', t, b=True, fill=HDR, h='center', wrap=True)
NOTE = {'W7a': 'B3F～B1F 梯廳A、B', 'W7': '1F～3F 梯廳、大廳、走廊；4F～11F 梯廳', 'W8': '1F 121 大廳、2F 225 交誼空間（圖面無分界，比例分配）',
        'W10': '4F～10F 走廊（兼梯廳）', '外牆石材': '依立面 DWG 石材填線；4F～11F 無石材', '基座': '地面線至 1FL'}
nI = len(ITEMS)
for j, (it, code, name, con) in enumerate(ITEMS):
    r = 5 + j
    cell(ws, f'A{r}', it, wrap=True); cell(ws, f'B{r}', code, wrap=True); cell(ws, f'C{r}', name, sz=9, wrap=True); cell(ws, f'D{r}', 'M2')
    for f in FLOORS: cell(ws, f'{FCOL[f]}{r}', f'={SUBREF[(code, f)]}' if (code, f) in SUBREF else 0, fmt=NUM2, h='right')
    cell(ws, f'T{r}', f'=SUM(E{r}:S{r})', b=True, fill=GRY, fmt='#,##0.00', h='right')
    cell(ws, f'U{r}', con, fill=GRY, fmt='#,##0.00', h='right'); cell(ws, f'V{r}', f'=T{r}/U{r}', fill=ORG, fmt='0.0%', h='right')
    cell(ws, f'W{r}', NOTE[code], sz=9, wrap=True); ws.row_dimensions[r].height = 30
r0 = 5 + nI + 1
cell(ws, f'A{r0}', '二、各樓層占該項百分比', b=True, sz=12, border=False)
for i, t in enumerate(['項次', '代號', '品名', '單位'] + FLOORS + ['合計'], 1):
    cell(ws, f'{col(i)}{r0 + 1}', t, b=True, fill=HDR, h='center', wrap=True)
for j, (it, code, name, con) in enumerate(ITEMS):
    r = r0 + 2 + j; q = 5 + j
    cell(ws, f'A{r}', it, wrap=True); cell(ws, f'B{r}', code); cell(ws, f'C{r}', name, sz=9, wrap=True); cell(ws, f'D{r}', '%')
    for f in FLOORS:
        L = FCOL[f]; cell(ws, f'{L}{r}', f'=IF($T{q}=0,"",{L}{q}/$T{q})', fmt=PC1, h='right')
    cell(ws, f'T{r}', f'=SUM(E{r}:S{r})', b=True, fill=GRY, fmt='0.0%', h='right'); ws.row_dimensions[r].height = 30
for k, w in {'A': 16, 'B': 9, 'C': 40, 'D': 6, 'T': 12, 'U': 10, 'V': 10, 'W': 34}.items(): ws.column_dimensions[k].width = w
for i in range(5, 20): ws.column_dimensions[col(i)].width = 9
ws.freeze_panes = 'E5'

ws = wb.create_sheet('施工細項表')
cell(ws, 'A1', '天然石材立面項目 施工細項表（各層數量及細項占比）', b=True, sz=14, border=False)
ws.merge_cells('A2:F2')
cell(ws, 'A2', '每層兩列：上列為數量，下列為占該工項百分比。內牆與基座比照 W 類牆磚：進料 50%、牆面處理 35%、石材安裝 15%；'
     '外牆石材帷幕：進料 50%、鐵件骨架安裝 35%、石材吊掛 15%。細項數量 = 本層數量 × 權重。', border=False, wrap=True)
ws.row_dimensions[2].height = 48
r = 4
for j, (it, code, name, con) in enumerate(ITEMS):
    ws.merge_cells(f'A{r}:F{r}'); cell(ws, f'A{r}', f'{it}\u3000{code}\u3000{name}', b=True, fill=ITM, wrap=True); r += 1
    for i, t in enumerate(['樓層', None, '本層合計'] + [f'{s}（{w:.0%}）' for s, w in SUBS[code]], 1):
        cell(ws, f'{col(i)}{r}', t, b=True, fill=HDR, h='center', wrap=True)
    ws.merge_cells(f'A{r}:B{r}'); r += 1
    rf = r; tq = f'總表!$T${5 + j}'
    for f in [f for f in FLOORS if QTY[code][f]]:
        cell(ws, f'A{r}', f, b=True, h='center'); cell(ws, f'A{r + 1}', None)
        cell(ws, f'B{r}', '數量(m²)', h='center'); cell(ws, f'B{r + 1}', '百分比', fill=PCT, h='center')
        cell(ws, f'C{r}', f'=總表!{FCOL[f]}{5 + j}', fmt='#,##0.00'); cell(ws, f'C{r + 1}', f'=C{r}/{tq}', fill=PCT, fmt='0.00%')
        for k, (s, w) in enumerate(SUBS[code]):
            L = col(4 + k); cell(ws, f'{L}{r}', f'=C{r}*{w}', fmt='#,##0.00'); cell(ws, f'{L}{r + 1}', f'={L}{r}/{tq}', fill=PCT, fmt='0.00%')
        ws.merge_cells(f'A{r}:A{r + 1}'); r += 2
    cell(ws, f'A{r}', '合計', b=True, h='center'); cell(ws, f'A{r + 1}', None)
    cell(ws, f'B{r}', '數量(m²)', h='center'); cell(ws, f'B{r + 1}', '百分比', fill=PCT, h='center')
    for L in 'CDEF':
        cell(ws, f'{L}{r}', f'=SUMPRODUCT((MOD(ROW({L}{rf}:{L}{r - 1})-{rf},2)=0)*{L}{rf}:{L}{r - 1})', b=True, fill=GRY, fmt='#,##0.00')
        cell(ws, f'{L}{r + 1}', f'={L}{r}/{tq}', b=True, fill=PCT, fmt='0.00%')
    ws.merge_cells(f'A{r}:A{r + 1}'); r += 3
for k, w in {'A': 9, 'B': 10, 'C': 14, 'D': 15, 'E': 17, 'F': 15}.items(): ws.column_dimensions[k].width = w
wb.save(os.path.join(OUT, '天然石材_立面_數量計算表.xlsx'))

wb = openpyxl.Workbook(); ws = wb.active; ws.title = '分層數量表'
cell(ws, 'A1', '高雄軟體園區第二園區第一棟大樓 — 天然石材立面項目 分層數量', b=True, sz=14, border=False)
ws.merge_cells('A2:W2')
cell(ws, 'A2', '一、圖面數量；二、占該項百分比；三、填報數量：照圖面實際數量，不依合約調整。圖面與合約差異 ±2% 以上標紅底（僅供對照）。', border=False, wrap=True)
fl_hdr = [f'{f}\n{s}' for f, s in zip(FLOORS, SHEETS)]
def block(r0, title, kind):
    cell(ws, f'A{r0}', title, b=True, sz=12, border=False)
    extra = {'qty': ['合計', '合約數量', '圖面/合約', '備註'], 'pct': ['合計'], 'rep': ['合計', '合約數量']}[kind]
    for i, t in enumerate(['項次', '代號', '品名', '單位'] + fl_hdr + extra, 1):
        cell(ws, f'{col(i)}{r0 + 1}', t, b=True, fill=HDR, h='center', wrap=True)
    for j, (it, code, name, con) in enumerate(ITEMS):
        r = r0 + 2 + j
        cell(ws, f'A{r}', it, wrap=True); cell(ws, f'B{r}', code); cell(ws, f'C{r}', name, sz=9, wrap=True)
        cell(ws, f'D{r}', '%' if kind == 'pct' else 'M2')
        for f in FLOORS:
            v = QTY[code][f] / TOT[code] if kind == 'pct' else QTY[code][f]
            cell(ws, f'{FCOL[f]}{r}', v, fmt=PC1 if kind == 'pct' else NUM2, h='right')
        cell(ws, f'T{r}', f'=SUM(E{r}:S{r})', b=True, fill=GRY, fmt='0.0%' if kind == 'pct' else '#,##0.00', h='right')
        if kind != 'pct': cell(ws, f'U{r}', con, fill=GRY, fmt='#,##0.0', h='right')
        if kind == 'qty':
            ratio = TOT[code] / con
            cell(ws, f'V{r}', ratio, fill=ORG if abs(ratio - 1) >= .02 else None, fmt='0.0%', h='right')
            cell(ws, f'W{r}', NOTE[code], sz=9, wrap=True)
        ws.row_dimensions[r].height = 30
block(3, '一、圖面數量', 'qty'); block(4 + nI + 1, '二、占該項百分比', 'pct'); block(2 * (nI + 3) + 1, '三、填報數量', 'rep')
for k, w in {'A': 16, 'B': 9, 'C': 40, 'D': 6, 'T': 12, 'U': 10, 'V': 10, 'W': 34}.items(): ws.column_dimensions[k].width = w
for i in range(5, 20): ws.column_dimensions[col(i)].width = 9
ws.freeze_panes = 'E5'
ws = wb.create_sheet('房間明細')
H2 = ['樓層', '圖號', '房號／立面', '空間名稱', '代號', 'CH(m)', '牆長(m)', '開口扣除', '面積(m²)', '說明']
for i, t in enumerate(H2, 1): cell(ws, f'{col(i)}1', t, b=True, fill=HDR, h='center', wrap=True)
r = 2
for w in WALLS:
    vals = [w['floor'], w['sheet'], w['room'], w['name'], w['code'], w['ch_m'], w['wall_len_m'], op_text(w), w['area_m2'],
            (w.get('wall_desc') or '') + ('；' + w['note'] if w.get('note') else '')]
    for i, x in enumerate(vals, 1): cell(ws, f'{col(i)}{r}', x, sz=10 if i in (8, 10) else 11, fmt='#,##0.00' if i in (6, 7, 9) else None, wrap=True)
    ws.row_dimensions[r].height = 45; r += 1
for f, d in EXT.items():
    for k, v in list(d['stone'].items()) + [('1F', d['base'])]:
        if not v: continue
        code = '外牆石材' if (k, v) != ('1F', d['base']) else '基座'
        vals = ['1F' if code == '基座' else k, 'A3-01 DWG', FACE_NM[f] + '立面', '外牆', code, None, None, 'DWG 填線已扣開口', v,
                '地面線至 1FL' if code == '基座' else '石材填線範圍']
        for i, x in enumerate(vals, 1): cell(ws, f'{col(i)}{r}', x, fmt='#,##0.00' if i == 9 else None, wrap=True)
        r += 1
for k, w in {'A': 7, 'B': 10, 'C': 11, 'D': 20, 'E': 9, 'F': 7, 'G': 9, 'H': 50, 'I': 11, 'J': 70}.items(): ws.column_dimensions[k].width = w
ws.freeze_panes = 'E2'
ws = wb.create_sheet('計算說明')
md = open(os.path.join(OUT, '天然石材立面數量計算說明.md'), encoding='utf-8').read().split('\n')
for i, line in enumerate(md, 1): ws.cell(i, 1, line if line else None).font = Font(name=FN, sz=11)
ws.column_dimensions['A'].width = 160
wb.save(os.path.join(OUT, '天然石材_立面_分層數量表.xlsx'))
print('xlsx ok')

# ---------- 平面 A3 圖（內牆） ----------
FONT = r'C:\Windows\Fonts\msjh.ttc'; FONTB = r'C:\Windows\Fonts\msjhbd.ttc'
def F(sz, b=False): return ImageFont.truetype(FONTB if b else FONT, sz)
COL = {'W7a': (150, 60, 200), 'W7': (230, 120, 0), 'W8': (200, 30, 60), 'W10': (0, 140, 200)}
NAMEC = {c: n for _, c, n, _ in ITEMS}
SRC = {'B3F': ('A2-04(用印版).pdf', 0), 'B2F': ('建築圖(已簽章).pdf', 64), 'B1F': ('A2-06(260929)印.pdf', 0),
       '1F': ('A2-07(261105)用印版.pdf', 0)}
for i, f in enumerate(['2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '11F']): SRC[f] = ('A2-08~A2-17(260916)印.pdf', i)
TITLE = {'B3F': '地下參層', 'B2F': '地下貳層', 'B1F': '地下壹層', '1F': '壹層', '2F': '貳層', '3F': '參層', '4F': '肆層', '5F': '伍層',
         '6F': '陸層', '7F': '柒層', '8F': '捌層', '9F': '玖層', '10F': '拾層', '11F': '拾壹層'}
NOPOLY = {('1F', '126'): (3508, 840, 3918, 1352), ('2F', '225'): (3517, 1485, 4060, 1802)}   # 無描繪線，以虛線框示意
FX0, FY0, FX1, FY1 = 90, 90, 4870, 2715

def render_page(pdf, pg):
    doc = fitz.open(os.path.join(ROOT, pdf))
    pix = doc[pg].get_pixmap(dpi=300, colorspace=fitz.csGRAY)
    im = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w).copy()
    return cv2.addWeighted(im, 1.6, cv2.GaussianBlur(im, (0, 0), 1.2), -0.6, 0)

def segs_of(w):
    pp = w.get('poly_px') or []
    if pp and isinstance(pp[0][0], (int, float)): pp = [pp]
    return [np.array(s, float) for s in pp if len(s) > 1]

pages = []
for fl in [f for f in FLOORS if any(w['floor'] == f for w in WALLS)]:
    ws_ = [w for w in WALLS if w['floor'] == fl]
    page = render_page(*SRC[fl])
    pts = np.vstack([s for w in ws_ for s in segs_of(w)] + [np.array([[a, b], [c, d]], float) for (f2, _), (a, b, c, d) in NOPOLY.items() if f2 == fl])
    x0, y0 = pts.min(0) - 260; x1, y1 = pts.max(0) + 260
    W0, H0 = FX1 - FX0, FY1 - FY0
    S = min(W0 / (x1 - x0), H0 / (y1 - y0), 2.2)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    OX, OY = cx - W0 / 2 / S, cy - H0 / 2 / S
    M = np.float32([[S, 0, FX0 - OX * S], [0, S, FY0 - OY * S]])
    A3 = np.full((3508, 4961, 3), 255, np.uint8)
    warped = cv2.warpAffine(page, M, (4961, 3508), flags=cv2.INTER_CUBIC, borderValue=255)
    A3[FY0:FY1, FX0:FX1] = cv2.cvtColor(warped[FY0:FY1, FX0:FX1], cv2.COLOR_GRAY2RGB)
    tr = lambda p: np.stack([FX0 + (p[:, 0] - OX) * S, FY0 + (p[:, 1] - OY) * S], 1)
    linemask = np.zeros(A3.shape[:2], np.uint8)
    lw = max(6, int(4 * S))
    for w in ws_:
        for s in segs_of(w):
            q = np.round(tr(s)).astype(np.int32)
            cv2.polylines(A3, [q], False, COL[w['code']], lw, cv2.LINE_AA); cv2.polylines(linemask, [q], False, 255, lw)
    for (f2, rm), (a, b, c, d) in NOPOLY.items():
        if f2 != fl: continue
        q = np.round(tr(np.array([[a, b], [c, d]], float))).astype(int)
        for t in range(q[0][0], q[1][0], 30): cv2.line(A3, (t, q[0][1]), (min(t + 15, q[1][0]), q[0][1]), (120, 120, 120), 3); cv2.line(A3, (t, q[1][1]), (min(t + 15, q[1][0]), q[1][1]), (120, 120, 120), 3)
        for t in range(q[0][1], q[1][1], 30): cv2.line(A3, (q[0][0], t), (q[0][0], min(t + 15, q[1][1])), (120, 120, 120), 3); cv2.line(A3, (q[1][0], t), (q[1][0], min(t + 15, q[1][1])), (120, 120, 120), 3)
    cv2.rectangle(A3, (FX0, FY0), (FX1, FY1), (0, 0, 0), 4)
    im = Image.fromarray(A3); d = ImageDraw.Draw(im)
    occ = cv2.dilate(linemask, np.ones((25, 25), np.uint8))
    fnt = F(30)
    # 合併同房號（121 W7/W8 各兩列）
    groups = {}
    for w in ws_: groups.setdefault(w['room'], []).append(w)
    order = sorted(groups.items(), key=lambda kv: -sum(x['area_m2'] for x in kv[1]))
    anchors = {}
    for rm, g in groups.items():
        ss = [s for w in g for s in segs_of(w)]
        if ss: p = tr(np.vstack(ss)); anchors[rm] = p.mean(0)
        else:
            a, b, c, dd = NOPOLY[(fl, rm)]; anchors[rm] = tr(np.array([[(a + c) / 2, (b + dd) / 2]], float))[0]
    fails = []
    for rm, g in order:
        byc = {}
        for w in g: byc[w['code']] = byc.get(w['code'], 0) + w['area_m2']
        lines = [f'{rm} {g[0]["name"]}'] + [f'{c} {v:.2f}m²' for c, v in byc.items()]
        bbs = [d.textbbox((0, 0), t, font=fnt) for t in lines]
        bw = max(b[2] - b[0] for b in bbs) + 20; bh = 38 * len(lines) + 14
        ax, ay = anchors[rm]; best = None
        for rad in range(0, 1400, 18):
            for k in range(max(1, rad // 9)):
                ang = 2 * math.pi * k / max(1, rad // 9)
                cx_, cy_ = ax + rad * math.cos(ang), ay + rad * math.sin(ang)
                bx0, by0 = int(cx_ - bw / 2), int(cy_ - bh / 2)
                if bx0 < FX0 + 10 or by0 < FY0 + 10 or bx0 + bw > FX1 - 10 or by0 + bh > FY1 - 10: continue
                if occ[by0:by0 + bh, bx0:bx0 + bw].any(): continue
                best = (bx0, by0); break
            if best: break
        if not best: fails.append(rm); continue
        bx0, by0 = best
        if math.hypot(bx0 + bw / 2 - ax, by0 + bh / 2 - ay) > 30:
            px_ = min(max(ax, bx0), bx0 + bw); py_ = min(max(ay, by0), by0 + bh)
            d.line([(ax, ay), (px_, py_)], fill='black', width=3); d.ellipse([ax - 8, ay - 8, ax + 8, ay + 8], fill='black')
        d.rectangle([bx0, by0, bx0 + bw, by0 + bh], fill='white', outline='black', width=3)
        for i, t in enumerate(lines): d.text((bx0 + 10, by0 + 6 + 38 * i), t, fill='black', font=fnt)
        cv2.rectangle(occ, (bx0 - 16, by0 - 16), (bx0 + bw + 16, by0 + bh + 16), 255, -1)
    if fails: print('找不到空位', fl, fails)
    d.text((FX0, 2745), f'{fl} {TITLE[fl]}平面圖（{ws_[0]["sheet"]}）— 天然石材牆面（局部放大）', fill='black', font=F(54, True))
    y = 2850
    for x, t in [(110, '代號'), (330, '品名'), (2900, '本層數量'), (3250, '占該項%')]: d.text((x, y), t, fill='black', font=F(30))
    y = 2915
    for code in ['W7a', 'W7', 'W8', 'W10']:
        q = QTY[code][fl]
        if not q: continue
        d.rectangle([110, y + 18, 160, y + 28], fill=COL[code])
        d.text((185, y), code, fill='black', font=F(32)); d.text((330, y), NAMEC[code], fill='black', font=F(28))
        d.text((2900, y), f'{q:.2f}m²', fill='black', font=F(32, True)); d.text((3250, y), f'{q / TOT[code]:.1%}', fill='black', font=F(32)); y += 56
    note = '說明：色線為石材牆面（描繪於牆面內緣）；標籤為房號／代號／本層牆面面積（已扣門、電梯門、玻璃門窗）。面積 = 牆長 × CH - 開口，詳「天然石材_立面_數量計算表.xlsx」。'
    if any(k[0] == fl for k in NOPOLY): note += '虛線框為 W5+W7、W5+W8+W23 房間，牆長取油漆表描繪長度比例分配，未逐段標線。'
    d.text((90, y + 30), note, fill=(60, 60, 60), font=F(25))
    os.makedirs(os.path.join(OUT, fl), exist_ok=True)
    p = os.path.join(OUT, fl, f'{fl}_立面石材.png'); im.save(p, dpi=(300, 300)); pages.append(p)
print('plan pages', len(pages))

# ---------- 立面 A3 圖（外牆，1F～3F） ----------
ED = os.path.join(OUT, '立面')
subprocess.run([sys.executable, '-I', os.path.join(SP, 'ext_plot.py'), ED], check=True)
pages += [os.path.join(ED, '立面_北向南向_實際數量.png'), os.path.join(ED, '立面_東向西向_實際數量.png')]
imgs = [Image.open(p).convert('RGB') for p in pages]
imgs[0].save(os.path.join(OUT, '天然石材_立面_各樓層A3.pdf'), save_all=True, append_images=imgs[1:], resolution=300)
print('pdf ok', len(imgs))
