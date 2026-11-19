# 地坪隔音材（G1 一般、G2 居室上方機房）分層數量
# usage: python -I calc_sound.py  -> writes 本資料夾 sound.json（rows + items，同天花板／防水 json 格式）
import json, csv, re, os, sys
sys.stdout.reconfigure(encoding="utf-8")
SP=os.path.dirname(os.path.abspath(__file__))
P=r"C:/Users/jho/AppData/Local/Temp/claude/75659cd6b46177ff/fa14caa7-cd98-4284-a6f3-82c8d8cf1bda/scratchpad"   # 共用房間範圍 geom/、裝修表 schedule_full.csv
D=r"D:/分層數量"
GK={"B3":"B3","B2":"B2","B1":"B1","R1F":"RF1","R2F":"RF2"}
FN={"B3":"B3F","B2":"B2F","B1":"B1F","RF1":"屋突層","RF2":"屋突層"}
SHEET={"B3":"A2-04","B2":"A2-05","B1":"A2-06","1F":"A2-07","RF1":"A2-18","RF2":"A2-19"}
for i in range(2,12): SHEET[f"{i}F"]=f"A2-{i+6:02d}"
GKS=["B3","B2","B1","1F","2F","3F","4F","5F","6F","7F","8F","9F","10F","11F","RF1","RF2"]
FLOORS=["B3F","B2F","B1F","1F","2F","3F","4F","5F","6F","7F","8F","9F","10F","11F","屋突層"]
rowsCSV=list(csv.reader(open(D+"/高軟每日施工內容(正式版) - 施工-實際進度 (修訂2版).csv",encoding="utf-8")))
CSV={r[0].strip():(r[1].strip(),r[2].strip(),float(r[4].replace(",","")),r[8].strip()) for r in rowsCSV if r and r[0].strip().startswith("I.甲.壹.六.") and len(r)>8 and r[4].strip()}
sched=list(csv.DictReader(open(P+"/schedule_full.csv",encoding="utf-8")))
geo={}; GJ={}
for gk in GKS:
    J=json.load(open(f"{P}/geom/{gk}.json",encoding="utf-8")); GJ[gk]=J
    for r in J["rooms"]:
        geo.setdefault(gk,[]).append(([x.strip() for x in re.split(r"[+＋]",str(r["room"]))],r))
def find(gk,room):
    for ids,r in geo.get(gk,[]):
        if room in ids: return ids,r
    parts=[r for ids,r in geo.get(gk,[]) if ids[0].startswith(room+"(")]
    if parts:
        return [room],{"room":room,"name":parts[0]["name"].split()[0],"area":round(sum(float(p["area"]) for p in parts),2),"perim":0}
    return None,None
def f2(v): return f"{v:.2f}".rstrip("0").rstrip(".")
ITEMS=[("G1","I.甲.壹.六.1.20"),("G2","I.甲.壹.六.1.21")]
rows=[]; pend=[]; used=set()
for s in sched:
    gk=GK.get(s["floor"],s["floor"]); fl=FN.get(gk,gk)
    codes=[c for c in s["floor_finish"].split("+") if c in ("G1","G2")]
    if not codes: continue
    ids,g=find(gk,s["room"])
    if g is None: pend.append(f"{fl} {s['room']} {s['name']}：地坪 {s['floor_finish']}，平面圖無房間範圍"); continue
    key=(gk,tuple(ids))
    if len(ids)>1:
        if key in used: continue
        used.add(key)
    area=float(g["area"])
    rec={"floor":fl,"gk":gk,"sheet":SHEET[gk],"room":"+".join(ids) if len(ids)>1 else s["room"],
         "name":g["name"] if len(ids)>1 else s["name"],"finish":s["floor_finish"],"area":area,"items":{}}
    for c in codes: rec["items"][c]={"qty":round(area,4),"t":f"地坪淨面積 {f2(area)}（地坪 {s['floor_finish']}）","fx":f"{area}"}
    rows.append(rec)
items=[]
for c,key in ITEMS:
    name,unit,q,rate=CSV[key]
    base={f:0.0 for f in FLOORS}
    for r in rows:
        if c in r["items"]: base[r["floor"]]+=r["items"][c]["qty"]
    tot=sum(base.values())
    items.append({"code":c,"key":key,"name":name,"unit":unit,"contract":q,"rate":rate,"basis":"net","desc":"","base":base,
                  "net_total":tot,"owner":dict(base),"owner_total":tot,"ratio":tot/q if q else None})
    print(f"{c} {key} 合約{q} 執行率{rate} 圖面{tot:.2f} ({tot/q*100:.1f}%) | "+" ".join(f"{f}:{v:.1f}" for f,v in base.items() if v>0.005))
json.dump({"floors":FLOORS,"items":items,"rows":rows,"pending":pend},open(SP+"/sound.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("待確認:"); [print("  ",x) for x in pend]
for r in rows: print(r["floor"],r["room"],r["name"],r["finish"],r["area"])
