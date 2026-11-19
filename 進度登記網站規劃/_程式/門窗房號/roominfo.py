# 房號 → 空間名稱、面積；網站房間清單
from common import *
import json
def web_rooms():
    data=json.load(open(ROOT+'進度登記網站規劃/_程式/data.json',encoding='utf-8'))
    web=collections.defaultdict(dict)
    for c in data:
        if c['cat']=='門窗': continue
        for it in c['items']:
            for r in it['rows']:
                if re.match(r'^[A-Z]?\d{2,4}[a-z]?(\+\d+[a-z]?)?$', str(r[1]), re.I):
                    web[r[0]].setdefault(str(r[1]), r[2])
    return web
def sheet_rooms():
    wb=openpyxl.load_workbook(ROOT+'分層數量表_地坪及貼面磚.xlsx',read_only=True,data_only=True)
    info={}
    for r in list(wb['房間明細'].iter_rows(values_only=True))[1:]:
        if not r[0]: continue
        k=(r[0],str(r[2]))
        nm,a=info.get(k,(None,0))
        info[k]=(nm or r[3], a+(r[5] if isinstance(r[5],(int,float)) else 0))
    return info
def dwg_names(d):
    # DWG 房號附近（上方 400cm 內）的中文字
    out={}
    tx=[(s,p) for s,p,L,h in d['text'] if s and re.search(r'[\u4e00-\u9fff]',s) and len(s)<20]
    for n,p in d['room']:
        fl=band(p[1]); best=None
        for s,q in tx:
            dx,dy=q[0]-p[0],q[1]-p[1]
            if abs(dx)<350 and -60<dy<400:
                dd=abs(dx)+abs(dy)
                if not best or dd<best[0]: best=(dd,s)
        if best: out[(fl,n)]=best[1].strip()
    return out
