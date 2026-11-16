# Haizakura SDK


Haizakura 的 TypeScript SDK，提供 OneBot HTTP / WebSocket 用戶端、事件中介軟體、指令比對與訊息鏈式建構器。

## 導覽

- [安裝](#安裝)
- [快速開始](#快速開始)
- [HTTP Client](#http-client)
- [WebSocket Client](#websocket-client)
- [事件中介軟體與指令](#事件中介軟體與指令)
- [Raw Action](#raw-action)
- [Message Builder](#message-builder)
- [請求控制](#請求控制)
- [錯誤處理](#錯誤處理)
- [測試建議](#測試建議)
- [子路徑匯入](#子路徑匯入)
- [Action 同步](#action-同步)
- [專案結構](#專案結構)
- [版本策略](#版本策略)

群申請中的入群者、邀請人和審批人，以及入群通知的身分可用狀態，見[群邀請與入群身分](../onebot/GROUP_REQUESTS.md)。

## 安裝

在本 monorepo 內直接透過 workspace 引用：

```bash
pnpm add @snowluma/sdk --workspace
```

發布到 npm 後可直接安裝：

```bash
pnpm add @snowluma/sdk
```

## 快速開始

```ts
import { HaizakuraHttpClient, text } from '@snowluma/sdk';

const bot = new HaizakuraHttpClient({
  baseUrl: 'http://127.0.0.1:3000/',
  accessToken: process.env.SNOWLUMA_TOKEN,
});

const login = await bot.getLoginInfo();
await bot.sendGroupMessage(123456, text(`Hello from ${login.nickname}`).at('all'));
```

Haizakura 的 OneBot HTTP / WebSocket 連接埠和 `accessToken` 來自 `config/onebot_<uin>.json`。

## HTTP Client

```ts
import { HaizakuraHttpClient, message, text } from '@snowluma/sdk';

const bot = new HaizakuraHttpClient({
  baseUrl: 'http://127.0.0.1:3000/',
  accessToken: process.env.SNOWLUMA_TOKEN,
  requestTimeoutMs: 30_000,
});

await bot.sendPrivateMessage(10001, text('pong'));

const { url } = await bot.getGroupShareLink(123456);

await bot.sendGroupMessage(123456, [
  message.text('Hello'),
  message.at('all'),
]);
```

## WebSocket Client

WebSocket 用戶端會用 `echo` 關聯 API 回應，並把無 `echo` 的封包作為事件分派。

```ts
import { HaizakuraWebSocketClient, text } from '@snowluma/sdk';

const bot = new HaizakuraWebSocketClient({
  url: 'ws://127.0.0.1:3001/',
  accessToken: process.env.SNOWLUMA_TOKEN,
  reconnect: true,
});

bot.onGroupMessage(async (event, ctx) => {
  if (event.raw_message === '/ping') {
    await ctx.reply(text('pong').at(event.user_id));
  }
});

bot.onRequest('friend', async (_event, ctx) => {
  await ctx.approve();
});

bot.onBotStatus((event) => {
  console.log(event.sub_type, event.user_id);
});

await bot.connect();
await bot.sendPrivateMessage(10001, text('ready'));
```

## 事件中介軟體與指令

```ts
bot.use(async (event, ctx, next) => {
  console.log(event.post_type);
  await next();
});

bot.command('echo', async (_event, ctx, match) => {
  await ctx.reply(text(match.rest || 'empty'));
});

bot.when(
  (event) => event.post_type === 'notice',
  async (event) => console.log(event),
);
```

事件脈絡內建快捷操作：

- `ctx.reply(message)`：按私聊/群聊自動回覆。
- `ctx.approve()` / `ctx.reject(reason)`：處理好友或群請求。
- `ctx.quickOperation(operation)`：呼叫 `.handle_quick_operation`。
- `ctx.stopPropagation()`：停止後續中介軟體和一般 `onEvent` 分派。

## Raw Action

動畫系統表情可透過 `face(id, { resultId: '0' })` 指定結果，收到的結果保留在 `face.data.resultId` 中。不傳時沿用預設選擇；有效結果取決於具體表情，不能與 `large: false` 同用。

`await bot.getStatus()` 的 `time` 為目前帳號服務實例的執行秒數，與 `#sl` 使用相同計時起點；實例重建後重新計時。

高頻介面提供 camelCase 方法；其它 Haizakura action 可以用 `raw` 或 `rawResponse`：

```ts
const data = await bot.raw('get_group_file_system_info', {
  group_id: 123456,
});

const response = await bot.rawResponse('get_status');
```

`raw` 會在 Haizakura 回傳 `status: "failed"` 或非零 `retcode` 時擲回 `HaizakuraApiError`；`rawResponse` 會保留完整回應。

### 讀取與修改空間資料

`get_qzone_profile` 回傳 QQ 空間的名稱和說明；這兩個欄位獨立於 QQ 暱稱和個性簽名。

```ts
const profile = await bot.raw('get_qzone_profile', {}); // 当前账号
console.log(profile.name, profile.description);
await bot.raw('get_qzone_profile', { target_uin: '10002' });

await bot.raw('set_qzone_profile', { name: '我的空间' });
await bot.raw('set_qzone_profile', { description: '' }); // 清空说明
```

`set_qzone_profile` 只修改目前帳號，至少提供 `name`、`description` 中的一項；省略欄位保持原值，空字串表示清空。成功回傳 `null`，登入失效、存取受限或上游要求驗證時會擲回 `HaizakuraApiError`。修改後可再次讀取資料確認結果。

### 讀取空間說說留言

`get_qzone_msg_detail` 是唯讀擴充動作，`raw` 提供參數和結果型別：

```ts
const detail = await bot.raw('get_qzone_msg_detail', {
  tid: '说说 ID', // 来自 get_qzone_msg_list / send_qzone_msg
  // target_uin: 10001, // 省略时读取机器人自己的空间
  pos: 0,
  num: 20,
});

for (const comment of detail.comments) {
  console.log(comment.comment_id, comment.uin, comment.name, comment.time, comment.content);
  console.log(comment.replies); // 服务端内联返回的二级回复
}
```

`comment_num` 是伺服器端回報的總數，`comments` 是本頁一級留言；`num` 範圍為 1–100，實際回傳數量可能更少。二級回覆不單獨分頁，`replies` 不保證完整。留言 ID 在所屬說說內唯一，二級回覆 ID 在父留言內唯一；時間均為 Unix 秒，正文保留空間表情與 @ 標記。該介面重用目前帳號的空間登入狀態，登入或存取權限失敗會擲回 `HaizakuraApiError`。

分頁參數及 `commentlist` / `list_3` 欄位參考 [Qzone-API](https://github.com/SmartHypercube/Qzone-API/blob/master/qzone.py)。實際分頁和可見內容取決於 QQ 空間伺服器端。

### 空友愛看與公共空間

`get_qzone_home_feeds` 讀取自己的空間主頁，可傳 `target_uin` 存取有權限的其他主頁；`cursor` 使用同一帳號、同一主頁上次回傳的 `next_cursor`。它回傳完整動態，舊版 `get_qzone_feeds` 和 `get_qzone_msg_list` 保持原有格式。

已有說說編號時，可呼叫 `get_qzone_feed_detail`，傳入 `get_qzone_msg_list` 或 `send_qzone_msg` 回傳的 24 位十六進位 `tid`。此介面讀取一般空間說說，自動從編號取得作者和發布時間，不需要 `target_uin`；存取仍使用目前帳號的權限。結果的 `feed` 是單一完整動態物件，保留圖片、影片、分享資訊和未知欄位，無需再取 `.feed.feed`。其餘上游詳情欄位也會保留，`attach_info` 為上游留言游標（未提供時為 `null`）；只讀取一次詳情，不自動翻頁，也不保證留言和回覆完整。舊的 `get_qzone_msg_detail` 及其 `pos/num` 分頁保持不變。

```ts
const detail = await bot.raw('get_qzone_feed_detail', {
  tid: '1127000000f1536501000000', // 替换为实际说说编号
});
const card = await bot.raw('get_qzone_share_ark', { feed: detail.feed });
// 若 card.requires_confirmation 为 true，发送前展示 card.notice 并取得确认。
```

把詳情、主頁或推薦清單的完整動態傳給 `get_qzone_share_ark`，可獲得 `{ ark, requires_confirmation, notice }`。此動作會產生分享卡片但不送出訊息；將 `ark` 原文交給一般 JSON 訊息傳送介面即可獲得訊息編號，繼續使用已有撤回及傳送事件能力。能讀取不代表允許分享：分享受限或缺少上游分享資訊時，分享介面會明確報錯。

分享連結可能讓未登入者也能存取動態，並包含作者 QQ 號。若 `requires_confirmation` 為 `true`，送出前應展示 `notice` 並取得確認；上游禁止分享或產生失敗會回傳錯誤。

```ts
const page = await bot.raw('get_qzone_home_feeds', {});
if (page.feeds[0]) {
  const card = await bot.raw('get_qzone_share_ark', { feed: page.feeds[0] });
  // 先按 requires_confirmation / notice 确认分享范围，再由调用方决定是否发送。
  // 发送时使用 [{ type: 'json', data: { data: card.ark } }]，保持卡片原文。
}
```

公共空間動作使用推薦域 `3` 的 JSON 介面，與上面的舊空間 CGI 動作分開。先讀取 `get_qzone_public_feeds`，再把回傳的完整 `feed` 物件傳給詳情和互動動作，保留其中的身分、傳遞資料及未知欄位；不要用舊說說 `tid` 拼造。

| 動作 | 主要參數 |
| --- | --- |
| `get_qzone_public_capabilities` | 無；讀取目前帳號的入口能力 |
| `get_qzone_public_feeds` | 可選 `cursor` |
| `get_qzone_public_feed_detail` | `feed` |
| `get_qzone_public_comments` | `feed`、`cursor` |
| `get_qzone_public_replies` | `feed`、完整 `comment`，可選 `cursor`、`page_size`（預設 20） |
| `set_qzone_public_upvote` / `set_qzone_public_like` / `set_qzone_public_follow` | `feed`，可選 `enable`（預設 `true`，`false` 取消） |
| `set_qzone_public_comment_like` | `feed`、完整 `comment`，可選完整 `reply`、`enable`（預設 `true`） |
| `comment_qzone_public_feed` | `feed`、`content` |
| `reply_qzone_public_feed` | `feed`、完整 `comment`、`content`，可選完整 `reply` |
| `delete_qzone_public_comment` / `delete_qzone_public_reply` | `feed`、完整 `comment`；刪除回覆還需完整 `reply` |
| `forward_qzone_public_feed` | `feed`，可選 `reason`（預設空字串） |

「推」與「讚」是不同的互動，分別使用 `set_qzone_public_upvote` 和 `set_qzone_public_like`。留言或回覆的 `content` 接受非空文字或非空的上游富文字物件陣列。詳情、留言、回覆及寫入操作保留上游結果欄位，`raw` 回傳這些 JSON 物件；清單的 `feeds` 已去掉上游每項的 `.feed` 包裝，其餘欄位保持開放。

QQ 上游會對留言換行做正規化，回傳的富文字保持上游格式。

`set_qzone_public_comment_like` 為留言按讚；提供 `reply` 時改為給該回覆按讚，`enable: false` 取消。保留留言或回覆自帶的 `like.id`，不要將它替換成留言 ID。

```ts
const page = await bot.raw('get_qzone_public_feeds', {});
if (page.has_more && page.next_cursor) {
  const next = await bot.raw('get_qzone_public_feeds', { cursor: page.next_cursor });
  console.log(next.feeds);
}

const feed = page.feeds[0];
if (feed) {
  const detail = await bot.raw('get_qzone_public_feed_detail', { feed });
  if (detail.has_more === true && typeof detail.attach_info === 'string') {
    const comments = await bot.raw('get_qzone_public_comments', {
      feed,
      cursor: detail.attach_info,
    });
    console.log(comments);
  }
}
```

清單續頁必須原樣傳回 `next_cursor`，根據 `has_more` 判斷結束，不能因本頁不足 10 條而停止。詳情中的首批留言位於 `feed.feed.cell_comment.comments`；後續留言使用詳情或上一留言頁的 `attach_info` 作為 `cursor`。讀取回覆時，首次可省略 `cursor` 使用完整留言自帶的 `reply_attach_info`，之後傳上一回覆頁的 `reply_attach_info`。這些游標各有用途，清單游標還綁定目前帳號。登入或存取權限失敗會擲回 `HaizakuraApiError`。

### 單個管理員權限

`set_group_admin` 用於授予或取消管理員身分。對已有管理員，可透過以下動作讀取或修改權限；呼叫帳號需要具有 QQ 伺服器端要求的管理權限。

| 動作 | 參數與結果 |
| --- | --- |
| `get_group_admin_permissions` | `group_id`、`user_id`；回傳撤回權限、移除權限、每日移除上限和接收驗證訊息狀態 |
| `set_group_admin_permissions` | `group_id`、`user_id`，以及至少一個 `recall_member_message` / `kick_member` |
| `set_group_admin_receive_verify` | `group_id`、`user_id`、必填 `enable`；獨立設定接收加群驗證訊息 |

```ts
await bot.raw('set_group_admin_permissions', {
  group_id: 123456,
  user_id: 10001,
  recall_member_message: false,
  kick_member: true,
  kick_member_per_day: 20,
});

const permissions = await bot.raw('get_group_admin_permissions', {
  group_id: 123456,
  user_id: 10001,
});

await bot.raw('set_group_admin_receive_verify', {
  group_id: 123456,
  user_id: 10001,
  enable: false,
});
```

只修改明確提供的權限。開啟移除權限必須明確提供 `kick_member_per_day`，支援 `0`、`5`、`10`、`20`、`50`、`100`、`200`，其中 `0` 表示不限。修改上限也須同時傳 `kick_member: true`；關閉或省略移除權限時不能提供上限。SDK 的 `kick_member` 使用布林值，以便型別檢查約束上限。

讀取結果包含 `group_id`、`user_id`、`recall_member_message`、`kick_member`、`kick_member_per_day`、`receive_verify`。`receive_verify` 表示是否接收加群驗證訊息。伺服器未回傳或未指定的狀態為 `null`；移除權限關閉或未指定時，上限也為 `null`。各項來自獨立查詢，不保證同一時刻的狀態；任何查詢失敗都會報錯。

兩個寫入動作分別送一次請求，不自動重試或授予管理員身分。權限寫入成功表示伺服器確認請求；接收驗證訊息寫入還會核對回應中的群號和成功管理員清單。兩者均回傳 `null`。完整的用戶端顯示和實際權限效果仍需真實 QQ 驗證，不能以介面成功替代驗收。

## Message Builder

```ts
import { fromCQString, message, text, toCQString } from '@snowluma/sdk';

const segments = [
  message.reply(42),
  message.text('收到 '),
  message.image('https://example.com/a.png'),
];

const chained = text('收到 ')
  .at(10001)
  .image('https://example.com/a.png');

const cq = toCQString(segments);
const chainedCq = toCQString(chained);
const parsed = fromCQString('hi[CQ:at,qq=all]');
```

CQ 轉換會保留參數中的字面量轉義文字，例如圖片路徑中的 `&#44;`，不會將它再次解碼成逗號。

鏈式入口回傳 `MessageChain`，可以直接傳給傳送介面，也可以用 `build()` / `toSegments()` 轉成 OneBot segment 陣列：

```ts
await bot.sendGroupMessage(123456, text('hi').at(10001).image('/tmp/a.png'));

const segments = text('hi').at('all').build();

await text('hi').atAll().br().face(14).sendToGroup(bot, 123456);
```

`reply()` 在一條鏈中只能出現一次；TypeScript 會阻止 `text('a').reply(1).reply(2)`，執行環境也會做同樣檢查。

已內建常用段：`text`、`br`、`face`、`at`、`atAll`、`reply`、`image`、`record`、`video`、`json`、`xml`、`poke`、`forward`、`node`、`share`、`music`、`location`、`contact` 和 `raw`。

### 合併轉發中的自訂引用

合併轉發節點的 `content` 支援 `reply.data.message`，無需引用目標已存在於本機訊息庫。
SDK 提供 `message.customReply()`（回傳訊息段，僅用於轉發節點）：

```ts
await bot.raw('send_group_forward_msg', {
  group_id: 123456,
  messages: [message.node(10001, '发送者', [
    message.customReply([message.text('Haizakura')], { qq: 10002, time: 1700000000, seq: 42 }),
    message.text('这是回复内容'),
  ])],
});
```

對應的 OneBot JSON 為 `{ "type": "reply", "data": { "message": [{ "type": "text", "data": { "text": "Haizakura" } }] } }`。
`message` 可以是文字/CQ 字串、單一訊息段或訊息段陣列，不能為空；明確提供時優先於 `id`。
引用預覽保留文字和 @，圖片、表情、語音、影片、檔案、轉發、JSON/XML 卡片和 Markdown 使用型別文字摘要，不會為引用重新上傳媒體。
引用內容不支援巢狀 `reply`/`node` 或 `music`、`contact`、`poke` 等其他型別；無效內容會回傳參數錯誤。

`qq`、`time`、`seq` 支援整數或整數字串。省略時分別使用目前節點傳送者、節點時間（未指定時為目前時間）和 `1`。
`qq` 必須是正安全整數，`time` 是 0 到 4294967295 的 Unix 秒，`seq` 是 1 到 4294967295 的序號。
這些欄位用於引用預覽；自訂引用不保證能在 QQ 中跳轉到原訊息。請使用 JSON 訊息段傳遞此擴充；SDK 的 `toCQString` 會拒絕將巢狀訊息段轉換成 CQ 參數，避免內容被轉成 `[object Object]`。

`get_forward_msg` 的回覆段仍含 `id`；當 QQ 回傳內嵌引用內容時，還會包含 `message` 以及可用的 `qq`、`time`、`seq`。
將回傳節點的 `message` 作為新轉發節點的 `content` 即可保留引用預覽，無需再透過 `get_msg` 查詢引用 ID。
若 QQ 沒有提供引用內容，則只回傳原有 `id`。一般群聊/私聊的 `reply.data.id` 用法保持不變。

## 請求控制

每次請求都支援覆寫 `echo`、逾時和 `AbortSignal`：

WebSocket 並行請求必須使用不同的 `echo`；重複值會被拒絕。省略時由 SDK 自動產生。

```ts
const controller = new AbortController();

const status = bot.getStatus({
  echo: 'healthcheck',
  timeoutMs: 5_000,
  signal: controller.signal,
});

controller.abort();
await status;
```

`timeoutMs: 0` 表示關閉該請求的逾時控制。
WebSocket 一般請求的逾時從呼叫時開始，包含等待連線建立和等待回應的總時間，
連線成功後不會重新計時。等待連線時已逾時或取消的請求不會在連線晚到後補送；
取消單一請求不會關閉其他請求正在使用或等待的共享連線。

## 錯誤處理

SDK 曝露統一錯誤基底類別和更具體的錯誤型別：

- `HaizakuraApiError`：OneBot 回應失敗或 `retcode !== 0`。
- `HaizakuraAuthError`：驗證相關 retcode，例如 `1401`、`401`、`403`。
- `HaizakuraTransportError`：連線、解析、逾時、取消等傳輸層錯誤基底類別。
- `HaizakuraConnectionError`：HTTP fetch / WebSocket 連線或傳送失敗。
- `HaizakuraParseError`：回應不是合法 JSON 或不符合 OneBot 回應結構。
- `HaizakuraTimeoutError`：請求超過 `timeoutMs`。
- `HaizakuraAbortError`：呼叫方透過 `AbortSignal` 主動取消。

```ts
import {
  HaizakuraApiError,
  HaizakuraAuthError,
  HaizakuraTimeoutError,
} from '@snowluma/sdk';

try {
  await bot.getStatus({ timeoutMs: 1000 });
} catch (error) {
  if (error instanceof HaizakuraAuthError) {
    throw new Error('Haizakura access token is invalid');
  }
  if (error instanceof HaizakuraTimeoutError) {
    console.warn(`Haizakura did not respond in ${error.timeoutMs}ms`);
  }
  if (error instanceof HaizakuraApiError) {
    console.warn(error.retcode, error.wording);
  }
}
```

## 測試建議

- SDK 自身使用 Vitest 涵蓋訊息建構、事件脈絡、WebSocket 回應關聯、錯誤模型和取消邏輯。
- 對接真實 Haizakura 時建議使用單獨測試帳號和測試群，避免把自動化訊息發到生產環境。
- 整合測試裡優先明確設定 `echo` 和較短 `timeoutMs`，這樣失敗時更容易定位是哪一次 action。
- 發布前執行 `pnpm --filter @snowluma/sdk typecheck`、`pnpm --filter @snowluma/sdk test`、`pnpm --filter @snowluma/sdk build`。

## 子路徑匯入

```ts
import { HaizakuraHttpClient } from '@snowluma/sdk/client';
import { text } from '@snowluma/sdk/messages';
import { isMessageEvent } from '@snowluma/sdk/events';
import { HaizakuraApiError } from '@snowluma/sdk/errors';
```

根進入點 `@snowluma/sdk` 仍匯出正式公開 API；不再保留舊的根級相容 barrel 或別名 API。

## Action 同步

SDK 匯出 `SNOWLUMA_ACTIONS` 和 `isHaizakuraAction()`。測試會掃描 `packages/core/src/onebot/actions/*.ts` 的 `registerAction()`，確保 SDK action 清單沒有落後。

## 專案結構

```text
src/
  client/      HTTP / WebSocket client 与 API facade
  events/      事件上下文、类型守卫、中间件和命令匹配
  messages/    segment 工厂、MessageChain、CQ 编解码
  types/       JSON、消息、事件、action 参数和返回类型
  internal/    SDK 内部工具
```

## 版本策略

目前套件版本為 `0.1.0`。版本規則、發布檢查清單和破壞性變更邊界見 [VERSIONING.md](./VERSIONING.md)。

## 接收反向 WebSocket 連線

Node 程式可透過 `@snowluma/sdk/node` 的 `createReverseWebSocketServer()` 接受 Haizakura 的反向連線，按帳號使用原有訊息監聽、動作和串流介面。支援統一連線或分開的 API/Event 通道。設定、驗證和重新連線處理見 [REVERSE_WEBSOCKET.md](REVERSE_WEBSOCKET.md)。
