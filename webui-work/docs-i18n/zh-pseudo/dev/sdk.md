# Haizakura SDK


Haizakura 之 TypeScript SDK 也。提供 OneBot HTTP / WebSocket 客户端、事件中間件、命令匹配、消息鎖式構築器。

## 導航

- [安裝](#安裝)
- [快速開始](#快速開始)
- [HTTP Client](#http-client)
- [WebSocket Client](#websocket-client)
- [事件中間件与命令](#事件中間件与命令)
- [Raw Action](#raw-action)
- [Message Builder](#message-builder)
- [請求制御](#請求制御)
- [錯誤処理](#錯誤処理)
- [測試建議](#測試建議)
- [子路径導入](#子路径導入)
- [Action 同期](#action-同期)
- [工程結構](#工程結構)
- [版本方針](#版本方針)

群申請中之入群者、邀請人、審批人，以及入群通知之身份可用状態，見[群邀請与入群身份](../onebot/GROUP_REQUESTS.md)。

## 安裝

本 monorepo 内直接以 workspace 引用為：

```bash
pnpm add @snowluma/sdk --workspace
```

發布至 npm 後可直接安裝為：

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

Haizakura 之 OneBot HTTP / WebSocket 端口与 `accessToken` 來自 `config/onebot_<uin>.json` 也。

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

WebSocket 客户端以 `echo` 関聯 API 応答，無 `echo` 之包則作為事件分發也。

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

## 事件中間件与命令

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

事件上下文内蔵快捷操作：

- `ctx.reply(message)`：按私聊／群聊自動返信也。
- `ctx.approve()` / `ctx.reject(reason)`：処理好友或群請求也。
- `ctx.quickOperation(operation)`：呼出 `.handle_quick_operation` 也。
- `ctx.stopPropagation()`：停止後続中間件与普通 `onEvent` 分發也。

## Raw Action

動画系統表情可経 `face(id, { resultId: '0' })` 指定結果，所収結果保存於 `face.data.resultId` 中。不傳則沿用既定選択；有効結果依具体表情而異，不能与 `large: false` 同用也。

`await bot.getStatus()` 之 `time` 為現在帳号服務実例之運行秒数，与 `#sl` 使用同一計時起点；実例重建後重新計時也。

高頻接口提供 camelCase 方法；其它 Haizakura action 可用 `raw` 或 `rawResponse` 也：

```ts
const data = await bot.raw('get_group_file_system_info', {
  group_id: 123456,
});

const response = await bot.rawResponse('get_status');
```

`raw` 於 Haizakura 返 `status: "failed"` 或非零 `retcode` 時抛出 `HaizakuraApiError`；`rawResponse` 則保存完全応答也。

### 読取与変更空間資料

`get_qzone_profile` 返 QQ 空間之名稱与説明；此二字段独立於 QQ 昵稱与個性簽名也。

```ts
const profile = await bot.raw('get_qzone_profile', {}); // 当前账号
console.log(profile.name, profile.description);
await bot.raw('get_qzone_profile', { target_uin: '10002' });

await bot.raw('set_qzone_profile', { name: '我的空间' });
await bot.raw('set_qzone_profile', { description: '' }); // 清空说明
```

`set_qzone_profile` 只変更現在帳号，至少提供 `name`、`description` 中之一項；省略字段保持原値，空字符串表示清空。成功返 `null`，登録失効、訪問受限或上游要求検証時抛出 `HaizakuraApiError`。変更後可再読資料以確認結果也。

### 読取空間説説評論

`get_qzone_msg_detail` 為只読拡張動作，`raw` 提供参數与結果類型也：

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

`comment_num` 為伺服器報告之総数，`comments` 為本頁一級評論；`num` 範囲為 1–100，実際返却数量或更少。二級回復不单独分頁，`replies` 不保証完全。評論 ID 於所属説説内唯一，二級回復 ID 於父評論内唯一；時間皆為 Unix 秒，正文保留空間表情与 @ 標記。此接口復用現在帳号之空間登録態，登録或訪問権限失敗則抛出 `HaizakuraApiError` 也。

分頁参數及 `commentlist` / `list_3` 字段参考 [Qzone-API](https://github.com/SmartHypercube/Qzone-API/blob/master/qzone.py)。実際分頁与可見内容依 QQ 空間伺服器也。

### 空友愛看与公共空間

`get_qzone_home_feeds` 読取自己之空間主頁，可傳 `target_uin` 訪問有権限之其他主頁；`cursor` 使用同一帳号、同一主頁上次返之 `next_cursor`。其返完全動態，舊版 `get_qzone_feeds` 与 `get_qzone_msg_list` 保持原有格式也。

已有説説編号時，可呼 `get_qzone_feed_detail`，傳入 `get_qzone_msg_list` 或 `send_qzone_msg` 返之 24 位十六進制 `tid`。此接口読取普通空間説説，自動自編号取得作者与發布時間，不需 `target_uin`；訪問仍用現在帳号之権限。結果之 `feed` 為単個完全動態対象，保留図片、視頻、分享情報与未知字段，無需再取 `.feed.feed`。其余上游詳情字段亦保留，`attach_info` 為上游評論游標（未提供時為 `null`）；只読一次詳情，不自動翻頁，亦不保証評論与回復完全。舊之 `get_qzone_msg_detail` 及其 `pos/num` 分頁保持不変也。

```ts
const detail = await bot.raw('get_qzone_feed_detail', {
  tid: '1127000000f1536501000000', // 替换为实际说说编号
});
const card = await bot.raw('get_qzone_share_ark', { feed: detail.feed });
// 若 card.requires_confirmation 为 true，发送前展示 card.notice 并取得确认。
```

把詳情、主頁或推薦列表之完全動態傳与 `get_qzone_share_ark`，可得 `{ ark, requires_confirmation, notice }`。此動作生成分享卡片但不送信消息；将 `ark` 原文交与普通 JSON 消息送信接口即可得消息編号，継続使用已有撤回及送信事件能力。能読不表示允許分享：分享受限或欠上游分享情報時，分享接口明確報錯也。

分享鏈接可能使未登録者亦可訪問動態，並含作者 QQ 号。若 `requires_confirmation` 為 `true`，送信前応展示 `notice` 並取得確認；上游禁止分享或生成失敗則返錯誤也。

```ts
const page = await bot.raw('get_qzone_home_feeds', {});
if (page.feeds[0]) {
  const card = await bot.raw('get_qzone_share_ark', { feed: page.feeds[0] });
  // 先按 requires_confirmation / notice 确认分享范围，再由调用方决定是否发送。
  // 发送时使用 [{ type: 'json', data: { data: card.ark } }]，保持卡片原文。
}
```

公共空間動作使用推薦域 `3` 之 JSON 接口，与上述舊空間 CGI 動作分開。先読 `get_qzone_public_feeds`，再把返之完全 `feed` 対象傳与詳情与互動動作，保留其中之身份、傳遞資料及未知字段；勿以舊説説 `tid` 拼造也。

| 動作 | 主要参數 |
| --- | --- |
| `get_qzone_public_capabilities` | 無；読取現在帳号之入口能力 |
| `get_qzone_public_feeds` | 可選 `cursor` |
| `get_qzone_public_feed_detail` | `feed` |
| `get_qzone_public_comments` | `feed`、`cursor` |
| `get_qzone_public_replies` | `feed`、完全 `comment`，可選 `cursor`、`page_size`（既定 20） |
| `set_qzone_public_upvote` / `set_qzone_public_like` / `set_qzone_public_follow` | `feed`，可選 `enable`（既定 `true`，`false` 取消） |
| `set_qzone_public_comment_like` | `feed`、完全 `comment`，可選完全 `reply`、`enable`（既定 `true`） |
| `comment_qzone_public_feed` | `feed`、`content` |
| `reply_qzone_public_feed` | `feed`、完全 `comment`、`content`，可選完全 `reply` |
| `delete_qzone_public_comment` / `delete_qzone_public_reply` | `feed`、完全 `comment`；刪除回復尚需完全 `reply` |
| `forward_qzone_public_feed` | `feed`，可選 `reason`（既定空字符串） |

「推」与「賛」為不同互動，分別使用 `set_qzone_public_upvote` 与 `set_qzone_public_like`。評論或回復之 `content` 接受非空文本或非空之上游富文本対象数組。詳情、評論、回復及写操作保留上游結果字段，`raw` 返此等 JSON 対象；列表之 `feeds` 已除去上游各項之 `.feed` 包装，其余字段保持開放也。

QQ 上游対評論換行作帰一化，返之富文本保持上游格式也。

`set_qzone_public_comment_like` 為評論点賛；提供 `reply` 時改為該回復点賛，`enable: false` 取消。保留評論或回復自有之 `like.id`，勿将其替換為評論 ID 也。

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

列表続頁必須原様回傳 `next_cursor`，依 `has_more` 判断終了，不能因本頁不足 10 条而停止。詳情中首批評論位於 `feed.feed.cell_comment.comments`；後続評論使用詳情或上一評論頁之 `attach_info` 作為 `cursor`。読回復時，首次可省略 `cursor` 而用完全評論自有之 `reply_attach_info`，之後傳上一回復頁之 `reply_attach_info`。此等游標各有用途，列表游標尚綁定現在帳号。登録或訪問権限失敗則抛出 `HaizakuraApiError` 也。

### 単個管理者権限

`set_group_admin` 用於授予或取消管理者身份。対已有管理者，可経以下動作読取或変更権限；呼出帳号需具 QQ 伺服器要求之管理権限也。

| 動作 | 参數与結果 |
| --- | --- |
| `get_group_admin_permissions` | `group_id`、`user_id`；返撤回権限、移除権限、毎日移除上限与接收検証消息状態 |
| `set_group_admin_permissions` | `group_id`、`user_id`，以及至少一个 `recall_member_message` / `kick_member` |
| `set_group_admin_receive_verify` | `group_id`、`user_id`、必填 `enable`；独立設定接收加群検証消息 |

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

只変更明示提供之権限。開啓移除権限必須明確提供 `kick_member_per_day`，支持 `0`、`5`、`10`、`20`、`50`、`100`、`200`，其中 `0` 表示不限。変更上限亦須同時傳 `kick_member: true`；関閉或省略移除権限時不能提供上限。SDK 之 `kick_member` 使用布爾値，以便類型検査約束上限也。

読取結果含 `group_id`、`user_id`、`recall_member_message`、`kick_member`、`kick_member_per_day`、`receive_verify`。`receive_verify` 表示是否接收加群検証消息。伺服器未返或未指定之状態為 `null`；移除権限関閉或未指定時，上限亦為 `null`。各項來自独立査詢，不保証同一時刻之状態；任何査詢失敗皆報錯也。

二写動作各送一次請求，不自動重試或授予管理者身份。権限写入成功表示伺服器確認請求；接收検証消息写入尚核対応答中之群号与成功管理者列表。両者皆返 `null`。完全之客户端表示与実際権限効果仍需真実 QQ 検証，不能以接口成功代替験収也。

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

CQ 変換保留参數中之字面量転義文本，例如図片路径中之 `&#44;`，不再解码為逗号也。

鎖式入口返 `MessageChain`，可直接傳与送信接口，亦可用 `build()` / `toSegments()` 轉為 OneBot segment 数組：

```ts
await bot.sendGroupMessage(123456, text('hi').at(10001).image('/tmp/a.png'));

const segments = text('hi').at('all').build();

await text('hi').atAll().br().face(14).sendToGroup(bot, 123456);
```

`reply()` 於一条鎖中只能出現一次；TypeScript 会阻止 `text('a').reply(1).reply(2)`，運行時亦作同様検査也。

已内蔵常用段：`text`、`br`、`face`、`at`、`atAll`、`reply`、`image`、`record`、`video`、`json`、`xml`、`poke`、`forward`、`node`、`share`、`music`、`location`、`contact` 与 `raw`。

### 合併轉發中之自定義引用

合併轉發節点之 `content` 支持 `reply.data.message`，無需引用対象已存於本地消息庫。
SDK 提供 `message.customReply()`（返消息段，僅用於轉發節点）：

```ts
await bot.raw('send_group_forward_msg', {
  group_id: 123456,
  messages: [message.node(10001, '发送者', [
    message.customReply([message.text('Haizakura')], { qq: 10002, time: 1700000000, seq: 42 }),
    message.text('这是回复内容'),
  ])],
});
```

対応之 OneBot JSON 為 `{ "type": "reply", "data": { "message": [{ "type": "text", "data": { "text": "Haizakura" } }] } }`。
`message` 可為文本／CQ 字符串、単個消息段或消息段数組，不能為空；明示提供時優先於 `id`。
引用預覧保留文字与 @，図片、表情、語音、視頻、文件、轉發、JSON/XML 卡片与 Markdown 使用類型文字摘要，不為引用重新上傳媒体也。
引用内容不支持嵌套 `reply`/`node` 或 `music`、`contact`、`poke` 等其它類型；無効内容返参數錯誤也。

`qq`、`time`、`seq` 支持整数或整数字符串。省略時分別使用現在節点送信者、節点時間（未指定時為現在時間）与 `1`。
`qq` 必須為正安全整数，`time` 為 0 至 4294967295 之 Unix 秒，`seq` 為 1 至 4294967295 之序号。
此等字段用於引用預覧；自定義引用不保証能於 QQ 中跳轉至原消息。請以 JSON 消息段傳遞此拡張；SDK 之 `toCQString` 会拒絶将嵌套消息段轉換為 CQ 参數，以免内容被轉為 `[object Object]` 也。

`get_forward_msg` 之回復段仍含 `id`；当 QQ 返内嵌引用内容時，尚含 `message` 以及可用之 `qq`、`time`、`seq`。
将返節点之 `message` 作為新轉發節点之 `content` 即可保留引用預覧，無需再経 `get_msg` 査詢引用 ID。
若 QQ 未提供引用内容，則只返原有 `id`。普通群聊／私聊之 `reply.data.id` 用法保持不変也。

## 請求制御

毎次請求皆支持覆蓋 `echo`、超時与 `AbortSignal`：

WebSocket 並發請求必須使用不同之 `echo`；重複値会被拒絶。省略時由 SDK 自動生成也。

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

`timeoutMs: 0` 表示関閉該請求之超時制御。
WebSocket 普通請求之超時自呼出時開始，含等待接続建立与等待応答之総時間，接続成功後不重新計時。等待接続時已超時或取消之請求，不会於接続晩到後補發；取消単個請求不会関閉其他請求正在使用或等待之共有接続也。

## 錯誤処理

SDK 暴露統一錯誤基底類与更具體之錯誤類型：

- `HaizakuraApiError`：OneBot 応答失敗或 `retcode !== 0`。
- `HaizakuraAuthError`：鑑權相関 retcode，例如 `1401`、`401`、`403`。
- `HaizakuraTransportError`：接続、解析、超時、取消等傳輸層錯誤之基底類。
- `HaizakuraConnectionError`：HTTP fetch / WebSocket 接続或送信失敗。
- `HaizakuraParseError`：応答非合法 JSON 或不合 OneBot 応答結構。
- `HaizakuraTimeoutError`：請求超過 `timeoutMs`。
- `HaizakuraAbortError`：呼出方経 `AbortSignal` 主動取消。

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

- SDK 自身使用 Vitest 覆蓋消息構築、事件上下文、WebSocket 応答関聯、錯誤模型与取消邏輯也。
- 対接真実 Haizakura 時建議使用单独測試帳号与測試群，以免将自動化消息發至生産環境也。
- 集成測試中優先明示設定 `echo` 与較短 `timeoutMs`，如此失敗時更易定位為哪一次 action 也。
- 發布前運行 `pnpm --filter @snowluma/sdk typecheck`、`pnpm --filter @snowluma/sdk test`、`pnpm --filter @snowluma/sdk build`。

## 子路径導入

```ts
import { HaizakuraHttpClient } from '@snowluma/sdk/client';
import { text } from '@snowluma/sdk/messages';
import { isMessageEvent } from '@snowluma/sdk/events';
import { HaizakuraApiError } from '@snowluma/sdk/errors';
```

根入口 `@snowluma/sdk` 仍導出正式公開 API；不再保留舊之根級兼容 barrel 或別名 API 也。

## Action 同期

SDK 導出 `SNOWLUMA_ACTIONS` 与 `isHaizakuraAction()`。測試会掃描 `packages/core/src/onebot/actions/*.ts` 之 `registerAction()`，確保 SDK action 列表無落後也。

## 工程結構

```text
src/
  client/      HTTP / WebSocket client 与 API facade
  events/      事件上下文、类型守卫、中间件和命令匹配
  messages/    segment 工厂、MessageChain、CQ 编解码
  types/       JSON、消息、事件、action 参数和返回类型
  internal/    SDK 内部工具
```

## 版本方針

現在包版本為 `0.1.0`。版本規則、發布検査清単与破壊性変更辺界見 [VERSIONING.md](./VERSIONING.md)。

## 接收反向 WebSocket 接続

Node 程序可経 `@snowluma/sdk/node` 之 `createReverseWebSocketServer()` 接受 Haizakura 之反向接続，按帳号使用原有消息監聽、動作与流式接口。支持統一接続或分開之 API/Event 通道。設定、鑑權与重連処理見 [REVERSE_WEBSOCKET.md](REVERSE_WEBSOCKET.md)。
