import pickle, collections, openpyxl, re
ROOT='D:/分層數量/'
FLS=['B3F','B2F','B1F','1F','2F','3F','4F','5F','6F','7F','8F','9F','10F','11F','屋突壹層','屋突貳層']
def band(y):
    if y< -25000: return 'B3F' if y>-38000 else None
    if y< -15000: return 'B2F'
    if y< -5000: return 'B1F'
    if 49000<=y<59500: return '6F'
    if 59500<=y<65000: return '7F'
    n=int((y+5000)//10000)+1
    if n<=11: return f'{n}F'
    if n==12: return '屋突壹層'
    if n==13: return '屋突貳層'
    return None
import os
# 工作資料夾（DXF、掃描圖、中間檔；不進 git）：環境變數 DOOR_WORK，預設本資料夾下 _work/
SP=os.environ.get('DOOR_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)),'_work'))+'/'
def load_dwg():
    d=pickle.load(open(SP+'dwg.pkl','rb'))
    tg=[]
    for k,c,p,a in d['tag']:
        if 'Dw10' in a: c=a['Dw10']; k='DW'
        elif k=='CW': continue
        if c is None: continue
        c=c.strip()
        if c.upper().startswith('DW'): c='DW'+c[2:]
        tg.append((k,c,p,a))
    d['tag']=tg
    return d
def load_tags():
    wb=openpyxl.load_workbook(ROOT+'門窗數量/門窗_數量計算表.xlsx',read_only=True,data_only=True)
    out=[]
    for r in list(wb['標籤明細'].iter_rows(values_only=True))[1:]:
        if r[2] and r[3]:
            out.append(dict(fl=r[0],sheet=r[1],seq=r[2],code=r[3],cls=r[4],x=r[5],y=r[6],note=(r[7] or '').strip()))
    return out
