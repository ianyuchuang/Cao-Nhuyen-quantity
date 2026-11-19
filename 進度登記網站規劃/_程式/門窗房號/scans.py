# 取出各層平面圖掃描原圖（PDF 內嵌影像，像素＝標籤明細座標）
import fitz, io
from PIL import Image
D='D:/分層數量/'
SRC={'B3F':('A2-04(用印版).pdf',0),'B2F':('建築圖(已簽章).pdf',64),'B1F':('A2-06(260929)印.pdf',0),'1F':('A2-07(261105)用印版.pdf',0),
     '屋突壹層':('建築圖(已簽章).pdf',77),'屋突貳層':('建築圖(已簽章).pdf',78)}
for i,f in enumerate(['2F','3F','4F','5F','6F','7F','8F','9F','10F','11F']): SRC[f]=('A2-08~A2-17(260916)印.pdf',i)
for fl,(f,pg) in SRC.items():
    doc=fitz.open(D+f); p=doc[pg]; x=p.get_images()[0]
    b=doc.extract_image(x[0])
    im=Image.open(io.BytesIO(b['image'])).convert('L')
    print(fl,im.size, p.rotation)
    im.save(f'scan_{fl}.png')
