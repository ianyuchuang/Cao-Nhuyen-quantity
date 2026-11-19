# 從各工項數量計算表萃取「工項 > 代號 > 樓層 > 房間 > 數量」，輸出 data.json，並把資料與審查意見注入 template.html 產生規劃頁
# 用法：python extract.py（在任何目錄執行皆可）
import csv, json, math, os, re, sys
import openpyxl
from openpyxl.utils import column_index_from_string as ci

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'data.json')
os.chdir(ROOT)

CATS = [('貼面磚', '磁磚數量/貼面磚_數量計算表.xlsx'),
        ('天然石材（地坪）', '天然石材數量/天然石材_數量計算表.xlsx'),
        ('天然石材（立面）', '天然石材數量/天然石材_立面_數量計算表.xlsx'),
        ('塑木地板', '塑木地板數量/塑木地板_數量計算表.xlsx'),
        ('高架地板', '高架地板數量/高架地板_數量計算表.xlsx'),
        ('天花板', '天花板數量/天花板_數量計算表.xlsx'),
        ('油漆', '油漆數量/油漆_數量計算表.xlsx'),
        ('防水', '防水數量/防水_數量計算表.xlsx'),
        ('門窗', '門窗數量/門窗_數量計算表.xlsx'),
        ('防水閘門', '防水閘門數量/防水閘門_數量計算表.xlsx'),
        ('欄杆', '欄杆數量/欄杆_數量計算表.xlsx')]
FL = re.compile(r'^(筏基層|B\dF|\d+F|屋突.*|RF|R\dF)$')

# 每日施工內容 CSV：只取合約數量與使用數量（不取單價、複價）
CSVQ = {}
with open('高軟每日施工內容(正式版) - 施工-實際進度 (修訂2版).csv', encoding='utf-8-sig') as f:
    for r in csv.reader(f):
        no = r[0].strip()
        if no.startswith('I.甲'):
            num = lambda s: float(s.replace(',', '')) if re.match(r'^-?[\d,.]+$', s.strip() or 'x') else None
            CSVQ[no] = (num(r[4]), num(r[6]))


def mkeval(rows):
    """計算式工作表的公式求值：只支援四則、SQRT、^、儲存格參照與 SUM 範圍。"""
    memo = {}

    def cell(c, r):
        row = rows[r - 1] if r - 1 < len(rows) else []
        v = row[ci(c) - 1] if ci(c) - 1 < len(row) else None
        return ev(v, (c, r))

    def ev(v, key=None):
        if key in memo:
            return memo[key]
        if not (isinstance(v, str) and v.startswith('=')):
            res = v if isinstance(v, (int, float)) else 0
        else:
            e = v[1:].replace('$', '')

            def rng(m):
                c1, r1, c2, r2 = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
                cols = range(ci(c1), ci(c2) + 1)
                from openpyxl.utils import get_column_letter as gl
                return repr(sum(cell(gl(c), r) or 0 for r in range(r1, r2 + 1) for c in cols))
            e = re.sub(r'SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)', rng, e)
            e = re.sub(r'\b([A-Z]{1,2})(\d+)\b', lambda m: repr(cell(m.group(1), int(m.group(2))) or 0), e.replace('SQRT', 'sqrt'))
            res = eval(e.replace('^', '**').replace('sqrt', 'math.sqrt'), {'math': math})
        memo[key] = res
        return res
    return ev


def item_steps(wb):
    """施工細項表：每個項次各自的細項名稱與權重。門窗、防水閘門依類別，回傳類別表。"""
    steps, cur = {}, None
    for r in wb['施工細項表'].iter_rows(values_only=True):
        a = r[0]
        if isinstance(a, str) and a.startswith('I.甲'):
            cur = a.split('　')[0].strip()
        elif a == '樓層' and '本層合計' in r and cur and cur not in steps:
            st = [str(c) for c in r[r.index('本層合計') + 1:] if c]
            steps[cur] = None if any(x.startswith('=') for x in st) else st  # 門窗、閘門的表頭是公式，依類別另定
    return steps


def merge(rows):
    """同一代號、同一樓層、同一房號的多列（如踏面＋踢面）合併成一筆，名稱不重複地串起來。"""
    mg = {}
    for fl, rid, nm, q in rows:
        k = (fl, rid)
        if k in mg:
            mg[k][3] += q
            if nm and nm not in mg[k][2].split('；'):
                mg[k][2] += '；' + nm
            mg[k][4] += 1
        else:
            mg[k] = [fl, rid, nm, q, 1]
    return [[v[0], v[1], v[2], round(v[3], 4)] + ([v[4]] if v[4] > 1 else []) for v in mg.values()]


DOOR_STEPS = {  # 施工細項表類別權重：進料 0.5 改在代號層登記，其餘兩項依 0.3：0.2 換成 60%／40%
    '門': [['門框', 0.6], ['門扇及五金', 0.4]],
    '窗': [['窗框', 0.6], ['玻璃／百葉及五金', 0.4]],
    '捲門': [['導軌及捲軸箱', 0.6], ['門片及電動機', 0.4]]}
CLASS_OF = {'鋼板門': '門', '複壁檢修門': '門', '蜂巢推門': '門', '鋁窗': '窗', '鋁百葉窗': '窗', '鋁門窗': '窗', '電動捲門': '捲門'}


def expand_tags(wb, items):
    """門窗展開到每一樘：依標籤明細逐樘列出，並核對每層樘數與計算式一致。"""
    tags = {}
    for r in list(wb['標籤明細'].iter_rows(values_only=True))[1:]:
        if r[3] and r[4] in CLASS_OF:
            fl = '屋突層' if str(r[0]).startswith('屋突') else r[0]
            tags.setdefault(r[3], []).append([fl, r[2], (r[7] or '').strip(), 1, CLASS_OF[r[4]]])
    for it in items:
        tl = tags.get(it['code'], [])
        calc = {}
        for row in it['rows']:
            calc[row[0]] = calc.get(row[0], 0) + row[3]
        got = {}
        for t in tl:
            got[t[0]] = got.get(t[0], 0) + 1
        if calc != got:
            raise SystemExit(f"門窗 {it['code']} 標籤樘數與計算式不符：{calc} vs {got}")
        cls = {t[4] for t in tl}
        if len(cls) != 1:
            raise SystemExit(f"門窗 {it['code']} 類別不一：{cls}")
        it['tagSteps'] = DOOR_STEPS[cls.pop()]
        it['rows'] = [t[:4] for t in tl]


out = []
for cat, f in CATS:
    wb = openpyxl.load_workbook(f, read_only=True)
    meta = {}
    for r in wb['總表'].iter_rows(values_only=True):
        if isinstance(r[0], str) and r[0].startswith('I.甲') and r[0] not in meta:
            meta[r[0]] = (r[1], r[2], r[3])
    steps = item_steps(wb)
    rows = [list(r) for r in wb['計算式'].iter_rows(values_only=True)]
    ev = mkeval(rows)
    items, cur, qi = [], None, None
    for n, r in enumerate(rows, 1):
        a = r[0]
        if isinstance(a, str) and a.startswith('I.甲'):
            no = a.split('　')[0].strip()
            m = meta.get(no, (None, a, None))
            cur = {'no': no, 'code': m[0], 'name': m[1], 'unit': m[2], 'steps': steps.get(no),
                   'contract': CSVQ.get(no, (None, None))[0], 'used': CSVQ.get(no, (None, None))[1], 'rows': []}
            items.append(cur)
            qi = None
            continue
        if cur is None:
            continue
        if a == '樓層':
            qi = max(i for i, c in enumerate(r) if c and '數量' in str(c))
            continue
        if isinstance(a, str) and FL.match(a.strip()) and r[1] and '小計' not in str(r[1]) and qi is not None:
            q = ev(r[qi], ('X', n))  # 求值失敗直接中止，避免漏列
            rid, nm = str(r[1]).strip(), str(r[2] or '').strip()
            if cat == '門窗':
                rid = re.sub(r'（.*', '', rid)
            cur['rows'].append([a.strip(), rid, nm, q])
    for it in items:
        it['rows'] = merge(it['rows'])
    if cat == '門窗':
        expand_tags(wb, items)
    out.append({'cat': cat, 'items': [i for i in items if i['rows']]})

# 地坪 F2、F3、F12（EPOXY、粉光）與 F13（天然石材）只在根目錄分層數量表的房間明細
wb = openpyxl.load_workbook('分層數量表_地坪及貼面磚.xlsx', read_only=True, data_only=True)
meta = {}
for r in wb['分層數量表'].iter_rows(values_only=True, max_row=32):
    if isinstance(r[0], str) and r[0].startswith('I.甲'):
        meta[r[1]] = (r[0], r[2])
its = {c: {'no': meta[c][0], 'code': c, 'name': meta[c][1], 'unit': 'M2', 'steps': None,
           'contract': CSVQ.get(meta[c][0], (None, None))[0], 'used': CSVQ.get(meta[c][0], (None, None))[1], 'rows': []}
       for c in ['F2', 'F3', 'F12', 'F13']}
for r in list(wb['房間明細'].iter_rows(values_only=True))[1:]:
    if not r[0] or not r[6]:
        continue
    for c in str(r[6]).split('、'):
        c = c.strip()
        if c in its and isinstance(r[5], (int, float)):
            its[c]['rows'].append([r[0], str(r[2]), str(r[3] or ''), r[5]])
for it in its.values():
    it['rows'] = merge(it['rows'])
out.insert(1, {'cat': '地坪（EPOXY／粉光）', 'items': [its['F2'], its['F3'], its['F12']]})
out[2]['items'].insert(0, its['F13'])  # 天然石材（地坪）

for c in out:
    print(c['cat'], len(c['items']), sum(len(i['rows']) for i in c['items']), file=sys.stderr)
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

tpl = open(os.path.join(HERE, '..', 'template.html'), encoding='utf-8').read()
rv = os.path.join(HERE, '..', 'review.html')
html = tpl.replace('/*DATA*/', json.dumps(out, ensure_ascii=False, separators=(',', ':')))
html = html.replace('<!--REVIEW-->', open(rv, encoding='utf-8').read() if os.path.exists(rv) else '<p class="muted">審查中。</p>')
open(os.path.join(HERE, '..', '進度登記網站規劃.html'), 'w', encoding='utf-8').write(html)
print('ok', len(html), file=sys.stderr)
