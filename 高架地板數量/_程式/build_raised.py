# -*- coding: utf-8 -*-
"""高架地板（F20）分層數量：Excel、A3 圖、PDF。"""
import json, os, sys
import numpy as np, cv2
import fitz
from PIL import Image, ImageDraw, ImageFont
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

SP = os.path.dirname(os.path.abspath(__file__))
ROOT = r'D:\分層數量'
OUT = os.path.join(ROOT, '高架地板數量')
os.makedirs(os.path.join(OUT, '3F'), exist_ok=True)

# ---------- 幾何 ----------
SX = 7700 / (3937.5 - 1005.5)      # cm/px  X2~X9 = 7×1100
SY = 3470 / (2826.5 - 1496.5)      # cm/px  Y6~Y1
poly = np.array(json.load(open(os.path.join(SP, 'poly333_page.json'))))
xs, ys = poly[:, 0] * SX / 100, poly[:, 1] * SY / 100
AREA = 0.5 * abs(np.dot(xs, np.roll(ys, 1)) - np.dot(ys, np.roll(xs, 1)))
print('area m2 =', round(AREA, 3), 'scale', round(SX, 4), round(SY, 4), round((SX * SY) ** .5, 4))

def m(px, s): return round(px * s / 100, 2)
W = m(4053.8 - 3515.8, SX); H = m(1729.4 - 1484.6, SY)
n1w, n1h = m(3537.3 - 3515.8, SX), m(1510.3 - 1484.6, SY)
n2w, n2h = m(3957.5 - 3927.9, SX), m(1518.8 - 1484.6, SY)
ew, eh = m(4053.8 - 3864.2, SX), m(1803.5 - 1729.4, SY)
chk = W * H - n1w * n1h - n2w * n2h + ew * eh
print('decomp', W, H, n1w, n1h, n2w, n2h, ew, eh, '=', round(chk, 2))
Q = 98.8   # 與地坪 F20（分層數量表_地坪及貼面磚.xlsx）一致
assert abs(AREA - Q) < 0.05 and abs(chk - Q) < 0.1
DECOMP = (f'主體 {W:.2f}×{H:.2f} − 西北角柱 {n1w:.2f}×{n1h:.2f} − 北側柱 {n2w:.2f}×{n2h:.2f}'
          f' + 東南延伸（陽台計入容積範圍）{ew:.2f}×{eh:.2f} ≈ {chk:.2f}；描繪多邊形面積 {AREA:.1f}')

ITEM = 'I.甲.壹.六.1.17'
CODE = 'F20'
NAME = '鋁合金高架地板，F20-地坪金屬高架地板(綠建材)H=30cm'
CONTRACT = 98.0
FLOORS = ['B3F', 'B2F', 'B1F', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '11F', '屋突層']
SHEETS = ['A2-04', 'A2-05', 'A2-06', 'A2-07', 'A2-08', 'A2-09', 'A2-10', 'A2-11', 'A2-12', 'A2-13',
          'A2-14', 'A2-15', 'A2-16', 'A2-17', 'A2-18/19']
QTY = {f: 0 for f in FLOORS}; QTY['3F'] = Q
SUBS = ['進料', '支架組立', '面板安裝']

# ---------- Excel 樣式 ----------
FN = '新細明體'
thin = Side(style='thin'); BD = Border(left=thin, right=thin, top=thin, bottom=thin)
HDR = PatternFill('solid', fgColor='FFDDEBF7'); GRY = PatternFill('solid', fgColor='FFF2F2F2')
ORG = PatternFill('solid', fgColor='FFF8CBAD'); ITM = PatternFill('solid', fgColor='FFFCE4D6')
PCT = PatternFill('solid', fgColor='FFF7FBFF')
NUM2 = '#,##0.00;\\-#,##0.00;"-"'; NUM1 = '#,##0.0;\\-#,##0.0;"-"'; PC1 = '0.0%;\\-0.0%;"-"'

def cell(ws, ref, v, b=False, sz=11, fill=None, fmt=None, h=None, wrap=None, border=True):
    c = ws[ref]; c.value = v; c.font = Font(name=FN, sz=sz, b=b)
    if fill: c.fill = fill
    if fmt: c.number_format = fmt
    if h or wrap: c.alignment = Alignment(horizontal=h, vertical='center', wrap_text=wrap)
    if border: c.border = BD
    return c

def col(i): return openpyxl.utils.get_column_letter(i)

# ===== 數量計算表 =====
wb = openpyxl.Workbook()
ws = wb.active; ws.title = '總表'
cell(ws, 'A1', '高架地板項目 分層數量總表', b=True, sz=14, border=False)
ws.merge_cells('A2:W2')
cell(ws, 'A2', '數量連結自「計算式」工作表；單位 m²。各項照圖面實際數量填寫，合約數量僅供對照；高架地板只有 3F 333 智慧監控管理中心（裝修表地坪 F20+G2）。',
     border=False, wrap=True)
ws.row_dimensions[2].height = 32.1
cell(ws, 'A3', '一、各樓層數量', b=True, sz=12, border=False)
hdr = ['項次', '代號', '品名', '單位'] + FLOORS + ['合計', '合約數量', '實際/合約', '備註']
for i, t in enumerate(hdr, 1): cell(ws, f'{col(i)}4', t, b=True, fill=HDR, h='center', wrap=True)
r = 5
cell(ws, f'A{r}', ITEM, wrap=True); cell(ws, f'B{r}', CODE, wrap=True)
cell(ws, f'C{r}', NAME, sz=9, wrap=True); cell(ws, f'D{r}', 'M2', wrap=True)
for i, f in enumerate(FLOORS):
    v = '=計算式!E8' if f == '3F' else 0
    cell(ws, f'{col(5 + i)}{r}', v, fmt=NUM2, h='right')
cell(ws, f'T{r}', '=SUM(E5:S5)', b=True, fill=GRY, fmt='#,##0.00', h='right')
cell(ws, f'U{r}', CONTRACT, fill=GRY, fmt='#,##0.00', h='right')
cell(ws, f'V{r}', '=T5/U5', fill=ORG, fmt='0.0%', h='right')
cell(ws, f'W{r}', '照圖面實際數量', sz=9, wrap=True)
ws.row_dimensions[5].height = 30
cell(ws, 'A7', '二、各樓層占該項百分比', b=True, sz=12, border=False)
for i, t in enumerate(['項次', '代號', '品名', '單位'] + FLOORS + ['合計'], 1):
    cell(ws, f'{col(i)}8', t, b=True, fill=HDR, h='center', wrap=True)
cell(ws, 'A9', ITEM, wrap=True); cell(ws, 'B9', CODE, wrap=True); cell(ws, 'C9', NAME, sz=9, wrap=True)
cell(ws, 'D9', '%', wrap=True)
for i in range(len(FLOORS)):
    L = col(5 + i); cell(ws, f'{L}9', f'=IF($T5=0,"",{L}5/$T5)', fmt=PC1, h='right')
cell(ws, 'T9', '=SUM(E9:S9)', b=True, fill=GRY, fmt='0.0%', h='right')
ws.row_dimensions[9].height = 30
for k, w in {'A': 16, 'B': 10, 'C': 46, 'D': 6, 'T': 12, 'U': 10, 'V': 10, 'W': 34}.items():
    ws.column_dimensions[k].width = w
for i in range(5, 20): ws.column_dimensions[col(i)].width = 10
ws.freeze_panes = 'E5'

ws = wb.create_sheet('計算式')
cell(ws, 'A1', '高雄軟體園區第二園區第一棟大樓 — 高架地板項目 數量計算式', b=True, sz=14, border=False)
ws.merge_cells('A2:E2')
cell(ws, 'A2', '依據：建築圖 A2-09 三層平面圖（333 標註「高架地坪H=30cm、完成面FFL+1215」）、A1-51~A1-53 室內裝修表（333 地坪 F20+G2）；單位 m²。'
     '高架地板面積 = 房間淨面積（與地坪 F20、天花板、油漆共用逐間沿牆內緣人工描繪的房間範圍；凸出牆面柱位扣除，房間中間的獨立柱不扣，門扇與門窗標籤處計入）。'
     f'比例尺依 X2~X9（7,700 cm）、Y6~Y1（3,470 cm）軸線校正：X {SX:.4f}、Y {SY:.4f} cm/像素（300 dpi）。G2 屬防水類代號，不列入本項。各項照圖面實際數量填寫，不依合約數量調整。',
     border=False, wrap=True)
ws.row_dimensions[2].height = 90
ws.merge_cells('A4:E4')
cell(ws, 'A4', f'{ITEM}\u3000{NAME}\u3000（單位：M2\u3000合約數量：{CONTRACT:,.1f}）', b=True, fill=ITM, wrap=True)
for i, t in enumerate(['樓層', '房號／部位', '空間名稱', '計算式', '數量(m²)'], 1):
    cell(ws, f'{col(i)}5', t, b=True, fill=HDR, h='center', wrap=True)
cell(ws, 'A6', '3F', h='center', wrap=True); cell(ws, 'B6', '333', wrap=True)
cell(ws, 'C6', '智慧監控管理中心', wrap=True)
cell(ws, 'D6', f'淨面積 {Q}', wrap=True); cell(ws, 'E6', f'={Q}', fmt='#,##0.00', wrap=True)
cell(ws, 'A7', '', wrap=True); cell(ws, 'B7', '（驗算）', wrap=True); cell(ws, 'C7', '分解式', wrap=True)
cell(ws, 'D7', DECOMP + '（僅供驗算，不重複計入）', wrap=True); cell(ws, 'E7', None, wrap=True)
ws.row_dimensions[7].height = 48
ws.merge_cells('B8:D8')
cell(ws, 'A8', '3F', b=True, fill=GRY, h='center', wrap=True); cell(ws, 'B8', '3F 小計', b=True, fill=GRY, wrap=True)
cell(ws, 'E8', '=E6', b=True, fill=GRY, fmt='#,##0.00', wrap=True)
ws.merge_cells('A9:D9')
cell(ws, 'A9', f'{CODE} 合計', b=True, fill=GRY, wrap=True)
cell(ws, 'E9', '=E8', b=True, fill=GRY, fmt='#,##0.00', wrap=True)
for k, w in {'A': 9, 'B': 16, 'C': 24, 'D': 80, 'E': 13}.items(): ws.column_dimensions[k].width = w
ws.freeze_panes = 'A4'

ws = wb.create_sheet('施工細項表')
cell(ws, 'A1', '高架地板項目 施工細項表（各層數量及細項占比）', b=True, sz=14, border=False)
ws.merge_cells('A2:F2')
cell(ws, 'A2', '每層兩列：上列為數量，下列為占該工項百分比。進料、支架組立、面板安裝 3 個細項各以本層數量 100% 計，不分權重；'
     '細項百分比 = 細項數量 ÷ 該工項合計，各細項百分比合計皆為 100%。施工時某層某細項完成，即填該格數量。', border=False, wrap=True)
ws.row_dimensions[2].height = 48
ws.merge_cells('A4:F4')
cell(ws, 'A4', f'{ITEM}\u3000{CODE}\u3000{NAME}', b=True, fill=ITM, wrap=True)
for i, t in enumerate(['樓層', None, '本層合計'] + [f'{s}（100%）' for s in SUBS], 1):
    cell(ws, f'{col(i)}5', t, b=True, fill=HDR, h='center', wrap=True)
ws.merge_cells('A5:B5')
cell(ws, 'A6', '3F', b=True, h='center', wrap=True); cell(ws, 'A7', None)
cell(ws, 'B6', '數量(m²)', h='center', wrap=True); cell(ws, 'B7', '百分比', fill=PCT, h='center', wrap=True)
cell(ws, 'C6', '=總表!J5', fmt='#,##0.00', wrap=True)
cell(ws, 'C7', '=C6/總表!T5', fill=PCT, fmt='0.00%', wrap=True)
for L in 'DEF':
    cell(ws, f'{L}6', '=C6', fmt='#,##0.00', wrap=True)
    cell(ws, f'{L}7', f'={L}6/總表!T5', fill=PCT, fmt='0.00%', wrap=True)
cell(ws, 'A8', '合計', b=True, h='center', wrap=True); cell(ws, 'A9', None)
cell(ws, 'B8', '數量(m²)', h='center', wrap=True); cell(ws, 'B9', '百分比', fill=PCT, h='center', wrap=True)
for L in 'CDEF':
    cell(ws, f'{L}8', f'={L}6', b=True, fill=GRY, fmt='#,##0.00', wrap=True)
    cell(ws, f'{L}9', f'={L}7', b=True, fill=PCT, fmt='0.00%', wrap=True)
ws.merge_cells('A6:A7'); ws.merge_cells('A8:A9')
for k, w in {'A': 11, 'B': 10, 'C': 14, 'D': 16, 'E': 16, 'F': 16}.items(): ws.column_dimensions[k].width = w
ws.freeze_panes = 'A4'
wb.save(os.path.join(OUT, '高架地板_數量計算表.xlsx'))

# ===== 分層數量表 =====
wb = openpyxl.Workbook(); ws = wb.active; ws.title = '分層數量表'
cell(ws, 'A1', '高雄軟體園區第二園區第一棟大樓 — 高架地板項目 分層數量（依建築圖 A2-04~A2-19 量測）', b=True, sz=14, border=False)
ws.merge_cells('A2:W2')
cell(ws, 'A2', '一、圖面數量；二、占該項百分比 = 該樓層數量 ÷ 全部樓層合計；三、填報數量：照圖面實際數量，不依合約調整。圖面與合約差異 ±2% 以上標紅底（僅供對照）。',
     border=False, wrap=True)
ws.row_dimensions[2].height = 32.1
fl_hdr = [f'{f}\n{s}' for f, s in zip(FLOORS, SHEETS)]
def block(r0, title, kind):
    cell(ws, f'A{r0}', title, b=True, sz=12, border=False)
    extra = {'qty': ['合計', '合約數量', '圖面/合約', '備註'], 'pct': ['合計'], 'rep': ['合計', '合約數量']}[kind]
    for i, t in enumerate(['項次', '代號', '品名', '單位'] + fl_hdr + extra, 1):
        cell(ws, f'{col(i)}{r0 + 1}', t, b=True, fill=HDR, h='center', wrap=True)
    r = r0 + 2
    cell(ws, f'A{r}', ITEM, wrap=True); cell(ws, f'B{r}', CODE, wrap=True)
    cell(ws, f'C{r}', NAME, sz=9, wrap=True); cell(ws, f'D{r}', '%' if kind == 'pct' else 'M2', wrap=True)
    for i, f in enumerate(FLOORS):
        L = col(5 + i)
        if kind == 'pct': cell(ws, f'{L}{r}', QTY[f] / Q, fmt=PC1, h='right')
        else: cell(ws, f'{L}{r}', QTY[f], fmt=NUM1, h='right')
    cell(ws, f'T{r}', f'=SUM(E{r}:S{r})', b=True, fill=GRY, fmt='0.0%' if kind == 'pct' else '#,##0.0', h='right')
    if kind != 'pct': cell(ws, f'U{r}', CONTRACT, fill=GRY, fmt='#,##0.0', h='right')
    if kind == 'qty':
        ratio = Q / CONTRACT
        cell(ws, f'V{r}', ratio, fill=ORG if abs(ratio - 1) >= 0.02 else None, fmt='0.0%', h='right')
        cell(ws, f'W{r}', '3F 333 智慧監控管理中心；照圖面實際數量', sz=9, wrap=True)
    ws.row_dimensions[r].height = 30
block(3, '一、圖面數量', 'qty'); block(8, '二、占該項百分比', 'pct'); block(13, '三、填報數量', 'rep')
for k, w in {'A': 16, 'B': 10, 'C': 44, 'D': 6, 'T': 12, 'U': 10, 'V': 10, 'W': 34}.items():
    ws.column_dimensions[k].width = w
for i in range(5, 20): ws.column_dimensions[col(i)].width = 10
ws.freeze_panes = 'E5'

ws = wb.create_sheet('房間明細')
H2 = ['樓層', '圖號', '房號／部位', '空間名稱', '裝修表地坪', '淨面積(m²)', 'F20(m²)', '量測方式']
for i, t in enumerate(H2, 1): cell(ws, f'{col(i)}1', t, b=True, fill=HDR, h='center', wrap=True)
row = ['3F', 'A2-09', '333', '智慧監控管理中心', 'F20+G2', Q, Q,
       '沿牆內緣人工描繪多邊形（12 點），扣西北角柱、北側柱；含門 D7 內側踏階、西南角 D10 櫃位、東南「陽台計入容積」範圍；房內獨立柱不扣。' + DECOMP]
for i, v in enumerate(row, 1):
    cell(ws, f'{col(i)}2', v, fmt='#,##0.00' if i in (6, 7) else None, wrap=True)
ws.row_dimensions[2].height = 75
for k, w in {'A': 7, 'B': 9, 'C': 12, 'D': 20, 'E': 12, 'F': 11, 'G': 11, 'H': 90}.items():
    ws.column_dimensions[k].width = w
ws.freeze_panes = 'E2'

ws = wb.create_sheet('計算說明')
md = open(os.path.join(OUT, '高架地板數量計算說明.md'), encoding='utf-8').read().split('\n')
for i, line in enumerate(md, 1):
    ws.cell(i, 1, line if line else None).font = Font(name=FN, sz=11)
ws.column_dimensions['A'].width = 160
wb.save(os.path.join(OUT, '高架地板_分層數量表.xlsx'))
print('xlsx ok')

# ---------- A3 圖 ----------
FONT = r'C:\Windows\Fonts\msjh.ttc'; FONTB = r'C:\Windows\Fonts\msjhbd.ttc'
def F(sz, b=False): return ImageFont.truetype(FONTB if b else FONT, sz)
FILL = (255, 140, 0); EDGE = (200, 80, 0)

doc = fitz.open(os.path.join(ROOT, 'A2-08~A2-17(260916)印.pdf'))
pix = doc[1].get_pixmap(dpi=300, colorspace=fitz.csGRAY)
page = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w).copy()
blur = cv2.GaussianBlur(page, (0, 0), 1.2)
page = cv2.addWeighted(page, 1.6, blur, -0.6, 0)

def overlay(rgb, pts, alpha=0.45):
    mask = np.zeros(rgb.shape[:2], np.uint8)
    cv2.fillPoly(mask, [np.round(pts).astype(np.int32)], 255)
    col_ = np.array(FILL, float)
    sel = mask > 0
    rgb[sel] = (rgb[sel] * (1 - alpha) + col_ * alpha).astype(np.uint8)
    cv2.polylines(rgb, [np.round(pts).astype(np.int32)], True, EDGE, 5, cv2.LINE_AA)
    return rgb

def card(draw, cx, cy, lines, fs, pad=10):
    f = F(fs)
    ws_ = [draw.textbbox((0, 0), t, font=f) for t in lines]
    w = max(b[2] - b[0] for b in ws_) + 2 * pad; lh = fs + 8; h = lh * len(lines) + 2 * pad - 4
    x0, y0 = cx - w / 2, cy - h / 2
    draw.rectangle([x0, y0, x0 + w, y0 + h], fill='white', outline='black', width=3)
    for i, t in enumerate(lines):
        b = draw.textbbox((0, 0), t, font=f)
        draw.text((cx - (b[2] - b[0]) / 2 - b[0], y0 + pad + i * lh - b[1] + 2), t, fill='black', font=f)
    return (x0, y0, x0 + w, y0 + h)

CARD_PG = (3945, 1632)   # 卡片中心（原圖 px）：333 東側空白處，不遮「高架地坪H=30cm」圖註
LINES = ['333', f'{CODE} {Q:.2f}m²']

# A3 實際數量圖
S = 1.303; OX, OY = 381.5, 878.3
A3 = np.full((3508, 4961, 3), 255, np.uint8)
FX0, FY0, FX1, FY1 = 90, 90, 4870, 2715
M = np.float32([[S, 0, -OX * S], [0, S, -OY * S]])
warped = cv2.warpAffine(page, M, (4961, 3508), flags=cv2.INTER_CUBIC, borderValue=255)
A3[FY0:FY1, FX0:FX1] = cv2.cvtColor(warped[FY0:FY1, FX0:FX1], cv2.COLOR_GRAY2RGB)
pts = (poly - [OX, OY]) * S
A3 = overlay(A3, pts)
cv2.rectangle(A3, (FX0, FY0), (FX1, FY1), (0, 0, 0), 4)
im = Image.fromarray(A3); d = ImageDraw.Draw(im)
cb = card(d, (CARD_PG[0] - OX) * S, (CARD_PG[1] - OY) * S, LINES, 36)
# 卡片不可蓋到多邊形邊線（留 12px）
cbx = cv2.pointPolygonTest(np.float32(pts), ((cb[0] + cb[2]) / 2, (cb[1] + cb[3]) / 2), True)
for (x, y) in [(cb[0], cb[1]), (cb[2], cb[1]), (cb[0], cb[3]), (cb[2], cb[3])]:
    dist = cv2.pointPolygonTest(np.float32(pts), (float(x), float(y)), True)
    assert dist > 12, ('card too close to edge', dist)
d.text((FX0, 2745), '3F 參層平面圖（A2-09）— 高架地板數量', fill='black', font=F(54, True))
y = 2850
for x, t in [(110, '代號'), (330, '品名'), (2300, '本層數量'), (2650, '占該項%')]:
    d.text((x, y), t, fill='black', font=F(30))
y = 2915
d.rectangle([110, y + 4, 150, y + 40], fill=FILL, outline=EDGE, width=3)
d.text((175, y), CODE, fill='black', font=F(32))
d.text((330, y), 'F20-地坪金屬高架地板(綠建材)H=30cm（鋁合金高架地板）', fill='black', font=F(30))
d.text((2300, y), f'{Q:.2f}m²', fill='black', font=F(32, True))
d.text((2650, y), '100.0%', fill='black', font=F(32))
note = ['說明：橘色塊為高架地板範圍（3F 333 智慧監控管理中心，圖註「高架地坪H=30cm、完成面FFL+1215」）；標籤為房號／代號／圖面實際面積（m²）。',
        '面積為沿牆內緣人工描繪之淨面積，與地坪 F20 相同；全棟僅 3F 有本項。不依合約數量調整（合約 98 m²）。數量計算式詳「高架地板_數量計算表.xlsx」。原圖比例 S:1/300@A3，本圖已放大，僅供數量對照。']
for i, t in enumerate(note): d.text((90, 3060 + i * 44), t, fill=(60, 60, 60), font=F(26))
p_a3 = os.path.join(OUT, '3F', '3F_實際數量.png')
im.save(p_a3, dpi=(300, 300))

# 最終標註（原圖解析度裁切 + 右側圖例）
X0, Y0, X1, Y1 = 560, 1290, 4130, 2920
crop = cv2.cvtColor(page[Y0:Y1, X0:X1], cv2.COLOR_GRAY2RGB)
crop = overlay(crop, poly - [X0, Y0])
PW = 700
canvas = np.full((Y1 - Y0, X1 - X0 + PW, 3), 255, np.uint8); canvas[:, :X1 - X0] = crop
im2 = Image.fromarray(canvas); d2 = ImageDraw.Draw(im2)
card(d2, CARD_PG[0] - X0, CARD_PG[1] - Y0, LINES, 30, pad=8)
lx = X1 - X0 + 30
d2.text((lx, 20), '3F 參層平面圖（A2-09）— 高架地板項目', fill='black', font=F(34, True))
d2.text((lx, 90), '代號', fill='black', font=F(26)); d2.text((lx + 140, 90), '本層數量', fill='black', font=F(26))
d2.rectangle([lx, 142, lx + 34, 172], fill=FILL, outline=EDGE, width=3)
d2.text((lx + 50, 138), CODE, fill='black', font=F(28)); d2.text((lx + 360, 138), f'{Q:.2f}m²', fill='black', font=F(28))
for i, t in enumerate(['橘色塊 = 高架地板範圍（H=30cm）；', '標籤：房號／代號／淨面積。', '全棟僅 3F 333 有本項；',
                       '合約 98 m²，圖面 98.8 m²。']):
    d2.text((lx, 220 + i * 40), t, fill=(60, 60, 60), font=F(24))
im2.save(os.path.join(OUT, '3F', '3F_最終標註.png'), dpi=(300, 300))

# PDF（A3 一頁）
Image.open(p_a3).convert('RGB').save(os.path.join(OUT, '高架地板_各樓層A3.pdf'), resolution=300)
print('images/pdf ok', cb)
