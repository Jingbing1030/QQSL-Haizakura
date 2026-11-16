# Haizakura MCP


這是一個為 **Haizakura OneBot 動作目錄**而寫的 [MCP](https://modelcontextprotocol.io) 伺服器。它以單一執行檔提供兩種模式：

- **docs**（預設）—— 唯讀：每個動作的說明文件、參數、跨欄位限制，以及可直接使用的 **JSON Schema**，讓 LLM 不必把整份目錄放進上下文，就能回答「`set_group_ban` 需要哪些參數？」
- **execution**（需選擇啟用）—— 當指向一個執行中的 OneBot HTTP 端點時，LLM 也能*呼叫*動作：唯讀動作可自由呼叫，寫入動作則需通過閘門。

## 僅文件模式（預設）

加入你的 MCP 用戶端（Claude Desktop、Cline……）—— 不需要端點，也不會執行：

```json
{
  "mcpServers": {
    "snowluma": { "command": "npx", "args": ["-y", "@snowluma/mcp"] }
  }
}
```

### 文件工具

- `list_actions({ category? })` —— 輕量索引（名稱 / 分類 / 摘要 / 別名 / `readOnly` / `stream`）。
- `get_action({ name })` —— 單一動作的完整文件，包含 `inputSchema` 與 `readOnly`（接受別名）。
- `search_actions({ query })` —— 對名稱 / 摘要 / 別名進行模糊比對。
- `list_categories()` —— 分類及其動作數量。

也會把整份目錄以資源形式公開：`snowluma://onebot/actions`。

## 執行模式（需選擇啟用）

把伺服器指向執行中的 Haizakura 執行個體的 **OneBot HTTP 端點**（`httpServer` 網路配接器），它就會多出兩個執行工具：

- `query_action({ action, params? })` —— 呼叫**唯讀**動作（例如 `get_*`、`can_*`），並回傳完整的 OneBot 回應。標註為 `readOnlyHint`。會拒絕寫入動作（並指向 `invoke_action`）。
- `invoke_action({ action, params?, execution? })` —— 呼叫**任何已知**動作，包括有副作用的動作（傳送訊息、變更群組……）。標註為 `destructiveHint` + `openWorldHint`。**僅在寫入模式中可用。** 若要自動上傳本機檔案，請搭配 `action: "upload_file_stream"` 傳入 `execution: { input_file: "/path/on/the/mcp/host" }`；此選項永遠不會被轉送為 OneBot 參數。

一般動作會原樣傳遞 OneBot 信封 —— 邏輯失敗（`retcode≠0`）會以資料形式連同其 `wording` 回傳。串流協定失敗會回報為 MCP 錯誤，因為它們代表沒有任何完整的串流結果被提交。省略 `params` 時預設為空物件；若提供非物件值，會在呼叫 OneBot 之前被拒絕。

### 設定（環境變數）

| 變數 | 意義 |
| --- | --- |
| `SNOWLUMA_MCP_ENDPOINT` | OneBot HTTP 端點，例如 `http://127.0.0.1:3000/`。**未設定 → 僅文件模式**（執行工具會隱藏）。 |
| `SNOWLUMA_MCP_TOKEN` | 存取權杖（以 `Authorization: Bearer …` 送出），若端點需要。 |
| `SNOWLUMA_MCP_TIMEOUT_MS` | 一般動作的請求逾時；對串流動作而言則是連線逾時**與每次讀取的閒置逾時**（閒置期限會在每次讀取主體後重設）。預設 `30000`。無效的值會使啟動失敗。 |
| `SNOWLUMA_MCP_MODE` | `docs` \| `read` \| `write`。預設：已設定端點時為 `read`，否則為 `docs`。無效的值會使啟動失敗。 |
| `SNOWLUMA_MCP_STREAM_DIR` | MCP 主機上用來存放已完成串流動作下載的目錄。啟動時會建立並驗證。預設：`os.tmpdir()/onebot-mcp-downloads`。 |
| `SNOWLUMA_MCP_UPLOAD_ROOT` | MCP 主機上允許自動上傳讀取的既有目錄。未設定時會停用自動上傳。 |
| `SNOWLUMA_MCP_MAX_STREAM_BYTES` | 每個檔案的下載/上傳上限，單位為位元組。最大 4 GiB 的正整數；預設 `4294967296`。無效的值會使伺服器啟動失敗。 |

**讀取模式** —— LLM 可以查詢唯讀動作，但無法執行任何寫入：

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

**寫入模式** —— 也會啟用 `invoke_action`（機械人可以傳送訊息、管理群組等）。請審慎啟用：

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

### 串流動作

既有的 `query_action` / `invoke_action` 工具會從產生的目錄自動選擇一般或串流動作 HTTP 傳輸。不需要另外的 MCP 工具。

- 檔案下載（`download_file_stream`、`download_file_image_stream` 與 `download_file_record_stream`）會逐框架解析。Base64 區塊會直接解碼到受控下載目錄下隨機命名的 `.part` 檔案，以增量方式計算雜湊，並且只有在收到有效的 `file_complete` 終止框架後才以原子方式重新命名。MCP 結果只包含 `file_path`、`file_size`、`sha256`、`frame_count` 與 `terminal`；檔案路徑位於 **MCP 主機**上。
- 單一用戶端最多允許四個最上層的作用中串流動作。下載檔案共用 `2 * SNOWLUMA_MCP_MAX_STREAM_BYTES` 的目錄配額；大小未知的下載在作用中時會保留完整的每檔上限。已成功提交的檔案**不會被 MCP 自動刪除**，並會繼續佔用配額；操作人員必須在不再需要時移動或刪除它們。
- 非檔案串流（例如 `test_download_stream`）會回傳有界的框架摘要。框架數量、摘要文字、單一線路框架大小、檔案總位元組數與檔案區塊數都有上限。格式錯誤的框架、斷線、逾時、大小違規、呼叫端取消、閒置逾時或無效的終止框架，都會取消回應並移除部分檔案。沒有前置 `file_info` 標頭時，`file_chunk` / `file_complete` 框架永遠不會被接受。
- 自動上傳只有在 `SNOWLUMA_MCP_UPLOAD_ROOT` 內解析 `execution.input_file` 之後才會讀取它（會拒絕符號連結逃逸），以固定大小的區塊計算雜湊並送出，並請 Haizakura 驗證最終的 SHA-256。傳輸欄位（例如 `stream_id`、`chunk_data` 與 `chunk_index`）由 MCP 擁有，不得同時在 `params` 中提供。回傳的 `file_path` 位於 **Haizakura/OneBot 主機**上，可以傳給一般的傳送檔案動作。
- 自動上傳的重設是**提交前**的盡力而為。若 Haizakura 已提交檔案但 `file_complete` 回應遺失，上傳狀態已經消失，重設無法移除該已提交的檔案。請讓 `file_retention` 保持非零（預設為 `300000` ms），以便 Haizakura 最終回收它。
- 串流動作在目前的目錄中仍被歸類為寫入操作，因此需要 `SNOWLUMA_MCP_MODE=write` 與 `invoke_action`。

自動上傳範例：

```json
{
  "action": "upload_file_stream",
  "params": { "file_retention": 300000 },
  "execution": { "input_file": "/home/me/mcp-share/report.pdf" }
}
```

### 安全模型

- **讀取/寫入是依動作分類**，在來源規格中（依動作實際做的事，而非其名稱）判定，並內建於目錄中。預設為*寫入*：動作**只有**在明確標示為唯讀時，才能透過 `query_action` 呼叫。
- **模式閘門在每次呼叫時都會強制執行**，不只是隱藏工具 —— 在寫入模式之外呼叫 `invoke_action` 會被拒絕，即使用戶端直接送出也一樣。
- **未知動作會被兩個工具拒絕**（只有目錄中的動作可以呼叫），因此錯字與非目錄的內部動作都無法被驅動。
- 串流下載永遠不會把檔案的 Base64 放進模型結果。下載使用 `.part` + 原子重新命名的提交方式；自動上傳需要一個明確以真實路徑圍籬的根目錄，並在傳輸失敗時嘗試提交前的遠端重設。
- 行為良好的用戶端可以利用 MCP 工具標註，自動核准 `query_action`（唯讀），並對 `invoke_action`（破壞性）提出提示。

## 如何保持同步

目錄 —— 包括每個動作的 `readOnly` 旗標 —— 是**建置時快照**，在每次建置時從 `@snowluma/onebot` 的即時動作規格（`collectActionDocs()`）產生，因此會自動追蹤動作的新增/移除與讀取/寫入的重新分類。快照會釘選在其建置來源的 Haizakura 版本；新的 Haizakura 發行版會重新發佈一份新的目錄。

此套件是產生的；請勿手動編輯 `src/generated/catalog.ts`。