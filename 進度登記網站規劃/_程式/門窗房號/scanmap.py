# 以掃描平面圖做房間標記圖：牆＝深色像素（去小字），種子＝DWG 房號（轉到掃描座標）＋房間明細 rect，外部種子＝離 DWG 牆 >6m
import pickle, sys, json, numpy as np, collections
from collections import deque
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from common import *
cal=json.load(open(SP+'calib.json',encoding='utf-8'))
segs=None
WALL={'Wall-DW','WALL-DW15','Wall-DW單','Wall-RC','Wall-RC20以上','Wall-HB','Wall-CW','S-CONC','WALL-石材','DW-CW帷幕平','DW','門扇','E-DOOR'}
def room_rows():
    wb=openpyxl.load_workbook(ROOT+'分層數量表_地坪及貼面磚.xlsx',read_only=True,data_only=True)
    return [r for r in list(wb['房間明細'].iter_rows(values_only=True))[1:] if r[0]]
AREA={}; _AREA_DONE=[False]
TAGS=load_tags()
from roominfo import web_rooms, sheet_rooms
_W=web_rooms(); _S=sheet_rooms()
def RNAME(fl,n):
    f='屋突層' if fl.startswith('屋突') else fl
    return _W.get(f,{}).get(n) or (_S.get((f,n)) or ('',))[0] or ''
def build(fl, segs, d, rooms):
    if not _AREA_DONE[0]:
      _AREA_DONE[0]=True
      for r in rooms:
        if isinstance(r[5],(int,float)): AREA[(r[0],str(r[2]))]=AREA.get((r[0],str(r[2])),0)+r[5]
    A=np.array(cal[fl]['A'])        # scan px -> DWG
    Ai=np.linalg.inv(np.vstack([A,[0,0,1]]))[:2]
    sc=Image.open(SP+f'scan_{fl}.png')
    W0,H0=sc.size
    dpi300 = W0>4000
    F=3 if dpi300 else 2            # 工作格 ≈ 7.8 cm
    cmpx=np.hypot(*A[:,0])*F
    a=np.array(sc)<170
    lab_,n=ndi.label(a)
    sl=ndi.find_objects(lab_)
    small=np.zeros(n+1,bool)
    lim=68 if dpi300 else 45
    for i,s in enumerate(sl,1):
        if max(s[0].stop-s[0].start,s[1].stop-s[1].start)<lim: small[i]=True
    a[small[lab_]]=False
    H,W=H0//F,W0//F
    wall=a[:H*F,:W*F].reshape(H,F,W,F).any(axis=(1,3))
    toW=lambda P: (Ai@np.array([P[0],P[1],1]))/F      # DWG -> work grid (x,y)
    # 外部：DWG 牆線點陣化後距離 > 6m
    im=Image.new('L',(W,H),0); dr=ImageDraw.Draw(im)
    for L,b,pts in segs:
        if pts and L in WALL and band(pts[0][1])==fl:
            dr.line([tuple(toW(p)) for p in pts],fill=255,width=1)
    dw=np.array(im)>0
    # 建物範圍：房號＋門窗標籤（含地下室外牆 DA）之凸包，外擴 2.5 m
    import cv2
    pts=[toW(p) for n,p in d['room'] if band(p[1])==fl]
    pts+=[(t['x']/F,t['y']/F) for t in TAGS if t['fl']==fl]
    hull=cv2.convexHull(np.array(pts,np.float32)).astype(np.int32)
    hm=np.zeros((H,W),np.uint8); cv2.fillPoly(hm,[hull.reshape(-1,2)],1)
    inhull=ndi.binary_dilation(hm>0,iterations=int(250/cmpx))
    far=(ndi.distance_transform_edt(~dw)*cmpx>300) & ~inhull
    names=['']; idx={}
    def nid(n):
        if n not in idx: idx[n]=len(names); names.append(n)
        return idx[n]
    lab=np.zeros((H,W),np.int32); q=deque()
    def seed(y,x,i):
        if 0<=y<H and 0<=x<W and not wall[y,x] and lab[y,x]==0:
            lab[y,x]=i; q.append((y,x))
    rectrooms={}
    for r in rooms:
        if r[0]!=(fl if not fl.startswith('屋突') else '屋突層'): continue
        m=re.search(r'rect x(\d+)-(\d+) y(\d+)-(\d+)',str(r[7] or ''))
        if not m or not re.match(r'^[A-Z]?\d{2,4}[a-z]?$',str(r[2])): continue
        x1,x2,y1,y2=[int(v)*(1 if dpi300 else 2/3)/F for v in m.groups()]
        rectrooms[str(r[2])]=(x1,x2,y1,y2)
        i=nid(str(r[2]))
        # rect 內縮 30%（避開 minus 的部分）
        cx,cy,hw,hh=(x1+x2)/2,(y1+y2)/2,(x2-x1)*0.2,(y2-y1)*0.2
        for y in range(int(cy-hh),int(cy+hh)+1):
            for x in range(int(cx-hw),int(cx+hw)+1): seed(y,x,i)
    # 樓梯：DWG ST 圖層（踏步線）群組外框內全部當種子（房號常標在梯間外並以引線指入）
    stbox={}
    st=[pts for L,b,pts in segs if pts and L in ('ST','ST-HR','S-STAIR') and band(pts[0][1])==fl]
    sb=[(min(p[0] for p in q),min(p[1] for p in q),max(p[0] for p in q),max(p[1] for p in q)) for q in st]
    for n,p in d['room']:
        if band(p[1])!=fl or n in rectrooms: continue
        nm=RNAME(fl,n)
        if not re.search(r'[A-D]梯|樓梯|安全梯',nm) or '梯廳' in nm: continue
        near=[b for b in sb if abs((b[0]+b[2])/2-p[0])<900 and abs((b[1]+b[3])/2-p[1])<900]
        if not near: continue
        # 由最近的踏步線開始，外框相交（容差 30cm）者併成一群
        near.sort(key=lambda b:np.hypot((b[0]+b[2])/2-p[0],(b[1]+b[3])/2-p[1]))
        g=list(near[0]); ch=True
        while ch:
            ch=False
            for b in near:
                if b[0]<=g[2]+30 and b[2]>=g[0]-30 and b[1]<=g[3]+30 and b[3]>=g[1]-30 and not (g[0]<=b[0] and g[1]<=b[1] and g[2]>=b[2] and g[3]>=b[3]):
                    g=[min(g[0],b[0]),min(g[1],b[1]),max(g[2],b[2]),max(g[3],b[3])]; ch=True
        if (g[2]-g[0])*(g[3]-g[1])<4e4 or (g[2]-g[0])*(g[3]-g[1])>6e6: continue
        i=nid(n); stbox[n]=g
        c1=toW((g[0],g[1])); c2=toW((g[2],g[3]))
        xa,xb=sorted([c1[0],c2[0]]); ya,yb=sorted([c1[1],c2[1]])
        sx,sy=(xb-xa)*0.1,(yb-ya)*0.1
        for y in range(int(ya+sy),int(yb-sy)+1):
            for x in range(int(xa+sx),int(xb-sx)+1): seed(y,x,i)
    seeds={}
    for n,p in d['room']:
        if band(p[1])!=fl or n in stbox: continue
        x,y=toW(p); x,y=int(round(x)),int(round(y))
        if n in rectrooms:
            x1,x2,y1,y2=rectrooms[n]
            if not (x1-3<=x<=x2+3 and y1-3<=y<=y2+3):
                continue   # DWG 房號不在 rect 內，以 rect 為準
        i=nid(n)
        done=False
        for rr in range(0,12):
            for dy in range(-rr,rr+1):
                for dx in range(-rr,rr+1):
                    if 0<=y+dy<H and 0<=x+dx<W and not wall[y+dy,x+dx]:
                        if lab[y+dy,x+dx]==0: seed(y+dy,x+dx,i)
                        seeds.setdefault(n,[]).append((x+dx,y+dy)); done=True; break
                if done: break
            if done: break
    oi=nid('OUT')
    ys,xs=np.nonzero(far & ~wall & (lab==0))
    for y,x in zip(ys,xs): lab[y,x]=oi; q.append((y,x))
    # 依離牆距離由大到小淹水（標記式分水嶺）：房間先填滿，門洞等窄處最後才互通
    import heapq
    dist=ndi.distance_transform_edt(~wall)
    hq=[(-dist[y,x],y,x) for y,x in q]; heapq.heapify(hq)
    # 面積上限：房間明細有面積者 max(1.5 倍, +8 m²)，其餘 150 m²；超過就不再擴張
    px=(cmpx/100)**2
    cap=np.full(len(names),1e12)
    for n,i in idx.items():
        if n=='OUT': continue
        a=AREA.get((fl if not fl.startswith('屋突') else '屋突層',n))
        cap[i]=(max(1.5*a,a+8) if a else 150)/px
    used=np.bincount(lab.ravel(),minlength=len(names)).astype(float)
    while hq:
        _,y,x=heapq.heappop(hq); l=lab[y,x]
        if used[l]>cap[l]: continue
        for ny,nx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
            if 0<=ny<H and 0<=nx<W and lab[ny,nx]==0 and not wall[ny,nx] and not (l==oi and inhull[ny,nx]):
                lab[ny,nx]=l; used[l]+=1; heapq.heappush(hq,(-dist[ny,nx],ny,nx))
    # 第二階段：被細線圍住的車位格、樓梯踏步間等，只以 DWG 也有的牆（外擴 2 格）為阻隔，從已標記處續淹
    wall2=wall & ndi.binary_dilation(dw,iterations=2)
    fr=(lab>0)&ndi.binary_dilation((lab==0)&~wall2&inhull)
    ys,xs=np.nonzero(fr)
    hq=[(0,y,x) for y,x in zip(ys,xs)]; heapq.heapify(hq)
    dist2=ndi.distance_transform_edt(~wall2)
    while hq:
        _,y,x=heapq.heappop(hq); l=lab[y,x]
        if used[l]>cap[l] or l==oi: continue
        for ny,nx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
            if 0<=ny<H and 0<=nx<W and lab[ny,nx]==0 and not wall2[ny,nx] and inhull[ny,nx]:
                lab[ny,nx]=l; used[l]+=1; heapq.heappush(hq,(-dist2[ny,nx],ny,nx))
    lab[wall & (lab>0) & ~(ndi.binary_dilation(lab>0)&False)]=lab[wall & (lab>0)]
    lab[wall]=np.where(wall2[wall],0,lab[wall])
    return dict(stbox=stbox,fl=fl,inhull=inhull,F=F,A=A.tolist(),cmpx=cmpx,W=W,H=H,wall=wall,lab=lab,names=names,seeds=seeds,rect=rectrooms)
if __name__=='__main__':
    segs=pickle.load(open(SP+'segs.pkl','rb')); d=load_dwg(); rooms=room_rows()
    for fl in (sys.argv[1:] or FLS):
        m=build(fl,segs,d,rooms)
        pickle.dump(m,open(SP+f'sm_{fl}.pkl','wb'))
        cnt=collections.Counter(m['lab'].ravel())
        print(fl,m['W'],m['H'],round(m['cmpx'],2),len(m['names']), flush=True)
