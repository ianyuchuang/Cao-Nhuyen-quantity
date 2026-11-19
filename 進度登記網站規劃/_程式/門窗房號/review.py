# 放大檢視：原掃描圖＋標籤序號→目前房號（紅字）＋DWG 房號種子位置（藍字）
import pickle, sys, json, numpy as np
from PIL import Image, ImageDraw, ImageFont
from common import *
fl=sys.argv[1]; x0,y0,x1,y1=map(int,sys.argv[2:6]); z=float(sys.argv[6]) if len(sys.argv)>6 else 3
rows=[r for r in pickle.load(open(SP+'assign.pkl','rb')) if r['fl']==fl]
im=Image.open(SP+f'scan_{fl}.png').convert('RGB').crop((x0,y0,x1,y1))
im=im.resize((int(im.width*z),int(im.height*z)),Image.LANCZOS); dr=ImageDraw.Draw(im)
f=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',20)
for r in rows:
    x,y=(r['x']-x0)*z,(r['y']-y0)*z
    if 0<=x<im.width and 0<=y<im.height:
        dr.text((x+14*z/3,y+12*z/3),r['seq'].split('-',1)[1]+'→'+str(r['room']),font=f,fill=(220,0,0),stroke_width=2,stroke_fill=(255,255,255))
im.save(SP+'z.png'); print(im.size)
