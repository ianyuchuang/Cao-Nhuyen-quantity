# 通用：分層數量 Excel（數量計算表 + 分層數量表），格式同油漆
# usage: python -I xlsx_gen.py ceil|wp|rail
import json, sys, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
sys.stdout.reconfigure(encoding="utf-8")
SP=os.path.dirname(os.path.abspath(__file__))
CFG=json.load(open(SP+"/cfg.json",encoding="utf-8"))[sys.argv[1]]
J=json.load(open(SP+"/"+CFG["json"],encoding="utf-8"))
OD=CFG["outdir"]; os.makedirs(OD,exist_ok=True); PRE=CFG["prefix"]
FL=J["floors"]; ITEMS=J["items"]; ROWS=J["rows"]; NF=len(FL)
thin=Side(style="thin",color="808080"); B=Border(left=thin,right=thin,top=thin,bottom=thin)
HF=PatternFill("solid",fgColor="DDEBF7"); IF=PatternFill("solid",fgColor="FCE4D6"); SF=PatternFill("solid",fgColor="F2F2F2"); KF=PatternFill("solid",fgColor="FFF2CC"); RF=PatternFill("solid",fgColor="F8CBAD"); DF=PatternFill("solid",fgColor="E2EFDA")
ctr=Alignment(horizontal="center",vertical="center",wrap_text=True); vc=Alignment(vertical="center",wrap_text=True); rt=Alignment(horizontal="right",vertical="center")
def put(sh,r,c,v=None,fmt=None,font=None,fill=None,al=vc):
    x=sh.cell(row=r,column=c,value=v); x.border=B; x.alignment=al
    if fmt: x.number_format=fmt
    if font: x.font=font
    if fill: x.fill=fill
    return x
def U(x): return "m" if x["unit"].upper()=="M" else "m²"
def done(x): return x.get("rate","")=="100%"
def page(s,orient="portrait"):
    s.page_setup.orientation=orient; s.page_setup.paperSize=8; s.page_setup.fitToWidth=1; s.page_setup.fitToHeight=0; s.sheet_properties.pageSetUpPr.fitToPage=True
lines={x["code"]:{f:[] for f in FL} for x in ITEMS}
for r in ROWS:
    for c,v in r["items"].items():
        if c in lines: lines[c][r["floor"]].append((r["room"],r["name"],v["t"],"="+v["fx"],v["qty"]))

# ================= 數量計算表 =================
wb=Workbook(); ws=wb.active; ws.title="計算式"
ws["A1"]=f"高雄軟體園區第二園區第一棟大樓 — {CFG['title']} 數量計算式"; ws["A1"].font=Font(bold=True,size=14)
ws["A2"]=CFG["calc_head"]; ws["A2"].alignment=Alignment(wrap_text=True); ws.merge_cells("A2:E2"); ws.row_dimensions[2].height=90
HDR=["樓層","房號／部位","空間名稱","計算式","數量"]
for i,w in enumerate([9,16,24,80,13]): ws.column_dimensions[L(i+1)].width=w
r=4; fcell={}
for x in ITEMS:
    c=x["code"]; q=x["contract"]; u=U(x)
    ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=5)
    put(ws,r,1,f"{x['key']}　{x['name']}　（單位：{x['unit']}　合約數量：{q:,.1f}"+("　已施作完成" if done(x) else "")+"）",font=Font(bold=True,size=11),fill=IF)
    for j in range(2,6): ws.cell(row=r,column=j).border=B
    r+=1
    if x["basis"]=="net":
        for j,h in enumerate(HDR): put(ws,r,j+1,h if j<4 else f"數量({u})",font=Font(bold=True),fill=HF,al=ctr)
        r+=1
        for f in FL:
            rows=lines[c][f]
            if not rows: continue
            fr=r
            for rm,nm,t,fx,_ in rows:
                put(ws,r,1,f,al=ctr); put(ws,r,2,rm); put(ws,r,3,nm); put(ws,r,4,t); put(ws,r,5,fx,"#,##0.00"); r+=1
            put(ws,r,1,f,font=Font(bold=True),fill=SF,al=ctr); ws.merge_cells(start_row=r,start_column=2,end_row=r,end_column=4)
            put(ws,r,2,f"{f} 小計",font=Font(bold=True),fill=SF)
            for j in (3,4): ws.cell(row=r,column=j).border=B
            put(ws,r,5,f"=SUM(E{fr}:E{r-1})","#,##0.00",Font(bold=True),SF); fcell.setdefault(c,{})[f]=f"E{r}"; r+=1
    else:
        Bt=sum(x["base"].values())
        ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=4)
        put(ws,r,1,f"依比例分配：{x.get('why','平面圖無量測依據')}，以「{x['desc']}」占比分配合約數量（依據合計 {Bt:,.2f}）",fill=KF)
        for j in (2,3,4): ws.cell(row=r,column=j).border=B
        put(ws,r,5,round(Bt,4),"#,##0.00",None,KF); brow=r; r+=1
        for j,h in enumerate(HDR): put(ws,r,j+1,h if j<4 else f"數量({u})",font=Font(bold=True),fill=HF,al=ctr)
        r+=1
        for f in FL:
            b=x["base"][f]
            if b<=0: continue
            put(ws,r,1,f,al=ctr); put(ws,r,2,"依比例分配"); put(ws,r,3,x["desc"].split("（")[0])
            put(ws,r,4,f"合約 {q:,.2f} × 本層依據 {b:,.2f} ÷ 依據合計"); put(ws,r,5,f"={q}*{round(b,4)}/$E${brow}","#,##0.00"); r+=1
            put(ws,r,1,f,font=Font(bold=True),fill=SF,al=ctr); ws.merge_cells(start_row=r,start_column=2,end_row=r,end_column=4)
            put(ws,r,2,f"{f} 小計",font=Font(bold=True),fill=SF)
            for j in (3,4): ws.cell(row=r,column=j).border=B
            put(ws,r,5,f"=E{r-1}","#,##0.00",Font(bold=True),SF); fcell.setdefault(c,{})[f]=f"E{r}"; r+=1
    ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=4)
    put(ws,r,1,f"{c} 合計",font=Font(bold=True,color="1F4E79"),fill=KF)
    for j in (2,3,4): ws.cell(row=r,column=j).border=B
    put(ws,r,5,("="+"+".join(fcell[c].values())) if fcell.get(c) else 0,"#,##0.00",Font(bold=True,color="1F4E79"),KF); r+=2
ws.freeze_panes="A4"; page(ws)

s2=wb.create_sheet("總表",0)
s2["A1"]=f"{CFG['title']} 分層數量總表"; s2["A1"].font=Font(bold=True,size=14)
s2["A2"]=CFG["sum_head"]; s2["A2"].alignment=Alignment(wrap_text=True); s2.merge_cells(start_row=2,start_column=1,end_row=2,end_column=8+NF); s2.row_dimensions[2].height=32
C0=5; CT=C0+NF
for i,w in enumerate([16,10,46,6]): s2.column_dimensions[L(i+1)].width=w
for j in range(NF): s2.column_dimensions[L(C0+j)].width=10
for k in range(4): s2.column_dimensions[L(CT+k)].width=12
s2.column_dimensions[L(CT+3)].width=34
def hdr(rr,extra=()):
    for i,h in enumerate(["項次","代號","品名","單位"]+FL+["合計"]+list(extra)): put(s2,rr,i+1,h,font=Font(bold=True),fill=HF,al=ctr)
s2.cell(row=3,column=1,value="一、各樓層數量").font=Font(bold=True,size=12); hdr(4,["合約數量","實際/合約","備註"])
for i,x in enumerate(ITEMS):
    rr=5+i; c=x["code"]
    put(s2,rr,1,x["key"]); put(s2,rr,2,c,font=Font(bold=True),al=ctr); put(s2,rr,3,x["name"],font=Font(size=9)); put(s2,rr,4,x["unit"],al=ctr)
    for j,f in enumerate(FL):
        ref=fcell.get(c,{}).get(f); put(s2,rr,C0+j,(f"='計算式'!{ref}" if ref else 0),'#,##0.00;-#,##0.00;"-"',al=rt)
    put(s2,rr,CT,f"=SUM({L(C0)}{rr}:{L(CT-1)}{rr})","#,##0.00",Font(bold=True),SF,rt)
    put(s2,rr,CT+1,x["contract"],"#,##0.00",None,SF,rt)
    if x["basis"]=="net":
        rat=x["ratio"] or 0; put(s2,rr,CT+2,f"={L(CT)}{rr}/{L(CT+1)}{rr}","0.0%",None,RF if abs(rat-1)>=0.02 else None,rt); note="照圖面實際數量"
    else:
        put(s2,rr,CT+2,"比例分配",None,None,None,ctr); note=f"依「{x['desc']}」分配合約數量"
    if done(x): note="已施作完成（執行率 100%）；"+note
    put(s2,rr,CT+3,note,font=Font(size=9),fill=DF if done(x) else None)
    s2.row_dimensions[rr].height=30
p0=5+len(ITEMS)+3
s2.cell(row=p0-1,column=1,value="二、各樓層占該項百分比").font=Font(bold=True,size=12); hdr(p0)
for i,x in enumerate(ITEMS):
    rr=p0+1+i; a=5+i
    put(s2,rr,1,x["key"]); put(s2,rr,2,x["code"],font=Font(bold=True),al=ctr); put(s2,rr,3,x["name"],font=Font(size=9)); put(s2,rr,4,"%",al=ctr)
    for j in range(NF): put(s2,rr,C0+j,f'=IF(${L(CT)}{a}=0,"",{L(C0+j)}{a}/${L(CT)}{a})','0.0%;-0.0%;"-"',al=rt)
    put(s2,rr,CT,f"=SUM({L(C0)}{rr}:{L(CT-1)}{rr})","0.0%",Font(bold=True),SF,rt); s2.row_dimensions[rr].height=30
s2.freeze_panes=s2.cell(row=5,column=C0); page(s2,"landscape")

s3=wb.create_sheet("施工細項表")
s3["A1"]=f"{CFG['title']} 施工細項表（各層數量及細項占比）"; s3["A1"].font=Font(bold=True,size=14)
W=CFG["subitems"]
s3["A2"]=("每層兩列：上列為數量，下列為占該工項百分比。"+"、".join(W)+f" {len(W)} 個細項各以本層數量 100% 計，不分權重；"
          "細項百分比 = 細項數量 ÷ 該工項合計，各細項百分比合計皆為 100%。施工時某層某細項完成，即填該格數量。")
s3["A2"].alignment=Alignment(wrap_text=True); s3.merge_cells(start_row=2,start_column=1,end_row=2,end_column=3+len(W)); s3.row_dimensions[2].height=60
for i,w in enumerate([11,10,14]+[14]*len(W)): s3.column_dimensions[L(i+1)].width=w
PCF=PatternFill("solid",fgColor="F7FBFF"); r=4; NC=3+len(W)
for i,x in enumerate(ITEMS):
    tr=5+i; c=x["code"]
    s3.merge_cells(start_row=r,start_column=1,end_row=r,end_column=NC)
    put(s3,r,1,f"{x['key']}　{c}　{x['name']}"+("　（已施作完成）" if done(x) else ""),font=Font(bold=True),fill=IF)
    for j in range(2,NC+1): s3.cell(row=r,column=j).border=B
    r+=1
    for j,h in enumerate(["樓層","","本層合計"]+[f"{nm}（100%）" for nm in W]): put(s3,r,j+1,h,font=Font(bold=True),fill=HF,al=ctr)
    r+=1; TOT=f"'總表'!{L(CT)}{tr}"; arows=[]; prows=[]
    for f in [f for f in FL if x["owner"][f]>0.005]:
        j=FL.index(f); ra,rp=r,r+1; arows.append(ra); prows.append(rp)
        s3.merge_cells(start_row=ra,start_column=1,end_row=rp,end_column=1)
        put(s3,ra,1,f,font=Font(bold=True),al=ctr); s3.cell(row=rp,column=1).border=B
        put(s3,ra,2,f"數量({U(x)})",al=ctr); put(s3,rp,2,"百分比",al=ctr,fill=PCF)
        put(s3,ra,3,f"='總表'!{L(C0+j)}{tr}","#,##0.00"); put(s3,rp,3,f"=C{ra}/{TOT}","0.00%",fill=PCF)
        for t in range(len(W)):
            put(s3,ra,4+t,f"=C{ra}","#,##0.00"); put(s3,rp,4+t,f"={L(4+t)}{ra}/{TOT}","0.00%",fill=PCF)
        r+=2
    ra,rp=r,r+1
    s3.merge_cells(start_row=ra,start_column=1,end_row=rp,end_column=1)
    put(s3,ra,1,"合計",font=Font(bold=True),fill=SF,al=ctr); s3.cell(row=rp,column=1).border=B
    put(s3,ra,2,f"數量({U(x)})",font=Font(bold=True),fill=SF,al=ctr); put(s3,rp,2,"百分比",font=Font(bold=True),fill=SF,al=ctr)
    for ci in range(3,NC+1):
        col=L(ci)
        put(s3,ra,ci,"="+"+".join(f"{col}{x_}" for x_ in arows) if arows else 0,"#,##0.00",Font(bold=True),SF)
        put(s3,rp,ci,"="+"+".join(f"{col}{x_}" for x_ in prows) if prows else 0,"0.00%",Font(bold=True),SF)
    r+=3
s3.freeze_panes="A4"; page(s3)
wb.save(f"{OD}/{PRE}_數量計算表.xlsx"); print("saved",f"{OD}/{PRE}_數量計算表.xlsx")

# ================= 分層數量表 =================
SHEETNO={"B3F":"A2-04","B2F":"A2-05","B1F":"A2-06","1F":"A2-07","屋突層":"A2-18/19"}
for i in range(2,12): SHEETNO[f"{i}F"]=f"A2-{i+6:02d}"
wb=Workbook(); ws=wb.active; ws.title="分層數量表"
ws["A1"]=f"高雄軟體園區第二園區第一棟大樓 — {CFG['title']} 分層數量（依建築圖 A2-04~A2-19 量測）"; ws["A1"].font=Font(bold=True,size=14)
ws["A2"]=("一、圖面數量（無平面量測依據者填「比例分配」之依據值）；二、占該項百分比 = 該樓層數量 ÷ 全部樓層合計；"
          "三、填報數量：照圖面實際數量，不依合約調整；比例分配項目 = 合約數量 × 百分比。圖面與合約差異 ±2% 以上標紅底（僅供對照）；綠底為已施作完成項目。")
ws["A2"].alignment=Alignment(wrap_text=True); ws.merge_cells(start_row=2,start_column=1,end_row=2,end_column=CT+3); ws.row_dimensions[2].height=45
for i,w in enumerate([16,10,44,6]): ws.column_dimensions[L(i+1)].width=w
for j in range(NF): ws.column_dimensions[L(C0+j)].width=10
for k in range(4): ws.column_dimensions[L(CT+k)].width=12
ws.column_dimensions[L(CT+4)].width=42
def hdr2(rr,extra):
    for i,h in enumerate(["項次","代號","品名","單位"]+[f"{f}\n{SHEETNO[f]}" for f in FL]+["合計"]+extra): put(ws,rr,i+1,h,font=Font(bold=True),fill=HF,al=ctr)
    ws.row_dimensions[rr].height=32
r=3
for sec,title in ((0,"一、圖面數量"),(1,"二、占該項百分比"),(2,"三、填報數量")):
    ws.cell(row=r,column=1,value=title).font=Font(bold=True,size=12); r+=1
    hdr2(r,(["合約數量","圖面/合約","備註"] if sec==0 else (["合約數量"] if sec==2 else []))); r+=1
    for x in ITEMS:
        put(ws,r,1,x["key"]); put(ws,r,2,x["code"],font=Font(bold=True),al=ctr,fill=DF if done(x) else None); put(ws,r,3,x["name"],font=Font(size=9)); put(ws,r,4,"%" if sec==1 else x["unit"],al=ctr)
        tot=sum(x["base"].values())
        for j,f in enumerate(FL):
            v=x["base"][f] if sec==0 else ((x["base"][f]/tot if tot else 0) if sec==1 else x["owner"][f])
            put(ws,r,C0+j,round(v,4) if sec!=1 else v,('0.0%;-0.0%;"-"' if sec==1 else '#,##0.0;-#,##0.0;"-"'),al=rt)
        put(ws,r,CT,f"=SUM({L(C0)}{r}:{L(CT-1)}{r})","0.0%" if sec==1 else "#,##0.0",Font(bold=True),SF,rt)
        if sec==0:
            put(ws,r,CT+1,x["contract"],"#,##0.0",None,SF,rt)
            if x["basis"]=="net":
                rat=x["ratio"] or 0; put(ws,r,CT+2,rat,"0.0%",None,RF if abs(rat-1)>=0.02 else None,rt)
                note=("圖面多於合約" if rat>=1 else "圖面少於合約")+"，照實際數量填報"
            else:
                put(ws,r,CT+2,"比例分配",None,None,None,ctr); note=f"{x.get('why','平面圖無量測依據')}，依「{x['desc']}」比例分配合約數量"
            if done(x): note="已施作完成；"+note
            put(ws,r,CT+3,note,font=Font(size=9))
        if sec==2: put(ws,r,CT+1,x["contract"],"#,##0.0",None,SF,rt)
        ws.row_dimensions[r].height=30; r+=1
    r+=2
ws.freeze_panes=ws.cell(row=5,column=C0); page(ws,"landscape")
d=wb.create_sheet(CFG["detail_title"])
codes=[x["code"] for x in ITEMS if x["basis"]=="net"]
HD=["樓層","圖號","房號／部位","空間名稱"]+[h for h,_ in CFG["detail_cols"]]+[f"{c}({U(next(x for x in ITEMS if x['code']==c))})" for c in codes]
for i,h in enumerate(HD): put(d,1,i+1,h,font=Font(bold=True),fill=HF,al=ctr)
for i,w in enumerate([7,9,14,24]+[w for _,w in [(0,14)]*len(CFG["detail_cols"])]+[11]*len(codes)): d.column_dimensions[L(i+1)].width=w
rr=2
for r_ in ROWS:
    vals=[r_["floor"],r_["sheet"],r_["room"],r_["name"]]+[r_.get(k) for _,k in [(h,k) for h,k in zip([h for h,_ in CFG["detail_cols"]],CFG["detail_keys"])]]
    vals+=[r_["items"][c]["qty"] if c in r_["items"] else None for c in codes]
    for i,v in enumerate(vals): put(d,rr,i+1,v,"#,##0.00" if isinstance(v,float) else None)
    rr+=1
d.freeze_panes="E2"; d.auto_filter.ref=f"A1:{L(len(HD))}{rr-1}"
e=wb.create_sheet("計算說明"); e.column_dimensions["A"].width=160
NOTES=CFG["notes"]+(["","待確認事項："]+["・"+p for p in J.get("pending",[])] if J.get("pending") else [])
for i,t in enumerate(NOTES): c_=e.cell(row=i+1,column=1,value=t); c_.alignment=Alignment(wrap_text=True,vertical="top")
wb.save(f"{OD}/{PRE}_分層數量表.xlsx"); print("saved",f"{OD}/{PRE}_分層數量表.xlsx")
