import sys,pickle,json; sys.stdout.reconfigure(encoding='utf-8')
import os, subprocess
_HERE=os.path.dirname(os.path.abspath(__file__)); os.chdir(_HERE)
CACHE=os.path.join(os.environ.get('TEMP','.'),'stone_cache'); os.makedirs(CACHE,exist_ok=True)
if not os.path.exists(os.path.join(CACHE,'elev.pkl')):
    import shutil, sys as _s; _s.path.insert(0,_HERE)
    dwg=os.path.join(CACHE,'elev.dwg'); dxf=os.path.join(CACHE,'elev.dxf')
    shutil.copy(r'D:\分層數量\A3-01_各向立面250304.dwg',dwg)
    subprocess.run([r'D:\分層數量\工具\LibreDWG-0.14-win64\dwg2dxf.exe','-y','-o',dxf,dwg],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    from rend import collect; collect(dxf,os.path.join(CACHE,'elev.pkl'))

import numpy as np, cv2
segs,hatches=pickle.load(open(os.path.join(CACHE,'elev.pkl'),'rb'))
CM=2.0
FACES={'S':(36500,45900,'南向'),'W':(49300,53900,'西向'),'E':(55500,60000,'東向'),'N':(64200,73000,'北向')}
Y0,Y1=56800,58800
FL=[('1F',56960,57560),('2F',57560,58060),('3F',58060,Y1)]   # 4FL 以上僅 3F 女兒牆頂約 10 cm，併入 3F
FL1=56960
def mask_for(face, polys):
    x0,x1,_=FACES[face]; W=int((x1-x0)/CM); H=int((Y1-Y0)/CM)
    m=np.zeros((H,W),np.uint8)
    for ps in polys:
        lp=[np.round(np.stack([(np.array(p)[:,0]-x0)/CM,(Y1-np.array(p)[:,1])/CM],1)).astype(np.int32) for p in ps if len(p)>2]
        t=np.zeros_like(m)
        for l in lp:
            u=np.zeros_like(m); cv2.fillPoly(u,[l],1); t^=u   # even-odd
        m|=t
    return m
def rowy(Y): return int(round((Y1-Y)/CM))
stone={f:[] for f in FACES}; base={f:[] for f in FACES}
for lay,pat,ps in hatches:
    if '石材' not in lay: continue
    allp=np.vstack([np.array(p) for p in ps if len(p)>2])
    xm=allp[:,0].mean()
    face=[k for k,(a,b,_) in FACES.items() if a<=xm<b]
    if not face: continue
    face=face[0]
    if allp[:,1].max()<=56985 and allp[:,1].max()-allp[:,1].min()<60: base[face].append(ps)
    else: stone[face].append(ps)
R=lambda a,b,c,d:[[(a,b),(c,b),(c,d),(a,d)]]
stone['S']+= [R(36996,58193,37833,58487),R(36996,58047,37390,58193),R(36996,56885,37400,57900),R(37400,57560,37833,57900)]
# 基座：地面線（南 C1 56885；北 56935；東、西依地面折線）至 1FL，僅取建築外緣範圍
GRADE={'S':[(37176,56885),(44861,56885)],'N':[(64375,56935),(72748,56935)],
       'W':[(49944,56941),(50145,56945),(51505,56945),(52235,56935)],
       'E':[(55791,56925),(57985,56955),(59381,56955),(59696,56951)]}
res={}; masks={}
for f in FACES:
    m=mask_for(f,stone[f]); b=mask_for(f,base[f])
    g=GRADE[f]; gx=np.array([p[0] for p in g]); gy=np.array([p[1] for p in g])
    x0=FACES[f][0]; W=m.shape[1]
    for i in range(W):
        X=x0+(i+0.5)*CM
        if gx.min()<=X<=gx.max():
            yg=np.interp(X,gx,gy)
            if yg<FL1: b[rowy(FL1):rowy(yg),i]=1
    m[rowy(FL1):,:]=0          # 1FL 以下歸基座
    b&= (1-m)
    masks[f]=(m,b)
    px=CM*CM/1e4
    d={k:round(float(m[rowy(t):rowy(bm),:].sum()*px),2) for k,bm,t in FL}
    res[f]={'stone':d,'base':round(float(b.sum()*px),2)}
    print(f,res[f], 'tot',round(sum(d.values()),2))
pickle.dump(masks,open(os.path.join(CACHE,'ext_masks.pkl'),'wb'))
json.dump(res,open('ext_dwg_res.json','w'),ensure_ascii=False)
