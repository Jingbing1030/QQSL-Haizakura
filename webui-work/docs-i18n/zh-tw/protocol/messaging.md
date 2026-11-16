# 媒體傳送、引用回覆與事件等待


這些輔助方法都是新增的，不影響既有行為。既有的字串媒體路徑仍指向 Haizakura 伺服器，`context.reply()` 仍會傳送一般回覆，既有的事件訂閱與中介軟體也維持原有行為。

## 傳送本機媒體

HTTP 與 WebSocket 用戶端都提供 `sendGroupImage`、`sendPrivateImage`、`sendGroupRecord`、`sendPrivateRecord`、`sendGroupVideo`、`sendPrivateVideo`、`sendGroupFile` 與 `sendPrivateFile`。

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

來源可以是 `Uint8Array`（包含 Node 的 `Buffer`）、`Blob`／瀏覽器 `File`、`ReadableStream<Uint8Array>`，或 `AsyncIterable<Uint8Array>`（包含位元組模式的 Node 可讀串流）。串流與非同步可迭代物件必須提供 `fileSize`。`{ source, filename }` 包裝物件可在不變更位元組來源的前提下提供名稱。瀏覽器 `File` 的名稱會自動推得；若明確指定 `filename` 選項則會覆寫它。

`localFile(pathOrFileURL)` **只能**從 `@snowluma/sdk/node` 取得。它會傳回具名、以檔案為後盾的 Blob，且不會把整個檔案讀進記憶體。在傳送完成前，該檔案必須維持不變；檔案不存在、不是一般檔案或內容已變更都會產生錯誤。根進入點與供瀏覽器使用的進入點不會匯入 Node 的檔案系統模組。瀏覽器可以直接傳入使用者選取的 `File`。

這些輔助方法會等待每個區塊的確認與上傳完成，然後在最後的動作中使用傳回的**伺服器路徑**。圖片、語音與影片方法會傳回一般的 `{ message_id }` 結果。檔案方法則呼叫既有的檔案發佈動作並傳回 `{ file_id }`。`sendGroupFile` 接受 `folder`／`folderId`；檔案方法接受顯示用的 `name`，預設為上傳時的名稱。媒體屬性放在 `image`、`record` 或 `video` 之下。`video.thumb` 路徑仍指向伺服器，不會自動上傳。

所有[上傳選項](STREAMING.md)都適用，包括 `chunkSize`、`expectedSha256`、`fileRetention`、`signal` 與 `onProgress`。進度計算的是已確認的上傳位元組，而非訊息送達。`timeoutMs` 是**每個上傳請求與最後送出請求**的逾時，而不是整個操作或來源讀取的期限。若要套用整體的取消策略，請使用自帶期限的 `AbortSignal`。

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

錯誤會帶有 `stage: 'upload' | 'send'`、原始的 `cause`（包含 API、中止與逾時錯誤），以及可用時已完成的上傳中繼資料。階段之間的取消會阻止送出。送出後才取消或逾時，並不代表伺服器沒有送出：這裡沒有自動重試、回復或遠端刪除。遠端保留與部分上傳的到期，仍由既有的上傳服務控制。隨附的執行期修正會把群檔案聊天發佈失敗回報為錯誤，並在錯誤內容中保留已上傳的檔案 ID；該失敗之後不再傳回成功。

## 明確引用訊息

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

`context.quote()` 會依事件所屬的群組或私人會話進行路由，並使用該事件的訊息 ID。非訊息事件會被拒絕。ID 為非零的 32 位元有號整數；負值 ID 會原樣保留。`quoteMessage(id, body, options?)` 同樣由 `@snowluma/sdk/messages` 匯出，只負責組合內容，不會發出請求。

主體可接受字串、CQ 字串、單一區段、區段陣列與訊息鏈。字串形式的 CQ 內容會保留原有欄位與跳脫方式。設為 `autoEscape: true` 時，字串會成為引用之後的字面文字；陣列與訊息鏈則維持結構化。若主體已包含回覆區段會被拒絕，且輸入不會被就地修改。這不會去取得被引用的訊息；伺服器必須能解析其 ID。

舊的 `HaizakuraEventContext` 物件與明確標註型別的處理常式仍然有效。SDK 建立的內容物件與推導出的用戶端回呼會提供 `HaizakuraEventContextWithQuote`。若要標註可重複使用的新處理常式，請使用 `EventHandler<MyEvent, HaizakuraEventContextWithQuote<MyEvent>>`（或 `EventMiddleware`／`CommandHandler` 對應的內容參數）。

## 等待未來事件

QQ 標記為自動回覆的私訊，會在即時事件與好友歷史訊息中帶有 `auto_reply: true`。可用 `event.auto_reply === true` 加以過濾。Haizakura 會保留回覆文字，包括傳送者自行輸入的字面文字 `[自动回复]`。較早儲存在本機的訊息可能沒有這個旗標。

WebSocket 用戶端提供 `waitForEvent(predicate?, options?)` 與 `waitForMessage(predicate?, options?)`。兩者也都接受只傳入選項物件。同步的型別守衛述詞會縮小型別；布林述詞只做過濾，不會宣稱更窄的型別。

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

等待會同步註冊，不會建立連線、不會重播歷史、不會消耗其他監聽器的事件，也不會跨重新連線保留。它們觀察的是與 `onEvent` 相同的公開事件串流，而且是**在中介軟體之後**；被中介軟體攔下的事件不會出現。`waitForMessage` 同時包含 `message` 與 `message_sent`，因此需要時請自行過濾方向、會話與傳送者。多個等待可以由同一個事件完成。

預設逾時是用戶端的 `requestTimeoutMs`（預設 30 秒）；`0` 表示停用。逾時會以 `HaizakuraTimeoutError` 拒絕，取消會以 `HaizakuraAbortError` 拒絕，連線中斷或明確呼叫 `close()` 則以 `HaizakuraConnectionError` 拒絕。述詞擲出的例外會以其原始錯誤拒絕。每條完成路徑都會移除自己的監聽器、中止處理常式與計時器。取消只影響該次等待；不會關閉用戶端，也不會撤回已送出的訊息。

## 回覆 Qzone 留言

兩個用戶端都透過型別化的 `raw('comment_qzone', params)` 動作提供這項功能。省略 `comment_id` 與 `comment_uin` 會保留一般留言，包括圖片上傳。`target_uin` 一律代表**貼文擁有者**，而不是被回覆的人。

讀取 `get_qzone_msg_detail` 可取得上層留言的 `comment_id` 與 `uin`。兩者都傳入，即可在該留言下建立文字回覆；`"0"` 是有效的留言 ID。若要指名討論串中的某個人，另外把其 `uin` 與 `name` 分別傳為 `reply_uin` 與 `reply_name`：

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

上述的 `post`、`postOwnerUin`、`parentComment` 與 `selectedReply` 都是呼叫端所選定的貼文與留言。若只是對上層留言做一般回覆，請省略 `reply_uin` 與 `reply_name`。若是巢狀回覆，`comment_id`／`comment_uin` 必須維持**最上層的父留言**；不要換成該巢狀回覆自己的 ID。較新的伺服器也會在每則內嵌回覆上附帶 `parent_comment_id` 與 `parent_comment_uin`，以保留這層關聯。內嵌回覆可能不完整；某則留言不在某一頁中，並不代表它已被刪除。

成功時，`comment_id` 是**新回覆**的 ID，結果中會包含其父留言 ID 與作者。基於與舊伺服器的相容性，這些父層欄位在 SDK 型別中為選用。帶有父留言且 `images` 非空者，會在上傳前被拒絕：討論串回覆目前僅支援文字。收件者或父層參數不完整會視為錯誤，而失敗的回覆絕不會退回成一般留言，也不會自動重試。若送出後收到的確認格式不正確，請先檢查討論串再重試；回覆可能已經存在。

## 讀取結構化的 Qzone 好友動態

`get_qzone_feeds` 保留 `page_num`、`count`、`feeds`、`has_more`，以及每則動態原本的 `html`。較新的伺服器還會傳回 `tid`、`content`、`content_complete`、`images`、`like_count` 與 `comment_count`。值為 `null` 表示來源並未確立該欄位；不代表是零或空貼文。被收合的摘要會有 `content_complete: false`。`images` 只涵蓋貼文本文中可用的圖片，不含頭像、留言圖片與影片封面；它們不是完整的相簿清單。非貼文類型的動態可能沒有 `tid`。

請原樣使用傳回的 `next_cursor`，以便在同一個帳號上繼續：

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

使用游標時請省略 `page_num`，或提供與其對應的頁碼。
沒有游標時，要求較後面的 `page_num` 會從頭逐頁走過前面的頁面，可能較為耗時；要求超出結尾則會傳回空頁。
服務可能傳回比 `count` 更少的項目，包括中間出現附帶續傳游標的空頁。
請依 `has_more` 與 `next_cursor` 判斷，而不是陣列長度。
無效、屬於其他帳號或停滯的游標會明顯失敗。結果反映的是即時動態，而非凍結的快照；貼文可能在兩次請求之間變動。

新增的結果欄位在 SDK 型別中為選用，因此較舊的伺服器與既有的消費者自建成結果物件仍可運作。MCP 透過 `get_action` 探索相同的欄位與游標範例，並透過 `query_action` 呼叫這個唯讀動作；其既有的模式限制維持不變。