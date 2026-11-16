# メディア送信、引用返信、イベント待機


これらのヘルパーは追加的なものです。既存の文字列メディアパスは引き続き Haizakura サーバーを参照し、`context.reply()` は引き続き通常の返信を送信し、既存のイベント購読とミドルウェアは動作を維持します。

## ローカルメディアの送信

HTTP クライアントと WebSocket クライアントの両方が `sendGroupImage`、`sendPrivateImage`、`sendGroupRecord`、`sendPrivateRecord`、`sendGroupVideo`、`sendPrivateVideo`、`sendGroupFile`、`sendPrivateFile` を提供します。

```ts
import { HaizakuraHttpClient } from '@snowluma/sdk';
import { localFile } from '@snowluma/sdk/node';

const bot = new HaizakuraHttpClient({ baseUrl: 'http://127.0.0.1:3000/' });
const receipt = await bot.sendGroupImage(12345, await localFile('./picture.png'), {
    image: { summary: 'Picture' },
    onProgress: ({ uploadedBytes, fileSize }) => {
        console.log(`${uploadedBytes}/${fileSize} bytes uploaded`);
    },
});
console.log(receipt.message_id);

await bot.sendPrivateFile(67890, await localFile('./report.pdf'), { name: 'Report.pdf' });
```

ソースは `Uint8Array`（Node の `Buffer` を含む）、`Blob` / ブラウザーの `File`、`ReadableStream<Uint8Array>`、または `AsyncIterable<Uint8Array>`（バイトモードの Node readable を含む）でかまいません。ストリームと非同期イテラブルには `fileSize` が必要です。`{ source, filename }` ラッパーは、バイトソースを変更せずに名前を指定します。ブラウザーの `File` の名前は推論されます。明示的な `filename` オプションはそれを上書きします。

`localFile(pathOrFileURL)` は **`@snowluma/sdk/node` からのみ** 利用できます。ファイル全体をメモリに読み込むことなく、名前付きのファイルベースの Blob を返します。ファイルは送信が完了するまで変更されてはなりません。存在しないファイル、通常ファイルでないファイル、変更されたファイルはエラーを発生させます。ルートおよびブラウザー向けのエントリーポイントは Node のファイルシステムモジュールをインポートしません。ブラウザーは選択した `File` をそのまま渡すことができます。

これらのヘルパーはすべてのチャンクの確認応答とアップロードの完了を待ってから、返された **サーバーパス** を最終アクションで使用します。画像、レコード、動画のメソッドは通常の `{ message_id }` の結果を返します。ファイルのメソッドは既存のファイル公開アクションを呼び出し、`{ file_id }` を返します。`sendGroupFile` は `folder` / `folderId` を受け付けます。ファイルのメソッドは表示用の `name` を受け付け、既定ではアップロードされた名前になります。メディア属性は `image`、`record`、`video` の下に置かれます。`video.thumb` のパスは引き続きサーバーを参照し、自動的にアップロードされることはありません。

すべての[アップロードオプション](STREAMING.md)が適用され、`chunkSize`、`expectedSha256`、`fileRetention`、`signal`、`onProgress` が含まれます。進捗は、メッセージの配信ではなく、確認応答済みのアップロードバイト数を測定します。`timeoutMs` は **アップロードリクエストごとおよび最終送信リクエストごと** のタイムアウトであり、操作全体やソースの読み取りの期限ではありません。全体的なキャンセルポリシーには、独自の期限を伴う `AbortSignal` を使用してください。

```ts
import { HaizakuraMediaSendError } from '@snowluma/sdk';

try {
    await bot.sendPrivateImage(67890, new Uint8Array([/* image bytes */]), {
        signal: AbortSignal.timeout(60_000),
    });
} catch (error) {
    if (error instanceof HaizakuraMediaSendError) {
        console.error(error.stage, error.cause);
        // error.upload contains completion metadata if uploading finished.
    }
    throw error;
}
```

エラーは `stage: 'upload' | 'send'`、元の `cause`（API、中断、タイムアウトのエラーを含む）、および利用可能な場合は完了したアップロードのメタデータを伴います。ステージ間のキャンセルは送信を防ぎます。ディスパッチ後のキャンセルやタイムアウトは、サーバーが送信に失敗したことを証明しません。自動再試行、ロールバック、リモート削除はありません。リモートの保持期間と部分アップロードの失効は、引き続き既存のアップロードサービスによって制御されます。付随するランタイム修正は、失敗したグループファイルのチャット公開をエラーとして報告し、アップロードされたファイル ID をエラーコンテキストに保持します。その失敗後に成功を返すことはなくなりました。

## メッセージを明示的に引用する

```ts
import { HaizakuraWebSocketClient, quoteMessage, text } from '@snowluma/sdk';

const bot = new HaizakuraWebSocketClient();
bot.onGroupMessage(async (event, context) => {
    if (event.post_type === 'message' && event.raw_message === '/ping') {
        await context.quote(text('pong'));
    }
});
await bot.connect();

// HTTP clients or code outside an event handler can compose the same quote.
await bot.sendGroupMessage(12345, quoteMessage(-42, 'Reply body'));
```

`context.quote()` はイベントのグループまたはプライベートの会話にルーティングし、そのメッセージ ID を使用します。メッセージ以外のイベントは拒否します。ID は非ゼロの符号付き 32 ビット整数であり、負の ID は保持されます。`quoteMessage(id, body, options?)` は `@snowluma/sdk/messages` からもエクスポートされ、リクエストを行わずに内容を構成するだけです。

本文は文字列、CQ 文字列、セグメント、セグメントの配列、メッセージチェーンを受け付けます。文字列の CQ 内容は元のフィールドとエスケープを保持します。`autoEscape: true` の場合、文字列は引用に続くリテラルテキストになります。配列とチェーンは構造化されたままです。すでに返信セグメントを含む本文は拒否され、入力は変更されません。これは参照されたメッセージを取得しません。サーバーがその ID を解決できる必要があります。

古い `HaizakuraEventContext` オブジェクトと明示的に型付けされたハンドラーは引き続き有効です。SDK が作成したコンテキストと推論されたクライアントコールバックは `HaizakuraEventContextWithQuote` を公開します。再利用可能な新しいハンドラーに注釈を付けるには、`EventHandler<MyEvent, HaizakuraEventContextWithQuote<MyEvent>>`（または `EventMiddleware` / `CommandHandler` の対応するコンテキストパラメーター）を使用してください。

## 将来のイベントを待機する

QQ によって自動返信としてマークされたプライベートメッセージは、ライブイベントとフレンド履歴で `auto_reply: true` を持ちます。それらをフィルタリングするには `event.auto_reply === true` を確認してください。Haizakura は、送信者が入力したリテラルの `[自动回复]` を含め、返信テキストを保持します。ローカルに保存された古いメッセージにはこのフラグがない場合があります。

`waitForEvent(predicate?, options?)` と `waitForMessage(predicate?, options?)` は WebSocket クライアントで利用できます。どちらもオプションオブジェクトのみを受け付けます。同期の型ガード述語は解決される型を絞り込みます。真偽値の述語はより狭い型を主張せずにフィルタリングします。

```ts
const controller = new AbortController();
await bot.connect();
try {
    // Register before sending so a fast reply cannot arrive before the listener.
    const reply = bot.waitForMessage(
        (event) => event.post_type === 'message'
            && event.message_type === 'private'
            && event.user_id === 67890,
        { timeoutMs: 30_000, signal: controller.signal },
    );
    const [incoming] = await Promise.all([
        reply,
        bot.sendPrivateMessage(67890, 'Ready?', { signal: controller.signal }),
    ]);
    console.log(incoming.raw_message);
} finally {
    controller.abort(); // Also releases the wait if sending failed first.
}
```

待機は同期的に登録され、接続、履歴の再生、他のリスナーからのイベントの消費、再接続をまたぐ永続化を行いません。待機は `onEvent` と同じ公開イベントストリームを、**ミドルウェアの後で** 観測します。ミドルウェアによって停止されたイベントは見えません。`waitForMessage` は `message` と `message_sent` の両方を含むため、必要に応じて方向、会話、送信者でフィルタリングしてください。複数の待機が同じイベントから解決されることがあります。

既定のタイムアウトはクライアントの `requestTimeoutMs`（既定では 30 秒）です。`0` はそれを無効にします。タイムアウトは `HaizakuraTimeoutError` で拒否し、キャンセルは `HaizakuraAbortError` で、切断または明示的な `close()` は `HaizakuraConnectionError` で拒否します。述語の例外は元のエラーで拒否します。すべての完了経路は、そのリスナー、中断ハンドラー、タイマーを削除します。キャンセルは待機にのみ影響し、クライアントを閉じたり、送信済みメッセージを取り消したりしません。

## Qzone のコメントに返信する

両方のクライアントは、型付けされた `raw('comment_qzone', params)` アクションを通じてこれを公開します。`comment_id` と `comment_uin` を省略すると、画像アップロードを含む通常のコメントが保持されます。`target_uin` は常に **投稿の所有者** を識別し、返信対象の人ではありません。

親コメントの `comment_id` と `uin` を取得するには `get_qzone_msg_detail` を読み取ってください。両方を渡すと、そのコメントの下にテキスト返信が作成されます。`"0"` は有効なコメント ID です。スレッド内の特定の相手に宛てるには、その `uin` と `name` を `reply_uin` と `reply_name` として渡してください。

```ts
const result = await bot.raw('comment_qzone', {
  tid: post.tid,
  target_uin: postOwnerUin,
  comment_id: parentComment.comment_id,
  comment_uin: parentComment.uin,
  reply_uin: selectedReply.uin,
  reply_name: selectedReply.name,
  content: 'Thanks for the explanation!',
});
console.log(result.comment_id, result.parent_comment_id);
```

上記の `post`、`postOwnerUin`、`parentComment`、`selectedReply` は、呼び出し元が選択した投稿とコメントです。親への通常の返信では、`reply_uin` と `reply_name` を省略してください。ネストされた返信では、**最上位の親** を `comment_id`/`comment_uin` に保持してください。ネストされた返信自身の ID で置き換えないでください。新しいサーバーは、この関連付けを保持するために、各インライン返信に `parent_comment_id` と `parent_comment_uin` も含めます。インライン返信は不完全な場合があります。ページに存在しないことは、コメントが削除されたことを意味しません。

成功時、`comment_id` は **新しい返信の** ID であり、結果にはその親 ID と作成者が含まれます。これらの親フィールドは、古いサーバーとの互換性のために SDK の型では省略可能です。親コメントを伴う空でない `images` はアップロード前に拒否されます。スレッド返信は現在テキストのみをサポートしています。受信者／親のパラメーターが不完全な場合はエラーとなり、失敗した返信が通常のコメントにフォールバックしたり、自動的に再試行されたりすることは決してありません。送信後に確認応答が不正な形式である場合は、再試行する前にスレッドを確認してください。返信がすでに存在する可能性があります。

## 構造化された Qzone フレンドフィードを読む

`get_qzone_feeds` は `page_num`、`count`、`feeds`、`has_more`、および各フィードの
元の `html` を保持します。新しいサーバーは `tid`、`content`、`content_complete`、
`images`、`like_count`、`comment_count` も返します。`null` 値は、ソースがその
フィールドを確立しなかったことを意味し、ゼロや空の投稿を意味するものではありません。
折りたたまれた抜粋は `content_complete: false` を持ちます。画像は投稿本文で利用可能な
画像のみを対象とし、アバター、コメントの画像、動画のカバーを除外します。完全な
アルバム一覧ではありません。投稿以外のフィード種別には `tid` がない場合があります。

同じアカウントで続行するには、返された `next_cursor` をそのまま使用してください。

```ts
let cursor: string | undefined;
while (true) {
    const page = await bot.raw('get_qzone_feeds', { count: 10, cursor });
    for (const feed of page.feeds) {
        console.log(feed.content, feed.images);
    }
    if (!page.has_more) {
        break;
    }
    if (!page.next_cursor) {
        throw new Error('This server did not provide a continuation cursor');
    }
    cursor = page.next_cursor;
}
```

カーソルを使用する場合は `page_num` を省略するか、対応するページ番号を指定してください。
カーソルなしでより後の `page_num` を要求すると、先頭から以前のページをたどるため
時間がかかる場合があります。末尾を超えて要求すると空のページが返されます。サービスは
`count` より少ないエントリーを返す場合があり、続きを伴う空の途中ページも含まれます。
配列の長さではなく `has_more` と `next_cursor` に従ってください。不正なカーソル、
他アカウントのカーソル、停止したカーソルは可視的に失敗します。結果は凍結された
スナップショットではなくライブのフィードを反映するため、投稿がリクエスト間で
変化する可能性があります。

追加された結果フィールドは SDK の型では省略可能であり、古いサーバーと既存の
利用者が作成した結果オブジェクトが引き続きサポートされます。MCP は `get_action` を
通じて同じフィールドとカーソルの例を発見し、`query_action` を通じてこの読み取り専用
アクションを呼び出します。その既存のモード制限は変更されていません。
