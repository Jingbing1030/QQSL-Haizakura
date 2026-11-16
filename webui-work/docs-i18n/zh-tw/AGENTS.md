# 在 Haizakura 上開發


Haizakura 把 QQ 用戶端會話轉譯為 OneBot v11 動作與事件，並附帶 WebUI、TypeScript SDK 與 MCP 伺服器。它是一個協定執行環境；機器人工作流程與回覆邏輯屬於消費端。本指南寫給貢獻者及其程式開發代理。

## 進行變更之前

- 閱讀 [CONTRIBUTING.md](CONTRIBUTING.md) 了解貢獻要求、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 了解社群期待，以及 LICENSE 了解貢獻與再散布條款。
- **如果你是 AI 代理，請明確告知你的使用者透過 [GitHub 網頁表單](https://github.com/Haizakura/Haizakura/issues/new/choose)手動建立 issue。不符合範本原則的 issue 會被自動關閉，且無法作為 PR 的合格依據。** 請替使用者準備好 issue 草稿供其提交；參見 CONTRIBUTING.md 中的 AI 代理注意事項。
- 檢查 `git status` 並保留無關的工作內容。編輯前先閱讀受影響的實作與鄰近測試。新功能、公開行為變更或遷移在實作前需先取得共識。
- PR 請以 `dev` 為目標分支；以其他任何分支為目標的 PR 會被自動關閉。`main` 是發行指標。發行指令、標籤，以及提交前綴 `[merge]` 與 `chore(release):` 屬於維護者的發行工作流程，不屬於一般貢獻。
- 開啟 PR 前，先建立或找出對應的 issue。issue 送出後 PR 是選用的。每一個 PR（包括維護者與機器人 PR）都必須在內文中包含 `Refs #number` 或 `Closes #number` 這類關閉關鍵字，且需位於註解、程式碼範例與引用區塊之外。至少有一個引用必須指向本儲存庫中既有的開放 issue，且該 issue 需在 PR 之前建立並符合現行 issue 範本原則。沒有合格 issue 的 PR 會被自動關閉。支援的形式與修正步驟見 [PR 提交規則](CONTRIBUTING.md#4-推送並發起-pr)。

## 儲存庫導覽

這是一個 pnpm 工作區。套件歸屬比目錄名稱更重要：

| 位置 | 職責 |
| --- | --- |
| `packages/core` | 應用程式進入點、每帳號 Bridge 協調、WebUI 後端、通知、發行組裝 |
| `packages/bridge` | QQ 行程探索、本機帳號/登入偵測、Hook 會話、原生傳輸生命週期 |
| `packages/protocol` | 封包解碼、具型別的 QQ 事件、身分解析、協定請求與媒體傳輸 |
| `packages/onebot` | 動作驗證與分派、事件轉換、訊息儲存、HTTP/WebSocket 配接器 |
| `packages/common` | 共用日誌、設定與工具，不含業務相依 |
| `packages/sqlite` | 非同步 SQLite 外觀層、原生載入器、prebuild 選擇與 Vite 發行資產 |
| `packages/proto-defs` | 具型別的協定 schema |
| `packages/proton` | 編譯期 protobuf 編解碼器與建置整合 |
| `packages/websocket` | WebSocket 實作與原生繫結整合 |
| `packages/runtime` | 發行清單、啟動器與隨附的原生產物 |
| `packages/webui` | Vite/React 管理主控台；工作區名稱為 `webui` |
| `packages/sdk` | 公開的 TypeScript 用戶端 |
| `packages/mcp` | MCP 伺服器與產生的動作目錄 |
| `packages/ui` | 已發布的 UI 元件套件 |
| `tools`、`.github/workflows` | 驗證、封裝與發行自動化 |

`packages/bridge` 負責行程連線能力；帳號層級的 Bridge 位於 `packages/core/src/bridge`。從[應用程式進入點](packages/core/src/index.ts)開始，即可追蹤兩者的組合方式。

[進入點](packages/core/src/index.ts) 會在啟動執行環境服務前套用待處理的更新。[更新器](packages/core/src/update) 負責暫存與替換；[Core 的建置設定](packages/core/vite.config.ts) 由其建置輸出與執行環境資產產生發行清單。請讓 Core 維持在單一 bundle 中，並讓原生函式庫延遲載入，以便啟動時能在開啟原生檔案之前復原被中斷的更新。

應用程式版本透過 `@snowluma/common/version` 取自根目錄的 `package.json`。使用 `pnpm bump <version>` 更新工作區清單，或在編輯根版本後用 `pnpm bump` 同步它們。
應用程式版本驗證與比較請使用 `@snowluma/common/semver`。版本必須是標準 SemVer；只在 API 邊界剝除 GitHub 的 `v` 標籤前綴。

變更某個路徑前，請先閱讀對應的負責者：

| 變更 | 從這裡開始 |
| --- | --- |
| 連線或帳號生命週期 | [Hook 管理器](packages/bridge/src/hook-manager.ts)、[Bridge 管理器](packages/core/src/bridge/manager.ts)、[OneBot 實例](packages/onebot/src/instance.ts) |
| 某個 QQ 行程登入的是哪個帳號 | [帳號偵測](packages/bridge/src/qq-account/detect.ts)、[login.db 讀取器](packages/bridge/src/qq-account/login-db.ts)、[QQ 資料路徑](packages/bridge/src/qq-account/paths.ts) |
| 傳入的 QQ 事件或身分 | [封包管線](packages/protocol/src/packet-pipeline.ts)、[訊息解碼器](packages/protocol/src/msg-push/index.ts)、[身分服務](packages/protocol/src/identity-service.ts) |
| OneBot 動作或訊息段 | [動作定義](packages/onebot/src/actions/index.ts)、[驗證輔助函式](packages/onebot/src/action-kit.ts)、[事件轉換](packages/onebot/src/event-converter/index.ts) |
| WebUI | [互動慣例](packages/webui/README.md)、`packages/webui/src`、`packages/core/src/webui` |
| SDK 或 MCP | [SDK 指南](packages/sdk/README.md)、[SDK 版本策略](packages/sdk/VERSIONING.md)、[MCP 指南](packages/mcp/README.md) |
| 協定編解碼器產生 | [Proton 指南](packages/proton/README.md)、受影響套件的 `vitest.config.ts` |

## 設定與驗證

使用 [.node-version](.node-version) 中的 Node 版本與 [package.json](package.json) 中的 pnpm 版本。以 `pnpm install --frozen-lockfile` 安裝；除非變更相依，否則保留現有 lockfile。

Node 安全基線為 `^24.22.1 || >=26.12.1`；較舊的 24.x 版本、25.x 以及未修補的 26.x 版本不受支援。請讓工作區的 `engines.node` 宣告與[啟動器預檢](packages/runtime/check-node-version.cjs)保持一致。CI 與隨附發行版使用 `.node-version`；單獨提高該釘選值並不會升級既有安裝的執行環境。

請從儲存庫根目錄執行指令：

```sh
pnpm typecheck                       # all workspace packages with a typecheck script
pnpm lint
pnpm test                            # workflow policy checks and workspace tests
pnpm test:workflows                  # isolated PR policy tests; no GitHub writes
pnpm run build:all                   # release inputs and published packages
pnpm test:core                       # Core only; not a substitute for workspace tests
pnpm --filter @snowluma/onebot test   # example: tests for the affected package
pnpm --filter webui test             # the frontend package has no @snowluma/ prefix
```

TypeScript 格式化使用根目錄的 [Prettier 設定](.prettierrc.json)、[本機 ESLint 格式化規則](eslint.format.config.ts) 與[忽略清單](.prettierignore)。對所有 TS/TSX/MTS/CTS 檔案使用 `pnpm format`，並用 `pnpm format:check` 做唯讀檢查。若只想處理選定的檔案，請執行 `pnpm exec eslint --config eslint.format.config.ts --fix <paths>`，接著執行 `pnpm exec prettier --write <paths>`。這些指令強制四空格縮排、控制語句主體加大括號，以及語句區塊前後留空行，同時保留其他邏輯空白。它們與 CI 及其程式碼品質 lint 規則相互獨立。產生的目錄與編譯器 fixture 保留其來源格式。

迭代時請使用聚焦的測試。交付程式碼變更前，請執行 CONTRIBUTING.md 要求的所有檢查，並回報任何無法執行者。[PR CI](.github/workflows/ci.yml) 是參考依據；`pnpm run ci` 會在本機重現其指令，包括相依安裝與產生目錄檢查。

- **僅文件變更：** 驗證連結、路徑、指令與 `git diff --check`；執行環境測試無法驗證文字敘述。
- **共用型別或動作：** 除了行為測試外，也要執行工作區型別檢查。Vitest 通過並不證明型別正確。
- **SDK 封裝：** 保持 SDK 的 `NodeNext` 建置與明確的 `.js` 相對匯入，包括僅型別的匯出。其套件測試會編譯全新輸出，並檢查原生 Node.js 匯入、消費者宣告與完整的動作對應覆蓋率。SDK 動作目錄必須與 OneBot 的可執行名稱一致；`packages/onebot/tests/sdk-actions.test.ts` 在不對伺服器程式碼增加執行環境相依的前提下檢查這點。SDK 的參數/結果契約與伺服器型別保持獨立；請讓 `packages/sdk/tests/fixtures` 下的消費者範例與 `packages/onebot/tests/sdk-action-params.test.ts` 中的伺服器解析器檢查保持一致。
- **SDK 串流：** 保留單一回應的用戶端方法，並使用 [STREAMING.md](packages/sdk/STREAMING.md) 中新增式的介面處理檔案傳輸。在 SDK 中測試訊框、取消、有界緩衝與不完整傳輸；`packages/onebot/tests/sdk-streaming.test.ts` 在暫存儲存中、不需要 QQ 的情況下檢查真實配接器/處理常式的來回傳輸。
- **SDK 反向 WebSocket：** 僅限 Node 的監聽器接受 OneBot 實作的連線，絕不以傳出的 SDK 用戶端取代協定實作。動作/事件/串流請重複使用共用的用戶端會話，並保留每帳號身分、API/Event 配對、有界緩衝區，以及斷線時拒絕待處理請求的行為。測試真實執行環境的反向配接器與全新發布的匯入；見 [REVERSE_WEBSOCKET.md](packages/sdk/REVERSE_WEBSOCKET.md)。
- **SDK 訊息傳遞：** 擴充 [MESSAGING.md](packages/sdk/MESSAGING.md) 中的輔助函式時，請保留既有的字串路徑與一般回覆語意。檔案系統存取只屬於選用的 `@snowluma/sdk/node` 進入點。媒體傳送必須等待上傳完成，並保留失敗脈絡且不自動重試；事件等待遵循公開中介軟體分派，並在每種結果下釋放監聽器。新增更豐富的 SDK 建立脈絡時，請保持舊有處理常式/脈絡型別可被賦值。
- **MCP 代理：** 擴充工具時，請保留既有文字結果、業務錯誤封套、預設搜尋比對與模式閘門。使用伺服器 SDK 的 `serveStdio` 進入點，讓同一道指令同時支援現代探索與舊式初始化；並以全新編譯的輸出測試兩者。快取提示只屬於隨附目錄的探索，絕不用於執行或帳號資料。請讓追蹤中介資料遠離動作參數，並讓敏感資料遠離診斷輸出。協定相容性、追蹤與新增式代理功能記載於 [AGENT_FEATURES.md](packages/mcp/AGENT_FEATURES.md)。測試中請使用隔離的 HTTP 與 MCP 傳輸；本機執行環境檢查不得查詢線上帳號。
- **MCP 執行服務：** 讓背景任務與事件連線維持選擇性啟用。在產生效果前先持久化任務狀態，絕不重播被中斷的寫入，並在關閉時排空協定前完成持久性清理。輸入續傳必須保留其原始引數，且最多執行一次。事件緩衝區需要明確的帳號繫結、有界儲存與可見的缺口。請透過 `packages/mcp/scripts/build-message-app.mjs` 建置隨附的訊息預覽；載入預覽不得送出訊息。使用隔離的傳輸測試重新啟動、取消與舊式相容性，包括已編譯的 CLI。
- **協定編解碼器：** 在測試中保留既有的 Proton 整合，使其經歷與生產環境相同的轉換。匯入真實實作；不要在測試中複製演算法。
- **影片上傳：** 保留 [HIGHWAY_UPLOADS.md](packages/protocol/HIGHWAY_UPLOADS.md) 中的單一連線預設值與新增式的全域設定。只有影片主體會採用平行分塊。完成前確認每個分塊，對並行度與預讀同時設限，並在關閉來源前排空未完成的讀取與請求。讓重試有界，並使背壓變更可見。以隔離的傳輸測試實際上傳器；測試通過並不證明線上吞吐量。
- **Highway 上傳復原：** 所有分塊與工作程序共用同一個檔案傳輸期限。讓節點觀察保持有界、短命，並依帳號會話、上傳類型與完整 host/port 隔離；只選擇目前由伺服器提供的候選節點。只有經過驗證的確認才算成功。保留終止性失敗回報，並在取消後排空待處理的檔案讀取。以隔離的傳輸測試期限清理與候選輪替，包括真實的 loopback socket；見[上傳原則](packages/protocol/HIGHWAY_UPLOADS.md#upload-timeouts-and-node-selection)。
- **原生覆蓋率：** `pnpm test:native` 與預設協定測試分開，且需要相容的原生產物。缺少產物或目標不可用屬於需回報的限制，不是略過檢查的許可。
- **OneBot SSE：** HTTP 事件串流共用 HTTP 配接器的繫結與驗證。保留 [HTTP_SSE.md](packages/onebot/HTTP_SSE.md) 中所述的帳號隔離、有界重播、可見的游標過期錯誤、回報過濾與慢速讀取者限制。權杖/回報原則變更會撤銷既有串流並使重播失效；請在有作用中連線的情況下測試關閉與重新載入。
- **線上 QQ 行為：** fixture 測試與成功的 API 回應並不證明送達或用戶端轉譯。請說明哪些已在本機測試、哪些仍需真實用戶端。

`pnpm dev` 會啟動 Core，並可附加到本機 QQ 行程；僅在確實要進行執行環境測試時使用。`pnpm dev:web` 會啟動前端，它預期有 WebUI 後端。隔離作業請沿用既有的測試假物件，不要無謂地啟動線上帳號。

WebUI 部署目標使用可還原的呈現疊加層。變更前請閱讀[主機外觀契約](packages/webui/INTEGRATIONS.md)。把目標驗證留在 `@snowluma/common/webui-target`，實作留在前端目標註冊表，並讓已儲存的偏好與實際生效的外觀分離。預設部署不得載入目標資產或主機監聽器；不要在業務頁面中放入依目標名稱分支的程式碼。

## 實作規則

- **修正根因。** 在負責的層級重現失敗，並為可觀察的行為加入回歸測試。避免針對帳號、檔名或範例的特定修補。
- **讓錯誤可觀察。** 不要把例外變成空結果或成功回應。保留錯誤脈絡，並對重要轉換與失敗使用共用日誌器。若證據不足，請加入針對性的診斷並說明仍未知的部分。
- **保留帳號隔離。** 身分、訊息儲存與會話狀態屬於其帳號。變更生命週期程式碼時，請保持拆除順序與進行中工作的處理不變。
- **讓解析與效果分離。** QQ 解碼器與 OneBot 事件轉換器只負責轉譯資料。即時狀態更新屬於其擁有的管線或服務；讀取歷史不得變更即時成員資格或待處理請求。
- **使用已宣告的介面。** OneBot 消費 [Bridge 介面](packages/core/src/bridge/bridge-interface.ts)。請重複使用套件匯出與既有的相依注入，而不是伸手取得其他負責者的狀態或建立第二個註冊表。
- **在輸入端驗證。** 使用既有的動作欄位與跨欄位驗證輔助函式。除非變更明確要求新語意，否則請保留可接受的輸入形式、回應欄位與錯誤行為。不要默默丟棄無效的輸出訊息內容。
- **保留帶號的訊息 ID。** 由 [message-id.ts](packages/onebot/src/message-id.ts) 產生的 OneBot `message_id` / `messageId` 為非零的帶號 32 位元整數；負值是有效的。動作輸入請使用 `f.messageId()`，並在儲存、回覆、查詢與結果比對過程中保留該值。協定表示必須在其邊界無損轉換；變更正負號或產生規則會改變既有的訊息身分。
- **保護已持久化的資料。** 訊息歷史與媒體中介資料是持久紀錄。不要加入自動刪除，也不要把它們當成可丟棄的快取。遷移變更需要失敗與重新啟動的覆蓋測試；讓失敗保持可見。
- **保留傳輸原則。** 保留已設定的繫結位址與存取檢查。TLS 啟動失敗不得默默降級為 HTTP。請區分已儲存的設定與實際套用到執行中配接器的變更。
- **保持型別與歸屬清晰。** 遵循嚴格的 TypeScript 設定、既有匯入風格與四空格的 TypeScript 縮排。驗證未知的外部資料，而不是用轉型或退回值掩蓋不一致。保留關於理由與非顯而易見行為的註解。
- **保持診斷安全。** 記錄外部輸入時使用既有的去識別化處理。憑證、私密金鑰、私人帳號資料與未遮蔽的擷取內容不屬於提交、fixture 或公開報告。

## 產生的檔案與相關變更

OneBot 動作定義負責驗證與目錄中介資料。每個隨附動作都會為成功的 OneBot `data` 提供 `returnsSchema`，並至少提供一個具備有效參數與任何必要識別碼來源的 `examples` 項目。串流 schema 描述個別成功訊框，而非 MCP 彙總結果。對於上游未記載的欄位請保持開放，不要自行發明結構，並明確標示不支援或佔位的行為。

變更動作名稱、參數、結果描述/schema、範例或執行模式之後：

1. 更新 `packages/onebot/src/actions` 中負責的定義及其測試。
2. 執行 `pnpm --filter @snowluma/mcp gen`。
3. 檢查並納入 `packages/mcp/src/generated/catalog.ts` 與 `catalog.json` 中的對應變更。不要手動編輯產生的目錄項目。
4. 檢查受影響的 SDK 型別與呼叫者，執行其相關測試，並執行工作區型別檢查。

`pnpm test` 也會執行 MCP 目錄產生器，並可能變更這些受版控的快照。CI 的 `node tools/check-action-catalog.mjs` 會拒絕工作區目錄差異；它是乾淨簽出時的漂移檢查，不是產生器本身。

SDK 的破壞性變更也會更新 [CHANGELOG.md](packages/sdk/CHANGELOG.md) 與 [VERSIONING.md](packages/sdk/VERSIONING.md)。WebUI 變更遵循其[互動慣例](packages/webui/README.md)。請讓面向使用者的文件與行為保持一致。

獨立 WebUI 品牌使用 [Haizakura 吉祥物](assets/readme/mascot.png) 與薰衣草色預設強調色。預設調色盤會以作用中的強調色為中性表面輕微上色，並遵循僅限側邊欄的範圍與 OLED 黑色。請讓伺服器預設值、前端預設集與掛載前 CSS 保持一致，如 [WebUI 預設外觀](packages/webui/README.md#default-appearance) 所述，同時保留使用者已儲存的選擇、具名調色盤與主機外觀疊加層。

根目錄 [README.md](README.md) 呈現專案宗旨、整體能力、快速開始與文件進入點。僅在這些概觀細節改變時更新它；新增或修正個別功能不足以在該處增設專節。功能特定的 API 用法、設定、限制與疑難排解請放在相關套件的 README 或主題文件中，並優先使用既有文件。

請編輯來源而非 `dist` 輸出。`packages/runtime/native` 中的原生產物是提供的建置輸入；不要以任意本機二進位檔替代以求建置通過。封裝變更必須保留 [Core 的建置設定](packages/core/vite.config.ts) 與[發行佈局驗證器](tools/check-release-layout.mjs) 中的檢查。

## 交接與指示維護

請回報所變更的行為、確切的驗證指令與結果，以及任何未驗證的執行環境或平台行為。公開的 PR 與提交文字請聚焦於該貢獻；省略本機環境細節與私人研究。使用 CONTRIBUTING.md 所述、以英文撰寫的 Conventional Commit 訊息。

`AGENTS.md` 是貢獻者指南的正本；`CLAUDE.md` 是指向它的相對符號連結。請只編輯本檔案一次。當套件歸屬、驗證指令或貢獻原則改變時，請在同一次變更中更新受影響的指示。連結到已簽入的來源，並讓本指南在全新複製的環境中即可使用，不依賴維護者本機的筆記、工具或絕對路徑。
