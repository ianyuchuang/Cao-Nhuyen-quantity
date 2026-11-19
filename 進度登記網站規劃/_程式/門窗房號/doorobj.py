# DWG 門窗物件：DW／門扇／E-DOOR 圖層的圖塊（取外框）與散線（端點相連成群取外框）
from ezdxf import recover
import pickle, numpy as np, collections
doc, aud = recover.readfile('plan.dxf')
msp = doc.modelspace()
DL={'DW','門扇','E-DOOR','DW-CW帷幕平'}
objs=[]
def pts_of(e):
    out=[]
    for v in e.virtual_entities():
        t=v.dxftype()
        try:
            if t=='LINE': out+= [tuple(v.dxf.start)[:2],tuple(v.dxf.end)[:2]]
            elif t in ('LWPOLYLINE','ARC','CIRCLE','POLYLINE','SPLINE','ELLIPSE'): out+=[tuple(p)[:2] for p in v.flattening(5)]
            elif t=='INSERT': out+=pts_of(v)
        except Exception: pass
    return out
loose=[]
for e in msp:
    if e.dxf.layer not in DL: continue
    t=e.dxftype()
    if t=='INSERT':
        try: p=pts_of(e)
        except Exception: continue
        if p: objs.append(('blk',e.dxf.name,np.array(p)))
    elif t=='LINE': loose.append([tuple(e.dxf.start)[:2],tuple(e.dxf.end)[:2]])
    elif t in ('LWPOLYLINE','ARC','CIRCLE','POLYLINE'):
        try: loose.append([tuple(p)[:2] for p in e.flattening(5)])
        except Exception: pass
# 散線分群：外框距離 < 3cm 視為同群
bb=[(min(p[0] for p in s),min(p[1] for p in s),max(p[0] for p in s),max(p[1] for p in s)) for s in loose]
par=list(range(len(bb)))
def f(i):
    while par[i]!=i: par[i]=par[par[i]]; i=par[i]
    return i
order=sorted(range(len(bb)),key=lambda i:bb[i][0])
for k,i in enumerate(order):
    for j in order[k+1:]:
        if bb[j][0]>bb[i][2]+3: break
        if bb[j][1]<=bb[i][3]+3 and bb[i][1]<=bb[j][3]+3: par[f(i)]=f(j)
grp=collections.defaultdict(list)
for i,s in enumerate(loose): grp[f(i)]+=s
for g in grp.values(): objs.append(('line','',np.array(g)))
out=[(k,n,(p[:,0].min(),p[:,1].min(),p[:,0].max(),p[:,1].max())) for k,n,p in objs]
out=[o for o in out if (o[2][2]-o[2][0])<1200 and (o[2][3]-o[2][1])<1200]
print(len(out), collections.Counter(o[1] for o in out).most_common(15))
pickle.dump(out,open('doorobj.pkl','wb'))
