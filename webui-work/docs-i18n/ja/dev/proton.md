# Haizakura Proton


Haizakura 向けのコンパイル時 protobuf コーデックです。TypeScript のスキーマと汎用呼び出しは、
実行時のスキーマ参照なしで、専用のエンコーダーとデコーダーへコンパイルされます。

[Haizakura/protobuf-dsl](https://github.com/Haizakura/protobuf-dsl)（`protobuf-fastdsl`、
コミット `22e382a`）からベンダリングしたもので、その README は MIT ライセンスを宣言しています。
Haizakura は `@snowluma/proton` というパッケージ名、マニフェスト、および以下に示す
ワイヤ互換性のルールを維持します。

## セットアップ

利用側パッケージの依存関係に `@snowluma/proton: workspace:*` を追加し、その Vite または
Vitest の構成でプラグインを有効にします:

```ts
import { defineConfig } from 'vite';
import protobufVitePlugin from '@snowluma/proton/vite';

export default defineConfig({
    plugins: [protobufVitePlugin()],
});
```

プラグインのエントリはビルド済み成果物に解決されます。コンパイラを編集した後は、利用側
パッケージをテストする前に `pnpm --filter @snowluma/proton build` を実行してください。
プラグインなしの呼び出しは、`@snowluma/proton/vite` を名指しする診断をスローします。

```ts
import type { pb, pb_optional, pb_repeated, uint_32 } from '@snowluma/proton';
import { protobuf_encode, protobuf_decode } from '@snowluma/proton';

interface Profile {
    id?: pb<1, uint_32>;
    name?: pb<2, string>;
    tags?: pb_repeated<3, string>;
    state?: pb_optional<4, uint_32>;
}

const bytes = protobuf_encode<Profile>({ id: 42, name: 'alice', state: 0 });
const profile = protobuf_decode<Profile>(bytes);
```

## スキーマとコンパイラのサポート

`pb<N, T>` は単数フィールドを表し、`pb_repeated<N, T>` は繰り返しフィールドを表し、
`pb_optional<N, T>` は単数フィールドに明示的なワイヤ上の存在（presence）を与えます。

| 型 | TypeScript の値 | ワイヤ形式 |
| --- | --- | --- |
| `uint_32`, `int_32`, `sint_32` | `number` | Varint。`sint_32` は zigzag を使用 |
| `uint_64`, `int_64`, `sint_64` | `bigint` | Varint。`sint_64` は zigzag を使用 |
| `bool` | `boolean` | Varint |
| `fixed_32`, `sfixed_32`, `float` | `number` | 32 ビット |
| `fixed_64`, `sfixed_64` | `bigint` | 64 ビット |
| `double` | `number` | 64 ビット |
| `string`, `bytes` | `string`, `Uint8Array` | 長さ区切り |
| メッセージインターフェース | オブジェクト | 長さ区切り |

コンパイラはエイリアス、名前空間インポート、`export *`、相対およびベアのパッケージ
インポート、ネストした汎用スキーマ、汎用関数とクラス、転送されるコールバックを解決します。
ラッパーの本体を保持し、生成されたコーデックを汎用呼び出しに通します。解決可能なマップ型、
条件型、ユーティリティ型もサポートします。曖昧なユニオンと未解決のスキーマはコンパイル時に
失敗します。

必要なコーデックとヘルパーのみが出力されます。ネストしたメッセージのエンコーダーは、共有の
出力バッファに対して計測と書き込みを行います。返されるバイト列は、より大きなバッファへの
ビューである場合があります。独立したバッキングバッファが必要な場合は `byteOffset` と
`byteLength`、または `bytes.slice()` を使用してください。後続のエンコードが、以前に返された
バイト列を上書きすることはありません。

## Haizakura のワイヤ互換性

- 素の `pb<>` スカラーは既定値（`0`、`0n`、`false`、空文字列、空バイト）を省略します。
  TypeScript の `?` が付いたフィールドも同様です。欠落したオプションの単数フィールドは
  `null` にデコードされます。
- `pb_optional<>` は、存在する既定値を出力しつつ、`null`/`undefined` を省略します。
  これにより、グループ全体のミュートを解除するために必要な明示的な `state=0` が保持されます。
- 負の `int_32` 値は、Haizakura の 5 バイトの送信エンコーディングを維持します。デコーダーは
  その形式と、正規の 10 バイトの符号拡張値の両方を受け付けます。
- `uint_32` 値は最大 10 バイトの完全で有効な varint を消費し、下位 32 ビットを保持します。
  タグと長さは、有効な 32 ビットのフレーミングに制限されたままです。
- デコーダーは、切り詰められた／オーバーフローするフィールド、無効な境界、不正な形式の
  グループを拒否します。未知のグループは、親フレーム内で深さを制限してスキップされます。
- 未知のタグは列挙不可のメタデータを保持し、`protobuf_getUnknownFields` と
  `protobuf_getUnknownFieldMetadata` から取得できます。メタデータは出現を集約し、メッセージ
  ごとに最大 64 種のフィールド／ワイヤ種別を保持し、省略された種別はペイロードを保持せずに
  要約します。

以前のランタイムマップのフォールバックとプラグインオプションは削除されました。利用側は、
プラグインを用いて encode/decode 呼び出しをコンパイルする必要があります。

## 移行監査

置き換えの前に、アップストリームの実装を Proton のソース履歴と照合して確認しました。以下の
挙動は回帰テストでカバーされています:

| Proton の履歴 | アップストリームの状況／維持される挙動 |
| --- | --- |
| 初回のベンダリング修正（`194165f4`）と汎用 OIDB 移行（`58028123`） | エイリアスされたマーカー、ネストした汎用フィールド、転送されるラッパーは、新しいコンパイラと統合テストでカバーされています。 |
| バレルエクスポート（`f21740a5`）とベアインポート（`994633ea`） | 新しいソースリゾルバーでサポートされています。バンドルされたクロスファイルおよびパッケージのフィクスチャを通じてテストされています。 |
| 明示的な presence（`90f26ca4`） | 新しいスキーマパイプラインに `pb_optional` を追加し、`?` をワイヤ上の presence とは別に保ちました。 |
| デコーダーの堅牢化（`b7d648ea`） | アップストリームはすでに varint とフィールド境界を検査しています。整数の境界、グループの処理、制限付きの未知メタデータ、およびレガシーの送信 `int32` バイトを維持しました。 |
| 拡張された `uint32`（`b53004ee`、`613b2b1e`） | アップストリームは値の完全な varint を消費します。既存の QQ 回帰フィクスチャを維持しました。 |
| クリーンアップ（`c7428363`） | 新しいコンパイラ／ソースのモジュール構成に置き換えられました。 |

## 検証とレイアウト

リポジトリのルートから:

```sh
pnpm --filter @snowluma/proton build
pnpm --filter @snowluma/proton typecheck
pnpm --filter @snowluma/proton test
```

`test/upstream` には、取り込んだコンパイラ、コード生成、プラグインのスイートが含まれており、
Haizakura のパッケージ構成とワイヤのルールに合わせて調整されています。`test/__tests__` は
Proton のワイヤ回帰テストを維持し、移行互換性のケースを追加します。`packages/protocol/tests`
の利用側テストは、ビルド済みプラグインで実際の QQ スキーマを試します。

```text
src/
  source/      source files, TypeScript module resolution and build entries
  schema/      type resolution and message construction
  compiler/    call analysis, generic codec propagation and source rewriting
  codegen/     wire emitters and selected helper generation
  index.ts     Vite plugin
  package.ts   package identity from package.json
  runtime.ts   uncompiled-call errors and unknown-field diagnostics
protobuf.d.ts  public field markers and runtime declarations
```
