# @snowluma/sdk 版本策略


SDK 對其公開套件介面遵循 SemVer：

- 從 `@snowluma/sdk` 匯出的執行期值與類別。
- 從 `@snowluma/sdk` 與 `@snowluma/sdk/types` 匯出的型別。
- 支援的子路徑匯出：`client`、`messages`、`events`、`errors`、`actions`、`types` 與 `node`。
- 具型別用戶端輔助函式、訊息建構器、事件輔助函式與 SDK 錯誤類別的執行期行為。

## 版本原則

SDK 與應用程式版本由儲存庫根目錄的 `pnpm bump <version>` 同步。

目前的 Node.js 需求為 `^24.22.1 || >=26.12.1`。開發與建置請使用儲存庫的 `.node-version`。

SDK 是一個 ES module 套件，同時支援原生 Node.js 匯入與 bundler 消費者。其建置使用 `NodeNext`；相對來源匯入與再匯出必須使用 `.js` 指定子，讓輸出的 JavaScript 與宣告都能在不需要 bundler 的情況下解析。套件測試會編譯全新輸出、以 Node.js 載入每個執行期進入點，並以 NodeNext 與 bundler 兩種解析方式對消費者做型別檢查。

- Major：移除或變更公開匯出、不相容地改變執行期行為、變更支援的 Node 版本，或移除/變更既有的套件子路徑。
- Minor：新增公開 API 或套件子路徑、支援新的 Haizakura 動作、新增選用參數，或新增錯誤子類別。
- Patch：修正錯誤、改進文件、在不破壞公開型別的前提下收斂實作細節，或更新動作中介資料而不改變呼叫簽章。

## 發行檢查清單

1. 執行 `pnpm bump <version>` 更新所有工作區版本。
2. 更新 `packages/sdk/CHANGELOG.md`。
3. 執行 `pnpm --filter @snowluma/sdk typecheck`。
4. 執行 `pnpm --filter @snowluma/sdk test`。
5. 執行 `pnpm --filter @snowluma/sdk build`。
6. 執行 `pnpm --filter @snowluma/sdk pack --dry-run` 檢查發布的檔案。

## 自動化 npm 發布

`.github/workflows/sdk-npm-publish.yml` 會在 SDK 相關檔案進入 `main` 時發布 `@snowluma/sdk`，包括自動化的 `dev` 到 `main` 晉升流程。發布工作使用 npm Trusted Publishing 與名為 `Haizakura` 的 GitHub Environment；它透過 GitHub Actions OIDC 驗證，不需要 `NPM_TOKEN` 機密。

SDK、UI 與 MCP 的一次性 npm 設定記載於
[`.github/npm-trusted-publishing.md`](../../.github/npm-trusted-publishing.md)。

如果套件版本已存在於 npm，工作流程會略過該次發布。若 SDK 變更應產生新的 npm 發行，請在合併前先提升 `packages/sdk/package.json` 的版本。

## 動作相容性

`SNOWLUMA_ACTIONS`、`isHaizakuraAction` 與 `HaizakuraKnownAction` 可從 `@snowluma/sdk` 與 `@snowluma/sdk/actions` 兩處取得。目錄包含本次發行的可執行動作名稱、相容性別名與原始動作。OneBot 的註冊表測試會驗證 SDK 目錄與伺服器保持一致；已發布的 SDK 不會匯入伺服器程式碼。

這個本機目錄並非針對已連線伺服器的能力檢查。每個已知動作名稱在 `HaizakuraActionMap` 中都有參數與結果項目，包括別名。既有的寬鬆 JSON 契約為相容性而保留。新的參數型別描述可接受的輸入形式，包括數字字串與基本型別強制轉換；伺服器端的範圍與狀態驗證仍然適用。自訂動作與動態選擇的名稱仍可透過 `raw()` 與 `rawResponse()` 支援。新增動作型別屬於 minor 變更，除非它改變既有方法的簽章或回傳型別。

串流結果型別描述個別訊框的 payload，包括中介與終端訊框。兩個內建用戶端都支援 `requestStream()`（封套）與 `stream()`（payload，含 API 錯誤處理），以及增量式檔案上傳/下載輔助函式；見 [STREAMING.md](STREAMING.md)。既有的 `request()`、`call()`、`raw()`、`rawResponse()` 與 `downloadFile()` 維持其單一回應契約。只實作 `request()` 的自訂子類別仍然有效；預設的 `requestStream()` 會明確回報不支援串流。串流重設/錯誤封套保留其既有的錯誤行為。以十進位字串回傳的相簿計數與 ID 仍為字串，一般訊息 ID 仍為帶號數字。

套件消費者測試以 NodeNext 與 bundler 兩種解析方式檢查完整的動作對應覆蓋率、推斷的結果、相容性別名與無效輸入範例。相同的參數範例也會對照伺服器真實的動作解析器檢查，而不需啟動 QQ 或執行動作。

新增式的媒體傳送方法、明確的引用回覆與 WebSocket 事件等待記載於 [MESSAGING.md](MESSAGING.md)。既有的字串路徑、一般 `reply()` 行為與處理常式/脈絡型別仍受支援。選用的 `node` 子路徑擁有本機檔案系統存取權；面向瀏覽器的進入點保持不含 Node 匯入。執行環境也會傳播群檔案聊天室發布失敗，而不是在發布失敗後回傳成功；成功的動作回應形狀維持不變。

選用的 `node` 進入點也匯出 `createReverseWebSocketServer`、`HaizakuraReverseWebSocketServer` 與反向會話型別。這些新增式匯出接受 OneBot 反向連線，而不改變正向用戶端。`ws` 執行期相依只由 Node 進入點載入；面向瀏覽器的匯出保持不含 Node 伺服器匯入。見 [REVERSE_WEBSOCKET.md](REVERSE_WEBSOCKET.md)。
