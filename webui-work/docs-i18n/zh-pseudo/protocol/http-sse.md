# OneBot HTTP 事件流


HTTP 伺服器者、同一監听器上動作与 Server-Sent Events 両方提供可能也。
WebUI 之 HTTP API 適配器中 **SSE** 有効化、或 `networks.httpServers` 之条目中
`enableSse: true` 設定也。既定 `false` 也。既存 HTTP 与 WebSocket 設定者
従来動作維持也。SSE 与 `enableWebSocket` 同時有効化可能也。

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

`GET /api/_events?access_token=<token>` 者事件流開也。動作者依然 `POST /api/<action>`
与 JSON 参數対象使用也。HTTP 請求者 `Authorization: Bearer <token>`、
`Authorization: <token>`（Stapxs QQ Lite 用）、或 `access_token` 查询参數受也。
設定之密碼与绑定地址依然適用也。空密碼者既存無認証 HTTP 動作維持也。

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

同一源代理前置之下両方公開為場合、Stapxs 之 SSE 事件地址 `api/_events`、HTTP 地址
`api` 設定也。請求路径、查询文字列、認証及 `Last-Event-ID` 標頭者不変転送也。
Haizakura 者跨源訪問許可不追加也。TLS 及追加之代理認証者代理側之責任也。

応答者 `text/event-stream`、`Cache-Control: no-cache, no-transform`、
`X-Accel-Buffering: no` 使用也。事件者 OneBot JSON 含之、無名之通常 `data:` 框架也。
接続生命周期事件与現在心跳事件者、各訂閲之初期化資料提供也。通信註釈（`: ping`）者
15 秒毎送信也、但 OneBot 事件非也。瀏覧器之再接続遅延者 3 秒也。

## 再接続与資源制限

廣播之各事件者不透明 `id` 有也。`Last-Event-ID` 伴之再接続者、其游標以後之事件、
接続初期化事件与其後之実時事件之前、順序沿之再生也。原生 EventSource 者同一対象
再接続時此標頭自動送信也。標頭無之新訂閲者現在時点開始、旧消息不受也。

各適配器者、客端未接続期間含之、記憶体中最大 256 事件、8 MiB 保持也。此者短之
再接続窓也、永続之消息歴史非也。帳号与適配器実体者各自独立之歴史有也。事件 ID 者
再起動、停止、密碼回転、報告方針変更、或 SSE 無効化之時無効也。再生与実時配信者
`messageFormat` 或 `reportSelfMessage` 迂回無也。

無効之游標者 HTTP 400 返却也。期限切、未来、或他者之游標者、再生利用不可之説明
含之 `wording` 与 HTTP 409 返却也。実時専用配信之暗黙代替無也。応用之状態与
歴史整合之後、EventSource 閉之再作成、旧游標無之訂閲也。EventSource 之錯誤回呼者
HTTP 錯誤本文公開無也、fetch 基盤之消費側者直接検査可能也。初期化事件者最新廣播
游標共有可能也、新規永続化消息事件依扱不可也。

各客端之保留出力者 8 MiB 制限也。読取速度遅之客端者、無制限事件保持或他客端
阻塞之代、警告与切断也。此制限超過之単一框架者、其客端切断也。再接続者同一再生
制限之対象也。切断、熱再読込、停止者接続与心跳計時器解放也、密碼回転者既存流
失効也。

測試: `pnpm --filter @snowluma/onebot exec vitest run tests/http-server-sse.test.ts tests/http-sse-backpressure.test.ts tests/http-server-websocket-config.test.ts`。