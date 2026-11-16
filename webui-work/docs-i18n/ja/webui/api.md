# WebUI バックエンド API リファレンス

> [!WARNING]
> 本内容は完全に AI が執筆したものです。注意して確認してください。

> 本文は Haizakura（旧 SnowLuma）WebUI バックエンドの**すべての HTTP エンドポイント**、
> 認証要件、および機微な面のマーキングを列挙します。
>
> **データソース**：`packages/core/src/webui/server.ts`（メインルート、54 条の登録）、
> `storage-routes.ts`（3 条）、`update-routes.ts`（6 条、`/api/update` にマウント）、
> `static-frontend.ts`（静的フロントエンド、4 条）、
> `request-security.ts`（セッショントークンの抽出）、`auth.ts` / `totp.ts`（認証）。
>
> 本文の認証挙動はすべて**稼働中のインスタンスで実測**しています（2026-11-13）。

---

## 1. 概観

| 項目 | 数 |
| --- | --- |
| **`/api/*` エンドポイント総数** | **60** |
| ├ `server.ts` が登録する `/api/*` | 51 |
| ├ `storage-routes.ts` | 3（`/api/system/storage*`） |
| └ `update-routes.ts` | 6（`/api/update` にマウント） |
| `/api` 以外のエンドポイント | 4（`/robots.txt`、`/avatar/:uin`、`/ui-asset/background`、`/`） |
| 静的フロントエンドのルート | 4（`/`、`/index.html`、`/*` 静的、SPA フォールバック） |
| **ルート登録の合計** | **66** |

> 補足：`server.ts` の登録は合計 54 条で、うち 51 条が `/api/*`、
> 残り 3 条が `/robots.txt`、`/avatar/:uin`、`/ui-asset/background` です。
> これに `storage-routes.ts` の 3 条と `update-routes.ts` の 6 条を加えると、
> `/api/*` は合計 **60** 条になります。

### 1.1 グループ別ナビゲーション

| グループ | エンドポイント数 | 章 |
| --- | --- | --- |
| 認証とセッション | 10 | [§3](#3-认证与会话) |
| プロトコルとコンプライアンス | 2 | [§4](#4-协议与合规) |
| 状態と接続 | 6 | [§5](#5-状态与连接) |
| アカウントと OneBot 設定 | 2 | [§6](#6-账号与-onebot-配置) |
| ログとデバッグ | 14 | [§7](#7-日志与调试) |
| システムと設定 | 9 | [§8](#8-系统与设置) |
| 通知 | 4 | [§9](#9-通知) |
| グローバル設定とインターフェース | 7 | [§10](#10-全局配置与界面) |
| 更新 | 6 | [§11](#11-更新) |
| **合計** | **60** | |

---

## 2. 認証機構

### 2.1 グローバルミドルウェア

ソース `server.ts`：

```js
app.use("/api/*", async (c, next) => {
  const reqPath = c.req.path;
  if (reqPath === "/api/login" || reqPath === "/api/ui/public") return next();
  const token = extractWebuiSessionToken(c.req.raw);
  if (!token) return c.json({ status: "failed", message: "Unauthorized" }, 401);
  const info = sessionTokens.get(token);
  if (!info || Date.now() > info.expiresAt)
    return c.json({ status: "failed", message: "Token expired or invalid" }, 401);
  if (consentGatePending && !CONSENT_ALLOWLIST.has(reqPath))
    return c.json({ status: "failed", message: "请先阅读并同意用户协议与隐私政策",
                    consentRequired: true }, 403);
  if (info.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(reqPath))
    return c.json({ status: "failed", message: "请先修改密码",
                    mustChangePassword: true }, 403);
  ...
});
```

**要点は次のとおりです**：

- ゲートは `/api/*` にのみ作用します。**`/avatar/:uin` と `/ui-asset/background` はその対象外**で、
  それぞれ独立した処理を持ちます（§12 参照）。
- **ログイン不要**なのはこの 2 つのパスのみです：`/api/login`、`/api/ui/public`。

### 2.2 セッショントークンの 2 つの渡し方

ソース `request-security.ts`：

```js
function extractWebuiSessionToken(request) {
  const sessionToken = request.headers.get("x-snowluma-token");
  if (sessionToken !== null) return sessionToken;
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}
```

| 方式 | 記述 | 説明 |
| --- | --- | --- |
| カスタムヘッダー | `x-snowluma-token: <token>` | 優先的に読み取ります |
| Bearer | `Authorization: Bearer <token>` | 代替 |

> ⚠️ **トークンは Cookie では渡されません**。ログインレスポンスが設定する Cookie の名前は
> `snowluma_avatar_session`、`Path=/avatar` で、**`/avatar/:uin` 専用**であり、
> `/api/*` にはアクセスできません。`/api/*` を呼ぶには上記 2 つのヘッダーのいずれかを明示的に付ける必要があります。
>
> ✅ 実測：`x-snowluma-token` を付けて `/api/status` をリクエスト → `200`；
> 付けない → `401`。

### 2.3 トークンのライフサイクル

| 項目 | 値 | 由来 |
| --- | --- | --- |
| トークン形式 | `randomBytes(32).toString("hex")`（64 文字） | `server.ts` |
| 有効期間 | `TOKEN_TTL_MS = 1440 * 60 * 1000` = **24 時間** | `server.ts` |
| クリーンアップ | 60 秒ごとに期限切れトークンを走査 | `tokenJanitor` |
| パスワード変更 / TOTP 変更 | **他のすべてのセッションを失効**（`invalidateOtherSessions`） | `server.ts` |

### 2.4 ログインのレート制限

| 項目 | 値 |
| --- | --- |
| 最大試行回数 | `LOGIN_MAX_ATTEMPTS = 5` |
| ロック期間 | `LOGIN_LOCKOUT_MS = 900 * 1000`（**15 分**） |
| レート制限キー | クライアント IP（`trustProxy` が値に影響） |
| 上限超過時のレスポンス | `429` + `登录尝试过多，请 N 秒后重试` |

### 2.5 2 段階の追加ゲート

**① 同意ゲート** — `consentGatePending` が真のとき、ホワイトリスト以外は一律 `403`：

```
CONSENT_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

**② 強制パスワード変更ゲート** — トークンに `mustChangePassword` が付いているとき、ホワイトリスト以外は一律 `403`：

```
MUST_CHANGE_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/auth/check-strength",
  "/api/auth/change-password", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

レスポンスボディには `consentRequired: true` または `mustChangePassword: true` が付き、
フロントエンドはそれに応じて該当するフローへ遷移します。

> ✅ この 2 つのゲートは**実測で遭遇します**：初期パスワードを変更していない場合、多くの API が
> `403 mustChangePassword` を返します。

### 2.6 TOTP の実際の適用範囲 ⚠️

**TOTP はログイン時にのみ検証され、機微なエンドポイントの二要素検証ではありません。**

- ログインリクエストには `totp` または `recoveryCode` を含められます；
  TOTP を有効化済みで未提供の場合は `{ success: false, needsTotp: true }` を返します。
- **ログイン成功後は、セッショントークンで全エンドポイントにアクセスできます**。
  `/api/debug/invoke` のような高危険度のエンドポイントも含み、**TOTP は要求されません**。
- したがって **TOTP はログイン済みセッションの破壊半径を制限できません**。

> 🔴 **セキュリティ上の推奨**：WebUI を信頼できないネットワークに晒す場合、TOTP だけでは
> 機微なエンドポイントを保護するのに不十分です。実際の防御線は**ネットワーク層の分離**（リバースプロキシ + IP ホワイトリスト + TLS）
> であるべきで、アプリケーション層の TOTP に依存すべきではありません。
>
> ソースの `totpDisabledInDev()` は dev モードで TOTP 関連のエンドポイントを無効化します。

---

## 3. 認証とセッション

| メソッド | パス | 認証 | パラメータ | 返却 |
| --- | --- | --- | --- | --- |
| `POST` | `/api/login` | **ログイン不要** | `{ password, totp?, recoveryCode? }` | `{ success, token, mustChangePassword }` |
| `POST` | `/api/logout` | ログイン必要 | — | `{ success: true }` |
| `GET` | `/api/auth/state` | ログイン必要 | — | `{ mustChangePassword }` |
| `POST` | `/api/auth/check-strength` | ログイン必要 | `{ password }` | 強度評価の結果 |
| `POST` | `/api/auth/change-password` | ログイン必要 | `{ ... }` | 変更結果；**他のセッションを失効** |
| `GET` | `/api/auth/totp` | ログイン必要 | — | TOTP の状態 |
| `POST` | `/api/auth/totp/begin` | ログイン必要 | `{ issuer?, accountName? }` | 登録資格情報（secret / otpauth URL を含む） |
| `POST` | `/api/auth/totp/confirm` | ログイン必要 | `{ token/验证码 }` | 有効化の確認；**他のセッションを失効** |
| `POST` | `/api/auth/totp/disable` | ログイン必要 | — | TOTP を無効化 |
| `POST` | `/api/auth/totp/recovery-codes` | ログイン必要 | — | リカバリーコードを再生成 |

> 本節は合計 **10** 個のエンドポイントです。`POST /api/agreements/record-consent`
> は [§4 プロトコルとコンプライアンス](#4-协议与合规) に分類しています。

### 3.1 ログインレスポンス

**成功**：

```json
{ "success": true, "token": "<64位hex>", "mustChangePassword": false }
```

同時に Cookie を設定します（**`/avatar` 専用**）：

```
Set-Cookie: snowluma_avatar_session=<token>; Max-Age=86400;
            Path=/avatar; HttpOnly; SameSite=Strict
```

**TOTP が必要**：

```json
{ "success": false, "needsTotp": true }
```

**失敗**（`401`）：`{ "success": false, "message": "密码错误" }`
または `{ "success": false, "message": "验证码不正确" }`。

**レート制限**（`429`）：`{ "success": false, "message": "登录尝试过多，请 N 秒后重试" }`

### 3.2 `record-consent` のバージョン検証

`version` が現在のプロトコルバージョンと一致しない場合、`409` を返します：

```json
{ "success": false, "message": "协议版本已更新，请刷新后重新确认",
  "currentVersion": "<当前版本>" }
```

### 3.3 TOTP 登録フロー

1. `POST /api/auth/totp/begin` → secret / otpauth URL を取得
   （登録資格情報のキャッシュ **`TOTP_ENROLL_TTL_MS = 600000` ms = 10 分**）
2. 認証アプリに追加し、6 桁のコードを取得
3. `POST /api/auth/totp/confirm` に検証コードを送信して有効化を完了

TOTP issuer の既定値は **`Haizakura`**（`DEFAULT_TOTP_ISSUER`）。

---

## 4. プロトコルとコンプライアンス

| メソッド | パス | 認証 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/agreements` | ログイン必要（**両方のホワイトリスト内**） | 規約のテキストとバージョン |
| `POST` | `/api/agreements/record-consent` | ログイン必要（**両方のホワイトリスト内**） | §3.2 参照 |

> この 2 つのエンドポイントは `CONSENT_ALLOWLIST` と `MUST_CHANGE_ALLOWLIST` に含まれるため、
> 規約未同意 / パスワード未変更でも**アクセスできます** —— そうでなければデッドロックします。

---

## 5. 状態と接続

| メソッド | パス | パラメータ | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/status` | — | `{ status: "running" }` |
| `GET` | `/api/connections` | — | `{ list: [...] }` 各アカウントのアダプター状態 |
| `GET` | `/api/qq-list` | — | `{ list: [{ uin, nickname }] }` |
| `GET` | `/api/state/stream` | — | **SSE**、状態変更のプッシュ |
| `GET` | `/api/system` | — | ホストとランタイムの情報 |
| `GET` | `/api/update/check` | `force` | 更新チェックの結果 |

**`/api/status` の副作用**：**ついでに `/avatar` のセッション Cookie を更新します**
（ソース `setAvatarSessionCookie(c, c.get("sessionToken"), ...)`）。
フロントエンドが定期的に呼べば、アバターが利用可能な状態を維持できます。

**`/api/connections` の実測レスポンス**：

```json
{ "list": [ { "uin": "<uin>", "nickname": "HaizakuraBot",
  "adapters": [
    { "name": "http-default", "kind": "httpServer", "status": "ok", "detail": "监听中" },
    { "name": "ws-default", "kind": "wsServer", "status": "ok", "detail": "1 个客户端" }
  ],
  "databaseMigration": { "phase": "complete", "usable": true, "progress": 1 } } ] }
```

**`/api/state/stream`**：`stateBus` が未設定の場合は `503`
`state stream not configured` を返します。フレームは `{ kind: "ready" }` で始まり、
その後 `processes` / `qq-list` / 接続状態の変更をプッシュします（**50 ms のデバウンス**）。

**`/api/system`** は `hostname`、`platform`、`arch`、`release`、`distro`、
`uptime`、`processUptime`、`nodeVersion`、`cpu{ model, cores, loadAvg, perCore, average }`、
`memory{ total, free, used, usagePercent }`、
`runtime{ pid, lowIntegrity, rss, heapTotal, heapUsed, external, arrayBuffers }` を返します。

---

## 6. アカウントと OneBot 設定

| メソッド | パス | パラメータ | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/config/:uin` | — | `{ config }` 完全な OneBot 設定 |
| `POST` | `/api/config/:uin` | OneBot 設定オブジェクト | `{ success, saved, applied, ... }` |

**検証**：

- `:uin` は `UIN_REGEX = /^\d{5,10}$/` に一致する必要があり、そうでなければ `400 invalid uin`。
- リクエストボディは `assertValidOneBotConfig` で厳格に検証されます；不正な設定は即座に `400` となり、
  **ディスクに書き込まれません**。
- 保存後はアトミックに適用されます；失敗時は**直前の設定にロールバック**します。

> 🔴 **機微**：`GET /api/config/:uin` の返却には **`accessToken` の平文が含まれます**。
> 実測のレスポンスでは `http-default` と `ws-default` の token を直接確認できました。
> WebUI にアクセスできる者なら誰でも OneBot の接続資格情報を取得できます。

---

## 7. ログとデバッグ

本節は合計 **14** 個のエンドポイントです。

| メソッド | パス | パラメータ | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/logs` | `limit`（既定 300） | `{ list: [...] }` |
| `GET` | `/api/logs/export/trace` | — | 完全なチェーントレースファイル（添付ダウンロード） |
| `GET` | `/api/logs/level` | — | `{ level, levels }` |
| `POST` | `/api/logs/level` | `{ level }` | `{ level, levels }` |
| `GET` | `/api/logs/stream` | — | **SSE**、リアルタイムログ |
| `GET` | `/api/debug/actions` | — | `{ actions: [...], categories: [...] }` |
| `POST` | `/api/debug/invoke` | `{ uin, action, params }` | アクション実行の結果 |
| `POST` | `/api/debug/invoke-stream` | `{ uin, action, params }` | **SSE**、ストリーミングのアクション結果 |
| `POST` | `/api/debug/upload` | `filename`（query）+ 生の body | `{ status, path, size }` |
| `GET` | `/api/debug/stream` | — | **SSE**、全アカウントのイベントストリーム |
| `GET` | `/api/processes` | — | `{ list: [...] }` |
| `POST` | `/api/processes/:pid/load` \| `/unload` \| `/refresh` | — | `{ success, process }` |

### 7.1 🔴 `POST /api/debug/invoke` — リモート任意アクション実行（最重要）

```json
{ "uin": "<uin>", "action": "send_group_msg",
  "params": { "group_id": 20001, "message": "hi" } }
```

これはリクエストを**指定アカウントのアクションディスパッチャへ直接転送**します（ソース
`oneBotManager.getInstance(uin).invokeAction(action, params)`）。
**アクション単位のホワイトリストや権限チェックは一切行いません**。

結果：**WebUI にログインできる者 = ボットの身元で 222 個のアクションすべてを実行できる**、
以下に限りません：

| アクション | 影響 |
| --- | --- |
| `send_group_msg` / `send_private_msg` | ボットの身元で任意のグループ／友だちにメッセージを送信 |
| `set_group_kick` / `set_group_ban` | キック、ミュート |
| `set_group_leave` | グループ脱退 |
| `bot_exit` | **ボットプロセスを終了** |
| `set_restart` | 再起動（本実装は未対応を返します） |
| `send_packet` | **生の SSO パケット**を送信 |
| `upload_group_file` | 任意のファイルをグループにアップロード |
| `set_qq_profile` / `set_qq_avatar` | アカウント情報の変更 |

**強化の推奨（優先度順）**：

1. **WebUI を公網に晒さないでください**。既定では `127.0.0.1` にバインドされます。リモートアクセスが必要な場合は
   リバースプロキシの後ろに置き、送信元 IP を制限してください。
2. リバースプロキシ層で `/api/debug/*` に対する**パス単位の封鎖または IP ホワイトリスト**を行ってください。
3. どうしても開放する必要がある場合は **TLS** を有効化し、強力なパスワード + TOTP を使用してください。
   （注意：TOTP はログイン時にのみ検証されます。§2.6 参照。）
4. 監査：各呼び出しは
   `traceAuthenticatedWebuiMutation` を通るため、ログで追跡できます。
5. 長期的な方針：このエンドポイントに独立した二次確認やスイッチを追加してください。

**検証の挙動**：

| 状況 | レスポンス |
| --- | --- |
| body が不正な JSON | `400` `请求格式错误` |
| `uin` が `/^\d{5,10}$/` に一致しない | `400` `无效的账号` |
| `action` の欠落／文字列でない | `400` `action 必填` |
| `params` がオブジェクトでない（配列/null） | `400` `params 必须是对象` |
| アカウントがオンラインでない | `404` `账号不在线` |

### 7.2 その他の機微なデバッグエンドポイント

| エンドポイント | リスク |
| --- | --- |
| `POST /api/debug/invoke-stream` | `/api/debug/invoke` と同じ。ストリーミングアクションに対応 |
| `POST /api/debug/upload` | **サーバーのディスクにファイルを書き込む**（パスはサーバーが決め、任意指定はできません） |
| `GET /api/debug/stream` | **全アカウント**のリアルタイムイベントを漏洩（プライベートチャットの内容を含む） |
| `GET /api/logs/export/trace` | 機微な情報を含む完全なトレースをエクスポート |
| `POST /api/processes/:pid/load` \| `/unload` \| `/refresh` | 宿主 QQ プロセスに対する **hook のロード／アンロード**を実行；`:pid` は `1..4194304` の整数が必要 |

---

## 8. システムと設定

本節は合計 **9** 個のエンドポイントです（`/api/system` は [§5](#5-状态与连接)、
`/api/update/*` は [§11](#11-更新) に分類しています）。

| メソッド | パス | パラメータ | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/system/settings` | — | `{ settings, hasCert, envOverrides, listeningPort, restartRequiredToApply }` |
| `POST` | `/api/system/settings` | `{ webuiPort?, webuiHost?, tlsEnabled?, trustProxy? }` | `{ success, settings, restartRequiredToApply }` |
| `POST` | `/api/system/tls/cert` | `{ cert, key }`（PEM 文字列） | `{ success, restartRequiredToApply }` |
| `DELETE` | `/api/system/tls/cert` | — | `{ success }` |
| `GET` | `/api/system/backup/export` | `credentials=1` | バックアップ JSON（添付） |
| `POST` | `/api/system/backup/import` | バックアップ JSON | 復元結果 |
| `GET` | `/api/system/storage` | — | `{ settings, snapshot, lastCleanup }` |
| `POST` | `/api/system/storage/settings` | ストレージ設定 | `{ success, ... }` |
| `POST` | `/api/system/storage/cleanup` | クリーンアップ要求 | クリーンアップ結果 |

### 8.1 機微なエンドポイントの説明

| エンドポイント | リスク |
| --- | --- |
| `GET /api/system/backup/export?credentials=1` | 🔴 **資格情報を含む完全なバックアップをエクスポート**（アカウント token、TOTP secret など） |
| `POST /api/system/backup/import` | 🔴 **サーバー設定を上書き**；上限 **32 MiB**（`413`）、失敗時はトランザクションでロールバック |
| `POST /api/system/tls/cert` | 🔴 **TLS 秘密鍵をディスクに書き込む**（`config/key.pem`、権限 `0600`） |
| `DELETE /api/system/tls/cert` | 証明書を削除；TLS 有効時は拒否（`400 请先关闭 TLS 再删除证书`） |
| `POST /api/system/storage/cleanup` | 🔴 **ストレージファイルを削除**；リクエストには確認文字列が必要（全アカウントの場合は `清理全部账号`） |
| `POST /api/update/download` \| `/restart` | ダウンロードして**サービスを再起動** |
| `POST /api/system/settings` | 待ち受けアドレス／ポート、TLS、`trustProxy` の変更；**反映には再起動が必要** |

> ⚠️ `POST /api/system/settings` の `trustProxy` はログインのレート制限における IP 判定に影響します。
> ソースは明確に警告しています：`SNOWLUMA_WEBUI_TRUST_PROXY=1` が安全なのは、
> **リバースプロキシが**クライアントが自己設定した `X-Real-IP` / `X-Forwarded-For` を**除去する**場合のみで、
> そうでなければ攻撃者が IP を偽装してログインのレート制限を回避できます。

### 8.2 ストレージ設定とバックアップの境界

- `POST /api/system/storage/settings`：
  環境変数でロックされたフィールドは `409` + `lockedFields` を返します。
- バックアップインポートで宣言された長さが **32 MiB** を超える場合は即座に `413`。
- TLS 証明書は**正当な PEM の組**である必要があり、そうでなければ `400`。

---

## 9. 通知

| メソッド | パス | パラメータ | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/notifications/config` | — | `{ config }` |
| `POST` | `/api/notifications/config` | 通知設定 | `{ success, config }` |
| `GET` | `/api/notifications/recent` | `limit`（既定 100、上限 100） | `{ recent }` |
| `POST` | `/api/notifications/test` | `{ channelId }` | `{ success, status, message }` |

- 設定ボディの上限は **512 KiB**（`413`）。
- `test` で `channelId` が欠落 → `400`；チャンネルが存在しない → `404`。
- 通知サブシステムが利用不可 → `503`。

---

## 10. グローバル設定とインターフェース

本節は合計 **7** 個のエンドポイントです。

| メソッド | パス | 認証 | パラメータ | 返却 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/global-config` | ログイン必要 | — | `{ config }` |
| `POST` | `/api/global-config` | ログイン必要 | グローバル設定 | 保存結果（上限 512 KiB） |
| `GET` | `/api/ui` | ログイン必要 | — | `{ config }` |
| `GET` | `/api/ui/public` | **ログイン不要** | — | `{ appearance }` |
| `POST` | `/api/ui` | ログイン必要 | UI 設定 | `{ success, config }`（上限 256 KiB） |
| `POST` | `/api/ui/background` | ログイン必要 | multipart `file` | `{ success, config }` |
| `DELETE` | `/api/ui/background` | ログイン必要 | — | `{ success, config }` |

**`/api/ui/public` をログイン不要にした**設計意図：ログインページはテーマ（外観）を適用してからでないと描画できません。
公開されるのは外観関連のフィールドのみ（`publicAppearance()`）で、**機微な設定は含みません**。

**背景画像のアップロード**：

- 上限は **5 MiB**（`5242880`）；`content-length` が **6 MiB** を超える場合は事前に `413`。
- 受け付けるのは **PNG / JPEG / WebP** のみ（内容で判定する `sniffImageMime`）；
  それ以外の種類は `415 仅支持 PNG / JPEG / WebP 图片`。
- ファイルが欠落 → `400 缺少图片文件`。

---

## 11. 更新

マウントポイントは `/api/update`（ソース `app.route("/api/update", updateRoutes(...))`）。

| メソッド | 完全なパス | パラメータ | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/update/status` | — | 更新サービスの状態 |
| `GET` | `/api/update/sources` | — | `{ config }` |
| `POST` | `/api/update/sources` | ソース設定 | `{ config, saved, applied, online, errors, message }` |
| `POST` | `/api/update/sources/test` | ソース候補 | `{ results }` |
| `POST` | `/api/update/download` | `{ version }` | `202` 状態；`version` 欠落 → `400`；競合 → `409` |
| `POST` | `/api/update/restart` | — | `202` 状態；競合 → `409` |

> ほかに `GET /api/update/check?force=true` があります（`server.ts` に登録され、
> `update-routes.ts` の内部ではありません）。

---

## 12. 静的リソース

| メソッド | パス | 認証 | 説明 |
| --- | --- | --- | --- |
| `GET` | `/robots.txt` | なし | 常に `Disallow: /` を返します |
| `GET` | `/avatar/:uin` | **独立した検証** | QQ アバターのプロキシ（下記参照） |
| `GET` | `/ui-asset/background` | **なし** | 背景画像（未設定時は `404`） |
| `GET` | `/`、`/index.html` | なし | フロントエンドのエントリポイント |
| `GET` | `/*` | なし | 静的ファイル + SPA フォールバック |

### 12.1 `/avatar/:uin` の独立した認証

これは **`/api/*` ミドルウェアの適用範囲外**で、独自に
**`snowluma_avatar_session` Cookie** を検証します：

```js
const sessionToken = readAvatarSessionToken(c);
const session = sessionTokens.get(sessionToken);
if (!session || Date.now() > session.expiresAt) {
  if (sessionToken) sessionTokens.delete(sessionToken);
  return c.text("unauthorized", 401);
}
```

- Cookie は `POST /api/login` と `GET /api/status` が設定します。
- `:uin` は `/^\d{5,10}$/` に一致する必要があり、そうでなければ `400 invalid uin`。
- アバターのキャッシュは **720 時間（30 日）**；ブラウザキャッシュも同じく 30 日。
- 上流からの取得に失敗し古いキャッシュがある場合は古い画像を返します；キャッシュがなければ `502 avatar unavailable`。
- ✅ 実測：Cookie を付けない → `401`。

> ⚠️ Cookie は `/api/status` によって更新されます。フロントエンドが `/api/status` を呼ばない場合、
> アバターセッションは 24 時間後に失効する可能性があります。

### 12.2 `/ui-asset/background` は**認証なし**

```js
app.get("/ui-asset/background", (c) => {
  const asset = readBackgroundImage();
  if (!asset) return c.text("no background", 404);
  return new Response(new Uint8Array(asset.bytes), { headers: { ... } });
});
```

背景画像が未設定の場合は `404` を返します。**未認証の訪問者でも設定済みの背景画像を読み取れます**。
機微な画像を背景にしないでください。

### 12.3 SPA フォールバックのホワイトリスト

`static-frontend.ts` では、`index.html` へフォールバックする前に以下の前置を除外します：

```js
if (["/api/", "/avatar/", "/ui-asset/"].some((p) => c.req.path.startsWith(p)))
  return c.text("not found", 404);
```

つまり一致しなかった `/api/*` は `404 not found` を返し、HTML は返しません。

---

## 13. 共通のエラー約束

| HTTP | 場面 | レスポンスボディ |
| --- | --- | --- |
| `400` | パラメータ／JSON 形式のエラー | `{ success:false }` または `{ message }` |
| `401` | トークンなし / トークン失効 | `{ status:"failed", message:"Unauthorized" }` |
| `403` | 規約未同意 / パスワード未変更 | `{ status:"failed", consentRequired }` または `{ mustChangePassword }` |
| `404` | リソースが存在しない | `{ success:false, message }` |
| `409` | 状態の競合（プロトコルバージョン、設定のロック、更新の競合） | `{ success:false, message }` |
| `413` | リクエストボディが大きすぎる | `{ success:false, message }` |
| `415` | 未対応のメディアタイプ | `{ success:false, message }` |
| `429` | ログインのレート制限 | `{ success:false, message }` |
| `500` | サーバー側の異常 | `{ success:false, message }` |
| `502` | 上流（アバター取得）の失敗 | プレーンテキスト |
| `503` | サブシステムが利用不可 | `{ success:false, message }` |

> **レスポンスボディのスタイルが統一されていない点に注意**：認証層は
> `{ status:"failed", message }` を使い、業務層は主に
> `{ success:false, message }` を使います。クライアントは両方に対応する必要があります。

### 13.1 セキュリティレスポンスヘッダー

すべてのレスポンス（`app.use("*")`）に付加されます：

```
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex
```

ほかに `webuiSecurityHeaders` ミドルウェアが残りのセキュリティヘッダーを提供します。

---

## 14. セキュリティ上機微なエンドポイントのまとめ 🔴

リスクの高い順：

| エンドポイント | リスク | 緩和 |
| --- | --- | --- |
| `POST /api/debug/invoke` | **リモート任意アクション実行**（キック、メッセージ送信、生の SSO パケットを含む） | 公網での封鎖 / IP ホワイトリスト |
| `POST /api/debug/invoke-stream` | 同上、ストリーミング | 同上 |
| `GET /api/system/backup/export?credentials=1` | すべての資格情報をエクスポート | `credentials=1` を禁止 |
| `POST /api/system/backup/import` | すべての設定を上書き | 管理者に限定 |
| `POST /api/processes/:pid/load` \| `/unload` | 宿主プロセスの hook 操作 | IP ホワイトリスト |
| `POST /api/debug/upload` | サーバーのディスクにファイルを書き込む | `/api/debug/*` を封鎖 |
| `POST /api/system/tls/cert` | 秘密鍵を書き込む | 管理者に限定 |
| `GET /api/config/:uin` | **OneBot の `accessToken` 平文を漏洩** | 管理者に限定 |
| `POST /api/system/storage/cleanup` | ストレージデータを削除 | 確認文字列が必要 |
| `GET /api/debug/stream` | 全アカウントのイベントを漏洩（プライベートチャットを含む） | `/api/debug/*` を封鎖 |
| `GET /api/logs/export/trace` | 機微な情報を含むログをエクスポート | 管理者に限定 |
| `POST /api/update/download` \| `/restart` | ダウンロードして再起動 | 管理者に限定 |
| `GET /ui-asset/background` | 認証なしで背景画像を読み取る | 機微な画像を置かない |

**全体の推奨**：WebUI は既定で `127.0.0.1` を待ち受けます。リモートアクセスが必要な場合は、
**必ず**リバースプロキシの後ろに置き、同時に `/api/debug/*`、`/api/processes/*`
に対して送信元制限を行ってください；パスワード + TOTP を有効化するだけでは**不十分**です（§2.6）。

---

## 15. 宣言

| 項目 | 状態 |
| --- | --- |
| 66 条のルート登録とパス | **検証済み**：ソースから 1 条ずつ抽出 |
| `/api/*` 認証ミドルウェアのロジック | **検証済み**：`server.ts` |
| トークンの 2 つの渡し方（Cookie ではない） | **検証済み**：`request-security.ts` + 実機検証 |
| トークン 24h、ログインのレート制限 5 回 / 15 分 | **検証済み**：ソースの定数 |
| 2 段階ゲートのホワイトリスト | **検証済み**：ソースの定数集合 |
| **TOTP による二要素検証はなし** | **検証済み**：ソースに関連ミドルウェアがない |
| `/api/debug/invoke` にアクション単位の認証なし | **検証済み**：`invokeAction` を直接呼び出し |
| `/ui-asset/background` に認証なし | **検証済み**：ソース + 実測 `404`（未設定時） |
| `/avatar/:uin` は独立した Cookie を使用 | **検証済み**：ソース + 実測 `401` |
| 各エンドポイントのパラメータと返却形状 | **検証済み**：ソース；**1 つずつ実機で呼び出してはいません** |
| アップロードのサイズ上限（5/6/32/512/256 KiB/MiB） | **検証済み**：ソースの定数 |

> **未実測項目**：`/api/login`、`/api/status`、`/api/qq-list`、
> `/api/connections`、`/api/config/:uin`、`/api/debug/actions`、
> `/api/ui/public`、`/avatar/:uin`、`/api/logout`、`/api/debug/actions`（未認証）
> 以外のエンドポイントについては、**実際のレスポンス**を実機で呼び出して検証しておらず、パラメータと返却形状はソースの読解によるものです。
> 書き込み系のエンドポイント（バックアップのインポート、ストレージのクリーンアップ、更新のダウンロード、プロセスの hook）は**いずれも未実測**です。
> 本番で使用する前に、ご自身でテスト環境で検証してください。