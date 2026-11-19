# 工項進度登記網站

工程師用手機依「工項 → 樓層 → 房間 → 代號細項」登記完成百分比；結果寫進 Google 試算表「工項進度登記」，每日完成量寫到「網站每日數量」，由內業對照正式版決定要不要填進正式版。

- **網頁**：`web/`，純靜態，放 GitHub Pages（公開）。網頁裡**沒有任何數量、單價**，登入後才從試算表取資料。
- **API**：`apps-script/`，綁定試算表「工項進度登記」的 Apps Script，部署成網頁應用程式。
- **正式版「高軟每日施工內容(正式版)」只讀**：程式只從它讀取（同步主表、算期初），任何情況都不寫入。

```
進度登記網站/
├─ apps-script/        貼到試算表的 Apps Script（7 個 .gs＋appsscript.json）
│   ├─ Config.gs      設定、欄位位置、共用工具
│   ├─ Auth.gs        Google ID token 驗證、共用名單權限
│   ├─ Api.gs         doGet / doPost：bootstrap、submit、material、history、recalc
│   ├─ Data.gs        讀寫「位置」「目前進度」「進料」等
│   ├─ Recalc.gs      重算「網站每日數量」、設定期初
│   ├─ Sync.gs        從正式版同步主表、對齊「網站每日數量」
│   ├─ Menu.gs        試算表選單、每日觸發
│   └─ appsscript.json
├─ tests/gas-test.js   Apps Script 本機單元測試（模擬試算表）
└─ web/                放到 GitHub Pages 的網頁
    ├─ index.html  app.js  style.css
    ├─ config.js      ← 部署後填 API 網址與 OAuth 用戶端 ID
    └─ demo.js        示範模式的假資料（不連線）
```

## 目前部署狀態（2026-11-19）

| 項目 | 值 |
|---|---|
| Apps Script 專案 | 「工項進度登記 API」（綁定試算表「工項進度登記」），已授權 |
| 網頁應用程式網址 | `https://script.google.com/macros/s/AKfycbza7iiFZwQPQ-QNu0yfyrTaBKZ7gELe5C3D1SIZqlsB5YN_3pB7XxjwXeB9avf10Xwfqg/exec`（第 2 版，執行身分：擁有者，存取：所有人；第 2 版起完成% 在試算表存 0～1 小數，配合百分比格式） |
| Google Cloud 專案 | `progress-register`（Progress Register），OAuth 同意畫面已發布（外部、正式版） |
| OAuth 用戶端 ID | `902248037106-cjn6lprnhovn2lncu3j3e8orgu7d6k6p.apps.googleusercontent.com`，來源：`https://ianyuchuang.github.io`、`http://localhost:8765` |
| 「設定」表 | 網站網址、OAuth 用戶端 ID、權限來源＝人員表 已填；**上線日未填** |
| GitHub Pages | `https://ianyuchuang.github.io/Cao-Nhuyen-quantity/`，來源為 `gh-pages` 分支（只含 `web/` 的檔案＋`.nojekyll`，與 `main` 無共同歷史） |

**更新網頁**：改完 `web/` 後，在 `D:\分層數量` 執行下列指令，把 `web/` 打包成新的 `gh-pages` commit 推上去（不會切換分支、不動工作資料夾）：

```bash
git fetch origin gh-pages; T=$(mktemp); for f in index.html app.js style.css config.js demo.js privacy.html; do printf '100644 blob %s\t%s\n' "$(git hash-object -w "進度登記網站/web/$f")" "$f" >> "$T"; done; printf '100644 blob %s\t.nojekyll\n' "$(git hash-object -w --stdin </dev/null)" >> "$T"; C=$(echo "更新進度登記網站" | git commit-tree "$(git mktree < "$T")" -p origin/gh-pages); git push origin "$C:refs/heads/gh-pages"
```

---

## 部署步驟（第一次，約 30 分鐘）

### 1. 建立 Google Cloud 的 OAuth 用戶端 ID

1. 用你的 Google 帳號開 <https://console.cloud.google.com/>，左上角專案選單 →「新增專案」，名稱例如「工項進度登記」。
2. 左側選單「API 和服務」→「OAuth 同意畫面」（新版叫「Google Auth Platform」）→ 開始設定：
   - 應用程式名稱：工項進度登記；使用者支援電子郵件：你的信箱。
   - 目標對象：**外部**。
   - 聯絡資訊：你的信箱 → 建立。
   - 「目標對象」頁把發布狀態改為**正式版（發布應用程式）**。只用登入的基本資料（email、名稱），**不需要 Google 審核**；若維持「測試」，只有加進測試使用者名單的帳號能登入。
3. 「用戶端」（或「憑證」）→「建立用戶端」→ 類型選**網頁應用程式**：
   - 名稱：進度登記網站。
   - **已授權的 JavaScript 來源**：填 GitHub Pages 網址的網域，例如 `https://你的帳號.github.io`（只要網域，不含路徑、結尾不加 `/`）。要在自己電腦測試可再加 `http://localhost:8765`。
   - 已授權的重新導向 URI：**不用填**。
4. 建立後複製「用戶端 ID」（`…….apps.googleusercontent.com`）。這個值不是機密，會放在公開網頁上。

### 2. 把 Apps Script 貼進試算表

1. 開試算表「工項進度登記」→「擴充功能」→「Apps Script」。
2. 左側齒輪「專案設定」→ 勾選「在編輯器中顯示『appsscript.json』資訊清單檔案」。
3. 回「編輯器」：
   - 把預設的 `程式碼.gs` 刪掉（或改名）。
   - 依序按「＋」→「指令碼」，建立 `Config`、`Auth`、`Api`、`Data`、`Recalc`、`Sync`、`Menu` 七個檔案，各貼上 `apps-script/` 同名檔的內容。
   - 打開 `appsscript.json`，整個換成 `apps-script/appsscript.json` 的內容。
   - 按「儲存」。
4. 上方函式選單選 `onOpen` →「執行」→ 會跳出授權：選你的帳號 →「進階」→「前往（不安全）」→「允許」。會要求的權限：
   - 查看及管理試算表（讀寫本試算表、讀正式版、查本試算表的共用名單）
   - 連線到外部服務（向 Google 驗證登入憑證）
   - 管理觸發條件（每日同步）、在試算表顯示選單

   （「不安全」是因為這是你自己寫的程式、沒經過 Google 審核，屬正常。）
5. 「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」：
   - 說明：進度登記 API
   - **執行身分：我**
   - **具有存取權的使用者：任何人**（實際權限由試算表共用名單把關；「任何人」才能讓 GitHub Pages 的網頁呼叫）
   - 按「部署」，複製「網頁應用程式網址」（`https://script.google.com/macros/s/……/exec`）。

> 之後改了程式：「部署」→「管理部署作業」→ 鉛筆 →「版本：新版本」→「部署」。網址不變。

**也可以用 clasp（指令列）**：
```bash
npm install -g @google/clasp
```
```bash
clasp login
```
在 `apps-script/` 建 `.clasp.json`，內容 `{"scriptId":"<Apps Script 專案設定裡的指令碼 ID>","rootDir":"."}`，再執行：
```bash
clasp push
```
（clasp 會把 `.gs` 上傳；部署仍照上面第 5 步在網頁操作，或用 `clasp deploy`。）

### 3. 填「設定」表

在試算表「設定」工作表：

| 項目 | 值 |
|---|---|
| OAuth 用戶端 ID | 第 1 步複製的用戶端 ID（**一定要填**，API 用它驗證登入憑證） |
| 網站網址 | GitHub Pages 網址（備查） |
| 上線日 | 網站開始負責每日數量的那一天，例如 `2026-12-01`（填了才會寫「網站每日數量」） |
| 權限來源 | 新增這一列（選填）：`試算表共用`（預設）或 `人員表`，見第 5 步 |

### 4. 填網頁設定並放上 GitHub Pages

1. 編輯 `web/config.js`：
   ```js
   window.APP_CONFIG = {
     API_URL: 'https://script.google.com/macros/s/……/exec',
     CLIENT_ID: '…….apps.googleusercontent.com'
   };
   ```
2. 在 GitHub 新建一個倉庫（例如 `progress`），**只放 `web/` 資料夾裡的檔案**（index.html、app.js、style.css、config.js、demo.js）。
   **不要**把 `D:\分層數量` 整個資料夾推上去：那裡有建築圖、數量表與含單價的 CSV，GitHub Pages 一律公開。
3. 倉庫「Settings」→「Pages」→ Source 選「Deploy from a branch」→ Branch 選 `main`、資料夾 `/ (root)` → Save。約 1 分鐘後網址會是 `https://你的帳號.github.io/progress/`。
4. 確認第 1 步「已授權的 JavaScript 來源」有填 `https://你的帳號.github.io`。

### 5. 加人

有兩種做法，由「設定」表的「權限來源」決定：

**A. 試算表共用（預設，照規劃稿）**：在試算表按「共用」加入對方的 Google 帳號（個人 Gmail 也可以）：

| 共用身分 | 網站上 | 試算表 |
|---|---|---|
| 檢視者（或加註者） | 登入、查看、登記進度與進料；修改紀錄只看得到自己的 | 只能看 |
| 編輯者 | 同上，另可「全部重算」、看所有人的紀錄 | 可直接改 |
| 未共用 | 登入後顯示「請向管理者申請權限」 | — |

- 權限快取 10 分鐘。移除某人後要立即生效：試算表選單「進度登記」→「清除權限快取」。
- 「人員」表可填 Google 帳號與顯示名稱，網站與「目前進度」會顯示名稱（沒填就用 Google 名稱）。
- 不要把試算表設成「知道連結的任何人」，那樣個別帳號不會出現在共用名單，會被擋。
- ⚠ 檢視者可以直接打開試算表，而主表「施工-實際進度」是正式版鏡像，**含單價、複價**。如果不想讓工地人員看到金額，請用 B。

**B. 人員表（建議，資安審查建議）**：「設定」表加一列 `權限來源`＝`人員表`。
- 工程師**不必共用試算表**，只要在「人員」表填 Google 帳號（A 欄）與顯示名稱（B 欄），就能用網站登記（等同檢視者）。
- 試算表的編輯者（主任、內業）仍是網站的編輯者。
- 這樣工程師完全碰不到試算表，看不到任何金額。

### 6. 上線

1. 「設定」表填好**上線日**。
2. 試算表選單「進度登記」→「從正式版同步主表」（第一次確認能讀正式版）。
3. 「進度登記」→「**設定期初**」：以上線日前正式版的使用數量算期初%（= 使用數量 ÷ 圖面合計，上限 100%），平均設到每個位置，並把期初數量寫到「網站每日數量」J 欄。完成後會列出「使用數量超過圖面合計」的代號。
4. 「進度登記」→「安裝每日同步觸發（每天 02:00）」：每天從正式版同步主表並全部重算。
5. 用手機開 GitHub Pages 網址，用 Google 帳號登入試一筆。

---

## 運作方式

- **登入**：網頁用 Google 登入按鈕取得 ID token，每個請求都帶著；Apps Script 向 Google 驗證 token 是發給本網站（aud＝「設定」表的用戶端 ID）、未過期、email 已驗證，再查 email 是否在本試算表的共用名單。token 約 1 小時過期，過期時網頁會請你再登入，未送出的資料不會遺失。
- **登記**：樓層、房間（門窗是代號組）、代號三層都可填；上層覆蓋底下前，如果底下已有不同的值會先提示。完成% 比上次低要填原因。門窗每樘分框 60%／扇 40%（窗：窗框／玻璃及五金；捲門：導軌及捲軸箱／門片及電動機）。比例分配的數量與進料在「代號層」。
- **寫入**：每筆登記寫「進度紀錄」（只新增，含舊值、原因、登記人、時間、UUID），並更新「目前進度」的完成%、框、扇、日期、登記人（**不寫 J 欄完成量公式**）。補登較早日期只進紀錄與每日數量，不覆蓋較新的目前進度。
- **網站每日數量**：寫入後重算該層級上線日之後每一天：累計(D) = 每個位置取施工日期 ≤ D 的最新一筆 × 圖面數量；當日 = 累計(D) − 累計(前一天)。只寫 K 欄以後、上線日以後的日期欄；E、G、H、I 是公式不碰；J 是期初。
- **衝突**：送出時帶「看到的舊值」，和試算表不同就不寫入，網頁顯示「被別人改過」，可選「採用目前值」或「以我的為準重送」。
- **離線**：送不出去的留在手機（localStorage），恢復連線或每 30 秒自動依 UUID 重送，不會重複寫入。
- **同步主表**：把正式版「施工-實際進度 (修訂2版)」複製成暫存工作表、整張貼到本表「施工-實際進度」、刪暫存表。正式版插入或刪除列時，「網站每日數量」依層級重排，期初與逐日數量跟著層級走。

## 資安措施

已請 Fable 5.2 審查並修正：
- **登入**：ID token 先在 Apps Script 本機檢查格式、aud、到期，再向 Google 驗證；失敗的 token 快取 60 秒，避免被垃圾請求耗盡 UrlFetch 配額。GET 不接受 token（只做健康檢查）。
- **權限**：每個請求都重查名單；全部重算只限編輯者；檢視者的修改紀錄只看自己的。
- **公式注入**：原因、備註、顯示名稱等外來文字寫進儲存格前，開頭是 `= + - @` 會加 `'` 存成文字並限長；UUID、填寫層級用白名單格式。
- **濫用**：請求上限 1 MB、一次最多 3000 筆、每個帳號每分鐘 60 次；UUID 去重；查表用無原型物件。
- **資料**：API 不讀主表，回傳只有數量、百分比與名稱，沒有單價、複價；錯誤訊息不含內部細節。
- **網頁**：CSP（只允許本站、Google 登入與 Apps Script）、no-referrer、禁止被其他網站嵌入；所有畫面文字都跳脫；Google 登入不自動選帳號（共用手機）；登出時提醒還有沒送出的資料。
- **權限範圍**：Apps Script 只要試算表、外部連線、觸發器、選單；不要雲端硬碟權限。
- **正式版**：只用 `openById(...).getSheetByName(...).copyTo(本試算表)` 與讀取，不寫入。若要從權限上保證，可用「對正式版只有檢視權」的帳號部署與安裝觸發器（需實測該帳號能否 copyTo）。
- 建議：GitHub Pages 用獨立的 GitHub 帳號或組織（`帳號.github.io` 底下所有專案頁同源，共享 sessionStorage 等）。

## 測試

Apps Script 的邏輯可以在本機用模擬試算表測（期初、登記、每日量、衝突、去重、補登、同步重排、權限與資安）：

```bash
node tests/gas-test.js apps-script
```

## 在自己電腦預覽（示範模式）

不需要部署，資料是隨機假資料：

```bash
python -m http.server 8765 --directory web
```

開 <http://localhost:8765/?demo=1>，或在登入頁按「示範模式」。右上「⋯」選單可模擬斷線、模擬別人同時修改、還原假資料。

## 疑難排解

| 狀況 | 處理 |
|---|---|
| 登入按鈕出現「origin_mismatch」或沒出現 | OAuth 用戶端的「已授權的 JavaScript 來源」沒有填網頁的網域 |
| 登入後「登入憑證不是發給本網站的」 | 「設定」表的 OAuth 用戶端 ID 與 `config.js` 不一致 |
| 「請向管理者申請權限」 | 帳號沒在名單（試算表共用或人員表）；剛加入的等最多 10 分鐘或按「清除權限快取」 |
| 「請求太頻繁」 | 每個帳號每分鐘上限 60 次，稍等會自動重送 |
| 網站每日數量沒有值 | 「設定」表沒填上線日，或還沒「設定期初」；可按「全部重算」 |
| 改了「位置」的圖面數量 | 選單「清除位置快取」再「全部重算」 |
| 改程式後網站沒變 | Apps Script 要「管理部署作業 → 新版本」；GitHub Pages 要等 1～2 分鐘並重新整理 |
