# 貢獻指南


歡迎！如果你正在閱讀這份文件，多半是因為你想給 Haizakura 提一個 PR、修一個 bug，或者只是想了解這個專案是怎麼運作的。無論你是第一次接觸開源、還是已經有十年經驗，我們都希望讓你盡快上手。

參與專案即視為你同意遵守[行為準則（Code of Conduct）](./CODE_OF_CONDUCT.md)。在開始之前請花兩分鐘讀一下，它定義了我們希望社群維持的氛圍。

---

## 在動手之前

Haizakura 處於開發早期，迭代速度很快，**介面與目錄結構隨時可能變化**。如果你打算做較大的改動，強烈建議先在 issue 或者社群裡和維護者對齊一下方向，避免做了一半發現已經被另一條路取代。

提交 PR 前，必須先透過 [GitHub 網頁範本](https://github.com/Haizakura/Haizakura/issues/new/choose) 提交對應 issue，或認領已有的對應 issue。可以只提 issue；提交 PR 是選用的後續步驟。

不知道從哪裡入手？以下幾類貢獻最容易被合併：

- 修正你在使用中遇到的具體 bug，附最小重現步驟。
- 改善錯誤提示、文件、註解、型別簽章。
- 給已有模組補測試，尤其是 `packages/core` 下覆蓋率較低的部分。
- 實作 [RoadMap.md](./RoadMap.md) 中列出、還沒被認領的項目。

如果你只是想看看程式碼長什麼樣，可以直接跳到[本機開發環境](#本機開發環境)。

### AI Agent 貢獻須知

如果你是 AI Agent，並準備為本儲存庫貢獻程式碼、提交 PR 或提出 issue，請先明確告知你的使用者：

> **請透過 GitHub 網頁端手動使用範本建立 issue。未通過範本檢查的 issue 會被自動關閉，也不能用於滿足 PR 的關聯要求。**

你可以協助整理問題描述、重現步驟和相關日誌，並將 issue 草稿交給使用者，由使用者在網頁端完成提交。後續若建立 PR，必須先有符合要求的 issue，並在 PR 正文填寫關聯標記。

---

## 專案結構速覽

這是一個 pnpm workspace monorepo，主要 package 如下：

| 路徑 | 作用 |
| --- | --- |
| `packages/core` | 應用程式進入點、帳號級 Bridge 編排、WebUI 伺服器端與發行建置 |
| `packages/bridge` | QQ 行程探索、Hook 會話與原生傳輸生命週期 |
| `packages/protocol` | QQ 資料封包解碼、身分解析、協定請求與媒體傳輸 |
| `packages/onebot` | OneBot 動作、事件轉換、訊息儲存與傳輸配接 |
| `packages/common` | 日誌、設定與共享工具 |
| `packages/proto-defs`、`packages/proton` | 協定結構定義、編譯期 protobuf 編解碼與建置整合 |
| `packages/sdk` | 面向第三方開發者的 SDK，會發布到 npm |
| `packages/mcp` | MCP 伺服器端與產生的動作目錄 |
| `packages/ui` | 發布到 npm 的共享 UI 元件 |
| `packages/runtime` | 執行環境輔助套件 |
| `packages/websocket` | WebSocket 實作 |
| `packages/webui` | 基於 Vite + React 的前端主控台 |
| `tools/` | 版本管理、發布指令碼 |
| `.github/workflows/` | CI / 發布 / Promote 工作流程 |

進入點在 `packages/core/src/index.ts`，整體架構在 `packages/core/src/bridge/` 下能看出大致脈絡。

---

## 本機開發環境

### 系統需求

- **Node.js 24.22.1（24 系列），或 26.12.1 及更新版本**；開發和建置使用 [`.node-version`](.node-version) 固定的版本。
- **pnpm 11.25.0**（專案透過 `packageManager` 與 CI 統一版本）
- macOS / Linux / Windows 均可。如果要建置原生產物，需要對應平台的工具鏈。

如果系統提供 Corepack，可執行 `corepack enable pnpm`；沒有 Corepack 時可執行
`npm install -g pnpm@11.25.0`。進入儲存庫後，`node --version` 與
`pnpm --version` 應滿足上述版本要求，否則安裝會直接失敗。

### 拉程式碼、裝相依、跑起來

```bash
git clone https://github.com/<你的用户名>/Haizakura.git
cd Haizakura

git checkout dev

pnpm install --frozen-lockfile

pnpm typecheck

pnpm test

pnpm dev          # core
pnpm dev:web      # webui
```

如果 `pnpm install` 卡住或報錯，先確認 Node 版本和 pnpm 版本，再看 `.npmrc` 裡是否設定了你環境下可用的 registry。

---

## 第一次提交 PR

### 1. 建立分支

請基於 `dev` 建立分支。`main` 是發布指標，只由維護者的 Promote 更新。**目標分支不是 `dev` 的 PR 會被自動關閉**，之後修改目標分支或重新開啟 PR 也會觸發檢查。

```bash
git checkout dev
git pull upstream dev          # 假设你把官方仓库设为 upstream remote
git checkout -b fix/onebot-mention-encoding
```

分支命名沒有強制規則，但建議用 `fix/...`、`feat/...`、`docs/...`、`refactor/...` 這種前綴，便於一眼看出意圖。

### 2. 寫程式碼

- **保持改動聚焦**：一個 PR 只做一件事。順手發現的其他問題請單獨開 issue 或新 PR。
- **跟隨既有風格**：TypeScript 排版以儲存庫 Prettier 設定為準；一般功能或修正 PR 只格式化涉及的文件，避免混入無關的大規模格式化或重新命名。
- **寫測試**：修 bug 時優先寫一個能重現該 bug 的測試，確認它會 fail，再讓它 pass。新增功能至少補上 happy path 的測試。
- **不要加入無意義的註解**：識別字已經說清楚的事情不需要再寫一遍。註解應當解釋「為什麼」，而不是「做了什麼」。

提交之前請執行與 PR CI 相同的驗證入口：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm run build:all
```

`pnpm test` 會執行所有宣告了測試指令碼的工作區套件；只驗證 Core 時可使用
`pnpm test:core`。CI 會重新執行上述完整檢查。

### 3. 提交訊息

我們大致遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：

```
<type>(<scope>): <subject>

<body>
```

`type` 常用：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`。
`scope` 常用：`core` / `sdk` / `webui` / `onebot` / `bridge` / `protocol` 等模組名。

範例：

```
fix(onebot): handle empty mention segments in group messages
refactor(bridge): extract BridgeInterface as the OneBot-facing seam
docs: clarify dev environment setup steps
```

> ⚠️ **請不要**在你的提交訊息裡使用 `[merge]` 前綴或 `chore(release):` 前綴 —— 這兩個前綴是維護者用來把 `main` 指到 `dev` 的，會讓你的 PR 行為異常。詳見後文[維護者參考](#維護者參考release--promote)。

### 4. 推送並發起 PR

```bash
git push origin fix/onebot-mention-encoding
```

到 GitHub 上發起 PR，**目標分支選 `dev`**。請在 PR 描述裡寫明：

- 這個 PR 解決什麼問題 / 實作什麼功能。
- 主要的實作思路（如果有非顯然的取捨）。
- 測試方式（你跑了什麼、怎麼驗證有效）。
- 必填的 issue 關聯標記，例如 `Refs #123` 或 `Closes #123`；也支援 GitHub 的 `Fixes`、`Resolves` 等關閉關鍵詞。

關聯標記必須寫在 PR 正文中；HTML 註解、程式碼範例和引用區塊不計入。支援 `#123`、`Haizakura/Haizakura#123` 和本儲存庫 issue 的完整連結，前面均需帶上述關鍵詞。

自動檢查要求至少一個關聯對象是真實的本儲存庫 issue，先於 PR 建立、仍處於開放狀態，並通過現行 issue 範本規則：帶有 `bug` / `enhancement` 標籤，或屬於該規則已有的維護者身分豁免。不存在的編號、另一個 PR、已關閉或範本不合規的 issue 都不算。**所有 PR 都必須滿足目標分支和 issue 關聯要求，包括維護者與機器人提交的 PR。**

不符合要求的 PR 會收到說明並自動關閉。若已有符合要求的 issue，可修改 PR 後重新開啟；若需補建 issue，請先提交 issue，再建立新的 PR。介面故障或限流會讓檢查失敗，不會被當成 PR 違規而自動關閉。

`Refs` 用於關聯；`Closes` 等關鍵詞在這裡也用於關聯檢查。由於 PR 目標為 `dev`，合併到 `dev` 本身不會觸發 GitHub 針對預設分支的 issue 自動關閉機制。

### 5. Code Review 與合併

- 維護者會在能騰出時間時來 review。如果一週內沒有任何回應，歡迎在 PR 裡 @ 一下，或者去社群裡提醒。
- review 意見請盡量在同一個 PR 內修改，避免反覆關閉重開。
- 合併方式由維護者決定，通常是 squash merge 到 `dev`。**`main` 由維護者透過 Promote 指到當時的 `dev`**，你不需要操心 `main`。

---

## 風格與慣例

### 程式碼風格

- TypeScript 嚴格模式，按 `tsconfig.base.json` 設定。
- TypeScript 使用四空格縮排，控制語句始終帶大括號。排版由根目錄 [`.prettierrc.json`](./.prettierrc.json) 和獨立的本地 [ESLint 格式規則](./eslint.format.config.ts) 管理；一般 `pnpm lint` 負責程式碼品質檢查。
- 優先使用現有抽象，不要為「假想的未來需求」提前抽象。
- 不要給內部函式加防禦性的參數驗證，除非是系統邊界（使用者輸入、外部 API）。
- 不要保留死程式碼、被註解掉的程式碼或者 `// TODO` 沒有具體脈絡的佔位。

從儲存庫根目錄執行本地格式化指令：

```bash
pnpm format                         # 为全部 TS/TSX/MTS/CTS 补大括号、空行并排版
pnpm format:check                   # 检查上述规则，不修改文件

pnpm exec eslint --config eslint.format.config.ts --fix packages/core/src/index.ts
pnpm exec prettier --write packages/core/src/index.ts
```

格式化範圍排除 [`.prettierignore`](./.prettierignore) 中的建置產物、產生檔案和編譯器測試 fixture；一般原始碼與測試都參與格式化。這兩個指令供本地使用，不接入 CI。

空行採用保守規則：在語句區塊前後留空行，保留已有邏輯分段，不強行拆開連續宣告或一般呼叫，也不在每條 `return`、`break` 前插空行；共用同一分支的連續 `case` 標籤保持相鄰。JSON、YAML 等檔案繼續使用原有縮排。

編輯器請選擇專案本地安裝的 Prettier 並讀取儲存庫設定。VS Code 可安裝
`esbenp.prettier-vscode`，將 TypeScript / TypeScript React 的預設格式化器設為
Prettier，並按需開啟儲存時格式化。

### 測試

- 單元測試放在被測程式碼同套件的 `tests/` 或同目錄的 `*.test.ts`，按既有風格走。
- 測試要描述行為，不要測實作細節。`it('should call internal foo')` 這種是反例。
- 涉及 IO / 時序 / 外部行程的，用現有的 fake/stub 模式，參考 `packages/onebot/tests/` 中的 Bridge 測試替身。
- PR 自動檢查的隔離回歸可執行 `pnpm test:workflows`；`pnpm test` 已包含此檢查，不需要建立真實 PR 來測試自動關閉。

### 文件

- **主 README 的定位**：根目錄 [`README.md`](./README.md) 用於展示專案定位、整體能力、快速開始與文件入口，僅在這些總體資訊發生變化時更新。不要因為新增或修正某個具體功能，就在主 README 增加該功能的專門說明。
- **具體功能的說明位置**：介面用法、設定項、功能限制和排障說明寫入對應 package 的 README 或專題文件，優先更新已有文件。使用者/貢獻者可見的行為變化，仍需同步維護對應文件。
- SDK 的破壞性變更必須更新 `packages/sdk/CHANGELOG.md` 和 `packages/sdk/VERSIONING.md`。

---

## 回報 Bug / 請求功能

- **Bug 回報**：開 issue，附最小重現步驟、預期行為、實際行為、版本號、執行環境。能附上日誌最好。
- **功能請求**：先描述你想解決的實際情境，再描述你想要的介面。維護者更在意「為什麼需要」而不是「具體怎麼做」。
- **安全問題**：請勿公開發 issue，先透過社群私訊聯絡維護者。

社群入口（見 [README](./README.md)）：

- QQ：[Haizakura-QQ](https://qm.qq.com/q/g3UMLpWALe)
- Telegram：[Haizakura-TG](https://t.me/napcatqq)

---

## 維護者參考：release & Promote

> 以下內容主要寫給具備發行權限的維護者。一般貢獻者只需要把 PR 提到 `dev`，不需要關心這一節。

### 分支模型

Haizakura 使用 **`main` + `dev`** 雙分支模型：

- **`dev`** —— 日常開發分支。所有功能、修正、文件變更都先進入 `dev`。
- **`main`** —— 發布指標，應與某次 Promote 當時的 `dev` 尖端是**同一個提交**。不要直接 push，也不要往 `main` 開 PR（CI 會拒）。
- **`native/auto-update-*`** —— 由 `Haizakura Bot` 自動建立的原生產物更新分支（來自 `HaizakuraNative`，不需要手動維護）。

### 把 `main` 指到 `dev`

工作流程 `.github/workflows/promote-dev-to-main.yml` 以 `Haizakura Bot` 身分把 `main` 指到目前 `dev` 尖端，**不再開 merge PR**。`main` 上若有 `dev` 還沒有的獨有改動，Promote 會失敗，需要先把那些改動收回 `dev`。

推到 `dev` 仍會跑 `dev-build.yml`。Promote **不等**那組檢查；發版請用下面的 `pnpm release`，它會在本地先跑完整 CI。

#### 1. 提交訊息前綴（推薦日常使用）

向 `dev` push 一個提交，提交訊息**以**以下任一前綴**開頭**即觸發（不分大小寫）：

- `[merge]` —— 例如 `[merge] fix: hotfix for OneBot mention`
- `chore(release):` —— 例如 `chore(release): v1.7.0`，符合 conventional commits 的發版習慣。**只許用在真正的版本 bump**，不要寫進一般 CI / 工具提交。

> 是**前綴**比對，不是任意位置。`fix: something [merge]` 不會觸發，必須把 `[merge]` 寫在最前面。

#### 2. 推送 `chore.*` Tag

任何符合 `chore.*` 的 tag（如 `chore.merge-20240509`、`chore.promote-v1.7.0`）被推送時也會觸發：

- `chore.*` → 僅觸發 `promote-dev-to-main.yml`（把 `main` 指到 `dev`）
- `v*` → 僅觸發 `release.yml`（建置發布產物）

推薦流程：用 `pnpm release`（或先 Promote，再確認 `origin/main` 已等於 `dev` 尖端）之後，在 `main` 上打 `v*` tag。這樣 `release.yml` 始終基於當時的 `main` HEAD 建置。

#### 3. 手動觸發

開啟儲存庫 Actions 頁面 → `Promote Dev to Main` → `Run workflow`。沒有 merge 策略選項；跑起來就是一次指標更新。

### 不要給 `main` 套「必須走 PR」

Promote 不透過 PR 更新 `main`。如果給 `main` 開啟 **Require a pull request before merging** 或禁止更新參照，Promote 會失效。

可以限制刪除 `main`。外來 PR 必須打 `dev`；打到 `main` 的 PR 會被 `main-pr-target-guard.yml` 拒絕。

本地若已經 checkout 過舊的 `main`，Promote 之後可能無法快進，對齊 `origin/main` 即可。

### 必需的 Secrets

`promote-dev-to-main.yml` 重用 `HaizakuraNative/build-native.yml` 同一個 GitHub App。請確認 Haizakura 儲存庫（或 organization）層級已經設定：

- `SNOWLUMA_BOT_APP_ID` —— 數字型別的 App ID。
- `SNOWLUMA_BOT_PRIVATE_KEY` —— 該 App 的 PEM 私密金鑰。

App 必須在本儲存庫已安裝，且授予 **Contents: Read+Write**。

### 本地工作流程速查（維護者）

```bash
pnpm release 1.7.0

git commit -m "chore(release): v1.7.0"     # 或 "[merge] fix: hotfix"
git push                                    # → 触发 promote-dev-to-main

git tag chore.merge-20240509
git push origin chore.merge-20240509        # → 触发 promote-dev-to-main

git fetch origin
git switch main
git merge --ff-only origin/main             # 对不齐就 reset 到 origin/main
git tag v1.7.0
git push origin v1.7.0                      # → 仅触发 release.yml
```

---

## 還有問題？

- 看一下已有的 issue 和 PR，可能你的問題已經被討論過。
- 去社群問一句（QQ / TG 連結見上方）。
- 有對應 issue 後，如果只是想確認「我這麼改 OK 嗎」，歡迎開 draft PR，把程式碼亮出來再討論。

感謝你願意花時間貢獻 Haizakura —— 這個專案能走多遠，取決於你們每一個人。❄️

## 貢獻的授權 / Licensing of contributions

當你提交 PR，即表示你的貢獻按本專案的 `LICENSE`（Haizakura 原始碼可見非商業授權）授權，且你聲明你有權這麼做、貢獻為你的原創（若含第三方材料，請在 PR 中顯著標註其來源與授權條款）。

**你保留對自己貢獻的著作權**，同時**授予 Haizakura 一項永久、全球、免費、不可撤銷、可再授權（sublicensable）的授權**，可使用、複製、修改、散布你的貢獻並基於其製作衍生作品，**包括以本專案非商業授權之外的其他條款（含商業條款）再授權與散布** —— 以便專案方無需逐一回頭徵求同意，即可在獲授權的商業情境中使用社群貢獻。

By opening a PR, you agree your contribution is licensed under the project's `LICENSE`; you represent that you have the right to submit it and that it is your own work (clearly identify any third-party material in the PR).

**You retain copyright in your contribution** and additionally grant Haizakura a **perpetual, worldwide, royalty-free, irrevocable, sublicensable license** to use, reproduce, modify, distribute, and create derivative works of your contribution, **including the right to relicense and distribute it under terms other than this project's non-commercial license (including commercial terms)** — so the project can use community contributions in authorized commercial scenarios without seeking each contributor's consent again.
