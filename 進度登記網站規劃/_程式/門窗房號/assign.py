# 每一樘門窗 → 房號
import pickle, json, numpy as np, csv
from common import *
from roominfo import *
cal=json.load(open(SP+'calib.json',encoding='utf-8'))
d=load_dwg(); tags=load_tags(); objs=pickle.load(open(SP+'doorobj.pkl','rb'))
web=web_rooms(); si=sheet_rooms(); dn=dwg_names(d)
try: MAN=json.load(open(SP+'manual.json',encoding='utf-8'))
except FileNotFoundError: MAN={}
PUB=re.compile(r'走廊|梯廳|前室|車道|停車|排煙室|大廳|風除室|電梯廳|門廊|通道|穿堂')
OUTD=re.compile(r'陽台|露臺|露台|屋頂平台')
def wfl(fl): return '屋突層' if fl.startswith('屋突') else fl
def rname(fl,n):
    if n in web.get(wfl(fl),{}): return web[wfl(fl)][n]
    if (wfl(fl),n) in si: return si[(wfl(fl),n)][0]
    return dn.get((fl,n),'')
def rclass(fl,n):
    if n=='OUT' or re.match(r'RT\d',n): return 2
    nm=rname(fl,n)
    if OUTD.search(nm): return 2
    if PUB.search(nm): return 1
    return 0
rows=[]
maps={}
RECT=collections.defaultdict(dict)
_wb=openpyxl.load_workbook(ROOT+'分層數量表_地坪及貼面磚.xlsx',read_only=True,data_only=True)
for r in list(_wb['房間明細'].iter_rows(values_only=True))[1:]:
    mm_=re.search(r'rect x(\d+)-(\d+) y(\d+)-(\d+)',str(r[7] or ''))
    if r[0] and mm_ and re.match(r'^[A-Z]?\d{2,4}[a-z]?$',str(r[2])): RECT[r[0]][str(r[2])]=tuple(int(v) for v in mm_.groups())
for t in tags:
    fl=t['fl']
    if fl not in maps: maps[fl]=pickle.load(open(SP+f'sm_{fl}.pkl','rb'))
    m=maps[fl]; A=np.array(m['A']); F=m['F']; Ai=np.linalg.inv(np.vstack([A,[0,0,1]]))[:2]
    names=m['names']; lab=m['lab']; wall=m['wall']
    def area(n):
        k=(wfl(fl),n)
        if k in si and si[k][1]>0: return si[k][1]
        if n in names: return float((lab==names.index(n)).sum()*(m['cmpx']/100)**2)
        return 1e9
    P=A@np.array([t['x'],t['y'],1])
    ref=cal[fl]['matched'].get(t['seq'])
    matched=ref is not None
    ref=np.array(ref) if matched else P
    isDA=t['code']=='DA'
    best=None
    for k,n,(x0,y0,x1,y1) in objs:
        if band((y0+y1)/2)!=fl: continue
        if isDA != (n=='維修口'): continue
        dx=max(x0-ref[0],0,ref[0]-x1); dy=max(y0-ref[1],0,ref[1]-y1)
        dd=np.hypot(dx,dy)
        if dd<(150 if isDA else 250) and (not best or dd<best[0]): best=(dd,(x0,y0,x1,y1))
    E=60
    if best:
        x0,y0,x1,y1=best[1]; box=[(x0-E,y0-E),(x1+E,y1+E),(x0-E,y1+E),(x1+E,y0-E)]
    else:
        R=120; box=[(ref[0]-R,ref[1]-R),(ref[0]+R,ref[1]+R),(ref[0]-R,ref[1]+R),(ref[0]+R,ref[1]-R)]
    cs=[Ai@np.array([x,y,1])/F for x,y in box]
    cx0=int(max(0,min(c[0] for c in cs))); cx1=int(min(m['W']-1,max(c[0] for c in cs)))
    cy0=int(max(0,min(c[1] for c in cs))); cy1=int(min(m['H']-1,max(c[1] for c in cs)))
    sub=lab[cy0:cy1+1,cx0:cx1+1]
    cnt=collections.Counter(sub[sub>0].ravel().tolist())
    tot=sum(cnt.values()) or 1
    cand=[(names[i],c) for i,c in cnt.most_common() if c>=max(6,0.10*tot)]
    rooms=[n for n,c in cand if n!='OUT']
    note=[]; how=''; conf=''
    if not best: note.append('DWG 找不到對應門窗圖塊，以標籤周邊判斷')
    if not matched and not isDA: note.append('DWG 無此標籤')
    if len(rooms)>2:
        note.append('周邊有 %s，取占比最高兩間'%('、'.join(rooms)))
        rooms=rooms[:2]
    if not rooms:
        room=None; how='待確認'; note.append('周邊找不到房間')
    elif len(rooms)==1:
        room=rooms[0]; how='牆邊歸房規則'
        note.append('唯一相鄰房間'+('（外側為戶外）' if any(n=='OUT' for n,c in cand) else ''))
        conf='高'
    else:
        a,b=rooms; ca,cb=rclass(fl,a),rclass(fl,b)
        how='牆邊歸房規則'
        if ca!=cb:
            room=a if ca<cb else b; conf='高'
            note.append(f'{a}／{b} 之間，歸非公共空間' if min(ca,cb)==0 and max(ca,cb)==1 else f'{a}／{b} 之間，歸室內側')
        else:
            sa,sb=area(a),area(b); room=a if sa<=sb else b
            conf='高' if max(sa,sb)/max(min(sa,sb),0.1)>1.5 else '中'
            kind={0:'兩側皆房間',1:'兩側皆公共空間',2:'兩側皆戶外'}[ca]
            note.append(f'{a}／{b} 之間，{kind}，取面積小者（{sa:.1f}／{sb:.1f} m²）')
            if ca==1: conf='中'
            if ca==2: room=None; how='待確認'
    if room and (not best or (not matched and not isDA)) and conf=='高': conf='中'
    if len(note) and '取占比最高兩間' in note[0] or any('取占比最高兩間' in x for x in note): conf='低' if room else conf
    # DA：依判讀備註的牆向，往室內側 1.5 m 取房間
    dm=re.search(r'(左|右|上|下)\((西|東|北|南)\)牆',t['note']) if isDA else None
    if dm:
        v={'左':(1,0),'右':(-1,0),'上':(0,1),'下':(0,-1)}[dm.group(1)]
        cpx=m['cmpx']/F   # cm per scan px
        hits=collections.Counter()
        for dist_cm in (100,150,200):
            px_=(t['x']+v[0]*dist_cm/cpx)/F; py_=(t['y']+v[1]*dist_cm/cpx)/F
            r_=int(50/m['cmpx'])
            sub=lab[int(py_)-r_:int(py_)+r_+1,int(px_)-r_:int(px_)+r_+1]
            hits.update(sub[sub>0].ravel().tolist())
        hits.pop(names.index('OUT'),None)
        if hits:
            room=names[hits.most_common(1)[0][0]]; how='牆邊歸房規則'; conf='高'
            note=[f'複壁檢修門，{dm.group(0)}，取室內側（往內 1～2 m）房間']
            if len(hits)>1 and hits.most_common(2)[1][1]>0.3*hits.most_common(1)[0][1]:
                conf='中'; note.append('室內側另有 '+names[hits.most_common(2)[1][0]])
        # 內側點落在房間明細 rect 內 → 以 rect 為準
        k300=1.0 if m['F']==3 else 1.5
        cpx=m['cmpx']/F
        px3=(t['x']+v[0]*150/cpx)*k300; py3=(t['y']+v[1]*150/cpx)*k300
        for rn,(rx1,rx2,ry1,ry2) in RECT.get(wfl(fl),{}).items():
            if rx1-15<=px3<=rx2+15 and ry1-15<=py3<=ry2+15:
                room=rn; how='座標落在 rect 內'; conf='高'
                note=[f'複壁檢修門，{dm.group(0)}，往內 1.5 m 落在房間明細 {rn} 的量測 rect 內']
                break
    k=t['seq']
    if k in MAN and 'verify' in MAN[k]:
        if room==MAN[k]['verify']: conf='高'; note.append('已目視核對')
        else: note.append(f"！目視核對為 {MAN[k]['verify']}，與自動結果不同")
    elif k in MAN:
        mm=MAN[k]; room=mm['room']; how='人工'; conf=mm.get('conf','高'); note=[mm['why']]
    if room is None: how="待確認"; conf=""
    rows.append(dict(fl=fl,seq=k,code=t['code'],room=room,name=rname(fl,room) if room else '',how=how,conf=conf,note='；'.join(note),
                     x=t['x'],y=t['y'],box=(cx0,cy0,cx1,cy1),cand=cand))
pickle.dump(rows,open(SP+'assign.pkl','wb'))
c=collections.Counter((r['fl'],r['how'],r['conf']) for r in rows)
for fl in FLS:
    print(fl, {f'{h}{cf}':v for (f,h,cf),v in c.items() if f==fl})
