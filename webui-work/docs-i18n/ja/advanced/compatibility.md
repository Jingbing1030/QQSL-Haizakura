# 互換性マトリクス

> [!WARNING]
> 本内容は全面的に AI が作成したものです。慎重に確認してください。

> **対象読者**：Haizakura（旧名 SnowLuma）の導入やアップグレードを予定している運用担当者、および新しい QQ バージョンへの適応を担うメンテナー。
> **本文が答えること**：どんな環境で動くのか？ 依存する正確なバージョンは何か？ QQ がアップグレードされたらどうなるか、何を変更すべきか？
> **最も重要な一点**：**QQ のバージョンは固定すること。自動アップグレードしないこと。** 理由は §7 を参照。

---

## 0. クイックセルフチェック

```bash
# ① QQ 版本对不对
docker exec <容器> sh -c 'grep -m1 -o "\"version\": \"[^\"]*\"" /opt/QQ/resources/app/package.json'
# 期望： "version": "3.2.32-52194"

# ② wrapper.node 指纹对不对（最关键）
docker exec <容器> sh -c 'md5sum /opt/QQ/resources/app/wrapper.node'
# 期望： adeb40af26d859d41fcdb21bf38d9eb5

# ③ Node 版本过闸门
docker exec <容器> node -v
# 期望： v24.22.2（满足 ^24.22.1 || >=26.12.1）

# ④ hook 健康度（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
```

いずれかが一致しない場合は、該当する章を参照してください。

---

## 1. バージョンベースライン（引き継ぎ時に必ず記録）

**これはすべてのずれの基準系です。** すべてのアドレス、スロット、構造レイアウトはこの指紋群に基づきます。

### 1.1 コアバージョン

| 項目 | 値 |
|---|---|
| **QQ バージョン** | `3.2.32-52194`（Linux arm64） |
| `wrapper.node` のサイズ | **144,561,472** バイト |
| `wrapper.node` の md5 | **`adeb40af26d859d41fcdb21bf38d9eb5`** |
| `wrapper.node` の build-id | **`89c36b520f97c88081a9453bd6abb70c3452f156`** |
| SnowLuma / Haizakura runtime | **0.2.4.2** |
| hook stub の自称バージョン | `snowluma-linux-hook-stub/0.2.0` |
| Node | **24.22.2** |
| コンテナイメージ | `motricseven7/snowluma:latest`（2.69 GB、arm64） |

### 1.2 native 成果物の sha256

```bash
cf8183755e7b912149c045f93bd6010feeeaa170fff0580d7013d62b6347da00  snowluma-linux-arm64.node
238ff3c348d98a42e49662f58fbd4404f89b9a65a7fc6e56c1775e2740d3f13e  snowluma-linux-arm64.so
b705b7e2392a75cdde95a146f933a7d472b4c72709f35f707a0798f9fcdf9e19  websocket-linux-arm64.node
```

> ⚠️ **`wrapper.node` の build-id は、バージョン間を区別する唯一の信頼できる指紋です。**
> ファイルサイズより正確で（サイズは変わります）、実行時検証には md5 より適しています（md5 は 144 MB 全体を読む必要がありますが、
> build-id は `0x200` の 36 バイトを読むだけです）。
> `89c36b52…` は**まさに `.so` 内の `missing or ambiguous GNU build ID` 検証が対象とする値**です。

### 1.3 wrapper.node の主要セクションアドレス

```
[12] .text           PROGBITS  083d780   83d780   5e1ff10
[15] .rodata         PROGBITS  665d900   665d900   994a46    ← vaddr == file off ✅
[23] .data.rel.ro    PROGBITS  86acb60   869cb60   32e5a8    ← vaddr ≠ file off ⚠️
[24] .dynamic        DYNAMIC   89db108   89cb108   2c0

.note.gnu.build-id   @ vaddr 0x200 / file 0x200，段大小 0x24
                     NT_GNU_BUILD_ID 描述符 0x14 (20) 字节

Δ = .data.rel.ro 的 (vaddr − file_off) = 0x10000
```

> **Δ 自体は固定ではなく、バージョンが変われば変化します** —— セクションテーブルから計算する必要があり、ハードコードできません。詳細は
> [architecture.md §6.3](architecture.md) を参照してください。

### 1.4 ベースラインの主要構造

```
nt::MSFService
  RTTI 名 (mangled) : N2nt10MSFServiceE       @ .rodata 0x677ecaa
  typeinfo          : 0x87177e0
  vtable            : 0x87173e0 (offset_to_top=0, 44 槽) + 4 套次 vtable
  SessionInit       : v[19] +0x098 → 0x137a48c
  SendSSOReqInternal: v[36] +0x120 → 0x137cc80

nt::MSFCoreService
  RTTI 名 (mangled) : N2nt14MSFCoreServiceE   @ .rodata 0x67818e1
  typeinfo          : 0x87193f8
  vtable            : 0x8718f58 (offset_to_top=0, 52 槽) + 5 套次 vtable
  SessionInit       : v[19] +0x098 → 0x139d864
  onMSFPacketState  : v[47] +0x178 → 0x13a3e80
```

---

## 2. 対応プラットフォーム

### 2.1 Linux arm64 のみ

| プラットフォーム | 対応状況 | 説明 |
|---|---|---|
| **Linux arm64 (aarch64)** | ✅ **唯一ビルド成果物があるプラットフォーム** | 5 つすべての native 成果物が arm64 |
| Linux x86_64 | ❌ | 実測時のエラー：`No hook native addon found for linux-x64` |
| Windows | ⚠️ コードパスはあるが**成果物なし** | 名前付きパイプ + `getFileHoldersAsync` を使う。DLL が必要で未公開 |
| macOS | ⚠️ コードパスはあるが**成果物なし** | `DYLD_INSERT_LIBRARIES` を使う。dylib が必要で未公開 |

**アーキテクチャを変えるには 5 つすべての native 成果物が必要** —— これは非常に工数のかかる作業であり、**推奨しません**。

### 2.2 Linux arm64 の実測環境

```
架构        aarch64
发行版      Debian GNU/Linux 12 (bookworm)（容器内）
Electron    40.0.0（QQ 自带）
X 显示      Xvfb :1 -screen 0 1920x1080x24
窗口管理    fluxbox
VNC         x11vnc + noVNC（6081 端口，扫码登录用）
```

### 2.3 必要となる Linux カーネル機能

| 機能 | 必要な理由 | 欠けた場合の症状 |
|---|---|---|
| `ptrace` | インジェクターが QQ プロセスにアタッチする | 注入失敗 |
| `process_vm_readv` / `process_vm_writev` | 対象プロセスのメモリを読み書きする | `QQ runtime cannot read process memory` を報告 |
| `/proc/<pid>/maps` が読めること | `wrapper.node` のロードベースを探す | `module not found in target process maps` を報告 |
| `/proc/<pid>/environ` が読めること | プロセスを跨いで `SNOWLUMA_HOOK_RUNTIME_DIR` を読む | **同一 uid なら可、uid を跨ぐと失敗** 【未確認】 |
| `/proc/locks` が読めること | アカウントデータベースの保持者を特定する（root 不要） | アカウント検出失敗 |

---

## 3. Node バージョンの要件

### 3.1 ゲートのロジック

`/app/runtime/check-node-version.cjs` の**原文ロジック**：

```js
const SUPPORTED_NODE_RANGE = '^24.22.1 || >=26.12.1';

function isSupportedNodeVersion(version) {
  const [major, minor, patch] = parseNodeVersion(version);
  if (major === 24) return minor > 22 || (minor === 22 && patch >= 1);
  if (major === 26) return minor > 12 || (minor === 12 && patch >= 1);
  return major > 26;
}
```

`package.json` の `engines`：

```json
{ "node": "^24.22.1 || >=26.12.1", "pnpm": "11.25.0" }
```

**意味の展開**：

| Node メジャーバージョン | 要件 | 説明 |
|---|---|---|
| 24 | `>= 24.22.1` | 24.22.0 以下は ❌ |
| **25** | ❌ **非対応** | `^24` と `>=26.12.1` の外側に落ちる |
| 26 | `>= 26.12.1` | |
| > 26 | ✅ 通過 | |
| < 24 | ❌ | |

> ⚠️ **Node 25 は空白地帯です** —— `^24.22.1` も `>=26.12.1` も満たしません。

### 3.2 実測

```
容器内实测：v24.22.2   ✅ 通过
```

### 3.3 Node バージョンを勝手に変えられない理由

| 理由 | 説明 |
|---|---|
| **N-API バージョンの制約** | `@appthreat/sqlite3` は Node ≥24 かつ **NAPI ≥10** を要求 |
| **ゲートが遮る** | 満たさない場合 `check-node-version.cjs` が直接 `exitCode = 1` にする |

> **Node バージョンを変える → `check-node-version.cjs` を変える**（🟢 低難度）。ただし先に N-API の互換性を確認してください。

---

## 4. 依存関係の一覧

### 4.1 実行時依存：15 個のインライン化されたサードパーティパッケージ

成果物は**自己完結した単一ファイル**であり、`package.json` に明記されています：
*"There are intentionally NO runtime npm dependencies; production artifacts are self-contained"*。

バージョン番号は**`.pnpm` の region パスから直接読み出します**（例：`hono@4.13.13`）—— これが**権威ある値**です。

| パッケージ名 | **正確なバージョン** | 所属パッケージ | 用途 |
|---|---|---|---|
| `hono` | **`4.13.13`** | core, protocol, onebot | HTTP フレームワーク（WebUI バックエンド） |
| `@hono/node-server` | **`2.1.5`** | core | Hono の Node アダプター |
| `otpauth` | **`9.5.1`** | core | WebUI ログインの TOTP |
| `tar` | **`7.5.22`** | core | update の展開 |
| `fflate` | **`0.8.3`** | core | zlib 圧縮（update） |
| `semver` | **`7.7.4`** | core, common | バージョン比較 |
| `@zxcvbn-ts/core` | **`4.1.2`** | core | パスワード強度（WebUI） |
| `@zxcvbn-ts/language-common` | **`4.1.3`** | core | zxcvbn の辞書 |
| `@zxcvbn-ts/dictionary-compression` | **`3.0.1`** | core | zxcvbn 辞書の圧縮 |
| `fastest-levenshtein` | **`1.0.16`** | core | 文字列距離 |
| `htmlparser2` | **`10.0.0`** | protocol | HTML 解析（メッセージ要素） |
| `entities` | **`6.0.1`** | protocol | 実体のエンコード／デコード |
| `domhandler` | **`5.0.3`** | protocol | htmlparser2 の依存 |
| `domutils` | **`3.2.2`** | protocol | htmlparser2 の依存 |
| `domelementtype` | **`2.3.0`** | protocol | htmlparser2 の依存 |

**すべて公開取得可能で、プライベートパッケージも認証も不要です。** 実測：

```bash
npm config set registry https://mirrors.tencentyun.com/npm
npm install
# → added 29 packages in 15s  ✅
```

### 4.2 ⚠️ ★ バージョンは正確に固定すること —— `^` を使わない

**これは実際に踏んだ穴です**：キャレット範囲（`^4.13.13`）で一度インストールしたところ、
npm が解決したバージョンが**バンドル内と一致せず**、**6 個のパッケージがずれました**：

| パッケージ | バンドル内 | `^` で入るもの | 判定 |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ ずれ |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ ずれ |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ ずれ |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ ずれ |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ ずれ |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ ずれ |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ ずれ |
| `fflate` | `0.8.3` | `0.8.3` | ✅ |
| `@zxcvbn-ts/language-common` | `4.1.3` | `4.1.3` | ✅ |
| `@zxcvbn-ts/dictionary-compression` | `3.0.1` | `3.0.1` | ✅ |
| `fastest-levenshtein` | `1.0.16` | `1.0.16` | ✅ |
| `entities` | `6.0.1` | `6.0.1` | ✅ |

> **ルール：`"hono": "4.13.13"` と書き、`"hono": "^4.13.13"` とは書かない。**
> そうしないと、成果物を再ビルドしたときの挙動が本番と一致しない可能性があります。

> ⚠️ **リバースエンジニアリングしたプロジェクトの現在の `package.json` は依然として `^` を使っています** ——
> これは既知の修正待ち項目です。[contributing.md](../dev/contributing.md) を参照してください。

### 4.3 ビルド時の依存

| パッケージ | バージョン要件 | 説明 |
|---|---|---|
| `typescript` | `5.9.x`（元は `catalog:`、復元時に固定値化） | 型チェック |
| `rolldown` | **`≤ 1.1.8`** | この範囲だけが `//#region` を出力する（§4.4 参照） |
| `pnpm` | `11.25.0` | workspace 管理 |

**ビルド時の任意ツール**（元プロジェクトにはあったが未復元）：`eslint` / `prettier` / `vitest` 一式。

### 4.4 rolldown のバージョンマトリクス

| rolldown | 出力される region コメントの形式 | 使えるか |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **1.1.8 を推奨** |
| `1.2.16` | `// <path>`（`#region` なし） | ❌ 形式が変化 |
| `1.3.2` | `// <path>` | ❌ しかも `inlineDynamicImports` が非推奨 |

> **元プロジェクトが使っていた rolldown のバージョンは正確には特定できません**（バンドルにバージョン刻印がない）。**`≤1.1.8`** に絞るしかありません。

### 4.5 native プラグインの依存マトリクス

バンドルはあくまで**ローダー**であり、実際のバイナリは中に含まれません。実行時にプラットフォームとアーキテクチャからファイル名を組み立てて探します：

| 用途 | ファイル名のパターン | 探索位置 | インターフェース契約 |
|---|---|---|---|
| **Hook 注入 + hook バックエンド** | `snowluma-{platform}-{arch}.node`<br>`snowluma-{platform}-{arch}.so` | `<moduleDir>/native`<br>`<moduleDir>/../../runtime/native` | 6 個のエクスポート関数（architecture.md §4.3 参照） |
| WebSocket 高速化 | `websocket-{platform}-{arch}.node` | 同上 | サードパーティ（`ws` の任意アドオン）。`SNOWLUMA_DEV_NO_NATIVE=1` で stub 化可能 |
| SQLite ドライバー | `@appthreat+sqlite3.{glibc,musl}.node` | `native/sqlite/prebuilds/{platform}-{arch}/` | **`NATIVE_INTERFACE_VERSION === 1`** + `Database` / `Statement` / `OPEN_READONLY=1` / `OPEN_READWRITE=2` / `OPEN_CREATE=4` / `OPEN_FULLMUTEX=65536` |
| 音声トランスコード | `ffmpegAddon.{platform}.{arch}.node` | `native/ffmpeg/` | 3 個のメソッド：`convertToNTSilkTct` / `decodeAudioToFmt` / `getDuration` |
| QQ アカウントデータベースの復号 | `wrapper.node` / `wrapper.linux.node` | QQ のインストールディレクトリ | 読み取り専用の位置特定のみで復号はしない（`sqlcipher.ts` が自前で復号を実装） |

**パス解決のロジック**（`packages/common/src/native-path.ts`）：

```js
function resolveRuntimeNativePath(fileName) {
  for (const directory of [
    path.join(moduleDir, "native"),
    path.resolve(moduleDir, "..", "..", "runtime", "native"),
  ]) {
    const candidate = path.join(directory, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
```

**SQLite の libc 選択**：実行時の libc に応じて `glibc` か `musl` の prebuild を選び
（`runtimeLibc()`）、`assertBinding()` でインターフェースのバージョンを検証します ——
**SQLite のバージョンを差し替えるときは、このインターフェースを変えないでください**。

> **`vendor-regions/`（99 ファイル）は比較用の参考にすぎません** —— これらは**すでに rolldown でフラット化された後**の姿であり、
> クリーンな上流の ESM ソースではありません。正しい方法は `npm install` で実際のパッケージを取得することです。

---

## 5. コンテナ実行時の要件

### 5.1 ★ 必須のカーネル機能（欠けると起動失敗）

```bash
docker run \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

| パラメーター | 必須の理由 | 欠けた場合の症状 |
|---|---|---|
| `--cap-add SYS_PTRACE` | インジェクターが `ptrace` で QQ プロセスにアタッチする必要がある | **注入失敗**（hook が無言で効かない） |
| `--security-opt seccomp=unconfined` | 既定の seccomp ホワイトリストが `ptrace` / `process_vm_*` を遮る | **`ExitCode=126`** + `/usr/local/bin/node: Operation not permitted` |

**本番インスタンスでの実測確認**：

```
HostConfig.CapAdd        ["CAP_SYS_PTRACE"]
HostConfig.SecurityOpt   ["seccomp=unconfined"]
```

> **これは最もよくある一度きりの起動失敗の原因です。** 症状はコンテナが即座に終了し、終了コードが 126 ——
> 詳細は [troubleshooting.md](troubleshooting.md) の T5 を参照してください。

### 5.2 ポートマッピング（本番インスタンス）

```
3000/tcp -> 0.0.0.0:3010    (OneBot HTTP)
3001/tcp -> 0.0.0.0:3011    (OneBot WS)
5099/tcp -> 0.0.0.0:5199    (WebUI)
6081/tcp -> 0.0.0.0:6181    (noVNC)
```

### 5.3 環境変数（本番インスタンスでの実測）

```
NODE_VERSION=24.22.2              TZ=Asia/Shanghai
SNOWLUMA_ONEBOT_HOST=0.0.0.0      SNOWLUMA_HOME=/app/runtime
SNOWLUMA_DATA=/app/data           SNOWLUMA_WEBUI_PORT=5099
SNOWLUMA_UID=1000                 SNOWLUMA_GID=1000
SNOWLUMA_LOG_LEVEL=info           SNOWLUMA_SCREEN=1920x1080x24
SNOWLUMA_HOOK_AUTOLOAD=1          SNOWLUMA_EXTRA_QQ_HOMES=
SNOWLUMA_QQ_FLAGS=--disable-gpu --disable-software-rasterizer --disable-gpu-compositing
DISPLAY=:1
```

> 36 個の `SNOWLUMA_*` 環境変数の完全な一覧は [troubleshooting.md](troubleshooting.md) の付録を参照してください。

### 5.4 ボリュームマウント（本番インスタンス）

```
/app/data            ← 持久化：配置、数据库、日志（必须持久化！）
/app/.config         ← QQ 配置（含登录态 —— 重启容器会清空，见 T2）
/app/.local/share    ← QQ 数据
/app/runtime/index.mjs  ← bind mount 覆盖 bundle（部署改动用）
```

> ⚠️ **`/app/.config` に入っているのは QQ のログイン状態です。** これは「単なる設定」ではありません ——
> **QQ プロセスを再起動すると `loginList` が空になり、再び QR コードを読み取る必要があります。** 詳細は
> [troubleshooting.md](troubleshooting.md) の T2（**痛い教訓**）を参照してください。

---

## 6. 設定ファイルのバージョン結合

| ファイル | 権限 | 内容 | バージョンを変えると失効するか |
|---|---|---|---|
| `runtime.json` | 644 | `webuiPort` / `hookAutoLoad` / `webuiHost` / `webuiTls` / `trustProxy` / ログローテーション | いいえ（構造は安定） |
| `onebot.json` | 644 | **グローバル**な OneBot ネットワーク設定 | いいえ |
| `onebot_<uin>.json` | 600 | **アカウントごと**の設定（`mode: "snapshot"`）+ `statusCommand` / `historySync` / `notifications` | いいえ |
| `webui.json` | 600 | `passwordHash` / `passwordSalt`（scrypt）/ `mustChangePassword` | いいえ |
| `ui.json` | 644 | WebUI の外観とレイアウト | いいえ |
| `consent.json` | 644 | `{ version, acceptedAt }` | ⚠️ **EULA/PRIVACY が更新されると `version` が変わり → 再度同意を要求** |
| `machine-id` | 644 | 32 桁の十六進マシン識別子 | いいえ |
| `notifications.json` | 600 | `{ version: 1, debounceSeconds, channels }` | いいえ |
| `vnc-password` | 600 root | noVNC のパスワード（**Haizakura のロジックとは無関係**） | いいえ |

**データベース**（アカウントごとのディレクトリ `/app/data/data/<uin>/`）：

| ファイル | 所属 | 内容 |
|---|---|---|
| `messages.db` | `onebot/message-store.ts` | メッセージ履歴 / メディア索引 / マイグレーション状態 |
| `reactions.db` | `onebot/reaction-store.ts` | リアクション（顔文字スタンプ）の記録 |
| `snowluma_identity.db` | `bridge/apis/contacts.ts` | ユーザー／グループ／グループメンバーの識別子マッピング |
| `sys-face-catalog.json` | `core/sys-face-catalog.ts` | システム顔文字カタログのキャッシュ（`/app/data/data/` のルートに置かれる） |

> **schema にはバージョン付きマイグレーションがあります**（`classification_version` と `CLASSIFICATION_VERSION` を組み合わせ、
> `PRAGMA table_info` で列ごとに判定してから `ALTER TABLE`）。
> **テーブル構造を変えるときは必ずマイグレーションを書いてください**。既存の `prepare*Schema()` パターンを参考にしてください。

**一括導入時の EULA 自動化**：

```bash
SNOWLUMA_ACCEPT_EULA=1
SNOWLUMA_ACCEPT_PRIVACY=1
```

---

## 7. QQ バージョン結合のリスク

### 7.1 なぜ強く結合するのか

**hook は `wrapper.node` の 4 つの内部的特徴に依存します**：

```
① C++ RTTI 类名（mangled，如 "N2nt10MSFServiceE"）
② vtable 槽位顺序（如 SessionInit 在 v[pos] ap+0x98）
③ 结构体字段偏移（如 msfCoreCallbackOffset）
④ 用于定位的锚点字符串（如 "MSFService::SessionInit"）
```

**この 4 項目のいずれかが変われば hook は失効します。** しかも失敗メッセージは `unresolved` と言うだけで、それ以上の詳細は得られません。

### 7.2 ★ 新しい QQ バージョンへの適応難易度マトリクス

前提：**Haizakura の `.node`（`RuntimeTargets` 定数を含む）と `.so`（汎用エンジン）を保持していること。**
工数は**1 人、本手順に習熟している**前提で見積もっています。

| # | テンセントの変更 | どこが壊れるか | 何を変えるか | 工数 | native の書き直しが必要か |
|---|---|---|---|---|---|
| **0** | **新バージョンを公開しない**（同一ビルド） | — | 何もしなくてよい | **0** | いいえ |
| **1** | **関数の内部実装だけを変更**（クラス名／vtable レイアウト／スロット順は不変） | **何も壊れない**（RTTI 解析は名前 + オフセットで探し、実装は見ない） | **0 変更** | **0** | **いいえ** |
| **2** | **クラス名を変更**（`nt::MSFService` → `nt::MSFServiceV2`） | `.node` 内の typeinfo 名が一致せず → `MSFService SessionInit/RTTI chain unresolved` | `.node` 内の typeinfo 名／断片定数を変更（**文字列レベル**） | **2〜6 時間** | **いいえ** |
| **3** | **vtable のスロット順を変更**（途中で仮想関数を挿入／削除） | スロットオフセットがすべてずれ → 誤った関数ポインタに差し替わる → **クラッシュまたは無言の失効**（最も危険） | 「文字列 → xref → スロット」スクリプトで**すべてのスロットオフセットを再計算**し、`msfCoreCallbackOffset` などを更新 | **0.5〜2 日** | **いいえ**（設定値の変更） |
| **4** | **新しい仮想関数を末尾に追加** | primary vtable の `offset_to_top` は依然 0 で、前のスロットは不変 | **通常 0 変更**（対象関数が元のスロットに残っていれば） | **時間単位の検証** | いいえ |
| **5** | **MSFService に多重継承／仮想基底を追加**（→ `__vmi_class_type_info`） | `.so` は `__cxxabiv117` と `120` しかインポートせず、**121 を認識しない** → 解析が即座に失敗 | **`.so` を `__vmi_class_type_info` レイアウト対応に変更する必要** | **3〜7 日** | **はい** |
| **6** | **`.rodata` のレイアウト変更／`"Xxx::SessionInit"` アンカー文字列の削除** | 文字列アンカーに頼る経路がすべて断たれる | 各対象について**新しく安定したアンカー**を探す（新しいログ文字列、`what()` 文字列、または `.eh_frame` 構造） | **数日〜2 週間** | **はい**（可能性が高い） |
| **7** | **`wrapper.node` が strip される**（`.shstrtab` / セクションテーブルの削除） | `.so` は**セクション名**でセクションテーブルを解析 → `ELF section table is missing` | **プログラムヘッダ**（`PT_LOAD`/`PT_DYNAMIC`）+ ハードコードしたセクションレイアウトで解析するよう変更 | **2〜5 日** | **はい** |
| **8** | **ABI／コンパイラの変更**（mangled 名の規則が変わる） | 名前のマッチングがすべて断たれる | マッチング規則を変更（SnowLuma には `NSt2Cr` = `std::__cxx11` の変種特徴が既にある） | **1〜3 日** | 半分は yes |
| **9** | **新アーキテクチャ／パッカー** | すべて断たれる | 作り直し | **週単位** | はい |
| **10** | **QQ が注入方式を変更**（サンドボックス、`/proc` の権限、`process_vm_readv` が遮られる） | `QQ runtime cannot read process memory` / `[RUNTIME_MEMORY_UNAVAILABLE]` | `ptrace(PTRACE_PEEKDATA)` または `/proc/pid/mem` に切り替え | **2〜4 日** | はい |

### 7.3 結論（一言で）

> **テンセントが「クラス名 + 継承構造 + vtable のスロット順」を動かさない限り、適応コストは 0〜1 日であり、
> しかも文字列／数値の設定を変えるだけで、native コードには触れずに済みます。**
>
> **ひとたび vtable の形が変われば（多重継承／仮想基底）、native パーサーを書き直す必要があります。**

### 7.4 戦術的助言：「適応」を「スクリプト実行」に変える

「アンカー文字列 → xref サイト → スロット」の方法は**完全に機械的**であるため
（詳細は [architecture.md §6.4](architecture.md)）、**適応作業はコマンド 1 回 + diff の確認に変えるべきです**：

```bash
# ① 收集新版本的语言指纹
md5sum wrapper.node
readelf -n wrapper.node | grep -A2 'Build ID'
stat -c '%s %n' wrapper.node

# ② 跑离线解析器，与基线 diff
python3 tools/dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
python3 tools/dump-vtable.py --wrapper wrapper.node --dump-all > new.json
python3 tools/dump-vtable.py --wrapper wrapper.node --diff tools/baseline-vtable.json
```

**diff 結果の読み方**：

| diff の現象 | 対応する状況 | やるべきこと |
|---|---|---|
| 関数アドレスだけが変わり、メソッド名 + スロットは不変 | 状況 1 | **0 変更**。そのまま動かす |
| メソッド名はあるがスロットが変わった | 状況 3 | `.node` の数値を変更 |
| メソッド名が消えた | 状況 2 / 6 | `.node` の文字列を変更／アンカーを探し直す |
| `__vmi_class_type_info` が現れた | 状況 5 | **`.so` の変更が必須** |

> **自前の `.so` の完全な工数は約 20〜36 人日（1〜1.5 人月）**ですが、
> **「オフライン解析器 + 適応スクリプト」だけなら 5〜10 人日**で、**最も起こりやすい**状況 2/3/4 をカバーできます。
> **いきなり `.so` を書き直さないでください。** 詳細は [contributing.md](../dev/contributing.md) を参照してください。

### 7.5 ⚠️ 適応後は必ずエンドツーエンド検証を行う

**VTable の差し替えは最も脆い hook の形式です。スロットが 1 つずれても即座にはクラッシュせず**、
**メッセージを誤った経路に送ってしまいます** —— 利用者から見える形では：

```
"The QQ connection changed. Please restart QQ and try again."
```

> **「プロセスが落ちなかった」だけで適応成功と判断してはいけません。**
> **適応のたびに、実際にメッセージを送受信するエンドツーエンド検証が必要です。**

---

## 8. バージョンアップグレードのチェックリスト

```bash
# ═══ 升级前：归档当前"已知可用"基线 ═══
docker cp <容器>:/app/runtime /backup/runtime-$(date +%F)
sha256sum /backup/runtime-*/native/*.so /backup/runtime-*/native/*.node   # ★ 必须
docker exec <容器> sh -c 'grep -m1 version /opt/QQ/resources/app/package.json'
md5sum wrapper.node ; readelf -n wrapper.node | grep 'Build ID'

# ═══ 升级后：逐项核对 ═══
# ① 版本指纹
md5sum wrapper.node                      # 变了 → 读 §7.2 难度矩阵
readelf -n wrapper.node | grep 'Build ID'

# ② RTTI 结构
python3 tools/dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
python3 tools/dump-vtable.py --wrapper wrapper.node --diff tools/baseline-vtable.json

# ③ 运行期 hook 健康度（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
docker exec <容器> sh -c 'grep -oE "hook_autoload_terminal[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'

# ④ 端到端：真的发一条消息、真的收一条消息（★ 不可省）
```

> **12 個の RTTI 失敗文字列 → スロット対応表の完全版**は [troubleshooting.md](troubleshooting.md) の T4 を参照してください。

---

## 9. 既知の互換性リスク

| # | リスク | 深刻度 | 緩和策 |
|---|---|---|---|
| 1 | **`wrapper.node` の構造変更で hook が全失効** | 🔴 致命的 | QQ バージョンを固定する。ログの `unresolved` を監視する。「純通知への降格」案を用意する |
| 2 | **native 層にソースがなく、バグを修正できない** | 🔴 高 | ①現在動くバイナリを完全にバックアップ（sha256）②コンテナ外にアーカイブ ③容易にアップグレードしない |
| 3 | **自動更新が削除済みリポジトリを指す ⇒ 必ず 404** | 🟠 中 | `update/sources.ts` を変更する、または `SNOWLUMA_UPDATE_CHECK` で無効化する |
| 4 | **`webuiHost: 0.0.0.0` + 平文 HTTP（TLS 無効）** | 🟠 中 | `127.0.0.1` + リバースプロキシに変更する、または TLS を有効化する（`webui/tls.ts` は準備済み） |
| 5 | **`/api/debug/invoke` はリモートからの任意アクション実行に等しい** | 🟠 中 | 公網に晒す場合は必ず TOTP + 強力なパスワードを有効化する。IP ホワイトリストも検討する |
| 6 | **`onebot.json` の `accessToken` が平文（644 権限）** | 🟠 中 | トークンを強力なランダム値に変更する。権限を 600 に絞る |
| 7 | **`sqlcipher.ts` が QQ のライブラリ形式に依存** | 🟠 中 | **12 通りの組み合わせ探索**を実装済みで堅牢性は高い。QQ が形式を変えたら追従が必要 |
| 8 | **バックオフもサーキットブレーカーもなく、1.5 s 固定 tick** | 🟡 低〜中 | `AUTO_LOAD_MAX_ATTEMPTS=3` を維持する。改善時は復旧を遅くしないよう注意 |
| 9 | **スレッド名 `snowluma-pipe-w` が直接露出** | 🟡 低 | **native 層なので変更できない** —— 受け入れるしかない |
| 10 | **EULA/PRIVACY の更新で再度同意を要求される** | 🟡 低 | 一括導入では `SNOWLUMA_ACCEPT_EULA` / `_PRIVACY` を使う |
| 11 | **単一障害点：1 つの runtime プロセスがすべてのアカウントにサービスする** | 🟡 低 | すでにマルチ PID 設計（`Map<pid, HookSession>`）なので問題は小さい |
| 12 | **ログが約 11 MB/日**、`logRetainDays=7` ⇒ 常時約 80 MB | 🟢 低 | 自動ローテーション済み。ディスクに注意 |
| 13 | **`.so` が strip されるとシンボルレベルのデバッグができない** | 🟡 低〜中 | `dynsym` + 文字列 + 逆アセンブルで対応する |

---

## 10. 関連ドキュメント

| 知りたいこと | 参照先 |
|---|---|
| 実際にどう動いているのか | [architecture.md](architecture.md) |
| 問題が起きたときの調査方法 | [troubleshooting.md](troubleshooting.md) |
| ソースからのビルド方法 | [build.md](../dev/build.md) |
| 開発への参加方法 | [contributing.md](../dev/contributing.md) |

---

*ベースラインと指紋：2026-11-12。すべてのバージョン番号は実測値です（`.pnpm` の region パスとコンテナ内のファイルから取得）。
引き継ぐ前に md5 を照合してください。*