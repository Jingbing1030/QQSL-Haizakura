# MCP 代理功能


這些新增項目保留既有的工具名稱、動作參數、文字結果與讀取/寫入閘門。目錄工具或本機執行環境概觀都不會連絡任何端點。動作目錄仍然是一份隨附的快照，而不是對已連線伺服器能力的宣告。

## 協定相容性與目錄快取

同一個 `snowluma-mcp` stdio 命令可接受 MCP `2026-07-28` 用戶端，以及使用 `initialize` 握手的較舊用戶端。官方伺服器 SDK 會為連線選擇協定。現代用戶端可以使用 `server/discover` 與每請求中介資料，而不需初始化；舊式用戶端保留其既有設定。這不會新增公開監聽的 MCP HTTP 端點。

現代回應會帶有該協定的完成與伺服器中繼資料。快取提示取決於回應包含的是靜態目錄資料或私密的即時狀態：

| 回應                                              | 存留期                                      | 範圍                                                                          |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `tools/list`                                          | 五分鐘                                  | `private`；模式與用戶端能力會影響工具中介資料與可用性。 |
| `resources/list`                                      | 五分鐘，或事件啟用時為零 | `private`；UI 能力與作用中的事件資源會影響此清單。           |
| `resources/templates/list`                            | 五分鐘                                  | `public`；隨附的範本清單是靜態的。                                 |
| 動作目錄或訊息 UI 的 `resources/read` | 五分鐘                                  | `public`；這些是隨附的靜態資產。                                     |
| 事件資源的 `resources/read`                  | 零                                          | `private`；這些包含帳號事件與連線狀態。                  |

這些是用戶端快取提示，不是伺服器端的結果快取。工具呼叫（包括執行環境概觀）永遠不會收到這些提示。SDK 會對舊式用戶端省略僅限現代協定的結果欄位。不支援的協定修訂會在執行動作之前被拒絕；它們不會觸發動作重試。

## 呼叫追蹤

每次工具呼叫都會取得 W3C 追蹤上下文。用戶端可以在工具請求的 `_meta` 中提供 `traceparent` 與選用的 `tracestate`：

```json
{
  "name": "query_action",
  "arguments": { "action": "get_status" },
  "_meta": {
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  }
}
```

MCP 會保留有效的呼叫端追蹤 ID，並為每次呼叫建立新的 span ID。若沒有有效的父項，它會建立獨立的追蹤。回傳的 `_meta.traceparent` 可識別該次呼叫，包括工具錯誤；既有的文字與結構化結果信封維持不變。這在兩個協定世代都能運作。

一般請求、串流、自動上傳區塊與上傳清理都會在 HTTP 標頭中轉送呼叫上下文，永遠不會放在 OneBot 動作參數中。同時進行的呼叫會保有各自獨立的標頭。若要追蹤某次呼叫，請在 MCP stderr 診斷中找到其 traceparent，並與 Haizakura 的 `http_trace` 項目比對，然後沿著該項目既有的 `req#` 追蹤動作生命週期日誌。Haizakura 的關聯需要 TRACE 日誌與有效的已驗證 HTTP 請求；遠端追蹤 ID 不會取代其本機請求 ID。未安裝任何遙測匯出器。

MCP 的呼叫診斷包含已知的工具名稱、traceparent、結果、失敗類別與持續時間，不含訊息內容、權杖、檔案路徑或任意中介資料。`tracestate` 會以最多 512 個字元與 32 個成員進行驗證；它會被轉送但不會被記錄。無效的追蹤中介資料會產生固定的診斷，且不會拒絕其他方面有效的動作。`baggage` 既不會被轉送也不會被記錄。追蹤識別碼是關聯資料，不是驗證或權限。

## 選用的執行服務

既有設定會繼續運作。輸入補完與訊息預覽是附加工具；事件連線與持久任務則需要明確設定。例如，在 MCP 用戶端的伺服器環境中設定這些變數，並把位址、憑證與路徑替換為預期的 Haizakura 執行個體：

```json
{
  "SNOWLUMA_MCP_MODE": "write",
  "SNOWLUMA_MCP_ENDPOINT": "http://127.0.0.1:3000/",
  "SNOWLUMA_MCP_TOKEN": "<your access token>",
  "SNOWLUMA_MCP_EVENTS_URL": "ws://127.0.0.1:3001/event",
  "SNOWLUMA_MCP_TASK_DIR": "/absolute/private/mcp-tasks",
  "SNOWLUMA_MCP_UPLOAD_ROOT": "/absolute/allowed/uploads"
}
```

HTTP 與 WebSocket 位址是各自獨立設定的伺服器端點；WebSocket 位址永遠不會從 HTTP 位址推測而來。事件會以授權標頭重複使用 `SNOWLUMA_MCP_TOKEN`。上傳與任務目錄位於 MCP 主機上。不需要的服務請省略。文件模式仍為離線。

## 補完缺少的參數

`query_action_with_input` 與 `invoke_action_with_input` 使用與 `query_action` 和 `invoke_action` 相同的引數、動作查詢與模式閘門。既有工具的行為與之前完全相同。這些額外工具只有在動作目錄最上層 `required` 陣列所列出的欄位不存在時，才會要求輸入；它們不會推斷條件式需求或選用值。

例如，帶有 `{"action":"send_group_msg","params":{"group_id":20001}}` 的 `invoke_action_with_input` 會要求缺少的訊息。表單包含一個 `params_json` 字串，其內容是例如 `{"message":"Hello"}` 的 JSON 物件。答案會在正常執行動作之前，先依缺少欄位的目錄結構描述進行驗證。已提供的欄位、動作名稱與執行選項都無法被覆寫；多餘的答案欄位會被拒絕。被拒絕、取消或無效的答案不會執行動作。

用戶端必須宣告支援表單引出。現代用戶端會收到 `resultType: "input_required"`，並使用 SDK 的請求狀態與輸入回應機制繼續。支援引出的舊式用戶端使用 SDK 的 `elicitation/create` 流程。不支援表單的用戶端會收到工具錯誤，並可以改為對原始工具提供完整的引數。

續接狀態經過簽署、繫結至原始工具與引數、在十分鐘後過期，並在執行前被取用一次。同時或重複的答案無法執行同一個續接兩次。單一執行環境最多保留 256 個待處理提示；重新啟動會使其失效，而不是重播工作。已完成的引數會完全略過輸入回合。此功能不是一般的核准閘門，也不會為既有的動作呼叫新增確認提示。

## 即時事件資源

設定 `SNOWLUMA_MCP_EVENTS_URL` 之後，讀取與寫入模式會公開 `subscribe_events` 與 `unsubscribe_events`。此 URL 必須使用 `ws:` 或 `wss:`，且不得內嵌憑證、查詢參數或片段。列出工具或資源不會建立連線；只有 `subscribe_events` 會開啟事件連線。

```json
{
  "self_id": 10001,
  "types": ["message", "notice"],
  "group_ids": [20001],
  "user_ids": [30001]
}
```

必要的 `self_id` 請使用預期登入的帳號；如有需要，可透過 `get_login_info` 取得。每個傳入事件都必須符合此帳號。帳號不符或格式錯誤的事件會停止連線並被呈現出來。可選的類型為 `message`、`notice` 與 `request`；省略類型代表三者皆含。`message_sent` 包含在訊息類別中。群組與使用者篩選以 AND 結合，因此群組篩選會排除沒有相符 `group_id` 的事件。每個 ID 篩選最多接受 100 個相異正整數。

結果包含標準的 `snowluma://onebot/events/<id>` 資源 URI。用 `resources/read` 讀取它；在後續讀取時使用 `?after=<next_cursor>` 以取得較新的緩衝項目。游標屬於該單一資源。回應包含 `status`、`next_cursor`、`oldest_cursor`、`dropped_events`、`gap` 與 `notification_failed`。讀取不會取用事件。只有訂閱建立之後收到的事件才可用；這不是訊息歷史儲存。

每個資源最多保留 256 個事件與 1 MiB 的事件資料。單一執行環境最多支援 16 個資源，共用一條帳號連線。傳入框架限制為 256 KiB。緩衝區淘汰與斷線會透過游標/gap 與狀態欄位保持可見；此服務不會默默重新連線，也不會宣稱遺失的事件已被復原。在變更帳號或於斷線後建立新連線之前，請先釋放既有的資源。

如需更新，請使用**不含 `?after` 的標準 URI**：

- 現代用戶端使用帶有 `resourceSubscriptions: [uri]` 的 `subscriptions/listen`（TypeScript SDK 公開 `client.listen(...)`）。關閉該通知串流不會釋放事件緩衝區；請明確呼叫 `unsubscribe_events`。
- 舊式用戶端先以標準 URI 呼叫 `resources/subscribe`，然後接收 `notifications/resources/updated`。`resources/unsubscribe` 也會釋放該事件資源。明確的取消訂閱工具在兩個世代都適用。

更新通知代表資源已變更；請取得該資源以讀取其資料。釋放最後一個資源會關閉 WebSocket。關閉 MCP 連線會釋放其事件資源與緩衝區。任何事件操作都不會執行 OneBot 業務動作或傳送 QQ 訊息。

## 持久背景傳輸

設定絕對路徑的 `SNOWLUMA_MCP_TASK_DIR` 並使用寫入模式，即可啟用持久任務。任務工具另外需要宣告 `extensions: {"io.modelcontextprotocol/tasks": {}}` 的 MCP `2026-07-28` 用戶端。舊式用戶端保留既有的同步執行工具；此伺服器不會公開過時的 `tasks/list` 或 `tasks/result` 協定方法。

`invoke_action_background` 接受與 `invoke_action` 相同的引數，但只接受標示為串流的目錄動作。例如，它可以在已設定的上傳根目錄內以 `execution.input_file` 執行 `upload_file_stream`。它會在工作開始前寫入任務記錄，並回傳 `resultType: "task"` 控制代碼。一般動作繼續使用既有的工具。目前的背景傳輸項目不會自動與 `_with_input` 結合；請在啟動它之前提供必要的傳輸參數。

- 帶有 `{ "taskId": "..." }` 的 `tasks/get` 會回傳目前狀態，並在完成時回傳已儲存的結果或錯誤。`completed` 任務可能包含失敗的業務回應：請檢查巢狀結果的診斷、`status` 與 `retcode`。
- `tasks/cancel` 請求合作式取消。取消不會復原遠端效果，而已經在進行中的成功完成可能贏得競賽。請再次輪詢該任務以取得其最終狀態。
- `tasks/update` 只接受尚未完成的任務輸入請求的輸入回應。它是協定生命週期端點，不是任意的任務編輯 API。目前的背景傳輸項目本身不會請求互動式輸入。
- `list_tasks` 是一個 MCP 工具，回傳不含結果主體的任務中介資料。它接受選用的 `cursor` 與 `limit`（1–100；預設 50），並在有下一頁可用時回傳 `nextCursor`。

任務控制代碼會宣告 `pollIntervalMs: 1000` 與 `ttlMs: null`。結果在重新啟動後仍會保留，且不會自動過期或刪除。重新啟動會把未完成的工作標記為失敗，並附上明確的**遠端結果未知**訊息；它永遠不會重播該操作。這會持久保存傳輸狀態/結果，而不是可續傳的上傳或下載執行。最多同時有四個任務，且每筆持久化任務記錄的上限為 16 MiB。

儲存使用專屬的執行環境租約、私密目錄/檔案（POSIX 上為 0700/0600）與經驗證的記錄。損毀、權限錯誤與寫入失敗仍會是錯誤。此目錄會繫結至實際生效的模式、端點與權杖的摘要；變更該設定會拒絕重複使用該目錄。請為新設定選擇新的私密目錄，並保留舊的歷史。憑證不會儲存在範圍記錄中，但任務結果可能包含私密的帳號資料，應據此加以保護。

## 訊息預覽面板

`preview_message` 在每個模式都可用，且只會建構草稿：

```json
{
  "message_type": "group",
  "target_id": 20001,
  "text": "Hello",
  "reply_to": -123456
}
```

私人對話請使用 `private`。`target_id` 必須是正的安全整數；選用的 `reply_to` 是非零的有號 32 位元訊息 ID。預覽支援純文字與選用的引用回覆，不支援媒體轉譯。類似訊息控制碼的文字仍會是純文字。

每個用戶端都會收到相同的可讀文字草稿、`can_send` 旗標與對應的 `invoke_action` 引數。只有宣告 MCP Apps 擴充 `io.modelcontextprotocol/ui` 且 MIME 類型為 `text/html;profile=mcp-app` 的用戶端，才會收到該工具的 UI 中介資料與所列的 UI 資源。此面板是使用官方 Apps 用戶端建置的隨附、自足 HTML 資產。它不會載入任何外部腳本、字型或媒體，本身不會開啟任何網路連線，並顯示外部文字而不將其解讀為 HTML。缺少隨附資產是可見的封裝錯誤。

載入面板不會送出任何東西。其傳送按鈕只有在使用者點擊之後，才會透過主機呼叫既有的 `invoke_action`，而伺服器的寫入閘門仍然適用。讀取/文件模式或主機不支援伺服器工具時，傳送會保持停用。此面板會防止重複點擊，且不會重試失敗或不確定的傳送；請在檢查結果之後才建立新的草稿。成功確認並不代表已遞送或在 QQ 中轉譯。

## 動作結果結構描述與範例

`get_action` 與 `snowluma://onebot/actions` 會為每個隨附動作（包括別名）包含 `returnsSchema` 與 `examples`。兩者都與 OneBot 動作定義一同撰寫，並複製到產生的目錄中。清單/搜尋回應保持精簡；請使用 `get_action` 取得完整的契約。

`returnsSchema` 描述成功的 OneBot **`data`**，而不是完整的 OneBot 信封或 MCP `structuredContent` 包裝。讀取之前請先檢查 `status` 與 `retcode`。對串流動作而言，結構描述描述每個成功框架的 `data`；MCP 下載則改為回傳已儲存檔案的中介資料，而一般串流會回傳框架集合。錯誤框架與失敗的信封不是成功的結果。不支援的動作使用 `{ "not": {} }`，因為它們沒有成功的結果。相容性佔位項會明確記載其限制。

每個範例都有 `summary`、`params`，以及說明必備條件與識別碼來源的選用 `notes`。這些是示範性呼叫，絕不會被目錄工具執行。執行之前，請把範例中的帳號/群組 ID、不透明控制代碼與路徑替換為目前帳號的值。備註會指出具有多個步驟的操作，例如在所有區塊都被確認之後完成上傳。

例如，`get_action({ "name": "get_msg" })` 記載了有號訊息 ID：

```json
{
  "action": "get_msg",
  "params": { "message_id": -123456 }
}
```

請以真實的訊息 ID 把此物件傳給 `query_action`。寫入與串流會以寫入模式使用 `invoke_action`。若要自動上傳，請把 `{ "action": "upload_file_stream", "execution": { "input_file": "/allowed/hello.txt" } }` 傳給 `invoke_action`，並使用已設定上傳根目錄內的真實檔案。一般動作路徑指的是 Haizakura 伺服器，而 `execution.input_file` 與 MCP 下載路徑指的是 MCP 主機。

請勿以零替代有號訊息 ID。僅限資源的轉發上傳與閃傳共用有記載的 `message_id: 0` 哨兵值；它不能用於訊息查閱或回收。此外，請完全依照記載保留 `null` 與 `{}` 的差異、選用欄位，以及例如媒體 `file_size` 的十進位字串。

## 結構化結果

已完成的工具結果會使用所宣告的 `outputSchema`，並在既有的 `content` 文字區塊之外回傳 `structuredContent`。現代 `input_required` 與背景任務控制代碼是協定續接；請先檢查其 `resultType`，並透過相關的續接或任務生命週期取得已完成的結果：

```json
{
  "result": { "status": "ok", "retcode": 0, "data": { "message_id": -123 } },
  "diagnostics": { "outcome": "success" }
}
```

`result` 是原始承載資料，包括例如分類清單之類的陣列。MCP 工具錯誤時為 `null`。`diagnostics.outcome` 為 `success`、`failed` 或 `unknown`；失敗可能包含 `kind`、`message` 與 `next_step`。

一般 OneBot 業務失敗仍會回傳其原始信封，且不會設定 `isError`。其結構化診斷會指出失敗。非同步的確認，或未確認成功的回應，其結果為 `unknown`。傳輸錯誤與既有的工具/串流錯誤仍會設定 `isError: true`。錯誤類別描述已知的原因；未分類的執行錯誤不會從訊息字串推測。工具執行與連線檢查都不會自動重試。負數訊息 ID 仍然有效，並會原樣保留。

## 搜尋、篩選與分頁

除非請求 `match: "keywords"`，否則 `search_actions` 保留其原始的不區分大小寫子字串比對與目錄順序。關鍵字模式會以 AND 結合以空格分隔的詞彙、辨識一組少量常見的中英文同義詞，並把完全相符的動作名稱或別名排在前面。

```json
{
  "query": "群 禁言",
  "match": "keywords",
  "read_only": false,
  "stream": false,
  "limit": 10,
  "offset": 0
}
```

`list_actions` 與 `search_actions` 都接受選用的 `category`、`read_only`、`stream`、`limit`（1–200）與 `offset`（非負整數）。省略分頁會回傳完整相符的清單，並保留 `{count, actions}`。使用 `limit` 或 `offset` 時，`count` 是回傳的頁面大小，`total` 是相符的數量，`next_offset` 是下一頁的位移或 `null`。分頁套用於隨附的目錄；它不會發出伺服器請求。

## 執行環境概觀

`get_runtime_info({})` 回傳：

- 實際生效的 `mode`、`execution_enabled` 與 `write_enabled`。
- 隨附目錄的版本與動作數量。`server_support` 保持 `unknown`；單憑版本相符並不能證明支援該動作。
- 在執行模式中，實際生效的請求逾時、檔案大小與目錄配額限制、同時串流上限、下載目錄、上傳根目錄，以及是否啟用自動上傳。在文件模式中，`transport` 為 `null`。
- `connection_checked: false`。本機設定不能證明有實際登入。

此概觀不會揭露端點、存取權杖或授權標頭。已設定的檔案路徑是 MCP 主機上的路徑。所有串流動作仍需要寫入模式；`upload_enabled` 描述已設定的檔案根目錄，而不是繞過該閘門的權限。

`get_runtime_info({"check_connection": true})` 只有在讀取/寫入模式下有用戶端時才可用。它會使用一般唯讀執行閘門，明確查詢 `get_login_info`、`get_status` 與 `get_version_info`。`checks` 下的每個項目都包含其原始回應與診斷。部分失敗仍會保持可見。請檢查回傳的狀態資料以判斷線上狀態；單憑成功的一次 HTTP 交換並不能確立該帳號已上線。

## 取消與進度

MCP 取消現在也會到達一般 HTTP 呼叫以及串流動作，包括回應主體的讀取。一般呼叫保留其請求逾時；串流保留各自獨立的連線與每次讀取閒置逾時。被取消的呼叫不會自動重試。取消或逾時可能使遠端寫入的結果未知：停止等待並不會復原 Haizakura 已經收到的操作。

當呼叫端包含 `_meta.progressToken` 時，串流執行會以相同的權杖發出標準的 `notifications/progress` 通知。檔案下載會回報已寫入的解碼位元組；自動上傳會回報伺服器已確認的位元組。一般串流會回報已接受的框架數。只有在已知正的檔案大小時才會包含總量。空檔案與大小未知的下載會省略它。

通知限制為每 250 ms 一則，外加成功回應之前最後一次的待送出更新。值會遞增，通知會在取消或完成時停止，而未提供進度權杖的呼叫端不會收到任何通知。通知遞送失敗會被呈現出來。進度描述的是已傳輸的資料，而不是最終提交：只有成功的工具結果才能確認檔案驗證與完成。

既有的檔案含括、配額、部分檔案清理與上傳重設行為維持不變。檔案位元組永遠不會出現在進度訊息中。