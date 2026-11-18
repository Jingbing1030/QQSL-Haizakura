# ログインについて

> [!WARNING]
> この内容はすべて AI が作成したものです。慎重に確認してください。

> **ひとことで**：Haizakura には**独自のログインフローがありません**。コンテナ内の
> **公式 QQ クライアント**を **noVNC** 経由で遠隔操作してログインを完了させて
> はじめて、Haizakura は動作を開始できます。

---

## 1. なぜそうなっているのか

これは Haizakura のアーキテクチャに由来するものであり、**欠陥ではありません**。

| 期待されるかもしれないもの | 実際 |
| --- | --- |
| `POST /api/login` にアカウントとパスワードを渡す | ❌ **存在しません** |
| QR コードログイン API | ❌ **存在しません**（ソースに QR ログインの実装は一切ありません） |
| 内蔵のヘッドレス高速ログイン | ❌ 非対応 |

**理由**：Haizakura は**公式 QQ がすでに確立した MSF セッション**に寄生します。
ログインプロトコルを実装せず、パスワードを暗号化せず、検証コードも処理しません ——
それらは**すべてテンセント自身の QQ クライアントが担当します**。したがって、
その実際の QQ ウィンドウを操作する機会をあなたに用意する必要があるのです。

【確証】ソースに残る元のプロンプト文字列（注入された `.so` 由来）：

```
"not logged in: wait until QQ completes login"
"logged-in MSF service instance is missing"
"QQ is not ready. Please finish signing in and try again."
```

**これら 3 つの文が現れるタイミング**：OneBot のアクションを呼び出したが QQ がまだログインしていないとき。

---

## 2. コンテナ内のリモートデスクトップスタック

【実測】entrypoint が起動するグラフィックスタック（`/root/start.sh`）：

```
Xvfb :1 (1920x1080x24)          ← 虚拟显示器
    ↓
fluxbox                         ← 窗口管理器
    ↓
x11vnc :5900                    ← VNC 服务（密码 /root/.vnc/passwd）
    ↓
noVNC websockify :6081          ← 把 VNC 转成浏览器可访问的 WebSocket
    ↓
你打开 http://<IP>:6181          ← 在浏览器里看到 QQ 窗口
```

| コンポーネント | ポート | 説明 |
| --- | ---: | --- |
| **noVNC** | `6081` | ✅ **これを使う**（ブラウザーから直接アクセス） |
| x11vnc | `5900` | 生の VNC。任意の VNC クライアントで接続可能 |
| Xvfb | `:1` | 仮想スクリーン。解像度は `SNOWLUMA_SCREEN` で制御（既定 `1920x1080x24`） |

---

## 3. ログイン手順

### 3.1 VNC パスワードを見つける

**方法 1：コンテナログを見る**（初回起動時に出力されます）

```bash
docker logs haizakura 2>&1 | grep -i "远程桌面密码\|remote desktop password"
```

出力は次のような形式です。

```
远程桌面密码: <15字节随机串>
remote desktop password: <15字节随机串>
```

**方法 2：ファイルを読む**（root のみである点に注意）

```bash
docker exec haizakura cat /app/data/config/vnc-password
```

> ⚠️ **ログは「パスワードが新規生成された」ときにのみ出力されます**。パスワードが
> すでに存在する場合、再起動しても出力されません —— その場合は方法 2 を使うか、
> 自分で設定した `VNC_PASSWD` を使ってください。

### 3.2 noVNC を開く

ブラウザーでアクセスします。

```
http://<你的服务器IP>:6181
```

> ⚠️ **よくある落とし穴：ブラウザーが http を強制的に https へ昇格させる。**
> そのブラウザーで以前に https のサイトを閲覧していると、**HSTS** が
> `http://ip:6181` を自動的に `https://ip:6181` へ書き換え、接続が失敗することがあります。
>
> **対処**：**IP のみ**を使う（ドメイン名は使わない）、別のブラウザーに変える、
> またはその IP の HSTS 記録を削除してください。

「接続」をクリックし、§3.1 のパスワードを入力します。

### 3.3 noVNC で QQ にログインする

QQ のログインウィンドウが表示されたら：

1. **QR コードログイン** または **アカウント・パスワードログイン**を選ぶ（QQ 自身の画面であり、バージョンによって変化します）
2. **スマートフォンの QQ で QR コードを読み取る**のが最も安定した方法です
3. デバイス検証 / SMS 検証がある場合は、QQ の指示に従って完了する
4. QQ が**メイン画面に入る**（フレンドリストが見える）まで待つ

> 💡 **シンボリックリンクのヒント**：ウィンドウが小さすぎたり、解像度が合わなかったり
> することがあります。`SNOWLUMA_SCREEN`（例：`1440x900x24`）を調整してコンテナを
> 再作成できます —— ただし**再作成 / 再起動でログイン状態が失われる**点に注意して
> ください（§5 参照）。

### 3.4 Haizakura がアカウントを認識したことを確認する

**数十秒待ちます**（QQ のログイン後、Haizakura がアカウントを検出してセッションを確立する必要があります）。

**方法 1：WebUI**

`http://<IP>:5199` を開くと、「アカウント」ページにあなたの QQ 番号が表示されるはずです。

**方法 2：API**

```bash
curl -s http://127.0.0.1:3010/get_login_info
```

**成功**：

```json
{
  "status": "ok",
  "retcode": 0,
  "data": { "user_id": 123456789, "nickname": "你的昵称" }
}
```

**失敗**（QQ のログインがまだ完了していないことを示します）：

```json
{ "status": "failed", "retcode": 1, "wording": "QQ is not ready. Please finish signing in and try again." }
```

**方法 3：ステータスコマンド**

ボットにメッセージを 1 通送ります（プライベートまたはグループ）：

```
#Haizakura
```

正常であれば次のように返信されます。

```
Haizakura 状态
版本: 0.2.4.2
平台: linux-x64
运行时长: 3小时 12分钟
```

> トリガーワードは設定可能です。[完全な設定説明](configuration.md)を参照してください。
> 本インスタンスは `#hz` に変更されています。

---

## 4. 複数アカウント

### 4.1 アーキテクチャ

Haizakura は**複数アカウントをネイティブにサポート**し、各アカウントは独立した一式です。

| 次元 | 分離方式 | 実測パス |
| --- | --- | --- |
| 設定 | アカウントごとに 1 ファイル | `config/onebot_<uin>.json`（`600`） |
| メッセージストア | アカウントごとに 1 ディレクトリ | `data/<uin>/messages.db` |
| リアクションストア | 同上 | `data/<uin>/reactions.db` |
| ネットワークアダプター | アカウントごとに独立 | それぞれの `httpServers` / `wsServers` / … |

**共有される**もの（グローバルレベル）：

| ファイル | 説明 |
| --- | --- |
| `config/onebot.json` | グローバルな OneBot 設定（各アカウントへ継承されます。ただしそのアカウントが `snapshot` モードの場合を除く） |
| `config/snowluma.json` | `rkey.fallbackServers` / `musicSignUrl` / `videoUploadConcurrency` |
| `config/notifications.json` | 通知チャネルの定義 |
| `config/runtime.json` | WebUI / ログ / hook スイッチなどのランタイム設定 |

### 4.2 コンテナ内で複数の QQ を起動する

【確証】`SNOWLUMA_EXTRA_QQ_HOMES` で追加の QQ HOME を指定します（**カンマ区切り**）：

```bash
docker run ... \
  -e SNOWLUMA_EXTRA_QQ_HOMES="/app/qq2,/app/qq3" \
  motricseven7/snowluma:latest
```

**entrypoint の挙動**（`/root/start.sh`）：

| 規則 | 説明 |
| --- | --- |
| パスは `/app/` の下でなければならない | そうでなければ**スキップして警告を出力** |
| 文字の制限 | `A-Za-z0-9_@%+=:,./-` のみ許可。それ以外はスキップ |
| ディレクトリの自動作成 + 所有者変更 | `mkdir -p` + `chown snowluma` |
| **起動をずらす** | N 番目のインスタンスは `sleep (N-1)*10` 秒。リソースの同時奪い合いを避ける |
| 独立した supervisor プログラム | `qq-extra-1`、`qq-extra-2`… |

**【実測】** ログには次のように出ます。

```
Configured 2 extra QQ instance(s): /app/qq2,/app/qq3
```

**では**：各 QQ インスタンスはそれぞれ自分のウィンドウを持つのでしょうか。

> ⚠️ **【未確認】** 複数の QQ インスタンスは同じ Xvfb `:1` ディスプレイを共有します。
> それらは**同じ noVNC デスクトップ内にそれぞれウィンドウを開き**、fluxbox で
> 切り替えることになります。この点について**複数インスタンスの状況は未実測**です。
> 実際の挙動を優先してください。

### 4.3 アカウントはどのように検出されるのか

【確証】この部分の設計はかなり巧妙で、**root を必要としません**。

```
① 定位 QQ 的数据库文件
   Linux: ~/.config/QQ/<uid-hash>/nt_db/nt_msg.db
   注意 accountDirName(uid) 做了目录名映射

② 找出「谁持有这个库」
   Linux: 读 /proc/locks，按 <dev>:<inode> 匹配
          → 读 /proc/<pid>/comm → 用 isQqProcessName() 过滤（"qq" / "QQ.exe"）
   Windows: 走 addon 的 getFileHoldersAsync()（内核句柄枚举）
```

**QQ が排他ロックしているデータベースファイルから逆にプロセスを特定する** ——
これはプロセス名を列挙するよりはるかに信頼できます。

### 4.4 ログイン状態の維持

| 仕組み | 定数 / 値 | 説明 |
| --- | --- | --- |
| ログイン調整ポーリング | `LOGIN_RECONCILE_INTERVAL_MS = 3000` | 3 秒ごとに 1 回整合を取る |
| アイデンティティ観察 | `LOGIN_IDENTITY_OBSERVE_INTERVAL_MS = 30000` | 30 秒ごとに観察 |
| アイデンティティ報告 | `op=17` フレーム | `sendAckOnly(17, BigInt(uin), …)` |

> **ソースコメント原文**：「This does not change login state;
> readiness still requires peer confirmation.」
> つまり：ローカルでアイデンティティを報告しても**ログイン成功とは限らず**、
> 相手側の確認を待つ必要があります。

【確証】QQ のデータディレクトリには次が含まれます。

```
/app/.config/QQ/auth/login.enc          ← 登录凭据（加密）
/app/.config/QQ/global/nt_db/login.db   ← 登录数据库
```

---

## 5. ⚠️ 重大なリスク：再起動でログイン状態が失われる

**【実測】これは私たちが実際に踏んだ落とし穴であり、本番の bot が 8 時間停止しました。**

### 5.1 症状

**コンテナを再起動すると、QQ は再度 QR コードログインが必要になります。**

原因：`/app/.config/QQ/auth/login.enc` 内の `loginList` が空にされます。

### 5.2 影響

```
重启容器
   ↓
QQ 登录态丢失
   ↓
Haizakura 拿不到 MSF 会话
   ↓
所有 OneBot 动作返回 "not logged in"
   ↓
⛔ bot 完全不可用，直到有人重新扫码
```

**そして QR コードの読み取りには人手が必要です**（noVNC を開いてスマートフォンで
読み取る必要があります）—— **これが深夜に起きれば、8 時間の停止です。**

### 5.3 どうするか

| 原則 | 方法 |
| --- | --- |
| **不要なら再起動しない** | 設定変更は **WebUI / API のホットリロード**を優先し、コンテナを再起動しない |
| 再起動が必要なとき | **QR コードを読み取れる人がいる時間帯を確保する** |
| 再起動の前 | 手元に QR コードを読み取れるスマートフォンの QQ があることを確認する |
| 長期的な対策 | 【未確認】ログイン状態の永続化の安定性を研究する。コンテナを再作成しない方法で `docker restart` を避けることを検討する |

> ⚠️ **注意**：`docker restart` と `docker stop/start` のいずれでも発生し得ます。
> **`--restart unless-stopped` ポリシー下でのホスト再起動**でも同様です。
> あなたの業務が停止を受け入れられないなら、**「再起動後は再 QR コードログインが
> 必要」を既定の事実として対策を設計しなければなりません**。

### 5.4 どの変更がホットリロードされるか

| 変更 | ホットリロード | 方法 |
| --- | --- | --- |
| OneBot ネットワーク設定 | ✅ **ホットリロード** | `POST /api/config/:uin`（WebUI で保存すればよい） |
| `statusCommand` | ✅ **ホットリロード** | 同上 |
| `notifications` | ✅ **ホットリロード** | `POST /api/notifications/config` |
| `snowluma.json` のグローバル設定 | ✅ ホットリロード | `POST /api/global-config` |
| `ui.json` の外観 | ✅ ホットリロード | `POST /api/ui` |
| **`historySync.enabled`** | ❌ **起動時のみ読み込み** | ⚠️ 再起動が必要 → **ログイン状態が失われる** |
| **`runtime.json` のほとんど** | ⚠️ 【未確認】 | コードを見る限り起動時に読み込み。`updateRuntimeConfig` はディスクへ書くだけ |
| **`.env` / コンテナ環境変数** | ❌ コンテナの再作成が必要 | ⚠️ **ログイン状態が失われる** |
| **コード（`index.mjs`）** | ❌ 再起動が必要 | ⚠️ **ログイン状態が失われる** |
| ログレベル | ✅ ホットリロード | `POST /api/logs/level` |
| hook のロード / アンロード | ✅ ホットリロード | `POST /api/processes/:pid/load` / `unload` |

> 💡 **結論**：**日常的な設定変更のほとんどは再起動を必要としません**。
> 必要なのは `historySync` とコンテナレベルの変更だけであり、それらはちょうど
> 最も痛いものです。

---

## 6. ログイン関連のトラブルシューティング

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| noVNC ページが開けない | HSTS による https 強制 / ポートがマッピングされていない | IP のみを使う。`-p 6181:6081` を確認 |
| noVNC に接続できるが黒画面 | Xvfb がまだ起動していない | 数秒待つ。ログに `Timed out waiting for Xvfb` がないか確認 |
| VNC パスワードが違う | 古いログを見ている | `/app/data/config/vnc-password` を読む |
| QQ ウィンドウは出るがログインに失敗する | テンセントのリスク制御 / デバイス検証が必要 | noVNC 内で QQ の指示に従い検証を完了する |
| QQ のログインは成功したが Haizakura が認識しない | まだ調整中（最長 30 秒） | 30 秒待って再試行。ログを確認 |
| **再起動後に再 QR コードログインが必要** | **ログイン状態の喪失（既知の問題）** | §5 参照 |
| アクションがすべて `not logged in` を返す | QQ がログインしていない / ログイン状態を失った | 再ログインする |
| hook が入らない | `SYS_PTRACE` / seccomp の欠如 | [クイックスタート §2.3](quick-start.md) 参照 |
| ログに `unresolved` がある | RTTI の解析失敗（QQ のバージョンが変わった？） | [トラブルシューティング](../advanced/troubleshooting.md) 参照 |

### 6.1 診断コマンド

```bash
# 图形栈是否在跑
docker exec haizakura ps -eo pid,comm | grep -E 'Xvfb|x11vnc|websockify|qq '

# 端口监听
docker exec haizakura ss -lntp | grep -E '5099|3000|3001|5900|6081'

# 登录态文件
docker exec haizakura ls -la /app/.config/QQ/auth/

# hook 健康度（0 = 健康）
docker exec haizakura grep -c unresolved /app/data/logs/*.log

# 账号是否被识别
curl -s -H "Authorization: Bearer <你的令牌>" http://127.0.0.1:3010/get_login_info
```

### 6.2 「QQ はログイン済みなのにアクションが失敗する」ときの確認順序

```
① 等 30 秒（登录协商需要时间）
      ↓
② GET /get_login_info 看返回什么
      ↓
③ 返回 "QQ is not ready" → QQ 界面还没进主界面，回 noVNC 看
      ↓
④ 返回 "logged-in MSF service instance is missing" → hook 没装成功
      → 检查 SYS_PTRACE/seccomp → 检查日志 unresolved
      ↓
⑤ 返回 retcode 0 但某个具体动作失败 → 那是动作本身的问题，
      不是登录问题（见 ../protocol/actions.md）
```

---

## 7. セキュリティ上の注意

| リスク | 説明 | 推奨 |
| --- | --- | --- |
| **noVNC の露出 = QQ の完全な制御** | 接続できればあなたの QQ を操作できる | **公網へ露出しない**。ファイアウォール / イントラネット / VPN を使う |
| VNC パスワードが**唯一**の障壁 | 二要素認証なし | 強力なパスワードを使う（`VNC_PASSWD` で明示指定） |
| ログイン資格情報がボリューム内にある | `login.enc` は機密ファイル | ボリュームをバックアップする際は暗号化に注意 |
| WebUI が既定で外部に開いている可能性 | [設定説明](configuration.md) 参照 | `webuiHost` を `127.0.0.1` に変更し、リバースプロキシを併用 |

**推奨する方法**：

```bash
# 只在需要登录时临时暴露 noVNC 端口，登录完就关掉
docker run ... -p 6181:6081 ...   # 登录期间
# 登录完成后，重建容器时去掉 -p 6181:6081
```

> ⚠️ ただしコンテナの再作成は**ログイン状態を失います**（§5）—— したがって
> トレードオフが必要です。より現実的な方法は、ポートマッピングを外すのではなく
> **ファイアウォールで接続元 IP を制限する**ことです。