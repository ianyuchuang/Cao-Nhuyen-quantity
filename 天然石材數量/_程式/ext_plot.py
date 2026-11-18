import sys,pickle,json,os; sys.stdout.reconfigure(encoding='utf-8'); sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
from rend import render
OUTD=sys.argv[1] if len(sys.argv)>1 else '.'
CACHE=os.path.join(os.environ.get('TEMP','.'),'stone_cache'); os.chdir(os.path.dirname(os.path.abspath(__file__)))
segs,hatches=pickle.load(open(os.path.join(CACHE,'elev.pkl'),'rb'))
masks=pickle.load(open(os.path.join(CACHE,'ext_masks.pkl'),'rb')); res=json.load(open('ext_dwg_res.json',encoding='utf-8'))
FACES={'S':(36500,45900,'南向'),'W':(49300,53900,'西向'),'E':(55500,60000,'東向'),'N':(64200,73000,'北向')}
Y0,Y1,CM=56800,58800,2.0
FLS=[('1F',56960),('2F',57560),('3F',58060),('4F',58480)]
F=lambda s,b=False: ImageFont.truetype(r'C:\Windows\Fonts\msjhbd.ttc' if b else r'C:\Windows\Fonts\msjh.ttc',s)
C_ST=(255,150,40); C_BS=(70,140,230)
def face_img(f):
    x0,x1,nm=FACES[f]
    img=render(segs,hatches,x0,Y0,x1,Y1,CM,None)
    m,b=masks[f]
    for mk,col in ((m,C_ST),(b,C_BS)):
        sel=mk>0; img[sel]=(img[sel]*0.5+np.array(col)*0.5).astype(np.uint8)
        cs,_=cv2.findContours(mk.astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(img,cs,-1,tuple(int(c*0.6) for c in col),3)
    return img
def page(fs,title,fn):
    A3=Image.new('RGB',(4961,3508),'white'); d=ImageDraw.Draw(A3)
    d.text((90,60),title,fill='black',font=F(54,True))
    y=260
    for f in fs:
        im=face_img(f); h,w=im.shape[:2]
        LM=760; sc=min(1.35,(4961-LM-120)/w)
        im=cv2.resize(im,None,fx=sc,fy=sc,interpolation=cv2.INTER_AREA); h,w=im.shape[:2]
        X=LM; A3.paste(Image.fromarray(im),(X,y)); d.rectangle([X,y,X+w,y+h],outline='black',width=3)
        nm=FACES[f][2]; r=res[f]
        d.text((90,y-75),f'{nm}立面（1F～3F）',fill='black',font=F(44,True))
        # 樓層線與卡片
        for k,Yv in FLS:
            yy=y+int((Y1-Yv)/CM*sc)
            d.line([(X-40,yy),(X+w,yy)],fill=(0,0,200),width=2)
            d.text((X-150,yy-22),f'{k[:-1]}FL',fill=(0,0,200),font=F(30))
        tops=[57560,58060,58480,Y1]
        FLc=FLS[:3]
        for (k,Yv),Yt in zip(FLc,tops):
            q=r['stone'][k]
            if q<=0: continue
            yc=y+int((Y1-(Yv+Yt)/2)/CM*sc)
            t=f'{k} 外牆石材 {q:.2f}m²'
            bb=d.textbbox((0,0),t,font=F(32)); tw=bb[2]-bb[0]
            d.rectangle([90,yc-28,90+tw+24,yc+28],fill='white',outline=(200,90,0),width=3)
            d.text((102,yc-22),t,fill='black',font=F(32))
            d.line([(90+tw+24,yc),(X-170,yc)],fill=(200,90,0),width=2)
        yb=y+int((Y1-56930)/CM*sc)+40
        t=f'1F 基座 {r["base"]:.2f}m²'
        d.rectangle([90,yb-28,420,yb+28],fill='white',outline=(40,90,180),width=3); d.text((102,yb-22),t,fill='black',font=F(32))
        y+=h+200
    d.rectangle([90,y,140,y+40],fill=C_ST,outline=(200,90,0),width=3); d.text((160,y-2),'外牆空縫石材帷幕牆（六.4.17）',fill='black',font=F(32))
    d.rectangle([1200,y,1250,y+40],fill=C_BS,outline=(40,90,180),width=3); d.text((1270,y-2),'外牆基座石材（六.4.5）：地面線至 1FL',fill='black',font=F(32))
    notes=['說明：依「A3-01_各向立面250304.dwg」石材填線（W-石材、hatch-石材）計算；南向西端深灰石材圖面只有分割線，依分割線範圍計入。',
           '樓層以 1FL、2FL、3FL 標高線切分；4FL 以上僅 3F 女兒牆頂約 10 cm，併入 3F。立面圖 4F～11F 沒有石材填線，僅裁切 1F～3F 標註。數量計算式詳「天然石材_立面_數量計算表.xlsx」。']
    for i,t in enumerate(notes): d.text((90,y+70+i*44),t,fill=(60,60,60),font=F(26))
    A3.save(os.path.join(OUTD,fn),dpi=(300,300)); return os.path.join(OUTD,fn)
os.makedirs(OUTD,exist_ok=True)
print(page(['N','S'],'外牆立面石材標註（北向、南向）','立面_北向南向_實際數量.png'))
print(page(['E','W'],'外牆立面石材標註（東向、西向）','立面_東向西向_實際數量.png'))
