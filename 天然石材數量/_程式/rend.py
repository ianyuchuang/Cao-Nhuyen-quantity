import ezdxf, numpy as np, cv2, pickle, os
from ezdxf import path as zpath
from ezdxf.disassemble import recursive_decompose
def collect(fn, cache):
    if os.path.exists(cache): return pickle.load(open(cache,'rb'))
    doc=ezdxf.readfile(fn); msp=doc.modelspace()
    segs=[]; hatches=[]
    for e in recursive_decompose(msp):
        t=e.dxftype()
        try:
            if t=='HATCH':
                ps=[[(v.x,v.y) for v in p.flattening(2)] for p in zpath.from_hatch(e)]
                hatches.append((e.dxf.layer,e.dxf.pattern_name,ps)); continue
            if t in ('LINE','LWPOLYLINE','POLYLINE','ARC','CIRCLE','ELLIPSE','SPLINE'):
                p=zpath.make_path(e)
                pts=[(v.x,v.y) for v in p.flattening(2)]
                if len(pts)>1: segs.append((e.dxf.layer,pts))
        except Exception: pass
    pickle.dump((segs,hatches),open(cache,'wb'))
    return segs,hatches
def render(segs,hatches,x0,y0,x1,y1,cmpp,fill=None,lw=1):
    W=int((x1-x0)/cmpp); H=int((y1-y0)/cmpp)
    img=np.full((H,W,3),255,np.uint8)
    def tr(pts):
        p=np.array(pts); return np.stack([(p[:,0]-x0)/cmpp,(y1-p[:,1])/cmpp],1)
    if fill:
        for lay,pat,ps in hatches:
            col=fill(lay,pat)
            if col is None: continue
            m=np.zeros((H,W),np.uint8)
            cv2.fillPoly(m,[np.round(tr(p)).astype(np.int32) for p in ps if len(p)>2],1)
            img[m>0]=col
    for lay,pts in segs:
        p=tr(pts)
        if (p[:,0].max()<0) or p[:,0].min()>W or p[:,1].max()<0 or p[:,1].min()>H: continue
        cv2.polylines(img,[np.round(p).astype(np.int32)],False,(0,0,0),lw,cv2.LINE_AA)
    return img
