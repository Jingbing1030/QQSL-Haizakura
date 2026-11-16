# 文件之流式転送


`HaizakuraHttpClient` 及 `HaizakuraWebSocketClient` 両者，増分上伝及下載 support 也。
既存 `request()`、`call()`、`raw()`、`rawResponse()`、`downloadFile()`，単一応答動作
維持也。応答複数幀含場合，以下新 method 使用下。

## 上伝

```ts
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { HaizakuraHttpClient } from '@snowluma/sdk';

const client = new HaizakuraHttpClient({ baseUrl: 'http://127.0.0.1:3000/' });
const controller = new AbortController();
const path = './photo.png';
const file = await client.uploadFileStream(
    createReadStream(path, { signal: controller.signal }),
    {
        fileSize: (await stat(path)).size,
        filename: 'photo.png',
        signal: controller.signal,
        onProgress: ({ uploadedBytes, fileSize }) => {
            console.log(`${uploadedBytes}/${fileSize}`);
        },
    },
);
console.log(file.file_path, file.file_size, file.sha256);
```

`uploadFileStream(source, options?)`，`Uint8Array`（Node.js `Buffer` 含）、`Blob`、
`ReadableStream<Uint8Array>`、或 `AsyncIterable<Uint8Array>` 受容也。字節配列及 Blob，
自身 size 提供也。流源，`fileSize` 必要也。伺服器，最初之塊受付前合計塊数必要也。
SDK，実際長宣言 size 異入力拒否也。

既定塊 size，64 KiB 也。`chunkSize`，一乃至 1048576 字節受容，各 encode 済請求，
伺服器標準 HTTP 本文制限未満保也。入力，増分読取，塊順番確認応答，`onProgress`，
続行前待機也。空文件亦 support 也。完了，別請求，**伺服器之**本地文件路径含
`UploadFileStreamComplete` 返也。本地客端文件書込或 QQ 消息送信，行無也。

省略可能設定，`filename`、`expectedSha256`、`fileRetention`（毫秒，零為伺服器失効
無効化）、及 `streamId` 也。伺服器既定保持期間，五分也。生成 ID，各上伝識別也。
明示 ID，新規必要，既存上伝而非也。此補助道具，転送再開或自動再試行，行無也。
伺服器，指定場合 `expectedSha256` 検証，SDK，完了 metadata 及返却 digest，
其期待値照合也。

`signal`，請求 cancel，読取可能源閉也。Custom 非同期可迭代場合，同一 signal 源渡，
保留中読取及 iterator 清理，cancel 時完了可能如下（`createReadStream` 例如）。
Cancel，任意 producer 自身 promise 解決強制不能也。失敗或 cancel 済上伝，確定無也。
部分伺服器上伝，伺服器空閑超時（現在十分）後失効也。此補助道具，重置請求発行或
完了伺服器文件自動削除，行無也。

## 下載

```ts
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

await pipeline(
    client.downloadFileStream(
        { file: file.file_path, chunk_size: 64 * 1024 },
        { onInfo: (info) => console.log(info.file_name, info.file_size) },
    ),
    createWriteStream('./downloaded.png'),
);
```

`downloadFileStream(params, options?)`，`Uint8Array` 塊生成，iterator 最終値
`DownloadFileStreamComplete` 返也。`for await` 及 `pipeline()`，塊消費完了検証，
但其戻値破棄也。最終結果自 `total_bytes` 及 `total_chunks` 必要場合，`iterator.next()`
手動呼出下。`onInfo`，文件字節生成前実行也。

Parameter，伺服器側 `file` 或 `file_id`、及省略可能 `chunk_size` 受容也。`action`
option，`download_file_stream`（既定）、`download_file_image_stream`、或
`download_file_record_stream` 選択也。

此補助道具，base64 decode，塊順序、塊長、最終件数確認也。初期文件 size 零場合，
size 不明意味場合有，但最終字節数及塊数合計，仍一致必要也。Metadata 欠落、不正幀、
切詰、伺服器障害，throw 也。既消費字節，rollback 無也。永続出力，暫定文件書込，
反復成功後名前変更下。

## 個々之幀

```ts
for await (const frame of client.stream('test_download_stream', {})) {
    console.log(frame.type, frame.data_type);
}

for await (const response of client.requestStream('test_download_stream', {})) {
    console.log(response.status, response.retcode, response.data);
}
```

- `requestStream()`，応答 envelope 生成，最終失敗 envelope 含也。
- `stream()`，型付 payload 生成，失敗 envelope（以前塊之後錯誤含）対，
  `HaizakuraApiError`（或其認証 subtype）throw 也。
- 両者，五之流式動作（三下載、`test_download_stream`、`upload_file_stream`）
  support 也。各上伝請求，一確認応答僅返，`type: 'stream'` 塊 ACK 含也。低水準
  呼出元，別請求確定必要也。重置，伺服器既存失敗 envelope 動作維持也。
- `AbortSignal`、`echo`、`timeoutMs`，通常請求同様機能也。超時，active 流式請求
  （WebSocket 接続 setup 含）対象，上伝，各塊／確定請求適用也。零，超時無効化也。
  源流読取及 application callback，請求超時計測対象外也。
- 反復停止，客端 resource 解放也。HTTP，応答本文亦 cancel 也。WebSocket，共有
  socket 閉無而，其請求収集停止也。Protocol，請求単位下載 cancel 消息無，故伺服器，
  残幀送信継続可能性有也。転送，一意 echo 使用下。遅延幀仍到着可能性有間，中断済
  転送之 echo 再利用無下。
- WebSocket 切断，active 転送失敗也。再接続，之再生無也。
- `maxBufferBytes`，既定 32 MiB，各 HTTP 幀或 queue 入 WebSocket payload 制限也。
  `maxBufferedFrames`，WebSocket 既定 256 也。Overflow，幀破棄或全文件緩衝而非，
  throw 也。HTTP 読取，消費追随也。WebSocket，請求単位背圧無，故低速宛先之
  大下載，HTTP 推奨也。

全新型，`@snowluma/sdk` 及 `@snowluma/sdk/types` 自 export 也。Custom
`HaizakuraApiClient` subclass，`requestStream()` 実装依 opt-in 可能也。請求専用
subclass，仍 互換，流式試行場合，明示非 support 錯誤受也。
