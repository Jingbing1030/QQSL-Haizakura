# Satori protocol integration guide

> [!WARNING]
> This content was written entirely by AI; review it with care.

> This document describes Haizakura's (formerly SnowLuma's) implementation of the **Satori protocol** (`satori.chat`):
> how to enable the server with a **path sentinel**, its 24 APIs, events and resource mapping, message element
> send/receive, and the differences from LLBot.
>
> **Data sources**: `packages/onebot/src/network/satori-server-adapter.ts` (1445 lines; transport layer + API table),
> `packages/onebot/src/network/satori-mount.ts` (95 lines; mount layer),
> `packages/onebot/src/config.ts` (`wsServers` parsing and validation),
> `scripts/tests/driver-protocol.mjs` (76 assertions) and `scripts/tests/driver-integration.mjs` (22 assertions).
>
> **Test status**: `node scripts/tests/run-satori-tests.mjs` → **76/76 pass**;
> `node scripts/tests/run-satori-integration.mjs` → **22/22 pass** (**98/98** total, run on 2026-11-13).

---

## 1. Introduction

### 1.1 What Satori is

Satori is a **cross-platform chatbot protocol** (<https://satori.chat>) maintained by the Koishi ecosystem.
It abstracts different chat platforms (QQ, Discord, Telegram, …) into a unified set of **resources**
(`User` / `Channel` / `Guild` / `GuildMember` / `Message` / `Reaction`, …), so application code only
programs against those resources:

| Channel | Purpose | Section in this document |
| --- | --- | --- |
| **HTTP API** | Active calls (send a message, query a group, kick someone, …) | §3 / §4 |
| **WebSocket** | Passive event stream reception | §3 / §6 |
| WebHook | Another way to receive events | ❌ **Not provided** by this implementation |

### 1.2 Why Haizakura supports it

**Because Satori has a ready-made SDK ecosystem, so plugging it in works immediately.** With Satori support:

- **Koishi** can connect to Haizakura directly through the Satori adapter, with no need to write a OneBot bridge;
- Official SDKs such as **`@satorijs/satori`** interoperate directly, with no hand-written HTTP/WS stack;
- Application code becomes **reusable across platforms** — the same logic can run on QQ (Haizakura) and on other Satori implementations.

### 1.3 Relationship to OneBot v11

**Both coexist; neither replaces the other, and both can be enabled at once.**

| Dimension | OneBot v11 | Satori |
| --- | --- | --- |
| Positioning | De facto standard in the QQ ecosystem | Cross-platform abstraction |
| Configuration location | `networks.*` (4 adapter categories) | **Reuses `networks.wsServers[]`** (see §2) |
| Port | Independent | Independent; **can listen on a different port alongside OneBot** |
| Event/action model | `post_type` + 222 actions | 12 event categories + 24 methods |

One account can run an OneBot WS server and a Satori server at the same time, and `emitEventNow()`
**fans every event out** to both (source `network-manager.ts`; the integration test
`manager-fed EVENT has channel+user promoted` asserts this).

> For the full OneBot v11 documentation see [`onebot11.md`](onebot11.md), [`events.md`](events.md) and [`actions.md`](actions.md).

---

## 2. ⚠️ How to enable it (the sentinel mechanism)

> **This section is the most important part of the document.** Haizakura's Satori server has **no dedicated
> configuration entry**; it **reuses OneBot's `wsServers[]` list** and identifies itself through the `path` field.

### 2.1 Recognition rule

```
wsServers[] 中 path === "/v1/events" 的条目  =  Satori 服务器
```

The decision logic (`satoriMountIsSatoriServer` in `satori-mount.ts`):

1. Take the `path` field (treated as `"/"` when not a string);
2. Strip the query string (after `?`) and any **trailing slash**;
3. Only an **exact** match with `"/v1/events"` counts as Satori.

The recognition results for various forms are therefore:

| Configured `path` | Recognized as |
| --- | --- |
| `/v1/events` | ✅ Satori |
| `/v1/events/` | ✅ Satori (trailing slash tolerated) |
| `/v1/events?x=1` | ✅ Satori (query string tolerated) |
| `/v1/eventsfoo` | ❌ Ordinary OneBot WS |
| `/satori/v1/events` | ❌ **No match** (only the exact value counts; this is not prefix matching) |
| `/` | ❌ Ordinary OneBot WS |

> Mounting works by patching `OneBotInstance.prototype.createNetworkAdapter`
> (source `satori-mount.ts`): it first checks whether `kind === "wsServer"` and `path` hits the sentinel,
> returning `SatoriServerAdapter` if so, and otherwise **handing back unchanged** to the native implementation.
> The integration test asserts that an ordinary `/` entry still gets a `WsServerAdapter` (`normal path -> WsServerAdapter (unchanged)`).

### 2.2 Complete configuration example (ready to copy)

`POST /api/config/:uin` **strictly validates the entire configuration object** (`assertValidOneBotConfig`),
so here is a **complete, submittable** shape (`statusCommand` and `historySync` are both required):

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

> ⚠️ Leaving `accessToken` as the literal placeholder `<your-token>` is **rejected by the token strength policy**
> (fewer than 16 characters): replace it with a real random token, for example
> `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` (43 characters).
> Leaving it empty (= no authentication) is only allowed when saving **from loopback** or binding `host` back to `127.0.0.1`.

Field descriptions (following `wsServers` semantics):

| Field | Required | Description |
| --- | --- | --- |
| `name` | Recommended | Unique adapter name; **globally it must not clash with any other kind** |
| `host` | — | Defaults to `0.0.0.0`; cross-machine access requires writing `0.0.0.0` explicitly |
| `port` | **✔** | 1–65535, **> 0**, and must not conflict with other listening entries |
| `path` | **✔** | Must be **exactly** `/v1/events`; this is the sentinel |
| `accessToken` | Recommended | Empty = **no authentication** (⚠️ combined with the unauthenticated window in §6.5, this means fully open) |
| `messageFormat` | — | ⚠️ **No effect on Satori** (see §9) |
| `reportSelfMessage` | — | ⚠️ **No effect on Satori** (see §9) |
| `role` | Optional | Defaults to `Universal`; **completely meaningless for Satori and ignored** (writing `Api`/`Event` still sends and receives events, confirmed by testing) |
| `maxPayloadBytes` | Optional | Inbound WS frame limit (a general `wsServers` field) |
| `enabled` | Optional | With `false` the factory still returns the Satori adapter, but `open()` returns immediately and **does not listen** |

**A file with only `wsServers` also passes file validation**: when configured through
`config/onebot_<uin>.json`, `fromJson` fills in defaults for `statusCommand` / `historySync` / the other three
network arrays, so the file may contain only `networks.wsServers`. **The WebUI POST endpoint does not accept omissions**, so use the complete shape above.

> **Do not add Satori-specific fields to the sentinel entry**: `wsServers` has a fixed field set
> (`name` / `enabled` / `accessToken` / `messageFormat` / `reportSelfMessage` /
> `host` / `port` / `path` / `role` / `maxPayloadBytes`). The three paths behave differently in practice:
>
> | Path | Behavior with unknown fields |
> | --- | --- |
> | `POST /api/config/:uin` (save) | **Silently accepted**, no error |
> | `fromJson` (load a file) | **Silently discarded** (the field is absent from the produced object) |
> | Configuration import/restore (`validateOneBotRestoreSource`) | **Explicitly rejected**: `$.networks.wsServers[0].xxx is not supported` |
>
> That is, saving through the WebUI **does not error**, but the field is gone the next time the configuration loads — do not count on it taking effect.
> This is precisely why this adapter **must be self-contained** (not depending on extra configuration fields).

### 2.3 Why this "sentinel" approach? (design tradeoff)

In Haizakura's configuration module `config.ts`,
`fromJson` and `toJsonObject` **hard-code 4 kinds** (`httpServers` / `httpClients` /
`wsServers` / `wsClients`), and `RESTORE_NETWORK_KEYS` is a fixed set as well.

Adding a fifth kind (such as `satoriServers`) would require changing `config.ts` itself:

- `config.ts:222` walks `RESTORE_NETWORK_KEYS` and reads `parsed.networks[key].length` —
  `fromJson`'s output has no new kind, so `undefined.length` throws a **TypeError** outright,
  making the whole configuration save/restore path unusable;
- `validateRestoreAdapterArray` requires a `url` field for unknown kinds, so the shape does not match.

And `config.ts` is an **existing region**, so changing it would require **renumbering 432 regions** (the comment at the
top of `satori-mount.ts` records this conclusion explicitly: *“adding a kind requires editing config.ts itself, and that is an existing region
(changing it means renumbering 432 regions)”*).

**The v2 approach (the current implementation)**: reuse the existing `wsServers[]` and patch **1 prototype method**. The benefits:

- The configuration pipeline is **100% reused** — parsing, validation, serialization, hot reload and **port conflict detection** all keep working;
- `config.ts` is untouched, so there is zero region-renumbering risk;
- The integration tests assert `RESTORE_NETWORK_KEYS not polluted` and
  `compileDesiredPlan NOT patched (v2 minimal)` (only 1 method changed).

**The costs (which you must be aware of)**:

- In the WebUI's network status list this entry appears under the **"WS servers" group**;
  however the **status label (`kind`) is still `satoriServer`**, and `detail` shows
  `Satori v1 · N event clients` (source `describeStatus()`; the integration test
  `Satori adapter describeStatus().kind` asserts this);
- Conversely, **the `/v1/events` path can no longer be assigned to OneBot WS** —
  whoever writes `path: "/v1/events"` becomes a Satori server (see §2.5).

### 2.4 Hot reload (no restart, no losing the login session)

The configuration can be **hot reloaded** through the WebUI's `POST /api/config/:uin`:

```bash
curl -X POST http://127.0.0.1:3080/api/config/10001 \
  -H 'Content-Type: application/json' \
  -d @satori-config.json
```

A successful response looks like:

```json
{ "success": true, "saved": true, "applied": true, "online": true,
  "reloaded": true, "message": "配置保存成功，已热重载当前会话。", "errors": [], "adapters": [] }
```

- **No process restart is needed and the login session is not lost** (it goes through `oneBotManager.reloadConfig`);
- When the session is offline the save still succeeds but `online: false`, so it **takes effect on the next connection**;
- Token rotation **actively disconnects connected event clients**: `closeConnections(1008, "access token changed")`
  (source `onConfigReplaced`) — the client must IDENTIFY again.

> ⚠️ **Token policy for remote saves**: `wsServers` belongs to inbound nodes (`INBOUND_KINDS`),
> so when saving through a non-loopback address, **`accessToken` must not be empty, must be at least 16 characters**,
> and must not be guessable (source `onebot-token-policy.ts`). Only binding back to `127.0.0.1` or saving from the local machine allows it to be empty.

### 2.5 Enabling it alongside OneBot

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

- The two **must use different ports**, otherwise validation rejects it outright (`networks.wsServers[1] conflicts with networks.wsServers[0] on server binding ...`);
- `name` is unique **across all kinds**; a duplicate reports `network adapter name "..." is duplicated in ... and ...`;
- Satori can run **multiple** entries (on different ports) without affecting each other.

---

## 3. Access methods

### 3.1 HTTP API

```
POST http://<host>:<port>/v1/{resource}.{method}
Content-Type: application/json
```

- The request body must be a **JSON object** (arrays or scalars are rejected: `请求体必须是 JSON 对象`);
  an empty body is treated as `{}` (measured `200`);
- `Content-Type` is **not validated**: `application/json`, `text/plain` and omitting it entirely
  all work (all measured `200`). The spec recommends `application/json`; this implementation simply does not enforce it;
- The method name is **the remainder of the path**, e.g. `POST /v1/login.get`, `POST /v1/message.create`;
  method paths **may carry a query string** (`/v1/login.get?x=1` measured `200`; query parameters are ignored);
- ⚠️ **No extra `/v1` layer is appended**. Because the sentinel `path` is itself `/v1/events`,
  `mountPrefix()` returns an empty string for both `/` and `/v1/events`,
  so endpoints are `/v1/<method>`, **not** `/v1/events/v1/<method>`
  (source comment: *"must NOT append another `/v1`"*; the test asserts
  `route: POST /v1/login.get (no double /v1)`).

### 3.2 WebSocket event stream

```
GET ws://<host>:<port>/v1/events      （HTTP Upgrade）
```

- The path must be **exactly** `/v1/events`, otherwise the upgrade is rejected: `abortUpgrade(socket, 404, "Not Found")`;
- Reaching that path with a **plain GET** (no upgrade) gives `405` + `Allow: GET` + `please connect with WebSocket`.

### 3.3 Required request headers

| Header | Value | Required |
| --- | --- | --- |
| `Satori-Platform` | **`haizakura`** | ⚠️ See below |
| `Satori-User-ID` | The account uin | Optional (**must match if provided**) |
| `Authorization` | `Bearer <accessToken>` | Required when a token is configured |

**The correct value for `Satori-Platform` is `haizakura`, not `qq`!**

```bash
curl -X POST http://127.0.0.1:5600/v1/login.get \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' \
  -H 'Satori-User-ID: 10001' \
  -d '{}'
```

Measured behavior (source `handleRequest` plus my own live runs):

| Situation | Result |
| --- | --- |
| `Satori-Platform: haizakura` | `200` ✅ |
| **`Satori-Platform: qq`** | **`403`** `{"message":"login not found"}` |
| **Omitting** `Satori-Platform` entirely | `200` (**absence tolerated**) |
| `Satori-User-ID` does not match the current account | `403` `{"message":"login not found"}` |
| Omitting `Satori-User-ID` entirely | `200` (**absence tolerated**) |

> That is: both headers are only rejected when they **are provided with a wrong value**. SDKs send
> `Satori-Platform` by default, so as long as the platform identifier is right (`haizakura`) there is no problem;
> if you write your own client, **omitting them still works**, but **sending `qq` always gives 403**.

### 3.4 Status code table

| Code | Trigger | Body |
| --- | --- | --- |
| `200` | Success | The method's return value (varies by method; see §4) |
| `400` | Missing/invalid parameter, JSON syntax error, non-object body, downstream action failure | `{"message":"..."}` |
| `401` | A token is configured but `Authorization` is **absent** | `{"message":"authorization required"}` |
| `403` | Token mismatch / `Satori-Platform` or `Satori-User-ID` mismatch | `{"message":"invalid token"}` or `"login not found"` |
| **`404`** | **The method is not among the 24 whitelisted ones**, or the path is not under the `/v1/` prefix | `{"message":"method not found"}` / `"not found"` |
| `405` | A non-POST method on a method path; a plain GET on `/v1/events` | Carries an `Allow` header |
| `413` | Request body exceeds **64 MiB** (`readRequestBody`'s default limit) | `{"message":"request body too large"}` |
| `503` | The service is shutting down (`acceptingActions === false`) | `{"message":"server closing"}` |

> **Key point: an unsupported API returns `404`, not `501`.** This follows the Satori spec
> (*"an API a platform does not support should return 404; only a platform that supports it but has not implemented it in the adapter returns 501"*).
> The source comment states it plainly too: *"an unsupported API must answer 404, never 501"*.
>
> **Note**: Satori error bodies are **flat `{message}`**, **completely different** from OneBot's
> `{status, retcode, data, wording}`. Do not mix the two error-handling styles.

### 3.5 Authentication order (easy to get wrong)

HTTP requests are processed in this order, and **authentication is not the first step**:

1. `acceptingActions` is false → `503`;
2. The path is `/v1` (or `/v1/`) → `404 method not found`;
3. The path does not start with `/v1/` → `404 not found`;
4. The method name is `events` → `405` (suggesting WebSocket);
5. The method is not `POST` → `405`;
6. **Only then is `Authorization` validated**: absent → `401`, mismatched → `403`;
7. `Satori-User-ID` and `Satori-Platform` are validated → mismatch gives `403`;
8. The method is not in the `SATORI_API` whitelist → `404`.

> Consequently, **for an unauthenticated request, `404`/`405` are returned before `401`**.
> Also, when `accessToken` is empty the **entire authentication step is skipped** — even a wrong token is let through.

---

## 4. API list (24)

The `SATORI_API` table contains **exactly 24 entries**, consistent with the 26 features declared by `SATORI_FEATURES`
(26 = 24 methods + `message.list.from` + `guild.plain`; the latter two are **capability markers**, not methods).

**Conventions**:

- Every method is `POST`, with parameters in the JSON body;
- ID-style parameters are all **strings** on the wire (`user_id`/`group_id` numbers are also tolerated by `toInt`);
- On failure it throws → HTTP `400` + `{"message":"..."}`.

### 4.1 Login

#### `login.get`

| Item | Value |
| --- | --- |
| Parameters | None |
| Forwards to | `get_login_info` |
| Returns | `Login`: `{sn, adapter, platform, user, status, features}` |

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

> `status`: `1` = ONLINE, `0` = OFFLINE.
> When `get_login_info` fails it **does not error**; it falls back to `ctx.uin` and still returns a Login.

### 4.2 Messages

| Method | Forwards to | Parameters | Returns |
| --- | --- | --- | --- |
| `message.create` | `send_msg` | `channel_id` **✔**, `content` **✔** | `Message[]` (length 1) |
| `message.get` | `get_msg` | `message_id` **✔** (`channel_id` unused) | `Message` |
| `message.delete` | `delete_msg` | `message_id` **✔** | `null` |
| `message.list` | `get_group_msg_history` / `get_friend_msg_history` | `channel_id` **✔**, `limit`, `next`/`message_id`, `order` | `BidiList`: `{data, next?}` |

**`message.create`** — Satori `content` (element string) → OneBot message segments:

- A purely numeric `channel_id` → group chat, going through `{message_type:"group", group_id}`;
- `channel_id` of `private:<uin>` → private chat, going through `{message_type:"private", user_id}`;
- If parsing `content` yields **no sendable elements** → `400 content must contain at least one sendable element`;
- The returned `Message.created_at` uses `Date.now()` (**milliseconds**), and `id` is the
  **string** form of the `message_id` returned by `send_msg`;
- If the local `get_msg` cannot find the just-stored self-sent message, it **falls back to echoing the submitted content**
  rather than failing an already successful send.

```bash
curl -X POST http://127.0.0.1:5600/v1/message.create \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001' \
  -d '{"channel_id":"20001","content":"你好 <at id=\"30003\"/> <emoji id=\"1\"/> <img src=\"https://x/y.png\"/>"}'
```

**`message.list`** pagination semantics (⚠️ **an approximation**; see §9):

- When `limit` is absent/≤0/>100 it **falls back to 50**;
- `next` (or `message_id`) is passed to OneBot's `message_id` as the anchor;
- `order: "asc"` → `reverse_order: false`; absent or `"desc"` → `reverse_order: true`;
- A `next` is provided **only when the returned row count ≥ limit**, and its value is **the `id` of this page's last message** —
  this is an approximation using "the message ID as a cursor", not a true cursor as the protocol requires;
- `prev` and `direction` (`before`/`after`/`around`) are **not supported**.

### 4.3 Channels

| Method | Forwards to | Parameters | Returns |
| --- | --- | --- | --- |
| `channel.get` | Group chat → `get_group_info`; private chat → `get_stranger_info` | `channel_id` **✔** | `Channel` |
| `channel.list` | `get_group_info` | `guild_id` **✔** | `{data:[Channel]}` (always 1 entry) |

- A group chat `channel_id` is the group number as a string, returning `type: 0` (TEXT) and `name` = the group name;
- A private chat `channel_id` is `private:<uin>`, returning `type: 1` (DIRECT) with
  `name` taken from the stranger's nickname (omitted from the response if that fails);
- Because **QQ has one channel per group** (`guild.plain`), `channel.list` returns only that one channel.

### 4.4 Guilds

| Method | Forwards to | Parameters | Returns |
| --- | --- | --- | --- |
| `guild.get` | `get_group_info` | `guild_id` **✔** | `Guild` |
| `guild.list` | `get_group_list` | None | `{data:[Guild]}` |
| `guild.approve` | `set_group_add_request` (`sub_type:"invite"`) | `message_id` **✔** (=flag), `approve`, `comment` | `null` |

`Guild` shape: `{id, name, avatar}`, where `avatar` is
`https://p.qlogo.cn/gh/{group_id}/{group_id}/640`.

> `guild.approve`'s `message_id` is actually the **request flag** — taken from the
> `guild-request` event's `message.id`. `approve` **defaults to true**
> (`source.approve !== false`).

### 4.5 Guild members

| Method | Forwards to | Parameters | Notes |
| --- | --- | --- | --- |
| `guild.member.get` | `get_group_member_info` | `guild_id` **✔**, `user_id` **✔** | Returns a single `GuildMember` |
| `guild.member.list` | `get_group_member_list` | `guild_id` **✔** | `{data:[GuildMember]}` |
| `guild.member.kick` | `set_group_kick` | `guild_id`, `user_id`, `permanent` | `permanent:true` → `reject_add_request:true` |
| `guild.member.mute` | `set_group_ban` | `guild_id`, `user_id`, `duration` (**milliseconds**) | Conversion below |
| `guild.member.role.set` | `set_group_admin` | `guild_id`, `user_id`, `role_id` | Can only express "administrator / not administrator" |
| `guild.member.approve` | `set_group_add_request` (`sub_type:"add"`) | `message_id` (=flag), `approve`, `comment` | Join requests |

**`GuildMember` shape**:

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

Key points:

- `user.name` / `user.nick` take `card || nickname` (**group card takes priority**);
- **`joined_at` is in milliseconds**: `join_time` (seconds) × 1000; when `join_time` ≤ 0 **the field is absent**;
- `roles` is **always an array of length 1** (QQ has only a single-role ladder);
- `member.avatar` is identical to `user.avatar` (QQ has no separate group avatar).

**Unit conversion for `guild.member.mute`** (important):

```
Satori duration 是毫秒；OneBot set_group_ban 收秒。
seconds = duration <= 0 ? 0 : max(1, ceil(duration / 1000))
```

So `duration: 60000` → `duration: 60` (the test asserts `ms->s (60000->60)`);
`duration: 0` means unmute.

**Expressiveness limit of `guild.member.role.set`**:

```
role_id ∈ {"3","admin"} → set_group_admin { enable: true }
role_id ∈ {"4","owner"} 或其它 → set_group_admin { enable: false }   ← 降级为普通成员
```

> In other words, **QQ's "transfer group ownership" cannot be expressed through this method**: passing
> `role_id: "4"` is treated as **revoking administrator**. Setting `role_id: "3"` is the only meaningful call
> (the test asserts `role.set -> enable:true`).

### 4.6 Guild roles

#### `guild.role.list`

| Item | Value |
| --- | --- |
| Parameters | `guild_id` **✔** (only validated as > 0) |
| Returns | **Static** 3 entries, **no network access** |

```json
{ "data": [
  { "id": "4", "name": "owner",  "position": 3 },
  { "id": "3", "name": "admin",  "position": 2 },
  { "id": "2", "name": "member", "position": 1 }
] }
```

> The test asserts `guild.role.list -> 3 static roles`.

### 4.7 Reactions

| Method | Forwards to | Parameters | Returns |
| --- | --- | --- | --- |
| `reaction.create` | `set_msg_emoji_like` (`set:true`) | `message_id` **✔**, `emoji_id` **✔** | `null` |
| `reaction.delete` | `set_msg_emoji_like` (`set:false`) | `message_id` **✔**, `emoji_id` **✔** | `null` |
| `reaction.list` | `get_emoji_likes` | `message_id` **✔**, `emoji_id` **✔** | `{data:[User]}` |

- `emoji_id` is an **emoji ID string** (such as `"128077"` for 👍) and is validated as non-empty;
- `reaction.list` returns the **list of users who reacted with that emoji** (`User[]`),
  where each `User`'s `id` comes from `emoji_like_list[].user_id`;
- All three **require `emoji_id`** and work even when `channel_id` is not provided
  (`satoriMethodParams` only uses it for parsing on these three methods and does not require a channel).

### 4.8 Users and friends

| Method | Forwards to | Parameters | Returns |
| --- | --- | --- | --- |
| `user.get` | `get_stranger_info` | `user_id` **✔** | `User` |
| `friend.list` | `get_friend_list` | None | `{data:[{user, nick}]}` |
| `friend.delete` | `delete_friend` | `user_id` **✔** | `null` |
| `friend.approve` | `set_friend_add_request` | `message_id` **✔** (=flag), `approve` | `null` |

- Each `friend.list` entry is `{user: User, nick: remark}`; `user.name` takes `nickname ?? remark`,
  and `nick` takes `remark`;
- `friend.approve`'s `message_id` is the **friend request flag**
  (from the `friend-request` event's `message.id`), and `approve` defaults to true.

---

## 5. Event list

### 5.1 The 12 supported event types

`satoriConvertOneBotEvent` and its branches produce **12** Satori event types:

| Satori event | Trigger (OneBot) | Asserted by the protocol suite |
| --- | --- | --- |
| `message-created` | `message` / `message_sent` | ✅ |
| `message-deleted` | `notice: group_recall` / `friend_recall` | ✅ |
| `guild-member-added` | `notice: group_increase` | ✅ |
| `guild-member-updated` | `notice: group_card` / `group_admin` | ⚠️ Not asserted (my live run confirms ✅) |
| `guild-member-removed` | `notice: group_decrease` | ✅ |
| `guild-member-request` | `request: group` + `sub_type != invite` | ✅ |
| `guild-request` | `request: group` + `sub_type: invite` | ✅ |
| `friend-request` | `request: friend` | ✅ |
| `reaction-added` | `notice: group_msg_emoji_like` (not `remove`) | ✅ |
| `reaction-removed` | `notice: group_msg_emoji_like` + `sub_type: remove` | ✅ |
| `login-added` | `notice: bot_status` (not `offline`) | ⚠️ Not asserted (my live run confirms ✅) |
| `login-removed` | `notice: bot_status` + `sub_type: offline` | ✅ |

> **All 12 are implemented**, with the protocol suite asserting **10** of them; `guild-member-updated` and
> `login-added` are not asserted in the tests, but I confirmed with the same harness that they **are produced correctly**
> (`group_card -> guild-member-updated`, `bot_status online -> login-added`).
>
> ⚠️ **Events with no mapping are dropped rather than guessed at**: `meta_event` (including `heartbeat`),
> `notice: notify/poke`, `group_ban`, `essence`, `group_upload` and so on
> **produce no Satori event at all**. The test asserts `meta_event heartbeat -> no Satori event`.
> Source comment: *"Returns null for events with no Satori equivalent; those are dropped
> rather than guessed at."*

### 5.2 Event envelope

Each event is a frame `{op: 0, body: {...}}`, with a `body` shaped like:

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

| Field | Description |
| --- | --- |
| `id` / `sn` | **The same incrementing counter** (`eventSeq`), +1 per event |
| `timestamp` | **Milliseconds** (`Date.now()`) |
| `login` | Non-login events carry only `sn`/`adapter`/`platform`/`user` (**no `status`/`features`**) |
| `type` | See §5.1 |
| The rest | Fields after resource promotion |

> `sn` is an **adapter-level global counter** shared across all connections — not per-connection numbering.
> For login events (`login-added`/`login-removed`) the `login` is a **complete object**,
> carrying `status` (`1`/`0`) and all `features`.

### 5.3 ⭐ Resource promotion rules (required by the Satori spec)

Satori specifies that **nested resources must be promoted to the event's top level, and `message` must no longer
retain them.** The spec, verbatim:

> 当资源对象出现多级嵌套时，内层的资源将会被统一提升到最外层。例如，当接收到消息事件时，
> 事件体中可以访问到 `message`, `member`, `user`, `channel` 等资源，
> 但 `message` 中就不再存在 `member` 和 `user` 字段了。

This implementation does it through `satoriPromoteResources()`: it **moves `message.user` /
`message.member` / `message.channel` / `message.guild` to the top level of `body` and `delete`s
them from `message`**.

**An actual `message-created` frame** (trimmed):

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

The test asserts:

- `EVENT promotes channel/guild/user/member` ✅
- `EVENT message stripped of user/member/channel/guild` ✅
- `EVENT channel.id = group_id` ✅

> ⚠️ **One deviation from the strict rule**: the payloads of `message-deleted` and `reaction-added` /
> `reaction-removed` are **hand-built** (they do not go through `satoriPromoteResources`),
> so their `message` **still carries a nested `channel`** while a `channel` also exists at the top level:

```json
{ "message": { "id": "777", "channel": { "id": "20001", "type": 0 } },
  "channel": { "id": "20001", "type": 0 } }
```

> This is **redundancy rather than omission**, and SDKs can just read the top level; but if your code strictly
> validates that "`message` must not contain `channel`", you need to relax it. The other resources
> (`guild`/`user`/`member`/`operator`) are all at the top level.

### 5.4 Private chat events

A private `message-created` **has no `guild` and no `member`** (QQ private chats have no group semantics),
and `channel` is `private:<uin>` with `type: 1`:

```json
{ "type": "message-created",
  "message": { "id": "778", "content": "dm", "created_at": 1700000001000 },
  "user": { "id": "30003", "name": "某人", "nick": "某人" },
  "channel": { "id": "private:30003", "type": 1 } }
```

### 5.5 Event payload quick reference

| Event | Top-level resources |
| --- | --- |
| `message-created` | `message`, `user`, `channel`, `guild` (group chat), `member` (group chat) |
| `message-deleted` | `message`, `channel`, `user`, `guild` (group recall), `operator` (when the operator ≠ the sender) |
| `guild-member-added` / `-removed` | `guild`, `channel`, `user`, `member`, `operator` (if any) |
| `guild-member-updated` | `guild`, `channel`, `user`, `member` (with `roles` for `group_admin`) |
| `guild-request` / `guild-member-request` | `guild`, `channel`, `user`, `member`, `message` (`id`=flag, `content`=reason), `operator` |
| `friend-request` | `user`, `message` (`id`=flag, `content`=verification message) |
| `reaction-added` / `-removed` | `guild`, `channel`, `message`, `user`, `operator`, `emoji` |
| `login-added` / `login-removed` | `login` (complete, with `status` + `features`) |

**How to get the request flag** (needed when approving):

```
guild-request        → body.message.id  → guild.approve        { message_id }
guild-member-request → body.message.id  → guild.member.approve { message_id }
friend-request       → body.message.id  → friend.approve       { message_id }
```

**How to get the emoji ID**: the `emoji.id` of a `reaction-*` event, passed back as the `emoji_id`
of `reaction.create` / `.delete` / `.list`.

---

## 6. WebSocket protocol

### 6.1 Opcodes

| Name | Value | Direction | This implementation |
| --- | --- | --- | --- |
| `EVENT` | `0` | Server → client | ✅ Pushes events |
| `PING` | `1` | **Client → server** | ✅ Replies `PONG` on receipt |
| `PONG` | `2` | Server → client | ✅ Reply only |
| `IDENTIFY` | `3` | Client → server | ✅ Authentication |
| `READY` | `4` | Server → client | ✅ Authentication succeeded |
| `META` | `5` | Server → client | ❌ **Not implemented** (the constant is declared but never sent) |

> ⚠️ **The server never sends `PING` proactively.** In the spec, "send PING every 10 s" is the **application (client)**'s
> responsibility; this implementation only **responds passively**: receiving `op:1` → replying `{op:2, body:{}}`
> (the test asserts `PING -> PONG`). Any other unknown opcode merely logs a debug line and **does not close the connection**.

### 6.2 Connection flow

```
1. 客户端连接 ws://host:port/v1/events          （路径不符 → HTTP 404 拒绝升级）
2. 客户端在 10 秒内发送 IDENTIFY：{ op:3, body:{ token, sn? } }
3. 服务端校验 token：
     失败 → close(4004, "invalid token")
     成功 → 回 READY：{ op:4, body:{ logins:[Login], proxy_urls:[] } }
4. 之后服务端持续推 EVENT：{ op:0, body:{...事件...} }
5. 客户端每 10s 发 PING，服务端回 PONG（可选）
```

**An actual READY frame**:

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

- `proxy_urls` is **always an empty array** (this implementation has no proxy routing);
- `logins` is always an array of length 1 (single account);
- When `get_login_info` fails it falls back to `ctx.uin` and still returns READY normally.

### 6.3 Error handling and close codes

| Close code | Reason | Trigger |
| --- | --- | --- |
| **`4004`** | `invalid token` | IDENTIFY's `body.token` does not match the configuration |
| **`4000`** | `invalid message` | The frame is not valid JSON, or not an object (invalid frame) |
| **`4000`** | `IDENTIFY timeout` | **No IDENTIFY within 10 seconds** of connecting |
| `1008` | `access token changed` | A hot reload rotated the token, so the old client is disconnected |
| `1012` | `server closing` | A connection that has **not yet completed IDENTIFY** when disabled |
| `1001` | `server closing` | `close()` / `forceClose()` closing all connections |

The tests assert: `bad IDENTIFY token -> close 4004`, `invalid frame JSON -> close 4000`.

> I also confirmed with a separate harness: when IDENTIFY is not sent, **about 10 seconds later
> `close(4000, "IDENTIFY timeout")` is received**, and the connection is removed from the registry.

### 6.4 `sn` session resumption (⚠️ no buffered replay)

- `IDENTIFY.body.sn` is **accepted and recorded** in that connection's `lastSn`;
- But there is **no event buffering or replay logic at all** — in the source, `lastSn` is **never read again** after assignment.
- Consequently, **after a reconnect, events from the disconnected period are lost permanently** and are not re-sent.

> For reliable history backfill, use HTTP's `message.list` to fetch actively instead.
> The spec's session-resumption semantics (*replaying buffered events after sn*) **do not hold** in this implementation; do not rely on them.

### 6.5 ⚠️ Events are pushed before IDENTIFY (security-relevant)

`acceptConnection()` registers the connection in `this.connections` **immediately**,
and `onEvent()`'s broadcast condition **only checks the connection count, not `identified`**:

```js
onEvent(event, _payload) {
  if (!this.isEnabled || this.connections.size === 0) return;
  ...
  for (const connection of this.connections.values()) safeSend(connection.socket, frame);
}
```

**Confirmed by live testing**: even with an `accessToken` configured, a connection that **carries no credentials and
has sent no IDENTIFY** still receives complete `EVENT` frames (including message content) **within the 10-second window**
after connecting; only after 10 seconds is it kicked by `close(4000)`. The reason is that **`authorizeUpgrade()` is not
called during the upgrade phase** — the method **is defined on the adapter but is never called by `startServer()`**
(compare: in `ws-server-connections.ts` it really is used).

> **Impact**: an unauthenticated party can briefly eavesdrop on the event stream (up to 10 seconds per connection).
> **Mitigation**: bind the Satori listener to a **trusted network/loopback address**, or authenticate at a fronting
> reverse proxy; do not expose it directly to the internet. This is a known defect and is recorded honestly in §9.

---

## 7. Resource mapping (QQ semantics → Satori)

### 7.1 Mapping table

| Satori | Haizakura / QQ |
| --- | --- |
| `Guild.id` | `group_id` |
| `Guild.name` | Group name (`group_name`, falling back to `group_remark`) |
| `Guild.avatar` | `https://p.qlogo.cn/gh/{group_id}/{group_id}/640` |
| `Channel.id` | Group chat = `group_id`; private chat = **`private:<uin>`** |
| `Channel.type` | `0` = TEXT (group chat) / `1` = DIRECT (private chat) |
| `Channel.name` | Group chat = group name; private chat = stranger nickname |
| `User.id` | The QQ number as a **string** |
| `User.name` / `User.nick` | In a **group context**, `card` (group card) takes priority, else `nickname`; for **private chat / `user.get` / `login.get`**, `nickname` (see the note below) |
| `User.avatar` | `http://q.qlogo.cn/headimg_dl?dst_uin={uin}&spec=640` |
| `User.is_bot` | Inferred from QQ number ranges (see §7.3) |
| `GuildMember.user` | Same as `User` |
| `GuildMember.nick` | `card \|\| nickname` |
| `GuildMember.joined_at` | `join_time` (seconds) × 1000 → **milliseconds** |
| `GuildMember.roles` | `owner=4` / `admin=3` / `member=2` (always 1 entry) |
| `Message.id` | `message_id` (**integer → string**) |
| `Message.content` | OneBot segments encoded as a Satori element string (§8) |
| `Message.created_at` | **Millisecond** timestamp |

> **About the context of `User.name`** (source `satoriDecodeUser(uin, name)`):
> `name` and `nick` are **set together with the same value**, and when empty **neither field appears**. Which value is
> used depends on the call site:
>
> | Scenario | `name` passed in | Measured `name` |
> | --- | --- | --- |
> | `message-created` (group/private), `message.get`, `guild.member.get`/`.list` | `card \|\| nickname` | `"群名片"` |
> | `user.get`, `login.get`, `channel.get` (private), `reaction.list` | `nickname` only | `"陌生人昵称"` |
> | `friend.list` | `nickname ?? remark` (plus `nick` = `remark`) | `"好友昵称"` |
> | **All `notice` / `request` events** (`message-deleted`, `guild-member-*`, `guild-request`, `friend-request`, `reaction-*`) | **Not passed** (single-argument call) | **The `name` field does not exist** |
>
> So the same user **has a name in group messages but no `name` in notice/request events** — this is normal behavior.
> When you need a nickname in a notice event, look it up with `user.get` by `user.id`, or simply rely on `user.id`.

### 7.2 ⚠️ Timestamps are in milliseconds

**This is a convention that is easy to get wrong, so read carefully:**

| Scenario | Unit | Source |
| --- | --- | --- |
| Event `Message.created_at` | **Milliseconds** | `satoriToInt(event.time) * 1000` |
| `created_at` returned by `message.create` | **Milliseconds** | `Date.now()` |
| Event envelope `timestamp` | **Milliseconds** | `Date.now()` |
| `GuildMember.joined_at` | **Milliseconds** | `satoriToInt(row.join_time) * 1000` |
| `guild.member.mute`'s `duration` | **Milliseconds** (converted to seconds before sending) | `ceil(duration / 1000)` |

OneBot's `event.time` is in **seconds**, and this implementation **multiplies by 1000** to produce Satori's milliseconds.
That decision was made **against the LLBot implementation** (`+msgTime * 1000`), and the tests assert:

- `wire is snake_case: created_at in ms` → `created_at === 1700000000000` ✅
- `message.create created_at is ms` → `> 1e12` ✅
- `member joined_at is ms` → `1600000000000` ✅

> A useful trick: **13 digits means milliseconds, 10 digits means seconds**. Timestamps above `1e12` are milliseconds.

### 7.3 Determining `is_bot`

QQ does not tell the client directly "this is a bot", so this implementation infers it from **known bot number ranges**
(source `SATORI_BOT_UIN_RANGES`):

| Range start | Range end |
| --- | --- |
| `3328144510` | `3328144510` |
| `2854196301` | `2854216399` |
| `66600000` | `66600000` |
| `3889000000` | `3889999999` |
| `4010000000` | `4019999999` |

Outside those ranges → `is_bot: false` (the test asserts `is_bot === false` for an ordinary user).

### 7.4 ⚠️ Wire fields are snake_case

All field names are **snake_case on the wire**: `is_bot`, `created_at`, `joined_at`,
`user_id`, `channel_id`, `guild_id`, `emoji_id`, `proxy_urls`, `role_id`,
`parent_id`, `reply_to`, …

**No camelCase version exists.** The tests assert explicitly:

- `wire is snake_case: is_bot` → `is_bot === false && !("isBot" in user)` ✅
- `wire has no camelCase createdAt` → `!("createdAt" in message)` ✅

---

## 8. Message elements

Satori encodes messages as **XML-style element strings** (not OneBot's segment arrays),
for example `你好 <at id="30003"/> <emoji id="1"/>`.

### 8.1 Receive direction (QQ → Satori)

OneBot segments are encoded into element strings (source `satoriEncodeSegments`):

| OneBot segment | Satori element | Notes |
| --- | --- | --- |
| `text` | Escaped plain text | `& < > "` are escaped |
| `at` | `<at id="..."/>` | `qq == "all"` → `<at type="all"/>` |
| `face` | `<emoji id="..." name="..."/>` | |
| `mface` | `<emoji id="..." name="..."/>` | Takes `emoji_id` / `summary` |
| `image` / `flash_file` | `<img src="..." title="..."/>` | |
| `record` | `<audio src="..."/>` | |
| `video` | `<video src="..." poster="..."/>` | `thumb` → `poster` |
| `file` | `<file src="..." title="..."/>` | `name` → `title` |
| `reply` | `<quote id="..."/>` | |
| `forward` | `<message id="..." forward/>` | Merged forward |
| `json` / `xml` | The escaped original text | The card structure is not preserved |
| `poke` | Plain text `[戳一戳]` | |
| Any other unknown segment | `data.text` if present, otherwise dropped | |

- Empty attributes are **omitted** (`satoriAttr` skips `undefined`/`null`/empty strings);
- Non-object elements in the segment array are skipped;
- When `message` is not an array it is escaped as a whole string.

### 8.2 Send direction (Satori → QQ)

Satori element strings are parsed into OneBot segments (source `satoriParseFragment` + `satoriNodesToSegments`).

**Supported elements** (measured output):

| Satori element | OneBot segment | Measured |
| --- | --- | --- |
| Plain text | `text` | ✅ |
| `<br/>` | `text` `"\n"` | ✅ |
| `<p>…</p>` | A `"\n"` added before and after | ✅ |
| `<at id="1"/>` | `at` `{qq:"1"}` | ✅ |
| `<at type="all"/>` | `at` `{qq:"all"}` | ✅ |
| `<sharp id="9"/>` | `text` `"#9"` | ✅ Downgraded to text |
| `<emoji id="1"/>` / `<face>` | `face` `{id:"1"}` | ✅ |
| `<img src/>` / `<image>` | `image` `{file:src}` | ✅ |
| `<audio src/>` | `record` `{file:src}` | ✅ |
| `<video src poster/>` | `video` `{file:src, thumb:poster}` | ✅ |
| `<file src title/>` | `file` `{file:src, name:title}` | ✅ |
| `<quote id="42"/>` | `reply` `{id:"42"}` (child elements continue to expand) | ✅ |
| `<a href="…">text</a>` | `text` `"text ( href )"` | ✅ Downgraded to `text ( link )` |
| `<author/>` | **Ignored** (produces no segment) | ✅ |
| `<message>` | Expands child elements only | ⚠️ See below |
| Unknown element | **Drops the tag, keeps the inner text** | ✅ |

**Modifier element downgrade rule**: `b` / `strong` / `i` / `em` / `u` / `ins` / `s` / `del` /
`spl` / `code` / `sup` / `sub` are **all downgraded to plain text** (keeping the inner text, dropping the tag).
Measured `<b>bold</b>` → `[{type:"text",data:{text:"bold"}}]`.

**Escaping and tolerance**:

- HTML entity restoration is supported: `&lt; &gt; &quot; &apos; &amp;`, plus
  `&#65;` (decimal) and `&#x42;` (hexadecimal);
- **Unclosed tags are treated as text**: `<b>oops` → text `"oops"`;
- **A stray `>` is treated as text**: `a > b` → `"a > b"`;
- `<!-- 注释 -->` is skipped;
- Parsing is **deliberately lenient**, so malformed payloads do not turn into 500s.

**⚠️ Known send limitations** (measured):

| Input | Result |
| --- | --- |
| `<message id="1"/>` (top level) | **`400`** — no sendable segment can be parsed out |
| `<author id="1">x</author>` | **`400`** — `author` is ignored and there are no remaining segments |
| Comment only / empty string | **`400`** `content must contain at least one sendable element` |

> That is: **an empty segment list after parsing → 400** (empty text segments are filtered out too).
> Merged forwards (nested `<message forward>`) **have no send capability** in this implementation —
> `<message>` is only expanded as a transparent container, and its `id` attribute **is not** converted into a `forward`
> segment (compare the receive direction's `forward` → `<message .../>`; the two are **asymmetric**).

---

## 9. Known limitations (recorded honestly)

| # | Limitation | Detail |
| --- | --- | --- |
| 1 | **Pagination is an approximation** | `message.list`'s `next` uses "the id of this page's last message" and only appears when `rows ≥ limit`; `prev`/`direction` are unsupported. It is not the true cursor the protocol requires. |
| 2 | **`sn` session resumption has no buffered replay** | `IDENTIFY.body.sn` is recorded but **never used**; events during a disconnect are lost permanently (§6.4). |
| 3 | **Real WS frame send/receive was only verified on arm64** | This machine (x64) lacks the `ws` native addon (only arm64 binaries exist), so the protocol state machine is driven by a **socket double**. **The real handshake/framing is not covered** and needs re-verification on an arm64 host. |
| 4 | **Unimplemented APIs return 404** | This is a **spec requirement** (not a defect), but it means calling unlisted methods (such as `channel.update`, `channel.delete`, `channel.mute`, `user.channel.create`, `message.update`, `guild.member.role.create`, `interaction.*`) all yield 404. |
| 5 | **The `private:` channel convention follows LLBot** | Adopted for SDK ecosystem compatibility; not mandated by Satori. Be careful when switching implementations. |
| 6 | **`messageFormat` has no effect on Satori** | The adapter **does not read** that field — Satori always uses the element string `content`, with no "array/string" distinction. |
| 7 | **`reportSelfMessage` has no effect on Satori** | The adapter **does not read** that field. Even when set to `false`, `message_sent` (messages you sent yourself) **is still converted into `message-created` and pushed** (confirmed by my live run). |
| 8 | **No authentication during the upgrade phase; a 10-second event window exists** | A connection that has not IDENTIFY'd still receives events, and is only closed by `close(4000)` after 10 seconds; `authorizeUpgrade()` is defined but **never called** (§6.5). Do not expose it to the internet. |
| 9 | **`META` (op 5) is not implemented** | The constant is declared but the server never sends it; `proxy_urls` is always `[]`. |
| 10 | **The server does not send PING** | The heartbeat direction is **client → server**; the server only replies PONG passively. |
| 11 | **`message-deleted` / `reaction-*` are not strictly promoted** | These two payloads' `message` **still carries a `channel`** (also present at the top level), which is redundant (§5.3). |
| 12 | **`guild.member.role.set` cannot transfer group ownership** | `role_id: "4"`/`owner` is treated as **revoking administrator** (§4.5). |
| 13 | **`guild.member.mute` involves unit conversion and rounding** | Milliseconds → seconds, `ceil` with a 1-second floor; `0` means unmute. |
| 14 | **`<message>` cannot send merged forwards** | A top-level `<message>` only expands child elements and its `id` is ignored (§8.2). |
| 15 | **No default Satori listener** | A fresh installation does **not** create a Satori server automatically. In the source, `makeDefaultSatoriServer()` is defined but **never called** (dead code), and the default configuration's `wsServers` contains only `ws-default` with `path: "/"`. You must add the sentinel entry by hand. |
| 16 | **`satoriHttpStatusForResponse` is dead code** | That function could map OneBot's `1404` to `404` and `1400` to `400`, but it is **never called**; in practice all downstream failures uniformly return **`400`**. |
| 17 | **`User` in `notice`/`request` events carries no `name`/`nick`** | Only `message-created` and the `User` values returned by the APIs carry a name (§7.1 note). To get a nickname you must look it up with `user.get` by `user.id`. |

> **About item 3**: `README-satori-tests.md` says plainly —
> *"true wire-level WS handshake/framing is NOT covered here. Verify that on an arm64 host."*

---

## 10. Comparison with LLBot

| Item | LLBot | Haizakura |
| --- | --- | --- |
| **Access method** | A dedicated `satoriServers` configuration entry | **Reuses `wsServers[]` + a `path` sentinel** |
| **Platform identifier** | `llonebot` | `haizakura` |
| **API count** | **28 handlers** (29 `api__*.ts` files, including `api__index.ts`) | **24** |
| **Event types** | **11** (`guild-added` / `guild-removed` / `guild-request` / `guild-member-added` / `-removed` / `-request` / `message-created` / `-deleted` / `reaction-added` / `-removed` / `friend-request`) | **12** (see §5.1) |
| Configuration change | Requires editing `config.ts` (a new kind) | **Zero `config.ts` changes** (only 1 prototype method patched) |
| WebUI grouping | A separate Satori group | Placed under the "WS servers" group (the status label is still Satori) |
| Transport implementation | Hono + `@hono/node-server` + the official `ws` | `node:http` + a **self-built `WebSocketServer`** |
| Type conversion | `ts-case-convert`'s `ObjectToSnake` | Hand-written snake_case literals |
| Reference location | `reference/satori/*.ts` | `restored/packages/onebot/src/network/satori-*.ts` |

**API differences (precisely cross-checked)**: Haizakura's **24 are a strict subset of LLBot's 28**,
and the difference is **exactly 4** — LLBot has these 4 extra (unimplemented in Haizakura; calling them returns `404`):

```
channel.update        channel.delete        channel.mute
user.channel.create （创建私聊频道；LLBot 内部名 createDirectChannel）
```

> How this was checked: the method names on both sides were aligned one by one (`getChannel` → `channel.get`,
> `handleGuildRequest` → `guild.approve`, `setGuildMemberRole` → `guild.member.role.set`,
> `createDirectChannel` → `user.channel.create`, and so on, inferred from the import paths in `api__index.ts`);
> the set difference is exactly those 4, so **24 = 28 − 4** matches perfectly, and
> Haizakura has **no methods of its own that LLBot lacks**.
>
> Note: LLBot looks methods up in `Universal.Methods` (`app.post('/v1/:name')` in `server.ts`),
> so its **actual callable surface** depends on the intersection of the `handlers` function names and the protocol method names.

> **The event sets are not identical** (11 vs 12, and not a containment relationship):
>
> - **LLBot-only**: `guild-added`, `guild-removed` (Haizakura has no corresponding events, so group creation/dissolution
>   produces no Satori event);
> - **Haizakura-only**: `guild-member-updated`, `login-added`, `login-removed`
>   (these three are not present in LLBot's `event__*.ts`).
>
> ⚠️ The handler counts and event names on the LLBot side in the table above come from **static analysis** of
> `reference/satori/api__index.ts` and `event__*.ts`, and were **not measured on a running LLBot instance**;
> all Haizakura-side figures come from the source and local live runs.

> Satori's `adapter` / `platform` fields identify the **platform type**, used by SDKs for differentiated handling.
> The two take different values (`llonebot` vs `haizakura`), so **application-side platform checks need corresponding adaptation**.

### 10.1 Coverage of the Satori spec

Taking the method names in this repository's captured spec pages (`reference/satori-spec/`) and diffing against this implementation:

**In the spec but not implemented here** (calling them returns `404`):

```
channel.create      channel.update      channel.delete      channel.mute
user.channel.create （创建私聊频道）      message.update
```

**Implemented here but not listed in the spec's resource pages** (platform extensions that SDKs can generally call):

```
login.get           guild.role.list     guild.member.role.set
reaction.create     reaction.delete     reaction.list
friend.list         friend.delete       friend.approve
```

> `*.md` entries like that are link noise from the captured pages and have been removed.
> The table above comes from a **static comparison** and was not exercised one by one on a real machine; for whether the
> spec has further uncaptured pages, refer to <https://satori.chat>.

---

## 11. Quick verification

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

**WebSocket event stream** (needs `websocat` or a Node script):

```bash
websocat ws://127.0.0.1:5600/v1/events
# 连上后立刻发送（10 秒内！）：
{"op":3,"body":{"token":"<your-token>"}}
# 预期收到：{"op":4,"body":{"logins":[...],"proxy_urls":[]}}
```

### Reproducing the test suites

```bash
cd restored
node scripts/build.mjs                          # 产出 dist/index.mjs
node scripts/tests/run-satori-tests.mjs         # 76 条协议/API 断言
node scripts/tests/run-satori-integration.mjs   # 22 条挂载/NetworkManager 断言
```

### Measured results (2026-11-13, local machine)

| Request | Result |
| --- | --- |
| `login.get` (correct headers + token) | `200`, `platform: "haizakura"`, 26 features |
| `login.get` (`Satori-Platform: qq`) | **`403`** `login not found` ✅ |
| `login.get` (no headers at all) | `200` (absence tolerated) |
| `message.get` (downstream action failure) | `400` `{"message":"unknown action"}` |
| `channel.update` (unimplemented) | **`404`** `method not found` ✅ |
| `GET /v1/login.get` | `405` + `Allow: POST` |
| `POST /v1/nonsense` | `404` `method not found` |
| WS: IDENTIFY with a wrong token | `close(4004)` |
| WS: invalid JSON frame | `close(4000)` |
| WS: no IDENTIFY for 10 seconds | `close(4000, "IDENTIFY timeout")` |
| WS: receiving events without IDENTIFY | ⚠️ **It did receive them** (the 10-second window; see §9 item 8) |

---

## 12. Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| No Satori group in the WebUI | By design; it reuses `wsServers[]` | Look under the "WS servers" group; **the status label is Satori** |
| Configured `path: "/v1/events"` but it behaves like OneBot | The sentinel spelling is off (an extra prefix, say) | `path` must be **exactly** `/v1/events` |
| OneBot WS suddenly changed behavior | **`/v1/events` was taken by OneBot** | Give OneBot a different `path` (such as `/`) |
| `403 login not found` | `Satori-Platform` was sent as something other than `haizakura` (such as `qq`), or `Satori-User-ID` is wrong | Correct the headers; use **`haizakura`** |
| `401 authorization required` | A token is configured but no `Authorization` was sent | Add `Authorization: Bearer <token>` |
| `404 method not found` | The method is not among the 24 whitelisted ones | See §4; this is spec behavior, not a fault |
| Expecting 501 for an unimplemented method | The spec requires 404 | Do not rely on 501 |
| The received event's `message` has no `user` | **Resource promotion**; read the top level | See §5.3 |
| Times look 1000× larger than expected | They **are** milliseconds | See §7.2 |
| Field names do not match (`isBot`) | The wire uses **snake_case** | See §7.4 |
| WS connects but nothing happens | No IDENTIFY within 10 seconds | Send `{op:3,body:{token}}` immediately |
| Events are missing after a reconnect | `sn` resumption has **no replay implemented** | Backfill history with `message.list` |
| Your own messages also arrive | `reportSelfMessage` **has no effect on Satori** | Filter application-side on `user.id == yourself` |
| `message.create` returns 400 | Parsing `content` yields no sendable element (empty string / comment only / top-level `<message>`) | Include at least one text or supported element |
| A member's `joined_at` is missing | When `join_time` ≤ 0 the field **is absent** | Normal optional-field semantics |
| Saving the configuration reports a token error | Non-loopback addresses require ≥ 16 characters and a non-guessable value | Use a random token or bind `127.0.0.1` |
| Saving the configuration reports `statusCommand must be an object` | `POST /api/config/:uin` requires the **complete** configuration | Use the complete shape from §2.2 |
| `channel.list` returns only 1 entry | QQ has **one channel per group** (`guild.plain`) | Expected |
| Transferring group ownership fails / administrator is revoked | `role.set` only expresses the administrator toggle | See §9 item 12 |

---

## 13. Declaration

| Item | Status |
| --- | --- |
| Sentinel recognition rule and match tolerance (trailing slash/query string) | **Verified**: source + harness runs (6 path forms) |
| Forwarding targets, parameters and return values of the 24 APIs | **Verified**: the `SATORI_API` table + individual live runs |
| Event types (12) and resource promotion | **Verified**: source + real frame dumps; 10 have test assertions |
| Status codes, auth header behavior and the 404/405 branches | **Verified**: source + 7 request kinds run live |
| WS opcodes, close codes and the 10 s IDENTIFY timeout | **Verified**: live runs via socket double |
| Element send/receive and downgrade rules | **Verified**: 22 send/receive cases run live |
| `reportSelfMessage` / `messageFormat` being ineffective | **Verified**: no references in the source + reproduced live |
| Events pushed before IDENTIFY | **Verified**: reproduced live (the 10-second window) |
| 98/98 tests passing | **Verified**: 76 + 22 run locally |
| Real WS handshake and framing | ⚠️ **Not verified** (x64 lacks the native addon; needs arm64 re-verification) |
| The example ports / group numbers / tokens in this document | Example values, **not** measured in your environment |

> Not measured: **real WebSocket frame-level send/receive** (handshake, masking, fragmentation) was not verified on this
> machine; the protocol state machine is partly covered through a socket double, and the conclusions come from reading the source plus live runs at both layers.
