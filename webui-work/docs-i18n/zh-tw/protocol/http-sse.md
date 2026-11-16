# OneBot HTTP 事件串流


HTTP 伺服器可以在同一個監聽器上同時提供動作與 Server-Sent Events。請在 WebUI 的 HTTP API 配接器中啟用 **SSE**，或在 `networks.httpServers` 中的項目上設定 `enableSse: true`。預設值為 `false`；既有的 HTTP 與 WebSocket 設定維持其行為。SSE 與 `enableWebSocket` 可以同時啟用。

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

`GET /api/_events?access_token=<token>` 會開啟事件串流。動作仍然使用 `POST /api/<action>`，並搭配 JSON 參數物件。HTTP 請求接受 `Authorization: Bearer <token>`、`Authorization: <token>`（供 Stapxs QQ Lite 使用），或 `access_token` 查詢參數。已設定的權杖與綁定位址仍然適用。空權杖會保留既有的未驗證 HTTP 行為。

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

當 Stapxs 的 SSE 事件位址與 HTTP 位址都透過同一個同源代理前綴對外提供時，請把前者設定為 `api/_events`，後者設定為 `api`。請原樣轉送請求路徑、查詢字串、授權標頭與 `Last-Event-ID` 標頭。Haizakura 不會新增跨來源存取授權。TLS 以及任何額外的代理驗證仍由代理負責。

回應使用 `text/event-stream`、`Cache-Control: no-cache, no-transform` 與 `X-Accel-Buffering: no`。事件是一般的未具名 `data:` 框架，內含 OneBot JSON。連線生命週期與目前的心跳事件會為每個訂閱進行初始引導。傳輸註解（`: ping`）每 15 秒送出一次；它們不是 OneBot 事件。瀏覽器的重新連線延遲為 3 秒。

## 重新連線與資源限制

每個廣播事件都有不透明的 `id`。帶有 `Last-Event-ID` 的重新連線會依序重播該游標之後的事件，且先於連線引導事件與後續的即時事件。原生 EventSource 在重新連線同一個物件時會自動送出此標頭。沒有此標頭的新訂閱會從目前開始，不會收到舊訊息。

每個配接器在記憶體中最多保留 256 個事件與 8 MiB，包括沒有用戶端連線時。這是短暫的重新連線視窗，不是持久訊息歷史。帳號與配接器執行個體擁有各自獨立的歷史。事件 ID 會在重新啟動、關閉、權杖輪替、回報原則變更或停用 SSE 時失效。重播與即時遞送都不會繞過 `messageFormat` 或 `reportSelfMessage`。

無效的游標會回傳 HTTP 400。已過期、未來或外來的游標會回傳 HTTP 409，並附上 `wording` 說明無法重播。不會默默退回僅即時遞送。在調和應用程式的狀態/歷史之後，請關閉並重新建立 EventSource，以不帶舊游標的方式訂閱。EventSource 的錯誤回呼不會揭露 HTTP 錯誤主體；以 fetch 為基礎的取用者可以直接檢查它。引導事件可能共用最新的廣播游標，不得被視為新持久化的訊息事件。

每個用戶端的待送出輸出上限為 8 MiB。慢速讀取者會被中斷連線並附上警告，而不是保留無界的事件或封鎖其他用戶端。單一框架超過此限制也會中斷該用戶端。重新連線受相同的重播限制約束。中斷連線、熱重新載入與關閉都會釋放連線與心跳計時器；輪替權杖會撤銷既有的串流。

測試：`pnpm --filter @snowluma/onebot exec vitest run tests/http-server-sse.test.ts tests/http-sse-backpressure.test.ts tests/http-server-websocket-config.test.ts`。