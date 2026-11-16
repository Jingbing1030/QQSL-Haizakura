# Haizakura Proton


Haizakura 用之編譯時 protobuf 編解碼器也。TypeScript 模式与汎用呼出者、実行時模式参照無之専用編碼器及解碼器被編譯為。

[Haizakura/protobuf-dsl](https://github.com/Haizakura/protobuf-dsl)（`protobuf-fastdsl`、commit `22e382a`）由来之組込也、其 README 者 MIT 許可証宣言為。
Haizakura 者 `@snowluma/proton` 之包名、manifest 及以下記述之 wire 互換規則保持也。

## 設定

利用側包之依存関係至 `@snowluma/proton: workspace:*` 追加、且其 Vite 或 Vitest 設定中插件有効化也:

```ts
import { defineConfig } from 'vite';
import protobufVitePlugin from '@snowluma/proton/vite';

export default defineConfig({
    plugins: [protobufVitePlugin()],
});
```

插件入口者建構済成果物被解決為。編譯器編集後、利用側包測試前 `pnpm --filter @snowluma/proton build` 実行也。
插件無之呼出者、`@snowluma/proton/vite` 指名之診断投出也。

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

## 模式与編譯器支持

`pb<N, T>` 者単一欄位表示、`pb_repeated<N, T>` 者繰返欄位表示、`pb_optional<N, T>` 者単一欄位与明示 wire presence 為。

| 型 | TypeScript 値 | Wire 形式 |
| --- | --- | --- |
| `uint_32`, `int_32`, `sint_32` | `number` | Varint。`sint_32` 者 zigzag 使用 |
| `uint_64`, `int_64`, `sint_64` | `bigint` | Varint。`sint_64` 者 zigzag 使用 |
| `bool` | `boolean` | Varint |
| `fixed_32`, `sfixed_32`, `float` | `number` | 32 位 |
| `fixed_64`, `sfixed_64` | `bigint` | 64 位 |
| `double` | `number` | 64 位 |
| `string`, `bytes` | `string`, `Uint8Array` | 長度区切 |
| 消息 interface | 対象 | 長度区切 |

編譯器者 alias、名前空間 import、`export *`、相対及 bare 包 import、嵌套汎用模式、汎用関数与 class、転送 callback 解決也。wrapper 本体保持、生成編解碼器汎用呼出経由通過為。解決可能之 mapped、conditional、utility 型亦支持也；曖昧 union 及未解決模式者編譯時失敗也。

必要之編解碼器及 helper 単一出力也。嵌套消息編碼器者、共有出力緩衝区至計測与書込行為。返却 bytes 者、更大緩衝区之 view 可能也；独立 backing buffer 必要場合、`byteOffset` 与 `byteLength`、或 `bytes.slice()` 使用也。後続 encode 者、以前返却之 bytes 上書無也。

## Haizakura 之 wire 互換

- 素之 `pb<>` scalar 者既定値（`0`、`0n`、`false`、空文字列及空 bytes）省略也、TypeScript `?` 標記之欄位亦同。
  欠落之 optional 単一欄位者 `null` 至 decode 為。
- `pb_optional<>` 者存在之既定値出力、且 `null`/`undefined` 省略也。
  是者、全 group mute 解除必要之明示 `state=0` 保持為。
- 負之 `int_32` 値者、Haizakura 之五 byte 送信編碼保持也。解碼器者其形式及正規之十 byte 符号拡張値両者受容也。
- `uint_32` 値者、最大十 byte 之完全有効 varint 消費、下位 32 bit 保持也。tag 与長度者、有効 32 bit framing 制限之状態保持也。
- 解碼器者、切詰／溢欄位、無効境界、不正形式 group 拒否也。未知 group 者、親 frame 内 depth 制限之 skip 為。
- 未知 tag 者 non-enumerable metadata 保持、`protobuf_getUnknownFields` 及 `protobuf_getUnknownFieldMetadata` 経由取得可能也。metadata 者出現集約、消息毎最大 64 種之 field/wire 種別保持、省略種別者 payload 保持無之要約為。

以前之 runtime-map fallback 及插件 option 者削除済也。利用側者、插件用之 encode/decode 呼出編譯必要也。

## 移行監査

置換前、upstream 実装者 Proton 之 source 履歴照合検査済也。以下之挙動者回帰 test 対象也:

| Proton 之履歴 | upstream 状況／維持挙動 |
| --- | --- |
| 初期 vendor 修正（`194165f4`）及汎用 OIDB 移行（`58028123`） | alias 済 marker、嵌套汎用欄位、転送 wrapper 者、新編譯器与統合 test 対象也。 |
| barrel export（`f21740a5`）及 bare import（`994633ea`） | 新 source resolver 支持也；bundle 済 cross-file 及包 fixture 経由 test 済也。 |
| 明示 presence（`90f26ca4`） | 新 schema pipeline 至 `pb_optional` 追加、且 `?` 者 wire presence 与別保持也。 |
| 解碼器堅牢化（`b7d648ea`） | upstream 者既 varint 与欄位境界検査済也；整数境界、group 処理、制限付未知 metadata、及 legacy 送信 `int32` bytes 保持也。 |
| 拡張 `uint32`（`b53004ee`、`613b2b1e`） | upstream 者値之完全 varint 消費也；既存 QQ 回帰 fixture 保持也。 |
| cleanup（`c7428363`） | 新編譯器／source module 構成被置換済也。 |

## 検証与 layout

repository root 起点:

```sh
pnpm --filter @snowluma/proton build
pnpm --filter @snowluma/proton typecheck
pnpm --filter @snowluma/proton test
```

`test/upstream` 者、取込済編譯器、codegen 及插件 suite 含也、Haizakura 之包構成与 wire 規則対応調整済也。`test/__tests__` 者 Proton 之 wire 回帰 test 保持、移行互換 case 追加也。`packages/protocol/tests` 之利用側 test 者、建構済插件実 QQ schema 試行也。

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