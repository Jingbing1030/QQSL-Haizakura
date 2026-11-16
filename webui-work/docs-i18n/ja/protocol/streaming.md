# ファイルのストリーミング


`HaizakuraHttpClient` と `HaizakuraWebSocketClient` の両方が、増分アップロードと
ダウンロードをサポートします。既存の `request()`、`call()`、`raw()`、`rawResponse()`、
`downloadFile()` は単一レスポンスの動作を維持します。レスポンスが複数のフレームを
含む場合は、以下の新しいメソッドを使用してください。

## アップロード

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

`uploadFileStream(source, options?)` は `Uint8Array`（Node.js の `Buffer` を含む）、
`Blob`、`ReadableStream<Uint8Array>`、または `AsyncIterable<Uint8Array>` を
受け付けます。バイト配列と Blob は自身のサイズを提供します。ストリームソースには
`fileSize` が必要です。サーバーは最初のチャンクを受け付ける前に合計チャンク数を
必要とします。SDK は、実際の長さが宣言されたサイズと異なる入力を拒否します。

既定のチャンクサイズは 64 KiB です。`chunkSize` は 1 から 1048576 バイトまでを
受け付け、各エンコードされたリクエストをサーバーの標準 HTTP 本文制限未満に
保ちます。入力は増分的に読み取られ、チャンクは順番に確認応答され、`onProgress` は
続行前に待機されます。空のファイルもサポートされます。完了は別のリクエストであり、
**サーバーの** ローカルファイルパスを含む `UploadFileStreamComplete` を返します。
ローカルのクライアントファイルを書き込んだり、QQ メッセージを送信したりはしません。

省略可能な設定は `filename`、`expectedSha256`、`fileRetention`（ミリ秒、ゼロで
サーバーの失効を無効化）、および `streamId` です。サーバーの既定の保持期間は
5 分です。生成された ID は各アップロードを識別します。明示的な ID は新規でなければ
ならず、既存のアップロードであってはなりません。このヘルパーは転送を再開したり
自動的に再試行したりしません。サーバーは指定された場合に `expectedSha256` を検証し、
SDK は完了したメタデータと返されたダイジェストをその期待値と照合します。

`signal` はリクエストをキャンセルし、読み取り可能なソースを閉じます。カスタムの
非同期イテラブルの場合は、同じシグナルをソースに渡し、保留中の読み取りとイテレーターの
クリーンアップがキャンセル時に完了できるようにしてください（`createReadStream` の
例がそうしているように）。キャンセルは、任意のプロデューサーに自身の promise を
解決させることを強制できません。失敗またはキャンセルされたアップロードは確定されません。
部分的なサーバーアップロードは、サーバーのアイドルタイムアウト（現在は 10 分）後に
失効します。このヘルパーはリセットリクエストを発行したり、完了したサーバーファイルを
自動的に削除したりしません。

## ダウンロード

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

`downloadFileStream(params, options?)` は `Uint8Array` のチャンクを生成し、
イテレーターの最終値として `DownloadFileStreamComplete` を返します。`for await` と
`pipeline()` はチャンクを消費して完了を検証しますが、その戻り値は破棄します。最終結果
から `total_bytes` と `total_chunks` が必要な場合は、`iterator.next()` を手動で
呼び出してください。`onInfo` はファイルのバイトが生成される前に実行されます。

パラメーターはサーバー側の `file` または `file_id`、および省略可能な `chunk_size` を
受け付けます。`action` オプションは `download_file_stream`（既定）、
`download_file_image_stream`、または `download_file_record_stream` を選択します。

このヘルパーは base64 をデコードし、チャンクの順序、チャンクの長さ、最終的な件数を
確認します。初期ファイルサイズがゼロの場合はサイズ不明を意味することがありますが、
最終的なバイト数とチャンク数の合計は依然として一致しなければなりません。メタデータの
欠落、不正なフレーム、切り詰め、サーバー障害はスローされます。すでに消費された
バイトはロールバックされません。永続的な出力には、一時ファイルに書き込み、反復が
成功した後に名前を変更してください。

## 個々のフレーム

```ts
for await (const frame of client.stream('test_download_stream', {})) {
    console.log(frame.type, frame.data_type);
}

for await (const response of client.requestStream('test_download_stream', {})) {
    console.log(response.status, response.retcode, response.data);
}
```

- `requestStream()` はレスポンスエンベロープを生成し、最終的な失敗エンベロープも含みます。
- `stream()` は型付きペイロードを生成し、失敗したエンベロープ（以前のチャンクの後の
  エラーを含む）に対して `HaizakuraApiError`（またはその認証サブタイプ）をスローします。
- どちらも 5 つのストリーミングアクション（3 つのダウンロード、`test_download_stream`、
  `upload_file_stream`）をサポートします。各アップロードリクエストは 1 つの確認応答
  のみを返し、`type: 'stream'` のチャンク ACK も含みます。低レベルの呼び出し元は
  別のリクエストで確定する必要があります。リセットはサーバーの既存の失敗エンベロープ
  の動作を維持します。
- `AbortSignal`、`echo`、`timeoutMs` は通常のリクエストと同様に機能します。タイムアウトは
  アクティブなストリーミングリクエスト（WebSocket 接続のセットアップを含む）を対象とし、
  アップロードでは各チャンク／確定リクエストに適用されます。ゼロはタイムアウトを
  無効にします。ソースの読み取りとアプリケーションのコールバックは、リクエストの
  タイムアウトでは計測されません。
- 反復を停止するとクライアントのリソースが解放されます。HTTP はレスポンス本文も
  キャンセルします。WebSocket は共有ソケットを閉じることなくそのリクエストの収集を
  停止します。プロトコルにはリクエスト単位のダウンロードキャンセルメッセージが
  ないため、サーバーは残りのフレームを送信し続ける可能性があります。転送には一意の
  echo を使用してください。遅延したフレームがまだ到着する可能性がある間は、中断した
  転送の echo を再利用しないでください。
- WebSocket の切断はアクティブな転送を失敗させます。再接続してもそれらは再生されません。
- `maxBufferBytes` は既定で 32 MiB であり、各 HTTP フレームまたはキューに入れられた
  WebSocket ペイロードを制限します。`maxBufferedFrames` は WebSocket で既定 256 です。
  オーバーフローは、フレームを破棄したりファイル全体をバッファリングしたりするのでは
  なく、スローします。HTTP の読み取りは消費に追随します。WebSocket にはリクエスト
  単位のバックプレッシャーがないため、低速な宛先への大きなダウンロードには HTTP を
  推奨します。

すべての新しい型は `@snowluma/sdk` と `@snowluma/sdk/types` からエクスポートされます。
カスタムの `HaizakuraApiClient` サブクラスは `requestStream()` を実装することで
オプトインできます。リクエスト専用のサブクラスは引き続き互換であり、ストリーミングを
試みた場合は明示的な非サポートエラーを受け取ります。
