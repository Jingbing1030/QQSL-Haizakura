# 開発者ドキュメント


Monorepo の構成、コアの起動チェーン、コントリビュート時の注意点

Haizakura は TypeScript とネイティブモジュールのハイブリッドプロジェクトです。TypeScript がランタイムのオーケストレーション、OneBot の実装、プロトコルのブリッジ、SDK、WebUI を担い、ネイティブモジュールがフック、注入、高性能な WebSocket 機能を担います。

## Monorepo の構成

pnpm workspace で、5 つのパッケージから成ります：

```
Haizakura/
├─ packages/
│  ├─ core/        @snowluma/core       核心：Bridge / OneBot / Hook
│  ├─ websocket/   @snowluma/websocket  本仓内置 WS 实现（依赖原生 addon）
│  ├─ sdk/         @snowluma/sdk        外部消费者用的 TS OneBot 客户端
│  ├─ webui/       webui                React + Vite 控制台
│  └─ runtime/     运行时发行模板（启动脚本 / launcher / package.json）
├─ native/         平台原生产物（.node / .dll / .so）
├─ dist/           构建输出
├─ tools/          辅助脚本（version bump、release 等）
├─ docs/           ADR 等开发文档
└─ package.json
```

## コアの起動チェーン

エントリポイントは `packages/core/src/index.ts` です：

```
loadRuntimeConfig()           ← 读 config/runtime.json / env
  ↓
HookManager(autoLoadOnDiscovery)
  ↓
BridgeManager
  ↓
OneBotManager                 ← 按 UIN 拉起 OneBotInstance
  ↓
initWebUI(port=webuiPort)     ← 仅完整构建启用
```

起動時に生成されるもの：

- `HookManager` —— QQ のメインプロセスを検出してネイティブアドオンを注入します。`hookAutoLoad: true` の場合、新しい PID を検出するたびに自動で注入します。

- `BridgeManager` —— 名前付きパイプ内のフックメッセージをブリッジイベントへデコードします。rkey / 連絡先 / グループメンバーをキャッシュします。

- `OneBotManager` —— UIN ごとに `OneBotInstance` を生成します。`MessageStore` / `MediaStore` / `NetworkManager` を保持します。

- `initWebUI` —— フルビルドでは WebUI を起動します。ポートの既定値は `5099` です（`runtime.json.webuiPort` で変更できます）。

## フックとネイティブモジュール

フックのネイティブモジュールは `process.dlopen()` を介して読み込まれます。ソースは独立したリポジトリ `dev/nnphook` にあります。

プラットフォームごとの命名規則：

```
snowluma-win32-x64.node    snowluma-win32-x64.dll
snowluma-linux-x64.node    snowluma-linux-x64.so
snowluma-linux-arm64.node  snowluma-linux-arm64.so
```

読み込み時の探索パス：

```
native/
dist/native/
packages/runtime/native/
```

ネイティブアドオンが公開するもの：

- `getAllMainProcess` —— QQ のメインプロセスを列挙します。

- `loadModuleManual` —— 対象プロセスへモジュールを手動でマッピング注入します。

- `unloadModuleManual` —— 注入済みモジュールをアンロードします。

Windows の既定の対象プロセス名は `QQ.exe`、Linux では `qq` です。

## OneBot のライフサイクル

ブリッジ層が QQ セッションの起動を検出すると、次の処理を行います：

- `config/onebot_.json` を読み込みます（存在しない場合はグローバルからコピーします）。

- `OneBotInstance` を構築します。

- HTTP / WS / 逆方向 WS / HTTP POST のアダプターを起動します（`networks.*` の設定に従います）。

- 好友リスト、グループリスト、グループメンバーリストを非同期でプリロードします。

- ブリッジイベント → OneBot イベントの転送を行います。

セッションが閉じられると、対応するインスタンスは解放されます。

## WebSocket パッケージ

`@snowluma/websocket` はプロジェクト自前の WebSocket 実装で、インターフェースは可能な限り `ws` に近づけつつ、ネイティブによる高速化を備えています。

エクスポート：

- `WebSocket` —— クライアントのコンストラクターです。

- `WebSocketServer` —— サーバーのコンストラクターです。

- `Server` —— `WebSocketServer` の別名です。

- `InternalWebSocket` —— 内部接続の実装です。

プラットフォームネイティブの `.node` に依存し、同じく `native/` の探索パスから読み込まれます。

## SDK パッケージ

`@snowluma/sdk` は第三者向けの型完備な OneBot クライアントで、npm へ独立して公開でき、Haizakura ランタイムに依存しません。monorepo 内でビルドされ（下記の `pnpm build:sdk` / `build:all` を参照）、利用側の使い方は SDK のドキュメントを参照してください。

## 開発コマンド

```
pnpm install
pnpm dev              # core 开发模式
pnpm dev:web          # WebUI 开发服务器
pnpm build            # 仅 core
pnpm build:webui      # 仅 WebUI
pnpm build:sdk        # 仅 SDK
pnpm build:all        # core + SDK + WebUI
pnpm test             # core 测试
pnpm typecheck        # 全仓类型检查
pnpm lint             # 全仓 lint
```

## ビルド順序

フルリリース版：

```
pnpm build:all
```

次の順に実行されます：

- `@snowluma/core` のフルビルド

- `@snowluma/sdk`

- `webui`

成果物はすべて `dist/` に出力されます。

## ドキュメントサイト

ドキュメントサイトは独立したリポジトリ `Haizakura/HaizakuraDocs` にあります（ローカルでは通常 `dev/HaizakuraDocs/` へ checkout し、メインリポジトリと共存させます）。

技術スタック：Rspress + React + TypeScript + MDX + KaTeX。

OneBot API リファレンスは、ドキュメントリポジトリの `pnpm api:generate`（`prebuild` に組み込み済み）が `docs/public/api/catalog.json` から生成します —— アクションごとに 1 ページです（加えてカテゴリ概要ページと検索可能なカタログのランディングページがあります）。`catalog.json` はメインリポジトリの `collectActionDocs()` が出力するアクションカタログ（`@snowluma/mcp` の `CatalogAction` と同型）で、メインリポジトリの `sync-docs-catalog` workflow がリリース時に Haizakura bot としてドキュメントリポジトリへ自動コミットします —— 手動での保守は不要です。

## コントリビュート時の注意点

- BridgeManager を迂回しないでください：OneBot 層は必ず `BridgeInterface` を介して NTQQ の機能を呼び出し、疎結合とテスト容易性を保ちます。

- 設定が自動生成可能であり続けるようにしてください：新しいフィールドは後方互換である必要があり、解析時に正規化してディスクへ書き戻します。

- ネイティブモジュールはプラットフォームごとに配布します：プラットフォームを追加する際は `.node` と注入可能なライブラリを同時に揃えてください。

- テストの追加を優先してください：コアの OneBot 挙動は `vitest` で検証し、`packages/core/tests/` を参照してください。

- API ドキュメントの自動化：`defineAction` でアクションを追加する（任意で `returnsSchema` により `data` を記述する）だけで完了です —— `catalog.json` は `sync-docs-catalog` workflow が自動同期するため、API リファレンスが古くなることはありません。ローカルでプレビューする場合は手動で `pnpm api:generate` を実行できます。
このドキュメントは役に立ちましたか？

役に立った役に立たなかった最終更新

中国国内のネットワーク

Docker Hub、GitHub、QQ インストールパッケージを大陸のネットワークでどう扱うか

MCP の使用

Haizakura の OneBot アクションカタログと任意の実行機能を MCP クライアントへ接続する