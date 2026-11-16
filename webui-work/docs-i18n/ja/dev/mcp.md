# Haizakura MCP


**Haizakura OneBot アクションカタログ**のための [MCP](https://modelcontextprotocol.io) サーバーです。1 つのバイナリで 2 つのモードとして動作します：

- **docs**（既定）—— 読み取り専用：すべてのアクションのドキュメント、パラメーター、フィールド間の制約、およびすぐに使える **JSON Schema** を提供するため、LLM はカタログ全体をコンテキストに保持しなくても「`set_group_ban` はどのパラメーターを取るのか」に答えられます。
- **execution**（オプトイン）—— 稼働中の OneBot HTTP エンドポイントを指定すると、LLM はアクションを*呼び出し*もできます。読み取り専用のものは自由に、書き込み系のものはゲートの背後で。

## ドキュメントのみ（既定）

MCP クライアント（Claude Desktop、Cline など）に追加します —— エンドポイントも実行も不要です：

```json
{
  "mcpServers": {
    "snowluma": { "command": "npx", "args": ["-y", "@snowluma/mcp"] }
  }
}
```

### ドキュメントツール

- `list_actions({ category? })` —— 軽量なインデックス（name / category / summary / aliases / `readOnly` / `stream`）です。
- `get_action({ name })` —— 1 つのアクションの完全なドキュメントで、`inputSchema` と `readOnly` を含みます（別名も受け付けます）。
- `search_actions({ query })` —— name / summary / aliases に対する曖昧一致です。
- `list_categories()` —— カテゴリとそのアクション数です。

さらにカタログ全体をリソースとして公開します：`snowluma://onebot/actions`。

## 実行（オプトイン）

サーバーを稼働中の Haizakura インスタンスの **OneBot HTTP エンドポイント**（`httpServer` ネットワークアダプター）に向けると、2 つの実行ツールが加わります：

- `query_action({ action, params? })` —— **読み取り専用**のアクション（例：`get_*`、`can_*`）を呼び出し、OneBot の完全なレスポンスを返します。`readOnlyHint` が付与されます。書き込み系のアクションは拒否します（`invoke_action` を案内します）。
- `invoke_action({ action, params?, execution? })` —— 副作用のあるもの（メッセージ送信、グループ変更など）を含め、**既知のあらゆる**アクションを呼び出します。`destructiveHint` + `openWorldHint` が付与されます。**書き込みモードでのみ利用できます。** ローカルファイルの自動アップロードには、`action: "upload_file_stream"` とともに `execution: { input_file: "/path/on/the/mcp/host" }` を渡します。このオプションが OneBot のパラメーターとして転送されることはありません。

通常のアクションは OneBot のエンベロープをそのまま通します —— 論理的な失敗（`retcode≠0`）は `wording` を伴うデータとして返ります。ストリームプロトコルの失敗は MCP エラーとして報告されます。これは完全なストリーム結果がコミットされなかったことを意味するためです。`params` を省略すると空のオブジェクトが既定となり、オブジェクト以外の値が渡された場合は OneBot を呼び出す前に拒否されます。

### 設定（env）

| 変数 | 意味 |
| --- | --- |
| `SNOWLUMA_MCP_ENDPOINT` | OneBot HTTP エンドポイント。例：`http://127.0.0.1:3000/`。**未指定 → ドキュメントのみ**（実行ツールは隠されます）。 |
| `SNOWLUMA_MCP_TOKEN` | アクセストークン（`Authorization: Bearer …` として送信されます）。エンドポイントが要求する場合に指定します。 |
| `SNOWLUMA_MCP_TIMEOUT_MS` | 通常アクションのリクエストタイムアウト。Stream Action では接続タイムアウト**および読み取りごとのアイドルタイムアウト**です（アイドルの期限はボディを読み取るたびにリセットされます）。既定値は `30000`。不正な値は起動を失敗させます。 |
| `SNOWLUMA_MCP_MODE` | `docs` \| `read` \| `write`。既定：エンドポイントが設定されていれば `read`、そうでなければ `docs`。不正な値は起動を失敗させます。 |
| `SNOWLUMA_MCP_STREAM_DIR` | 完了した Stream Action のダウンロードを置く、MCP ホスト上のディレクトリ。起動時に作成され検証されます。既定：`os.tmpdir()/onebot-mcp-downloads`。 |
| `SNOWLUMA_MCP_UPLOAD_ROOT` | 自動アップロードが読み取ることのできる、MCP ホスト上の既存ディレクトリ。未指定のとき自動アップロードは無効になります。 |
| `SNOWLUMA_MCP_MAX_STREAM_BYTES` | ファイルごとのダウンロード / アップロード上限（バイト単位）。4 GiB までの正の整数で、既定値は `4294967296`。不正な値はサーバーの起動を失敗させます。 |

**読み取りモード** —— LLM は読み取り専用アクションを照会できますが、書き込みは一切実行できません：

```json
{
  "mcpServers": {
    "snowluma": {
      "command": "npx",
      "args": ["-y", "@snowluma/mcp"],
      "env": {
        "SNOWLUMA_MCP_ENDPOINT": "http://127.0.0.1:3000/",
        "SNOWLUMA_MCP_TOKEN": "your-access-token"
      }
    }
  }
}
```

**書き込みモード** —— `invoke_action` も有効になります（ボットがメッセージ送信やグループ管理などを行えます）。意図的に有効化してください：

```json
{
  "mcpServers": {
    "snowluma": {
      "command": "npx",
      "args": ["-y", "@snowluma/mcp"],
      "env": {
        "SNOWLUMA_MCP_ENDPOINT": "http://127.0.0.1:3000/",
        "SNOWLUMA_MCP_TOKEN": "your-access-token",
        "SNOWLUMA_MCP_MODE": "write",
        "SNOWLUMA_MCP_STREAM_DIR": "/var/tmp/onebot-mcp-downloads",
        "SNOWLUMA_MCP_UPLOAD_ROOT": "/home/me/mcp-share"
      }
    }
  }
}
```

### Stream Actions

既存の `query_action` / `invoke_action` ツールは、生成されたカタログから通常アクションと Stream Action の HTTP 転送を自動的に選択します。別個の MCP ツールは不要です。

- ファイルダウンロード（`download_file_stream`、`download_file_image_stream`、`download_file_record_stream`）はフレーム単位で解析されます。Base64 のチャンクは、制御されたダウンロードディレクトリ配下のランダム名の `.part` ファイルへ直接デコードされ、逐次的にハッシュ化され、有効な `file_complete` 終端フレームの後にのみアトミックにリネームされます。MCP の結果に含まれるのは `file_path`、`file_size`、`sha256`、`frame_count`、`terminal` のみで、そのファイルパスは **MCP ホスト**上のものです。
- クライアントはトップレベルのアクティブな Stream Action を最大 4 つまで受け入れます。ダウンロードファイルは `2 * SNOWLUMA_MCP_MAX_STREAM_BYTES` のディレクトリクォータを共有し、サイズ不明のダウンロードはアクティブな間、ファイルごとの上限を全量予約します。正常にコミットされたファイルは MCP によって**自動削除されず**、クォータを消費し続けます。不要になった時点で運用者が移動または削除する必要があります。
- `test_download_stream` のようなファイル以外のストリームは、上限付きのフレーム要約を返します。フレーム数、要約テキスト、個々のワイヤフレームのサイズ、ファイルの合計バイト数、ファイルチャンク数には上限があります。不正なフレーム、切断、タイムアウト、サイズ違反、呼び出し側によるキャンセル、アイドルタイムアウト、無効な終端はレスポンスをキャンセルし、部分ファイルを削除します。`file_chunk` / `file_complete` フレームは、先行する `file_info` ヘッダーなしでは決して受け入れられません。
- 自動アップロードは、`SNOWLUMA_MCP_UPLOAD_ROOT` の内側に解決できた場合にのみ `execution.input_file` を読み取り（シンボリックリンクによる脱出は拒否されます）、ハッシュ化して固定サイズのチャンクで送信し、最終的な SHA-256 の検証を Haizakura に依頼します。`stream_id`、`chunk_data`、`chunk_index` などの転送フィールドは MCP が所有するもので、`params` に重ねて指定してはいけません。返される `file_path` は **Haizakura/OneBot ホスト**上のもので、通常のファイル送信アクションへ渡せます。
- 自動アップロードのリセットは**コミット前**のベストエフォートです。Haizakura がファイルをコミットしたのに `file_complete` レスポンスが失われた場合、アップロード状態はすでに消えているため、リセットでそのコミット済みファイルを削除できません。`file_retention` をゼロ以外（既定は `300000` ms）に保ち、Haizakura が最終的に回収できるようにしてください。
- Stream Action は現在のカタログでは書き込み操作として分類されているため、`SNOWLUMA_MCP_MODE=write` と `invoke_action` が必要です。

自動アップロードの例：

```json
{
  "action": "upload_file_stream",
  "params": { "file_retention": 300000 },
  "execution": { "input_file": "/home/me/mcp-share/report.pdf" }
}
```

### 安全モデル

- **読み取り / 書き込みはアクションごとに**ソースの仕様で分類され（名前ではなく実際の動作によって）、カタログに焼き込まれます。既定は*書き込み*です。アクションが `query_action` 経由で呼び出せるのは、**明示的に読み取り専用である場合のみ**です。
- **モードゲートはすべての呼び出しで強制されます**。ツールを隠すだけではありません —— 書き込みモード以外で `invoke_action` を呼び出すと、クライアントが直接送信したとしても拒否されます。
- **未知のアクションは両方のツールで拒否されます**（呼び出せるのはカタログのアクションだけです）。そのためタイプミスやカタログ外の内部アクションを動かすことはできません。
- ストリームダウンロードがファイルの Base64 をモデルの結果に入れることはありません。ダウンロードは `.part` + アトミックリネームによるコミットを使用し、自動アップロードは明示的な realpath で囲まれたルートを要求し、転送が失敗した場合はコミット前のリモートリセットを試みます。
- 行儀のよいクライアントは、MCP のツールアノテーションを使って `query_action`（読み取り専用）を自動承認し、`invoke_action`（破壊的）については確認を求めることができます。

## 同期の仕組み

カタログは —— 各アクションの `readOnly` フラグを含めて —— ビルドのたびに `@snowluma/onebot` のライブなアクション仕様（`collectActionDocs()`）から生成される**ビルド時スナップショット**であるため、アクションの追加 / 削除と読み取り / 書き込みの再分類を自動的に追従します。スナップショットはビルド元の Haizakura バージョンに固定され、新しい Haizakura リリースは新しいカタログを再公開します。

このパッケージは生成物です。`src/generated/catalog.ts` を手で編集しないでください。