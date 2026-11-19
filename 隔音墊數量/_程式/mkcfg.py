# 隔音墊出圖／Excel 設定 -> cfg.json（格式同天花板、防水）
import json,os
SP=os.path.dirname(os.path.abspath(__file__))
C={"sound":{"title":"隔音墊項目","json":"sound.json","outdir":"D:/分層數量/隔音墊數量","prefix":"隔音墊",
 "subitems":["進料","底材處理","隔音墊鋪設"],
 "calc_head":("依據：建築圖 A2-04~A2-19 各層平面圖、A1-51~A1-53 室內裝修表（地坪欄 G1、G2 代號）；單位 m²。"
   "隔音材面積 = 地坪含 G1（或 G2）之房間淨面積（與地坪、天花板、油漆共用逐間沿牆內緣人工描繪的房間範圍）；"
   "G 代號與 F 代號為同一面積上下層，全面積計入。各項照圖面實際數量填寫，不依合約數量調整。"),
 "sum_head":"數量連結自「計算式」工作表；單位 m²。各項照圖面實際數量填寫，合約數量僅供對照。",
 "detail_title":"房間明細","detail_cols":[["地坪",14],["淨面積(m²)",11]],"detail_keys":["finish","area"],
 "colors":{"G1":[60,180,75],"G2":[145,30,180]},"fill_codes":["G1","G2"],"line_codes":{},"short":{},
 "legend_lines":["色塊＝地坪隔音材範圍：綠 G1（一般）、紫 G2（居室上方機房）。","標籤：房號／代號 本層數量（房間淨面積）。"],
 "a3_notes":["說明：色塊為地坪隔音材範圍（綠 G1 一般、紫 G2 居室上方機房）；標籤為房號／代號／圖面實際數量（房間淨面積），不依合約數量調整。",
             "數量計算式詳「隔音墊_數量計算表.xlsx」。原圖比例 S:1/300@A3，本圖已放大，僅供數量對照。"]}}
md=open("D:/分層數量/隔音墊數量/隔音墊數量計算說明.md",encoding="utf-8").read()
C["sound"]["notes"]=[l.rstrip() for l in md.split("## 6. 產出檔案")[0].splitlines()]
json.dump(C,open(SP+"/cfg.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
