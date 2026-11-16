# @snowluma/sdk 版本管理


SDK 者、其公開包表面従 SemVer 也。

- `@snowluma/sdk` 由来輸出之運行時値与類。
- `@snowluma/sdk` 及 `@snowluma/sdk/types` 由来輸出之型。
- 支持之子路徑輸出: `client`、`messages`、`events`、`errors`、`actions`、`types`、`node`。
- 有型客端助手、消息構築器、事件助手、SDK 錯誤類之運行時挙動。

## 版本方針

SDK 与応用之版本者、由倉庫根目録実行 `pnpm bump <version>` 而同期也。

当前 Node.js 要求者 `^24.22.1 || >=26.12.1` 也。開発与構築用倉庫之 `.node-version`。

SDK 者、支持 Node.js 原生輸入与打包器利用之 ES 模組包也。其構築用 `NodeNext`、故相対源輸入与再輸出必須用 `.js` 指定子、依此輸出之 JavaScript 与宣言双方無打包器亦可解決也。包試験者、編譯新生成之輸出、以 Node.js 載入全運行時入口点、且以 NodeNext 与打包器解決双方対利用側実施型検査也。

- 主要: 公開輸出之削除或変更、運行時挙動之非互換変更、支持 Node 版本之変更、或既存包子路徑之削除或変更。
- 次要: 新公開 API 或包子路徑之追加、新 Haizakura 動作之支持、任意参數之追加、或錯誤子類之追加。
- 修正: 缺陷修復、文書改善、不破公開型之実装詳細限定、或不变更呼出署名之動作元資料更新。

## 発布検査表

1. 実行 `pnpm bump <version>`、更新全工作区版本。
2. 更新 `packages/sdk/CHANGELOG.md`。
3. 実行 `pnpm --filter @snowluma/sdk typecheck`。
4. 実行 `pnpm --filter @snowluma/sdk test`。
5. 実行 `pnpm --filter @snowluma/sdk build`。
6. 実行 `pnpm --filter @snowluma/sdk pack --dry-run`、確認公開文件。

## npm 自動公開

`.github/workflows/sdk-npm-publish.yml` 者、SDK 関連文件到達 `main` 時公開 `@snowluma/sdk`、含 `dev` 至 `main` 之自動昇格流程也。公開工程用 npm Trusted Publishing 与名為 `Haizakura` 之 GitHub Environment、経 GitHub Actions OIDC 認証、故無需 `NPM_TOKEN` 密碼也。

SDK、UI、MCP 之 npm 一度設定者
[`.github/npm-trusted-publishing.md`](../../.github/npm-trusted-publishing.md) 記載也。

若包版本已存在於 npm、則工作流程該回公開省略也。欲生新 npm 発布之 SDK 変更、合流前必須更新 `packages/sdk/package.json` 版本也。

## 動作互換性

`SNOWLUMA_ACTIONS`、`isHaizakuraAction`、`HaizakuraKnownAction` 者、`@snowluma/sdk` 与 `@snowluma/sdk/actions` 双方可用也。目録含本回発布可実行之動作名、互換別名、原始動作。OneBot 之登記検査者、検証 SDK 目録与伺服器保持整合。公開 SDK 無輸入伺服器代码也。

此本地目録者、非対接続中伺服器之能力検査也。凡既知動作名、含別名、皆於 `HaizakuraActionMap` 有参數与結果条目。既存広範 JSON 契約者互換故保持也。新参數型記述受容之輸形式、含数値文字列与原始型変換;伺服器側範囲与状態検証仍適用也。自定動作与動的選択之名、経 `raw()` 与 `rawResponse()` 仍支持也。動作型之追加者、不変更既存方法署名或返却型之限、次要変更也。

流結果型者、記述個別幀之載荷、含中間幀与終端幀也。両内蔵客端支持 `requestStream()`(封套)与 `stream()`(含 API 錯誤処理之載荷)、加之差分文件上載/下載助手;参照 [STREAMING.md](STREAMING.md)。既存 `request()`、`call()`、`raw()`、`rawResponse()`、`downloadFile()` 者保持其単一応答契約也。唯実装 `request()` 之自定子類仍有効;既定 `requestStream()` 明示報告流未支持也。流重置/錯誤封套保持既存錯誤挙動也。以十進文字列返却之相冊件数与 ID 者仍為文字列、普通消息 ID 者仍為符号付数値也。

包利用側検査者、検査動作対応表之完全網羅、推論結果、互換別名、無効輸入例、以 NodeNext 与打包器解決双方也。同参數例者、不始動 QQ 亦不実行動作、対伺服器実動作解析器検査也。

追加媒体送信方法、明示引用返信、WebSocket 事件待機者 [MESSAGING.md](MESSAGING.md) 記載也。既存文字列路徑、普通 `reply()` 挙動、処理器/文脈型仍支持也。任意 `node` 子路徑担本地文件系統接入;面向瀏覧器之入口点無 Node 輸入也。運行時亦伝播群文件聊天公開失敗、而非失敗後返却成功;成功動作之応答形状不変也。

任意 `node` 入口亦輸出 `createReverseWebSocketServer`、`HaizakuraReverseWebSocketServer`、逆方向会話型。此等追加輸出者、不変更前向客端而受容 OneBot 逆接続也。`ws` 運行時依存唯 Node 入口載入;面向瀏覧器之輸出無 Node 伺服器輸入也。参照 [REVERSE_WEBSOCKET.md](REVERSE_WEBSOCKET.md)。
