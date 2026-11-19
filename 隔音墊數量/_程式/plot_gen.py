# 各樓層 A3 標註圖（天花板／防水／欄杆），出圖方式同油漆 plot_paint.py
# usage: python -I plot_gen.py ceil|wp|rail GK [GK ...]
import sys, json, re, math, os, numpy as np, cv2, pymupdf
SP=os.path.dirname(os.path.abspath(__file__))
P=r"C:/Users/jho/AppData/Local/Temp/claude/75659cd6b46177ff/fa14caa7-cd98-4284-a6f3-82c8d8cf1bda/scratchpad"
sys.path.insert(0,P); import labelplace
from PIL import Image, ImageDraw, ImageFont
sys.stdout.reconfigure(encoding="utf-8")
S=r"C:/Users/jho/AppData/Local/Temp/claude/9011f1ddebec305a/f5807709-b961-4184-8bc6-f4ea7b698c13/scratchpad"
D=r"D:/分層數量"
MODE=sys.argv[1]
CFG=json.load(open(SP+"/cfg.json",encoding="utf-8"))[MODE]; OD=CFG["outdir"]
J=json.load(open(SP+"/"+CFG["json"],encoding="utf-8")); IT={x["code"]:x for x in J["items"]}
FOLDER={"B3":"B3F","B2":"B2F","B1":"B1F","RF1":"屋突層","RF2":"屋突層"}
PREF={"B3":"B3","B2":"B2","B1":"B1"}
SRC={"B3":(D+"/A2-04(用印版).pdf",0,"A2-04","地下參層"),"B2":(D+"/建築圖(已簽章).pdf",64,"A2-05","地下貳層"),
     "B1":(D+"/A2-06(260929)印.pdf",0,"A2-06","地下壹層"),"1F":(D+"/A2-07(261105)用印版.pdf",0,"A2-07","壹層"),
     "RF1":(D+"/建築圖(已簽章).pdf",77,"A2-18","屋突壹層"),"RF2":(D+"/建築圖(已簽章).pdf",78,"A2-19","屋突貳層及屋頂頂層")}
CN=["貳","參","肆","伍","陸","柒","捌","玖","拾","拾壹"]
for i in range(2,12): SRC[f"{i}F"]=(D+"/A2-08~A2-17(260916)印.pdf",i-2,f"A2-{i+6:02d}",CN[i-2]+"層")
FKEY={"B3":"B3F","B2":"B2F","B1":"B1F","RF1":"屋突層","RF2":"屋突層"}
COL=CFG["colors"]; COL={k:tuple(v) for k,v in COL.items()}
FILL=set(CFG.get("fill_codes",COL.keys())); LINE=CFG.get("line_codes",{})   # line_codes: code -> how ("outline")
SHORT=CFG.get("short",{})
def fnt(sz,b=False): return ImageFont.truetype(r"C:/Windows/Fonts/msjhbd.ttc" if b else r"C:/Windows/Fonts/msjh.ttc",sz)
PG={}
def load_masks(gk):
    d=np.load(f"{P}/geom/{gk}_masks.npz"); H,W=d["shape"]; Jg=json.load(open(f"{P}/geom/{gk}.json",encoding="utf-8"))
    M={}; PG[gk]={}
    for i,r in enumerate(Jg["rooms"]):
        M.setdefault(str(r["room"]),[]).append(np.unpackbits(d["arr_%d"%i])[:H*W].reshape(H,W))
        PG[gk].setdefault(str(r["room"]),[]).extend(r.get("polys",[]))
    return M,(H,W)
def match(key,room):
    ids=[x.strip() for x in re.split(r"[+＋]",key)]
    return room==key or room in ids or key.startswith(room+"(") or ("+" in room and key==room)
def row_mask(r,M,shape):
    m=np.zeros(shape,np.uint8)
    for key,ms in M.items():
        if match(key,r["room"]):
            for mm in ms: m|=mm
    return m
def row_polys(r,gk):
    return [np.array(p,float) for key,pl in PG[gk].items() if match(key,r["room"]) for p in pl]
def unit(c): return "m" if IT[c]["unit"].upper()=="M" else "m²"
def floor_rows(gk): return [r for r in J["rows"] if r["gk"]==gk]

def draw_layer(img,gk,M,shape,xf,big):
    s,cx0,cy0=xf; Hh,Ww=img.shape[:2]
    lm=np.zeros((Hh,Ww),np.uint8)
    def PL(pts,closed,color,width):
        cv2.polylines(img,pts,closed,color,width,lineType=cv2.LINE_AA); cv2.polylines(lm,pts,closed,255,width+4)
    T=lambda p:(int(round((p[0]-cx0)*s)),int(round((p[1]-cy0)*s)))
    lw=max(3,int(round(5*s))) if big else 5
    labels=[]
    if MODE=="rail":     # 樓梯欄杆：梯間位置以醒目色框標示，卡片列出本層分配量
        SC={k:tuple(v) for k,v in CFG["stair_colors"].items()}
        for r in [x for x in J.get("stair_rows",[]) if x["gk"]==gk]:
            col=SC[r["stair"]][::-1]; sh=r["shape"]
            if "room" in sh:
                pls=row_polys({"room":sh["room"]},gk)
                for pg in pls: PL([np.array([T(p) for p in pg],np.int32)],True,col,lw+2)
                allp=np.vstack(pls); cx,cy=allp.mean(0)
            elif "circle" in sh:
                cx,cy,rad=sh["circle"]; c0=T((cx,cy)); rr=int(round(rad*s))
                cv2.circle(img,c0,rr,col,lw+2,lineType=cv2.LINE_AA); cv2.circle(lm,c0,rr,255,lw+6)
            else:
                pl=sh["line"]; PL([np.array([T(p) for p in pl],np.int32)],False,col,lw+4)
                cx,cy=np.mean(pl,0)
            txt=chr(10).join(([r["stair"]] if r["stair"]!="g" else [])+[f"{SHORT.get(c,c)} {v:,.2f}m" for c,v in r["items"].items()])
            labels.append(((cx-cx0)*s,(cy-cy0)*s,txt,100.0))
    for r in floor_rows(gk):
        if MODE=="rail":
            for pl in r.get("pts_list",[r["pts"]]):
                PL([np.array([T(p) for p in pl],np.int32)],False,COL[r["code"]][::-1],lw+2)
            m=r["pts"][len(r["pts"])//2] if len(r["pts"])>2 else [(r["pts"][0][0]+r["pts"][-1][0])/2,(r["pts"][0][1]+r["pts"][-1][1])/2]
            lx,ly=(m[0]-cx0)*s,(m[1]-cy0)*s
            q=r["items"][r["code"]]["qty"]
            labels.append((lx,ly,f"{SHORT.get(r['code'],r['code'])}\n{q:,.2f}m",q))
            continue
        m=row_mask(r,M,shape)
        if m.sum()==0: continue
        crop=m[cy0:cy0+int(round(Hh/s)),cx0:cx0+int(round(Ww/s))]
        mm=cv2.resize(crop.astype(np.float32),(Ww,Hh),interpolation=cv2.INTER_LINEAR)>0.5
        fc=[c for c in r["items"] if c in FILL]
        if fc:
            col=np.array(COL[fc[0]][::-1],np.float32); img[mm]=img[mm]*0.5+col*0.5
        for c in r["items"]:
            if c in LINE:
                for pg in row_polys(r,gk): PL([np.array([T(p) for p in pg],np.int32)],True,COL[c][::-1],lw)
        if not mm.any(): continue
        ys,xs=np.nonzero(mm); lx,ly=xs.mean(),ys.mean()
        dt=cv2.distanceTransform(mm.astype(np.uint8),cv2.DIST_L2,5)
        if dt[min(int(ly),Hh-1),min(int(lx),Ww-1)]<15*s:
            iy,ix=np.unravel_index(np.argmax(dt),dt.shape); lx,ly=float(ix),float(iy)
        L=[r["room"]+("／補強" if (MODE=="ceil" and "補強" in r["items"]) else "")]
        for c,v in r["items"].items():
            if MODE=="ceil" and c=="補強": continue      # 補強面積＝該房天花面積，以房號旁「／補強」表示
            L.append(f"{SHORT.get(c,c)} {v['qty']:,.2f}{unit(c)}")
        labels.append((lx,ly,"\n".join(L),float(mm.sum())))
    return labels,lm

def swatch(d,c,x,y,sz):
    if c in COL and (MODE=="rail" or c in LINE) and c not in FILL:
        d.rectangle([x,y,x+sz,y+sz],fill="white",outline=COL[c],width=max(5,sz//7))
    elif c in COL: d.rectangle([x,y,x+sz,y+sz],fill=COL[c],outline=(0,0,0),width=2)
    else: d.rectangle([x,y,x+sz,y+sz],fill=(235,235,235),outline=(0,0,0),width=2)

def tots_for(gk):
    fl=FKEY.get(gk,gk)
    if MODE=="rail":    # 比例分配項目依各張圖（屋突層拆 RF1／RF2）的分配量
        sa=J["sheet_alloc"].get(gk,{}); out=[]
        for x in J["items"]:
            v=sa.get(x["code"],0.0) if x["basis"]!="net" else sum(r["len"] for r in floor_rows(gk) if r["code"]==x["code"])
            if v>0.005: out.append((x,v))
        return out
    if gk.startswith("RF"):
        out=[]
        for x in J["items"]:
            v=sum(it["qty"] for r in floor_rows(gk) for c,it in r["items"].items() if c==x["code"])
            if x["basis"]!="net": v=x["owner"].get(fl,0) if gk=="RF1" else 0
            if v>0.005: out.append((x,v))
        return out
    return [(x,x["owner"][fl]) for x in J["items"] if x["owner"][fl]>0.005]

def internal(gk):
    T=json.load(open(f"{S}/tilespecs/{gk}_final.json",encoding="utf-8"))
    M,shape=load_masks(gk)
    col=cv2.imread(f"{S}/fl/c_{gk}.png").astype(np.float32)
    labels,lm=draw_layer(col,gk,M,shape,(1.0,0,0),False)
    img=Image.fromarray(cv2.cvtColor(col.clip(0,255).astype(np.uint8),cv2.COLOR_BGR2RGB)); d=ImageDraw.Draw(img); fb=fnt(19,True)
    def meas(t):
        b=d.multiline_textbbox((0,0),t,font=fb,anchor="mm",align="center",spacing=1); return b[2]-b[0],b[3]-b[1]
    placed=labelplace.place(labels,lm,meas,pad=(4,3),gap=12,clear=8)
    labelplace.draw(d,placed,fb,spacing=1,width=1,lead_w=2,dot=4)
    tots=tots_for(gk); title=T["title"].replace("油漆","")
    def compose(crop,outp,ttl):
        im=img.crop(tuple(crop)); ft=fnt(24); fh=fnt(32,True)
        lw=1000; lh=max(im.height,200+44*(len(tots)+12))
        out=Image.new("RGB",(im.width+lw,lh),"white"); out.paste(im,(0,0)); dd=ImageDraw.Draw(out); x0=im.width+30; y=30
        dd.text((x0,y),ttl+" — "+CFG["title"],font=fh,fill=(0,0,0)); y+=56
        dd.text((x0,y),"代號                         本層數量",font=ft,fill=(0,0,0)); y+=42
        for x,v in tots:
            c=x["code"]; swatch(dd,c,x0,y+4,28)
            dd.text((x0+44,y),SHORT.get(c,c),font=ft,fill=(0,0,0))
            dd.text((x0+380,y),f"{v:,.2f}{unit(c)}"+("（比例分配）" if x["basis"]!="net" else ""),font=ft,fill=(160,0,0) if x["basis"]!="net" else (0,0,0))
            y+=44
        y+=16
        for line in CFG["legend_lines"]: dd.text((x0,y),line,font=fnt(20),fill=(60,60,60)); y+=30
        out.save(outp)
    fd=f"{OD}/{FOLDER.get(gk,gk)}"; os.makedirs(fd,exist_ok=True); pre=PREF.get(gk,gk)
    compose(T["crop"],f"{fd}/{pre}_最終標註.png",title)
    for i,cr in enumerate(T.get("tiles",[])): compose(cr,f"{fd}/{pre}_最終標註_分區{i+1}.png",title+f"  分區{i+1}/{len(T['tiles'])}")
    return len(placed)

def axis_crop(g,crop):
    x0,y0,x1,y1=crop
    b=cv2.medianBlur(g,3)
    cs=cv2.HoughCircles(b,cv2.HOUGH_GRADIENT,dp=1,minDist=60,param1=120,param2=30,minRadius=28,maxRadius=60)
    cs=[] if cs is None else [tuple(map(int,c)) for c in np.round(cs[0])]
    def best(cands,axis):
        groups=[]
        for c in sorted(cands,key=lambda c:c[axis]):
            if groups and abs(c[axis]-groups[-1][-1][axis])<=15: groups[-1].append(c)
            else: groups.append([c])
        groups=[gr for gr in groups if len(gr)>=3]
        return max(groups,key=lambda gr:(len(gr),-gr[0][axis])) if groups else []
    cs=[c for c in cs if 28<=c[2]<=42]
    top=best([c for c in cs if y0-650<c[1]<y0+40 and x0-250<c[0]<x1+250],1)
    left=best([c for c in cs if x0-650<c[0]<x0+40 and y0-250<c[1]<y1+250],0)
    pts=[(x0,y0),(x1,y1)]+[(c[0]-c[2]-25,c[1]-c[2]-25) for c in top+left]+[(c[0]+c[2]+25,c[1]+c[2]+25) for c in top+left]
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    if not top: ys.append(y0-280)
    if not left: xs.append(x0-280)
    return [max(0,min(xs)),max(0,min(ys)),min(4300,max(xs)),max(ys)]
def clean(gray):
    g=gray.astype(np.float32); bl=cv2.GaussianBlur(g,(0,0),1.2); g=np.clip(g+1.2*(g-bl),0,255)
    g=np.clip((g-55)/(215-55),0,1); g=g**1.6*255; return g.astype(np.uint8)

A3W,A3H=4961,3508; MG=90; PLACED={}
def owner(gk):
    T=json.load(open(f"{S}/tilespecs/{gk}_final.json",encoding="utf-8"))
    M,shape=load_masks(gk)
    g=cv2.imread(f"{S}/fl/{gk}.png",0)
    cx0,cy0,cx1,cy1=axis_crop(g,T["crop"]); cw,ch=cx1-cx0,cy1-cy0
    fl=FKEY.get(gk,gk); tots=tots_for(gk)
    ncol=2; rows=max(1,math.ceil(len(tots)/ncol)); LH=200+rows*62+190
    s=min((A3W-2*MG)/cw,(A3H-2*MG-LH)/ch)
    pdf,pg,sheet,cname=SRC[gk]
    p=pymupdf.open(pdf)[pg]; z=300*s/72
    pix=p.get_pixmap(clip=pymupdf.Rect(cx0*72/300,cy0*72/300,cx1*72/300,cy1*72/300),matrix=pymupdf.Matrix(z,z),colorspace=pymupdf.csGRAY)
    bg=clean(np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width)); Hh,Ww=bg.shape
    img=cv2.cvtColor(bg,cv2.COLOR_GRAY2BGR).astype(np.float32)
    labels,lm=draw_layer(img,gk,M,shape,(s,cx0,cy0),True)
    im=Image.new("RGB",(A3W,A3H),"white"); ox=MG+int(((A3W-2*MG)-Ww)/2); oy=MG
    im.paste(Image.fromarray(cv2.cvtColor(img.clip(0,255).astype(np.uint8),cv2.COLOR_BGR2RGB)),(ox,oy))
    d=ImageDraw.Draw(im); fl_=fnt(28,True)
    def meas(t):
        b=d.multiline_textbbox((0,0),t,font=fl_,anchor="mm",align="center",spacing=2); return b[2]-b[0],b[3]-b[1]
    PLACED[gk]=placed=labelplace.place(labels,lm,meas,pad=(6,5),gap=16,clear=12)
    labelplace.draw(d,placed,fl_,ox,oy,spacing=2,width=2,lead_w=3,dot=6)
    d.rectangle([ox,oy,ox+Ww,oy+Hh],outline=(0,0,0),width=3)
    ly0=oy+Hh+40
    d.text((MG,ly0),f"{('屋突層' if gk.startswith('RF') else fl)} {cname}平面圖（{sheet}）— {CFG['title'].replace('項目','')}數量",font=fnt(54,True),fill=(0,0,0))
    ly=ly0+90; colw=(A3W-2*MG)//ncol
    for ci in range(min(ncol,math.ceil(len(tots)/rows))):
        bx=MG+ci*colw
        for t,xo in zip(["代號","品名","本層數量","占該項%"],[70,330,colw-470,colw-200]): d.text((bx+xo,ly),t,font=fnt(30,True),fill=(60,60,60))
    ly+=50
    for i,(x,v) in enumerate(tots):
        ci,ri=i//rows,i%rows; bx=MG+ci*colw; y=ly+ri*62; c=x["code"]
        swatch(d,c,bx,y+4,42)
        nm=re.sub(r"^(天花板|防潮|扶手及欄杆|乳化塑膠漆)，","",x["name"]); nm=nm if len(nm)<=28 else nm[:27]+"…"
        d.text((bx+70,y+2),SHORT.get(c,c),font=fnt(30,True),fill=(0,0,0))
        d.text((bx+330,y+6),nm,font=fnt(25),fill=(0,0,0))
        d.text((bx+colw-470,y+2),f"{v:,.2f}{unit(c)}",font=fnt(32,True),fill=(160,0,0) if x["basis"]!="net" else (0,0,0))
        d.text((bx+colw-200,y+2),(f"{v/x['owner_total']*100:.1f}%" if x['owner_total'] else "-"),font=fnt(32),fill=(0,0,0))
    ny=ly+rows*62+25
    for line in CFG["a3_notes"]: d.text((MG,ny),line,font=fnt(27),fill=(60,60,60)); ny+=40
    fd=f"{OD}/{FOLDER.get(gk,gk)}"; os.makedirs(fd,exist_ok=True)
    out=f"{fd}/{gk if gk.startswith('RF') else FOLDER.get(gk,gk)}_實際數量.png"
    im.save(out,dpi=(300,300)); return out,len(labels)

if __name__=="__main__":
    for gk in sys.argv[2:]:
        print(gk,"A3",owner(gk),"internal cards",internal(gk))
    if labelplace.FAILED: print("NO-FREE-SPOT:",labelplace.FAILED)
    for k,v in PLACED.items(): print(k,"cards",len(v),"leaders",sum(1 for x in v if x[3]))
