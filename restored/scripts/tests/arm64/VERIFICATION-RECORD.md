# Satori 传输层 — arm64 真 socket 验证记录

**日期**: 2026-11-13
**主机**: 甲骨文 aarch64 (api.jingbing.top / 168.110.60.51), node v22.22.1
**目的**: 补上 x64 无法覆盖的最后一环 —— **真 WebSocket socket + 真 native 帧编解码**

## 被测产物

| 项 | 值 |
|---|---|
| bundle | `satori-transport-verify/dist/index.mjs` |
| sha256 | `9a86572e3dbdea1c5238a7ffc135b85520d416c8b6ebef9aaf3820db7045e6bb` |
| 大小 | 12398006 字节（base 12338442 + 2 Satori region） |
| hash 校验 | 本机 gz `376e6c69…` → 远端解压后 sha256 **完全一致** ✅ |

## native 产物（从生产容器只读取用，未修改容器）

| 项 | 值 |
|---|---|
| 路径（容器内） | `/app/runtime/native/websocket-linux-arm64.node` |
| 大小 | 150624 字节 |
| sha256 | `b705b7e2392a75cdde95a146f933a7d472b4c72709f35f707a0798f9fcdf9e19` |
| 取用方式 | `sudo docker cp`（只读；容器未重启/未修改） |
| 加载自检 | `process.dlopen` 成功；exports = `computeAcceptKey, sha1Base64, buildFrame, Parser` |

## 测试方法

`dist/index.mjs` 在 `//#region src/index.ts` 处截断（去掉 `main()` 入口）后追加测试驱动，
使 `SatoriServerAdapter` 与 mount patch 处于已初始化状态；客户端用**真 npm `ws`**，
并额外用 `node:net` 手工构造 **masked RFC6455 帧**验证 native Parser 解帧。

## 结果：24/24 通过

| # | 验证项 | 结果 |
|---|---|---|
| — | native addon 为真（非 dev stub） | PASS (arch=arm64) |
| ① | **真 WS 握手 → HTTP 101** | PASS |
| ① | `Sec-WebSocket-Accept` 与 native.computeAcceptKey 一致 | PASS |
| ② | IDENTIFY{token} → **READY(op=4)** | PASS |
| ② | READY.logins[0].user.id = "3254926145"；proxy_urls=[] | PASS |
| ③ | PING(1) → **PONG(op=2)** | PASS |
| ④ | onEvent → **EVENT(op=0)** 被真实客户端解析 | PASS |
| ④ | 资源提升（channel/guild/user 到顶层，message 内已剥离） | PASS |
| ④ | 线格式 snake_case：`is_bot`、`created_at`（毫秒） | PASS |
| ④ | 无 camelCase 残留（`createdAt`/`isBot` 不存在） | PASS |
| ⑤ | 错误 token → **close(4004)** | PASS |
| ⑥ | **native Parser 解开手工 masked 帧 → TEXT + READY(op=4)** | PASS |

## 原始帧证据

握手响应：
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: Am6XNjQAt8jeYCVZjq46wGFL3+g=
```

服务端首帧：RFC6455 frame opcode = 1 (TEXT)，payload 697 字节：
```json
{"op":4,"body":{"logins":[{"sn":1,"adapter":"haizakura","platform":"haizakura",
"user":{"id":"3254926145","avatar":"http://q.qlogo.cn/headimg_dl?dst_uin=3254926145&spec=640",
"is_bot":false,"name":"碧海","nick":"碧海"},"status":1,"features":[...26 项...]}],"proxy_urls":[]}}
```

## 生产容器安全确认（本次验证全程未触碰）

```
docker ps        → snowluma-hz  Up 3 hours
RestartCount=0   StartedAt=2026-11-13T01:02:24Z（未变）
/app/runtime/index.mjs md5 = bebdc7586f6e6586be80a85cc744ae5c（旧版，无 Satori，未覆盖）
/app/runtime/native/websocket-linux-arm64.node sha256 = b705b7e2…（未变）
```

> 本目录为**隔离测试目录**，与生产容器无任何写入关系。
