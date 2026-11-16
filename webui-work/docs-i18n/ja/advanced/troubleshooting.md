# トラブルシューティング

> [!WARNING]
> 本内容はすべて AI が作成したものです。慎重に確認してください。

> **対象読者**：Haizakura（旧称 SnowLuma）をデプロイまたは運用している方。
> **本書は実践マニュアルです** —— 各項目は**実際に踏んだ落とし穴**に基づいており、
> 形式は **症状 → 根本原因 → 解決 → 検証** で統一しています。
> 問題が発生したら、先に第 1 節のヘルスチェックを一通り実行し、そのうえで症状から表を引いてください。

---

## 1. 30 秒ヘルスチェック

```bash
# ── ① 容器活着吗 ──
docker ps --filter name=<容器> --format '{{.Names}} | {{.Status}}'
# 期望：Up … (healthy / Up X minutes)

# ── ② hook 健康度（★ 最重要的一条：0 = 健康）──
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'

# ── ③ 注入痕迹还在吗 ──
docker exec <容器> sh -c 'ls -la /tmp/runtime-*/mojo.*.sock'
# 期望：mojo.<pid>.control.sock + mojo.<pid>.recv.sock

# ── ④ 端口通吗（★ 必须用 curl，别用 /dev/tcp）──
curl -s -o /dev/null -w 'webui=%{http_code}\n' http://127.0.0.1:5099/
curl -s -o /dev/null -w 'onebot=%{http_code}\n' http://127.0.0.1:3000/

# ── ⑤ 基线指纹对不对 ──
docker exec <容器> sh -c 'grep -m1 -o "\"version\": \"[^\"]*\"" /opt/QQ/resources/app/package.json'
# 期望："version": "3.2.32-52194"
```

**5 項目すべて合格 = システムは正常です。** 異常があれば §3 の番号を参照してください。

---

## 2. 調査ツール早見表

### 2.1 プロセスと注入

```bash
# QQ 主进程（过滤掉 --type= 的 Electron 子进程）
docker exec <容器> sh -c 'ps -eo pid,args | grep -E "^ *[0-9]+ qq " | grep -v -- --type='

# ★ 注入负载映射（注意 (deleted) 标记）
docker exec <容器> sh -c 'grep orcexec /proc/<qq_pid>/maps'

# ★ 注入线程（名字直接暴露为 snowluma-pipe-w）
docker exec <容器> sh -c 'ls /proc/<qq_pid>/task/*/comm | while read f; do
  printf "%s " "$(basename $(dirname $f))"; cat $f; done | grep -i snowluma'

# 通信 socket（持有者显示为 qq）
docker exec <容器> sh -c 'ss -xpn | grep mojo'
```

### 2.2 WebUI API（運用で最もよく使うもの）

```bash
# 登录拿 session token
TOKEN=$(curl -s -X POST http://127.0.0.1:5099/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<你的密码>"}' | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)

# 认证方式有两种（任选）：
#   Header:  Authorization: Bearer <token>
#   Header:  x-snowluma-token: <token>

# 状态类
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/status
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/connections
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/qq-list
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/config/<uin>

# 进程 / hook 管理
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes/<pid>/load
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes/<pid>/unload
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes/<pid>/refresh

# 日志
curl -s -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:5099/api/logs?lines=200'
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/logs/stream   # SSE 实时
```

### 2.3 ログ検索

```bash
LOG=/app/data/logs/snowluma-$(date +%F).log

# hook 失败征兆（0 = 健康）
docker exec <容器> sh -c "grep -c unresolved $LOG"

# 12 条 RTTI 失败串（具体是哪些）
docker exec <容器> sh -c "grep -oE '[A-Za-z]+ (RTTI chain unresolved|features missing or ambiguous)[^\"]*' $LOG | sort -u"

# 自动注入的终态
docker exec <容器> sh -c "grep -oE 'hook_autoload_terminal[^\"]*' $LOG | sort -u"
```

---

## 3. 障害カルテ

---

### T1 ★ 状態コマンドのトリガーワードを変えたのに、ボットが旧コマンドに応答し続ける

**これは設定の優先順位の問題であり、バグではありません。**

#### 症状

```
- コード内の既定トリガーワードを #sl から #Haizakura に変更した
  → コンテナの再起動後に反映された（ただし再起動でログイン状態を失う ❌）
- /app/data/config/onebot_<uin>.json の trigger を直接変更した
  → まったく反映されない ❌
- ボットは依然として旧トリガーワードにしか応答しない
```

#### 根本原因

**2 つの原因が重なっています**：

```
原因 1：設定の優先順位
        実行時設定（onebot_<uin>.json）  >  コードの既定値（DEFAULT_STATUS_COMMAND）
        → コードの既定値を変更しても、既存のアカウントには効かない

原因 2：★ 設定ファイルの変更は【ホットリロードされない】
        実行時にメモリ上に保持されているのは【ログイン時に読み込んだ】設定です。
        JSON ファイルを直接変更しても、プロセスは変更を認識しません —— API 経由か再起動が必要です。
```

**現在の値**（実測で確認）：

```jsonc
// 代码默认值（packages/onebot/src/config.ts）
var DEFAULT_STATUS_COMMAND = {
  enabled: true,
  swallow: false,
  cooldownSeconds: 5,
  trigger: "#Haizakura"        // ← 代码默认
};

// 运行时实际生效（/app/data/config/onebot_<uin>.json）——  以这个为准
"statusCommand": {
  "enabled": true,
  "swallow": false,
  "cooldownSeconds": 5,
  "trigger": "#hz"            // ← ★ 实际生效值
}
```

#### 解決：WebUI API 経由でホット変更する（再起動せず、**ログイン状態を維持**）

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:5099/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<密码>"}' | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)

# ① 先把当前完整配置拉下来
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/api/config/<uin> > /tmp/cfg.json

# ② 改 trigger（用 jq 精确修改，保留其它字段）
jq '.statusCommand.trigger = "#hz"' /tmp/cfg.json > /tmp/cfg.new.json

# ③ POST 完整 config body（★ 必须是完整配置，不能只发 statusCommand）
curl -s -X POST http://127.0.0.1:5099/api/config/<uin> \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/cfg.new.json
```

#### 検証

```bash
# 期望返回：{"success":true,"saved":true,"applied":true,...}
```

**返却フィールドの意味**：

| 返却 | 意味 | 対処 |
|---|---|---|
| `"applied": true` | ✅ **現在のセッションがホットリロードされ**、即時反映 | 完了 |
| `"applied": false` かつ `"online": false` | アカウントが現在オフライン。**次回接続時に反映** | オンラインになるのを待つ |
| `"applied": false` だが `online: true` | 一部のネットワークノードに未適用。旧ノードは可能な限り復旧済み | 返却値の `errors` の詳細を見る |
| `"success": false` | 設定の検証に失敗 | `message` を見る |

> サーバー側の原文（ソース内の 3 段階のメッセージ）：
> - `"配置保存成功，已热重载当前会话。"`
> - `"配置保存成功，当前会话未在线，将在下次连接时生效。"`
> - `"配置已保存，但部分网络节点未能应用；旧节点已尽力恢复，请查看错误详情。"`

#### ⚠️ 3 つのルートの比較（実際に通った道）

| ルート | 結果 | 説明 |
|---|---|---|
| ① ソースの既定値を変更 | コンテナ再起動後に反映 | **ただし再起動でログイン状態を失う** ❌ |
| ② 設定ファイル `onebot_<uin>.json` を変更 | **反映されない** | ホットロードなし ❌ |
| ③ **WebUI API で完全な config を POST** | **反映される**（`applied:true`） | ✅ **推奨** |

#### 付録：トリガーワードのマッチング仕様

```js
function normalize(s) { return s.trim().toLowerCase(); }

// 精确相等，不是包含匹配
return normalize(message) === normalize(trigger);
```

| 特性 | 挙動 |
|---|---|
| 大文字・小文字 | **区別しない**（`#HZ` = `#hz`） |
| 前後の空白 | **自動的に trim**（`" #hz "` でも一致） |
| **混在メッセージ** | ❌ **一致しない**（`#hz` + 画像 1 枚では発火しない —— 単一の text セグメントである必要がある） |
| 長さ制限 | trigger は**最大 32 文字**、改行を含められない |
| クールダウン | `cooldownSeconds`（現在 5 秒） |

---

### T2 ★★★ ログイン状態の喪失 —— QR コードの読み取り直しが必須（血の教訓）

**これは破壊性が最も高く、最も踏みやすい落とし穴です。**

#### 症状

```
- QQ プロセスを再起動した / コンテナを再起動した
- WebUI は未ログインと表示し、OneBot のアクションはすべて次を返す
  "QQ is not ready. Please finish signing in and try again."
- 確認したところ loginList が空だった
```

#### 根本原因

```
QQ プロセス再起動 → loginList がクリアされる → QR コードの読み取り直しが必須
```

**`loginList` は永続化されたログイン資格情報ではありません** —— これは**プロセス内のセッション状態**です。
QQ プロセスが消えれば、この状態も消えます。

**波及効果**：コンテナを再起動すると QQ プロセスも一緒に再起動されます（supervisord の `[program:qq]`）。
したがって**コンテナの再起動 = ログイン状態の喪失**です。

#### 解決：QR コードを読み取り直す

```bash
# ① 确认 noVNC 可达（走 IP，别用域名 —— 见 T3）
#    http://<服务器IP>:6181/vnc.html

# ② 确认 noVNC 进程活着
docker exec <容器> sh -c 'ps aux | grep -E "novnc|websockify|x11vnc"'

# ③ 打开 noVNC → 看到 QQ 登录界面 → 扫码
#    密码在容器内 /app/data/config/vnc-password
docker exec <容器> cat /app/data/config/vnc-password

# ④ 扫码成功后，确认 hook 自动接管
docker exec <容器> sh -c 'ls -la /tmp/runtime-*/mojo.*.sock'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/qq-list
```

#### 予防

> ⚠️ **QQ / コンテナの再起動が必要な操作の前には、必ず「QR コードの読み取り直しが必要か」を考えてください。**
>
> - 再起動が必要なときは、**QR コードを読み取れるときに行う**ようにしてください（PC の前にいる状態）
> - **設定変更は WebUI API を優先**してください（T1）—— これが「再起動しない」唯一の正道です
> - 新しい bundle をデプロイするときは**runtime プロセスの再起動だけでよく、QQ の再起動は不要**です（[build.md](../dev/build.md) §5 参照）
> - **`--restart=always` を設定して自動復旧を期待しないでください** —— 再起動はできますが、ログイン状態は戻りません

---

### T3 noVNC が開けない

#### 症状

```
- ブラウザで https://<域名>:6181/vnc.html にアクセス → 開けない / 接続を拒否される / 証明書エラーになる
- http:// に変えてもだめで、ブラウザが自動的に https:// へ遷移する
```

#### 根本原因

```
ブラウザの HSTS（HTTP Strict Transport Security）が、そのドメインの http を強制的に https へ昇格させる。
noVNC は平文 HTTP サービスであり https に対応していない → 接続失敗。
```

HSTS は**ドメイン単位**で記憶されるため、あるドメインが一度マークされると、
以降のすべての http アクセスが強制的に昇格されます。

#### 解決：**ドメインの代わりに IP を使う**

```
❌ https://example.com:6181/vnc.html     ← HSTS により強制昇格、失敗
❌ http://example.com:6181/vnc.html      ← ブラウザに https へ飛ばされ、失敗
✅ http://<your-host>:6181/vnc.html    ← ★ IP を使い、HSTS を回避
```

> **要点**：HSTS は**ドメイン**に対してのみ有効で、**裸の IP アドレスには効きません**。
> そのため同じサービスでも、ドメインでは開けず、IP では開けます。

#### 代替案

```bash
# ① 换浏览器 profile / 无痕模式（HSTS 缓存不在里面）
# ② 清 HSTS：Chrome → chrome://net-internals/#hsts → Delete domain security policies
# ③ 直接端口转发到本地，用 localhost 访问
ssh -L 6181:127.0.0.1:6181 <user>@<服务器>
# 然后访问 http://127.0.0.1:6181/vnc.html
```

#### 検証

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<服务器IP>:6181/vnc.html
# 期望：200
```

---

### T4 hook が機能しない（ログに unresolved が出る）

**これは最優先度の障害です** —— QQ がアップグレードされたか、注入に失敗したことを意味します。

#### 症状

```
- OneBot のアクションがすべて失敗する
- ログにフック失敗文字列が出る
- grep -c unresolved が 0 以外を返す
```

#### 診断：最初の一歩は常に数えること

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
# 0 = 健康
# >0 = 有问题，继续看下面
```

#### ★ 12 本の RTTI 失敗文字列 → 具体的なスロット対応表

**12 本すべてが同一の検証ゲート（`.so` の `0x5610`）に由来します**。
それらは**全「AND」関係**のチェックリストを構成しており —— **1 本でも失敗すればチェーン全体が失敗し、注入は拒否されます**。

| # | エラー文字列（ログ原文） | 対応するターゲット | アドレス / オフセット |
|---|---|---|---|
| 1 | `MSFService SessionInit/RTTI chain unresolved` | MSFService `SessionInit` | `0x137a48c`、**ap+0x98** |
| 2 | `MSFCoreService SessionInit/RTTI chain unresolved` | MSFCoreService `SessionInit` | `0x139d864`、**ap+0x98** |
| 3 | `MSFCoreService packet-state callback/RTTI chain unresolved` | MSFCoreService `onMSFPacketState` | `0x13a3e80`、**ap+0x178** |
| 4 | `MSFService receive anchor/TaskManager RTTI chain unresolved` | MSFService `operator()`（recv push）+ TaskManager チェーン | `0x1383f14` / `0x1383ee4`、ap+0x100/+0x158 |
| 5 | `MSFService send features missing or ambiguous` | `SendSSORequestInternal` / `SendMsfRequest` | ap+0x120 / +0x130 |
| 6 | `MSFCoreService send features missing or ambiguous` | `SendSSORequest` / `SendMsfRequest` | ap+0x120 / +0x138 |
| 7 | `MSFCoreService packet converter/native allocator unresolved` | `onMsfPushForTesting` / `GetClientAddress` + アロケータ | ap+0x68 |
| 8 | `NG session/receive ownership path unresolved` | NG セッション / 受信パケットの帰属パス | — |
| 9 | `MSF live selector feature/RTTI chain missing or ambiguous` | live selector 機能 | — |
| 10 | `invalid pid` | 対象 PID が無効 | — |
| 11 | `failed to inspect wrapper.node` | `wrapper.node` の読み取り失敗 | — |
| 12 | `runtime service structures could not be read or resolved` | 実行期の構造体の読み取り / 解析失敗 | — |

**関連する残り 2 本の文字列**（別の関数）：

| エラー文字列 | 所在する関数 | 意味 |
|---|---|---|
| `missing or ambiguous GNU build ID` | `0x384cc`（モジュール同一性の検証） | build-ID の欠落または非一意 → **QQ のバージョン不一致** |
| `ELF metadata differs from live memory` | `0x39b10`（ディスク / メモリの比較） | ディスク上のファイルとメモリマップが不一致 → **改ざんまたはバージョン不整合** |
| `failed to install a resolved receive VTable` | `0xea00`（VTable のインストール） | 解析は成功したがインストールに失敗 → ページ保護を変更できない |
| `QQ runtime cannot read process memory`<br>`[RUNTIME_MEMORY_UNAVAILABLE]` | `0x5610` | 対象プロセスのメモリ読み取りが拒否された → **カーネル権限 / seccomp の問題** |

#### エラー文字列によるトリアージ

| 目にするもの | 根本原因 | 解決 |
|---|---|---|
| `missing or ambiguous GNU build ID` | **QQ のバージョンが変わった**。build-ID が `89c36b52…` ではない | [compatibility.md §7](compatibility.md) の適配手順へ |
| `…SessionInit/RTTI chain unresolved` | クラス名が変わった（→ ケース 2）またはスロットが変わった（→ ケース 3） | `dump-vtable.py --diff` を実行 |
| `…features missing or ambiguous` | vtable 内に候補が複数あり、曖昧性を解消できない | 同上。diff のスロット表を見る |
| `ELF metadata differs from live memory` | ディスク上の `wrapper.node` とメモリが不一致 | QQ が外部から変更されていないか確認し、再注入する |
| `[RUNTIME_MEMORY_UNAVAILABLE]` | `CAP_SYS_PTRACE` の欠落、または seccomp による遮断 | T5 参照 |
| `invalid pid` / `module not found in target process maps` | 誤ったプロセスに注入した（zygote に注入した） | T11 参照 |

#### 解決パス

```bash
# ① 确认是否能自愈（瞬时错误会自动重试 3 次）
docker exec <容器> sh -c 'grep -oE "auto-load (retry pending|retry exhausted|recovered)[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'
```

| ログ | 意味 | 対応 |
|---|---|---|
| `auto-load retry pending` | 一時的なエラー。再試行中 | 少し待つ |
| `auto-load recovered: PID=%d attempt=%d/3` | ✅ 自動復旧に成功 | 完了 |
| `auto-load retry exhausted` | ❌ 3 回を使い切った | 下記の適配手順へ |

```bash
# ② 手动重新注入（绕过自动闸门）
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/api/processes/<qq主进程pid>/load
```

```bash
# ③ 若仍失败 → 判定 QQ 版本变化，走适配
md5sum wrapper.node
readelf -n wrapper.node | grep 'Build ID'
python3 tools/dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
python3 tools/dump-vtable.py --wrapper wrapper.node --diff tools/baseline-vtable.json
```

> ⚠️ **重要な認識**：エラーメッセージは**`unresolved` としか言いません**。これ以上の詳細は得られません。
> 「どこが変わったのか」を知るには、**自分で dump ツールを実行して diff を取る必要があります**。

#### 検証

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'   # 应回到 0
# + 端到端：真的发一条消息、真的收一条消息
```

---

### T5 コンテナの起動に失敗し、ExitCode 126

#### 症状

```
docker ps -a
  → Exited (126) X seconds ago

docker logs <容器>
  → /usr/local/bin/node: Operation not permitted
```

コンテナは**即座に終了**し、終了コードは **126** です。

#### 根本原因

**2 つの必須カーネルケーパビリティが不足しています**：

```
① --cap-add SYS_PTRACE が無い
   → 注入器が ptrace で QQ プロセスにアタッチできない

② --security-opt seccomp=unconfined が無い
   → 既定の seccomp ホワイトリストが ptrace / process_vm_readv / process_vm_writev を遮断する
   → node の起動時のシステムコールが拒否される → "Operation not permitted" → exit 126
```

終了コード 126 の意味は **「コマンドは見つかったが実行できない」** —— 権限の問題であり、
「ファイルが存在しない」（それは 127）ではありません。

#### 解決

```bash
docker run -d \
  --name snowluma-hz \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 5199:5099 -p 3010:3000 -p 3011:3001 -p 6181:6081 \
  motricseven7/snowluma:latest
```

#### 検証

```bash
# ① 确认容器起来了
docker ps --filter name=snowluma-hz --format '{{.Status}}'

# ② 确认这两个配置真的在（生产实例实测输出）
docker inspect snowluma-hz --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}}'
# 期望：["CAP_SYS_PTRACE"] ["seccomp=unconfined"]
```

#### 切り分けの順序（終了コード早見表）

| 終了コード | 意味 | よくある原因 |
|---|---|---|
| **126** | コマンドを実行できない（権限） | **`CAP_SYS_PTRACE` / seccomp の欠落** ← 最も多い |
| 127 | コマンドが存在しない | イメージの破損 / パスの誤り |
| 137 | SIGKILL を受けた（通常は OOM） | メモリ不足 |
| 143 | SIGTERM を受けた（正常停止） | 手動 stop |
| 0 | 正常終了 | フォアグラウンドのプロセスが終了した（本来は常駐すべき） |

---

### T6 `/tmp` のファイルが突然消える

#### 症状

```
- コンテナの /tmp 配下で生成したスクリーンショット / エクスポートファイルが、数秒後に見つからなくなる
- あるいは：/tmp に書いたファイルが 0 バイトで読み出される
```

#### 根本原因

```
コンテナ内の /tmp は定期的にクリーンアップされる（tmp クリーンアップ機構）。
注入器自身も /tmp を使う（一時ファイルを書き出した直後に unlink する）——
そのため /tmp はこのコンテナでは【高回転領域】であり、残しておきたいものを置くのには向かない。
```

**証拠**：注入器は `.so` を `/tmp/runtime-<uid>/orcexec.<rand6>` に書き込んだ後、**即座に unlink** します
（`/proc/<pid>/maps` では `(deleted)` と表示されます）—— これは設計上の挙動であり、バグではありません。

#### 解決

| シナリオ | 正しい方法 |
|---|---|
| **スクリーンショットをユーザーに送る** | **パイプ経由で、ディスクに残さない** —— 直接 base64 で出力し、`/tmp/xxx.png` に書かない |
| 保存が必要なエクスポート | **マウントボリューム**（`/app/data/…`）に書く。`/tmp` には書かない |
| 一時的な中継 | 使い終わったら即座に読み出す。または消されることを受け入れる |

```bash
# ✅ 截图走管道（不落盘）
docker exec <容器> sh -c 'import -window root png:-' | base64 -w0

# ✅ 需要留存的文件写到持久卷
docker exec <容器> sh -c '你的命令 > /app/data/export-$(date +%s).txt'

# ❌ 别这样
docker exec <容器> sh -c 'screenshot > /tmp/shot.png'   # 可能被清掉
```

---

### T7 ポートに到達できない

**この落とし穴には 2 つの層があります：Docker のネットワークチェーンと、テスト手法そのものの偽陰性です。**

#### 症状

```
- ホストからコンテナのポートにアクセスしても接続できない
- しかしコンテナ内の curl は通る（またはその逆）
- /dev/tcp でテストすると到達不可と報告されるが、curl は 200 を返す
```

#### 根本原因

**根本原因 1：Docker のポートは INPUT チェーンではなく FORWARD チェーンを通る**

```
ホスト →（PREROUTING DNAT）→ FORWARD → コンテナ
                          ⚠️ INPUT チェーンではない
```

したがって**INPUT チェーン向けに設定したファイアウォールルールは効きません**。
「このポートを開放した」はずなのに、トラフィックは FORWARD チェーンの既定ポリシーで遮断されます。

**根本原因 2：`/dev/tcp` によるテストには偽陰性がある**

```
同じポートでも、/dev/tcp は到達不可と報告し、curl は 200 を返す。
```

`/dev/tcp` は bash の組み込み機能であり、その挙動は**さまざまな要因**（DNS 解決、IPv6 優先、
bash のコンパイルオプション、タイムアウト処理）に左右されます。**疎通判定には適していません**。

#### 解決

```bash
# ① ★ 验证端口连通性【必须用 curl】
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:<PORT>/<path>

# ② 排查 Docker 端口映射
docker port <容器>

# ③ 检查 FORWARD 链（不是 INPUT！）
sudo iptables -L FORWARD -n -v --line-numbers
sudo iptables -t nat -L DOCKER -n -v          # 看 DNAT 规则

# ④ 检查宿主机内核转发开关
sysctl net.ipv4.ip_forward                     # 应为 1

# ⑤ 分层定位：容器内 → 宿主机 → 外网
docker exec <容器> curl -s -o /dev/null -w 'in-container=%{http_code}\n' http://127.0.0.1:5099/
```

#### 検証

```bash
# 期望：一个 2xx/3xx/4xx 的 HTTP 状态码（401/404 也算"通"，因为 TCP 层通了）
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:5199/
```

> **読み取りのヒント**：`401` / `404` は**どちらも「疎通している」証拠**です ——
> TCP が接続でき、HTTP サービスが応答していることを意味します。本当に不通なのは `000`（接続失敗）だけです。

---

### T8 WebUI のパスワード強度が不足しており設定できない

#### 症状

```
- WebUI のパスワードを設定しようとすると拒否される
- あるいは：弱いパスワードを設定すると、ログイン後にパスワード変更を強制される
  （mustChangePassword ゲート：ホワイトリストのルート以外はすべて 403 + mustChangePassword:true を返す）
```

#### 根本原因

**パスワード規則**（`packages/core/src/webui/auth.ts` の `PASSWORD_RULES`、ソース原文）：

```js
var PASSWORD_RULES = [
  { id: "length",  label: "长度不少于 10 位",        test: (p) => p.length >= 10 },
  { id: "lower",   label: "包含小写字母",            test: (p) => /[a-z]/.test(p) },
  { id: "upper",   label: "包含大写字母",            test: (p) => /[A-Z]/.test(p) },
  { id: "special", label: "包含特殊符号 (!@#$%…)",   test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  { id: "no-space",label: "不包含空格",              test: (p) => !/\s/.test(p) && p.length > 0 }
];
```

**5 項目すべてを満たして初めて強力なパスワードと見なされます**（`isStrongPassword` = `every()`）。

#### 解決

パスワードは**同時に**次を満たす必要があります：

| 要件 | 説明 |
|---|---|
| **長さ ≥ 10** | 10 文字未満は即座に拒否 |
| **小文字を含む** | `a-z` |
| **大文字を含む** | `A-Z` |
| **特殊記号を含む** | `!@#$%…`（英数字でも空白でもない任意の文字） |
| **空白を含まない** | |

記述例：`<Your-Password>`（10 文字以上、大文字小文字 + 数字 + 特殊記号を含み、空白なし）。

#### 関連インターフェースと仕組み

```bash
# 校验强度（不需要登录）
curl -s -X POST http://127.0.0.1:5099/api/auth/check-strength \
  -H 'Content-Type: application/json' -d '{"password":"你的候选密码"}'

# 改密码
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/api/auth/change-password \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"...","newPassword":"..."}'
```

| 仕組み | 説明 |
|---|---|
| **ハッシュアルゴリズム** | `crypto.scryptSync`、`N=16384` / `r=8` / `p=1` / `keylen=64` |
| **比較** | `timingSafeEqual`（タイミング攻撃対策） |
| **強度評価** | `@zxcvbn-ts/core`（強度スコアも追加で提示） |
| **2FA** | TOTP（RFC 4226/6238）、ルート `/api/auth/totp/*` |
| **ログイン速度制限** | 同一 IP での連続失敗によりロック（429 + 残り秒数を返却） |
| **初回起動ガイド** | `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`（**8 文字未満は無視される**） |

---

### T9 設定を変更したのに反映されない

#### 症状

```
- 設定ファイルを変更した → 変化なし
- どのディレクトリ配下のファイルを変更すべきか分からない
```

#### 根本原因 1：「設定ファイル」を変更したが、実行時にホットリロードされない

これは T1 と同源の問題です。**種類ごとに対処します**：

| 設定の種類 | ファイル変更で反映されるか | 正しい方法 |
|---|---|---|
| `onebot_<uin>.json`（アカウント単位） | ❌ **ホットリロードされない** | **WebUI API `POST /api/config/:uin` を使う** |
| `runtime.json`（グローバル実行設定） | ⚠️ 一部のフィールドは**ブール値ホワイトリスト**で、ホットリロード可能 | `hookAutoLoad` / `webuiTls.enabled` はホワイトリスト内。それ以外は再起動が必要 |
| `ui.json`（WebUI の外観） | ✅ API 経由で可能 | `POST /api/ui` |
| `webui.json`（パスワード） | ✅ API 経由 | `POST /api/auth/change-password` |

#### 根本原因 2：ディレクトリを間違えた（**chatluna は `/app/` ではなく `/data/instance/`**）

**これは最も混同しやすい点です** —— コンテナ内には**まったく異なる 2 系統のディレクトリ接頭辞**が存在します：

```
/app/               ← Haizakura（SnowLuma）自身のディレクトリ
  /app/runtime/       bundle + native の生成物
  /app/data/config/   ★ Haizakura の設定ファイルはここ
  /app/data/logs/     ログ
  /app/data/data/<uin>/  SQLite データベース
  /app/.config/       QQ の設定（ログイン状態を含む）
  /app/.local/share/  QQ のデータ

/data/instance/     ← ★ chatluna 関連（Haizakura ではない！）
```

> **判断基準**：変更したいのが **Haizakura の挙動**なら → `/app/` を探す；
> 変更したいのが **chatluna（外部連携の bot フレームワーク）**なら → `/data/instance/` を探す。
> **両者は繋がっていません。**

#### 根本原因 3：コンテナが想定したものと違う

```bash
# 确认你改的是正在运行的那个容器
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
```

> ⚠️ **特に注意**：**停止済みの旧コンテナ**が存在する可能性があります（たとえば `snowluma` は旧環境で、
> 設定は `#sl`。現在有効なのは `snowluma-hz` で、設定は `#hz`）。
> **正しいファイルを変更しても、旧コンテナのボリューム上で変更したのでは無駄になります。**

#### 解決：まず特定し、それから変更する

```bash
# ① 我现在连的是哪个容器？
docker ps --format '{{.Names}} {{.Status}}'

# ② 这个容器的配置文件到底在哪？
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
docker exec <容器> sh -c 'ls -la /app/data/config/'

# ③ 当前实际生效的值是什么？
docker exec <容器> sh -c 'cat /app/data/config/runtime.json'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/status
```

---

### T10 マシン間のファイル転送が途中で切れる

#### 症状

```
- scp で転送したファイルのサイズがおかしい（16 KB の tgz が 672 KB や 0 バイトになる）
- あるいは：ファイル長は正常に見えるが、中身が壊れている
  （262 バイト vs 262 バイトで md5 が異なる例に遭遇）
```

#### 根本原因

```
① 転送が中断された（SSH のアイドル切断、ネットワークの揺らぎ）
② バイナリファイルがテキストパイプを経由して書き換えられた（改行変換、エンコーディング破損）
③ ★ ファイル長が同じ ≠ 内容が同じ
```

#### 解決

```bash
# ✅ 首选：base64 编码 + 管道（避免二进制被文本层改写）
base64 -w0 local-file.tgz | ssh <host> 'base64 -d > /remote/path/file.tgz'

# ✅ 或者：cat 直通
cat local-file.tgz | ssh <host> 'cat > /remote/path/file.tgz'

# ✅ 大文件：分块（可断点续传）
split -b 8M local-file.tgz chunk-
for f in chunk-*; do
  scp "$f" <host>:/remote/path/ && echo "$f OK" || { echo "$f FAIL"; break; }
done
ssh <host> 'cat /remote/path/chunk-* > /remote/path/file.tgz'
```

#### ★ 必ず両端で検証する

```bash
# 本地
sha256sum local-file.tgz
# 远端
ssh <host> 'sha256sum /remote/path/file.tgz'

# 值必须【完全一致】
```

> **教訓**：
> - **ファイル長が同じでも内容が異なることがある** —— `ls -l` を検証代わりにしない
> - **必ず sha256/md5 を使う**。サイズだけを見ない
> - 長時間の転送はバックグラウンドジョブ + ログのポーリング（`setsid nohup ... &`）で行う。SSH のアイドル切断はフォアグラウンドのジョブを殺す

---

### T11 zygote に注入してしまい、QQ の IPC とログイン画面を壊す

#### 症状

```
- QQ の画面が白くなる / ログイン画面が異常 / QQ のプロセス間通信が機能しない
- ログに "auto-load skip: PID=%d is an Electron child process (--type=%s)" が出る
- あるいは：hook は効いているように見えるが QQ 自体が壊れている
```

#### 根本原因

**Electron の子プロセスが「QQ のメインプロセス」と誤判定される**。原因は 2 つの重なりです：

```
① 子プロセス（zygote / renderer / gpu / utility）の cmdline にも "qq" が含まれる
② それらは fork の copy-on-write により【wrapper.node のマッピングを一時的に継承する】

→ .node のプロセス列挙子がそれらを「メイン QQ」と誤認する
```

**影響は深刻です**：

```
zygote に注入 → zygote 内で hook の resolver スレッドが起動する
            → その後 Electron が fork する【すべての renderer がそのスレッド
              + 半分初期化された hook 状態を継承する】
            → 【QQ の IPC とログイン画面を直接壊す】
```

**ソースコメントの原文**：

> *"Injecting into a zygote spawns the hook's resolver thread inside it;
> every renderer Electron later forks then inherits that thread + the
> partially-init'd hook state, which breaks QQ's IPC and login UI."*

#### 解決：フィルタ機構（組み込み済み、既定で有効）

ソース `shouldAutoLoadPid()` のロジック：

```js
function shouldAutoLoadPid(pid, log) {
  if (process.platform !== "linux") return true;
  if (process.env.SNOWLUMA_HOOK_AUTOLOAD_ALL === "1") return true;   // 逃生舱
  let cmdline;
  try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"); }
  catch { return true; }
  if (cmdline.includes("--type=")) {                                  // ★ 判据
    const type = /--type=([^\0\s]+)/.exec(cmdline)?.[1] ?? "unknown";
    log.info("auto-load skip: PID=%d is an Electron child process (--type=%s)", pid, type);
    return false;
  }
  return true;
}
```

**判定方法は非常にシンプルで効果的です**：`/proc/<pid>/cmdline` を読み、`--type=` を含んでいればスキップします。
QQ メインプロセスの cmdline は `qq --no-sandbox --disable-gpu …` であり、`--type=` を**含みません**。

#### 3 つのスイッチ

| スイッチ | 役割 | リスク |
|---|---|---|
| `shouldAutoLoadPid()`（既定の挙動） | `--type=` を持つプロセスを自動的にスキップ | ✅ 安全。既定のままにする |
| `SNOWLUMA_HOOK_AUTOLOAD_ALL=1` | **すべての PID を許可**（エスケープハッチ） | ⚠️ **zygote に注入して QQ を壊す** |
| `POST /api/processes/:pid/load` | **手動ロード。ゲートを回避** | ⚠️ 作業者の責任 |

#### 検証

```bash
# ① 确认注的是主进程，不是子进程
docker exec <容器> sh -c 'ps -eo pid,args | grep -E "qq --" | grep -v -- --type='

# ② 确认跳过日志
docker exec <容器> sh -c 'grep -oE "auto-load skip: PID=[0-9]+ is an Electron child process[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'

# ③ 确认 socket 的 pid 是主进程
docker exec <容器> sh -c 'ls /tmp/runtime-*/mojo.*.control.sock'
```

**傍証**：`.so` にはもう 1 層のガード `isTransientLibcMappingError()` があり、
`"target process does not map /libc.so.6 while resolving mmap"` にマッチします ——
つまり**注入器は対象プロセスが libc をマップ済み（動的リンク完了済み）であることを要求**しており、
zygote の初期段階はちょうどこれを満たしません。

---

### T12 自動更新は必ず失敗する（404）

#### 症状

```
- ログに更新チェックの失敗が繰り返し出る
- GET /api/update/check が 404 / ネットワークエラーを返す
```

#### 根本原因

```
上流のリポジトリが削除済み：
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/     → 404
  https://github.com/SnowLuma/SnowLuma/releases/download/v…    → 404
```

**ネットワークの問題でもミラーの問題でもありません —— リポジトリが本当に消えています。**

#### 解決

3 つの方法から 1 つを選びます：

```bash
# 方案 A：关掉更新检查（最简单）
SNOWLUMA_UPDATE_CHECK=0

# 方案 B：指向你自己的 fork
#   改 packages/core/src/update/sources.ts 的 RELEASE_ROOT

# 方案 C：走 WebUI 配置更新源（不重启）
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/sources \
  -H 'Content-Type: application/json' \
  -d '{"mode":"direct","mirror":"","mirrors":[]}'
```

**3 つのモード**（`update/sources.ts`）：

| モード | 挙動 |
|---|---|
| `auto`（既定） | まず直連、次にミラーを順にフォールバック（`mirrors` は最大 16 個） |
| `direct` | 直連のみ |
| `mirror` | 自前で指定したミラーのみ |

**既定のミラー一覧**（**すべて GitHub を指すため、すべて 404**）：

```
https://ghfast.top          https://ghproxy.net
https://gh-proxy.com        https://github.chenc.dev
https://fastgit.cc          https://gh.noki.icu
https://cors.isteed.cc      https://gh-proxy.org
https://githubproxy.gohj99.site   https://github.xxlab.tech
```

#### 検証

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/
# 期望：404（确认仓库已删）
```

> ⚠️ **引き継ぎ時の必須項目**：`update/sources.ts` は**必ず変更する**ファイルの 1 つです。
> 関連する WebUI ルート：`GET /api/update/check`、`GET/POST /sources`、`POST /sources/test`、`POST /download`。

---

### T13 ログがディスクを圧迫し続ける

#### 症状

```
- ディスク容量がログに食われる
- 実測でおよそ 11 MB/日
```

#### 根本原因

```
既定：logMaxTotalMb = 1024（総量上限 1 GB）
      logRetainDays = 7（7 日間保持）
      logPerUin    = false（アカウントごとにファイルを分けない）

→ 定常状態でおよそ 80 MB が常駐（7 日 × 11 MB/日）
   —— ただしトラフィックが多いと、より速く 1 GB の上限に近づく
```

#### 解決

```bash
# 方式一：改 runtime.json（部分字段可热重载）
#   路径：/app/data/config/runtime.json
{
  "logMaxTotalMb": 512,
  "logRetainDays": 3,
  "logPerUin": false
}

# 方式二：环境变量
SNOWLUMA_LOG_DIR=/app/data/logs
SNOWLUMA_LOG_FILE=0            # 完全关闭文件日志（只留控制台）
SNOWLUMA_LOG_LEVEL=info
SNOWLUMA_LOG_FILE_LEVEL=warn   # 文件只记 warn 以上（省空间）
SNOWLUMA_LOG_MAX_MB=…          # 单文件上限
SNOWLUMA_LOG_MAX_TOTAL_MB=1024 # 总量上限
SNOWLUMA_LOG_RETAIN_DAYS=7     # 保留天数
SNOWLUMA_LOG_PER_UIN=0         # 是否按 uin 分文件
```

#### 検証

```bash
docker exec <容器> sh -c 'du -sh /app/data/logs/; ls -la /app/data/logs/'
```

#### 関連：WebUI のストレージ整理

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage/cleanup
```

> **注意**：`messages.db` はメッセージとともに蓄積します（実測では 70.8 MB + 4 MB の WAL に達した例あり）。
> 大流量の環境では `/app/data/data/<uin>/` の総量に注意してください。

---

### T14 WebUI ログインに関するその他の落とし穴

#### T14.1 ログインが速度制限される（429）

```
症状：{"success":false,"message":"ログイン試行が多すぎます。N 秒後に再試行してください"} を返す
根本原因：同一 IP での連続パスワード誤りによりロック（loginAttempts は IP 単位で計数）
解決：残り秒数を待つ；別の IP からアクセスする；または runtime を再起動して計数をクリアする
```

> **制限のキー**は `trustProxy` の設定に依存します。既定では **socket peer** 単位です。
> リバースプロキシ経由で `trustProxy` を設定しない場合、すべてのユーザーが同一 IP として扱われます。

#### T14.2 ログイン成功後も規約同意 / パスワード変更が必要

```
症状：ホワイトリストのルート以外は、すべての API が 403 を返す
      {"status":"failed","message":"先にユーザー規約とプライバシーポリシーをお読みいただき同意してください","consentRequired":true}
      {"status":"failed","message":"先にパスワードを変更してください","mustChangePassword":true}
根本原因：2 つの独立したゲート
解決：consentGatePending → POST /api/agreements/record-consent
      mustChangePassword → POST /api/auth/change-password
一括デプロイ：SNOWLUMA_ACCEPT_EULA=1 SNOWLUMA_ACCEPT_PRIVACY=1
```

> `EULA.md` / `PRIVACY.md` が欠落していると警告が出ます：
> `[WebUI.Consent] agreement file not found (looked for EULA.md near the bundle and repo root)`

#### T14.3 リバースプロキシ経由だと実際のクライアント IP が取得できない

```
症状：すべてのリクエストの「クライアント IP」がリバースプロキシのアドレスになる
根本原因：trustProxy が未設定 / 設定ミス
解決：runtime.json の trustProxy を次のように設定する：
      ""          無効（既定。socket peer 単位）
      "all"       任意の peer の X-Real-IP / X-Forwarded-For を信頼
      "loopback"  socket peer がループバックの場合のみ信頼
      "ip-list"   socket peer が指定 IP リスト内にある場合のみ信頼
```

#### T14.4 WebUI のポートが使用中

```
症状：WebUI が起動しない
根本原因：ポート競合。コンテナのマッピング後も【コンテナ内は 5099 のまま】で、ホスト側は 5199 であることに注意
解決：コンテナ内が 5099 を待ち受けていることを確認する；コンテナ内のポートを変えるのではなく、ホスト側のマッピングポートを変える
関連ソース：findAvailablePort(start, { maxTries: 50, host }) —— 最大 50 個の利用可能なポートを上位へ探す
```

---

### T15 リバース / デバッグ用スクリプトで自分のマシンを落とす

**これは実行時の落とし穴ではなく、保守時の落とし穴です** —— ただし代償が大きいため、独立して扱う価値があります。

#### 症状

```
- 解析スクリプトを実行すると負荷が 37 まで跳ね上がる
- メモリが 2.7 GB まで食われる
- 端末に 10 MB のテキストが吐き出される
- スクリプトが struct.error で落ちる
```

#### 根本原因（既知の罠一覧）

| # | 罠 | 結果 | 正しい方法 |
|---|---|---|---|
| **T1** | 「定義済みエクスポート」の部分集合を「全シンボル」とみなす | **「dynsym に RTTI は無い」という誤った結論**を導く（実際には 397 個ある） | 常に `readelf -sW --dyn-syms` の原文に戻る |
| **T2** | リテラル `"MSFService"` で typeinfo を検索 | **0 ヒット**（`__type_name` は mangled 名 `N2nt10MSFServiceE`） | `N<len><ns><len><Class>E` パターンで照合する。ログ TAG / JS プロパティ名を除外する |
| **T3** | `.data.rel.ro` の vaddr を file off として扱う | 表全体のオフセットが `0x10000` ずれる | セクションヘッダから `Δ = vaddr − file_off` を計算する。**ハードコードしない** |
| **T4** | `mmap` スライスに対して `b[:z]` を実行し、`z == -1`（NUL なし）になる | **一度に 10 MB の出力**を吐く | 派生文字列を作る前に必ず `z > 0` をアサートする |
| **T5** | `.eh_frame_hdr` のエンコードバイトの解析ミス（pcrel を符号なしとして扱う） | `fde_count=1.8e19` になり → **範囲外アクセス / 無限ループ → OOM（2.7 GB）** | `enc & 0x0f` / `enc & 0x70` で場合分けする。**すべてのループに上限を付ける** |
| **T6** | 「最初の値 == typeinfo のスロット」を primary vtable とする | MSFService には **5 個**のアドレス点があり、選び間違える | **`offset_to_top == 0`** でフィルタして primary を取り出す |
| **T7** | 「プロセスが落ちていない」だけで適配成功と判断する | スロットが 1 つずれる → 黙って誤ったパスに送る → ユーザーには `"The QQ connection changed…"` が見える | **実際にメッセージを送受信する**エンドツーエンド検証を必ず行う |

#### 付随する罠（ツール利用の側面）

| 罠 | 結果 | 正しい方法 |
|---|---|---|
| bundle に NUL バイトが含まれる | `grep -oE` が行を切断する（region が 147 個しか取れない） | `grep -a` を使う。region の抽出は **Python の正規表現**で行う（467 個取れる） |
| `strings` が ARM64 の機械語を文字列と誤認する | 4,519 行のうち約 3,600 行がノイズ | 真の文字列は**第 1–176 行**と**第 3799–4050 行**に集中している |
| bundle に 330 KB の zxcvbn パスワード辞書が埋め込まれている（単一行） | `grep -C` が辞書全体を端末に出力する | `grep -an` で行番号だけ得る。または先に `sed -n 'A,Bp'` で位置を特定する |
| `grep -c <キーワード>` は bundle 上で嘘をつく | `backoff`/`jitter`/`circuit` の「ヒット」はすべてあの 1 行の辞書 | **行番号の分布を見る。件数を見ない**。件数が 1〜3 で、すべて同一行を指すなら → 偽陽性 |
| 長い処理をフォアグラウンドで実行する | SSH が約 10 分のアイドルで切断され、処理も死ぬ | `setsid nohup … &` + `tail -c 800 log \| tr '\r' '\n' \| tail` でポーリング |

#### 鉄則

> **リバース用スクリプトを実行するときは、必ずカウント上限を設けてください。**
> ループの境界を 1 つ書き間違えるだけで、負荷が 37 まで上がり、メモリが 2.7 GB まで食われます。
> すべての `struct.unpack_from` に明示的な `cnt` 上限を付け、`i < cnt` の事前チェックを入れ、
> **大きなオブジェクトを決して stdout に出さない**（すべてファイルに書く）。

---

## 4. 付録 A：`SNOWLUMA_*` 環境変数の完全一覧（36 個）

| 変数 | 用途 |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD_ALL` | `=1` で全 PID の自動注入を許可し、**zygote フィルタを回避**（危険） |
| `SNOWLUMA_HOOK_AUTOLOAD` | `runtime.json` の `hookAutoLoad` を上書き |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | `mojo.*.sock` の所在ディレクトリを指定 |
| `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` | 制御チャネルの ACK タイムアウト（既定 5000） |
| `SNOWLUMA_PACKET_TIMEOUT_MS` | 業務パケットのタイムアウト |
| `SNOWLUMA_SESSION_RELEASE_DEADLINE_MS` | セッション解放の期限 |
| `SNOWLUMA_STREAM_DIR` | ストリームダウンロードの保存先ディレクトリ（不正なら warn して無視） |
| `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` | バイナリダウンロードのサイズ上限 |
| `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` | HTTP ダウンロードのタイムアウト |
| `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS` | `download_file` アクションのタイムアウト（⚠️ 上記とは別物） |
| `SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS` | 通知 webhook のタイムアウト |
| `SNOWLUMA_UPDATE_ROOT` | 更新ルートディレクトリ（開発 / テスト用の更新フロー） |
| `SNOWLUMA_UPDATE_CHECK` | 更新チェックを行うか（**上流のリポジトリ削除後は 0 を推奨**） |
| `SNOWLUMA_WEBUI_PORT` | WebUI ポート（既定 5099） |
| `SNOWLUMA_WEBUI_HOST` | WebUI のバインドアドレス |
| `SNOWLUMA_WEBUI_TARGET` | UI テーマのプリセット。**唯一の正当な値は `maibot`** |
| `SNOWLUMA_WEBUI_TLS` | `webuiTls.enabled` を上書き |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | `trustProxy` を上書き |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | 初回起動時に WebUI パスワードを注入（**8 文字未満は無視**） |
| `SNOWLUMA_ONEBOT_HTTP_PORT` | OneBot HTTP ポート |
| `SNOWLUMA_ONEBOT_WS_PORT` | OneBot WS ポート |
| `SNOWLUMA_ONEBOT_HOST` | OneBot のバインドアドレス（本番インスタンスは `0.0.0.0`） |
| `SNOWLUMA_LOG_DIR` | ログディレクトリ（既定 `/app/data/logs`） |
| `SNOWLUMA_LOG_FILE` | `=0` でファイルログを無効化 |
| `SNOWLUMA_LOG_LEVEL` | コンソールのレベル。既定 `info` |
| `SNOWLUMA_LOG_FILE_LEVEL` | ファイルのレベル。`debug/info/success/warn/error` のみ |
| `SNOWLUMA_LOG_MAX_MB` | 単一ファイルの上限 |
| `SNOWLUMA_LOG_MAX_TOTAL_MB` | ログ総量の上限（既定 1024） |
| `SNOWLUMA_LOG_RETAIN_DAYS` | ログの保持日数（既定 7） |
| `SNOWLUMA_LOG_PER_UIN` | uin ごとにファイルを分ける |
| `SNOWLUMA_TRACE_BUFFER` | トレースバッファの件数 |
| `SNOWLUMA_VERBOSE_WARMUP` | `=1` でウォームアップの詳細を出力 |
| `SNOWLUMA_DEV_MODE` | 開発モード（`snowluma-dev` の固定パスワードを使う） |
| `SNOWLUMA_DEV_WEBUI` | 開発モードの WebUI |
| `SNOWLUMA_DEV_NO_NATIVE` | `=1` で native addon を stub に置き換え |
| `SNOWLUMA_ACCEPT_EULA` | 非対話で EULA に同意 |
| `SNOWLUMA_ACCEPT_PRIVACY` | 非対話でプライバシーポリシーに同意 |
| `SNOWLUMA_HOME` / `SNOWLUMA_DATA` | 実行ディレクトリ / データディレクトリ（本番：`/app/runtime` / `/app/data`） |
| `SNOWLUMA_UID` / `SNOWLUMA_GID` | コンテナ内の実行 ID（本番：1000/1000） |
| `SNOWLUMA_SCREEN` | Xvfb の画面サイズ（本番：`1920x1080x24`） |
| `SNOWLUMA_QQ_FLAGS` | QQ に渡す起動パラメータ |
| `SNOWLUMA_EXTRA_QQ_HOMES` | 追加の QQ HOME ディレクトリ |
| `QQ_RECV_HEARTBEAT_CMD` | **【未解明】** QQ の受信ハートビートコマンド名と推定 |

> ⚠️ **`SNOWLUMA_HOOK_RUNTIME_DIR` のクロスプロセス経路は `/proc/<pid>/environ` が読めることに依存します** ——
> 同一 uid なら可能ですが、**uid が異なると失敗します**。【未解明】

---

## 5. 付録 B：`runtime.json` の完全なフィールド

```jsonc
{
  "webuiPort": 5099,          // WebUI 端口
  "hookAutoLoad": false,      // ★ 自动注入开关（生产实例为 false）
  "webuiHost": "0.0.0.0",     // ★ 0.0.0.0 = 对外暴露，建议改 127.0.0.1 + 反代
  "webuiTls": { "enabled": false },   // TLS（src/webui/tls.ts 已就绪）
  "trustProxy": "",           // 反代时填，影响 client-ip 判定
  "logMaxTotalMb": 1024,
  "logRetainDays": 7,
  "logPerUin": false
}
```

> **ホットリロード可能なフィールド**：`hookAutoLoad` / `webuiTls.enabled` は**ブール値ホワイトリスト**です。
> それ以外のフィールドはファイル変更後に**再起動が必要**です。

---

## 6. 付録 C：一言で覚える切り分けの心得

```
① まずヘルスチェック:  コンテナが生きている → unresolved=0 → socket がある → ポートが通る → フィンガープリントが一致
② ログを見る:          grep -c unresolved     （0 = 正常）
③ 再起動しない:         QQ の再起動 = ログイン状態の喪失 = QR コードの読み取り直し
④ 設定変更:            WebUI API 経由で行う。ファイルは変更しない（ホットリロードなし）
⑤ ポート不通:          curl を使う。/dev/tcp は使わない
⑥ フィンガープリントが変わった: QQ がアップグレードされた → dump-vtable.py --diff を実行
⑦ 適配完了:            実際にメッセージを 1 通送受信すること。「プロセスが落ちていない」だけでは不十分
```

---

## 7. 関連ドキュメント

| 知りたいこと | 参照先 |
|---|---|
| 実際にどう動いているのか | [architecture.md](architecture.md) |
| どのバージョンをサポートし / 何に依存するか | [compatibility.md](compatibility.md) |
| ソースからビルドする方法 | [build.md](../dev/build.md) |
| 開発に参加する方法 | [contributing.md](../dev/contributing.md) |

---

*本書のコマンドとエラーメッセージはすべて実測に基づきます。証拠の等級は元の表記を保持します：
【確証】直接の証拠あり /【強い推論】複数の証拠が交差 /【推論】合理的だが未検証 /【未解明】明確な知識の空白。*
