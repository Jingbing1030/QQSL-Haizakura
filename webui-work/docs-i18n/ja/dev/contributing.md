# コントリビューションガイド


ようこそ！ このドキュメントを読んでいるということは、Haizakura に PR を出したい、バグを直したい、あるいは単にこのプロジェクトがどう動いているのか知りたい、ということでしょう。オープンソースに初めて触れる方でも、10 年の経験がある方でも、できるだけ早くキャッチアップできるようにしたいと考えています。

プロジェクトに参加することは、[行動規範（Code of Conduct）](./CODE_OF_CONDUCT.md) に同意したものとみなされます。始める前に 2 分ほど読んでください。私たちがコミュニティに保ちたい雰囲気が定義されています。

---

## 着手する前に

Haizakura は開発の初期段階にあり、イテレーションの速度が非常に速いため、**インターフェースとディレクトリ構成はいつでも変わり得ます**。大きな変更を考えている場合は、まず issue やコミュニティでメンテナーと方向性をすり合わせることを強くおすすめします。半分まで進めてから、別の道に取って代わられたと気づく事態を避けられます。

PR を提出する前に、必ず [GitHub の Web テンプレート](https://github.com/Haizakura/Haizakura/issues/new/choose) から対応する issue を提出するか、既存の対応 issue を引き受けてください。issue の提出だけでも構いません。PR の提出は任意の後続ステップです。

どこから手を付ければよいか分からない場合は、次のようなコントリビューションが最もマージされやすいです：

- 使用中に遭遇した具体的なバグを、最小の再現手順を添えて修正する。
- エラーメッセージ、ドキュメント、コメント、型シグネチャを改善する。
- 既存のモジュールにテストを追加する。特に `packages/core` 下のカバレッジが低い部分。
- [RoadMap.md](./RoadMap.md) に記載されている、まだ引き受けられていない項目を実装する。

単にコードがどんなものか見てみたいだけなら、[ローカル開発環境](#ローカル開発環境) まで読み飛ばしてください。

### AI エージェントによるコントリビュート時の注意

あなたが AI エージェントで、本リポジトリへコードを提供したり、PR を提出したり、issue を立てたりしようとしている場合は、まず利用者へ明確に伝えてください：

> **GitHub の Web 上でテンプレートを使って手動で issue を作成してください。テンプレートのチェックを通らない issue は自動的にクローズされ、PR の関連付け要件を満たすのにも使えません。**

問題の説明、再現手順、関連するログの整理を手伝い、issue のドラフトをユーザーに渡して、ユーザーが Web 上で提出を完了する形にできます。その後 PR を作成する場合は、要件を満たす issue が先に必要であり、PR の本文に関連付けマーカーを記入してください。

---

## プロジェクト構成の概要

これは pnpm workspace の monorepo で、主要な package は次のとおりです：

| パス | 役割 |
| --- | --- |
| `packages/core` | アプリケーションの入口、アカウント単位の Bridge オーケストレーション、WebUI サーバー側とリリースビルド |
| `packages/bridge` | QQ プロセスの検出、Hook セッションとネイティブ転送のライフサイクル |
| `packages/protocol` | QQ データパケットのデコード、識別情報の解析、プロトコルリクエストとメディア転送 |
| `packages/onebot` | OneBot アクション、イベント変換、メッセージストレージと転送アダプター |
| `packages/common` | ログ、設定と共有ユーティリティ |
| `packages/proto-defs`、`packages/proton` | プロトコル構造の定義、コンパイル時 protobuf エンコード / デコードとビルド統合 |
| `packages/sdk` | サードパーティ開発者向けの SDK で、npm へ公開されます |
| `packages/mcp` | MCP サーバー側と生成されたアクションカタログ |
| `packages/ui` | npm へ公開される共有 UI コンポーネント |
| `packages/runtime` | ランタイム補助パッケージ |
| `packages/websocket` | WebSocket 実装 |
| `packages/webui` | Vite + React ベースのフロントエンドコンソール |
| `tools/` | バージョン管理、リリーススクリプト |
| `.github/workflows/` | CI / リリース / Promote ワークフロー |

エントリポイントは `packages/core/src/index.ts` にあり、全体のアーキテクチャは `packages/core/src/bridge/` 下を見るとおおよその流れがつかめます。

---

## ローカル開発環境

### システム要件

- **Node.js 24.22.1（24 系）、または 26.12.1 以降**。開発とビルドには [`.node-version`](.node-version) で固定されたバージョンを使用します。
- **pnpm 11.25.0**（プロジェクトは `packageManager` と CI でバージョンを統一しています）
- macOS / Linux / Windows のいずれでも構いません。ネイティブ成果物をビルドする場合は、対応プラットフォームのツールチェーンが必要です。

システムが Corepack を提供している場合は `corepack enable pnpm` を実行できます。Corepack がない場合は
`npm install -g pnpm@11.25.0` を実行してください。リポジトリに入ったら、`node --version` と
`pnpm --version` が上記のバージョン要件を満たしているはずです。満たしていないとインストールはそのまま失敗します。

### コードを取得し、依存をインストールし、動かす

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

`pnpm install` が止まったりエラーになったりする場合は、まず Node のバージョンと pnpm のバージョンを確認し、次に `.npmrc` にあなたの環境で利用可能な registry が設定されているかを確認してください。

---

## はじめての PR 提出

### 1. ブランチの作成

`dev` を基にブランチを作成してください。`main` はリリースポインターであり、メンテナーの Promote によってのみ更新されます。**ターゲットブランチが `dev` でない PR は自動的にクローズされます**。その後でターゲットブランチを変更したり PR を開き直したりしても、チェックが発動します。

```bash
git checkout dev
git pull upstream dev          # 假设你把官方仓库设为 upstream remote
git checkout -b fix/onebot-mention-encoding
```

ブランチ名に強制ルールはありませんが、`fix/...`、`feat/...`、`docs/...`、`refactor/...` のようなプレフィックスを使うと、意図がひと目で分かるのでおすすめです。

### 2. コードを書く

- **変更は焦点を絞る**：1 つの PR では 1 つのことだけを行ってください。ついでに見つけた他の問題は、別の issue や新しい PR として立ててください。
- **既存のスタイルに従う**：TypeScript の整形はリポジトリの Prettier 設定に従います。通常の機能追加や修正の PR では、関係するファイルだけをフォーマットし、無関係な大規模フォーマットやリネームを混入させないでください。
- **テストを書く**：バグを修正するときは、まずそのバグを再現するテストを書き、失敗することを確認してから通るようにしてください。新機能には、少なくとも happy path のテストを追加してください。
- **無意味なコメントを追加しない**：識別子で既に明らかなことを書き直す必要はありません。コメントは「何をしたか」ではなく「なぜ」を説明すべきです。

提出する前に、PR の CI と同じ検証エントリを実行してください：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm run build:all
```

`pnpm test` はテストスクリプトを宣言しているすべてのワークスペースパッケージを実行します。Core だけを検証する場合は
`pnpm test:core` を使用できます。CI は上記の完全なチェックを再実行します。

### 3. コミットメッセージ

私たちはおおむね [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) に従っています：

```
<type>(<scope>): <subject>

<body>
```

`type` でよく使うもの：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`。
`scope` でよく使うもの：`core` / `sdk` / `webui` / `onebot` / `bridge` / `protocol` などのモジュール名。

例：

```
fix(onebot): handle empty mention segments in group messages
refactor(bridge): extract BridgeInterface as the OneBot-facing seam
docs: clarify dev environment setup steps
```

> ⚠️ **しないでください** —— コミットメッセージに `[merge]` プレフィックスや `chore(release):` プレフィックスを使わないでください。この 2 つのプレフィックスはメンテナーが `main` を `dev` に向けるためのもので、使うと PR の挙動がおかしくなります。詳しくは後述の [メンテナー向け参考](#メンテナー向け参考release--promote) を参照してください。

### 4. プッシュして PR を作成

```bash
git push origin fix/onebot-mention-encoding
```

GitHub 上で PR を作成し、**ターゲットブランチに `dev` を選びます**。PR の説明には次の内容を記載してください：

- この PR が何を解決するか / 何を実装するか。
- 主な実装方針（自明でないトレードオフがあれば）。
- テスト方法（何を実行し、どう有効性を確認したか）。
- 必須の issue 関連付けマーカー。たとえば `Refs #123` や `Closes #123` です。GitHub の `Fixes`、`Resolves` などのクローズキーワードも使用できます。

関連付けマーカーは必ず PR の本文に記載してください。HTML コメント、コード例、引用ブロックはカウントされません。`#123`、`Haizakura/Haizakura#123`、および本リポジトリの issue への完全なリンクに対応し、いずれも前述のキーワードを前に付ける必要があります。

自動チェックは、少なくとも 1 つの関連付け対象が実在する本リポジトリの issue であり、PR より先に作成され、まだオープン状態で、既存の issue テンプレートのルールを通過していることを要求します。すなわち `bug` / `enhancement` ラベルが付いているか、そのルールに既にあるメンテナー身分の免除に該当する場合です。存在しない番号、別の PR、クローズ済みまたはテンプレート非準拠の issue は該当しません。**すべての PR がターゲットブランチと issue 関連付けの要件を満たす必要があり、メンテナーやボットが提出した PR も含みます。**

要件を満たさない PR には説明が届き、自動的にクローズされます。要件を満たす issue が既にある場合は、PR を修正してから開き直せます。issue を追加で立てる必要がある場合は、先に issue を提出し、その後で新しい PR を作成してください。インターフェース障害やレート制限はチェックを失敗させますが、PR の違反として自動クローズされることはありません。

`Refs` は関連付けに使用し、`Closes` などのキーワードもここでは関連付けチェックに使用します。PR のターゲットが `dev` であるため、`dev` へのマージ自体は、GitHub のデフォルトブランチ向けの issue 自動クローズ機構を発動させません。

### 5. コードレビューとマージ

- メンテナーは時間が取れるときにレビューします。1 週間返答がない場合は、PR でメンションするか、コミュニティで声をかけてください。
- レビューの指摘は、できるだけ同じ PR 内で修正してください。何度も閉じて開き直すのは避けてください。
- マージ方法はメンテナーが決め、通常は `dev` への squash merge です。**`main` はメンテナーが Promote を通じてその時点の `dev` を指します**。あなたが `main` を気にする必要はありません。

---

## スタイルと規約

### コードスタイル

- TypeScript は strict モードで、`tsconfig.base.json` の設定に従います。
- TypeScript は 4 スペースインデントを使用し、制御文には常に波括弧を付けます。整形はルートの [`.prettierrc.json`](./.prettierrc.json) と独立したローカルの [ESLint フォーマットルール](./eslint.format.config.ts) で管理されます。通常の `pnpm lint` はコード品質チェックを担当します。
- 既存の抽象を優先し、「想定される将来の要件」のために前もって抽象化しないでください。
- システム境界（ユーザー入力、外部 API）でない限り、内部関数に防御的な引数チェックを加えないでください。
- デッドコード、コメントアウトされたコード、具体的な文脈のない `// TODO` のプレースホルダーを残さないでください。

リポジトリのルートからローカルのフォーマットコマンドを実行します：

```bash
pnpm format                         # 为全部 TS/TSX/MTS/CTS 补大括号、空行并排版
pnpm format:check                   # 检查上述规则，不修改文件

pnpm exec eslint --config eslint.format.config.ts --fix packages/core/src/index.ts
pnpm exec prettier --write packages/core/src/index.ts
```

フォーマット対象からは [`.prettierignore`](./.prettierignore) にあるビルド成果物、生成ファイル、コンパイラのテストフィクスチャを除外します。通常のソースとテストはどちらもフォーマット対象です。この 2 つのコマンドはローカル用で、CI には組み込まれていません。

空行は保守的なルールを採用します。文ブロックの前後に空行を入れ、既存の論理的な区切りは保ち、連続する宣言や通常の呼び出しを無理に分割せず、各 `return` や `break` の前に空行を挿入しません。同じ分岐を共有する連続した `case` ラベルは隣接させたままにします。JSON、YAML などのファイルは元のインデントを引き続き使用します。

エディターでは、プロジェクトにローカルインストールされた Prettier を選択し、リポジトリの設定を読ませてください。VS Code では
`esbenp.prettier-vscode` をインストールし、TypeScript / TypeScript React の既定フォーマッターを
Prettier に設定し、必要に応じて保存時のフォーマットを有効にできます。

### テスト

- 単体テストは被テストコードと同じパッケージの `tests/` か、同じディレクトリの `*.test.ts` に置き、既存のスタイルに従ってください。
- テストは振る舞いを記述し、実装の詳細をテストしないでください。`it('should call internal foo')` のようなものは反例です。
- IO / タイミング / 外部プロセスが関わる場合は、既存の fake/stub パターンを使用し、`packages/onebot/tests/` の Bridge テストダブルを参照してください。
- PR 自動チェックの分離回帰は `pnpm test:workflows` で実行できます。`pnpm test` はこのチェックを含んでいるため、自動クローズをテストするために実際の PR を作成する必要はありません。

### ドキュメント

- **メイン README の位置づけ**：ルートの [`README.md`](./README.md) はプロジェクトの位置づけ、全体の能力、クイックスタート、ドキュメントの入口を示すためのもので、これらの全体的な情報が変化したときだけ更新します。特定の機能を追加・修正したからといって、メイン README にその機能専用の説明を追加しないでください。
- **具体的な機能の説明場所**：インターフェースの使い方、設定項目、機能制限、トラブルシューティングの説明は、対応する package の README や個別のドキュメントに書き、既存のドキュメントの更新を優先してください。ユーザーやコントリビューターに見える挙動の変化は、引き続き対応するドキュメントを同期して保守する必要があります。
- SDK の破壊的変更では、`packages/sdk/CHANGELOG.md` と `packages/sdk/VERSIONING.md` を必ず更新してください。

---

## バグ報告 / 機能リクエスト

- **バグ報告**：issue を立て、最小の再現手順、期待する挙動、実際の挙動、バージョン番号、実行環境を添えてください。ログを添えられると最善です。
- **機能リクエスト**：まず解決したい実際のシナリオを説明し、そのうえで欲しいインターフェースを説明してください。メンテナーは「具体的にどうやるか」よりも「なぜ必要か」を重視します。
- **セキュリティ問題**：公開の issue を立てないでください。まずコミュニティ経由でメンテナーへ個別に連絡してください。

コミュニティへの入口（[README](./README.md) を参照）：

- QQ：[Haizakura-QQ](https://qm.qq.com/q/g3UMLpWALe)
- Telegram：[Haizakura-TG](https://t.me/napcatqq)

---

## メンテナー向け参考：release & Promote

> 以下は主にリリース権限を持つメンテナー向けの内容です。通常のコントリビューターは PR を `dev` へ出せばよく、この節を気にする必要はありません。

### ブランチモデル

Haizakura は **`main` + `dev`** の 2 ブランチモデルを使用します：

- **`dev`** — 日常の開発ブランチです。すべての機能、修正、ドキュメントの変更はまず `dev` に入ります。
- **`main`** — リリースポインターで、ある Promote の時点の `dev` の先端と**同一のコミット**であるべきです。直接 push したり、`main` へ PR を出したりしないでください（CI が拒否します）。
- **`native/auto-update-*`** — `Haizakura Bot` が自動作成するネイティブ成果物の更新ブランチです（`HaizakuraNative` 由来で、手動での保守は不要です）。

### `main` を `dev` に向ける

ワークフロー `.github/workflows/promote-dev-to-main.yml` が `Haizakura Bot` として `main` を現在の `dev` の先端へ向けます。**merge PR はもう作成しません**。`main` に `dev` にはまだない独自の変更がある場合、Promote は失敗するため、まずそれらの変更を `dev` へ戻す必要があります。

`dev` への push では引き続き `dev-build.yml` が実行されます。Promote はそのチェック群を**待ちません**。リリースには下記の `pnpm release` を使用してください。これはローカルで先に完全な CI を実行します。

#### 1. コミットメッセージのプレフィックス（日常的な使用を推奨）

`dev` へ 1 つのコミットを push し、そのコミットメッセージが**次のいずれかのプレフィックスで始まる**と発動します（大文字小文字は区別しません）：

- `[merge]` — たとえば `[merge] fix: hotfix for OneBot mention`
- `chore(release):` — たとえば `chore(release): v1.7.0` で、conventional commits の発版習慣に沿います。**本当のバージョン bump にのみ使用し**、通常の CI / ツールのコミットには書かないでください。

> **プレフィックス**の一致であり、任意の位置ではありません。`fix: something [merge]` は発動せず、`[merge]` を先頭に書く必要があります。

#### 2. `chore.*` タグのプッシュ

`chore.*` に一致する任意のタグ（たとえば `chore.merge-20240509`、`chore.promote-v1.7.0`）が push されたときも発動します：

- `chore.*` → `promote-dev-to-main.yml` のみを発動します（`main` を `dev` へ向けます）
- `v*` → `release.yml` のみを発動します（リリース成果物をビルドします）

推奨する流れは、`pnpm release` を使った後（または先に Promote し、`origin/main` が `dev` の先端と等しくなったことを確認した後）、`main` 上で `v*` タグを打つことです。こうすると `release.yml` は常にその時点の `main` HEAD を基にビルドします。

#### 3. 手動トリガー

リポジトリの Actions ページ → `Promote Dev to Main` → `Run workflow` を開きます。merge 戦略のオプションはなく、実行すればそのままポインターの更新になります。

### `main` に「PR 必須」を課さないこと

Promote は PR を経由せずに `main` を更新します。`main` に **Require a pull request before merging** を有効にしたり、参照の更新を禁止したりすると、Promote は機能しなくなります。

`main` の削除を制限することはできます。外部からの PR は必ず `dev` へ出す必要があり、`main` へ出された PR は `main-pr-target-guard.yml` が拒否します。

ローカルで古い `main` をすでに checkout している場合、Promote 後に fast-forward できないことがあります。`origin/main` に合わせれば解決します。

### 必須の Secrets

`promote-dev-to-main.yml` は `HaizakuraNative/build-native.yml` と同じ GitHub App を再利用します。Haizakura リポジトリ（または organization）レベルで次が設定済みであることを確認してください：

- `SNOWLUMA_BOT_APP_ID` — 数値型の App ID。
- `SNOWLUMA_BOT_PRIVATE_KEY` — その App の PEM 秘密鍵。

App は本リポジトリにインストール済みで、**Contents: Read+Write** が付与されている必要があります。

### ローカルワークフロー早見表（メンテナー向け）

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

## さらに質問がある場合

- 既存の issue と PR を見てください。あなたの疑問はすでに議論されているかもしれません。
- コミュニティで聞いてみてください（QQ / TG のリンクは上記にあります）。
- 対応する issue がある状態で、「この直し方で OK か」を確認したいだけなら、draft PR を開いてコードを見せてから議論するのが歓迎されます。

Haizakura に時間を割いて貢献してくださりありがとうございます —— このプロジェクトがどこまで進めるかは、一人ひとりにかかっています。❄️

## コントリビューションのライセンス / Licensing of contributions

PR を提出した時点で、あなたのコントリビューションが本プロジェクトの `LICENSE`（Haizakura ソース公開・非商用ライセンス）の下でライセンスされることに同意し、そうする権利があること、およびコントリビューションがあなたのオリジナルであることを表明したものとみなされます（第三者の素材を含む場合は、PR 内でその出所とライセンスを明示してください）。

**あなたは自身のコントリビューションの著作権を保持します**。同時に、**Haizakura に対して永続的、全世界、無償、取消不能、再許諾可能（sublicensable）なライセンスを付与します**。これにはあなたのコントリビューションの使用、複製、改変、配布、およびそれを基にした派生作品の作成が含まれ、**本プロジェクトの非商用ライセンス以外の条件（商用条件を含む）での再許諾と配布も含みます** —— これによりプロジェクト側は、一人ひとりに同意を求め直すことなく、認可された商用シナリオでコミュニティのコントリビューションを利用できます。

By opening a PR, you agree your contribution is licensed under the project's `LICENSE`; you represent that you have the right to submit it and that it is your own work (clearly identify any third-party material in the PR).

**You retain copyright in your contribution** and additionally grant Haizakura a **perpetual, worldwide, royalty-free, irrevocable, sublicensable license** to use, reproduce, modify, distribute, and create derivative works of your contribution, **including the right to relicense and distribute it under terms other than this project's non-commercial license (including commercial terms)** — so the project can use community contributions in authorized commercial scenarios without seeking each contributor's consent again.