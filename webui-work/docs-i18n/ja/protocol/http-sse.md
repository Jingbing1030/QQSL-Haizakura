# OneBot HTTP イベントストリーム


HTTP サーバーは、同一のリスナー上でアクションと Server-Sent Events の両方を提供できます。
WebUI の HTTP API アダプターで **SSE** を有効にするか、`networks.httpServers` のエントリに
`enableSse: true` を設定してください。既定値は `false` です。既存の HTTP および WebSocket
設定はそのままの動作を維持します。SSE と `enableWebSocket` は同時に有効にできます。

```json
{
  "name": "web-client",
  "host": "127.0.0.1",
  "port": 3000,
  "path": "/api",
  "enableSse": true,
  "accessToken": "replace-with-your-token",
  "messageFormat": "array",
  "reportSelfMessage": false
}
```

`GET /api/_events?access_token=<token>` でイベントストリームを開きます。アクションは
引き続き `POST /api/<action>` と JSON パラメーターオブジェクトを使用します。HTTP リクエストは
`Authorization: Bearer <token>`、`Authorization: <token>`（Stapxs QQ Lite 用）、または
`access_token` クエリパラメーターを受け付けます。設定されたトークンとバインドアドレスは
引き続き適用されます。トークンが空の場合は、既存の認証なし HTTP 動作を維持します。

```js
const events = new EventSource(`api/_events?access_token=${encodeURIComponent(token)}`);
events.onmessage = ({ data }) => console.log(JSON.parse(data));
events.onerror = () =>
  console.error('Event connection interrupted; check connection and authentication');

const response = await fetch('api/get_status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: token },
  body: JSON.stringify({}),
});
if (!response.ok) throw new Error(`Action failed: HTTP ${response.status}`);
console.log(await response.json());
// Close the stream when the owning page/component is disposed.
// events.close();
```

同一オリジンのプロキシプレフィックスの下で両方を公開する場合は、Stapxs の SSE イベント
アドレスを `api/_events`、HTTP アドレスを `api` に設定します。リクエストパス、クエリ文字列、
認証情報、`Last-Event-ID` ヘッダーは変更せずに転送してください。Haizakura はクロスオリジンの
アクセス許可を追加しません。TLS および追加のプロキシ認証は、プロキシ側の責任で管理します。

レスポンスは `text/event-stream`、`Cache-Control: no-cache, no-transform`、
`X-Accel-Buffering: no` を使用します。イベントは OneBot JSON を含む、名前のない通常の
`data:` フレームです。接続のライフサイクルイベントと現在のハートビートイベントが、各
サブスクリプションの初期化情報を提供します。トランスポートコメント（`: ping`）は 15 秒ごとに
送信されますが、これは OneBot イベントではありません。ブラウザーの再接続遅延は 3 秒です。

## 再接続とリソース制限

ブロードキャストされる各イベントには不透明な `id` が付きます。`Last-Event-ID` を伴う再接続では、
そのカーソルより後のイベントが、接続の初期化イベントと以降のライブイベントの前に、順序どおり
再生されます。ネイティブの EventSource は、同じオブジェクトで再接続するときにこのヘッダーを
自動送信します。ヘッダーを伴わない新しいサブスクリプションは現在時点から開始し、過去の
メッセージを受信しません。

各アダプターは、クライアントが接続していない間も含め、メモリ内に最大 256 イベント、8 MiB を
保持します。これは短い再接続ウィンドウであり、永続的なメッセージ履歴ではありません。アカウント
とアダプターインスタンスはそれぞれ独立した履歴を持ちます。イベント ID は、再起動、シャットダウン、
トークンローテーション、レポートポリシーの変更、または SSE の無効化によって無効になります。
再生もライブ配信も、`messageFormat` や `reportSelfMessage` を迂回することはありません。

無効なカーソルは HTTP 400 を返します。期限切れ、未来、または他者のカーソルは、再生が
利用できないことを説明する `wording` とともに HTTP 409 を返します。ライブ配信のみへの
暗黙のフォールバックはありません。アプリケーションの状態と履歴を整合させた後、EventSource を
閉じて再作成し、古いカーソルなしでサブスクライブしてください。EventSource のエラーコールバックは
HTTP エラー本文を公開しません。fetch ベースの消費側はそれを直接検査できます。初期化イベントは
最新のブロードキャストカーソルを共有する場合があり、新たに永続化されたメッセージイベントとして
扱ってはいけません。

各クライアントの保留出力は 8 MiB に制限されます。読み取りの遅いクライアントは、無制限に
イベントを保持したり他のクライアントをブロックしたりする代わりに、警告とともに切断されます。
この制限を超える単一フレームも、そのクライアントを切断します。再接続は同じ再生制限の対象です。
切断、ホットリロード、シャットダウンは接続とハートビートタイマーを解放します。トークンを
ローテーションすると、既存のストリームは失効します。

テスト: `pnpm --filter @snowluma/onebot exec vitest run tests/http-server-sse.test.ts tests/http-sse-backpressure.test.ts tests/http-server-websocket-config.test.ts`.