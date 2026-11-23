# OneBot 网络层（阶段 3.1）

本文覆盖 `ts/src/onebot/` 的九个子模块。它回答三个问题：**参考实现到底有几种传输、
每种的确切参数是什么、我们的移植如何证明与之一致。**

所有行号都是 `reference/index.mjs`（13,916,690 字节，md5
`aa573eba11688960282efa2e41e6661b`）的行号。该文件保留了 esbuild 的
`//#region ../onebot/src/<path>.ts` 标记 —— **77 个 region 覆盖整个 OneBot 层**，
它们是源码路径与打包行号之间的权威映射。本文所有坐标都由这些标记核对过，
不是推测。

---

## 一、参考实现实际有五种传输，不是四种

`NetworkKind` 的定义在 L5152–L5174：

| kind | 含义 | 默认是否启用 | 默认参数 |
| --- | --- | --- | --- |
| `httpServer` | HTTP 服务端（可选叠加 WS 与 SSE） | ✅ | `127.0.0.1:3000`，`path: "/"` |
| `httpClient` | HTTP 反向上报（POST 到外部 URL） | ❌ | — |
| `wsServer` | 正向 WebSocket 服务端 | ✅ | `127.0.0.1:3001`，`path: "/"`，`role: "Universal"` |
| `wsClient` | 反向 WebSocket（连出去） | ❌ | — |
| `satoriServer` | Satori 协议 | ❌ | — |

**默认配置的原文**（L5146–L5178，`makeDefaultOneBotConfig`）：

```js
httpServers: [{
  name: "http-default", host: "127.0.0.1", port: 3e3, path: "/",
  enableWebSocket: false, enableSse: false,
  accessToken: generateAccessToken(),
  messageFormat: "array", reportSelfMessage: false
}],
wsServers: [{
  name: "ws-default", host: "127.0.0.1", port: 3001, path: "/",
  role: "Universal",
  accessToken: generateAccessToken(),
  messageFormat: "array", reportSelfMessage: false
}],
httpClients: [], wsClients: []
```

三个容易做错的点，都是从这里读出来的：

1. **`accessToken` 不是一个固定字符串，是每次生成默认配置时随机产生**
   （`randomBytes(DEFAULT_ACCESS_TOKEN_BYTES).toString("base64url")`，L5180）。
   移植时若写死一个常量，用户拿到的 token 与文档不符。
2. **`httpServer` 默认 `enableWebSocket: false`、`enableSse: false`** ——
   3000 端口默认只讲 HTTP，WS 是同一端口上的可选叠加，不是另一个端口。
3. **`path` 默认是 `"/"`，不是 `/api` 或 `/event`。**
   我们在旧版实机抓包时看到的 `/api` 与 `/event` 是**客户端自己拼的**，
   不是服务端要求的前缀。把这两个当成固定路径会让 `path: "/"` 的默认配置连不上。

### region 到行号的完整映射（传输相关全部 11 个）

| region | 行号范围 | 行数 | 对应我们的文件 |
| --- | --- | --- | --- |
| `network/adapter.ts` | L339485–L339601 | 117 | `adapter.ts` |
| `network/http-post-adapter.ts` | L339602–L339732 | 131 | `http.ts`（POST 客户端） |
| `network/utils.ts` | L340867–L340986 | 120 | `wire.ts` |
| `network/ws-server-connections.ts` | L340987–L341188 | 202 | `ws.ts` |
| `network/http-trace.ts` | L341189–L341197 | 9 | `wire.ts` |
| `network/http-sse-connections.ts` | L341198–L341369 | 172 | `sse.ts` |
| `network/http-server-adapter.ts` | L341370–L341876 | 507 | `http.ts` |
| `network/network-manager.ts` | L341877–L342213 | 337 | `manager.ts` |
| `network/ws-client-adapter.ts` | L342214–L342416 | 203 | `websocket.ts` |
| `network/ws-server-adapter.ts` | L342417–L342592 | 176 | `wire.ts` + `ws.ts` |
| `config.ts`（默认配置） | L5124–L5931 | 808 | `types.ts` |
| `api-handler.ts` | L21445–L21673 | 229 | `adapter.ts` |

---

## 二、认证：`Authorization` 头与 HMAC 是两条不同通道

`network/utils.ts`（L340867–L340986）里的 `isAuthorized` 处理的是**入站**认证：
`Authorization: Bearer <token>`。token 为空表示不校验 —— 这是参考实现的行为，
默认配置总会生成一个非空 token，所以"空即放行"只在用户显式清空时出现。

`network/http-post-adapter.ts`（L339602–L339732）里的 HMAC 处理的是**出站**签名：

```js
const headers = {
  "Content-Type": "application/json",
  "User-Agent": "OneBot",
  "X-Self-ID": this.ctx.uin
};
if (config.accessToken) headers["X-Signature"] =
  await computeHmacSha1(config.accessToken, payload);
```

**两处细节很容易漏：**

- `X-Self-ID` 是**数字 uin**，不是字符串化的账号。
- `X-Signature` 只在 `accessToken` 非空时存在，且用的是 **`payload` 的原始字节**
  （不是 `JSON.stringify` 之后的副本，因为 `payload` 就是字符串化的结果，
  但对象键顺序必须与发送体完全一致，否则对端验签失败）。

`DEFAULT_TIMEOUT_MS = 5e3`（L339606）—— 出站 POST 默认 5 秒超时。

---

## 三、五种传输的生命周期契约

`network/adapter.ts`（L339485–L339601）定义基类。**`reload()` 的返回值 0/1/2/3
是真实契约**，虽然管理器不读它，但参考实现文档化了它，所以移植时保留：

| 返回 | 含义 |
| --- | --- |
| 0 | 无变化 |
| 1 | 已应用 |
| 2 | 需要重启 |
| 3 | 失败 |

每个适配器的 `open()` 都有一个**静默短路**，这是移植时最容易漏的行为：

```js
open() {
  if (this.config.enabled === false) return;   // 未启用：不报错，直接返回
  if (!this.config.url) return;                // 无 URL：同上
  this.isEnabled = true;
}
```

**"没配置"不是错误。** 我们的 `http.ts` / `ws.ts` 保持了这个语义 ——
返回 `status: "disabled"` 而不是抛异常。

---

## 四、SSE 确实是独立实现的

子代理最初怀疑参考实现可能只是"声明了 Satori 但没实现"。核对结果是
**它真的实现了**：`network/http-sse-connections.ts` 有 172 行（L341198–L341369），
且 `httpServer` 的默认配置里有 `enableSse` 开关（L5150）。

所以 `sse.ts`（255 行）不是凭空发明，是对应 region 的移植。
但要注意：**SSE 与 Satori 不是同义词。** SSE 是 `httpServer` 上的一种传输选项，
Satori 是一个独立的 `satoriServer` kind（L343240 附近）。我们的 `sse.ts` 只实现前者。

---

## 五、验证方式

### 差分测试是做了的，而且是这样做的

关键洞察：**不需要起真正的服务器。** 参考实现的网络层被 esbuild 打包成一个个
`#region`，加上 `work/onebot-net/ref/shims.mjs` 提供的 shim，可以把
`network-ref.mjs` 作为普通模块直接 import 进进程 —— 于是"参考实现"和"我们的移植"
可以在同一个 Node 进程里接收同一份请求，逐字节比对响应，**完全不碰 3000/3001 端口**。
这绕开了生产容器占用端口的整个问题。

装置在 `work/onebot-net/`：

| 路径 | 作用 |
| --- | --- |
| `ref/network-ref.mjs` + `ref/shims.mjs` | 把 `#region` 里的网络层装配成可 import 的模块 |
| `probe/harness-http.mjs` | 对参考实现发 47 个请求，录制状态码/头/体 |
| `probe/harness-ws.mjs`、`harness-ws2.mjs` | WS 帧收发录制 |
| `probe/harness-handshake.mjs` | 握手路径录制（含错误路径） |
| `probe/native-frames*.mjs` + `.txt` | 原生 `websocket-linux-x64.node` 的帧序对比 |
| `probe/diff-frames.mjs` | 帧级 diff |
| `probe/api-contract.mjs` | 228 action 的契约表提取 |
| `fixtures/*.json` | 录制产物，被 `ts/test/onebot-*.test.ts` 直接读取比对 |

**录制规模**：`ref-http.json` 47 个用例、`ref-ws.json` / `ref-ws2.json` /
`ref-ws-handshake.json` 各一组，`contracts.json` 9 项。

测试不是"跑通就算"，而是**读录制文件、找到同名 case、逐字段比对**：
`onebot-http.test.ts:118` 与 `onebot-handshake.test.ts:138` 都是
`cases.find(c => c.name === name)` 之后比对，不是宽松断言。

### 结果

- **`npm test`：319 pass / 0 fail / 243 tests**（2 skipped 是会挂起的 `rtti.test.js`）
- 编译：`cd ts && npm run build` 通过

### 仍待补充的

- **`satoriServer`（独立于 SSE 的传输 kind）未移植。** 这是真正的空白。
- **`httpClient`（反向上报）只有签名逻辑的测试**，没有对真实 URL 的 POST 录制。
- **`diff-frames.mjs` 的帧级对比结论未写进测试断言** —— 它有 `.txt` 输出，
  但没有像 `ref-http.json` 那样成为回归测试的一部分。原生 `websocket-linux-x64.node`
  的帧序是被观测过、记录过的，但没有在 CI 里固化。

两项（SSE 与握手）已有 fixture 并逐字段比对，见上表 47 个用例；
上面这三项不是。

---

## 六、给下一轮的提醒

1. **`path` 默认 `"/"`**，不要假设 `/api` 或 `/event`。
2. **`accessToken` 每次随机生成**，不要写死。
3. **`httpServer` 默认不开 WS/SSE**，它们是同端口叠加。
4. **`X-Self-ID` 是数字**，`X-Signature` 是 HMAC-SHA1 且只覆盖 payload 字节。
5. **`open()` 遇到未启用或无 URL 时静默返回**，不是错误。
6. **差分测试还欠着**，这是本模块最大的证据缺口。