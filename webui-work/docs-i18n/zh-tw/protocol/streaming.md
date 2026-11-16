# 串流檔案


`HaizakuraHttpClient` 與 `HaizakuraWebSocketClient` 都支援增量上傳與下載。既有的 `request()`、`call()`、`raw()`、`rawResponse()` 與 `downloadFile()` 仍維持單一回應的行為。當回應包含多個訊框時，請使用下列新方法。

## 上傳

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

`uploadFileStream(source, options?)` 接受 `Uint8Array`（包含 Node.js 的 `Buffer`）、`Blob`、`ReadableStream<Uint8Array>` 或 `AsyncIterable<Uint8Array>`。位元組陣列與 blob 會自帶大小。串流來源必須提供 `fileSize`：伺服器在接受第一個區塊之前，需要知道總區塊數。若輸入的實際長度與宣告的大小不符，SDK 會加以拒絕。

預設區塊大小為 64 KiB。`chunkSize` 接受 1 到 1048576 位元組，讓每個編碼後的請求都低於伺服器標準的 HTTP 本文上限。輸入採增量讀取；區塊會依序確認，且 `onProgress` 會被等待完成後才繼續。支援空檔案。完成是另一個獨立請求，會傳回 `UploadFileStreamComplete`，其中包含**伺服器的**本機檔案路徑；它不會寫入用戶端本機檔案，也不會傳送 QQ 訊息。

選用設定有 `filename`、`expectedSha256`、`fileRetention`（毫秒；
零表示停用伺服器端到期）與 `streamId`。伺服器預設保留時間為五分鐘。每次上傳都會由產生的 ID 識別；明確指定的 ID 必須是全新的，不能是既有上傳。此輔助方法不會續傳，也不會自動重試傳輸。伺服器會在提供 `expectedSha256` 時加以驗證；SDK 則會以該期望值比對完成後的中繼資料與傳回的摘要。

`signal` 會取消請求並關閉可讀來源。對於自訂的非同步可迭代物件，請把同一個 signal 傳給來源，並確保待處理的讀取與迭代器清理能在取消時完成（如 `createReadStream` 範例所示）。取消無法強迫任意產生者解決其自身的 promise。失敗或取消的上傳不會被定案；伺服器上的部分上傳會在伺服器的閒置逾時（目前為十分鐘）後到期。此輔助方法不會發出重設請求，也不會自動刪除伺服器上已完成的檔案。

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

`downloadFileStream(params, options?)` 會產生 `Uint8Array` 區塊，並以迭代器的最終值傳回 `DownloadFileStreamComplete`。`for await` 與 `pipeline()` 會取用區塊並驗證完成，但會丟棄該傳回值；若你需要最終結果中的 `total_bytes` 與 `total_chunks`，請手動呼叫 `iterator.next()`。`onInfo` 會在任何檔案位元組產生之前執行。

參數接受伺服器端的 `file` 或 `file_id`，以及選用的 `chunk_size`。`action` 選項可選擇 `download_file_stream`（預設）、`download_file_image_stream` 或 `download_file_record_stream`。

此輔助方法會解碼 base64，並檢查區塊順序、區塊長度與最終數量。初始檔案大小為零可能代表大小未知；最終的位元組與區塊總數仍必須相符。中繼資料缺失、訊框格式錯誤、截斷與伺服器失敗都會擲出錯誤；已取用的位元組不會回復。若要取得耐用的輸出，請先寫入暫存檔案，並在迭代成功後重新命名。

## 個別訊框

```ts
for await (const frame of client.stream('test_download_stream', {})) {
    console.log(frame.type, frame.data_type);
}

for await (const response of client.requestStream('test_download_stream', {})) {
    console.log(response.status, response.retcode, response.data);
}
```

- `requestStream()` 會產生回應封套，包括最後的失敗封套。
- `stream()` 會產生型別化的酬載，並對失敗的封套擲出 `HaizakuraApiError`（或其驗證子型別），包括在較早區塊之後才出現的錯誤。
- 兩者都支援五種串流動作：三種下載、`test_download_stream` 與 `upload_file_stream`。每個上傳請求只會傳回一個確認，包括 `type: 'stream'` 的區塊 ACK。低階呼叫端必須以另一個請求完成定案。重設仍保留伺服器既有的失敗封套行為。
- `AbortSignal`、`echo` 與 `timeoutMs` 的運作方式與一般請求相同。逾時涵蓋進行中的串流請求（包括 WebSocket 連線建立）；上傳則套用於每個區塊／定案請求。零表示停用逾時。來源讀取與應用程式回呼不受請求逾時計時。
- 停止迭代會釋放用戶端資源。HTTP 也會取消其回應本文。WebSocket 會停止收集該請求，但不會關閉共用的 socket；協定沒有針對個別請求的下載取消訊息，因此伺服器可能繼續送出剩餘訊框。傳輸請使用唯一的 echo；在延遲訊框仍可能到達時，不要重複使用已中止傳輸的 echo。
- WebSocket 斷線會使進行中的傳輸失敗；重新連線不會重播它們。
- `maxBufferBytes` 預設為 32 MiB，用於限制每個 HTTP 訊框或排隊中的 WebSocket 酬載。`maxBufferedFrames` 對 WebSocket 預設為 256。溢位時會擲出錯誤，而不是捨棄訊框或緩衝整個檔案。HTTP 的讀取會跟著取用速度進行；WebSocket 沒有個別請求的背壓，因此若要下載大檔案到慢速目的地，建議改用 HTTP。

所有新型別都會從 `@snowluma/sdk` 與 `@snowluma/sdk/types` 匯出。自訂的 `HaizakuraApiClient` 子類別可透過實作 `requestStream()` 選擇加入；僅支援請求的子類別仍保持相容，若嘗試串流會收到明確的不支援錯誤。