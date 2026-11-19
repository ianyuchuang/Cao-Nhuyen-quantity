# 從 DXF 取出：房號、門窗標籤、文字、牆線等，存 pickle
from ezdxf import recover
import pickle
doc, aud = recover.readfile('plan.dxf')
msp = doc.modelspace()
def atts(e):
    try: return {a.dxf.tag: a.dxf.text for a in e.attribs}
    except Exception: return {}
out={'room':[], 'tag':[], 'text':[], 'grid':[]}
for e in msp:
    t=e.dxftype()
    if t=='INSERT':
        a=atts(e); p=tuple(e.dxf.insert)[:2]
        n=e.dxf.name
        if n=='Room  number': out['room'].append((a.get('A001'),p))
        elif n=='MARK-D note': out['tag'].append(('D',a.get('D.NO'),p,a))
        elif n.startswith('MARK-W note'): out['tag'].append(('W',a.get('W10'),p,a))
        elif n=='MARK-SD note': out['tag'].append(('SD',a.get('NO'),p,a))
        elif n=='MARK-CW note': out['tag'].append(('CW',str(a),p,a))
        elif 'GRID' in n: out['grid'].append((n,p))
        elif a and len(out['tag'])<0: pass
    elif t in ('TEXT','MTEXT'):
        try: s=e.dxf.text if t=='TEXT' else e.plain_text()
        except Exception: continue
        out['text'].append((s,tuple(e.dxf.insert)[:2],e.dxf.layer,getattr(e.dxf,'height',0) or getattr(e.dxf,'char_height',0)))
# other inserts with attribs (maybe DW tags)
from collections import Counter
oth=Counter()
for e in msp:
    if e.dxftype()=='INSERT':
        a=atts(e)
        if a and e.dxf.name not in ('Room  number','MARK-D note','MARK-SD note','MARK-W note','MARK-W note_181128','Car Number NO','MARK-CW note'):
            oth[(e.dxf.name,tuple(a.keys()))]+=1
print(oth.most_common(30))
pickle.dump(out,open('dwg.pkl','wb'))
print({k:len(v) for k,v in out.items()})
