# 核對圖：掃描平面圖＋每樘「序號→房號」（依信心度上色），標題放在圖下方白帶
import pickle, sys, os, numpy as np
from PIL import Image, ImageDraw, ImageFont
from common import *
rows=pickle.load(open(SP+'assign.pkl','rb'))
OUTDIR=sys.argv[1]; os.makedirs(OUTDIR,exist_ok=True)
CONF={'高':(0,140,0),'中':(225,120,0),'低':(220,0,0)}
PEND=(190,0,190)
FN='C:/Windows/Fonts/msjh.ttc'
for fl in FLS:
    m=pickle.load(open(SP+f'sm_{fl}.pkl','rb')); F=m['F']
    sc=Image.open(SP+f'scan_{fl}.png').convert('L')
    k=1.5 if sc.width>4000 else 1.0
    base=np.array(sc).astype(float); base=255-(255-base)*0.6
    im=Image.fromarray(np.stack([base]*3,-1).astype(np.uint8)); dr=ImageDraw.Draw(im)
    f2=ImageFont.truetype(FN,int(19*k)); f3=ImageFont.truetype(FN,int(28*k))
    fr=[r for r in rows if r['fl']==fl]
    for r in fr:
        c=CONF.get(r['conf'],PEND) if r['room'] else PEND
        R=14*k
        dr.ellipse([r['x']-R,r['y']-R,r['x']+R,r['y']+R],outline=c,width=max(2,int(3*k)))
        s=r['seq'].split('-',1)[1]+'→'+(r['room'] or '待確認')
        dr.text((r['x']+R+2,r['y']-R-4),s,font=f2,fill=c,stroke_width=3,stroke_fill=(255,255,255))
    ys,xs=np.nonzero(m['inhull']); pad=60
    x0,x1=max(0,xs.min()*F-pad*F),min(im.width,xs.max()*F+pad*F); y0,y1=max(0,ys.min()*F-pad*F),min(im.height,ys.max()*F+pad*F)
    im=im.crop((x0,y0,x1,y1))
    H=int(70*k); out=Image.new('RGB',(im.width,im.height+H),'white'); out.paste(im,(0,0)); dr=ImageDraw.Draw(out)
    cnt=collections.Counter((r['conf'] if r['room'] else '待確認') for r in fr)
    title=f'{fl} 門窗房號核對　共 {len(fr)} 樘：高 {cnt["高"]}、中 {cnt["中"]}、低 {cnt["低"]}、待確認 {cnt["待確認"]}　（標示＝序號→房號；綠＝高、橙＝中、紅＝低、紫＝待確認）'
    dr.text((20,im.height+12*k),title,font=f3,fill=(0,0,0))
    pf='屋突層_'+('RF1' if fl=='屋突壹層' else 'RF2') if fl.startswith('屋突') else fl
    out=out.quantize(colors=96,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
    out.save(os.path.join(OUTDIR,f'{pf}_門窗房號核對.png'),optimize=True)
    print(fl,out.size)
