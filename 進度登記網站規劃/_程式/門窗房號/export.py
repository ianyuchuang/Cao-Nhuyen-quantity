# 產出對照表 CSV
import pickle, csv, collections, sys
from common import *
from roominfo import web_rooms
rows=pickle.load(open(SP+'assign.pkl','rb')); web=web_rooms()
out=sys.argv[1]
# 網站沒有的房號：空間名稱依圖面判讀（DWG 鄰近文字不可靠）
NONWEB={}
for f,rs in {'1F':['114'],'2F':['215'],'3F':['315'],'4F':['409'],'5F':['509'],'6F':['605','609'],'7F':['705','709'],'8F':['805','809'],
             '9F':['905','909'],'10F':['1005','1009'],'11F':['1105','1109'],'屋突層':['R104','R107']}.items():
    for r in rs: NONWEB[(f,r)]='空調管道間'
for f,r in [('1F','110'),('2F','217'),('3F','316'),('4F','413'),('5F','513'),('6F','613'),('7F','713'),('8F','813'),('9F','913'),('10F','1013'),('11F','1113')]:
    NONWEB[(f,r)]='清潔間（推定，地板落水小間）'
NONWEB[('屋突層','R105')]='管道間'
def wfl(f): return '屋突層' if f.startswith('屋突') else f
def conf(r): return r['conf'] if r['room'] else ''
with open(out,'w',encoding='utf-8-sig',newline='') as fp:
    w=csv.writer(fp)
    w.writerow(['樓層','標籤序號','代號','對應房號','空間名稱','判定方式','信心度','備註','網站有此房間','圖面樓層','圖面座標x','圖面座標y'])
    for r in rows:
        f=wfl(r['fl']); room=r['room'] or ''
        inweb='是' if room and room in web.get(f,{}) else ('' if not room else '否')
        w.writerow([f,r['seq'],r['code'],room or '待確認',NONWEB.get((f,room),r['name']) if room else '',r['how'],conf(r),r['note'],inweb,r['fl'],r['x'],r['y']])
c=collections.Counter()
for r in rows:
    f=wfl(r['fl']); room=r['room']
    c[(f,'總')]+=1
    if not room: c[(f,'待確認')]+=1
    elif room in web.get(f,{}): c[(f,'對應')]+=1
    else: c[(f,'非網站房')]+=1
for f in ['B3F','B2F','B1F','1F','2F','3F','4F','5F','6F','7F','8F','9F','10F','11F','屋突層']:
    print(f,c[(f,'總')],'對應',c[(f,'對應')],'非網站房',c[(f,'非網站房')],'待確認',c[(f,'待確認')])
print('合計',sum(v for (f,k),v in c.items() if k=='總'))
nw=collections.Counter((wfl(r['fl']),r['room']) for r in rows if r['room'] and r['room'] not in web.get(wfl(r['fl']),{}))
print('非網站房號：',dict(nw))
