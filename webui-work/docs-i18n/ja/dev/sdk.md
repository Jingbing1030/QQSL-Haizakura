# Haizakura SDK


Haizakura の TypeScript SDK です。OneBot HTTP / WebSocket クライアント、イベントミドルウェア、コマンドマッチング、メッセージチェーン構築機能を提供します。

## ナビゲーション

- [インストール](#インストール)
- [クイックスタート](#クイックスタート)
- [HTTP Client](#http-client)
- [WebSocket Client](#websocket-client)
- [イベントミドルウェアとコマンド](#イベントミドルウェアとコマンド)
- [Raw Action](#raw-action)
- [Message Builder](#message-builder)
- [リクエスト制御](#リクエスト制御)
- [エラー処理](#エラー処理)
- [テストの推奨事項](#テストの推奨事項)
- [サブパスインポート](#サブパスインポート)
- [Action 同期](#action-同期)
- [プロジェクト構成](#プロジェクト構成)
- [バージョン方針](#バージョン方針)

グループ申請における参加者、招待者、承認者、および参加通知の身元可用状態については、[グループ招待と参加身元](../onebot/GROUP_REQUESTS.md)を参照してください。

## インストール

このモノレポ内では workspace 経由で直接参照します：

```bash
pnpm add @snowluma/sdk --workspace
```

npm に公開された後はそのままインストールできます：

```bash
pnpm add @snowluma/sdk
```

## クイックスタート

```ts
import { HaizakuraHttpClient, text } from '@snowluma/sdk';

const bot = new HaizakuraHttpClient({
  baseUrl: 'http://127.0.0.1:3000/',
  accessToken: process.env.SNOWLUMA_TOKEN,
});

const login = await bot.getLoginInfo();
await bot.sendGroupMessage(123456, text(`Hello from ${login.nickname}`).at('all'));
```

Haizakura の OneBot HTTP / WebSocket ポートと `accessToken` は `config/onebot_<uin>.json` から取得します。

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

WebSocket クライアントは `echo` で API レスポンスを対応付け、`echo` を持たないパケットはイベントとして配信します。

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

## イベントミドルウェアとコマンド

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

イベントコンテキストには便利な操作があらかじめ用意されています：

- `ctx.reply(message)`：個人チャット／グループチャットに応じて自動的に返信します。
- `ctx.approve()` / `ctx.reject(reason)`：フレンド申請またはグループ申請を処理します。
- `ctx.quickOperation(operation)`：`.handle_quick_operation` を呼び出します。
- `ctx.stopPropagation()`：後続のミドルウェアと通常の `onEvent` 配信を停止します。

## Raw Action

アニメーションシステム絵文字は `face(id, { resultId: '0' })` で結果を指定できます。受信した結果は `face.data.resultId` に保持されます。指定しない場合は既定の選択が使われます。有効な結果は個別の絵文字によって異なり、`large: false` と同時には使用できません。

`await bot.getStatus()` の `time` は、現在のアカウントサービスインスタンスの稼働秒数です。`#sl` と同じ計測起点を使用し、インスタンスが再構築されると計測もやり直しになります。

高頻度インターフェースには camelCase メソッドが用意されています。その他の Haizakura action は `raw` または `rawResponse` で呼び出せます：

```ts
const data = await bot.raw('get_group_file_system_info', {
  group_id: 123456,
});

const response = await bot.rawResponse('get_status');
```

`raw` は Haizakura が `status: "failed"` または非ゼロの `retcode` を返した場合に `HaizakuraApiError` をスローします。`rawResponse` は完全なレスポンスを保持します。

### 空間プロフィールの読み取りと変更

`get_qzone_profile` は QQ 空間の名称と説明を返します。この 2 つのフィールドは QQ ニックネームや個性署名とは独立しています。

```ts
const profile = await bot.raw('get_qzone_profile', {}); // 当前账号
console.log(profile.name, profile.description);
await bot.raw('get_qzone_profile', { target_uin: '10002' });

await bot.raw('set_qzone_profile', { name: '我的空间' });
await bot.raw('set_qzone_profile', { description: '' }); // 清空说明
```

`set_qzone_profile` は現在のアカウントのみを変更し、`name`、`description` のうち少なくとも 1 つを指定する必要があります。省略したフィールドは元の値を保持し、空文字列はクリアを意味します。成功時は `null` を返し、ログイン失効、アクセス制限、上流による検証要求の際には `HaizakuraApiError` をスローします。変更後は再度プロフィールを読み取って結果を確認できます。

### 空間説説のコメントの読み取り

`get_qzone_msg_detail` は読み取り専用の拡張アクションで、`raw` は引数と結果の型を提供します：

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

`comment_num` はサーバーが報告する総数、`comments` はこのページの 1 階層目のコメントです。`num` の範囲は 1〜100 ですが、実際に返る件数はそれより少ないことがあります。2 階層目の返信は独立したページングを持たず、`replies` は完全であることは保証されません。コメント ID は所属する説説内で一意、返信 ID は親コメント内で一意です。時刻はいずれも Unix 秒で、本文は空間絵文字と @ マークを保持します。このインターフェースは現在のアカウントの空間ログイン状態を再利用し、ログインまたはアクセス権限に失敗すると `HaizakuraApiError` をスローします。

ページングパラメータおよび `commentlist` / `list_3` フィールドについては [Qzone-API](https://github.com/SmartHypercube/Qzone-API/blob/master/qzone.py) を参照してください。実際のページングと可視コンテンツは QQ 空間サーバー側に依存します。

### 空友の閲覧と公共空間

`get_qzone_home_feeds` は自分の空間ホームページを読み取ります。`target_uin` を渡すと権限のある他のホームページにもアクセスできます。`cursor` には同一アカウント・同一ホームページで前回返された `next_cursor` を使用します。完全な動態を返し、旧版の `get_qzone_feeds` と `get_qzone_msg_list` は元の形式を維持します。

説説番号が既にある場合は `get_qzone_feed_detail` を呼び出し、`get_qzone_msg_list` または `send_qzone_msg` が返した 24 桁 16 進数の `tid` を渡します。このインターフェースは通常の空間説説を読み取り、番号から作者と投稿時刻を自動的に取得するため `target_uin` は不要です。アクセスには引き続き現在のアカウントの権限を使用します。結果の `feed` は 1 つの完全な動態オブジェクトで、画像、動画、共有情報、未知のフィールドを保持するため、`.feed.feed` を再度取得する必要はありません。その他の上流の詳細フィールドも保持され、`attach_info` は上流のコメントカーソルです（未提供の場合は `null`）。詳細は 1 回だけ読み取り、自動ページングは行わず、コメントと返信の完全性も保証しません。旧来の `get_qzone_msg_detail` とその `pos/num` ページングは変更されません。

```ts
const detail = await bot.raw('get_qzone_feed_detail', {
  tid: '1127000000f1536501000000', // 替换为实际说说编号
});
const card = await bot.raw('get_qzone_share_ark', { feed: detail.feed });
// 若 card.requires_confirmation 为 true，发送前展示 card.notice 并取得确认。
```

詳細、ホームページ、または推薦リストの完全な動態を `get_qzone_share_ark` に渡すと、`{ ark, requires_confirmation, notice }` が得られます。このアクションは共有カードを生成しますがメッセージは送信しません。`ark` の原文を通常の JSON メッセージ送信インターフェースに渡せばメッセージ番号が取得でき、既存の撤回および送信イベントの機能をそのまま利用できます。読み取れることは共有が許可されていることを意味しません。共有が制限されている場合や上流の共有情報が欠けている場合、共有インターフェースは明確にエラーを返します。

共有リンクは未ログイン者でも動態にアクセスできる可能性があり、作者の QQ 番号を含みます。`requires_confirmation` が `true` の場合は、送信前に `notice` を提示して確認を得てください。上流が共有を禁止している場合や生成に失敗した場合はエラーが返ります。

```ts
const page = await bot.raw('get_qzone_home_feeds', {});
if (page.feeds[0]) {
  const card = await bot.raw('get_qzone_share_ark', { feed: page.feeds[0] });
  // 先按 requires_confirmation / notice 确认分享范围，再由调用方决定是否发送。
  // 发送时使用 [{ type: 'json', data: { data: card.ark } }]，保持卡片原文。
}
```

公共空間アクションは推薦ドメイン `3` の JSON インターフェースを使用し、上記の旧来の空間 CGI アクションとは分かれています。まず `get_qzone_public_feeds` を読み取り、返された完全な `feed` オブジェクトを詳細およびインタラクションのアクションに渡し、その中のアイデンティティ、受け渡しデータ、未知のフィールドを保持します。旧来の説説 `tid` で組み立てないでください。

| アクション | 主なパラメータ |
| --- | --- |
| `get_qzone_public_capabilities` | なし。現在のアカウントの入口能力を読み取ります |
| `get_qzone_public_feeds` | 省略可能な `cursor` |
| `get_qzone_public_feed_detail` | `feed` |
| `get_qzone_public_comments` | `feed`、`cursor` |
| `get_qzone_public_replies` | `feed`、完全な `comment`、省略可能な `cursor`、`page_size`（既定 20） |
| `set_qzone_public_upvote` / `set_qzone_public_like` / `set_qzone_public_follow` | `feed`、省略可能な `enable`（既定 `true`、`false` で解除） |
| `set_qzone_public_comment_like` | `feed`、完全な `comment`、省略可能な完全な `reply`、`enable`（既定 `true`） |
| `comment_qzone_public_feed` | `feed`、`content` |
| `reply_qzone_public_feed` | `feed`、完全な `comment`、`content`、省略可能な完全な `reply` |
| `delete_qzone_public_comment` / `delete_qzone_public_reply` | `feed`、完全な `comment`。返信の削除には完全な `reply` も必要です |
| `forward_qzone_public_feed` | `feed`、省略可能な `reason`（既定は空文字列） |

「推」と「賛」は異なるインタラクションで、それぞれ `set_qzone_public_upvote` と `set_qzone_public_like` を使用します。コメントまたは返信の `content` は、非空のテキスト、または非空の上流リッチテキストオブジェクト配列を受け付けます。詳細、コメント、返信、および書き込み操作は上流の結果フィールドを保持し、`raw` はこれらの JSON オブジェクトを返します。リストの `feeds` は上流の各項目の `.feed` ラッパーを除去済みで、その他のフィールドはオープンなままです。

QQ の上流はコメントの改行を正規化するため、返されるリッチテキストは上流の形式を保持します。

`set_qzone_public_comment_like` はコメントへのいいねです。`reply` を指定するとその返信へのいいねに変わり、`enable: false` で解除します。コメントまたは返信が持つ `like.id` を保持し、コメント ID に置き換えないでください。

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

リストの続きページでは `next_cursor` をそのまま返す必要があり、`has_more` で終了を判断します。このページが 10 件未満であることを理由に停止してはいけません。詳細の最初のコメント群は `feed.feed.cell_comment.comments` にあります。以降のコメントは、詳細または前のコメントページの `attach_info` を `cursor` として使用します。返信を読み取る場合、最初は `cursor` を省略して完全なコメントが持つ `reply_attach_info` を使用し、以降は前の返信ページの `reply_attach_info` を渡します。これらのカーソルにはそれぞれ用途があり、リストのカーソルは現在のアカウントにも紐付いています。ログインまたはアクセス権限に失敗すると `HaizakuraApiError` をスローします。

### 個別管理者権限

`set_group_admin` は管理者身分の付与または解除に使用します。既存の管理者に対しては、以下のアクションで権限を読み取ったり変更したりできます。呼び出すアカウントには QQ サーバーが要求する管理権限が必要です。

| アクション | パラメータと結果 |
| --- | --- |
| `get_group_admin_permissions` | `group_id`、`user_id`。撤回権限、除名権限、1 日の除名上限、検証メッセージ受信状態を返します |
| `set_group_admin_permissions` | `group_id`、`user_id`、および少なくとも 1 つの `recall_member_message` / `kick_member` |
| `set_group_admin_receive_verify` | `group_id`、`user_id`、必須の `enable`。グループ参加の検証メッセージの受信を個別に設定します |

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

明示的に指定した権限のみを変更します。除名権限を有効にするには `kick_member_per_day` を明示的に指定する必要があり、`0`、`5`、`10`、`20`、`50`、`100`、`200` をサポートします。このうち `0` は無制限を意味します。上限を変更する場合も同時に `kick_member: true` を渡す必要があり、除名権限を無効にするか省略する場合は上限を指定できません。SDK の `kick_member` はブール値を使用し、型チェックで上限を制約できるようにしています。

読み取り結果には `group_id`、`user_id`、`recall_member_message`、`kick_member`、`kick_member_per_day`、`receive_verify` が含まれます。`receive_verify` はグループ参加の検証メッセージを受信するかどうかを表します。サーバーが返さなかった、または指定しなかった状態は `null` です。除名権限が無効または未指定の場合、上限も `null` になります。各項目は独立したクエリから取得されるため、同一時点の状態であることは保証されません。いずれかのクエリが失敗するとエラーになります。

2 つの書き込みアクションはそれぞれ 1 回のリクエストを送信し、自動再試行や管理者身分の付与は行いません。権限の書き込み成功はサーバーがリクエストを確認したことを意味します。検証メッセージ受信の書き込みでは、レスポンス内のグループ番号と成功した管理者リストも照合します。どちらも `null` を返します。クライアント側の完全な表示と実際の権限効果は依然として実機の QQ で検証する必要があり、インターフェースの成功を検収の代わりにはできません。

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

CQ 変換はパラメータ内のリテラルエスケープテキスト、たとえば画像パス内の `&#44;` を保持し、再びカンマにデコードすることはありません。

チェーン入口は `MessageChain` を返し、そのまま送信インターフェースに渡すことも、`build()` / `toSegments()` で OneBot segment 配列に変換することもできます：

```ts
await bot.sendGroupMessage(123456, text('hi').at(10001).image('/tmp/a.png'));

const segments = text('hi').at('all').build();

await text('hi').atAll().br().face(14).sendToGroup(bot, 123456);
```

`reply()` は 1 つのチェーン内で 1 回しか出現できません。TypeScript は `text('a').reply(1).reply(2)` を拒否し、実行時にも同じチェックを行います。

よく使われるセグメントはあらかじめ組み込まれています：`text`、`br`、`face`、`at`、`atAll`、`reply`、`image`、`record`、`video`、`json`、`xml`、`poke`、`forward`、`node`、`share`、`music`、`location`、`contact`、`raw`。

### 結合転送におけるカスタム引用

結合転送ノードの `content` は `reply.data.message` をサポートしており、引用対象がローカルのメッセージストアに存在する必要はありません。
SDK は `message.customReply()` を提供します（メッセージセグメントを返し、転送ノード専用です）：

```ts
await bot.raw('send_group_forward_msg', {
  group_id: 123456,
  messages: [message.node(10001, '发送者', [
    message.customReply([message.text('Haizakura')], { qq: 10002, time: 1700000000, seq: 42 }),
    message.text('这是回复内容'),
  ])],
});
```

対応する OneBot JSON は `{ "type": "reply", "data": { "message": [{ "type": "text", "data": { "text": "Haizakura" } }] } }` です。
`message` にはテキスト／CQ 文字列、単一のメッセージセグメント、またはメッセージセグメント配列を指定でき、空にはできません。明示的に指定した場合は `id` より優先されます。
引用プレビューは文字と @ を保持し、画像、絵文字、音声、動画、ファイル、転送、JSON/XML カード、Markdown は型を示すテキスト要約を使用します。引用のためにメディアを再アップロードすることはありません。
引用内容はネストした `reply`/`node`、および `music`、`contact`、`poke` などの他の型をサポートしません。無効な内容はパラメータエラーを返します。

`qq`、`time`、`seq` は整数または整数文字列を受け付けます。省略した場合はそれぞれ現在のノードの送信者、ノードの時刻（未指定の場合は現在時刻）、`1` を使用します。
`qq` は正の安全な整数、`time` は 0 から 4294967295 の Unix 秒、`seq` は 1 から 4294967295 の序番号でなければなりません。
これらのフィールドは引用プレビューに使用されます。カスタム引用が QQ 上で元のメッセージへジャンプできることは保証されません。この拡張は JSON メッセージセグメントで渡してください。SDK の `toCQString` はネストしたメッセージセグメントを CQ パラメータに変換することを拒否し、内容が `[object Object]` になるのを防ぎます。

`get_forward_msg` の返信セグメントには依然として `id` が含まれます。QQ が埋め込みの引用内容を返した場合は、さらに `message` と、利用可能な `qq`、`time`、`seq` が含まれます。
返されたノードの `message` を新しい転送ノードの `content` として渡せば引用プレビューを保持でき、`get_msg` で引用 ID を照会する必要はありません。
QQ が引用内容を提供しない場合は、元の `id` のみを返します。通常のグループチャット／個人チャットにおける `reply.data.id` の使い方は変わりません。

## リクエスト制御

各リクエストでは `echo`、タイムアウト、`AbortSignal` を上書きできます：

WebSocket の並行リクエストでは異なる `echo` を使用する必要があり、重複した値は拒否されます。省略した場合は SDK が自動生成します。

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

`timeoutMs: 0` はそのリクエストのタイムアウト制御を無効にします。
WebSocket の通常リクエストのタイムアウトは呼び出し時点から始まり、接続確立の待機とレスポンスの待機を含む合計時間です。接続成功後に計測がやり直されることはありません。接続待機中にすでにタイムアウトまたはキャンセルされたリクエストが、接続の到着後に送信されることはありません。個々のリクエストのキャンセルは、他のリクエストが使用中または待機中の共有接続を閉じません。

## エラー処理

SDK は統一されたエラー基底クラスと、より具体的なエラー型を公開します：

- `HaizakuraApiError`：OneBot レスポンスの失敗、または `retcode !== 0`。
- `HaizakuraAuthError`：認証に関連する retcode。たとえば `1401`、`401`、`403`。
- `HaizakuraTransportError`：接続、解析、タイムアウト、キャンセルなどのトランスポート層エラーの基底クラス。
- `HaizakuraConnectionError`：HTTP fetch / WebSocket の接続または送信の失敗。
- `HaizakuraParseError`：レスポンスが正当な JSON でない、または OneBot のレスポンス構造に適合しない。
- `HaizakuraTimeoutError`：リクエストが `timeoutMs` を超過。
- `HaizakuraAbortError`：呼び出し側が `AbortSignal` で能動的にキャンセル。

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

## テストの推奨事項

- SDK 自体は Vitest を使用し、メッセージ構築、イベントコンテキスト、WebSocket レスポンスの対応付け、エラーモデル、キャンセル処理を網羅しています。
- 実際の Haizakura に接続する場合は、専用のテストアカウントとテストグループを使用し、自動化メッセージを本番環境に送信しないようにしてください。
- 統合テストでは `echo` と短めの `timeoutMs` を明示的に設定することを優先してください。失敗時にどの action だったかを特定しやすくなります。
- リリース前に `pnpm --filter @snowluma/sdk typecheck`、`pnpm --filter @snowluma/sdk test`、`pnpm --filter @snowluma/sdk build` を実行してください。

## サブパスインポート

```ts
import { HaizakuraHttpClient } from '@snowluma/sdk/client';
import { text } from '@snowluma/sdk/messages';
import { isMessageEvent } from '@snowluma/sdk/events';
import { HaizakuraApiError } from '@snowluma/sdk/errors';
```

ルート入口 `@snowluma/sdk` は引き続き正式な公開 API をエクスポートします。旧来のルートレベルの互換 barrel や別名 API は維持しません。

## Action 同期

SDK は `SNOWLUMA_ACTIONS` と `isHaizakuraAction()` をエクスポートします。テストは `packages/core/src/onebot/actions/*.ts` の `registerAction()` を走査し、SDK の action リストに遅れがないことを確認します。

## プロジェクト構成

```text
src/
  client/      HTTP / WebSocket client 与 API facade
  events/      事件上下文、类型守卫、中间件和命令匹配
  messages/    segment 工厂、MessageChain、CQ 编解码
  types/       JSON、消息、事件、action 参数和返回类型
  internal/    SDK 内部工具
```

## バージョン方針

現在のパッケージバージョンは `0.1.0` です。バージョン規則、リリースチェックリスト、破壊的変更の境界については [VERSIONING.md](./VERSIONING.md) を参照してください。

## 逆方向 WebSocket 接続の受け入れ

Node プログラムは `@snowluma/sdk/node` の `createReverseWebSocketServer()` を通じて Haizakura の逆方向接続を受け入れ、アカウントごとに既存のメッセージ監視、アクション、ストリーミングインターフェースを利用できます。統一接続、または分離した API / Event チャネルをサポートします。設定、認証、再接続の処理については [REVERSE_WEBSOCKET.md](REVERSE_WEBSOCKET.md) を参照してください。
