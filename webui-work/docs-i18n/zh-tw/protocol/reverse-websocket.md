# 反向 WebSocket 連線


`@snowluma/sdk/node` 可以接受 OneBot 反向 WebSocket 連線。Haizakura
會連**到你的 SDK 程式**並送出事件；你的程式再透過同一條連線送回動作。
一般的 `createWebSocketClient()` 仍會向 Haizakura WebSocket 伺服器建立連線。
兩個 SDK 進入點都不會成為 NoneBot／AstrBot 的 QQ 實作；
Haizakura 的 `networks.wsClients` 已經能滿足那個用途。

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

請在 `networks.wsClients` 中為對應的 Haizakura 帳號加入一筆設定：

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

若兩個行程跑在不同機器上，請使用 SDK 主機的位址。
監聽器預設只綁定回送位址。驗證可接受 Bearer 標頭或 `access_token` 查詢參數。
空白的或省略的 token 表示不檢查 token。帳號與角色標頭仍為必填。
握手拒絕事件中不會包含任何憑證或訊框內容。

## 工作階段與通道

`connection` 會提供一個 `HaizakuraReverseWebSocketSession`，內含 `selfId`（字串）、
`canCallActions`、`canReceiveEvents`，以及既有正向用戶端的輔助方法：
`onMessage`、中介軟體、`waitForMessage`、`getStatus`、訊息傳送、`request`、
`requestStream`、上傳與下載輔助方法。有號訊息 ID、回應錯誤、
逾時、取消與串流限制都維持原有的意義。

`server.getClient(selfId)` 與唯讀的 `server.clients` 快照會揭露仍在線上的工作階段。
每個帳號擁有自己的待處理請求與事件處理常式。事件必須符合 `X-Self-ID` 所宣告的帳號；
不符時會關閉該工作階段並回報錯誤。重複的作用中通道會收到 HTTP 409，且不會取代健全的工作階段。
選用的帳號允許清單會以 HTTP 403 拒絕未知帳號。

Universal 模式同時承載動作與事件。若要分成獨立通道，請設定一個 Haizakura `Api`
連線與一個 `Event` 連線，兩者使用相同帳號與伺服器位址。線上標頭也接受 `API`。
兩者共用同一個 SDK 工作階段，因此事件處理常式中的 `context.reply()` 會使用 API 通道。
`connection` 會在第一個通道到達時觸發；`channel` 則會為每個被接受的通道觸發：

```ts
server.on('channel', ({ client, role }) => {
  console.log(client.selfId, role, client.canCallActions, client.canReceiveEvents);
});
```

在分割模式下，請先等待 `canCallActions` 再送出動作。在僅有 Event 的工作階段上呼叫動作會明確失敗。
關閉任一半都會結束整個工作階段及其對應通道。重連時機由 Haizakura 掌控；
下一次連線會建立新的工作階段並再次發出 `connection`，處理常式應在那時重新註冊。
舊的工作階段物件無法自行重新連線。
待處理請求、串流迭代器與事件等待都會在斷線時失敗。動作絕不會自動重播，
因為遠端可能已經執行過它們。此傳輸方式不會保留斷線期間錯過的事件。

## 限制、錯誤與擁有權

預設值為：每則傳入訊息 100 MiB、每個通道 16 MiB 的傳出緩衝位元組、128 個同時通道、
30 秒的動作逾時，以及 30 秒的 ping 間隔。可視需要設定 `maxPayloadBytes`、`maxBufferedBytes`、
`maxConnections`、`requestTimeoutMs` 與 `heartbeatIntervalMs`。請求逾時為零表示無限期等待；
心跳間隔為零表示停用 ping。其他限制必須是正整數。所有計時器都會在關閉時清理完畢。
過大的傳入訊息會以 1009 關閉；傳出容量不足會拒絕該動作，且不會將其排入佇列。
未通過下一次 ping 檢查的對端會被終止（通常在兩個心跳間隔之內）。

請註冊伺服器的 `error` 處理常式：未處理的錯誤會依循 Node 的 EventEmitter
錯誤契約並擲出。工作階段的傳輸、解析與非同步事件處理常式失敗都會轉送到那裡。
無效的對端 JSON 與跨帳號／跨通道的訊框會關閉連線；啟動時的綁定錯誤則直接拒絕 `listen()`。

若要重複使用既有的 HTTP 或 HTTPS 伺服器，請在該伺服器開始監聽之後，
改為傳入 `server` 而非 `host`／`port`。只有設定好的升級路徑屬於此 SDK。
一般請求與其他升級路徑仍由其原有的處理常式負責。`close()` 會釋放 SDK 的連線與監聽器，
但不會關閉外部伺服器。TLS 設定仍由該 HTTPS 伺服器或你的代理負責；
不會自動降級。由 SDK 內部擁有的監聽器會由 SDK 關閉。
正在關閉的連線在終止前有一段有界的握手寬限期。

只有 Node 子路徑會匯入 `ws` 這個執行期相依套件；供瀏覽器使用的 SDK
進入點維持其既有匯入。TypeScript 的 Node 使用者應納入其慣用的 `@types/node` 開發相依套件，並在其 TypeScript 設定中啟用 `"types": ["node"]`。

驗證會使用真實的本機 WebSocket 與 Haizakura 的 `WsClientAdapter`，
搭配實際的動作與串流處理常式，並與 QQ 帳號隔離。涵蓋範圍包括 Universal
與分割通道、身分／驗證、訊息回覆、多帳號 echo、
斷線清理、限制、心跳、外部伺服器擁有權，以及已發佈的 NodeNext／bundler 套件消費者。