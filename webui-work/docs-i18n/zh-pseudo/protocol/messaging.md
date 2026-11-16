# 媒体送信、引用返信、及事件待機


此等補助道具、追加性也。既存文字列媒体路径、仍 Haizakura 伺服器参照、`context.reply()` 仍通常返信送信、既存事件購読及中間件、其動作維持也。

## 本地媒体之送信

HTTP 及 WebSocket 客端両者、提供 `sendGroupImage`、`sendPrivateImage`、`sendGroupRecord`、`sendPrivateRecord`、`sendGroupVideo`、`sendPrivateVideo`、`sendGroupFile`、及 `sendPrivateFile`。

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

源，`Uint8Array`（Node `Buffer` 含）、`Blob` / 瀏覧器 `File`、`ReadableStream<Uint8Array>`、或 `AsyncIterable<Uint8Array>`（字節模式 Node readable 含）可也。流及非同期可迭代，`fileSize` 必要也。`{ source, filename }` 包装器，字節源変更無而名前供給也。瀏覧器 `File` 之名，推論為。明示 `filename` option 之覆写也。

`localFile(pathOrFileURL)`，**`@snowluma/sdk/node` 自僅**利用可能也。全文件読込記憶体内無，有名文件基礎 Blob 返却為。文件，送信完了迄変更無必要也。不存在文件、非通常文件、或変更文件，錯誤発生也。根及瀏覧器向端点，Node 文件系統 module import 無也。瀏覧器，選択 `File` 直接渡可能也。

此等補助道具，全塊確認応答及上伝完了待，然後返却之 **伺服器路径** 最終動作使用也。画像、録音、動画 method，通常 `{ message_id }` 結果返却。文件 method，既存文件公開動作呼出，`{ file_id }` 返却也。`sendGroupFile`，`folder` / `folderId` 受容。文件 method，表示用 `name` 受容，既定上伝名也。媒体属性，`image`、`record`、或 `video` 下置也。`video.thumb` 路径，仍伺服器参照，自動上伝無也。

全[上伝選択肢](STREAMING.md)適用，`chunkSize`、`expectedSha256`、`fileRetention`、`signal`、`onProgress` 含也。進捗，消息配信而非，確認応答済上伝字節数測定也。`timeoutMs`，**上伝請求毎及最終送信請求毎**之超時也，操作全体或源流読取之期限而非也。全体 cancel 方針，独自期限伴 `AbortSignal` 使用下。

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

錯誤，`stage: 'upload' | 'send'`、元之 `cause`（API、中断、超時錯誤含）、及利用可能場合完了上伝 metadata 伴也。段階間 cancel，送信防也。Dispatch 後 cancel 或超時，伺服器送信失敗証明無也。自動再試行、回滾、遠隔削除，無也。遠隔保持期間及部分上伝失効，仍既存上伝 service 依制御也。附随実行時修正，失敗集団文件 chat 公開，錯誤報告，上伝 file ID 錯誤 context 保持也。其失敗後成功返却，不再也。

## 消息之明示引用

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

`context.quote()`，事件之集団或私密会話 routing，其消息 ID 使用也。消息以外事件拒否。ID，非零符号付 32 bit 整数，負 ID 保持也。`quoteMessage(id, body, options?)`，`@snowluma/sdk/messages` 自亦 export，請求行無内容構成僅也。

本文，文字列、CQ 文字列、段、段配列、消息 chain 受容。文字列 CQ 内容，元 field 及 escape 保持。`autoEscape: true` 場合，文字列，引用之後之実文字 text 為也。配列及 chain，構造化残也。既返信段含本文拒否，入力変更無也。此，参照消息取得無也。伺服器，其 ID 解決可能必要也。

旧 `HaizakuraEventContext` object 及明示型付 handler，仍有効也。SDK 作成 context 及推論客端回呼，`HaizakuraEventContextWithQuote` 公開。再利用可能新 handler 注釈付，`EventHandler<MyEvent, HaizakuraEventContextWithQuote<MyEvent>>`（或 `EventMiddleware` / `CommandHandler` 之対応 context 引数）使用下。

## 未来事件之待機

QQ 依自動返信 mark 私密消息，生事件及 friend 履歴 `auto_reply: true` 持也。之 filter，`event.auto_reply === true` 確認下。Haizakura，送信者入力 literal `[自动回复]` 含，返信 text 保持也。本地保存旧消息，此 flag 欠落場合有。

`waitForEvent(predicate?, options?)` 及 `waitForMessage(predicate?, options?)`，WebSocket 客端利用可能也。両者，option object 僅亦受容。同期型守述語，解決型窄化。真偽値述語，更狭型主張無而 filter 也。

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

待機，同期登録，接続、履歴再生、他聴者自事件消費、再接続跨永続化，行無也。待機，`onEvent` 同公開事件流，**中間件之後**観測也。中間件依停止事件，見無也。`waitForMessage`，`message` 及 `message_sent` 両者含，故必要応方向、会話、送信者 filter 下。複数待機，同一事件自解決可能也。

既定超時，客端之 `requestTimeoutMs`（既定三十秒）也。`0` 之無効化。超時，`HaizakuraTimeoutError` 拒否，cancel，`HaizakuraAbortError`，切断或明示 `close()`，`HaizakuraConnectionError` 拒否也。述語例外，元錯誤拒否。全完了経路，其聴者、中断 handler、計時器削除也。Cancel，待機僅影響，客端閉鎖或送信済消息取消，行無也。

## Qzone 評論之返信

両客端，型付 `raw('comment_qzone', params)` 動作経由此公開也。`comment_id` 及 `comment_uin` 省略，画像上伝含通常評論保持。`target_uin`，常 **投稿之所有者** 識別，返信対象之人而非也。

親評論之 `comment_id` 及 `uin` 取得，`get_qzone_msg_detail` 読下。両者渡，其評論下 text 返信作成也。`"0"`，有効評論 ID 也。Thread 内特定相手宛，其 `uin` 及 `name`，`reply_uin` 及 `reply_name` 渡下。

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

上記 `post`、`postOwnerUin`、`parentComment`、`selectedReply`，呼出元選択之投稿及評論也。親之通常返信，`reply_uin` 及 `reply_name` 省略下。Nested 返信，**最上位親** `comment_id`/`comment_uin` 保持下，nested 返信自身 ID 置換無也。新伺服器，此関連保持為，各 inline 返信 `parent_comment_id` 及 `parent_comment_uin` 亦含也。Inline 返信，不完全場合有。頁不存在，評論削除意味無也。

成功時，`comment_id`，**新返信之** ID，結果，其親 ID 及作者含也。此等親 field，旧伺服器互換為，SDK 型省略可能也。親評論伴非空 `images`，上伝前拒否也。Thread 返信，現在 text 僅 support 也。受信者／親 parameter 不完全，錯誤，失敗返信，通常評論回退或自動再試行，決無也。送信後確認応答不正形式場合，再試行前 thread 確認下。返信既存可能性有也。

## 構造化 Qzone Friend Feed 之読取

`get_qzone_feeds`，`page_num`、`count`、`feeds`、`has_more`、及各 feed 之元 `html` 保持也。新伺服器，`tid`、`content`、`content_complete`、`images`、`like_count`、`comment_count` 亦返也。`null` 値，源流其 field 確立無意味，零或空投稿意味無也。折畳抜粋，`content_complete: false` 持也。画像，投稿本文利用可能画像僅対象，avatar、評論画像、動画封面除外也。完全 album 一覧而非也。投稿以外 feed 種別，`tid` 無場合有也。

同一帳号続行，返却之 `next_cursor` 其侭使用下。

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

Cursor 使用場合，`page_num` 省略，或対応頁番号指定下。Cursor 無，後之 `page_num` 要求，先頭自以前頁辿，時間掛場合有。末尾超要求，空頁返也。Service，`count` 未満 entry 返場合有，続伴空途中頁含也。配列長而非 `has_more` 及 `next_cursor` 従下。不正 cursor、他帳号 cursor、停止 cursor，可視失敗也。結果，凍結快照而非生 feed 反映，故投稿請求間変化可能性有也。

追加結果 field，SDK 型省略可能，旧伺服器及既存利用者作成結果 object，仍 support 也。MCP，`get_action` 経由同一 field 及 cursor 例発見，`query_action` 経由此読取専用動作呼出也。其既存 mode 制限，変更無也。