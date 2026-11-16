# 逆方向 WebSocket 接続


`@snowluma/sdk/node` は OneBot の逆方向 WebSocket 接続を受け付けることができます。
Haizakura は **あなたの SDK プログラムへ** 接続してイベントを送信し、あなたの
プログラムは同じ接続を通じてアクションを返します。通常の `createWebSocketClient()` は
引き続き Haizakura WebSocket サーバーへ接続します。どちらの SDK エントリーも
NoneBot/AstrBot 向けの QQ 実装としては動作しません。Haizakura の `networks.wsClients`
がすでにその用途を担っています。

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

対応する Haizakura アカウントを `networks.wsClients` のエントリーで構成してください。

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

2 つのプロセスが異なるマシンで動作する場合は、SDK ホストのアドレスを使用してください。
リスナーは既定ではループバックにのみバインドします。認証は Bearer ヘッダーまたは
`access_token` クエリパラメーターを受け付けます。トークンが空または省略されている
場合はトークン確認を行いません。アカウントとロールのヘッダーは引き続き必須です。
ハンドシェイク拒否イベントに資格情報やフレーム本文は含まれません。

## セッションとチャネル

`connection` は `HaizakuraReverseWebSocketSession` を提供し、`selfId`（文字列）、
`canCallActions`、`canReceiveEvents`、および既存のフォワードクライアントのヘルパー
（`onMessage`、ミドルウェア、`waitForMessage`、`getStatus`、メッセージ送信、`request`、
`requestStream`、アップロード／ダウンロードのヘルパー）を備えます。符号付きメッセージ
ID、レスポンスエラー、タイムアウト、キャンセル、ストリームの制限は、既存の意味を
維持します。

`server.getClient(selfId)` と読み取り専用の `server.clients` スナップショットは、
ライブのセッションを公開します。各アカウントは自身の保留中のリクエストとイベント
ハンドラーを所有します。イベントは `X-Self-ID` で宣言されたアカウントと一致する
必要があり、不一致はセッションを閉じてエラーを報告します。重複したアクティブな
チャネルは HTTP 409 を受け取り、正常なセッションを置き換えません。任意のアカウント
許可リストは、未知のアカウントを HTTP 403 で拒否します。

Universal モードはアクションとイベントの両方を運びます。チャネルを分離する場合は、
同じアカウントと同じサーバーアドレスを使用して、Haizakura の `Api` 接続を 1 つと
`Event` 接続を 1 つ構成してください。`API` もワイヤーヘッダーで受け付けられます。
両者は 1 つの SDK セッションを共有するため、イベントハンドラーの `context.reply()` は
API チャネルを使用します。`connection` は最初のチャネルが到着したときに発火し、
`channel` は受け付けられたチャネルごとに発火します。

```ts
server.on('channel', ({ client, role }) => {
  console.log(client.selfId, role, client.canCallActions, client.canReceiveEvents);
});
```

分割モードでアクションを送信する前に `canCallActions` を待ってください。イベント専用
セッションでアクションを呼び出すと、明示的に失敗します。どちらかの半分を閉じると、
セッション全体とその兄弟チャネルが終了します。再接続のタイミングは Haizakura が
管理します。次の接続は新しいセッションを作成し、`connection` を再び発火させるため、
ハンドラーはそこで新たに登録する必要があります。古いセッションオブジェクトが
自身で再接続することはできません。保留中のリクエスト、ストリームイテレーター、
イベント待機は切断時に失敗します。遠隔側がすでに実行した可能性があるため、
アクションが自動的に再生されることは決してありません。このトランスポートは
切断中に失われたイベントを保持しません。

## 制限、エラー、所有権

既定値は、受信メッセージあたり 100 MiB、チャネルあたり 16 MiB の送信バッファリング
バイト数、同時チャネル数 128、アクションタイムアウト 30 秒、ping 間隔 30 秒です。
必要に応じて `maxPayloadBytes`、`maxBufferedBytes`、`maxConnections`、
`requestTimeoutMs`、`heartbeatIntervalMs` を構成してください。リクエストタイムアウトが
ゼロの場合は無期限に待機し、ハートビート間隔がゼロの場合は ping を無効にします。
その他の制限は正の整数でなければなりません。すべてのタイマーはクローズ時に
クリーンアップされます。大きすぎる受信メッセージは 1009 でクローズします。送信容量の
不足は、アクションをキューに入れることなく拒否します。次の ping チェックに応答しない
ピアは終了させられます（通常は 2 回のハートビート間隔以内）。

サーバーの `error` ハンドラーを登録してください。未処理のエラーは Node の
EventEmitter のエラー契約に従い、スローされます。セッションのトランスポート、
解析、非同期イベントハンドラーの失敗はそこへ転送されます。不正なピア JSON と
アカウント／チャネルをまたぐフレームは接続を閉じます。起動時のバインドエラーは
`listen()` を直接拒否します。

HTTP または HTTPS サーバーを再利用するには、そのサーバーがリッスンを開始した後に、
`host`/`port` の代わりに `server` を渡してください。構成されたアップグレードパス
のみが SDK に属します。通常のリクエストとその他のアップグレードパスは、既存の
ハンドラーに残ります。`close()` は外部サーバーを閉じることなく、SDK の接続と
リスナーを解放します。TLS 構成はその HTTPS サーバーまたはプロキシに残ります。
自動的なダウングレードはありません。内部的に所有されるリスナーは SDK によって
閉じられます。クローズ中の接続には、終了前に上限のあるハンドシェイク猶予期間が
あります。

Node のサブパスのみが `ws` ランタイム依存をインポートします。ブラウザー向けの SDK
エントリーポイントは既存のインポートを維持します。TypeScript の Node 利用者は、
通常の `@types/node` 開発依存を含め、TypeScript 構成で `"types": ["node"]` を
有効にしてください。

検証には実際のローカル WebSocket と、実際のアクションおよびストリームハンドラーを
備えた Haizakura の `WsClientAdapter` を使用し、QQ アカウントから分離しています。
Universal と分割チャネル、身元／認証、メッセージ返信、マルチアカウントのエコー、
切断時のクリーンアップ、制限、ハートビート、外部サーバーの所有権、公開された
NodeNext/bundler パッケージ利用者を対象としています。
