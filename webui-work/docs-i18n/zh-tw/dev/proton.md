# Haizakura Proton


Haizakura 的編譯期 protobuf 編解碼器。TypeScript schema 與泛型呼叫會被編譯成特化的編碼器與解碼器，執行期無需查詢 schema。

源自 [Haizakura/protobuf-dsl](https://github.com/Haizakura/protobuf-dsl)
（`protobuf-fastdsl`，commit `22e382a`），其 README 宣告為 MIT 授權。
Haizakura 保留 `@snowluma/proton` 套件名稱、manifest，以及下述的 wire 相容性規則。

## 設定

在消費端套件的相依中加入 `@snowluma/proton: workspace:*`，並在其 Vite 或 Vitest 設定中啟用外掛：

```ts
import { defineConfig } from 'vite';
import protobufVitePlugin from '@snowluma/proton/vite';

export default defineConfig({
    plugins: [protobufVitePlugin()],
});
```

外掛進入點解析到已建置的產物。編輯編譯器後，請先執行
`pnpm --filter @snowluma/proton build`，再測試消費端套件。
未使用外掛的呼叫會擲回診斷，並指出 `@snowluma/proton/vite`。

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

## Schema 與編譯器支援

`pb<N, T>` 標記單一欄位，`pb_repeated<N, T>` 標記載重複欄位，
而 `pb_optional<N, T>` 讓單一欄位具備明確的 wire presence。

| 型別 | TypeScript 值 | Wire 格式 |
| --- | --- | --- |
| `uint_32`, `int_32`, `sint_32` | `number` | Varint；`sint_32` 使用 zigzag |
| `uint_64`, `int_64`, `sint_64` | `bigint` | Varint；`sint_64` 使用 zigzag |
| `bool` | `boolean` | Varint |
| `fixed_32`, `sfixed_32`, `float` | `number` | 32-bit |
| `fixed_64`, `sfixed_64` | `bigint` | 64-bit |
| `double` | `number` | 64-bit |
| `string`, `bytes` | `string`, `Uint8Array` | Length-delimited |
| Message 介面 | Object | Length-delimited |

編譯器會解析別名、命名空間匯入、`export *`、相對與裸套件匯入、巢狀泛型 schema、泛型函式與類別，以及轉送的 callback。它會保留 wrapper 主體，並讓產生的編解碼器通過泛型呼叫。它也支援可解析的 mapped、conditional 與 utility 型別；有歧義的 union 與無法解析的 schema 會在編譯期間失敗。

只會產生必要的編解碼器與輔助函式。巢狀 message 編碼器會測量並寫入共用的輸出緩衝區。回傳的位元組可能是較大緩衝區的檢視；需要獨立的底層緩衝區時，請使用 `byteOffset` 與 `byteLength`，或 `bytes.slice()`。後續的編碼不會覆寫先前回傳的位元組。

## Haizakura wire 相容性

- 純 `pb<>` 純量會省略預設值（`0`、`0n`、`false`、空字串與空位元組），包括以 TypeScript `?` 標記的欄位。缺少的選用單一欄位會解碼為 `null`。
- `pb_optional<>` 會輸出存在的預設值，同時省略 `null`/`undefined`。
  這保留了停用全群禁言所需的明確 `state=0`。
- 負的 `int_32` 值保留 Haizakura 的五位元組輸出編碼。解碼器同時接受該形式與標準的十位元組符號擴充值。
- `uint_32` 值會消費完整有效的 varint（最多十位元組），並保留低 32 位元。標籤與長度仍限制在有效的 32 位元訊框範圍內。
- 解碼器會拒絕截斷/溢位的欄位、無效的邊界與格式錯誤的 group。未知的 group 會在其父訊框內以有界深度略過。
- 未知的標籤會保留不可列舉的中介資料，可透過
  `protobuf_getUnknownFields` 與 `protobuf_getUnknownFieldMetadata` 取得。中介資料會彙總出現次數，每則 message 最多保留 64 種欄位/wire 類型，並摘要被省略的類型而不保留其 payload。

先前的執行期 map 退回機制與外掛選項已被移除。消費端必須使用此外掛編譯 encode/decode 呼叫。

## 遷移稽核

上游實作在替換前曾對照 Proton 的原始碼歷史進行檢查。以下行為由回歸測試涵蓋：

| Proton 歷史 | 上游狀態 / 保留的行為 |
| --- | --- |
| 初始 vendor 修正（`194165f4`）與泛型 OIDB 遷移（`58028123`） | 別名標記、巢狀泛型欄位與轉送的 wrapper 由新的編譯器與整合測試涵蓋。 |
| Barrel 匯出（`f21740a5`）與裸匯入（`994633ea`） | 由新的來源解析器支援；透過隨附的跨檔案與套件 fixture 測試。 |
| 明確 presence（`90f26ca4`） | 在新的 schema 管線中加入 `pb_optional`，並讓 `?` 與 wire presence 保持分離。 |
| 解碼器強化（`b7d648ea`） | 上游已檢查 varint 與欄位邊界；保留整數邊界、group 處理、有界的未知中介資料與舊式輸出的 `int32` 位元組。 |
| 擴充的 `uint32`（`b53004ee`、`613b2b1e`） | 上游會消費完整的值 varint；保留既有的 QQ 回歸 fixture。 |
| 清理（`c7428363`） | 由新的編譯器/來源模組結構取代。 |

## 驗證與佈局

從儲存庫根目錄：

```sh
pnpm --filter @snowluma/proton build
pnpm --filter @snowluma/proton typecheck
pnpm --filter @snowluma/proton test
```

`test/upstream` 包含匯入的編譯器、codegen 與外掛測試套件，並針對 Haizakura 的套件佈局與 wire 規則調整。`test/__tests__` 保留 Proton 的 wire 回歸測試，並加入遷移相容性案例。`packages/protocol/tests` 中的消費端測試以已建置的外掛實際演練真實的 QQ schema。

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
