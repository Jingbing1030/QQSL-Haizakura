# Satori 协议接入指南

> 本文描述 Haizakura（原 SnowLuma）对 **Satori 协议**（`satori.chat`）的实现：
> 如何用 **path 哨兵**启用服务器、24 个 API、事件与资源映射、消息元素收发，
> 以及与 LLBot 的差异。
>
> **数据来源**：`packages/onebot/src/network/satori-server-adapter.ts`（1445 行，传输层 + API 表）、
> `packages/onebot/src/network/satori-mount.ts`（95 行，挂载层）、
> `packages/onebot/src/config.ts`（`wsServers` 解析与校验）、
> `scripts/tests/driver-protocol.mjs`（76 断言）、`scripts/tests/driver-integration.mjs`（22 断言）。
>
> **测试状态**：`node scripts/tests/run-satori-tests.mjs` → **76/76 通过**；
> `node scripts/tests/run-satori-integration.mjs` → **22/22 通过**（合计 **98/98**，2026-11-13 实跑）。

---

## 1. 简介

### 1.1 Satori 是什么

Satori 是一套**跨平台聊天机器人协议**（<https://satori.chat>），由 Koishi 生态维护。
它把不同聊天平台（QQ、Discord、Telegram…）抽象成统一的一组**资源**
（`User` / `Channel` / `Guild` / `GuildMember` / `Message` / `Reaction`…），
应用层只面向这套资源编程：

| 通信方式 | 用途 | 本文对应章节 |
| --- | --- | --- |
| **HTTP API** | 主动调用（发消息、查群、踢人…） | §3 / §4 |
| **WebSocket** | 被动接收事件流 | §3 / §6 |
| WebHook | 另一种事件接收方式 | ❌ 本实现**未提供** |

### 1.2 为什么 Haizakura 支持它

**因为 Satori 有现成的 SDK 生态，接进来就能直接用。** 支持 Satori 之后：

- **Koishi** 可通过 Satori 适配器直接连上 Haizakura，无需再写 OneBot 桥接；
- **`@satorijs/satori`** 等官方 SDK 可直接对接，不必手写 HTTP/WS 协议栈；
- 应用层代码可以**跨平台复用** —— 同一份逻辑既能跑在 QQ（Haizakura），也能跑在别的 Satori 实现上。

### 1.3 与 OneBot v11 的关系

**两者并存，不互相替代，可同时启用。**

| 维度 | OneBot v11 | Satori |
| --- | --- | --- |
| 定位 | QQ 生态事实标准 | 跨平台抽象 |
| 配置位置 | `networks.*`（4 类适配器） | **复用 `networks.wsServers[]`**（见 §2） |
| 端口 | 各自独立 | 各自独立，**可与 OneBot 同时监听不同端口** |
| 事件/动作模型 | `post_type` + 222 个动作 | 12 类事件 + 24 个方法 |

同一个账号可以同时开一个 OneBot WS 服务器和一个 Satori 服务器，`emitEventNow()`
会把每个事件**同时扇出**给两边（源码 `network-manager.ts`，集成测试
`manager-fed EVENT has channel+user promoted` 已断言）。

> OneBot v11 的完整说明见 [`onebot11.md`](onebot11.md)、[`events.md`](events.md)、[`actions.md`](actions.md)。

---

## 2. ⚠️ 如何启用（sentinel 机制）

> **本节是全文最重要的部分。** Haizakura 的 Satori 服务器**没有独立配置项**，
> 而是**复用 OneBot 的 `wsServers[]` 列表**，靠 `path` 字段识别。

### 2.1 识别规则

```
wsServers[] 中 path === "/v1/events" 的条目  =  Satori 服务器
```

判定逻辑（源码 `satori-mount.ts` 的 `satoriMountIsSatoriServer`）：

1. 取 `path` 字段（非字符串时按 `"/"` 处理）；
2. 去掉查询串（`?` 之后）与**尾部斜杠**；
3. 与 `"/v1/events"` **精确相等**才算 Satori。

因此以下三种写法都识别为 Satori：

| 配置的 `path` | 识别为 |
| --- | --- |
| `/v1/events` | ✅ Satori |
| `/v1/events/` | ✅ Satori（容忍尾部斜杠） |
| `/v1/events?x=1` | ✅ Satori（容忍查询串） |
| `/v1/eventsfoo` | ❌ 普通 OneBot WS |
| `/satori/v1/events` | ❌ **不匹配**（只认精确值，不是前缀匹配） |
| `/` | ❌ 普通 OneBot WS |

> 挂载方式是 patch `OneBotInstance.prototype.createNetworkAdapter`
> （源码 `satori-mount.ts`）：先判断是不是 `kind === "wsServer"` 且 `path` 命中哨兵，
> 命中就返回 `SatoriServerAdapter`，否则**原样交回**原生实现。
> 集成测试已断言普通 `/` 条目仍然得到 `WsServerAdapter`（`normal path -> WsServerAdapter (unchanged)`）。

### 2.2 完整配置示例（可直接复制）

`POST /api/config/:uin` 会**严格校验整个配置对象**（`assertValidOneBotConfig`），
所以下面给出**完整可提交**的形状（`statusCommand`、`historySync` 缺一不可）：

```json
{
  "networks": {
    "wsServers": [
      {
        "name": "satori-main",
        "host": "0.0.0.0",
        "port": 5600,
        "path": "/v1/events",
        "accessToken": "<your-token>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpServers": [],
    "httpClients": [],
    "wsClients": []
  },
  "statusCommand": { "enabled": false, "swallow": false, "cooldownSeconds": 5, "trigger": "#Haizakura" },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

字段说明（沿用 `wsServers` 语义）：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 建议 | 适配器唯一名，**全局不可与其它 kind 重名** |
| `host` | — | 默认 `0.0.0.0`；要跨机访问需显式写 `0.0.0.0` |
| `port` | **✔** | 1–65535，**> 0** 且不可与其它监听条目冲突 |
| `path` | **✔** | 必须**精确等于** `/v1/events`，这是哨兵 |
| `accessToken` | 建议 | 留空 = **不鉴权**（见 §3.3 安全提示） |
| `messageFormat` | — | ⚠️ **对 Satori 无效**（见 §9） |
| `reportSelfMessage` | — | ⚠️ **对 Satori 无效**（见 §9） |
| `role` | 可选 | 默认 `Universal`，**对 Satori 无意义、被忽略** |
| `maxPayloadBytes` | 可选 | 入站 WS 帧上限（`wsServers` 通用字段） |
| `enabled` | 可选 | 置 `false` 则工厂仍返回 Satori 适配器，但 `open()` 直接返回、**不监听** |

**只有 `wsServers` 一条也能通过文件校验**：若通过 `config/onebot_<uin>.json`
文件配置，`fromJson` 会补齐 `statusCommand` / `historySync` / 其余三个网络数组的默认值，
所以配置文件里可以只写 `networks.wsServers`。**WebUI 的 POST 接口不接受省略**，请用上面的完整形状。

> `wsServers` 条目**不允许未知字段**（恢复/校验路径会 `rejectUnknownKeys`），
> 所以不能把 Satori 专属字段塞进去 —— 这也正是本实现**自包含**的原因。

### 2.3 为什么用这种「哨兵」方式？（设计取舍）

Haizakura 的配置模块 `config.ts` 里，
`fromJson` 与 `toJsonObject` **硬编码了 4 个 kind**（`httpServers` / `httpClients` /
`wsServers` / `wsClients`），`RESTORE_NETWORK_KEYS` 也是固定集合。

想新增第 5 个 kind（如 `satoriServers`）必须改 `config.ts` 本体：

- `config.ts:222` 会遍历 `RESTORE_NETWORK_KEYS` 并读 `parsed.networks[key].length` ——
  `fromJson` 的输出里没有新 kind，于是 `undefined.length` 直接 **TypeError**，
  整个配置保存/恢复链路不可用；
- `validateRestoreAdapterArray` 对未知 kind 会要求 `url` 字段，形状对不上。

而 `config.ts` 是**现有 region**，改动需要**重编号 432 个 region**（源码 `satori-mount.ts`
顶部注释明确记录了这一结论：*「新增 kind 必须改 config.ts 本体，而那是现有 region
（改它要重编号 432 个 region）」*）。

**v2 方案（当前实现）**：复用现有 `wsServers[]`，只 patch **1 个原型方法**。收益：

- 配置管线 **100% 复用** —— 解析、校验、序列化、热重载、**端口冲突检测**全部继续生效；
- 不碰 `config.ts`，零 region 重编号风险；
- 集成测试已断言 `RESTORE_NETWORK_KEYS not polluted`（未被污染）、
  `compileDesiredPlan NOT patched (v2 minimal)`（只改了 1 个方法）。

**代价（必须知情）**：

- WebUI 的网络状态列表里，这条会显示在**「WS 服务器」分组**下；
  不过**状态标签（`kind`）仍然是 `satoriServer`**，`detail` 会显示
  `Satori v1 · N 个事件客户端`**（源码 `describeStatus()`，集成测试
  `Satori adapter describeStatus().kind` 已断言）；
- 反过来，**`/v1/events` 这个 path 不能再分配给 OneBot WS 使用** ——
  谁写 `path: "/v1/events"`，谁就变成 Satori 服务器（见 §2.5）。

### 2.4 热更新（不用重启，不丢登录态）

配置可通过 WebUI 的 `POST /api/config/:uin` **热更新**：

```bash
curl -X POST http://127.0.0.1:3080/api/config/10001 \
  -H 'Content-Type: application/json' \
  -d @satori-config.json
```

成功响应形如：

```json
{ "success": true, "saved": true, "applied": true, "online": true,
  "reloaded": true, "message": "配置保存成功，已热重载当前会话。", "errors": [], "adapters": [] }
```

- **不需要重启进程，也不会丢失登录态**（走 `oneBotManager.reloadConfig`）；
- 会话不在线时保存仍成功，但 `online: false`，**下次连接才生效**；
- 令牌轮换会**主动断开已连接的事件客户端**：`closeConnections(1008, "access token changed")`
  （源码 `onConfigReplaced`）—— 客户端需重新 IDENTIFY。

> ⚠️ **远程保存的令牌策略**：`wsServers` 属于入站节点（`INBOUND_KINDS`），
> 通过非回环地址保存时，**`accessToken` 不能为空，且至少 16 个字符**，
> 还不能是易猜值（源码 `onebot-token-policy.ts`）。绑回 `127.0.0.1` 或从本机保存才允许留空。

### 2.5 与 OneBot 同时启用的写法

```json
{
  "networks": {
    "wsServers": [
      { "name": "satori-main", "host": "0.0.0.0", "port": 5600, "path": "/v1/events",
        "accessToken": "<satori-token>", "messageFormat": "array", "reportSelfMessage": false },
      { "name": "ob-ws", "host": "0.0.0.0", "port": 3001, "path": "/",
        "role": "Universal", "accessToken": "<onebot-token>",
        "messageFormat": "array", "reportSelfMessage": false }
    ],
    "httpServers": [], "httpClients": [], "wsClients": []
  },
  "statusCommand": { "enabled": false, "swallow": false, "cooldownSeconds": 5, "trigger": "#Haizakura" },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

- 两条必须**端口不同**，否则校验直接拒绝（`networks.wsServers[1] conflicts with networks.wsServers[0] on server binding ...`）；
- `name` 在**所有 kind 之间**唯一，重名报 `network adapter name "..." is duplicated in ... and ...`；
- Satori 可以开**多条**（不同端口），互不影响。

---

## 3. 接入方式

### 3.1 HTTP API

```
POST http://<host>:<port>/v1/{resource}.{method}
Content-Type: application/json
```

- 请求体是 **JSON 对象**（数组或标量会被拒：`请求体必须是 JSON 对象`）；
- 方法名就是**路径剩余部分**，例如 `POST /v1/login.get`、`POST /v1/message.create`；
- ⚠️ **不会再拼一层 `/v1`**。因为哨兵 `path` 本身就是 `/v1/events`，
  源码 `mountPrefix()` 对 `/` 和 `/v1/events` 都返回空串，
  所以端点是 `/v1/<method>`，**不是** `/v1/events/v1/<method>`
  （源码注释：*"must NOT append another `/v1`"*；测试断言
  `route: POST /v1/login.get (no double /v1)`）。

### 3.2 WebSocket 事件流

```
GET ws://<host>:<port>/v1/events      （HTTP Upgrade）
```

- 路径必须**精确等于** `/v1/events`，否则升级被拒：`abortUpgrade(socket, 404, "Not Found")`；
- 用**普通 GET**（没做 upgrade）访问该路径 → `405` + `Allow: GET` + `please connect with WebSocket`。

### 3.3 必需请求头

| 头 | 值 | 必需性 |
| --- | --- | --- |
| `Satori-Platform` | **`haizakura`** | ⚠️ 见下 |
| `Satori-User-ID` | 账号 uin | 可选（**若提供则必须匹配**） |
| `Authorization` | `Bearer <accessToken>` | 配置了 token 时必需 |

**`Satori-Platform` 的正确值是 `haizakura`，不是 `qq`！**

```bash
curl -X POST http://127.0.0.1:5600/v1/login.get \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' \
  -H 'Satori-User-ID: 10001' \
  -d '{}'
```

实测行为（源码 `handleRequest` + 我实跑验证）：

| 情况 | 结果 |
| --- | --- |
| `Satori-Platform: haizakura` | `200` ✅ |
| **`Satori-Platform: qq`** | **`403`** `{"message":"login not found"}` |
| **完全不传** `Satori-Platform` | `200`（**缺失被容忍**） |
| `Satori-User-ID` 与当前账号不符 | `403` `{"message":"login not found"}` |
| 完全不传 `Satori-User-ID` | `200`（**缺失被容忍**） |

> 即：两个头**只在「提供了但值不对」时拒绝**。SDK 默认都会带上
> `Satori-Platform`，所以只要平台标识填对（`haizakura`）就没问题；
> 若你手写客户端，**漏传也能通**，但**传 `qq` 一定 403**。

### 3.4 状态码表

| 码 | 触发条件 | 响应体 |
| --- | --- | --- |
| `200` | 成功 | 方法返回值（各方法不同，见 §4） |
| `400` | 参数缺失/非法、JSON 语法错误、请求体非对象、下游动作失败 | `{"message":"..."}` |
| `401` | 配置了 token 但**未带** `Authorization` | `{"message":"authorization required"}` |
| `403` | token 不匹配 / `Satori-Platform` 或 `Satori-User-ID` 不符 | `{"message":"invalid token"}` 或 `"login not found"` |
| **`404`** | **方法不在 24 个白名单内**、路径不在 `/v1/` 前缀下 | `{"message":"method not found"}` / `"not found"` |
| `405` | 对方法路径用了非 POST；对 `/v1/events` 用了普通 GET | 带 `Allow` 头 |
| `413` | 请求体超过 **64 MiB**（`readRequestBody` 默认上限） | `{"message":"request body too large"}` |
| `503` | 服务正在关闭（`acceptingActions === false`） | `{"message":"server closing"}` |

> **重点：不支持的 API 返回 `404`，不是 `501`。** 这符合 Satori 规范
>（*「平台不支持的 API 应返回 404；只有平台支持但适配器未实现才返回 501」*）。
> 源码注释亦明确：*"an unsupported API must answer 404, never 501"*。
>
> **注意**：Satori 的错误体是**扁平的 `{message}`**，与 OneBot 的
> `{status, retcode, data, wording}` **完全不同**。别把两套错误处理混用。

### 3.5 鉴权顺序（易踩坑）

HTTP 请求按以下顺序处理，**鉴权不是第一步**：

1. `acceptingActions` 为假 → `503`；
2. 路径是 `/v1`（或 `/v1/`）→ `404 method not found`；
3. 路径不以 `/v1/` 开头 → `404 not found`；
4. 方法名是 `events` → `405`（提示用 WebSocket）；
5. 方法不是 `POST` → `405`；
6. **然后才校验 `Authorization`**：无 → `401`，不匹配 → `403`；
7. 校验 `Satori-User-ID`、`Satori-Platform` → 不符 `403`；
8. 方法不在 `SATORI_API` 白名单 → `404`。

> 因此：**未鉴权的请求，`404`/`405` 会先于 `401` 返回**。
> 另外，`accessToken` 留空时**整个鉴权步骤被跳过** —— 连传错的 token 也会放行。

---

## 4. API 清单（24 个）

源码 `SATORI_API` 表**恰好 24 条**，与 `SATORI_FEATURES` 声明的 26 个特性一致
（26 = 24 个方法 + `message.list.from` + `guild.plain`，后两个是**能力标记**而非方法）。

**约定**：

- 所有方法都是 `POST`，参数放在 JSON 请求体；
- ID 类参数在线上都是**字符串**（`user_id`/`group_id` 传数字也能被 `toInt` 容错）；
- 失败时抛错 → HTTP `400` + `{"message":"..."}`。

### 4.1 登录

#### `login.get`

| 项 | 值 |
| --- | --- |
| 参数 | 无 |
| 转发到 | `get_login_info` |
| 返回 | `Login`：`{sn, adapter, platform, user, status, features}` |

```json
{
  "sn": 1,
  "adapter": "haizakura",
  "platform": "haizakura",
  "user": { "id": "10001", "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=640",
            "is_bot": false, "name": "HaizakuraBot", "nick": "HaizakuraBot" },
  "status": 1,
  "features": ["login.get", "message.create", "... 共 26 项"]
}
```

> `status`：`1` = ONLINE，`0` = OFFLINE。
> `get_login_info` 失败时**不报错**，会用 `ctx.uin` 兜底返回一个 Login。

### 4.2 消息

| 方法 | 转发到 | 参数 | 返回 |
| --- | --- | --- | --- |
| `message.create` | `send_msg` | `channel_id` **✔**, `content` **✔** | `Message[]`（长度 1） |
| `message.get` | `get_msg` | `message_id` **✔**（`channel_id` 未使用） | `Message` |
| `message.delete` | `delete_msg` | `message_id` **✔** | `null` |
| `message.list` | `get_group_msg_history` / `get_friend_msg_history` | `channel_id` **✔**, `limit`, `next`/`message_id`, `order` | `BidiList`：`{data, next?}` |

**`message.create`** —— Satori `content`（元素串）→ OneBot 消息段：

- `channel_id` 为纯数字 → 群聊，走 `{message_type:"group", group_id}`；
- `channel_id` 为 `private:<uin>` → 私聊，走 `{message_type:"private", user_id}`；
- `content` 解析后**没有可发送元素** → `400 content must contain at least one sendable element`；
- 返回的 `Message.created_at` 用 `Date.now()`（**毫秒**），`id` 为 `send_msg` 返回的
  `message_id` 的**字符串**形式；
- 若本地 `get_msg` 查不到刚落库的自发消息，**回退为回显提交的 content**，而不是让已成功的发送报错。

```bash
curl -X POST http://127.0.0.1:5600/v1/message.create \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001' \
  -d '{"channel_id":"20001","content":"你好 <at id=\"30003\"/> <emoji id=\"1\"/> <img src=\"https://x/y.png\"/>"}'
```

**`message.list`** 的分页语义（⚠️ **近似实现**，见 §9）：

- `limit` 缺省/≤0/>100 时**回退为 50**；
- `next`（或 `message_id`）作为锚点传给 OneBot 的 `message_id`；
- `order: "asc"` → `reverse_order: false`；缺省或 `"desc"` → `reverse_order: true`；
- **仅当返回行数 ≥ limit** 时才给 `next`，值是**本页最后一条的 `id`** ——
  这是「用消息 ID 当游标」的近似，不是协议要求的真游标；
- `prev` 与 `direction`（`before`/`after`/`around`）**均不支持**。

### 4.3 频道（Channel）

| 方法 | 转发到 | 参数 | 返回 |
| --- | --- | --- | --- |
| `channel.get` | 群聊 → `get_group_info`；私聊 → `get_stranger_info` | `channel_id` **✔** | `Channel` |
| `channel.list` | `get_group_info` | `guild_id` **✔** | `{data:[Channel]}`（恒 1 条） |

- 群聊 `channel_id` = 群号字符串，返回 `type: 0`（TEXT）+ `name` = 群名；
- 私聊 `channel_id` = `private:<uin>`，返回 `type: 1`（DIRECT），
  `name` 取陌生人昵称（失败则不带 `name`）；
- `channel.list` 因为 **QQ 一群一频道**（`guild.plain`），只返回该群自身这一个频道。

### 4.4 群组（Guild）

| 方法 | 转发到 | 参数 | 返回 |
| --- | --- | --- | --- |
| `guild.get` | `get_group_info` | `guild_id` **✔** | `Guild` |
| `guild.list` | `get_group_list` | 无 | `{data:[Guild]}` |
| `guild.approve` | `set_group_add_request`（`sub_type:"invite"`） | `message_id` **✔**（=flag）, `approve`, `comment` | `null` |

`Guild` 形状：`{id, name, avatar}`，其中 `avatar` 是
`https://p.qlogo.cn/gh/{group_id}/{group_id}/640`。

> `guild.approve` 的 `message_id` 实际是**请求 flag** —— 取自
> `guild-request` 事件的 `message.id`。`approve` **缺省为 true**
> （`source.approve !== false`）。

### 4.5 群成员（GuildMember）

| 方法 | 转发到 | 参数 | 备注 |
| --- | --- | --- | --- |
| `guild.member.get` | `get_group_member_info` | `guild_id` **✔**, `user_id` **✔** | 返回单个 `GuildMember` |
| `guild.member.list` | `get_group_member_list` | `guild_id` **✔** | `{data:[GuildMember]}` |
| `guild.member.kick` | `set_group_kick` | `guild_id`, `user_id`, `permanent` | `permanent:true` → `reject_add_request:true` |
| `guild.member.mute` | `set_group_ban` | `guild_id`, `user_id`, `duration`（**毫秒**） | 换算见下 |
| `guild.member.role.set` | `set_group_admin` | `guild_id`, `user_id`, `role_id` | 只能表达「管理员/非管理员」 |
| `guild.member.approve` | `set_group_add_request`（`sub_type:"add"`） | `message_id`（=flag）, `approve`, `comment` | 入群申请 |

**`GuildMember` 形状**：

```json
{
  "user": { "id": "30003", "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=640",
            "is_bot": false, "name": "群名片", "nick": "群名片" },
  "nick": "群名片",
  "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=640",
  "joined_at": 1600000000000,
  "roles": [ { "id": "3", "name": "admin" } ]
}
```

要点：

- `user.name` / `user.nick` 取 `card || nickname`（**群名片优先**）；
- **`joined_at` 是毫秒**：`join_time`（秒）× 1000；`join_time` ≤ 0 时**该字段不出现**；
- `roles` **恒为长度 1 的数组**（QQ 只有单角色阶梯）；
- `member.avatar` 与 `user.avatar` 相同（QQ 无独立群头像）。

**`guild.member.mute` 的单位换算**（重要）：

```
Satori duration 是毫秒；OneBot set_group_ban 收秒。
seconds = duration <= 0 ? 0 : max(1, ceil(duration / 1000))
```

即 `duration: 60000` → `duration: 60`（测试已断言 `ms->s (60000->60)`）；
`duration: 0` → 解禁。

**`guild.member.role.set` 的表达力限制**：

```
role_id ∈ {"3","admin"} → set_group_admin { enable: true }
role_id ∈ {"4","owner"} 或其它 → set_group_admin { enable: false }   ← 降级为普通成员
```

> 即 **QQ 的「转让群主」无法通过本方法表达**：传 `role_id: "4"` 会被当作**取消管理员**。
> 设 `role_id: "3"` 是唯一有意义的调用（测试断言 `role.set -> enable:true`）。

### 4.6 群组角色（GuildRole）

#### `guild.role.list`

| 项 | 值 |
| --- | --- |
| 参数 | `guild_id` **✔**（仅校验 > 0） |
| 返回 | **静态** 3 条，**不访问网络** |

```json
{ "data": [
  { "id": "4", "name": "owner",  "position": 3 },
  { "id": "3", "name": "admin",  "position": 2 },
  { "id": "2", "name": "member", "position": 1 }
] }
```

> 测试断言 `guild.role.list -> 3 static roles`。

### 4.7 表态（Reaction）

| 方法 | 转发到 | 参数 | 返回 |
| --- | --- | --- | --- |
| `reaction.create` | `set_msg_emoji_like`（`set:true`） | `message_id` **✔**, `emoji_id` **✔** | `null` |
| `reaction.delete` | `set_msg_emoji_like`（`set:false`） | `message_id` **✔**, `emoji_id` **✔** | `null` |
| `reaction.list` | `get_emoji_likes` | `message_id` **✔**, `emoji_id` **✔** | `{data:[User]}` |

- `emoji_id` 是**表情 ID 字符串**（如 `"128077"` 表示 👍），非空校验；
- `reaction.list` 返回的是**点了该表情的用户列表**（`User[]`），
  每个 `User` 的 `id` 来自 `emoji_like_list[].user_id`；
- 三者都**要求 `emoji_id`**，即使 `channel_id` 未提供也能工作
  （`satoriMethodParams` 对这三个方法只用于解析，不强制 channel）。

### 4.8 用户与好友

| 方法 | 转发到 | 参数 | 返回 |
| --- | --- | --- | --- |
| `user.get` | `get_stranger_info` | `user_id` **✔** | `User` |
| `friend.list` | `get_friend_list` | 无 | `{data:[{user, nick}]}` |
| `friend.delete` | `delete_friend` | `user_id` **✔** | `null` |
| `friend.approve` | `set_friend_add_request` | `message_id` **✔**（=flag）, `approve` | `null` |

- `friend.list` 每项是 `{user: User, nick: 备注}`；`user.name` 取 `nickname ?? remark`，
  `nick` 取 `remark`；
- `friend.approve` 的 `message_id` 是**加好友请求的 flag**
  （来自 `friend-request` 事件的 `message.id`），`approve` 缺省 true。

---

## 5. 事件清单

### 5.1 支持的 12 种事件类型

源码 `satoriConvertOneBotEvent` 及其分支共产出 **12 种** Satori 事件类型：

| Satori 事件 | 触发（OneBot） | 协议套件已断言 |
| --- | --- | --- |
| `message-created` | `message` / `message_sent` | ✅ |
| `message-deleted` | `notice: group_recall` / `friend_recall` | ✅ |
| `guild-member-added` | `notice: group_increase` | ✅ |
| `guild-member-updated` | `notice: group_card` / `group_admin` | ⚠️ 未断言（我实跑验证 ✅） |
| `guild-member-removed` | `notice: group_decrease` | ✅ |
| `guild-member-request` | `request: group` + `sub_type != invite` | ✅ |
| `guild-request` | `request: group` + `sub_type: invite` | ✅ |
| `friend-request` | `request: friend` | ✅ |
| `reaction-added` | `notice: group_msg_emoji_like`（非 `remove`） | ✅ |
| `reaction-removed` | `notice: group_msg_emoji_like` + `sub_type: remove` | ✅ |
| `login-added` | `notice: bot_status`（非 `offline`） | ⚠️ 未断言（我实跑验证 ✅） |
| `login-removed` | `notice: bot_status` + `sub_type: offline` | ✅ |

> **12 种已实现**，其中协议套件断言覆盖 **10 种**；`guild-member-updated` 与
> `login-added` 在测试里未被断言，但我用同一套 harness 实跑确认它们**正常产出**
> （`group_card -> guild-member-updated`、`bot_status online -> login-added`）。
>
> ⚠️ **没有映射的事件一律丢弃，不猜类型**：`meta_event`（含 `heartbeat`）、
> `notice: notify/poke`、`group_ban`、`essence`、`group_upload` 等
> **不会产生任何 Satori 事件**。测试断言 `meta_event heartbeat -> no Satori event`。
> 源码注释：*"Returns null for events with no Satori equivalent; those are dropped
> rather than guessed at."*

### 5.2 事件信封

每个事件是一帧 `{op: 0, body: {...}}`，`body` 结构：

```json
{
  "id": 1,
  "sn": 1,
  "type": "message-created",
  "timestamp": 1794541191438,
  "login": { "sn": 1, "adapter": "haizakura", "platform": "haizakura",
             "user": { "id": "10001", "avatar": "...", "is_bot": false } },
  "message": { "...": "..." },
  "user": { "...": "..." },
  "member": { "...": "..." },
  "channel": { "...": "..." },
  "guild": { "...": "..." }
}
```

| 字段 | 说明 |
| --- | --- |
| `id` / `sn` | **同一个递增计数器**（`eventSeq`），每个事件 +1 |
| `timestamp` | **毫秒**（`Date.now()`） |
| `login` | 非登录事件只带 `sn`/`adapter`/`platform`/`user`（**无 `status`/`features`**） |
| `type` | 见 §5.1 |
| 其余 | 资源提升后的字段 |

> `sn` 是**适配器级全局计数器**，跨所有连接共享 —— 不是每连接独立编号。
> 登录事件（`login-added`/`login-removed`）的 `login` 是**完整对象**，
> 带 `status`（`1`/`0`）与全部 `features`。

### 5.3 ⭐ 资源提升规则（Satori 规范要求）

Satori 规定：**嵌套的资源要提升到事件最外层，且 `message` 内部不再保留它们。**
规范原文：

> 当资源对象出现多级嵌套时，内层的资源将会被统一提升到最外层。例如，当接收到消息事件时，
> 事件体中可以访问到 `message`, `member`, `user`, `channel` 等资源，
> 但 `message` 中就不再存在 `member` 和 `user` 字段了。

本实现通过 `satoriPromoteResources()` 完成：把 `message.user` /
`message.member` / `message.channel` / `message.guild` **搬到 `body` 顶层并从
`message` 中 `delete`**。

**`message-created` 实际帧**（已删减）：

```json
{
  "op": 0,
  "body": {
    "id": 1, "sn": 1, "type": "message-created", "timestamp": 1794541191438,
    "login": { "sn": 1, "adapter": "haizakura", "platform": "haizakura", "user": { "id": "10001", "..." : "..." } },
    "message": { "id": "777", "content": "hi <at id=\"30003\"/><emoji id=\"1\"/>",
                 "created_at": 1700000000000 },
    "user":    { "id": "30003", "name": "群名片", "nick": "群名片", "avatar": "...", "is_bot": false },
    "member":  { "user": { "id": "30003", "..." : "..." }, "nick": "群名片" },
    "channel": { "id": "20001", "type": 0, "name": "测试群" },
    "guild":   { "id": "20001", "name": "测试群", "avatar": "https://p.qlogo.cn/gh/20001/20001/640" }
  }
}
```

测试断言：

- `EVENT promotes channel/guild/user/member` ✅
- `EVENT message stripped of user/member/channel/guild` ✅
- `EVENT channel.id = group_id` ✅

> ⚠️ **一处与严格规则的偏差**：`message-deleted` 与 `reaction-added` /
> `reaction-removed` 的 payload 是**手工构造**的（没走 `satoriPromoteResources`），
> 它们的 `message` 里**仍然带一份嵌套 `channel`**，同时在顶层也有 `channel`：

```json
{ "message": { "id": "777", "channel": { "id": "20001", "type": 0 } },
  "channel": { "id": "20001", "type": 0 } }
```

> 这是**冗余而非缺失**，SDK 读顶层即可；但若你的代码严格校验「`message` 内不得有
> `channel`」，需要放宽。其余资源（`guild`/`user`/`member`/`operator`）都在顶层。

### 5.4 私聊事件

私聊 `message-created` **没有 `guild`，也没有 `member`**（QQ 私聊无群语义），
`channel` 是 `private:<uin>` 且 `type: 1`：

```json
{ "type": "message-created",
  "message": { "id": "778", "content": "dm", "created_at": 1700000001000 },
  "user": { "id": "30003", "name": "某人", "nick": "某人" },
  "channel": { "id": "private:30003", "type": 1 } }
```

### 5.5 事件 payload 速查

| 事件 | 顶层资源 |
| --- | --- |
| `message-created` | `message`, `user`, `channel`, `guild`（群聊）, `member`（群聊） |
| `message-deleted` | `message`, `channel`, `user`, `guild`（群撤回）, `operator`（若操作者≠发送者） |
| `guild-member-added` / `-removed` | `guild`, `channel`, `user`, `member`, `operator`（若有） |
| `guild-member-updated` | `guild`, `channel`, `user`, `member`（`group_admin` 时含 `roles`） |
| `guild-request` / `guild-member-request` | `guild`, `channel`, `user`, `member`, `message`（`id`=flag, `content`=理由）, `operator` |
| `friend-request` | `user`, `message`（`id`=flag, `content`=验证消息） |
| `reaction-added` / `-removed` | `guild`, `channel`, `message`, `user`, `operator`, `emoji` |
| `login-added` / `login-removed` | `login`（完整，含 `status` + `features`） |

**请求 flag 怎么取**（发起审批时要用）：

```
guild-request        → body.message.id  → guild.approve        { message_id }
guild-member-request → body.message.id  → guild.member.approve { message_id }
friend-request       → body.message.id  → friend.approve       { message_id }
```

**表情 ID 怎么取**：`reaction-*` 事件的 `emoji.id`，回传给
`reaction.create` / `.delete` / `.list` 的 `emoji_id`。

---

## 6. WebSocket 协议

### 6.1 Opcode

| 名称 | 值 | 方向 | 本实现 |
| --- | --- | --- | --- |
| `EVENT` | `0` | 服务端 → 客户端 | ✅ 推送事件 |
| `PING` | `1` | **客户端 → 服务端** | ✅ 收到即回 `PONG` |
| `PONG` | `2` | 服务端 → 客户端 | ✅ 仅作应答 |
| `IDENTIFY` | `3` | 客户端 → 服务端 | ✅ 鉴权 |
| `READY` | `4` | 服务端 → 客户端 | ✅ 鉴权成功 |
| `META` | `5` | 服务端 → 客户端 | ❌ **未实现**（常量已声明但从不发送） |

> ⚠️ **服务端不会主动发 `PING`。** 规范里「每隔 10s 发 PING」是**应用（客户端）**的职责；
> 本实现只**被动应答**：收到 `op:1` → 回 `{op:2, body:{}}`（测试断言 `PING -> PONG`）。
> 其它未知 opcode 只记一条 debug 日志，**不关闭连接**。

### 6.2 连接流程

```
1. 客户端连接 ws://host:port/v1/events          （路径不符 → HTTP 404 拒绝升级）
2. 客户端在 10 秒内发送 IDENTIFY：{ op:3, body:{ token, sn? } }
3. 服务端校验 token：
     失败 → close(4004, "invalid token")
     成功 → 回 READY：{ op:4, body:{ logins:[Login], proxy_urls:[] } }
4. 之后服务端持续推 EVENT：{ op:0, body:{...事件...} }
5. 客户端每 10s 发 PING，服务端回 PONG（可选）
```

**READY 帧实样**：

```json
{
  "op": 4,
  "body": {
    "logins": [ { "sn": 1, "adapter": "haizakura", "platform": "haizakura",
                  "user": { "id": "10001", "name": "HaizakuraBot", "nick": "HaizakuraBot",
                            "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=640",
                            "is_bot": false },
                  "status": 1, "features": ["login.get", "... 共 26 项"] } ],
    "proxy_urls": []
  }
}
```

- `proxy_urls` **恒为空数组**（本实现无代理路由）；
- `logins` 恒为长度 1 的数组（单账号）；
- 取 `get_login_info` 失败时用 `ctx.uin` 兜底，仍会正常回 READY。

### 6.3 错误处理与关闭码

| 关闭码 | 原因 | 触发 |
| --- | --- | --- |
| **`4004`** | `invalid token` | IDENTIFY 的 `body.token` 与配置不符 |
| **`4000`** | `invalid message` | 帧不是合法 JSON、或不是对象（非法帧） |
| **`4000`** | `IDENTIFY timeout` | 连接后 **10 秒内未发 IDENTIFY** |
| `1008` | `access token changed` | 热更新轮换了令牌，旧客户端被断开 |
| `1012` | `server closing` | 停用时**尚未完成 IDENTIFY** 的连接 |
| `1001` | `server closing` | `close()` / `forceClose()` 关闭全部连接 |

测试断言：`bad IDENTIFY token -> close 4004`、`invalid frame JSON -> close 4000`。

> 我另用 harness 实跑确认：不发送 IDENTIFY 时，**约 10 秒后收到
> `close(4000, "IDENTIFY timeout")`**，且连接从注册表移除。

### 6.4 `sn` 会话恢复（⚠️ 未实现缓冲重放）

- `IDENTIFY.body.sn` 会被**接受并记录**到该连接的 `lastSn`；
- 但**没有任何事件缓冲与重放逻辑** —— 源码里 `lastSn` 赋值之后**再未被读取**。
- 因此：**断线重连后，断开期间的事件会永久丢失**，不会补发。

> 如需可靠补充历史，请改用 HTTP 的 `message.list` 主动拉取。
> 规范的会话恢复语义（*重放 sn 之后的缓冲事件*）在本实现中**不成立**，请勿依赖。

### 6.5 ⚠️ IDENTIFY 之前的事件会被推送（安全相关）

`acceptConnection()` 会把连接**立即**登记进 `this.connections`，
而 `onEvent()` 的广播条件是**只检查连接数量，不检查 `identified`**：

```js
onEvent(event, _payload) {
  if (!this.isEnabled || this.connections.size === 0) return;
  ...
  for (const connection of this.connections.values()) safeSend(connection.socket, frame);
}
```

**实测确认**：即使配置了 `accessToken`，一个**未携带任何凭据、也未发送 IDENTIFY**
的连接，在建立后的 **10 秒窗口内**依然会收到完整的 `EVENT` 帧（含消息内容）；
10 秒后才被 `close(4000)` 踢掉。原因是 **upgrade 阶段没有调用
`authorizeUpgrade()`** —— 该方法在适配器上**有定义但从未被 `startServer()` 调用**
（对比：`ws-server-connections.ts` 里它确实被使用了）。

> **影响**：未鉴权者可短暂窃听事件流（每次连接最多 10 秒）。
> **缓解**：把 Satori 监听绑定在**受信网络/回环地址**，或在前置反代上做鉴权；
> 不要直接暴露到公网。这是已知缺陷，已在 §9 如实标注。

---

## 7. 资源映射（QQ 语义 → Satori）

### 7.1 对照表

| Satori | Haizakura / QQ |
| --- | --- |
| `Guild.id` | `group_id` |
| `Guild.name` | 群名（`group_name`，退回 `group_remark`） |
| `Guild.avatar` | `https://p.qlogo.cn/gh/{group_id}/{group_id}/640` |
| `Channel.id` | 群聊 = `group_id`；私聊 = **`private:<uin>`** |
| `Channel.type` | `0` = TEXT（群聊）/ `1` = DIRECT（私聊） |
| `Channel.name` | 群聊 = 群名；私聊 = 陌生人昵称 |
| `User.id` | **字符串**形式的 QQ 号 |
| `User.name` / `User.nick` | `card`（群名片）优先，否则 `nickname` |
| `User.avatar` | `http://q.qlogo.cn/headimg_dl?dst_uin={uin}&spec=640` |
| `User.is_bot` | 由 QQ 号段推断（见 §7.3） |
| `GuildMember.user` | 同 `User` |
| `GuildMember.nick` | `card \|\| nickname` |
| `GuildMember.joined_at` | `join_time`（秒）× 1000 → **毫秒** |
| `GuildMember.roles` | `owner=4` / `admin=3` / `member=2`（恒 1 条） |
| `Message.id` | `message_id`（**整数 → 字符串**） |
| `Message.content` | OneBot 消息段编码成 Satori 元素串（§8） |
| `Message.created_at` | **毫秒**时间戳 |

### 7.2 ⚠️ 时间戳单位是毫秒

**这是一条容易搞错的约定，务必看清：**

| 场景 | 单位 | 源码 |
| --- | --- | --- |
| 事件 `Message.created_at` | **毫秒** | `satoriToInt(event.time) * 1000` |
| `message.create` 返回的 `created_at` | **毫秒** | `Date.now()` |
| 事件信封 `timestamp` | **毫秒** | `Date.now()` |
| `GuildMember.joined_at` | **毫秒** | `satoriToInt(row.join_time) * 1000` |
| `guild.member.mute` 的 `duration` | **毫秒**（换算成秒下发） | `ceil(duration / 1000)` |

OneBot 的 `event.time` 是**秒**，本实现**乘 1000** 转成 Satori 的毫秒。
该裁定**对照 LLBot 实现**（`+msgTime * 1000`）做出，测试已断言：

- `wire is snake_case: created_at in ms` → `created_at === 1700000000000` ✅
- `message.create created_at is ms` → `> 1e12` ✅
- `member joined_at is ms` → `1600000000000` ✅

> 判别技巧：**13 位是毫秒，10 位是秒**。`1e12` 以上的时间戳就是毫秒。

### 7.3 `is_bot` 的判定

QQ 不直接告诉客户端「这是机器人」，本实现按**已知的机器人号段**推断
（源码 `SATORI_BOT_UIN_RANGES`）：

| 号段起 | 号段止 |
| --- | --- |
| `3328144510` | `3328144510` |
| `2854196301` | `2854216399` |
| `66600000` | `66600000` |
| `3889000000` | `3889999999` |
| `4010000000` | `4019999999` |

不在号段内 → `is_bot: false`（测试断言普通用户 `is_bot === false`）。

### 7.4 ⚠️ 线上字段是 snake_case

所有字段名在**线上都是 snake_case**：`is_bot`、`created_at`、`joined_at`、
`user_id`、`channel_id`、`guild_id`、`emoji_id`、`proxy_urls`、`role_id`、
`parent_id`、`reply_to`…

**不存在 camelCase 版本**。测试明确断言：

- `wire is snake_case: is_bot` → `is_bot === false && !("isBot" in user)` ✅
- `wire has no camelCase createdAt` → `!("createdAt" in message)` ✅

---

## 8. 消息元素

Satori 用 **XML 风格的元素串**编码消息（不是 OneBot 的消息段数组），
例如 `你好 <at id="30003"/> <emoji id="1"/>`。

### 8.1 接收方向（QQ → Satori）

OneBot 消息段编码为元素串（源码 `satoriEncodeSegments`）：

| OneBot 段 | Satori 元素 | 说明 |
| --- | --- | --- |
| `text` | 转义后的纯文本 | `& < > "` 会被转义 |
| `at` | `<at id="..."/>` | `qq == "all"` → `<at type="all"/>` |
| `face` | `<emoji id="..." name="..."/>` | |
| `mface` | `<emoji id="..." name="..."/>` | 取 `emoji_id` / `summary` |
| `image` / `flash_file` | `<img src="..." title="..."/>` | |
| `record` | `<audio src="..."/>` | |
| `video` | `<video src="..." poster="..."/>` | `thumb` → `poster` |
| `file` | `<file src="..." title="..."/>` | `name` → `title` |
| `reply` | `<quote id="..."/>` | |
| `forward` | `<message id="..." forward/>` | 合并转发 |
| `json` / `xml` | 转义后的原文文本 | 不保留卡片结构 |
| `poke` | 纯文本 `[戳一戳]` | |
| 其它未知段 | `data.text`（有则输出）否则丢弃 | |

- 空值属性会**省略**（`satoriAttr` 跳过 `undefined`/`null`/空串）；
- 段数组里非对象元素被跳过；
- `message` 不是数组时按字符串整体转义。

### 8.2 发送方向（Satori → QQ）

Satori 元素串解析为 OneBot 消息段（源码 `satoriParseFragment` + `satoriNodesToSegments`）。

**支持的元素**（实测输出）：

| Satori 元素 | OneBot 段 | 实测 |
| --- | --- | --- |
| 纯文本 | `text` | ✅ |
| `<br/>` | `text` `"\n"` | ✅ |
| `<p>…</p>` | 前后各补一个 `"\n"` | ✅ |
| `<at id="1"/>` | `at` `{qq:"1"}` | ✅ |
| `<at type="all"/>` | `at` `{qq:"all"}` | ✅ |
| `<sharp id="9"/>` | `text` `"#9"` | ✅ 降级为文本 |
| `<emoji id="1"/>` / `<face>` | `face` `{id:"1"}` | ✅ |
| `<img src/>` / `<image>` | `image` `{file:src}` | ✅ |
| `<audio src/>` | `record` `{file:src}` | ✅ |
| `<video src poster/>` | `video` `{file:src, thumb:poster}` | ✅ |
| `<file src title/>` | `file` `{file:src, name:title}` | ✅ |
| `<quote id="42"/>` | `reply` `{id:"42"}`（子元素继续展开） | ✅ |
| `<a href="…">text</a>` | `text` `"text ( href )"` | ✅ 降级为 `文本 ( 链接 )` |
| `<author/>` | **忽略**（不产出段） | ✅ |
| `<message>` | 仅展开子元素 | ⚠️ 见下 |
| 未知元素 | **丢弃标签、保留内部文本** | ✅ |

**修饰元素降级规则**：`b` / `strong` / `i` / `em` / `u` / `ins` / `s` / `del` /
`spl` / `code` / `sup` / `sub` **一律降级为纯文本**（保留内部文字、丢弃标签）。
实测 `<b>bold</b>` → `[{type:"text",data:{text:"bold"}}]`。

**转义与容错**：

- 支持 HTML 实体还原：`&lt; &gt; &quot; &apos; &amp;`，以及
  `&#65;`（十进制）、`&#x42;`（十六进制）；
- **未闭合标签按文本处理**：`<b>oops` → 文本 `"oops"`；
- **游离的 `>` 按文本**：`a > b` → `"a > b"`；
- `<!-- 注释 -->` 被跳过；
- 解析是**刻意宽容**的，避免畸形 payload 变成 500。

**⚠️ 已知的发送限制**（实测）：

| 输入 | 结果 |
| --- | --- |
| `<message id="1"/>`（顶层） | **`400`** —— 解析不出可发送段 |
| `<author id="1">x</author>` | **`400`** —— `author` 被忽略，无剩余段 |
| 纯注释 / 空串 | **`400`** `content must contain at least one sendable element` |

> 即：**解析后段列表为空 → 400**（空文本段也会被过滤掉）。
> 合并转发（`<message forward>` 嵌套）在本实现中**不具备发送能力** ——
> `<message>` 只被当作透明容器展开，`id` 属性**不会**转成 `forward` 段
> （对比接收方向的 `forward` → `<message .../>`，两者**不对称**）。

---

## 9. 已知限制（如实标注）

| # | 限制 | 细节 |
| --- | --- | --- |
| 1 | **分页是近似实现** | `message.list` 的 `next` 用「本页最后一条的 id」，且只在 `行数 ≥ limit` 时给出；`prev`/`direction` 不支持。不是协议要求的真游标。 |
| 2 | **`sn` 会话恢复未做缓冲重放** | `IDENTIFY.body.sn` 被记录后**从不使用**；断线期间事件永久丢失（§6.4）。 |
| 3 | **真实 WS 帧收发只在 arm64 验证过** | 本机（x64）缺 `ws` 的 native addon（只有 arm64 二进制），协议状态机用 **socket double** 驱动。**真实握手/分帧未被覆盖**，需在 arm64 主机复验。 |
| 4 | **未实现的 API 返回 404** | 这是**规范要求**（不是缺陷），但意味着调用未列出的方法（如 `channel.update`、`guild.member.role.create`、`interaction.*`）都会得到 404。 |
| 5 | **`private:` 频道约定跟随 LLBot** | 为兼容 SDK 生态而采用，非 Satori 强制；换实现时注意。 |
| 6 | **`messageFormat` 对 Satori 无效** | 适配器**不读取**该字段 —— Satori 永远用元素串 `content`，无「array/string」之分。 |
| 7 | **`reportSelfMessage` 对 Satori 无效** | 适配器**不读取**该字段。即使设为 `false`，`message_sent`（自己发的消息）**仍会被转成 `message-created` 并推送**（我实跑确认）。 |
| 8 | **upgrade 阶段未鉴权，存在 10 秒事件窗口** | 未 IDENTIFY 的连接也收事件，10 秒后才被 `close(4000)`；`authorizeUpgrade()` 定义了但**从未被调用**（§6.5）。不要公网暴露。 |
| 9 | **`META`(op 5) 未实现** | 常量已声明，但服务端从不发送；`proxy_urls` 恒为 `[]`。 |
| 10 | **服务端不发 PING** | 心跳方向是**客户端 → 服务端**，服务端只被动回 PONG。 |
| 11 | **`message-deleted` / `reaction-*` 未做严格提升** | 这两个 payload 的 `message` 内**仍带一份 `channel`**（顶层也有），属冗余（§5.3）。 |
| 12 | **`guild.member.role.set` 无法转让群主** | `role_id: "4"`/`owner` 会被当作**取消管理员**（§4.5）。 |
| 13 | **`guild.member.mute` 存在单位换算与舍入** | 毫秒 → 秒，`ceil` 且下限 1 秒；`0` 表示解禁。 |
| 14 | **`<message>` 不能发送合并转发** | 顶层 `<message>` 只展开子元素、`id` 被忽略（§8.2）。 |
| 15 | **无默认 Satori 监听** | 全新安装**不会**自动创建 Satori 服务器。源码里 `makeDefaultSatoriServer()` 已定义但**从未被调用**（死代码），默认配置的 `wsServers` 只有 `path: "/"` 的 `ws-default`。必须手工加哨兵条目。 |
| 16 | **`satoriHttpStatusForResponse` 是死代码** | 该函数能把 OneBot 的 `1404` 映射成 `404`、`1400` → `400`，但**从未被调用**；实际所有下游失败都统一返回 **`400`**。 |

> **关于第 3 条**：`README-satori-tests.md` 明确写道 ——
> *"true wire-level WS handshake/framing is NOT covered here. Verify that on an arm64 host."*

---

## 10. 与 LLBot 的对比

| 项 | LLBot | Haizakura |
| --- | --- | --- |
| **接入方式** | 独立 `satoriServers` 配置项 | **复用 `wsServers[]` + `path` 哨兵** |
| **平台标识** | `llonebot` | `haizakura` |
| **API 数** | **28 个 handler**（29 个 `api__*.ts` 文件，含 `api__index.ts`） | **24 个** |
| **事件类型** | 至少 10 种（`guild-added` / `guild-removed` / `guild-request` / `guild-member-added` / `-removed` / `-request` / `message-created` / `-deleted` / `reaction-added` / `-removed` / `friend-request`） | **12 种** |
| 配置改动 | 需改 `config.ts`（新增 kind） | **零 `config.ts` 改动**（只 patch 1 个原型方法） |
| WebUI 分组 | 独立的 Satori 分组 | 归在「WS 服务器」分组（状态标签仍为 Satori） |
| 传输实现 | Hono + `@hono/node-server` + 官方 `ws` | `node:http` + **自研 `WebSocketServer`** |
| 类型转换 | `ts-case-convert` 的 `ObjectToSnake` | 手写构造 snake_case 字面量 |
| 参考位置 | `reference/satori/*.ts` | `restored/packages/onebot/src/network/satori-*.ts` |

**API 差异（精确核对）**：Haizakura 的 **24 个是 LLBot 28 个的严格子集**，
差集恰好是 **4 个** —— LLBot 多出下列 4 个（Haizakura 未实现，调用返回 `404`）：

```
channel.update        channel.delete        channel.mute
channel.user.create （创建私聊频道）
```

> 核对方式：把两边方法名逐一对齐（`getChannel` → `channel.get`、
> `handleGuildRequest` → `guild.approve`、`setGuildMemberRole` → `guild.member.role.set`、
> `createDirectChannel` → `channel.user.create` 等，由 `api__index.ts` 的 import 路径推定），
> 集合差恰为上述 4 项，故 **24 = 28 − 4** 完全吻合；
> Haizakura 侧**没有 LLBot 缺失的独有方法**。

> ⚠️ 上表 LLBot 侧的 handler 数与事件名由 `reference/satori/api__index.ts`
> 与 `event__*.ts` 静态统计得出，**未在 LLBot 运行实例上实测**；
> Haizakura 侧数字均来自源码与本机实跑。

> Satori 的 `adapter` / `platform` 字段标识**平台类型**，用于 SDK 侧的差异化处理。
> 两者取值不同（`llonebot` vs `haizakura`），**应用侧的平台判断逻辑需要相应适配**。

---

## 11. 快速验证

```bash
TOKEN=<your-token>          # 配置里的 accessToken
BASE=http://127.0.0.1:5600
H=(-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
   -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001')

# 1) 登录信息（最基础的健康检查）
curl -s -X POST $BASE/v1/login.get "${H[@]}" -d '{}'

# 2) 群列表
curl -s -X POST $BASE/v1/guild.list "${H[@]}" -d '{}'

# 3) 发一条群消息
curl -s -X POST $BASE/v1/message.create "${H[@]}" \
  -d '{"channel_id":"20001","content":"hello <at id=\"30003\"/>"}'

# 4) 群成员（注意 joined_at 是毫秒）
curl -s -X POST $BASE/v1/guild.member.get "${H[@]}" \
  -d '{"guild_id":"20001","user_id":"30003"}'

# 5) 反向验证鉴权（预期 401）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/v1/login.get \
  -H 'Content-Type: application/json' -d '{}'

# 6) 验证平台标识必须是 haizakura（预期 403）
curl -s -X POST $BASE/v1/login.get "${H[@]}" -H 'Satori-Platform: qq' -d '{}'

# 7) 验证不支持的 API 返回 404（预期 404，不是 501）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/v1/channel.update "${H[@]}" -d '{}'
```

**WebSocket 事件流**（需要 `websocat` 或 Node 脚本）：

```bash
websocat ws://127.0.0.1:5600/v1/events
# 连上后立刻发送（10 秒内！）：
{"op":3,"body":{"token":"<your-token>"}}
# 预期收到：{"op":4,"body":{"logins":[...],"proxy_urls":[]}}
```

### 复现测试套件

```bash
cd restored
node scripts/build.mjs                          # 产出 dist/index.mjs
node scripts/tests/run-satori-tests.mjs         # 76 条协议/API 断言
node scripts/tests/run-satori-integration.mjs   # 22 条挂载/NetworkManager 断言
```

### 实测结果（2026-11-13，本机）

| 请求 | 结果 |
| --- | --- |
| `login.get`（正确头 + token） | `200`，`platform: "haizakura"`，26 个 features |
| `login.get`（`Satori-Platform: qq`） | **`403`** `login not found` ✅ |
| `login.get`（完全不带头） | `200`（缺失被容忍） |
| `message.get`（下游动作失败） | `400` `{"message":"unknown action"}` |
| `channel.update`（未实现） | **`404`** `method not found` ✅ |
| `GET /v1/login.get` | `405` + `Allow: POST` |
| `POST /v1/nonsense` | `404` `method not found` |
| WS：错误 token 的 IDENTIFY | `close(4004)` |
| WS：非法 JSON 帧 | `close(4000)` |
| WS：10 秒不发 IDENTIFY | `close(4000, "IDENTIFY timeout")` |
| WS：未 IDENTIFY 就收事件 | ⚠️ **收到了**（10 秒窗口，见 §9 第 8 条） |

---

## 12. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| WebUI 里看不到 Satori 分组 | 设计如此，复用 `wsServers[]` | 在「WS 服务器」分组找，**状态标签是 Satori** |
| 配了 `path: "/v1/events"` 却像 OneBot | 哨兵拼写不符（如多了前缀） | `path` 必须**精确等于** `/v1/events` |
| OneBot WS 突然变了行为 | **`/v1/events` 被 OneBot 占用了** | 给 OneBot 用别的 `path`（如 `/`） |
| `403 login not found` | `Satori-Platform` 传了非 `haizakura`（如 `qq`），或 `Satori-User-ID` 不对 | 改正头部；**`haizakura`** |
| `401 authorization required` | 配置了 token 但没带 `Authorization` | 加 `Authorization: Bearer <token>` |
| `404 method not found` | 方法不在 24 个白名单内 | 见 §4；这是规范行为，非故障 |
| 调用未实现方法想得到 501 | 规范要求 404 | 别依赖 501 |
| 收到的事件里 `message` 没有 `user` | **资源提升**，去顶层取 | 见 §5.3 |
| 时间比预期大 1000 倍 | 就是**毫秒** | 见 §7.2 |
| 字段名对不上（`isBot`） | 线上是 **snake_case** | 见 §7.4 |
| WS 连上没反应 | 没在 10 秒内发 IDENTIFY | 立即发 `{op:3,body:{token}}` |
| 重连后缺事件 | `sn` 恢复**未实现重放** | 用 `message.list` 补历史 |
| 自己发的消息也推来了 | `reportSelfMessage` **对 Satori 无效** | 应用侧按 `user.id == 自己` 过滤 |
| `message.create` 返回 400 | `content` 解析后无可发送元素（空串/纯注释/顶层 `<message>`） | 至少放一个文本或受支持元素 |
| 群成员 `joined_at` 缺失 | `join_time` ≤ 0 时该字段**不出现** | 属正常可选字段语义 |
| 保存配置报令牌错误 | 非回环地址必须 ≥ 16 字符且不易猜 | 用随机 token 或绑 `127.0.0.1` |
| 保存配置报 `statusCommand must be an object` | `POST /api/config/:uin` 要求**完整**配置 | 用 §2.2 的完整形状 |
| `channel.list` 只有 1 条 | QQ **一群一频道**（`guild.plain`） | 属预期 |
| 转让群主失败/被取消管理员 | `role.set` 只表达管理员开关 | 见 §9 第 12 条 |

---

## 13. 声明

| 项目 | 状态 |
| --- | --- |
| 哨兵识别规则、匹配容错（尾部斜杠/查询串） | **已核实**：源码 + harness 实跑（6 种 path 形态） |
| 24 个 API 的转发目标、参数、返回值 | **已核实**：`SATORI_API` 表 + 逐个实跑 |
| 事件类型（12 种）与资源提升 | **已核实**：源码 + 实帧 dump；10 种有测试断言 |
| 状态码、鉴权头行为、404/405 分支 | **已核实**：源码 + 实跑 7 种请求 |
| WS opcode、关闭码、10s IDENTIFY 超时 | **已核实**：socket double 实跑 |
| 元素收发与降级规则 | **已核实**：22 组收发用例实跑 |
| `reportSelfMessage` / `messageFormat` 无效 | **已核实**：源码无引用 + 实跑复现 |
| 事件在 IDENTIFY 前被推送 | **已核实**：实跑复现（10 秒窗口） |
| 98/98 测试通过 | **已核实**：本机实跑 76 + 22 |
| 真实 WS 握手与分帧 | ⚠️ **未验证**（x64 缺 native addon，需 arm64 复验） |
| 本文示例的端口/群号/token | 示例值，**未**在你的环境实测 |

> 未实测项：**真实 WebSocket 帧级收发**（握手、掩码、分片）未在本机验证，
> 协议状态机部分通过 socket double 覆盖，结论来自源码阅读 + 双精度实跑。
