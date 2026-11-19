# 每層：影像標籤座標 → DWG 座標，以同代號標籤 RANSAC 求相似轉換，再以內點做最小平方仿射
import numpy as np, itertools, json, random
from common import *
d=load_dwg(); tags=load_tags()
def sim_from2(a1,a2,b1,b2):
    za=complex(*a2)-complex(*a1); zb=complex(*b2)-complex(*b1)
    if abs(za)<1e-6: return None
    s=zb/za; t=complex(*b1)-s*complex(*a1)
    return s,t
def apply_sim(m,p):
    z=m[0]*complex(*p)+m[1]; return (z.real,z.imag)
res={}
for fl in FLS:
    im=[t for t in tags if t['fl']==fl and t['code']!='DA']
    dw=[(c,p) for k,c,p,a in d['tag'] if band(p[1])==fl]
    pairs=[(i,j) for i,t in enumerate(im) for j,(c,p) in enumerate(dw) if c==t['code']]
    best=None
    random.seed(0)
    for _ in range(4000):
        (i1,j1),(i2,j2)=random.sample(pairs,2)
        if i1==i2 or j1==j2: continue
        m=sim_from2((im[i1]['x'],-im[i1]['y']),(im[i2]['x'],-im[i2]['y']),dw[j1][1],dw[j2][1])
        if not m: continue
        sc=abs(m[0])
        if not (0.5<sc<12): continue
        # 影像 y 向下、DWG y 向上 → 需要鏡射；先把影像 y 取負
        n=0
        for t in im:
            q=apply_sim(m,(t['x'],-t['y']))
            dd=min((np.hypot(q[0]-p[0],q[1]-p[1]) for c,p in dw if c==t['code']),default=1e9)
            if dd<60: n+=1
        if not best or n>best[0]: best=(n,m)
    print(fl,len(im),len(dw),best[0] if best else None, best and (abs(best[1][0]), np.degrees(np.angle(best[1][0]))))

    # 內點 → 一對一配對（每個 DWG 標籤只配一次），最小平方仿射
    m=best[1]
    cand=[]
    for i,t in enumerate(im):
        q=apply_sim(m,(t['x'],-t['y']))
        for j,(c,p) in enumerate(dw):
            if c==t['code']:
                dd=np.hypot(q[0]-p[0],q[1]-p[1])
                if dd<80: cand.append((dd,i,j))
    cand.sort(); ui=set(); uj=set(); M=[]
    for dd,i,j in cand:
        if i in ui or j in uj: continue
        ui.add(i); uj.add(j); M.append((i,j))
    for it in range(3):
        A=np.array([[im[i]['x'],im[i]['y'],1] for i,j in M]); B=np.array([dw[j][1] for i,j in M])
        X,*_=np.linalg.lstsq(A,B,rcond=None)
        r=np.hypot(*(A@X-B).T)
        keep=r<max(3*np.median(r),15)
        M=[m_ for m_,k in zip(M,keep) if k]
    A=np.array([[im[i]['x'],im[i]['y'],1] for i,j in M]); B=np.array([dw[j][1] for i,j in M])
    X,*_=np.linalg.lstsq(A,B,rcond=None); r=np.hypot(*(A@X-B).T)
    sx=np.hypot(*X[0]); sy=np.hypot(*X[1])
    res[fl]=dict(A=X.T.tolist(), n=len(M), n_img=len(im), rms=float(np.sqrt((r**2).mean())), max=float(r.max()), sx=float(sx), sy=float(sy),
                 matched={im[i]['seq']:list(dw[j][1]) for i,j in M})
    print('  affine n=%d rms=%.1fcm max=%.1fcm scale x %.3f y %.3f'%(len(M),res[fl]['rms'],res[fl]['max'],sx,sy))
json.dump(res,open('calib.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
