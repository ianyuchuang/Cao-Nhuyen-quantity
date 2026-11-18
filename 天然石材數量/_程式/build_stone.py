# -*- coding: utf-8 -*-
"""天然石材（F15、F16）分層數量：Excel、A3 圖、PDF。
多邊形為各平面圖 300 dpi 像素座標（1F：A2-07 用印版；2F、3F：A2-08~A2-17 第 1、2 頁）。
樓梯（C 梯、D 梯）依 A5-10～A5-12 詳圖尺寸計算，圖上多邊形只供標示位置。"""
import math, os
import numpy as np, cv2
import fitz
from PIL import Image, ImageDraw, ImageFont
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

ROOT = r'D:\分層數量'
OUT = os.path.join(ROOT, '天然石材數量')

# ---------- 比例尺（cm/像素，300 dpi） ----------
SC = {'1F': (7700 / (3931 - 1005), 3470 / (2184 - 856.7)),       # A2-07：X2~X9、Y6~Y1
      '2F': (7700 / (3937.5 - 1005.5), 3470 / (2826.5 - 1496.5)),  # A2-08（與 A2-09 同一套掃描）
      '3F': (7700 / (3937.5 - 1005.5), 3470 / (2826.5 - 1496.5))}  # A2-09（同高架地板）

def parea(pts, fl):
    sx, sy = SC[fl]; p = np.array(pts, float)
    x, y = p[:, 0] * sx / 100, p[:, 1] * sy / 100
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))

def r2(v): return float(round(float(v) + 1e-9, 2))

# ---------- 描繪範圍（房間淨面積） ----------
POLY = {
    '119': [(1772.5, 2011), (2184, 2011), (2184, 2204), (1862.5, 2204), (1862.5, 2169), (1832.5, 2169),
            (1832.5, 2204), (1772.5, 2204)],
    '129': [(959, 1377), (1185, 1377), (1185, 1633), (959, 1633)],
    '130': [(1740, 833), (1819.3, 833), (1819.3, 969), (1740, 969)],
    '130a': [(2899, 834), (2954, 834), (2954, 916), (2899, 916)],
    '131': [(3863.3, 1176), (3993, 1176), (3993, 1329), (3863.3, 1329)],
    '303': [(1770, 1511), (1884.6, 1511), (1884.6, 1682), (1832.5, 1682), (1832.5, 1730), (1782.5, 1730),
            (1782.5, 1561), (1770, 1561)],
}
# 樓梯標示位置（只畫圖，不計面積）
POLY_SHOW = {
    '134': [(986.4, 868.6), (1362.6, 868.6), (1362.6, 922.1), (986.4, 922.1)],    # 1F：1F→2F 梯段全長投影
    '203': [(1370, 1514), (1772, 1514), (1772, 1567.5), (1370, 1567.5)],         # 2F：2F 平台 + 2F→3F 梯段
}
D226 = ((1333.3, 2126.7), 127.5 / SC['2F'][0])   # 2F D 梯圓心、半徑（px）

# ---------- 樓梯（A5-10～A5-12） ----------
W_C = 1.40                      # C 梯梯寬
RISE_A = 6.10 / 35              # 1F→2F：35@17.43≒610（A5-11）
RISE_B = 5.00 / 27              # 2F→3F：27@18.52≒500（A5-11、A5-12）
runA = 21 * 0.25 + 1.65 + 12 * 0.25          # 21@25 + 中間平台 165 + 12@25 = 9.90
runB = 13 * 0.25 + 1.40 + 12 * 0.25          # 13@25 + 中間平台 140 + 12@25 = 7.65
D_R, D_W = 1.275, 1.15                        # D 梯外半徑（φ255）、踏板寬 115

def item(desc, formula, v): return dict(desc=desc, formula=formula, v=r2(v))

ROWS = {  # (樓層, 房號, 空間名稱, 代號) -> 細目
    ('1F', '119', '門廊A', 'F16'): [item('淨面積', '沿牆內緣描繪多邊形（扣南側邊柱）', parea(POLY['119'], '1F'))],
    ('1F', '129', '門廊B', 'F16'): [item('淨面積', '沿牆內緣描繪多邊形', parea(POLY['129'], '1F'))],
    ('1F', '130', '門廊C', 'F16'): [item('淨面積', '建築線內凹入段，量至門 D19 牆線', parea(POLY['130'], '1F'))],
    ('1F', '130a', '門廊E', 'F16'): [item('淨面積', '建築線內凹入段，量至門 D19 牆線', parea(POLY['130a'], '1F'))],
    ('1F', '131', '門廊D', 'F16'): [item('淨面積', '量至防水閘門 f（w400）', parea(POLY['131'], '1F'))],
    ('1F', '134', 'C樓梯(戶外直通梯) 1F→2F 梯段', 'F15'): [
        item('踏面＋中間平台', f'(21×0.25＋1.65＋12×0.25)={runA:.2f} m × 梯寬 {W_C:.2f}', runA * W_C),
        item('踢面', f'35 級 × 0.1743（610÷35）× 梯寬 {W_C:.2f}', 35 * RISE_A * W_C)],
    ('2F', '203', 'C樓梯(戶外直通梯) 2F 平台＋2F→3F 梯段', 'F15'): [
        item('2F 平台', f'2.90 × {W_C:.2f}', 2.90 * W_C),
        item('踏面＋中間平台', f'(13×0.25＋1.40＋12×0.25)={runB:.2f} m × 梯寬 {W_C:.2f}', runB * W_C),
        item('踢面', f'27 級 × 0.1852（500÷27）× 梯寬 {W_C:.2f}', 27 * RISE_B * W_C)],
    ('2F', '226', '戶外圓形D樓梯 2F→3F', 'F15'): [
        item('平面投影', f'π × {D_R:.3f}²（φ255）', math.pi * D_R ** 2),
        item('踢面', f'27 級 × 0.1852 × 踏板寬 {D_W:.2f}', 27 * RISE_B * D_W)],
    ('3F', '303', 'C樓梯(戶外直通梯) 3F 平台＋延伸段', 'F15'): [
        item('淨面積', '沿牆內緣描繪多邊形（自第 27 級止至門 D2、D12）', parea(POLY['303'], '3F'))],
}

ITEMS = [('I.甲.壹.六.1.14', 'F15', 'F15-地坪2cm厚天然石材(細鑿面)含刻溝止滑處理.', 78.0),
         ('I.甲.壹.六.1.15', 'F16', 'F16-地坪2cm厚天然石材(燒面)', 127.0)]
FLOORS = ['B3F', 'B2F', 'B1F', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '11F', '屋突層']
SHEETS = ['A2-04', 'A2-05', 'A2-06', 'A2-07', 'A2-08', 'A2-09', 'A2-10', 'A2-11', 'A2-12', 'A2-13',
          'A2-14', 'A2-15', 'A2-16', 'A2-17', 'A2-18/19']
ROOMQ = {k: r2(sum(i['v'] for i in v)) for k, v in ROWS.items()}
QTY = {c: {f: 0.0 for f in FLOORS} for _, c, _, _ in ITEMS}
for (fl, rm, nm, c), q in ROOMQ.items(): QTY[c][fl] = r2(QTY[c][fl] + q)
TOT = {c: r2(sum(QTY[c].values())) for c in QTY}
for k, q in ROOMQ.items(): print(k, q)
print('TOTAL', TOT, {c: QTY[c] for c in QTY if True and False})
for c in QTY: print(c, {f: v for f, v in QTY[c].items() if v})
SUBS = [('進料', 0.50), ('打底', 0.35), ('石材鋪貼', 0.15)]

# ---------- Excel 樣式 ----------
FN = '新細明體'
thin = Side(style='thin'); BD = Border(left=thin, right=thin, top=thin, bottom=thin)
HDR = PatternFill('solid', fgColor='FFDDEBF7'); GRY = PatternFill('solid', fgColor='FFF2F2F2')
ORG = PatternFill('solid', fgColor='FFF8CBAD'); ITM = PatternFill('solid', fgColor='FFFCE4D6')
PCT = PatternFill('solid', fgColor='FFF7FBFF')
NUM1 = '#,##0.0;\\-#,##0.0;"-"'; NUM2 = '#,##0.00;\\-#,##0.00;"-"'; PC1 = '0.0%;\\-0.0%;"-"'

def cell(ws, ref, v, b=False, sz=11, fill=None, fmt=None, h=None, wrap=None, border=True):
    c = ws[ref]; c.value = v; c.font = Font(name=FN, sz=sz, b=b)
    if fill: c.fill = fill
    if fmt: c.number_format = fmt
    if h or wrap: c.alignment = Alignment(horizontal=h, vertical='center', wrap_text=wrap)
    if border: c.border = BD
    return c

def col(i): return openpyxl.utils.get_column_letter(i)
FCOL = {f: col(5 + i) for i, f in enumerate(FLOORS)}   # E..S

# ===== 數量計算表：計算式 =====
wb = openpyxl.Workbook()
ws0 = wb.active; ws0.title = '總表'
ws = wb.create_sheet('計算式')
cell(ws, 'A1', '高雄軟體園區第二園區第一棟大樓 — 天然石材項目 數量計算式', b=True, sz=14, border=False)
ws.merge_cells('A2:F2')
cell(ws, 'A2', '依據：A1-51 室內裝修表（F15：134、203、226、303；F16：119、129、130、130a、131）、A2-07 壹層平面圖（261105 用印版）、'
     'A2-08／A2-09 貳、參層平面圖（260916 印）、A5-10 C樓梯平面詳圖、A5-11 C樓梯剖面詳圖、A5-12 D樓梯詳圖；單位 m²。'
     '門廊與 3F 303 為沿牆內緣人工描繪的淨面積；C、D 樓梯依詳圖尺寸計算踏面、平台與踢面，每段梯只計一次，計入起步樓層。'
     f'比例尺依軸線校正（300 dpi）：1F X {SC["1F"][0]:.4f}、Y {SC["1F"][1]:.4f}；2F、3F X {SC["3F"][0]:.4f}、Y {SC["3F"][1]:.4f} cm/像素。'
     '各項照圖面實際數量填寫，不依合約數量調整。', border=False, wrap=True)
ws.row_dimensions[2].height = 105
r = 4
SUBREF = {}   # (code, floor) -> cell
for it, code, name, con in ITEMS:
    ws.merge_cells(f'A{r}:F{r}')
    cell(ws, f'A{r}', f'{it}\u3000{name}\u3000（單位：M2\u3000合約數量：{con:,.1f}）', b=True, fill=ITM, wrap=True)
    r += 1
    for i, t in enumerate(['樓層', '房號', '空間名稱', '細目', '計算式', '數量(m²)'], 1):
        cell(ws, f'{col(i)}{r}', t, b=True, fill=HDR, h='center', wrap=True)
    r += 1
    flsub = []
    for fl in FLOORS:
        keys = [k for k in ROWS if k[3] == code and k[0] == fl]
        if not keys: continue
        r0 = r
        for k in keys:
            for d in ROWS[k]:
                cell(ws, f'A{r}', fl, h='center', wrap=True); cell(ws, f'B{r}', k[1], wrap=True)
                cell(ws, f'C{r}', k[2], wrap=True); cell(ws, f'D{r}', d['desc'], wrap=True)
                cell(ws, f'E{r}', d['formula'], wrap=True)
                cell(ws, f'F{r}', d['v'], fmt='#,##0.00', wrap=True)
                r += 1
        ws.merge_cells(f'B{r}:E{r}')
        cell(ws, f'A{r}', fl, b=True, fill=GRY, h='center'); cell(ws, f'B{r}', f'{fl} 小計', b=True, fill=GRY)
        cell(ws, f'F{r}', f'=SUM(F{r0}:F{r - 1})', b=True, fill=GRY, fmt='#,##0.00')
        SUBREF[(code, fl)] = f'計算式!F{r}'; flsub.append(f'F{r}'); r += 1
    ws.merge_cells(f'A{r}:E{r}')
    cell(ws, f'A{r}', f'{code} 合計', b=True, fill=GRY)
    cell(ws, f'F{r}', '=' + '+'.join(flsub), b=True, fill=GRY, fmt='#,##0.00')
    r += 2
for k, w in {'A': 8, 'B': 8, 'C': 30, 'D': 15, 'E': 62, 'F': 12}.items(): ws.column_dimensions[k].width = w
ws.freeze_panes = 'A4'

# ===== 總表 =====
ws = ws0
cell(ws, 'A1', '天然石材項目 分層數量總表', b=True, sz=14, border=False)
ws.merge_cells('A2:W2')
cell(ws, 'A2', '數量連結自「計算式」工作表；單位 m²。各項照圖面實際數量填寫，合約數量僅供對照。F15 全在 C、D 樓梯（1F～3F）；F16 全在 1F 門廊。',
     border=False, wrap=True)
ws.row_dimensions[2].height = 32.1
cell(ws, 'A3', '一、各樓層數量', b=True, sz=12, border=False)
hdr = ['項次', '代號', '品名', '單位'] + FLOORS + ['合計', '合約數量', '實際/合約', '備註']
for i, t in enumerate(hdr, 1): cell(ws, f'{col(i)}4', t, b=True, fill=HDR, h='center', wrap=True)
for j, (it, code, name, con) in enumerate(ITEMS):
    r = 5 + j
    cell(ws, f'A{r}', it, wrap=True); cell(ws, f'B{r}', code, wrap=True)
    cell(ws, f'C{r}', name, sz=9, wrap=True); cell(ws, f'D{r}', 'M2', wrap=True)
    for f in FLOORS:
        cell(ws, f'{FCOL[f]}{r}', f'={SUBREF[(code, f)]}' if (code, f) in SUBREF else 0, fmt=NUM2, h='right')
    cell(ws, f'T{r}', f'=SUM(E{r}:S{r})', b=True, fill=GRY, fmt='#,##0.00', h='right')
    cell(ws, f'U{r}', con, fill=GRY, fmt='#,##0.00', h='right')
    cell(ws, f'V{r}', f'=T{r}/U{r}', fill=ORG, fmt='0.0%', h='right')
    cell(ws, f'W{r}', '照圖面實際數量（含樓梯踢面）' if code == 'F15' else '照圖面實際數量（門廊量至建築線或防水閘門）', sz=9, wrap=True)
    ws.row_dimensions[r].height = 30
cell(ws, 'A8', '二、各樓層占該項百分比', b=True, sz=12, border=False)
for i, t in enumerate(['項次', '代號', '品名', '單位'] + FLOORS + ['合計'], 1):
    cell(ws, f'{col(i)}9', t, b=True, fill=HDR, h='center', wrap=True)
for j, (it, code, name, con) in enumerate(ITEMS):
    r = 10 + j; q = 5 + j
    cell(ws, f'A{r}', it, wrap=True); cell(ws, f'B{r}', code, wrap=True); cell(ws, f'C{r}', name, sz=9, wrap=True)
    cell(ws, f'D{r}', '%', wrap=True)
    for f in FLOORS:
        L = FCOL[f]; cell(ws, f'{L}{r}', f'=IF($T{q}=0,"",{L}{q}/$T{q})', fmt=PC1, h='right')
    cell(ws, f'T{r}', f'=SUM(E{r}:S{r})', b=True, fill=GRY, fmt='0.0%', h='right')
    ws.row_dimensions[r].height = 30
for k, w in {'A': 16, 'B': 8, 'C': 40, 'D': 6, 'T': 12, 'U': 10, 'V': 10, 'W': 30}.items():
    ws.column_dimensions[k].width = w
for i in range(5, 20): ws.column_dimensions[col(i)].width = 9
ws.freeze_panes = 'E5'

# ===== 施工細項表 =====
ws = wb.create_sheet('施工細項表')
cell(ws, 'A1', '天然石材項目 施工細項表（各層數量及細項占比）', b=True, sz=14, border=False)
ws.merge_cells('A2:F2')
cell(ws, 'A2', '每層兩列：上列為數量，下列為占該工項百分比。細項比照 F 類地磚：進料 50%、打底 35%、石材鋪貼 15%；'
     '細項數量 = 本層數量 × 權重，細項百分比 = 細項數量 ÷ 該工項合計。施工時某層某細項完成，即填該格數量。', border=False, wrap=True)
ws.row_dimensions[2].height = 48
r = 4
for j, (it, code, name, con) in enumerate(ITEMS):
    ws.merge_cells(f'A{r}:F{r}')
    cell(ws, f'A{r}', f'{it}\u3000{code}\u3000{name}', b=True, fill=ITM, wrap=True); r += 1
    for i, t in enumerate(['樓層', None, '本層合計'] + [f'{s}（{w:.0%}）' for s, w in SUBS], 1):
        cell(ws, f'{col(i)}{r}', t, b=True, fill=HDR, h='center', wrap=True)
    ws.merge_cells(f'A{r}:B{r}'); r += 1
    r_first = r; tq = f'總表!$T${5 + j}'
    for f in [f for f in FLOORS if QTY[code][f]]:
        cell(ws, f'A{r}', f, b=True, h='center'); cell(ws, f'A{r + 1}', None)
        cell(ws, f'B{r}', '數量(m²)', h='center'); cell(ws, f'B{r + 1}', '百分比', fill=PCT, h='center')
        cell(ws, f'C{r}', f'=總表!{FCOL[f]}{5 + j}', fmt='#,##0.00')
        cell(ws, f'C{r + 1}', f'=C{r}/{tq}', fill=PCT, fmt='0.00%')
        for k, (s, w) in enumerate(SUBS):
            L = col(4 + k)
            cell(ws, f'{L}{r}', f'=C{r}*{w}', fmt='#,##0.00')
            cell(ws, f'{L}{r + 1}', f'={L}{r}/{tq}', fill=PCT, fmt='0.00%')
        ws.merge_cells(f'A{r}:A{r + 1}'); r += 2
    cell(ws, f'A{r}', '合計', b=True, h='center'); cell(ws, f'A{r + 1}', None)
    cell(ws, f'B{r}', '數量(m²)', h='center'); cell(ws, f'B{r + 1}', '百分比', fill=PCT, h='center')
    for L in 'CDEF':
        cell(ws, f'{L}{r}', f'=SUMPRODUCT((MOD(ROW({L}{r_first}:{L}{r - 1})-{r_first},2)=0)*{L}{r_first}:{L}{r - 1})',
             b=True, fill=GRY, fmt='#,##0.00')
        cell(ws, f'{L}{r + 1}', f'={L}{r}/{tq}', b=True, fill=PCT, fmt='0.00%')
    ws.merge_cells(f'A{r}:A{r + 1}'); r += 3
for k, w in {'A': 9, 'B': 10, 'C': 14, 'D': 15, 'E': 15, 'F': 15}.items(): ws.column_dimensions[k].width = w
ws.freeze_panes = 'A4'
wb.save(os.path.join(OUT, '天然石材_數量計算表.xlsx'))

# ===== 分層數量表 =====
wb = openpyxl.Workbook(); ws = wb.active; ws.title = '分層數量表'
cell(ws, 'A1', '高雄軟體園區第二園區第一棟大樓 — 天然石材項目 分層數量（依建築圖 A2-07~A2-09、A5-10~A5-12 量測）', b=True, sz=14, border=False)
ws.merge_cells('A2:W2')
cell(ws, 'A2', '一、圖面數量；二、占該項百分比 = 該樓層數量 ÷ 全部樓層合計；三、填報數量：照圖面實際數量，不依合約調整。圖面與合約差異 ±2% 以上標紅底（僅供對照）。',
     border=False, wrap=True)
ws.row_dimensions[2].height = 32.1
fl_hdr = [f'{f}\n{s}' for f, s in zip(FLOORS, SHEETS)]
NOTE = {'F15': '1F、2F C樓梯梯段（含踢面）、2F D樓梯、3F 平台；每段梯只計一次', 'F16': '1F 門廊 A～E；量至建築線或防水閘門'}
def block(r0, title, kind):
    cell(ws, f'A{r0}', title, b=True, sz=12, border=False)
    extra = {'qty': ['合計', '合約數量', '圖面/合約', '備註'], 'pct': ['合計'], 'rep': ['合計', '合約數量']}[kind]
    for i, t in enumerate(['項次', '代號', '品名', '單位'] + fl_hdr + extra, 1):
        cell(ws, f'{col(i)}{r0 + 1}', t, b=True, fill=HDR, h='center', wrap=True)
    for j, (it, code, name, con) in enumerate(ITEMS):
        r = r0 + 2 + j
        cell(ws, f'A{r}', it, wrap=True); cell(ws, f'B{r}', code, wrap=True)
        cell(ws, f'C{r}', name, sz=9, wrap=True); cell(ws, f'D{r}', '%' if kind == 'pct' else 'M2', wrap=True)
        for f in FLOORS:
            L = FCOL[f]
            if kind == 'pct': cell(ws, f'{L}{r}', QTY[code][f] / TOT[code], fmt=PC1, h='right')
            else: cell(ws, f'{L}{r}', QTY[code][f], fmt=NUM2, h='right')
        cell(ws, f'T{r}', f'=SUM(E{r}:S{r})', b=True, fill=GRY, fmt='0.0%' if kind == 'pct' else '#,##0.00', h='right')
        if kind != 'pct': cell(ws, f'U{r}', con, fill=GRY, fmt='#,##0.0', h='right')
        if kind == 'qty':
            ratio = TOT[code] / con
            cell(ws, f'V{r}', ratio, fill=ORG if abs(ratio - 1) >= 0.02 else None, fmt='0.0%', h='right')
            cell(ws, f'W{r}', NOTE[code], sz=9, wrap=True)
        ws.row_dimensions[r].height = 30
block(3, '一、圖面數量', 'qty'); block(8, '二、占該項百分比', 'pct'); block(13, '三、填報數量', 'rep')
for k, w in {'A': 16, 'B': 8, 'C': 40, 'D': 6, 'T': 12, 'U': 10, 'V': 10, 'W': 34}.items():
    ws.column_dimensions[k].width = w
for i in range(5, 20): ws.column_dimensions[col(i)].width = 9
ws.freeze_panes = 'E5'

ws = wb.create_sheet('房間明細')
H2 = ['樓層', '圖號', '房號', '空間名稱', '裝修表地坪', 'F15(m²)', 'F16(m²)', '量測方式']
for i, t in enumerate(H2, 1): cell(ws, f'{col(i)}1', t, b=True, fill=HDR, h='center', wrap=True)
SH = {'1F': 'A2-07', '2F': 'A2-08', '3F': 'A2-09'}
r = 2
for (fl, rm, nm, c), rows in ROWS.items():
    vals = [fl, SH[fl], rm, nm, c, ROOMQ[(fl, rm, nm, c)] if c == 'F15' else None,
            ROOMQ[(fl, rm, nm, c)] if c == 'F16' else None,
            '；'.join(f"{d['desc']} {d['formula']} = {d['v']:.2f}" for d in rows)]
    for i, v in enumerate(vals, 1): cell(ws, f'{col(i)}{r}', v, fmt='#,##0.00' if i in (6, 7) else None, wrap=True)
    ws.row_dimensions[r].height = 45; r += 1
cell(ws, f'A{r}', '合計', b=True, fill=GRY); ws.merge_cells(f'A{r}:E{r}')
cell(ws, f'F{r}', f'=SUM(F2:F{r - 1})', b=True, fill=GRY, fmt='#,##0.00')
cell(ws, f'G{r}', f'=SUM(G2:G{r - 1})', b=True, fill=GRY, fmt='#,##0.00')
for k, w in {'A': 7, 'B': 9, 'C': 8, 'D': 34, 'E': 10, 'F': 11, 'G': 11, 'H': 100}.items():
    ws.column_dimensions[k].width = w
ws.freeze_panes = 'E2'

ws = wb.create_sheet('計算說明')
md = open(os.path.join(OUT, '天然石材數量計算說明.md'), encoding='utf-8').read().split('\n')
for i, line in enumerate(md, 1):
    ws.cell(i, 1, line if line else None).font = Font(name=FN, sz=11)
ws.column_dimensions['A'].width = 160
wb.save(os.path.join(OUT, '天然石材_分層數量表.xlsx'))
print('xlsx ok')

# ---------- A3 圖 ----------
FONT = r'C:\Windows\Fonts\msjh.ttc'; FONTB = r'C:\Windows\Fonts\msjhbd.ttc'
def F(sz, b=False): return ImageFont.truetype(FONTB if b else FONT, sz)
COL = {'F15': ((0, 170, 120), (0, 110, 70)), 'F16': ((150, 140, 0), (100, 90, 0))}
NAMEC = {'F15': 'F15-地坪2cm厚天然石材(細鑿面)含刻溝止滑處理', 'F16': 'F16-地坪2cm厚天然石材(燒面)'}

def render(pdf, pg):
    doc = fitz.open(os.path.join(ROOT, pdf))
    pix = doc[pg].get_pixmap(dpi=300, colorspace=fitz.csGRAY)
    page = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w).copy()
    blur = cv2.GaussianBlur(page, (0, 0), 1.2)
    return cv2.addWeighted(page, 1.6, blur, -0.6, 0)

def shape_mask(shape, shp, xf):
    m = np.zeros(shp, np.uint8)
    if shape[0] == 'poly':
        cv2.fillPoly(m, [np.round(xf(np.array(shape[1], float))).astype(np.int32)], 255)
    else:
        c = xf(np.array([shape[1]], float))[0]; rr = shape[2] * xf.s
        cv2.circle(m, (int(round(c[0])), int(round(c[1]))), int(round(rr)), 255, -1)
    return m

def overlay(rgb, mask, code, alpha=0.45, lw=5):
    fill, edge = COL[code]; sel = mask > 0
    rgb[sel] = (rgb[sel] * (1 - alpha) + np.array(fill, float) * alpha).astype(np.uint8)
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(rgb, cs, -1, edge, lw, cv2.LINE_AA)
    return rgb

def card(draw, cx, cy, lines, fs, pad=10, dry=False):
    f = F(fs)
    bb = [draw.textbbox((0, 0), t, font=f) for t in lines]
    w = max(b[2] - b[0] for b in bb) + 2 * pad; lh = fs + 8; h = lh * len(lines) + 2 * pad - 4
    x0, y0 = cx - w / 2, cy - h / 2
    if not dry:
        draw.rectangle([x0, y0, x0 + w, y0 + h], fill='white', outline='black', width=3)
        for i, t in enumerate(lines):
            b = draw.textbbox((0, 0), t, font=f)
            draw.text((cx - (b[2] - b[0]) / 2 - b[0], y0 + pad + i * lh - b[1] + 2), t, fill='black', font=f)
    return (x0, y0, x0 + w, y0 + h)

def anchor_pt(mask):
    d = cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
    m = cv2.moments(mask, True); cx, cy = m['m10'] / m['m00'], m['m01'] / m['m00']
    if mask[int(cy), int(cx)] and d[int(cy), int(cx)] >= 15: return cx, cy
    y, x = np.unravel_index(np.argmax(d), d.shape); return float(x), float(y)

class XF:
    def __init__(s, S, ox, oy): s.s, s.ox, s.oy = S, ox, oy
    def __call__(s, p): return (p - [s.ox, s.oy]) * s.s

# 每層：(pdf, 頁, A3 對位 OX OY, 最終標註裁切範圍, 標示[(房號, 代號, 形狀, 卡片中心(原圖 px) 或 None)])
SH_CIRCLE = ('circle', D226[0], D226[1])
LAY = {
    '1F': ('A2-07(261105)用印版.pdf', 0, 330, 560, (700, 600, 4150, 2350), '壹層平面圖（A2-07）', [
        ('119', 'F16', ('poly', POLY['119']), (2075, 2090)),
        ('129', 'F16', ('poly', POLY['129']), (1072, 1560)),
        ('130', 'F16', ('poly', POLY['130']), (1640, 690)),
        ('130a', 'F16', ('poly', POLY['130a']), (2927, 690)),
        ('131', 'F16', ('poly', POLY['131']), (3690, 1300)),
        ('134', 'F15', ('poly', POLY_SHOW['134']), (1300, 690))]),
    '2F': ('A2-08~A2-17(260916)印.pdf', 0, 381.5, 878.3, (700, 1300, 2300, 2500), '貳層平面圖（A2-08）', [
        ('203', 'F15', ('poly', POLY_SHOW['203']), (1640, 1400)),
        ('226', 'F15', SH_CIRCLE, (1110, 2250))]),
    '3F': ('A2-08~A2-17(260916)印.pdf', 1, 381.5, 878.3, (1300, 1300, 2500, 2000), '參層平面圖（A2-09）', [
        ('303', 'F15', ('poly', POLY['303']), (2060, 1610))]),
}
LBL = {('1F', '134'): ['134 C樓梯 1F→2F', 'F15 {q:.2f}m²'], ('2F', '203'): ['203 C樓梯 2F平台+2F→3F', 'F15 {q:.2f}m²'],
       ('2F', '226'): ['226 D樓梯', 'F15 {q:.2f}m²'], ('3F', '303'): ['303 C樓梯 3F平台', 'F15 {q:.2f}m²']}
def lines_for(fl, rm, code):
    q = [v for k, v in ROOMQ.items() if k[0] == fl and k[1] == rm][0]
    if (fl, rm) in LBL: return [t.format(q=q) for t in LBL[(fl, rm)]], q
    nm = [k[2] for k in ROOMQ if k[0] == fl and k[1] == rm][0]
    return [f'{rm} {nm}', f'{code} {q:.2f}m²'], q

S = 1.303
FX0, FY0, FX1, FY1 = 90, 90, 4870, 2715
pages = []
report = {}
for fl, (pdf, pg, OX, OY, crop, title, marks) in LAY.items():
    page = render(pdf, pg)
    xf = XF(S, OX, OY)
    A3 = np.full((3508, 4961, 3), 255, np.uint8)
    M = np.float32([[S, 0, -OX * S], [0, S, -OY * S]])
    warped = cv2.warpAffine(page, M, (4961, 3508), flags=cv2.INTER_CUBIC, borderValue=255)
    A3[FY0:FY1, FX0:FX1] = cv2.cvtColor(warped[FY0:FY1, FX0:FX1], cv2.COLOR_GRAY2RGB)
    masks = []
    for rm, code, shp, cpos in marks:
        mk = shape_mask(shp, A3.shape[:2], xf); masks.append(mk); A3 = overlay(A3, mk, code)
    cv2.rectangle(A3, (FX0, FY0), (FX1, FY1), (0, 0, 0), 4)
    allm = np.zeros(A3.shape[:2], np.uint8)
    for mk in masks: allm |= mk
    edge = cv2.morphologyEx(allm, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    im = Image.fromarray(A3); d = ImageDraw.Draw(im)
    boxes, anchors, issues = [], [], []
    for (rm, code, shp, cpos), mk in zip(marks, masks):
        anchors.append(anchor_pt(mk))
    for (rm, code, shp, cpos), mk, an in zip(marks, masks, anchors):
        lines, q = lines_for(fl, rm, code)
        cx, cy = xf(np.array([cpos], float))[0]
        bx = card(d, cx, cy, lines, 34, dry=True)
        inside = mk[int(cy), int(cx)] > 0
        if not inside or math.hypot(cx - an[0], cy - an[1]) > 60:
            # 引線：從房間中心到卡片最近邊
            px = min(max(an[0], bx[0]), bx[2]); py = min(max(an[1], bx[1]), bx[3])
            d.line([an, (px, py)], fill='black', width=3)
            d.ellipse([an[0] - 8, an[1] - 8, an[0] + 8, an[1] + 8], fill='black')
        boxes.append((rm, bx))
        # 卡片不可蓋到標示線（12px）
        x0, y0, x1, y1 = [int(round(v)) for v in bx]
        sub = edge[max(0, y0 - 12):y1 + 12, max(0, x0 - 12):x1 + 12]
        if sub.any(): issues.append(f'{rm} 卡片靠近或蓋到標示線')
        for an2 in anchors:
            if x0 - 15 <= an2[0] <= x1 + 15 and y0 - 15 <= an2[1] <= y1 + 15 and an2 != an:
                issues.append(f'{rm} 卡片靠近其他房間中心點')
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i][1], boxes[j][1]
            if not (a[2] + 16 < b[0] or b[2] + 16 < a[0] or a[3] + 16 < b[1] or b[3] + 16 < a[1]):
                issues.append(f'{boxes[i][0]}／{boxes[j][0]} 卡片太近')
    for (rm, code, shp, cpos) in marks:
        lines, q = lines_for(fl, rm, code)
        cx, cy = xf(np.array([cpos], float))[0]; card(d, cx, cy, lines, 34)
    report[fl] = issues
    d.text((FX0, 2745), f'{fl} {title}— 天然石材數量', fill='black', font=F(54, True))
    y = 2850
    for x, t in [(110, '代號'), (330, '品名'), (2300, '本層數量'), (2650, '占該項%')]:
        d.text((x, y), t, fill='black', font=F(30))
    y = 2915
    for code in ['F15', 'F16']:
        q = QTY[code][fl]
        if not q: continue
        fill, edg = COL[code]
        d.rectangle([110, y + 4, 150, y + 40], fill=fill, outline=edg, width=3)
        d.text((175, y), code, fill='black', font=F(32)); d.text((330, y), NAMEC[code], fill='black', font=F(30))
        d.text((2300, y), f'{q:.2f}m²', fill='black', font=F(32, True))
        d.text((2650, y), f'{q / TOT[code]:.1%}', fill='black', font=F(32)); y += 60
    note = ['說明：色塊為天然石材範圍；標籤為房號／代號／本層數量（m²）。門廊為沿牆內緣人工描繪淨面積，量至建築線或防水閘門。',
            'C、D 樓梯依 A5-10～A5-12 詳圖尺寸計算（踏面＋平台＋踢面），每段梯只計一次、計入起步樓層；圖上樓梯色塊僅示意位置。',
            '照圖面實際數量，不依合約數量調整（合約 F15 78 m²、F16 127 m²）。數量計算式詳「天然石材_數量計算表.xlsx」。原圖比例 S:1/300@A3，本圖已放大，僅供數量對照。']
    for i, t in enumerate(note): d.text((90, y + 40 + i * 44), t, fill=(60, 60, 60), font=F(26))
    os.makedirs(os.path.join(OUT, fl), exist_ok=True)
    p_a3 = os.path.join(OUT, fl, f'{fl}_實際數量.png'); im.save(p_a3, dpi=(300, 300)); pages.append(p_a3)

    # 最終標註（原圖解析度裁切 + 右側圖例）
    X0, Y0, X1, Y1 = crop
    cr = cv2.cvtColor(page[Y0:Y1, X0:X1], cv2.COLOR_GRAY2RGB)
    xf1 = XF(1.0, X0, Y0)
    for rm, code, shp, cpos in marks:
        cr = overlay(cr, shape_mask(shp, cr.shape[:2], xf1), code, lw=4)
    PW = 760
    canvas = np.full((max(Y1 - Y0, 420), X1 - X0 + PW, 3), 255, np.uint8); canvas[:Y1 - Y0, :X1 - X0] = cr
    im2 = Image.fromarray(canvas); d2 = ImageDraw.Draw(im2)
    for rm, code, shp, cpos in marks:
        mk = shape_mask(shp, cr.shape[:2], xf1); an = anchor_pt(mk)
        lines, q = lines_for(fl, rm, code)
        cx, cy = cpos[0] - X0, cpos[1] - Y0
        bx = card(d2, cx, cy, lines, 26, pad=8, dry=True)
        if not mk[int(cy), int(cx)] or math.hypot(cx - an[0], cy - an[1]) > 50:
            px = min(max(an[0], bx[0]), bx[2]); py = min(max(an[1], bx[1]), bx[3])
            d2.line([an, (px, py)], fill='black', width=2)
            d2.ellipse([an[0] - 6, an[1] - 6, an[0] + 6, an[1] + 6], fill='black')
        card(d2, cx, cy, lines, 26, pad=8)
    lx = X1 - X0 + 30
    d2.text((lx, 20), f'{fl} {title}', fill='black', font=F(32, True))
    d2.text((lx, 70), '— 天然石材項目', fill='black', font=F(30, True))
    yy = 140
    for code in ['F15', 'F16']:
        q = QTY[code][fl]
        if not q: continue
        fill, edg = COL[code]
        d2.rectangle([lx, yy + 4, lx + 34, yy + 34], fill=fill, outline=edg, width=3)
        d2.text((lx + 50, yy), code, fill='black', font=F(28)); d2.text((lx + 360, yy), f'{q:.2f}m²', fill='black', font=F(28))
        yy += 50
    for i, t in enumerate(['標籤：房號／代號／本層數量。', '樓梯色塊僅示意位置，', '數量依詳圖尺寸計算。']):
        d2.text((lx, yy + 30 + i * 38), t, fill=(60, 60, 60), font=F(24))
    im2.save(os.path.join(OUT, fl, f'{fl}_最終標註.png'), dpi=(300, 300))

imgs = [Image.open(p).convert('RGB') for p in pages]
imgs[0].save(os.path.join(OUT, '天然石材_各樓層A3.pdf'), save_all=True, append_images=imgs[1:], resolution=300)
print('images/pdf ok', report)
