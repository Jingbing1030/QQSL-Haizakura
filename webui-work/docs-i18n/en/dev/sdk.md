# Haizakura SDK


The Haizakura TypeScript SDK, providing an OneBot HTTP / WebSocket client, event middleware, command matching and message chain builders.

## Navigation

- [Installation](#installation)
- [Quick start](#quick-start)
- [HTTP Client](#http-client)
- [WebSocket Client](#websocket-client)
- [Event middleware and commands](#event-middleware-and-commands)
- [Raw Action](#raw-action)
- [Message Builder](#message-builder)
- [Request control](#request-control)
- [Error handling](#error-handling)
- [Testing advice](#testing-advice)
- [Subpath imports](#subpath-imports)
- [Action synchronization](#action-synchronization)
- [Project structure](#project-structure)
- [Version policy](#version-policy)

For the joiner, inviter and approver in group requests, and the identity availability of join notifications, see [group invites and join identities](../onebot/GROUP_REQUESTS.md).

## Installation

Reference it directly through the workspace inside this monorepo:

```bash
pnpm add @snowluma/sdk --workspace
```

Once published to npm you can install it directly:

```bash
pnpm add @snowluma/sdk
```

## Quick start

```ts
import { HaizakuraHttpClient, text } from '@snowluma/sdk';

const bot = new HaizakuraHttpClient({
  baseUrl: 'http://127.0.0.1:3000/',
  accessToken: process.env.SNOWLUMA_TOKEN,
});

const login = await bot.getLoginInfo();
await bot.sendGroupMessage(123456, text(`Hello from ${login.nickname}`).at('all'));
```

Haizakura's OneBot HTTP / WebSocket port and `accessToken` come from `config/onebot_<uin>.json`.

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

The WebSocket client correlates API responses using `echo`, and dispatches packets without an `echo` as events.

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

## Event middleware and commands

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

The event context has built-in shortcuts:

- `ctx.reply(message)`: replies automatically for private or group chats.
- `ctx.approve()` / `ctx.reject(reason)`: handles friend or group requests.
- `ctx.quickOperation(operation)`: calls `.handle_quick_operation`.
- `ctx.stopPropagation()`: stops later middleware and ordinary `onEvent` dispatch.

## Raw Action

Animated system emoji can select a result with `face(id, { resultId: '0' })`; the received result is kept in `face.data.resultId`. Omitting it keeps the default selection; valid results depend on the specific emoji, and it cannot be combined with `large: false`.

`time` in `await bot.getStatus()` is the running seconds of the current account's service instance, using the same starting point as `#sl`; the timer restarts when the instance is rebuilt.

High-frequency interfaces have camelCase methods; other Haizakura actions can use `raw` or `rawResponse`:

```ts
const data = await bot.raw('get_group_file_system_info', {
  group_id: 123456,
});

const response = await bot.rawResponse('get_status');
```

`raw` throws `HaizakuraApiError` when Haizakura returns `status: "failed"` or a non-zero `retcode`; `rawResponse` keeps the full response.

### Reading and modifying Qzone profile data

`get_qzone_profile` returns the QQ Qzone name and description; these two fields are independent of the QQ nickname and personal signature.

```ts
const profile = await bot.raw('get_qzone_profile', {}); // 当前账号
console.log(profile.name, profile.description);
await bot.raw('get_qzone_profile', { target_uin: '10002' });

await bot.raw('set_qzone_profile', { name: '我的空间' });
await bot.raw('set_qzone_profile', { description: '' }); // 清空说明
```

`set_qzone_profile` only modifies the current account and requires at least one of `name` or `description`; omitted fields keep their current values, and an empty string clears them. It returns `null` on success, and throws `HaizakuraApiError` when the login has expired, access is restricted, or the upstream requires verification. After modifying, read the profile again to confirm the result.

### Reading Qzone post comments

`get_qzone_msg_detail` is a read-only extension action; `raw` provides its parameter and result types:

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

`comment_num` is the total reported by the server, and `comments` are this page's top-level comments; `num` ranges from 1 to 100, and fewer may actually be returned. Second-level replies are not paginated separately, and `replies` is not guaranteed to be complete. A comment ID is unique within its post, and a reply ID is unique within its parent comment; all times are Unix seconds, and the body preserves Qzone emoji and @ markers. This endpoint reuses the current account's Qzone login session; a login or access-permission failure throws `HaizakuraApiError`.

For pagination parameters and the `commentlist` / `list_3` fields, see [Qzone-API](https://github.com/SmartHypercube/Qzone-API/blob/master/qzone.py). The actual pagination and visible content depend on the QQ Qzone server.

### Home feeds and public Qzone

`get_qzone_home_feeds` reads your own Qzone home page; you can pass `target_uin` to access another home page you have permission for; `cursor` uses the `next_cursor` returned last time for the same account and the same home page. It returns complete feed items, while the older `get_qzone_feeds` and `get_qzone_msg_list` keep their original formats.

When you already have a post ID, call `get_qzone_feed_detail` and pass the 24-character hexadecimal `tid` returned by `get_qzone_msg_list` or `send_qzone_msg`. This endpoint reads an ordinary Qzone post, deriving the author and publication time from the ID automatically, and does not need `target_uin`; access still uses the current account's permissions. The result's `feed` is a single complete feed object that preserves images, videos, share information and unknown fields, with no need to fetch `.feed.feed` again. Other upstream detail fields are preserved too, and `attach_info` is the upstream comment cursor (`null` when not provided); the detail is read only once, with no automatic paging and no guarantee that comments and replies are complete. The older `get_qzone_msg_detail` and its `pos/num` pagination are unchanged.

```ts
const detail = await bot.raw('get_qzone_feed_detail', {
  tid: '1127000000f1536501000000', // 替换为实际说说编号
});
const card = await bot.raw('get_qzone_share_ark', { feed: detail.feed });
// 若 card.requires_confirmation 为 true，发送前展示 card.notice 并取得确认。
```

Pass a complete feed from a detail, home page or recommendation list to `get_qzone_share_ark` to get `{ ark, requires_confirmation, notice }`. This action builds a share card but does not send a message; hand the raw `ark` to the ordinary JSON message send endpoint to obtain a message ID, and keep using the existing recall and send-event capabilities. Being able to read does not mean sharing is allowed: when sharing is restricted or upstream share information is missing, the share endpoint reports an explicit error.

A share link may let users who are not logged in view the feed, and includes the author's QQ number. If `requires_confirmation` is `true`, show `notice` and obtain confirmation before sending; if upstream forbids sharing or generation fails, an error is returned.

```ts
const page = await bot.raw('get_qzone_home_feeds', {});
if (page.feeds[0]) {
  const card = await bot.raw('get_qzone_share_ark', { feed: page.feeds[0] });
  // 先按 requires_confirmation / notice 确认分享范围，再由调用方决定是否发送。
  // 发送时使用 [{ type: 'json', data: { data: card.ark } }]，保持卡片原文。
}
```

Public Qzone actions use the JSON interface of recommendation domain `3`, separate from the older Qzone CGI actions above. First read `get_qzone_public_feeds`, then pass the complete `feed` object returned to the detail and interaction actions, preserving the identity, transfer data and unknown fields within it; do not fabricate one from an older post `tid`.

| Action | Main parameters |
| --- | --- |
| `get_qzone_public_capabilities` | None; reads the current account's entry capabilities |
| `get_qzone_public_feeds` | Optional `cursor` |
| `get_qzone_public_feed_detail` | `feed` |
| `get_qzone_public_comments` | `feed`, `cursor` |
| `get_qzone_public_replies` | `feed`, a complete `comment`, optional `cursor`, `page_size` (default 20) |
| `set_qzone_public_upvote` / `set_qzone_public_like` / `set_qzone_public_follow` | `feed`, optional `enable` (default `true`; `false` cancels) |
| `set_qzone_public_comment_like` | `feed`, a complete `comment`, optional complete `reply`, `enable` (default `true`) |
| `comment_qzone_public_feed` | `feed`, `content` |
| `reply_qzone_public_feed` | `feed`, a complete `comment`, `content`, optional complete `reply` |
| `delete_qzone_public_comment` / `delete_qzone_public_reply` | `feed`, a complete `comment`; deleting a reply also needs the complete `reply` |
| `forward_qzone_public_feed` | `feed`, optional `reason` (default empty string) |

"Upvote" and "like" are different interactions, using `set_qzone_public_upvote` and `set_qzone_public_like` respectively. `content` for a comment or reply accepts non-empty text or a non-empty array of upstream rich-text objects. Details, comments, replies and write operations preserve upstream result fields, and `raw` returns those JSON objects; a list's `feeds` has the upstream per-item `.feed` wrapper removed, and other fields remain open.

The QQ upstream normalizes line breaks in comments, and the returned rich text keeps the upstream format.

`set_qzone_public_comment_like` likes a comment; when `reply` is provided it likes that reply instead, and `enable: false` cancels. Preserve the `like.id` that comes with the comment or reply; do not replace it with the comment ID.

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

Continuing a list requires passing `next_cursor` back unchanged and deciding when to stop from `has_more`; do not stop just because this page has fewer than 10 items. The first batch of comments in a detail sits at `feed.feed.cell_comment.comments`; for later comments use `attach_info` from the detail or from the previous comment page as `cursor`. When reading replies, omit `cursor` the first time to use the `reply_attach_info` carried by the complete comment, then pass the `reply_attach_info` from the previous reply page. These cursors each serve a different purpose, and the list cursor is also bound to the current account. A login or access-permission failure throws `HaizakuraApiError`.

### Individual administrator permissions

`set_group_admin` grants or revokes administrator status. For an existing administrator, the following actions read or modify permissions; the calling account needs the administrative privileges the QQ server requires.

| Action | Parameters and result |
| --- | --- |
| `get_group_admin_permissions` | `group_id`, `user_id`; returns recall permission, removal permission, the daily removal limit and the receive-verification-message state |
| `set_group_admin_permissions` | `group_id`, `user_id`, plus at least one of `recall_member_message` / `kick_member` |
| `set_group_admin_receive_verify` | `group_id`, `user_id`, required `enable`; sets receiving join-verification messages independently |

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

Only explicitly provided permissions are modified. Enabling the removal permission requires `kick_member_per_day` explicitly, supporting `0`, `5`, `10`, `20`, `50`, `100` and `200`, where `0` means unlimited. Changing the limit also requires `kick_member: true` at the same time; the limit must not be provided when the removal permission is off or omitted. The SDK uses a boolean for `kick_member` so type checking constrains the limit.

The read result contains `group_id`, `user_id`, `recall_member_message`, `kick_member`, `kick_member_per_day` and `receive_verify`. `receive_verify` indicates whether join-verification messages are received. A state the server did not return or specify is `null`; when the removal permission is off or unspecified, the limit is `null` too. Each item comes from an independent query, so the states are not guaranteed to be from the same moment; any query failure reports an error.

The two write actions each send one request and do not retry automatically or grant administrator status. A successful permission write means the server confirmed the request; writing the receive-verification setting also checks the group number and successful administrator list in the response. Both return `null`. Full client display and the actual permission effect still need verification with a real QQ; a successful API call is not a substitute for acceptance testing.

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

CQ conversion preserves literal escaped text in parameters, such as `&#44;` in an image path, and does not decode it back into a comma.

Chained entry points return a `MessageChain`, which can be passed straight to a send endpoint or converted into an OneBot segment array with `build()` / `toSegments()`:

```ts
await bot.sendGroupMessage(123456, text('hi').at(10001).image('/tmp/a.png'));

const segments = text('hi').at('all').build();

await text('hi').atAll().br().face(14).sendToGroup(bot, 123456);
```

`reply()` may appear only once in a chain; TypeScript blocks `text('a').reply(1).reply(2)`, and the runtime performs the same check.

Common segments are built in: `text`, `br`, `face`, `at`, `atAll`, `reply`, `image`, `record`, `video`, `json`, `xml`, `poke`, `forward`, `node`, `share`, `music`, `location`, `contact` and `raw`.

### Custom quotes in merged forwards

A merged-forward node's `content` supports `reply.data.message`, so the quoted target does not need to exist in the local message store.
The SDK provides `message.customReply()` (returns a message segment, for forward nodes only):

```ts
await bot.raw('send_group_forward_msg', {
  group_id: 123456,
  messages: [message.node(10001, '发送者', [
    message.customReply([message.text('Haizakura')], { qq: 10002, time: 1700000000, seq: 42 }),
    message.text('这是回复内容'),
  ])],
});
```

The corresponding OneBot JSON is `{ "type": "reply", "data": { "message": [{ "type": "text", "data": { "text": "Haizakura" } }] } }`.
`message` may be a text/CQ string, a single message segment or an array of message segments, and must not be empty; when provided explicitly it takes precedence over `id`.
The quote preview preserves text and @; images, emoji, voice, video, files, forwards, JSON/XML cards and Markdown use a type-based text summary, and no media is re-uploaded for the quote.
Quoted content does not support nested `reply`/`node` or other types such as `music`, `contact` and `poke`; invalid content returns a parameter error.

`qq`, `time` and `seq` accept integers or integer strings. When omitted they default to the current node's sender, the node's time (the current time when unspecified) and `1`, respectively.
`qq` must be a positive safe integer, `time` is Unix seconds from 0 to 4294967295, and `seq` is a sequence number from 1 to 4294967295.
These fields are used for the quote preview; a custom quote is not guaranteed to jump to the original message in QQ. Pass this extension using JSON message segments; the SDK's `toCQString` refuses to convert nested message segments into CQ parameters, preventing the content from becoming `[object Object]`.

A reply segment from `get_forward_msg` still contains `id`; when QQ returns embedded quoted content it also contains `message` plus the available `qq`, `time` and `seq`.
Using the returned node's `message` as the `content` of a new forward node preserves the quote preview, with no need to look up the quote ID via `get_msg` again.
If QQ does not provide quoted content, only the original `id` is returned. The usual `reply.data.id` usage in ordinary group and private chats is unchanged.

## Request control

Every request supports overriding `echo`, the timeout and an `AbortSignal`:

Concurrent WebSocket requests must use different `echo` values; duplicates are rejected. When omitted, the SDK generates one automatically.

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

`timeoutMs: 0` disables timeout control for that request.
For an ordinary WebSocket request the timeout starts at call time and covers the total time waiting for the connection to be established and for the response;
it is not restarted once the connection succeeds. A request that already timed out or was cancelled while waiting for the connection is not sent later once the connection arrives;
cancelling one request does not close the shared connection that other requests are using or waiting on.

## Error handling

The SDK exposes a unified error base class and more specific error types:

- `HaizakuraApiError`: the OneBot response failed or `retcode !== 0`.
- `HaizakuraAuthError`: authentication-related retcodes such as `1401`, `401`, `403`.
- `HaizakuraTransportError`: base class for transport-layer errors such as connection, parse, timeout and cancellation.
- `HaizakuraConnectionError`: HTTP fetch / WebSocket connection or send failure.
- `HaizakuraParseError`: the response is not valid JSON or does not match the OneBot response structure.
- `HaizakuraTimeoutError`: the request exceeded `timeoutMs`.
- `HaizakuraAbortError`: the caller cancelled through an `AbortSignal`.

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

## Testing advice

- The SDK itself uses Vitest to cover message construction, event contexts, WebSocket response correlation, the error model and cancellation logic.
- When integrating with a real Haizakura, use a separate test account and test group so automated messages do not reach production.
- In integration tests, set `echo` explicitly and use a short `timeoutMs` so failures are easier to trace to a specific action.
- Before publishing, run `pnpm --filter @snowluma/sdk typecheck`, `pnpm --filter @snowluma/sdk test` and `pnpm --filter @snowluma/sdk build`.

## Subpath imports

```ts
import { HaizakuraHttpClient } from '@snowluma/sdk/client';
import { text } from '@snowluma/sdk/messages';
import { isMessageEvent } from '@snowluma/sdk/events';
import { HaizakuraApiError } from '@snowluma/sdk/errors';
```

The root entry `@snowluma/sdk` still exports the official public API; the older root-level compatibility barrel and alias APIs are no longer kept.

## Action synchronization

The SDK exports `SNOWLUMA_ACTIONS` and `isHaizakuraAction()`. Tests scan `registerAction()` in `packages/core/src/onebot/actions/*.ts` to make sure the SDK action list has not fallen behind.

## Project structure

```text
src/
  client/      HTTP / WebSocket client 与 API facade
  events/      事件上下文、类型守卫、中间件和命令匹配
  messages/    segment 工厂、MessageChain、CQ 编解码
  types/       JSON、消息、事件、action 参数和返回类型
  internal/    SDK 内部工具
```

## Version policy

The current package version is `0.1.0`. For version rules, the release checklist and the boundaries of breaking changes, see [VERSIONING.md](./VERSIONING.md).

## Accepting reverse WebSocket connections

A Node program can accept Haizakura's reverse connections through `createReverseWebSocketServer()` from `@snowluma/sdk/node`, using the existing message listeners, actions and streaming interfaces per account. It supports a unified connection or separate API/Event channels. For configuration, authentication and reconnection handling, see [REVERSE_WEBSOCKET.md](REVERSE_WEBSOCKET.md).
