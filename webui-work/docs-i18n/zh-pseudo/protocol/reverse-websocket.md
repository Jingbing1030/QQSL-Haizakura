# 逆方向 WebSocket 接続


`@snowluma/sdk/node`，OneBot 之逆方向 WebSocket 接続受付可能也。Haizakura，
**汝之 SDK 工程**接続，事件送信，汝之工程，同一接続経由動作返也。通常之
`createWebSocketClient()`，仍 Haizakura WebSocket 伺服器接続也。両 SDK 端点皆，
NoneBot/AstrBot 向之 QQ 実装為動作無也。Haizakura 之 `networks.wsClients`，
既其用途担也。

```ts
import { text } from '@snowluma/sdk';
import { createReverseWebSocketServer } from '@snowluma/sdk/node';

const server = createReverseWebSocketServer({
  host: '127.0.0.1',
  port: 3002,
  path: '/onebot/v11/ws',
  accessToken: process.env.ONEBOT_ACCESS_TOKEN,
  // Optional: restrict which accounts may connect, in addition to the token.
  selfIds: ['10001'],
});

server.on('error', (error) => console.error('Reverse connection failed', error));
server.on('rejected', ({ status, reason }) => console.error('Handshake rejected', status, reason));
server.on('connection', (bot) => {
  console.log('Connected account', bot.selfId);
  bot.onMessage(async (_event, context) => {
    await context.reply(text('received'));
  });
});
server.on('disconnect', ({ client, code }) => console.log('Disconnected', client.selfId, code));
await server.listen();
// Await server.close() when shutting down your application.
```

対応之 Haizakura 帳号，`networks.wsClients` 之 entry 構成下。

```json
{
  "name": "sdk",
  "url": "ws://127.0.0.1:3002/onebot/v11/ws",
  "accessToken": "same-token-as-the-sdk-server",
  "role": "Universal",
  "messageFormat": "array",
  "reportSelfMessage": false
}
```

二工程異主機動作場合，SDK 主機之位址使用下。聴取者，既定 loopback 僅 bind 也。
認証，Bearer 標頭或 `access_token` query parameter 受付也。Token 空或省略場合，
token 確認行無也。帳号及 role 標頭，仍必須也。握手拒否事件，資格情報或幀本文含無也。

## 会話段及路

`connection`，`HaizakuraReverseWebSocketSession` 提供，`selfId`（文字列）、
`canCallActions`、`canReceiveEvents`、及既存前方向客端之補助道具（`onMessage`、
中間件、`waitForMessage`、`getStatus`、消息送信、`request`、`requestStream`、
上伝／下載補助道具）備也。符号付消息 ID、応答錯誤、超時、cancel、流制限，
既存意味維持也。

`server.getClient(selfId)` 及読取専用 `server.clients` 快照，生会話段公開也。
各帳号，自身保留中請求及事件 handler 所有也。事件，`X-Self-ID` 宣言帳号一致必要，
不一致，会話段閉，錯誤報告也。重複 active 路，HTTP 409 受，健全会話段置換無也。
任意帳号許可 list，未知帳号 HTTP 403 拒否也。

Universal mode，動作及事件両者運也。路分離場合，同一帳号及同一伺服器位址使用，
Haizakura 之 `Api` 接続一及 `Event` 接続一構成下。`API` 亦 wire 標頭受付也。両者，
一 SDK 会話段共有，故事件 handler 之 `context.reply()`，API 路使用也。`connection`，
最初之路到着時発火，`channel`，受付路毎発火也。

```ts
server.on('channel', ({ client, role }) => {
  console.log(client.selfId, role, client.canCallActions, client.canReceiveEvents);
});
```

分割 mode 動作送信前，`canCallActions` 待下。事件専用会話段動作呼出，明示失敗也。
両半何方閉，会話段全体及其兄弟路終了也。再接続時機，Haizakura 管理也。次接続，
新会話段作成，`connection` 再発火，故 handler 其処新規登録必要也。旧会話段対象，
自身再接続不能也。保留中請求、流 iterator、事件待機，切断時失敗也。遠隔側既実行
可能性有故，動作自動再生，決無也。此伝輸，切断中失事件保持無也。

## 制限、錯誤、所有権

既定値，受信消息毎 100 MiB、路毎 16 MiB 送信緩衝字節数、同時路数 128、動作超時
三十秒、ping 間隔三十秒也。必要応 `maxPayloadBytes`、`maxBufferedBytes`、
`maxConnections`、`requestTimeoutMs`、`heartbeatIntervalMs` 構成下。請求超時零場合，
無期限待機，心拍間隔零場合，ping 無効化也。其他制限，正整数必要也。全計時器，
閉時清理也。過大受信消息，1009 閉也。送信容量不足，動作 queue 入無而拒否也。
次 ping check 応答無 peer，終了為（通常二回心拍間隔以内）。

伺服器 `error` handler 登録下。未処理錯誤，Node EventEmitter 錯誤契約従，throw 也。
会話段伝輸、解析、非同期事件 handler 失敗，其処転送也。不正 peer JSON 及
帳号／路跨幀，接続閉也。起動時 bind 錯誤，`listen()` 直接拒否也。

HTTP 或 HTTPS 伺服器再利用，其伺服器 listen 開始後，`host`/`port` 代 `server` 渡下。
構成済 upgrade path 僅，SDK 属也。通常請求及其他 upgrade path，既存 handler 残也。
`close()`，外部伺服器閉無而，SDK 接続及聴取者解放也。TLS 構成，其 HTTPS 伺服器或
proxy 残也。自動 downgrade 無也。内部所有聴取者，SDK 依閉也。閉中接続，終了前
上限有之握手猶予期間有也。

Node subpath 僅，`ws` runtime 依存 import 也。瀏覧器向 SDK 端点，既存 import 維持也。
TypeScript Node 利用者，通常 `@types/node` 開発依存含，TypeScript 構成
`"types": ["node"]` 有効化下。

検証，実際本地 WebSocket 及実際動作、流 handler 備之 Haizakura `WsClientAdapter`
使用，QQ 帳号自隔離也。Universal 及分割路、身元／認証、消息返信、多帳号 echo、
切断時清理、制限、心拍、外部伺服器所有権、公開 NodeNext/bundler package 利用者
対象也。
