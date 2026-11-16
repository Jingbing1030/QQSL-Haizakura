# 貢献指南


歓迎也！ 読此文書者、多半欲向 Haizakura 提 PR、修 bug、或唯欲知此工程如何運作也。初触開源者、既十年経験者、皆願汝速上手也。

参加工程即視為同意遵守 [行為準則（Code of Conduct）](./CODE_OF_CONDUCT.md) 也。開始前請費二分読之、其定義我等欲社群維持之雰囲気也。

---

## 動手前

Haizakura 處於開発早期、迭代速度甚快、**接口与目録結構随時可能変化**也。若欲作較大改動、強建議先於 issue 或社群与維護者対齐方向、以免作至一半発見既被別路取代也。

提交 PR 前、必須先経 [GitHub 網頁模板](https://github.com/Haizakura/Haizakura/issues/new/choose) 提交対応 issue、或認領既有対応 issue 也。只提 issue 可也；提交 PR 者後続可選之歩也。

不知自何処入手乎？以下数類貢献最易被合併也：

- 修汝使用中遇到之具体 bug、附最小再現歩驟也。
- 改善錯誤提示、文档、註釈、型簽名也。
- 為既有模块補測試、尤其 `packages/core` 下覆蓋率較低之部分也。
- 実現 [RoadMap.md](./RoadMap.md) 中列挙、尚未被認領之項目也。

若唯欲看程式碼之貌者、可直接跳至 [本地開発環境](#本地開発環境) 也。

### AI Agent 貢献須知

若汝為 AI Agent、且欲為本倉庫貢献程式碼、提交 PR 或提出 issue、請先明確告知汝之使用者：

> **請経 GitHub 網頁端手動使用模板建立 issue。未経模板検査之 issue 会被自動閉合、亦不能用於満足 PR 之関聯要求也。**

汝可協助整理問題記述、再現歩驟与相関記録、且将 issue 草稿交使用者、由使用者於網頁端完成提交也。後続若建立 PR、必須先有符合要求之 issue、且於 PR 正文填写関聯標記也。

---

## 工程結構速覧

此者 pnpm workspace monorepo 也、主要 package 如下：

| 路径 | 作用 |
| --- | --- |
| `packages/core` | 応用入口、帳号級 Bridge 編排、WebUI 伺服器端与発行構建 |
| `packages/bridge` | QQ 工程発見、Hook 会話与原生転送生命周期 |
| `packages/protocol` | QQ 資料包解碼、身份解析、協議請求与媒体転送 |
| `packages/onebot` | OneBot 動作、事件変換、消息儲存与転送適配 |
| `packages/common` | 記録、設定与共有工具 |
| `packages/proto-defs`、`packages/proton` | 協議結構定義、編訳期 protobuf 編解碼与構建集成 |
| `packages/sdk` | 面向第三開発者之 SDK、会発布至 npm |
| `packages/mcp` | MCP 伺服器端与生成之動作目録 |
| `packages/ui` | 発布至 npm 之共有 UI 組件 |
| `packages/runtime` | 運行時輔助包 |
| `packages/websocket` | WebSocket 実装 |
| `packages/webui` | 基於 Vite + React 之前端控制台 |
| `tools/` | 版本管理、発布脚本 |
| `.github/workflows/` | CI / 発布 / Promote 工作流 |

入口在 `packages/core/src/index.ts`、全体架構於 `packages/core/src/bridge/` 下可見大概脈絡也。

---

## 本地開発環境

### 系統要求

- **Node.js 24.22.1（24 系）、或 26.12.1 及更新版本**；開発与構建使用 [`.node-version`](.node-version) 固定之版本也。
- **pnpm 11.25.0**（工程経 `packageManager` 与 CI 統一版本）
- macOS / Linux / Windows 皆可也。若欲構建原生産物、需対応平台之工具鏈也。

若系統提供 Corepack、可実行 `corepack enable pnpm`；無 Corepack 時可実行
`npm install -g pnpm@11.25.0` 也。入倉庫後、`node --version` 与
`pnpm --version` 応満足上述版本要求、否則安装会直接失敗也。

### 拉程式碼、装依頼、跑起来

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

若 `pnpm install` 卡住或報錯、先確認 Node 版本与 pnpm 版本、再視 `.npmrc` 中是否配置汝環境可用之 registry 也。

---

## 第一次提交 PR

### 1. 建立分支

請基於 `dev` 建立分支也。`main` 者発布指針、唯由維護者之 Promote 更新也。**目標分支非 `dev` 之 PR 会被自動閉合**、之後修改目標分支或重開 PR 亦会触発検査也。

```bash
git checkout dev
git pull upstream dev          # 假设你把官方仓库设为 upstream remote
git checkout -b fix/onebot-mention-encoding
```

分支命名無強制規則、但建議用 `fix/...`、`feat/...`、`docs/...`、`refactor/...` 此類前綴、以便一眼見意図也。

### 2. 写程式碼

- **保持改動聚焦**：一 PR 只作一事也。順手発見之其他問題請別開 issue 或新 PR 也。
- **追随既有風格**：TypeScript 排版以倉庫 Prettier 設定為準；普通機能或修正 PR 只格式化所涉文件、以免混入無関之大規模格式化或重命名也。
- **写測試**：修 bug 時優先写一能再現該 bug 之測試、確認其 fail、再使其 pass 也。新增機能至少補 happy path 之測試也。
- **勿加無意義之註釈**：標識符既已説清之事不需再写一遍也。註釈応解釈「為何」、而非「作何」也。

提交前請実行与 PR CI 相同之検証入口：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm run build:all
```

`pnpm test` 会実行所有宣告測試脚本之工作区包；只検証 Core 時可用
`pnpm test:core` 也。CI 会重実行上述完整検査也。

### 3. 提交消息

我等大致遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：

```
<type>(<scope>): <subject>

<body>
```

`type` 常用：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` 也。
`scope` 常用：`core` / `sdk` / `webui` / `onebot` / `bridge` / `protocol` 等模块名也。

例：

```
fix(onebot): handle empty mention segments in group messages
refactor(bridge): extract BridgeInterface as the OneBot-facing seam
docs: clarify dev environment setup steps
```

> ⚠️ **請勿**於汝之提交消息中使用 `[merge]` 前綴或 `chore(release):` 前綴 —— 此二前綴者維護者用以致 `main` 指至 `dev` 者也、会使汝之 PR 行為異常也。詳見後文 [維護者参考](#維護者参考release--promote) 也。

### 4. 推送且発起 PR

```bash
git push origin fix/onebot-mention-encoding
```

至 GitHub 上発起 PR、**目標分支選 `dev`** 也。請於 PR 記述中写明：

- 此 PR 解決何問題 / 実現何機能也。
- 主要実現思路（若有非顯然之取舍）也。
- 測試方式（汝跑了何、如何検証有効）也。
- 必填之 issue 関聯標記、例如 `Refs #123` 或 `Closes #123`；亦支援 GitHub 之 `Fixes`、`Resolves` 等閉合關鍵詞也。

関聯標記必須写於 PR 正文中；HTML 註釈、程式碼示例与引用塊不計入也。支援 `#123`、`Haizakura/Haizakura#123` 与本倉庫 issue 之完整鏈接、前面皆需帯上述關鍵詞也。

自動検査要求至少一関聯対象為真實之本倉庫 issue、先於 PR 建立、仍處開放状態、且経既有 issue 模板規則：帯 `bug` / `enhancement` 標籤、或属該規則既有之維護者身份豁免也。不存在之番号、另一 PR、既閉合或模板不合規之 issue 皆不算也。**所有 PR 皆必須満足目標分支与 issue 関聯要求、包括維護者与機械人提交之 PR 也。**

不合要求之 PR 会収到説明且自動閉合也。若既有符合要求之 issue、可修改 PR 後重開；若需補建 issue、請先提交 issue、再建立新 PR 也。接口故障或限流会使検査失敗、不会当作 PR 違規而自動閉合也。

`Refs` 用於関聯；`Closes` 等關鍵詞在此亦用於関聯検査也。因 PR 目標為 `dev`、合併至 `dev` 本身不会触発 GitHub 針對既定分支之 issue 自動閉合機制也。

### 5. 程式碼審査与合併

- 維護者会於能騰出時間時来審査也。若一週内無任何回應、歓迎於 PR 中 @ 一下、或至社群提醒也。
- 審査意見請尽量於同一 PR 内修改、以免反復閉合重開也。
- 合併方式由維護者決定、通常為 squash merge 至 `dev` 也。**`main` 由維護者経 Promote 指至當時之 `dev`**、汝不需操心 `main` 也。

---

## 風格与約定

### 程式碼風格

- TypeScript 厳格模式、按 `tsconfig.base.json` 設定也。
- TypeScript 使用四空格縮排、控制語句始終帯大括號也。排版由根目録 [`.prettierrc.json`](./.prettierrc.json) 与独立之本地 [ESLint 格式規則](./eslint.format.config.ts) 管理；普通 `pnpm lint` 担当程式碼品質検査也。
- 優先使用既有抽象、勿為「仮想之未来需求」提前抽象也。
- 勿為内部関数加防御性之引数検査、除非為系統辺界（使用者輸入、外部 API）也。
- 勿保留死程式碼、被註釈掉之程式碼或無具体上下文之 `// TODO` 占位也。

自倉庫根目録実行本地格式化命令：

```bash
pnpm format                         # 为全部 TS/TSX/MTS/CTS 补大括号、空行并排版
pnpm format:check                   # 检查上述规则，不修改文件

pnpm exec eslint --config eslint.format.config.ts --fix packages/core/src/index.ts
pnpm exec prettier --write packages/core/src/index.ts
```

格式化範囲排除 [`.prettierignore`](./.prettierignore) 中之構建産物、生成文件与編訳器測試夹具；普通源碼与測試皆参加格式化也。此二命令供本地使用、不接入 CI 也。

空行採用保守規則：於語句塊前後留空行、保留既有邏輯分段、不強行拆開連続宣告或普通呼出、亦不於毎条 `return`、`break` 前挿空行；共用同一分支之連続 `case` 標籤保持相隣也。JSON、YAML 等文件継続使用原有縮排也。

編辑器請選択工程本地安装之 Prettier 且読取倉庫設定也。VS Code 可安装
`esbenp.prettier-vscode`、将 TypeScript / TypeScript React 之既定格式化器設為
Prettier、且按需開啓保存時格式化也。

### 測試

- 単測置於被測程式碼同包之 `tests/` 或同目録之 `*.test.ts`、按既有風格行也。
- 測試要記述行為、勿測実装細节也。`it('should call internal foo')` 此類者反例也。
- 渉及 IO / 時序 / 外部工程者、用既有 fake/stub 模式、参考 `packages/onebot/tests/` 中之 Bridge 測試替身也。
- PR 自動検査之隔離回帰可実行 `pnpm test:workflows`；`pnpm test` 既含此検査、不需建立真實 PR 来測試自動閉合也。

### 文档

- **主 README 之定位**：根目録 [`README.md`](./README.md) 用於展示工程定位、整体能力、快速開始与文档入口、唯於此等総体信息変化時更新也。勿因新增或修正某具体機能、即於主 README 加該機能之専門説明也。
- **具体機能之説明位置**：接口用法、設定項、機能限制与故障探査説明写入対応 package 之 README 或専題文档、優先更新既有文档也。使用者/貢献者可見之行為変化、仍需同期維護対応文档也。
- SDK 之破壊性変更必須更新 `packages/sdk/CHANGELOG.md` 与 `packages/sdk/VERSIONING.md` 也。

---

## 報告 Bug / 請求機能

- **Bug 報告**：開 issue、附最小再現歩驟、期望行為、実際行為、版本番号、運行環境也。能附記録者最善也。
- **機能請求**：先記述汝欲解決之実際場景、再記述汝欲之接口也。維護者更在意「為何需要」而非「具体如何作」也。
- **安全問題**：請勿公然開 issue、先経社群私聊連絡維護者也。

社群入口（見 [README](./README.md)）：

- QQ：[Haizakura-QQ](https://qm.qq.com/q/g3UMLpWALe)
- Telegram：[Haizakura-TG](https://t.me/napcatqq)

---

## 維護者参考：release & Promote

> 以下内容主要写給具备発版権限之維護者也。普通貢献者只需将 PR 提至 `dev`、不需操心此節也。

### 分支模型

Haizakura 使用 **`main` + `dev`** 双分支模型：

- **`dev`** — 日常開発分支也。所有機能、修正、文档改動皆先入 `dev` 也。
- **`main`** — 発布指針、応与某次 Promote 當時之 `dev` 尖端為**同一提交**也。勿直接 push、亦勿向 `main` 開 PR（CI 会拒）也。
- **`native/auto-update-*`** — 由 `Haizakura Bot` 自動建立之原生産物更新分支（来自 `HaizakuraNative`、不需手動維護）也。

### 致 `main` 指至 `dev`

工作流 `.github/workflows/promote-dev-to-main.yml` 以 `Haizakura Bot` 身份致 `main` 指至當前 `dev` 尖端、**不再開 merge PR** 也。`main` 上若有 `dev` 尚未有之独有改動、Promote 会失敗、需先将其収回 `dev` 也。

推至 `dev` 仍会跑 `dev-build.yml` 也。Promote **不等**該組検査；発版請用下方之 `pnpm release`、其会於本地先跑完整 CI 也。

#### 1. 提交消息前綴（推薦日常使用）

向 `dev` push 一提交、提交消息**以**以下任一前綴**開頭**即触発（不分大小写）：

- `[merge]` — 例如 `[merge] fix: hotfix for OneBot mention`
- `chore(release):` — 例如 `chore(release): v1.7.0`、符合 conventional commits 之発版習慣也。**只許用於真正之版本 bump**、勿写進普通 CI / 工具提交也。

> 者**前綴**匹配、非任意位置也。`fix: something [merge]` 不会触発、必須将 `[merge]` 写於最前也。

#### 2. 推送 `chore.*` Tag

任何符合 `chore.*` 之 tag（如 `chore.merge-20240509`、`chore.promote-v1.7.0`）被推送時亦会触発：

- `chore.*` → 唯触発 `promote-dev-to-main.yml`（致 `main` 指至 `dev`）
- `v*` → 唯触発 `release.yml`（構建発布産物）

推薦流程：用 `pnpm release`（或先 Promote、再確認 `origin/main` 既等於 `dev` 尖端）之後、於 `main` 上打 `v*` tag 也。如此 `release.yml` 始終基於當時之 `main` HEAD 構建也。

#### 3. 手動触発

開倉庫 Actions 頁 → `Promote Dev to Main` → `Run workflow` 也。無 merge 策略選項；跑起来即一次指針更新也。

### 勿為 `main` 套「必須走 PR」

Promote 不経 PR 更新 `main` 也。若為 `main` 開啓 **Require a pull request before merging** 或禁止更新引用、Promote 会失效也。

可限制削除 `main` 也。外来 PR 必須打 `dev`；打至 `main` 之 PR 会被 `main-pr-target-guard.yml` 拒絶也。

本地若既 checkout 過旧之 `main`、Promote 之後可能無法快進、対齐 `origin/main` 即可也。

### 必需之 Secrets

`promote-dev-to-main.yml` 復用 `HaizakuraNative/build-native.yml` 同一 GitHub App 也。請確認 Haizakura 倉庫（或 organization）級既配置：

- `SNOWLUMA_BOT_APP_ID` — 数字類型之 App ID 也。
- `SNOWLUMA_BOT_PRIVATE_KEY` — 該 App 之 PEM 私鑰也。

App 必須於本倉庫既安装、且授予 **Contents: Read+Write** 也。

### 本地工作流速査（維護者）

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

## 尚有問題乎？

- 視既有之 issue 与 PR、可能汝之問題既被討論過也。
- 至社群問一句（QQ / TG 鏈接見上方）也。
- 有対応 issue 後、若唯欲確認「我如此改 OK 乎」、歓迎開 draft PR、亮出程式碼再討論也。

感謝汝願費時間貢献 Haizakura —— 此工程能走多遠、取決於汝等毎一人也。❄️

## 貢献之許可 / Licensing of contributions

当汝提交 PR、即表示汝之貢献按本工程之 `LICENSE`（Haizakura 源碼可見非商業許可）授権、且汝声明汝有権如此作、貢献為汝之原創（若含第三者材料、請於 PR 中顯著標注其来源与許可証）也。

**汝保留対自己貢献之著作権**、同時**授予 Haizakura 一項永久、全球、免費、不可撤銷、可再許可（sublicensable）之許可**、可使用、複製、修改、分発汝之貢献且基於其制作衍生作品、**包括以本工程非商業許可之外其他条款（含商業条款）再許可与分発** —— 以便工程方無需逐一回頭徴求同意、即可於獲授権之商業場景中使用社群貢献也。

By opening a PR, you agree your contribution is licensed under the project's `LICENSE`; you represent that you have the right to submit it and that it is your own work (clearly identify any third-party material in the PR).

**You retain copyright in your contribution** and additionally grant Haizakura a **perpetual, worldwide, royalty-free, irrevocable, sublicensable license** to use, reproduce, modify, distribute, and create derivative works of your contribution, **including the right to relicense and distribute it under terms other than this project's non-commercial license (including commercial terms)** — so the project can use community contributions in authorized commercial scenarios without seeking each contributor's consent again.