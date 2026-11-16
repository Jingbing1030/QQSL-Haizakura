# よくある質問（FAQ）

> [!WARNING]
> この内容はすべて AI が作成したものです。慎重に確認してください。

> 本文には 2 種類の内容が含まれます。**一般的な問題**（LLBot の FAQ 場面に対応）
> と、**私たちが実際に踏んだ落とし穴**（この部分は一般的な FAQ より価値があります）。

---

## 1. 一般的な問題

### 1.1 なぜローカルからしかアクセスできず、LAN / 公網から接続できないのか

**セキュリティ上の理由から、アプリケーションは既定で `127.0.0.1` のみを待ち受けます。**

【確証】ソースの既定値：

| 設定 | 既定値 | 位置 |
| --- | --- | --- |
| `webuiHost` | `127.0.0.1` | `common/src/runtime.ts:194` |
| `httpServers[].host` | `127.0.0.1` | `onebot/src/config.ts:42` |
| `wsServers[].host` | `127.0.0.1` | `onebot/src/config.ts:54` |

**しかしコンテナの場面は異なります**：Docker コンテナは独自のネットワーク名前空間を持ちます。
`127.0.0.1` だけを待ち受けると、**マッピングされたホスト側のポートへは永久に接続できません**。

そこでコンテナの entrypoint が一度シード処理を行います（`/root/start.sh`）：

```javascript
// 仅当 webuiHost 缺失或为空时
if (typeof runtimeConfig.webuiHost !== 'string' || !runtimeConfig.webuiHost.trim()) {
  runtimeConfig.webuiHost = '0.0.0.0';
}

// 把 host 是 loopback 的适配器改成对外 host
const bindPublishedHost = (adapter) => {
  if (!isLoopbackHost(adapter.host)) return false;
  adapter.host = onebotHost;   // SNOWLUMA_ONEBOT_HOST，默认 0.0.0.0
  return true;
};
```

**修正手順**：

| 目的 | 方法 |
| --- | --- |
| LAN / 公網から WebUI へアクセス | WebUI で待ち受けアドレスを `0.0.0.0` に変更する、または `runtime.json` の `webuiHost` を直接変更する |
| LAN / 公網から OneBot を呼び出す | アダプターの `host` を `0.0.0.0` に変更する |
| ローカルからのみアクセスしたい | `127.0.0.1` を維持し、SSH トンネルを使う |

> ⚠️ **公網へ露出する前に必ず 2 つのことを行ってください**：
> ① OneBot アダプターに**必ず強力なトークンを設定する**（ソース上、16 文字以上かつ弱い値は不可）
> ② WebUI は**リバースプロキシ + `trustProxy` の設定**を推奨します。
> なぜなら `/api/debug/invoke` は**任意のアクションの遠隔実行に等しい**からです。

**SSH トンネル案（最も安全）**：

```bash
ssh -L 5199:127.0.0.1:5199 -L 3010:127.0.0.1:3010 用户@服务器
# 然后本地访问 http://127.0.0.1:5199
```

---

### 1.2 WebUI のパスワードを忘れた場合は

WebUI の資格情報は `config/webui.json` にあります（【確証】`core/src/webui/auth.ts`）：

```json
{
  "passwordHash": "<128 位十六进制 scrypt 哈希>",
  "passwordSalt": "<32 位十六进制盐>",
  "mustChangePassword": false,
  "generatedAt": "...",
  "updatedAt": "..."
}
```

使われているのは **`scryptSync`**（`N=16384, r=8, p=1`、keylen 64）—— **ハッシュは不可逆です**。

**3 つの方法**：

| 方法 | 手順 | リスク |
| --- | --- | --- |
| **① 資格情報ファイルを削除してシステムに再生成させる** | コンテナ停止 → `config/webui.json` を削除 → 起動 → 案内フローで新しいパスワードを設定 | ⚠️ **再起動が必要 → QQ のログイン状態が失われる** |
| **② 初回起動時に環境変数を注入する** | `-e SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD='<强密码>'` を使う（**8 文字以上が必要**） | 初回のみ有効 |
| **③ ハッシュを直接書き換える** | 同じパラメーターで scrypt ハッシュを計算し、`passwordHash` を置き換える | `N=16384, r=8, p=1, keylen=64` を維持する必要がある |

**パスワード強度の要件**（【確証】`PASSWORD_RULES`、5 条すべてを満たして初めて強いと判定）：

| 規則 | 要件 |
| --- | --- |
| `length` | **10 文字以上** |
| `lower` | 小文字を含む |
| `upper` | 大文字を含む |
| `special` | 特殊記号を含む（`!@#$%…`） |
| `no-space` | 空白を含まない |

> 💡 `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` は **8 文字以上**のみを要求しますが、
> WebUI の強度チェックは **10 文字以上 + 4 種類の文字**を要求します。両者の基準は異なります。

> ⚠️ 関連する仕組みがもう 2 つあります：**TOTP 二段階認証**（`/api/auth/totp/*`、RFC 4226/6238）
> と**リカバリーコード**（`/api/auth/totp/recovery-codes`）。
> TOTP を有効にしていて、それも失った場合も同様に資格情報ファイルを削除する必要があります。
>
> ⚠️ `SNOWLUMA_DEV_MODE=1` を設定している場合、パスワード変更は直接エラーになります
> 「開発モード (SNOWLUMA_DEV_MODE=1) によりパスワード変更は無効化されています」。

---

### 1.3 画像 / 音声 / 動画を送れない

順に確認してください。

| 確認 | 説明 |
| --- | --- |
| ① ファイルの権限 | コンテナ内の `snowluma` ユーザー（uid は既定で 1000）が `/app/data` に対して**書き込み権限を持つ**必要があります |
| ② `SNOWLUMA_STREAM_DIR` | ストリーミングインターフェースの出力先ディレクトリ（既定 `$TMPDIR/onebot-stream`）。不正な値は警告のうえ既定へ戻されます |
| ③ ダウンロードサイズの上限 | `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` |
| ④ ダウンロードのタイムアウト | `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS`（既定 60000 ms） |
| ⑤ **動画アップロードの並列度** | `snowluma.json` の `videoUploadConcurrency`（1–4、既定 1） |
| ⑥ ディスク容量 | `docker exec haizakura df -h /app/data` |
| ⑦ ステータスコマンドでの確認 | まずステータスコマンドを送り、経路が通っていることを確認する |

> 💡 **Haizakura は FFmpeg を別途インストールする必要がありません**（LLBot とは異なります）——
> `native/ffmpeg/ffmpegAddon.linux.arm64.node` を同梱しています。

**権限の修正**：

```bash
docker exec haizakura ls -la /app/data
docker exec haizakura chown -R 1000:1000 /app/data
```

---

### 1.4 CQ コードを使いたい（配列形式ではなく）

**`messageFormat` を `"string"` に変更します**（【確証】`config.ts:747-749`、`"array"` または `"string"` のみ受け付け）：

```json
{
  "networks": {
    "wsServers": [
      {
        "name": "ws-default",
        "messageFormat": "string"
      }
    ]
  }
}
```

| 値 | 形式 |
| --- | --- |
| `"array"`（既定） | `[{"type":"text","data":{"text":"hi"}}]` |
| `"string"` | `"hi[Cat:face,id=1]"` |

> トップレベルにも `messageFormat` を書け、**すべてのアダプターの既定値**として機能します（旧レイアウトとの互換）。

---

### 1.5 Docker からホストへアクセスするには

**`127.0.0.1` を使わないでください** —— それはコンテナ自身を指します。

| プラットフォーム | ホストのアドレス |
| --- | --- |
| Linux | `172.17.0.1`（既定の bridge ゲートウェイ）または `--add-host=host.docker.internal:host-gateway` |
| Docker Desktop（Mac/Win） | `host.docker.internal` |

**推奨**（クロスプラットフォーム）：

```bash
docker run ... --add-host=host.docker.internal:host-gateway ...
```

その後、設定では `http://host.docker.internal:8080` を使います。

> ⚠️ **Mac 利用者への注意**：コミュニティの経験では **Docker Desktop ではなく OrbStack を使う**のがよく、
> そうしないと QQ が起動しないことがあります。これは LLBot コミュニティが踏んだ落とし穴で、
> Haizakura も同じ Electron QQ 系であるため**高い確率で同様に当てはまります**。

---

### 1.6 ログイン前にあらかじめ設定しておくには

**コンテナの entrypoint がすでにシード処理を行っています**（【確証】`/root/start.sh`）：

初回起動時（`onebot.json` が存在しない場合）、次が自動生成されます。

```json
{
  "networks": {
    "httpServers": [{ "name": "http-default", "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3000, "path": "/", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "wsServers":   [{ "name": "ws-default",   "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3001, "path": "/", "role": "Universal", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "httpClients": [], "wsClients": []
  }
}
```

**重要な設計**：**アダプターを削除したときだけ再構築されません** ——
`httpServers` が**存在する空の配列**であれば、entrypoint はそれを**戻しません**。

```javascript
// 首次启动（文件不存在）才给默认监听；
// 已存在的空列表 = 操作者主动删掉了，不要每次重建容器又塞回来
const ensureServers = (key, fallback) => {
  if (!Array.isArray(nets[key])) {
    if (!existed) { nets[key] = [fallback]; changed = true; }
    return;
  }
  if (nets[key].length === 0) return;   // ← 空数组 = 尊重操作者
  // 把 loopback 的 host 改成对外 host
};
```

**したがって事前設定したい場合**：コンテナを起動する**前に `onebot.json` をボリュームへ入れておく**か、
`docker cp` で入れてから起動してください。

> 💡 **LLBot 時代の概念を 1 つ修正します**：Haizakura には **`default_config.json` の継承機構はありません**。
> その等価物は**「グローバル `onebot.json` + アカウントごとの `onebot_<uin>.json` の overlay マージ」**です
> （[設定説明 §0.2](configuration.md) 参照）。
> `onebot_<uin>.json` に `"mode": "snapshot"` が書かれている場合にのみ、グローバルが無視されます。

---

### 1.7 ログファイルが大きくなり続ける / ログが突然書かれなくなる

### ログローテーションの仕組み

【確証】`log-file-transport.ts`：

| パラメーター | 既定 | 環境変数 |
| --- | ---: | --- |
| 単一ファイルの上限 | **50 MB** | `SNOWLUMA_LOG_MAX_MB` |
| 総量の上限 | **1024 MB** | `SNOWLUMA_LOG_MAX_TOTAL_MB`（`runtime.json` の `logMaxTotalMb` でも可） |
| 保持日数 | **7 日** | `SNOWLUMA_LOG_RETAIN_DAYS`（`logRetainDays`） |
| アカウント別ファイル | `false` | `SNOWLUMA_LOG_PER_UIN`（`logPerUin`） |

ファイル命名：

```
snowluma-YYYY-MM-DD.log          当天
snowluma-YYYY-MM-DD.N.log        滚动分片
snowluma-<uin>/...               按账号模式（目录名为纯数字）
```

### ⚠️ 落とし穴：クォータ超過後はログが「静かに破棄」される

これは**「プログラムが固まった」と誤判定されやすい落とし穴**です。

【確証】`LogQuota.reserve()`（`log-file-transport.ts:198-221`）：

```javascript
reserve(filePath, bytes) {
  if (bytes <= 0) return true;
  if (this.degraded && !this.retry(false)) {
    this.droppedLines += 1;     // ← 悄悄丢一行
    return false;
  }
  if (!this.ensureCapacity(bytes)) {
    this.droppedLines += 1;     // ← 悄悄丢一行
    return false;
  }
  ...
}
```

**挙動**：

| 状態 | 現れ方 |
| --- | --- |
| 健全 | 正常に書き込む |
| **クォータ超過 / ストレージ異常** | `degraded` 状態へ移行 → **ログ行が静かに破棄**され、`droppedLines` のカウントだけが増える |
| 再試行 | **5000 ms** ごと（`QUOTA_RETRY_MS`）に 1 回再試行 |

**症状**：ログファイルが増えなくなるが、プログラムは実際にはまだ動いている。
**誤判定のリスク**：「プロセスが落ちた」と思い込むが、実際は**ログが書き込めていない**だけ。

**確認方法**（【実測】`GET /api/system/storage` の返却構造）：

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:5199/api/system/storage
```

返却：

```jsonc
{
  "settings": {
    "saved":     { "logMaxTotalMb": 1024, "logRetainDays": 7, "logPerUin": false },
    "effective": { "logMaxTotalMb": 1024, "logRetainDays": 7, "logPerUin": false },
    "envOverrides": []            // ← 哪些项被环境变量覆盖了
  },
  "snapshot": {
    "logs": {
      "state": "healthy",         // ← healthy | warning | degraded
      "totalBytes": 313412,
      "fileCount": 1,
      "activeFileCount": 1,
      "droppedLines": 0,          // ← ★ 被静默丢弃的行数
      "maxTotalBytes": 1073741824,
      "retainDays": 7,
      "perUinEnabled": false
    },
    "temporary": { ... },
    "accounts": [ ... ],
    "totals": { "logsBytes": ..., "temporaryBytes": ..., "accountDataBytes": ..., "managedBytes": ... }
  },
  "lastCleanup": null
}
```

> 🔍 **2 つのフィールドを見れば十分**です：`snapshot.logs.state` と `snapshot.logs.droppedLines`。
> `droppedLines > 0` または `state != "healthy"` なら、**ログが破棄されている**ことを意味します。

**修正**：

| 手段 | コマンド / 位置 |
| --- | --- |
| WebUI でのクリーンアップ | `POST /api/system/storage/cleanup` |
| 保持期間を短くする | `logRetainDays` / `SNOWLUMA_LOG_RETAIN_DAYS` |
| 総量を大きくする | `logMaxTotalMb` / `SNOWLUMA_LOG_MAX_TOTAL_MB` |
| ファイルログを無効化 | `SNOWLUMA_LOG_FILE=0` |
| ファイルのレベルを下げる | `SNOWLUMA_LOG_FILE_LEVEL=warn` |

> ⚠️ **手動でログファイルを削除しても `degraded` のままのことがあります**：
> ソースにこの警告があります ——
> `managed logs still use N bytes after manual cleanup, exceeding the M byte limit`。
> これは**再集計してもなお上限を超えている**ことを示します（管理外のファイルが容量を占めている可能性があります）。

---

### 1.8 コンテナの `ExitCode 126` / `Operation not permitted`

**これはデプロイ段階で最もよくある失敗です。**

**症状**：

```
ExitCode = 126
日志: /root/start.sh: line 161: /usr/local/bin/node: Operation not permitted
```

**原因**：インジェクターは `ptrace` + `process_vm_writev` で QQ プロセスへアタッチする必要がありますが：

| 欠けているもの | 結果 |
| --- | --- |
| `--cap-add SYS_PTRACE` | **hook が入らない** |
| `--security-opt seccomp=unconfined` | **コンテナが起動しない**（既定の seccomp が `ptrace` を遮断する） |

**修正**：

```bash
docker run ... \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

**【実測】** この 2 項目を補ったところ**一発で起動に成功**しました。

> 📌 `--privileged` でも動作しますが、権限が過大で**推奨しません**。

---

### 1.9 hook が入らない / ログに `unresolved` がある

**hook の健全性を確認**：

```bash
docker exec haizakura grep -c unresolved /app/data/logs/*.log
```

| 結果 | 意味 |
| --- | --- |
| **`0`** | ✅ **hook は健全** |
| `>0` | ❌ RTTI チェーンの解析に失敗 |

**`unresolved` が意味するもの**：`.so` 内の「唯一の検証ゲート」を通っていません ——
**RTTI 構造のマッチング**（文字列マッチングではない）で `nt::MSFService` /
`nt::MSFCoreService` を探しに行き、失敗しています。

**よくある原因**：

| 原因 | 説明 | 対処 |
| --- | --- | --- |
| **QQ のバージョンが変わった** | `wrapper.node` の RTTI / vtable レイアウトが変わった | `dump-vtable.py` でベースラインを diff する。[開発への参加](../dev/contributing.md) 参照 |
| `SYS_PTRACE` の欠如 | 注入自体が成功していない | §1.8 参照 |
| zygote に注入された | §1.10 参照 | `SNOWLUMA_HOOK_AUTOLOAD_ALL` を確認 |
| カーネルが `ptrace` を禁止 | 強化カーネル（Yama 制限付きなど） | `kernel.yama.ptrace_scope` を確認 |

**QQ のバージョンがベースラインと一致するか確認**：

```bash
docker exec haizakura md5sum /app/runtime/../.config/... # 定位 wrapper.node
# 期望 md5: adeb40af26d859d41fcdb21bf38d9eb5
```

---

### 1.10 ⚠️ `SNOWLUMA_HOOK_AUTOLOAD_ALL` を軽率に有効にしないこと

**これはドキュメント中で最も警告が必要な項目です。**

通常の流れでは**Electron の zygote と子プロセスを除外**し、QQ のメインプロセスにのみ注入します。
`SNOWLUMA_HOOK_AUTOLOAD_ALL=1` は**このフィルタリングを迂回します**。

**【確証】結果**：

> zygote へ注入すると**zygote 内で hook の resolver スレッドが起動します**。
> その後 Electron が fork する**すべての renderer がそのスレッドと半初期化の hook 状態を継承**し、
> **QQ の IPC とログイン画面を直接壊します**。

**症状**：QQ の画面が異常になる、ログインできない、さまざまな不可解な問題。

**どういうときだけ使うか**：**「なぜメインプロセスに注入されないのか」を調査するときに一時的に有効化**し、
使い終わったら即座に無効化して再起動してください。

---

## 2. ⭐ 私たちが実際に踏んだ落とし穴

> これらは**代償と引き換えに得た経験**であり、一般的な FAQ より価値があります。すべて読むことを推奨します。

### 落とし穴 1：🔴 コンテナの再起動で QQ のログイン状態が失われる（最も痛い）

**これは本プロジェクト最大の運用上の罠です。**

| 項目 | 説明 |
| --- | --- |
| **現象** | コンテナ再起動後、QQ は**再度 QR コードログイン**が必要 |
| **原因** | `/app/.config/QQ/auth/login.enc` の `loginList` が空にされる |
| **代償** | **私たちはこれにより本番 bot を 8 時間停止させました** |
| **なぜ痛いか** | QR コードの読み取りに**人手が必要**（noVNC を開いてスマートフォンで読み取る） |

**障害の連鎖**：

```
重启容器 → 登录态丢失 → Haizakura 拿不到 MSF 会话
        → 所有动作返回 "not logged in" → ⛔ bot 完全不可用
```

**結論**：

| 原則 | 方法 |
| --- | --- |
| **不要なら再起動しない** | 設定変更は**WebUI / API のホットリロードを優先** |
| 再起動が必要なとき | **QR コードを読み取れる人がいる時間帯を確保** |
| 再起動の前 | 手元にスマートフォンの QQ があることを確認 |
| 現実を受け入れる | 「再起動には再 QR コードログインが必要」を**既定の事実**として対策を設計する |

**どの操作がホットリロードされるか（ログイン状態を失わない）**：

| 変更 | ホットリロード |
| --- | --- |
| OneBot ネットワーク設定 | ✅ |
| `statusCommand` | ✅ |
| `notifications` | ✅ |
| ログレベル | ✅ |
| hook のロード / アンロード | ✅ |
| **`historySync.enabled`** | ❌ 起動時のみ読み込み |
| **環境変数 / コード** | ❌ コンテナの再作成が必要 |

詳しくは [設定説明 §11](configuration.md) を参照してください。

---

### 落とし穴 2：noVNC が HSTS によって https へ強制昇格される

| 項目 | 説明 |
| --- | --- |
| **現象** | `http://<IP>:6181` が開けず、ブラウザーが自動的に https へ飛ぶ |
| **原因** | ブラウザーの **HSTS** ポリシーがそのアドレスを https へ強制昇格させるが、noVNC は純粋な http |
| **修正** | ① **IP のみ**を使う（ドメイン名は使わない） ② ブラウザーを変える ③ その IP の HSTS 記録を消す |

**Chrome で HSTS を消す**：`chrome://net-internals/#hsts` → Delete domain security policies。

---

### 落とし穴 3：`#hz` などの設定を変えても「効かない」

**2 つの層の原因があり、どちらも確認が必要です。**

**原因 A：設定の優先順位 / `mode` の問題**

【確証】`onebot_<uin>.json` に `"mode": "snapshot"` が書かれていると、
**グローバルの `onebot.json` はそれに対して完全に無効**になります。

```
onebot.json（全局）
      ↓ 仅在非 snapshot 时叠加
onebot_<uin>.json（每账号）
```

| あなたが変えたかもしれないもの | しかし実際に効いているもの |
| --- | --- |
| グローバル `onebot.json` の `statusCommand` | ⚠️ **per-uin の値に上書きされる**（下記参照）—— 「グローバルが非対応」ではなく**優先順位で負けている** |
| `onebot.json` のとあるアダプター | per-uin の**同名アダプター**がそれを丸ごと上書きする |

> 📌 **なぜグローバルの `statusCommand` を変えても通常は効かないのか**（【確証】2 つの事実の重なり）：
>
> **事実 1**：`parseStatusCommand(sources)` は**すべてのソースを走査**し、後ろのものが前のものを上書きする。
> 非 snapshot のとき `sources = [全局, per-uin]` → **per-uin が勝つ**。
>
> **事実 2**：`toJsonObject()`（`config.ts:498-517`）は per-uin を保存するとき**常に**
> `statusCommand` / `historySync` / `notifications` の 3 節を書き込む ——
> **明示的に設定していなくても、既定値を書き込む**。
>
> **両者を重ねた結論**：per-uin ファイルには**常に** `statusCommand` があり、
> したがって**常にそれが勝つ**。グローバルで `trigger` を変えても、per-uin の既定値（または古い値）に上書きされる。
>
> **【実測】** 観察された `onebot.json`（グローバル）は確かに `networks` の節しか持っていません ——
> これはコンテナの entrypoint がシード生成したものであり、シードのロジックは `networks` しか書かないためです。
>
> ✅ **したがって：ステータスコマンド / 履歴バックフィル / 通知チャネルは必ず `onebot_<uin>.json` で変更してください。**
> （あるいは：**WebUI / `POST /api/config/:uin` で変更する**。グローバルのファイルを手で編集しないこと。）

**原因 B：ホットリロードされない**

| 設定 | ホットリロード |
| --- | --- |
| `statusCommand` | ✅ 変更後すぐ有効（WebUI / API 経由） |
| `historySync.enabled` | ❌ 起動時のみ読み込み |

**変更しても効かないときの自己確認**：

```bash
# 1. 确认你改的是哪个文件
docker exec haizakura cat /app/data/config/onebot_<uin>.json | grep -A5 statusCommand

# 2. 确认 mode 是什么
docker exec haizakura grep '"mode"' /app/data/config/onebot_<uin>.json

# 3. 走 API 改（推荐），而不是手动改文件
```

> ⚠️ **`POST /api/config/:uin` は「完全な設定」の提出を要求し、部分パッチは受け付けません。**
>
> 【確証】`server.ts:1293-1297` は body を受け取ると**そのまま** `assertValidOneBotConfig(body)` を実行し、
> その後全体を保存します。したがって：
>
> | 方法 | 結果 |
> | --- | --- |
> | `{"statusCommand":{...}}` だけを送る | ❌ **検証失敗**（`networks` / `historySync` が欠けている） |
> | まず `GET` で全量を取得 → フィールドを変更 → `POST` で戻す | ✅ **正しい方法** |
>
> ```bash
> BASE=http://127.0.0.1:5199
> TOK="<你的 WebUI 令牌>"
>
> # ① 先取全量
> curl -s -H "Authorization: Bearer $TOK" "$BASE/api/config/<uin>" \
>   | python3 -c 'import json,sys; json.dump(json.load(sys.stdin)["config"], open("/tmp/cfg.json","w"))'
>
> # ② 本地改字段
> python3 - <<'EOF'
> import json
> c = json.load(open('/tmp/cfg.json'))
> c.setdefault('statusCommand', {})['trigger'] = '#hz'
> json.dump(c, open('/tmp/cfg.new.json','w'))
> EOF
>
> # ③ 整体提交
> curl -s -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
>      --data @/tmp/cfg.new.json "$BASE/api/config/<uin>"
> ```
>
> **応答は本当にホットリロードされたかを教えてくれます**（【確証】返却構造）：
>
> ```jsonc
> {
>   "success": true,
>   "saved": true,          // 已写盘
>   "applied": true,        // 已应用到运行中的网络
>   "online": true,         // 该账号当前在线
>   "reloaded": true,       // online && applied  ← 真正热加载成功的标志
>   "errors": [],
>   "message": "配置保存成功，已热重载当前会话。"
> }
> ```
>
> | `message` | 意味 |
> | --- | --- |
> | 配置保存成功，已热重载当前会话。 | ✅ 即座に有効 |
> | 配置保存成功，当前会话未在线，将在下次连接时生效。 | ⚠️ アカウントがオンラインでない |
> | 配置已保存，但部分网络节点未能应用… | ⚠️ 一部失敗。`errors` を確認 |
>
> 💡 **`GET /api/config/:uin` が返すのは「マージ後」の結果です**（【確証】`loadOneBotConfig`
> はグローバル + per-uin をマージして返し、**`mode` フィールドを含みません**）。
>
> ⚠️ **したがって「GET → 変更 → POST」はファイルを `snapshot` モードへ固化します。**
>
> 【確証】`saveOneBotConfig` の既定 mode は `"snapshot"`：
>
> ```javascript
> saveJson(..., toJsonObject(config, options.mode ?? "snapshot"));
> ```
>
> 結果：**そのアカウントは以後グローバルの `onebot.json` を継承しなくなります**。
>
> | あなたの望み | 正しい方法 |
> | --- | --- |
> | そのアカウントだけに効かせ、グローバルを継承しない | ✅ GET → 変更 → POST（現在の挙動がまさにこれ） |
> | **引き続きグローバルを継承する** | ⚠️ POST の前に**手動で** `"mode": "overlay"` を body へ加える |
>
> ```bash
> # 想保持叠加模式，就显式指定
> python3 -c "
> import json
> c = json.load(open('/tmp/cfg.json'))
> c['mode'] = 'overlay'          # ← 关键
> json.dump(c, open('/tmp/cfg.new.json','w'))
> "
> ```

> 💡 **トリガーワードのマッチング意味論にも注意**：**完全一致、かつ単一の text セグメントのみ**。
> `#hz` + 画像 = 2 セグメント = **トリガーしない**。[設定説明 §2.1](configuration.md) 参照。

---

### 落とし穴 4：コンテナの `ExitCode 126`

§1.8 を参照してください。核心は `SYS_PTRACE` + `seccomp=unconfined` の 2 項目で、どちらも欠かせません。

---

### 落とし穴 5：`/dev/tcp` でポートをテストすると「偽陰性」になる

**この落とし穴は調査の方向性を誤らせます。**

**現象**：ポートは確かに通っているのに、`sh -c 'echo > /dev/tcp/...'` でのテストが失敗する。

**【実測】** コンテナ内での比較：

```bash
$ docker exec haizakura sh -c '(echo > /dev/tcp/127.0.0.1/5099) && echo ok'
sh: 1: cannot create /dev/tcp/127.0.0.1/5099: Directory nonexistent   ← ❌ 假阴性
sh: FAILED

$ docker exec haizakura curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/
200                                                                   ← ✅ 真的通
```

**原因**：`/dev/tcp` は **bash の機能**であり、**POSIX ではありません**。
コンテナ内の `docker exec ... sh` は既定で **dash** を使い、`/dev/tcp` をサポートしません。

（コンテナ内に `bash` は存在します：`/usr/bin/bash`）

**正しい方法**：

| 方法 | コマンド |
| --- | --- |
| **推奨** | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/` |
| bash を使う | `docker exec haizakura bash -c 'echo > /dev/tcp/127.0.0.1/5099'` |
| 待ち受けを見る | `docker exec haizakura ss -lntp` |

> 💡 **一般的な教訓**：ネットワークの問題を調査するときは、HTTP サービスのテストに
> **`/dev/tcp` ではなく curl を使う** —— 前者はステータスコードも見えるため、情報量が多い。

---

### 落とし穴 6：マシン間のファイル転送が途中で切れる

**現象**：`scp` / `docker cp` で大きなファイル（例：12 MB の `index.mjs`）を転送した後、
ファイルサイズが合わない、または内容が壊れている。

**教訓**：**マシン間でファイルを転送したら必ずハッシュを検証すること。**

```bash
# 传之前
sha256sum index.mjs

# 传之后
sha256sum index.mjs   # 必须一致

# 或直接对比大小 + md5
md5sum index.mjs
```

**【実測】現在稼働中のバージョンの値**（照合に使えます）：

```
index.mjs   12,338,442 字节
md5         bebdc7586f6e6586be80a85cc744ae5c
```

> 📌 **2 つの異なるベースラインを混同しないこと**：
>
> | バージョン | バイト数 | MD5 |
> | --- | ---: | --- |
> | **復元レポートに記録された元の bundle** | 12,338,350 | `19bdfef05f6bebfb3986caf81dba37c3` |
> | **現在稼働中のもの（改名後）** | **12,338,442** | **`bebdc7586f6e6586be80a85cc744ae5c`** |
>
> 両者の差異はブランド改名（`#sl` → `#Haizakura` など）と以降の変更によるものです。
> **照合時はあなたが実際にデプロイしたものを基準にしてください** —— コンテナ内、`dist/`、
> およびマウントされた `index.mjs` の三者は一致しているはずです。

> 💡 **なぜこの落とし穴が重要なのか**：壊れた `index.mjs` がコンテナに入ると、
> 症状は**千差万別**（起動失敗 / ある機能の異常）であり、
> 「ファイル転送のエラー」を疑うには至りません。
> **転送したらすぐ検証する。それが数時間を節約します。**

---

### 落とし穴 7：逆解析スクリプトにカウント上限がないとマシンを潰す

**適用範囲**：RTTI 解析 / 逆解析スクリプトを実行している場合。

**教訓**：**逆解析スクリプトを実行するときは必ずカウント上限を設けること。**

| 罠 | 結果 |
| --- | --- |
| Python のスライス `b[:z]` で `z == -1` のとき | 10 MB のデータを吐き出す |
| `.eh_frame_hdr` の `pcrel` を符号なしでデコード | `fde_count` が 1.8e19 になり → 範囲外アクセス |
| `for i in range(cnt)` で `cnt` を誤って解釈 | **無限 append → 2.7 GB のメモリ** |

**【実測】** 当時、2 コアで実業務を動かしているマシン上で、
ループ境界を 1 回書き間違えただけで**ロードアベレージが 37 まで押し上げられました**。

**もう 1 つの罠**：「定義済みエクスポート」の部分集合を全シンボルとして扱うと、
「dynsym に RTTI はない」という**誤った結論**に至ります（実際には 397 個あります）。

---

### 落とし穴 8：`/proc/<pid>/maps` の `(deleted)` は正常

**これを異常だと思わないでください。**

```
# 注入负载映射（注意 (deleted)）
$ docker exec haizakura cat /proc/<qq_pid>/maps | grep -i orcexec
... /tmp/runtime-1000/orcexec.abc123 (deleted)
```

**原因**：インジェクターは `.so` をマッピングした後、**自ら一時ファイルを `unlink` します** ——
これは**ローカルでの発見を防ぐ設計**であり、ディスク上にそのファイルが見つからないのは**想定どおりの挙動**です。

**同様に、次はすべて正常です**：

| 現象 | 説明 |
| --- | --- |
| `(deleted)` の接尾辞 | 注入後に自ら unlink |
| socket 名が `mojo.<pid>.*.sock` | **意図的に Chromium の mojo IPC を装っている** |
| `/tmp/runtime-<uid>/orcexec.<6位随机>` | ランダム名。注入後に消える |
| スレッド名 `snowluma-pipe-w` | 注入されたパイプ書き込みスレッド |

```bash
# 确认注入确实活着（这几个都应该有输出）
docker exec haizakura cat /proc/<qq_pid>/task/*/comm | grep snowluma
docker exec haizakura ss -xpn | grep mojo
```

---

## 3. 障害早見表

| 症状 | 最も可能性の高い原因 | 参照先 |
| --- | --- | --- |
| コンテナ `ExitCode 126` | `SYS_PTRACE` / seccomp の欠如 | §1.8 |
| コンテナは起きるがアクションが全滅 | QQ がログインしていない / ログイン状態を失った | [ログインについて](login.md) |
| **再起動後に再 QR コードログインが必要** | **ログイン状態の喪失（既知）** | §2 落とし穴 1 |
| ログに `unresolved` がある | QQ のバージョンが変わった / 注入失敗 | §1.9 |
| ログが増えなくなった | **クォータ超過による静かな破棄** | §1.7 |
| noVNC が開けない | HSTS による https 強制 | §2 落とし穴 2 |
| noVNC が黒画面 | Xvfb が未準備 | 数秒待つ / ログを見る |
| ステータスコマンドが反応しない | 単一セグメントの純テキストでない / trigger が違う | [設定 §2.1](configuration.md) |
| ステータスコマンドを変えても効かない | ファイルを間違えている（グローバル vs per-uin） | §2 落とし穴 3 |
| ポートのテストが通らない | `/dev/tcp` の偽陰性 | §2 落とし穴 5 |
| LAN から接続できない | `127.0.0.1` にバインドしている | §1.1 |
| QQ の画面が異常 / ログインできない | `HOOK_AUTOLOAD_ALL` を有効にしている | §1.10 |
| メディアを送れない | 権限 / タイムアウト / 並列度 | §1.3 |
| WebUI のパスワードを忘れた | — | §1.2 |
| 更新が常に失敗する | **上流がリポジトリを削除済み（想定どおり）** | [設定 §5.1](configuration.md) |
| ファイル転送でエラー | 転送の切断 | §2 落とし穴 6 |

---

## 4. 診断情報の収集（質問する前に実行）

```bash
# ── 基础状态 ──────────────────────────────
docker ps --filter name=haizakura
docker exec haizakura ps -eo pid,ppid,comm,args --no-headers | head -30

# ── 端口监听 ──────────────────────────────
docker exec haizakura ss -lntp

# ── hook 健康度（0 = 健康）★ 最重要 ────────
docker exec haizakura grep -c unresolved /app/data/logs/*.log

# ── 注入证据 ──────────────────────────────
QQPID=$(docker exec haizakura pgrep -f '^qq ' | head -1)
docker exec haizakura cat /proc/$QQPID/task/*/comm 2>/dev/null | grep -i snowluma
docker exec haizakura ss -xpn 2>/dev/null | grep mojo

# ── 配置快照（脱敏后贴出来）────────────────
docker exec haizakura cat /app/data/config/runtime.json
docker exec haizakura cat /app/data/config/onebot.json

# ── 最近日志 ──────────────────────────────
docker exec haizakura tail -100 /app/data/logs/snowluma-$(date +%F).log

# ── 存储状态（看 droppedLines）─────────────
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:5199/api/system/storage

# ── 连通性（用 curl，不要用 /dev/tcp）──────
curl -s -o /dev/null -w 'webui  %{http_code}\n' http://127.0.0.1:5199/
curl -s -o /dev/null -w 'onebot %{http_code}\n' http://127.0.0.1:3010/get_login_info
```

> ⚠️ **ログ / 設定を貼る前に必ずマスキングしてください**：`accessToken`、`passwordHash`、`passwordSalt`、
> `smtpPass`、QQ 番号。本番のトークンを公開の場に貼らないでください。

---

## 5. それでも解決しない場合

次の順に：

1. [トラブルシューティング](../advanced/troubleshooting.md) を見る —— 体系的な調査手順
2. [アーキテクチャと注入の原理](../advanced/architecture.md) を見る —— 原理を理解してこそ特定できる
3. [互換性マトリクス](../advanced/compatibility.md) を確認する —— あなたの QQ バージョンは対応しているか
4. §4 の診断情報を収集してから質問する —— **ログと `grep -c unresolved` の結果を添えて**
