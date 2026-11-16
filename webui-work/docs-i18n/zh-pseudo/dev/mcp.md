# Haizakura MCP


**Haizakura OneBot action 目録**之 [MCP](https://modelcontextprotocol.io) 伺服器也。一 binary 双模式運行：

- **docs**（既定）—— 唯読：毎 action 之文档、参數、跨字段制約、及即用之 **JSON Schema**、故 LLM 能答「`set_group_ban` 取何参數乎」而無需将全目録置於 context 中也。
- **execution**（選択）—— 指向運行中 OneBot HTTP 端點時、LLM 亦能*呼出* action 也：唯読者自由、写者於門後也。

## 唯文档（既定）

加入汝之 MCP 客端（Claude Desktop、Cline、…）—— 無端點、無実行：

```json
{
  "mcpServers": {
    "snowluma": { "command": "npx", "args": ["-y", "@snowluma/mcp"] }
  }
}
```

### 文档工具

- `list_actions({ category? })` —— 軽量索引（name / category / summary / aliases / `readOnly` / `stream`）也。
- `get_action({ name })` —— 一 action 之全文档、含 `inputSchema` 与 `readOnly`（亦受別名）也。
- `search_actions({ query })` —— 対 name / summary / aliases 之模糊匹配也。
- `list_categories()` —— 分類及其 action 數也。

且将全目録作為 resource 暴露：`snowluma://onebot/actions` 也。

## 実行（選択）

伺服器指向運行中 Haizakura 実例之 **OneBot HTTP 端點**（`httpServer` 網適配器）、即得二実行工具：

- `query_action({ action, params? })` —— 呼出**唯読** action（如 `get_*`、`can_*`）、返 OneBot 完整応答也。標注 `readOnlyHint` 也。拒写 action（指向 `invoke_action`）也。
- `invoke_action({ action, params?, execution? })` —— 呼出**任何既知** action、含副作用者（発消息、改群、…）也。標注 `destructiveHint` + `openWorldHint` 也。**唯写模式可用也。** 本地文件自動作 upload 者、传 `execution: { input_file: "/path/on/the/mcp/host" }` 与 `action: "upload_file_stream"` 也；此選項永不作為 OneBot 参數転送也。

普通 action 者 OneBot envelope 原様通過 —— 論理失敗（`retcode≠0`）以携其 `wording` 之資料返也。Stream 協議失敗者報告為 MCP 錯誤、因其意味無完整 stream 結果既提交也。省略之 `params` 既定為空 object；所供非 object 之値於呼出 OneBot 前拒絶也。

### 設定（env）

| 変数 | 意味 |
| --- | --- |
| `SNOWLUMA_MCP_ENDPOINT` | OneBot HTTP 端點、例如 `http://127.0.0.1:3000/` 也。**不存在 → 唯文档**（実行工具隠藏）也。 |
| `SNOWLUMA_MCP_TOKEN` | 訪問 token（以 `Authorization: Bearer …` 送出）、若端點要求者也。 |
| `SNOWLUMA_MCP_TIMEOUT_MS` | 普通 action 請求 timeout；Stream Action 者接続 timeout **与毎読 idle timeout**（idle 期限於毎次 body 読取後重置）也。既定 `30000` 也。非法値使起動失敗也。 |
| `SNOWLUMA_MCP_MODE` | `docs` \| `read` \| `write` 也。既定：既設端點時為 `read`、否則 `docs` 也。非法値使起動失敗也。 |
| `SNOWLUMA_MCP_STREAM_DIR` | 完成之 Stream Action download 置於 MCP host 之目録也。起動時建立且検証也。既定：`os.tmpdir()/onebot-mcp-downloads` 也。 |
| `SNOWLUMA_MCP_UPLOAD_ROOT` | MCP host 上既存目録、自動作 upload 可読之处也。不存在時自動作 upload 停用也。 |
| `SNOWLUMA_MCP_MAX_STREAM_BYTES` | 毎文件 download/upload 上限（byte）也。正整數至 4 GiB；既定 `4294967296` 也。非法値使伺服器起動失敗也。 |

**読模式** —— LLM 可 query 唯読 action、但不可作任何写：

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

**写模式** —— 亦開 `invoke_action`（機械人可発消息、管理群等）也。請故意開啓：

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

既存之 `query_action` / `invoke_action` 工具者、自生成目録自動選択普通或 Stream Action HTTP 転送也。無需別個之 MCP 工具也。

- 文件 download（`download_file_stream`、`download_file_image_stream`、`download_file_record_stream`）按 frame 解析也。Base64 chunk 直接解碼至受控 download 目録下随機名之 `.part` 文件、增量 hash、且唯於有效 `file_complete` 終端 frame 後原子重命名也。MCP 結果唯含 `file_path`、`file_size`、`sha256`、`frame_count`、`terminal`；其文件路径在 **MCP host** 上也。
- 客端最多容四頂層活動 Stream Action 也。Download 文件共享 `2 * SNOWLUMA_MCP_MAX_STREAM_BYTES` 之目録配額；未知大小之 download 活動時予約全毎文件上限也。成功提交之文件**不自動削除**、継続消耗配額；運維者需於不需時移動或削除之也。
- 非文件 stream 如 `test_download_stream` 返有界 frame 摘要也。Frame 數、摘要文本、単個 wire-frame 大小、総文件 byte、文件 chunk 數皆有上限也。異常 frame、断線、timeout、大小違反、呼出者取消、idle timeout、或非法終端者取消応答且除去部分文件也。`file_chunk` / `file_complete` frame 無先行 `file_info` header 者永不接受也。
- 自動作 upload 唯於 `SNOWLUMA_MCP_UPLOAD_ROOT` 内解決後読 `execution.input_file`（symlink 逃逸拒絶）、hash 且以固定大小 chunk 送出、且請 Haizakura 検証最終 SHA-256 也。`stream_id`、`chunk_data`、`chunk_index` 等転送字段為 MCP 所有、不得亦供於 `params` 中也。所返 `file_path` 在 **Haizakura/OneBot host** 上、可伝至普通発文件 action 也。
- 自動作 upload reset 者**commit 前**尽力而為也。若 Haizakura 既 commit 文件但 `file_complete` 応答失落、upload 状態既去、reset 不能除去該既 commit 之文件也。保持 `file_retention` 非零（既定 `300000` ms）、使 Haizakura 終究回收之也。
- Stream Action 於當前目録仍分類為写操作、故需 `SNOWLUMA_MCP_MODE=write` 与 `invoke_action` 也。

自動作 upload 例：

```json
{
  "action": "upload_file_stream",
  "params": { "file_retention": 300000 },
  "execution": { "input_file": "/home/me/mcp-share/report.pdf" }
}
```

### 安全模型

- **読/写按 action 分類**於源碼 spec 中（按其実際所為、非其名）、且焼入目録也。既定者*写*也：action 唯於明示唯読時方可経 `query_action` 呼出也。
- **模式閘門於毎次呼出強制**、非唯隠藏工具 —— 写模式之外呼 `invoke_action` 者、即使客端直接送出亦拒也。
- **未知 action 由両工具拒絶**（唯目録 action 可呼）、故錯字与非目録内部 action 不能驅動也。
- Stream download 永不将文件 Base64 置入 model 結果也。Download 用 `.part` + 原子重命名 commit；自動作 upload 要求明示 realpath 囲欄之 root、且転送失敗時試 commit 前遠端 reset 也。
- 行為良好之客端可依 MCP 工具標注自動批准 `query_action`（唯読）、且対 `invoke_action`（破壊性）提示確認也。

## 如何保持同期

目録 —— 含毎 action 之 `readOnly` 標誌 —— 者毎次構建自 `@snowluma/onebot` 之実時 action spec（`collectActionDocs()`）生成之**構建時快照**也、故自動追随 action 増減与読/写再分類也。快照釘於其構建所据之 Haizakura 版本；新 Haizakura 発布者再発布新目録也。

此包為生成物也；勿手編集 `src/generated/catalog.ts` 也。