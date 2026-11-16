# ホスト外観オーバーレイ


**Haizakura プロセス**で `SNOWLUMA_WEBUI_TARGET=maibot` を設定すると、MaiBot の
millennium 外観を使用できます。同じリリースバンドルが、単体配置と埋め込み配置の
両方をサポートします。未設定または空の値では既存の Haizakura の体験が維持され、
不明な値では明示的な診断メッセージとともに WebUI の起動が失敗します。

この最初のアダプターが実装するのは **millennium のみ**であり、ライトモードとダークモードに
対応します。その他の MaiBot スタイルは実装されていません。Haizakura に新しい外観
セレクターはありません。テーマの変更はホストが所有し、管理対象の間は既存のテーマ
コントロールを利用できず、設定ページにはどの設定が保持されるかが表示されます。

## 実行時の処理と所有権

1. コアは起動時に環境変数を読み取ります。[静的ドキュメント配信](../core/src/webui/static-frontend.ts)
   は、検証済みの公開 JSON ブートストラップを `/`、`/index.html` および SPA の
   フォールバックドキュメントに注入します。ドキュメントは `Cache-Control: no-store` を
   使用します。シークレットや任意の環境変数がブラウザーに到達することはありません。
2. [フロントエンドブートストラップ](src/appearance/runtime.ts) は、React をマウントする前に
   選択されたターゲットのアセットのみを読み込みます。単体配置では、ターゲットの
   スタイルシート、フォント、ホストリスナーを読み込みません。Vite の開発時は、そのプロセスが
   環境変数を持っている場合に同じブートストラップを配信します。本番ビルドは中立のままです。
3. [ThemeContext](src/contexts/ThemeContext.tsx) は、`savedAppearance` を実効的な `appearance`
   とは別に保持します。localStorage または `config/ui.json` に入るのは保存済みの設定のみです。
   ターゲットの更新が永続化 API を呼び出すことはありません。
4. 色、フォント、角丸、壁紙、CSS 変数のオーバーライド、カスタム CSS、カスタムカーソルの
   表示は、ターゲットが所有します。これらの保存済みの値は保持されますが、一時的に
   無効化されます。UI の拡大縮小、密度、モーション / アクセシビリティ、ナビゲーションの
   レイアウト、データ設定は引き続き利用できます。ネイティブの外観に戻す際も、
   セーフモードの制限は引き続き適用されます。
5. 実効的な外観を適用するレイアウトエフェクトは 1 つだけです。変更によってドキュメントが
   再読み込みされたり、React のキーが変わったり、セッションが再起動したりすることは
   ありません。すべてのターゲットルールは、`body` 配下のポータルも含め、
   `html[data-webui-target]` にスコープされます。

## ホストプロトコル、バージョン 1

コントラクトは [common/webui-target.ts](../common/src/webui-target.ts) にあります。
配置環境はオプトインであり、**ライブトランスポートではありません**。既存のランチャーは
以下に示す送信側を実装する必要があり、環境変数を設定しただけでは別プロセスの
現在のテーマを伝えることはできません。

同一ドキュメントの埋め込みブリッジ（たとえば Electron の `executeJavaScript`）は、
イベントをディスパッチする前に最新のスナップショットを公開します。

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

このスナップショットは、React や遅延アセットローダーが準備できる前に送信された
メッセージを処理します。ゲストの `dom-ready` ごと、およびホストが解決した明るさが
変化するたびに公開してください。すでに MaiBot に追従しているホストは、自身が
解決した `light`/`dark` の状態を転送してください。これにより、真実の源泉が競合するのを
避けられます。注入する前にゲストの想定オリジンを検証し、値は `JSON.stringify` で
シリアライズし、ゲストで Node 統合を有効にしないでください。

現在のドキュメントに対するオーバーライドを解除するには、同じ仕組みで
`{ version: 1, target: null }` を送信します。元の外観が即座に戻ります。オプトインした
ドキュメントはホストのサブスクリプションを保持するため、ホストは後からターゲットを
再適用できます。リスナーはプロバイダーのアンマウント時に解放されます。これは起動時の
環境を変更するものではなく、単体配置でターゲットを有効にするものでもありません。

現在のアダプターは、ホストのスナップショットが届くまでは millennium とシステムの
明るさで開始します。ホストが送信を停止した場合、最後の有効なスナップショットが
有効なままになります。スナップショットは永続化されず、オリジンやタブ間で共有されません。
再読み込み時にはホストが再度公開する必要があります。サポートされていないバージョン、
ターゲット、スタイル、モードは `[Haizakura appearance]` のコンソール診断とともに拒否され、
直前の有効なスナップショットが維持されます。ホストはこのプロトコルを通じて CSS、URL、
実行可能なコンテンツを提供することはできません。認証されていない HTTP 書き込み
エンドポイントは追加されません。

## ターゲットの追加

- 共有コントラクトの `WEBUI_TARGETS` に、その識別子、スタイル、デフォルトスタイルを
  追加します。検証はこの境界で行い、任意の文字列を受け入れないでください。
- 網羅的な [フロントエンドレジストリ](src/appearance/registry.ts) に遅延ローダーを
  1 つ追加します。純粋な「保存済みから実効値への」リゾルバーとスコープ付き
  スタイルシートを `src/appearance/targets` の下に実装します。フォントを使用する場合は、
  再配布ライセンスとともにローカルに保持してください。
- セマンティックな色変数、共有コンポーネントクラス、中立的な `data-ui-surface` マーカーを
  使用します。ビジネスページにターゲット名のチェックを追加しないでください。
- 解決済みのオーバーライドを永続化したり、保存済みの設定を変更したり、2 つ目の
  DOM テーマライターを導入したり、表示を切り替えるためにアプリケーションを
  再マウントしたりしないでください。
- デフォルトのアセット / リスナーの分離、初期ドキュメントのルート、不正な形式の
  メッセージ、急速な更新、クリーンアップ、保存済み設定の正確な復元をテストします。
  フォーム、フォーカス、スクロール、ポータル、モバイルレイアウトは、分離された
  バックエンドで検証します。Electron 統合には、別途実ホストでの確認が必要です。

## ソースと検査

このアダプターは、アーカイブされた単体 WebUI ではなく、MaiBot のメインリポジトリの
[millennium スタイルシート](https://github.com/Mai-with-u/MaiBot/blob/5c7637e6913c84d1c3d5e742fa9e95a7e70d3501/dashboard/src/styles/millennium.css)
に従います。色とマテリアルは
[OneKey シェル](https://github.com/Mai-with-u/MaiBotOneKey/blob/e8073b0bce35c8c4da973b06156602e14c42fee5/src/renderer/src/styles/millennium.css)
にも一致します。同梱の Jersey 20 フォントはその MaiBot リビジョンのもので、著作権は
The Soft Type Project Authors にあり、[SIL Open Font License](src/appearance/targets/assets/Jersey20-OFL.txt)
の下で提供されます。そのライセンスは、本番アセットではフォントとともに出力されます。

集中的なチェック（リポジトリのルートから）:

```sh
pnpm --filter @snowluma/common exec vitest run tests/webui-target.test.ts
pnpm --filter @snowluma/core exec vitest run tests/webui-static-frontend.test.ts
pnpm --filter webui exec vitest run tests/target-appearance.test.ts
```

変更を引き渡す前に、`AGENTS.md` に記載された通常のワークスペースチェックを
実行してください。
