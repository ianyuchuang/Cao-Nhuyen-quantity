# 把模型空間所有線段（含圖塊展開）轉成 (layer, block, [(x,y),...]) 折線，存 pickle
from ezdxf import recover
import pickle, math, collections
doc, aud = recover.readfile('plan.dxf')
msp = doc.modelspace()
segs=[]  # (layer, topblock, pts)
def emit(e, lay, blk):
    t=e.dxftype()
    L = e.dxf.layer if e.dxf.layer!='0' else lay
    try:
        if t=='LINE':
            segs.append((L,blk,[tuple(e.dxf.start)[:2],tuple(e.dxf.end)[:2]]))
        elif t in ('LWPOLYLINE','POLYLINE'):
            pts=[tuple(p)[:2] for p in e.flattening(5)] if t=='LWPOLYLINE' else [tuple(v.dxf.location)[:2] for v in e.vertices]
            if t=='LWPOLYLINE' and e.closed and pts: pts.append(pts[0])
            segs.append((L,blk,pts))
        elif t in ('ARC','CIRCLE','ELLIPSE','SPLINE'):
            pts=[tuple(p)[:2] for p in e.flattening(3)]
            segs.append((L,blk,pts))
        elif t=='INSERT':
            if 'GRID' in e.dxf.name or e.dxf.name.startswith('SITE'): return
            for v in e.virtual_entities():
                emit(v, L, blk or e.dxf.name)
    except Exception as ex:
        pass
for e in msp:
    emit(e,'0',None)
print(len(segs))
c=collections.Counter(s[0] for s in segs)
for k,v in c.most_common(120): print(k,v)
pickle.dump(segs,open('segs.pkl','wb'))
