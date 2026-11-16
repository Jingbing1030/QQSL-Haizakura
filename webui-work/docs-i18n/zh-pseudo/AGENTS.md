# Haizakura 之作業


Haizakura 者 QQ 客端会話 OneBot v11 之動作与事件変換也、且備 WebUI、TypeScript SDK 与 MCP 伺服器。此者協議運行時也；機械人工作流与応答邏輯者利用側所属也。本指南者貢献者及其編碼代理向也。

## 変更前

- 貢献要件者 [CONTRIBUTING.md](CONTRIBUTING.md)、社群期待者 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、貢献与再配布条件者 LICENSE 参照也。
- **若汝為 AI 代理、請明示告知利用者、経 [GitHub 網頁表単](https://github.com/Haizakura/Haizakura/issues/new/choose) 手動作成 issue 也。不合模板政策之 issue 者自動閉鎖、且不能取得 PR 之資格也。** 為利用者提交、準備 issue 草稿也。参照 CONTRIBUTING.md 之 AI 代理通知。
- `git status` 確認、且無関係之作業保持也。編輯前、受影響之実装与隣接試験読取也。新機能、公開挙動変更、遷移者実装前合意也。
- PR 者 `dev` 向也；他分岐向之 PR 者自動閉鎖也。`main` 者発行指標也。発行命令、標籤、`[merge]` 与 `chore(release):` 之提交前綴者維護者発行工作流所属、非通常貢献也。
- PR 開前、相当之 issue 作成或特定也。issue 起票後、PR 者任意也。維護者与機械人 PR 含、一切 PR 者、評論、程式碼例、引用塊之外側、`Refs #number` 或 `Closes #number` 等閉鎖關鍵詞含必要也。少亦一之参照者、本倉庫未閉鎖之 issue 指、PR 前作成、且既存 issue 模板政策適合必要也。適格 issue 無之 PR 者自動閉鎖也。対応形式与修正手順者 [PR 提出規則](CONTRIBUTING.md#4-推送并发起-pr) 参照也。

## 倉庫地図

此者 pnpm 工作空間也。目録名較包之責務範囲、後者重要也：

| 場所 | 責務 |
| --- | --- |
| `packages/core` | 応用入口、帳号毎 Bridge 編排、WebUI 後端、通知、発行組立 |
| `packages/bridge` | QQ 工程発見、本地帳号／登録検出、Hook 会話、原生伝送生命週期 |
| `packages/protocol` | 包解碼、型付 QQ 事件、標識解決、協議請求与媒体転送 |
| `packages/onebot` | 動作検証与分派、事件変換、消息保存、HTTP/WebSocket 適配器 |
| `packages/common` | 業務依存無之共有記録、設定与工具 |
| `packages/sqlite` | 非同期 SQLite 外観、原生載入器、prebuild 選択与 Vite 発行資産 |
| `packages/proto-defs` | 型付協議模式 |
| `packages/proton` | 編譯時 protobuf 編解碼与建構統合 |
| `packages/websocket` | WebSocket 実装与原生結合統合 |
| `packages/runtime` | 配布清単、起動器与供給之原生産物 |
| `packages/webui` | Vite/React 管理控制台；工作空間名者 `webui` |
| `packages/sdk` | 公開 TypeScript 客端 |
| `packages/mcp` | MCP 伺服器与生成之動作目録 |
| `packages/ui` | 公開 UI 組件包 |
| `tools`、`.github/workflows` | 検証、打包与発行自動化 |

`packages/bridge` 者工程接続所有也；帳号級 Bridge 者 `packages/core/src/bridge` 在也。両者之構成追跡者 [応用入口](packages/core/src/index.ts) 自開始也。

[入口点](packages/core/src/index.ts) 者、運行時服務起動前、保留中之更新適用也。[更新器](packages/core/src/update) 者暫置与置換所有；[Core 之建構設定](packages/core/vite.config.ts) 者其建構出力与運行時資産自発行清単生成也。Core 者一包保持、原生庫者遅延載入、故起動時中断之更新復旧後、原生文件開可能也。

応用版本者根 `package.json` 自 `@snowluma/common/version` 経由取得也。工作空間清単更新者 `pnpm bump <version>` 使用、根版本編輯後之同期者 `pnpm bump` 使用也。
応用版本検証与比較者 `@snowluma/common/semver` 使用也。版本者正規 SemVer 必要也；GitHub 之 `v` 標籤前綴者僅 API 境界剥離也。

路径変更前、該当所有者読取也：

| 変更 | 自此開始 |
| --- | --- |
| 接続或帳号生命週期 | [Hook 管理器](packages/bridge/src/hook-manager.ts)、[Bridge 管理器](packages/core/src/bridge/manager.ts)、[OneBot 実例](packages/onebot/src/instance.ts) |
| QQ 工程何帳号登録中 | [帳号検出](packages/bridge/src/qq-account/detect.ts)、[login.db 読取器](packages/bridge/src/qq-account/login-db.ts)、[QQ 資料路径](packages/bridge/src/qq-account/paths.ts) |
| 受信 QQ 事件或標識 | [包管道](packages/protocol/src/packet-pipeline.ts)、[消息解碼器](packages/protocol/src/msg-push/index.ts)、[標識服務](packages/protocol/src/identity-service.ts) |
| OneBot 動作或消息段 | [動作定義](packages/onebot/src/actions/index.ts)、[検証助手](packages/onebot/src/action-kit.ts)、[事件変換](packages/onebot/src/event-converter/index.ts) |
| WebUI | [互動規約](packages/webui/README.md)、`packages/webui/src`、`packages/core/src/webui` |
| SDK 或 MCP | [SDK 指南](packages/sdk/README.md)、[SDK 版本管理](packages/sdk/VERSIONING.md)、[MCP 指南](packages/mcp/README.md) |
| 協議編解碼生成 | [Proton 指南](packages/proton/README.md)、受影響包之 `vitest.config.ts` |

## 設置与検証

[.node-version](.node-version) 之 Node 版本与 [package.json](package.json) 之 pnpm 版本使用也。`pnpm install --frozen-lockfile` 依設置、依依存変更除之外、既存 lockfile 保持也。

Node 安全基準者 `^24.22.1 || >=26.12.1` 也；旧 24.x 発行、25.x 与未修補 26.x 発行者非対応也。工作空間 `engines.node` 宣言与 [起動器前置検査](packages/runtime/check-node-version.cjs) 整合也。CI 与同梱発行者 `.node-version` 使用也；僅此固定点上昇、既存設置之運行時不昇級也。

命令者倉庫根自実行也：

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

TypeScript 格式者根 [Prettier 設定](.prettierrc.json)、[本地 ESLint 格式規則](eslint.format.config.ts) 与 [無視清単](.prettierignore) 使用也。TS/TSX/MTS/CTS 全文件者 `pnpm format`、読取専用之検査者 `pnpm format:check` 使用也。選択文件者、`pnpm exec eslint --config eslint.format.config.ts --fix <paths>` 実行、続 `pnpm exec prettier --write <paths>` 実行也。此等命令者、四空格縮排、制御文本体之波括弧、文塊周囲之空行強制、且其他論理空白保持也。此等者 CI 及其程式碼品質 lint 規則与別也。生成目録与編譯器固定件者其源格式保持也。

反復中者焦点限定之試験使用也。程式碼変更引渡前、CONTRIBUTING.md 要求之完全検査実行、且実行不能之物報告也。[PR CI](.github/workflows/ci.yml) 者参照也；`pnpm run ci` 者依存設置与生成目録検査含、其命令本地再現也。

- **文档専用之変更：** 連結、路径、命令与 `git diff --check` 検証也；運行時試験者散文不検証也。
- **共有型或動作：** 挙動試験加之、工作空間型検査実行也。Vitest 通過者型正確性不証明也。
- **SDK 打包：** SDK 之 `NodeNext` 建構与明示 `.js` 相対導入（型専用輸出含）保持也。其包試験者新出力編譯、原生 Node.js 導入、利用側宣言与動作地図完全網羅検査也。SDK 動作目録者 OneBot 実行可能名一致必要也；`packages/onebot/tests/sdk-actions.test.ts` 者伺服器程式碼之運行時依存追加無、此検査也。SDK 参數／結果契約者伺服器型自独立保持也；利用側例者 `packages/sdk/tests/fixtures` 在、`packages/onebot/tests/sdk-action-params.test.ts` 之伺服器解析検査整合也。
- **SDK 流：** 単一応答客端方法保持、文件転送者 [STREAMING.md](packages/sdk/STREAMING.md) 之追加性接口使用也。SDK 中、分幀、取消、有界緩衝与未完了転送試験也；`packages/onebot/tests/sdk-streaming.test.ts` 者 QQ 無、仮保存中実際適配器／処理器往復検査也。
- **SDK 反向 WebSocket：** Node 専用之聴取器者 OneBot 実装接続受也、送信方向 SDK 客端者協議実装之代用不可也。動作／事件／流者共有客端会話再利用、且帳号毎標識、API 与事件対応、有界緩衝、断線時保留請求拒絶保持也。実際運行時之反向適配器与新公開導入試験也；[REVERSE_WEBSOCKET.md](packages/sdk/REVERSE_WEBSOCKET.md) 参照也。
- **SDK 消息：** [MESSAGING.md](packages/sdk/MESSAGING.md) 之助手拡張時、既存文字列路径与普通応答語義保持也。文件系統接続者僅任意 `@snowluma/sdk/node` 入口所属也。媒体送信者上伝完了待、且自動重試無、失敗上下文保持必要也；事件等待者公開中間件分派従、且一切結果依聴取器解放也。更豊之 SDK 生成上下文追加時、従来処理器／上下文型者代入可能状態保持也。
- **MCP 代理：** 工具拡張時、既存文本結果、業務錯誤包封、既定検索対照与模式閘門保持也。伺服器 SDK 之 `serveStdio` 入口使用、同一命令自現代的発見与従来初期化両方対応也；両方者新編譯出力依試験也。緩存提示者僅同梱目録発見所属、実行或帳号資料所属非也。追跡元資料者動作参數入勿、機密資料者診断入勿也。協議互換性、追跡与追加性代理機能者 [AGENT_FEATURES.md](packages/mcp/AGENT_FEATURES.md) 記述也。試験中者分離之 HTTP 与 MCP 伝送使用也；本地運行時検査者稼働中帳号問合不可也。
- **MCP 実行服務：** 背景任務与事件接続者選択加入保持也。副作用前任務状態永続化、中断之書込再生勿、且停止時協議排出前永続清掃完了也。入力継続者元引数保持、且最多一回実行必要也。事件緩衝者明示帳号結合、有界保存与可見欠落必要也。同梱消息預覧者 `packages/mcp/scripts/build-message-app.mjs` 依建構也；預覧載入者消息送信不可也。分離伝送使用、編譯済 CLI 含、再起動、取消与従来互換性試験也。
- **協議編解碼：** 試験中既存 Proton 統合保持、故本番同一変換行使可能也。実際実装導入也；試験中演算法複製勿也。
- **動画上伝：** [HIGHWAY_UPLOADS.md](packages/protocol/HIGHWAY_UPLOADS.md) 之単一接続既定与追加性全域設定保持也。並列塊選択加入者僅動画本体也。完了前一切塊確認、且並列度与先読両方制限、且源閉前未完了読取与請求排出也。重試者有界保持、背圧変更可見也。実際上伝器分離伝送依試験也；試験通過者実回線吞吐不証明也。
- **Highway 上伝復旧：** 一切塊与工作者者一之文件転送期限共有也。節点観測者有界短命、且帳号会話、上伝類別、完全 host/port 依分離也；僅当前伺服器供給之候補選択也。検証済確認応答而已成功確定也。終端失敗報告保持、且取消後保留文件読取排出也。期限清掃与候補循環者、実際回環 socket 含分離伝送依試験也；[上伝政策](packages/protocol/HIGHWAY_UPLOADS.md#upload-timeouts-and-node-selection) 参照也。
- **原生覆蓋：** `pnpm test:native` 者既定協議試験与別、且互換性有之原生産物必要也。産物欠落或利用不能目標者報告之限制也、非検査迂回之許可也。
- **OneBot SSE：** HTTP 事件流者 HTTP 適配器之結合与認証共有也。[HTTP_SSE.md](packages/onebot/HTTP_SSE.md) 記述之帳号分離、有界再放、可見期限切 cursor 錯誤、報告過濾与低速読取限制保持也。token／報告政策変更者既存流取消、且再放無効化也；接続有効状態之停止与再載入試験也。
- **実 QQ 挙動：** 固定件試験与 API 成功応答者、配送或客端描画不証明也。本地試験済内容与、実客端尚必要内容明示也。

`pnpm dev` 者 Core 起動、且本地 QQ 工程接続可能也；運行時試験意図時僅使用也。`pnpm dev:web` 者前端起動、WebUI 後端期待也。不必要稼働帳号起動而非、分離作業者既存試験仮件従也。

WebUI 配備目標者可逆表示覆層使用也。変更前 [主機外観契約](packages/webui/INTEGRATIONS.md) 読取也。目標検証者 `@snowluma/common/webui-target` 在、実装者前端目標登記在、保存設定者有効外観与別保持也。既定配備者目標資産或主機聴取器載入不可也；業務頁中目標名分岐入勿也。

## 実装規則

- **原因修復。** 失敗者其所有層依再現、且観測可能挙動対之回帰試験追加也。帳号固有、文件名固有或例固有之修補避也。
- **錯誤観測可能化。** 例外者空結果或成功応答変換勿也。錯誤上下文保持、且重要遷移与失敗者共有記録器使用也。証拠不十分場合者、焦点限定診断追加、且不明残点記述也。
- **帳号分離保持。** 標識、消息保存与会話状態者各自帳号所属也。生命週期程式碼変更時、破棄順序与進行中作業之扱保持也。
- **解析副作用分離。** QQ 解碼器与 OneBot 事件変換器者資料変換也。実時状態更新者其所有管道或服務所属也；履歴読取者実時成員或保留請求変更不能也。
- **宣言済接口使用。** OneBot 者 [Bridge 接口](packages/core/src/bridge/bridge-interface.ts) 消費也。他所有者之状態伸手、或第二登記構築而非、包輸出与既存依存注入再利用也。
- **輸入検証。** 既存動作字段検証与字段間検証助手使用也。変更新語義明示要求除之外、受入輸入形式、応答字段与錯誤挙動保持也。無効送信消息内容黙棄勿也。
- **符号付消息 ID 保持。** [message-id.ts](packages/onebot/src/message-id.ts) 生成之 OneBot `message_id` / `messageId` 者非零符号付 32 位整数也、負値亦合法也。動作輸入者 `f.messageId()` 使用、且保存、応答、検索与結果照合経由値保持也。協議表現者其境界可逆変換必要也；符号或生成規則変更者既存消息同一性変更也。
- **永続資料保護。** 消息履歴与媒体元資料者永続記録也。自動削除追加、或当為捨棄可能之緩存扱、皆不可也。遷移変更者失敗与再起動覆蓋必要也；失敗者可視残留保持也。
- **伝送政策保持。** 設定済接続地址与接続検査維持也。TLS 起動失敗者黙 HTTP 降級不可也。保存設定与稼働適配器実際適用之変更区別也。
- **型与所有権明確保持。** 厳格 TypeScript 設定、既存導入風格与四空格 TypeScript 縮排従也。不一致者 cast 或 fallback 値隠而非、未知外部資料検証也。理由与非自明挙動之評論残也。
- **診断安全保持。** 外部輸入記録時既存無害化使用也。憑証、秘密鍵、私密帳号資料与未編輯捕獲者提交、固定件或公開報告含不可也。

## 生成文件与関連変更

OneBot 動作定義者検証与目録元資料所有也。同梱各動作者、成功 OneBot `data` 対之 `returnsSchema` 与、有効参數及必要標識源含之少亦一 `examples` 条目提供也。流模式者 MCP 集約結果而非、個別成功幀記述也。未文档化上流字段者結構発明而非開放保持、且未対応或占位挙動明示標示也。

動作名、参數、結果説明／模式、例或実行模式変更後：

1. `packages/onebot/src/actions` 之所有定義与其試験更新也。
2. `pnpm --filter @snowluma/mcp gen` 実行也。
3. `packages/mcp/src/generated/catalog.ts` 与 `catalog.json` 之相当変更検査且包含也。生成目録条目者手動編輯勿也。
4. 受影響 SDK 型与呼出元検査、其関連試験実行、且工作空間型検査実行也。

`pnpm test` 者 MCP 目録生成器亦実行、故此等追跡対象 snapshot 変化可能性有也。CI 之 `node tools/check-action-catalog.mjs` 者作業樹目録差分拒絶也；此者清浄 checkout 之漂移検査、非生成器自身也。

SDK 破壊的変更者亦 [CHANGELOG.md](packages/sdk/CHANGELOG.md) 与 [VERSIONING.md](packages/sdk/VERSIONING.md) 更新也。WebUI 変更者其 [互動規約](packages/webui/README.md) 従也。利用者向文档者挙動整合保持也。

単独 WebUI 品牌者 [Haizakura 吉祥物](assets/readme/mascot.png) 与薄紫既定主色使用也。既定配色者中立表面有効主色依淡着色、側欄限定範囲与 OLED 黒尊重也。[WebUI 既定外観](packages/webui/README.md#default-appearance) 記述之通、伺服器既定、前端預設与 mount 前 CSS 整合、且保存利用者選択、命名配色与主機外観覆層保持也。

根 [README.md](README.md) 者工程目的、全体能力、快速開始与文档入口提示也。此等概観詳細変時僅更新也；個別機能追加或修正者、其処専用節追加之理由為不可也。機能有別之 API 用法、設定、限制与故障探査者該当包 README 或題目文档置、既存文档優先也。

`dist` 出力而非源編輯也。`packages/runtime/native` 之原生産物者供給之建構輸入也；建構通過為任意本地二進制置換勿也。打包変更者 [Core 之建構設定](packages/core/vite.config.ts) 与 [発行布局検証器](tools/check-release-layout.mjs) 之検査保持必要也。

## 引渡与指示維護

変更之挙動、実行之検証命令与結果、及未検証之運行時或平台挙動報告也。公開 PR 与提交文本者貢献内容集中、本地環境詳細与私密調査省略也。CONTRIBUTING.md 記述之通、英語 Conventional Commit 消息使用也。

`AGENTS.md` 者正典貢献者指南也；`CLAUDE.md` 者其相対 symlink 也。本文件者一回編輯也。包所有権、検証命令或貢献政策変時、同一変更中受影響指示更新也。checkin 済源連結、且維護者本地備忘、工具或絶対路径無、新 clone 自使用可能指南保持也。