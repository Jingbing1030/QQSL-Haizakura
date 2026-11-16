# 主機外觀疊加層


在 **Haizakura 行程**上設定 `SNOWLUMA_WEBUI_TARGET=maibot`，即可使用 MaiBot 的 millennium 外觀。同一個發行 bundle 支援獨立部署與內嵌部署。未設定或空值會保留既有的 Haizakura 體驗；未知值會讓 WebUI 啟動失敗並提出明確診斷。

這個第一個配接器**只實作 millennium**，包含淺色與深色模式。
其他 MaiBot 樣式尚未實作。Haizakura 沒有新增外觀選擇器。主機擁有主題變更權；受管理期間既有的主題控制項無法使用，設定頁面會說明哪些偏好會被保留。

## 執行環境與歸屬

1. Core 在啟動時讀取環境變數。[靜態文件遞送](../core/src/webui/static-frontend.ts)
   會把經過驗證的公開 JSON bootstrap 注入 `/`、`/index.html` 與 SPA
   退回文件。文件使用 `Cache-Control: no-store`。不會有機密或任意環境變數到達瀏覽器。
2. [前端 bootstrap](src/appearance/runtime.ts) 只會在掛載 React 之前載入所選目標的資產。獨立部署不會載入任何目標樣式表、字型或主機監聽器。Vite 開發環境在其行程具有該環境變數時會提供相同的 bootstrap；生產建置保持中立。
3. [ThemeContext](src/contexts/ThemeContext.tsx) 把 `savedAppearance` 與實際生效的 `appearance` 分開。只有已儲存的偏好會進入 localStorage 或
   `config/ui.json`。目標更新絕不會呼叫持久化 API。
4. 目標擁有色彩、字型、圓角、桌布、CSS 變數覆寫、自訂 CSS 與自訂游標呈現。這些已儲存的值會被保留但暫停生效。UI 縮放、密度、動態/無障礙、導覽佈局與資料偏好仍可使用。返回原生外觀時，安全模式限制依然適用。
5. 單一的 layout effect 負責套用實際生效的外觀。變更不會重新載入文件、改變 React key 或重新啟動會話。所有目標規則都限定在 `html[data-webui-target]` 範圍內，包括 `body` 下的 portal。

## 主機協定，第 1 版

契約位於 [common/webui-target.ts](../common/src/webui-target.ts)。
部署環境變數是選擇性啟用機制，**不是即時傳輸通道**。既有的啟動器需要實作下方的傳送端；光是設定環境變數無法傳達另一個行程的目前主題。

同一文件內的內嵌橋接（例如 Electron 的 `executeJavaScript`）會在分派事件前發布最新的快照：

```js
const appearance = {
    version: 1,
    target: 'maibot',
    style: 'millennium',
    mode: 'dark', // 'light' | 'dark' | 'system'
};
window.__SNOWLUMA_HOST_APPEARANCE__ = appearance;
window.dispatchEvent(new CustomEvent('snowluma:host-appearance', { detail: appearance }));
```

該快照會處理在 React 或延遲資產載入器就緒之前送出的訊息。請在每次 guest `dom-ready` 時，以及主機解析出的亮度改變時發布。已經跟隨 MaiBot 的主機應轉送它自己解析出的 `light`/`dark` 狀態；這可避免出現互相競爭的真實來源。注入前請驗證 guest 預期的 origin，用
`JSON.stringify` 序列化值，並且不要在 guest 中啟用 Node 整合。

使用相同機制送出 `{ version: 1, target: null }`，即可為目前文件解除覆寫。原本的外觀會立即回復。
已選擇啟用的文件會保留其主機訂閱，以便主機日後重新套用目標。監聽器會在 provider 卸載時釋放。這不會改變啟動環境，也不會在獨立部署中啟用任何目標。

目前的配接器在主機快照到達之前，會先以 millennium 與系統亮度開始。若主機停止傳送，最後一個有效快照會保持生效。快照不會被持久化，也不會跨 origin/分頁共用。重新載入需要主機再次發布。不支援的版本、目標、樣式或模式會以 `[Haizakura appearance]` 主控台診斷被拒絕；前一個有效快照會保留。主機無法透過此協定提供 CSS、URL 或可執行內容。不會引入任何未經驗證的 HTTP 寫入端點。

## 新增目標

- 在共用契約的 `WEBUI_TARGETS` 中加入其識別碼、樣式與預設樣式。驗證請留在這個邊界；不要接受任意字串。
- 在窮舉式的[前端註冊表](src/appearance/registry.ts) 中加入一個延遲載入器。
  在 `src/appearance/targets` 下實作純粹的「已儲存→實際生效」解析器與限定範圍的樣式表。任何字型都請保持在本機並附上其再散布授權。
- 使用語意化的色彩變數、共用的元件 class 與中性的
  `data-ui-surface` 標記。不要在業務頁面中加入依目標名稱判斷的檢查。
- 絕不持久化解析後的覆寫值、變更已儲存的偏好、引入第二個 DOM 主題寫入者，或為了切換呈現而重新掛載應用程式。
- 測試預設資產/監聽器隔離、初始文件路由、格式錯誤的訊息、快速更新、清理，以及已儲存偏好的精確還原。
  以隔離的後端驗證表單、焦點、捲動、portal 與行動版佈局。
  Electron 整合需要另外做一次真實主機檢查。

## 來源與檢查

此配接器跟隨主 MaiBot 儲存庫的
[millennium 樣式表](https://github.com/Mai-with-u/MaiBot/blob/5c7637e6913c84d1c3d5e742fa9e95a7e70d3501/dashboard/src/styles/millennium.css)，
而非已封存的獨立 WebUI。色彩/材質也符合
[OneKey shell](https://github.com/Mai-with-u/MaiBotOneKey/blob/e8073b0bce35c8c4da973b06156602e14c42fee5/src/renderer/src/styles/millennium.css)。
隨附的 Jersey 20 字型來自該 MaiBot 修訂版，著作權屬 The Soft Type
Project Authors，依 [SIL Open Font License](src/appearance/targets/assets/Jersey20-OFL.txt) 授權。
其授權會與字型一併在生產資產中輸出。

聚焦檢查（從儲存庫根目錄）：

```sh
pnpm --filter @snowluma/common exec vitest run tests/webui-target.test.ts
pnpm --filter @snowluma/core exec vitest run tests/webui-static-frontend.test.ts
pnpm --filter webui exec vitest run tests/target-appearance.test.ts
```

交付變更前，請從 `AGENTS.md` 執行一般的工作區檢查。
