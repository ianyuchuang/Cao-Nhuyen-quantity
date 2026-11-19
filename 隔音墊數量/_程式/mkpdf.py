import sys,pymupdf,os,io
from PIL import Image
od,pre=sys.argv[1],sys.argv[2]
order=[("B3F","B3F"),("B2F","B2F"),("B1F","B1F")]+[(f"{i}F",f"{i}F") for i in range(1,12)]+[("屋突層","RF1"),("屋突層","RF2")]
doc=pymupdf.open(); W,H=pymupdf.paper_size("a3-l")
for fd,nm in order:
    f=f"{od}/{fd}/{nm}_實際數量.png"
    b=io.BytesIO(); Image.open(f).convert('RGB').save(b,'JPEG',quality=90); pg=doc.new_page(width=W,height=H); pg.insert_image(pg.rect,stream=b.getvalue())
out=f"{od}/{pre}_各樓層A3.pdf"; doc.save(out,deflate=True); print(out,len(doc),round(os.path.getsize(out)/1e6,1),"MB")
