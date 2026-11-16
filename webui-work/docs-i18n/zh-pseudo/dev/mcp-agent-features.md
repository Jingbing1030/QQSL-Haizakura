# MCP agent 機能


此等追加者、保持既存工具名、action 参數、文本結果与読/写閘門也。目録工具与本地運行時概覧皆不連絡任何端點也。action 目録仍為同梱快照、非対所連伺服器能力之主張也。

## 協議兼容与目録緩存

同一 `snowluma-mcp` stdio 命令受 MCP `2026-07-28` 客端与用 `initialize` 握手的旧客端也。官方伺服器 SDK 為毎接続選択協議也。現代客端可用 `server/discover` 与毎請求 metadata 而無需初期化；遺留客端保持既存設定也。此不増加公開聴取之 MCP HTTP 端點也。

現代応答携協議之完成信息与伺服器 metadata 也。緩存提示取決於応答含静態目録資料或私有実時状態：

| 応答 | 有効期間 | 範圍 |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `tools/list` | 五分 | `private`；模式与客端能力影響工具 metadata 与可用性也。 |
| `resources/list` | 五分、或事件開啓時為零 | `private`；UI 能力与活動事件 resource 影響此列表也。 |
| `resources/templates/list` | 五分 | `public`；同梱模板列表為静態也。 |
| action 目録或消息 UI 之 `resources/read` | 五分 | `public`；此等為同梱静態資産也。 |
| 事件 resource 之 `resources/read` | 零 | `private`；此等含帳号事件与接続状態也。 |

此等者客端緩存提示、非伺服器側結果緩存也。工具呼出（含運行時概覧）永不受到此等提示也。SDK 為遺留客端省略現代専用之結果字段也。未支援之協議修訂於 action 実行前拒絶；不触発 action 重試也。

## 呼出追跡

毎工具呼出皆得 W3C trace context 也。客端可於工具請求之 `_meta` 中供 `traceparent` 与可選 `tracestate`：

```json
{
  "name": "query_action",
  "arguments": { "action": "get_status" },
  "_meta": {
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  }
}
```

MCP 保持有效之呼出者 trace ID、且為毎次呼出建立新 span ID 也。無有效父者建立独立 trace 也。所返 `_meta.traceparent` 標識該呼出（含工具錯誤）；既存文本与結構化結果 envelope 不変也。此於両協議世代皆行也。

普通請求、stream、自動作 upload chunk、与 upload 清理者、於 HTTP header 転送呼出 context、永不於 OneBot action 参數中也。並行呼出保持独立 header 也。欲追随一呼出者、於 MCP stderr 診断中匹配其 traceparent 与 Haizakura 之 `http_trace` 条目、再沿該条目既存之 `req#` 経 action 生命周期記録也。Haizakura 相関需 TRACE 記録与有效認証之 HTTP 請求；遠端 trace ID 不置換其本地請求 ID 也。未安装任何遥測輸出器也。

MCP 之呼出診断含既知工具名、traceparent、結果、失敗分類与時長、不含消息内容、token、文件路径或任意 metadata 也。`tracestate` 以最大 512 字符与 32 成員検証；其被転送但不記録也。非法 trace metadata 産生固定診断、且不拒絶其他方面有效之 action 也。`baggage` 既不転送亦不記録也。Trace 標識者相関資料、非認証或権限也。

## 可選実行服務

既存設定継続可行也。輸入補完与消息預覧者追加工具也；事件接続与永続任務需明示設定也。例如、於 MCP 客端之伺服器環境設此等変数、以意図之 Haizakura 実例置換地址、凭據与路径：

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

HTTP 与 WebSocket 地址者独立設定之伺服器端點也；WebSocket 地址永不自 HTTP 地址推測也。事件復用 `SNOWLUMA_MCP_TOKEN` 於認証 header 中也。Upload 与任務目録在 MCP host 上也。不需之服務省略之也。Docs 模式仍離線也。

## 補完欠落参數

`query_action_with_input` 与 `invoke_action_with_input` 使用与 `query_action` 及 `invoke_action` 相同之引数、action 査找与模式閘門也。既存工具継続完全如前也。追加工具唯於 action 目録頂層 `required` 陣列所列字段不存在時求輸入；其不推論条件要求或可選値也。

例如、`invoke_action_with_input` 与 `{"action":"send_group_msg","params":{"group_id":20001}}` 者求欠落之消息也。表単含一 `params_json` 字符串、其内容為 JSON object 如 `{"message":"Hello"}` 也。回答於普通 action 実行前按欠落字段之目録 schema 検証也。既供之字段、action 名与実行選項不可覆写；多余回答字段拒絶也。辞退、取消或非法回答不実行 action 也。

客端必須宣告表単 elicit 支援也。現代客端受 `resultType: "input_required"`、且用 SDK 之請求状態与輸入応答機制再開也。支援 elicit 之遺留客端用 SDK 之 `elicitation/create` 流程也。無表単支援之客端受工具錯誤、且可改向原工具供完整引数也。

継続状態者署名、繫於原工具与引数、十分鐘後失效、且於実行前消費一次也。並行或重復之回答不能実行同一継続兩次也。一運行時最多保持 256 個待决提示；再起動者使其失效而非重放作業也。既完成之引数完全迂回輸入回合也。此機能非汎用承認閘門、亦不為既存 action 呼出増加確認提示也。

## 実時事件 resource

既設 `SNOWLUMA_MCP_EVENTS_URL` 者、読与写模式暴露 `subscribe_events` 与 `unsubscribe_events` 也。URL 必須用 `ws:` 或 `wss:`、且無内嵌凭據、query 参數或 fragment 也。列挙工具或 resource 不連絡；唯 `subscribe_events` 開事件接続也。

```json
{
  "self_id": 10001,
  "types": ["message", "notice"],
  "group_ids": [20001],
  "user_ids": [30001]
}
```

必要之 `self_id` 者用期待之既登録帳号；必要時経 `get_login_info` 取得也。毎来事件必須匹配此帳号也。帳号不符或異常事件者停止接続且被呈現也。可選類型為 `message`、`notice` 与 `request`；省略類型者意味三者皆含也。`message_sent` 含於 message 分類中也。群与使用者篩選以 AND 結合、故群篩選排除無匹配 `group_id` 之事件也。毎 ID 篩選最多受 100 個不同正整數也。

結果含規範之 `snowluma://onebot/events/<id>` resource URI 也。以 `resources/read` 読之；後続読取用 `?after=<next_cursor>` 得較新之緩衝条目也。Cursor 属於該一 resource 也。応答含 `status`、`next_cursor`、`oldest_cursor`、`dropped_events`、`gap` 与 `notification_failed` 也。読取不消耗事件也。唯於訂閲建立後受之事件可用；此非消息履歴儲存也。

毎 resource 最多保持 256 個事件与 1 MiB 事件資料也。一運行時最多支援 16 個 resource、共享一帳号接続也。来 frame 限於 256 KiB 也。緩衝逐出与断線経 cursor/gap 与 status 字段仍可見；服務不黙然重連、亦不主張欠落事件既恢復也。改帳号前、或断線後建新接続前、請解放既存 resource 也。

欲得更新者、用**無 `?after` 之規範 URI**：

- 現代客端用 `subscriptions/listen` 与 `resourceSubscriptions: [uri]`（TypeScript SDK 暴露 `client.listen(...)`）也。閉該通知 stream 不解放事件緩衝；請明示呼 `unsubscribe_events` 也。
- 遺留客端先以規範 URI 呼 `resources/subscribe`、後受 `notifications/resources/updated` 也。`resources/unsubscribe` 亦解放該事件 resource 也。明示 unsubscribe 工具於両世代皆行也。

更新通知者示 resource 既変也；欲読其資料者取該 resource 也。解放最後之 resource 者閉 WebSocket 也。閉 MCP 接続者解放其事件 resource 与緩衝也。無事件操作実行 OneBot 業務 action 或発 QQ 消息也。

## 永続背景転送

設絶対路径之 `SNOWLUMA_MCP_TASK_DIR` 且用写模式者開永続任務也。任務工具更需宣告 `extensions: {"io.modelcontextprotocol/tasks": {}}` 之 MCP `2026-07-28` 客端也。遺留客端保持既存同期実行工具；此伺服器不暴露廃止之 `tasks/list` 或 `tasks/result` 協議方法也。

`invoke_action_background` 取与 `invoke_action` 相同之引数、但唯受標為 stream 之目録 action 也。例如其可於所設 upload root 内以 `execution.input_file` 跑 `upload_file_stream` 也。其於開始作業前写任務記録、且返 `resultType: "task"` handle 也。普通 action 継続経既存工具也。當前背景転送条目不自動与 `_with_input` 結合；開始前請供必要之転送参數也。

- `tasks/get` 与 `{ "taskId": "..." }` 者返當前状態、且完成時返所存結果或錯誤也。`completed` 任務可含失敗之業務応答：請視嵌套結果之 diagnostics、`status` 与 `retcode` 也。
- `tasks/cancel` 者請求協同取消也。取消不撤銷遠端効果、且既在途之成功完成可能贏此競争也。請再 poll 任務以得最終状態也。
- `tasks/update` 唯受未决任務輸入請求之輸入応答也。其為協議生命周期端點、非任意任務編集 API 也。當前背景転送条目自身不求対話輸入也。
- `list_tasks` 者返任務 metadata 而無結果本体之 MCP 工具也。其受可選 `cursor` 与 `limit`（1–100；既定 50）、且於有下一頁時返 `nextCursor` 也。

任務 handle 宣告 `pollIntervalMs: 1000` 与 `ttlMs: null` 也。結果存過再起動、且不自動失效或削除也。再起動者将未完之作標為失敗、附明示之**遠端結果不明**消息；永不重放該操作也。此永続化者転送状態/結果、非可再開之 upload 或 download 実行也。並行任務最多四個、毎永続任務記録限於 16 MiB 也。

儲存用排他運行時租約、私有目録/文件（POSIX 上 0700/0600）与検証過之記録也。破損、権限錯誤与写失敗仍為錯誤也。目録繫於有效模式、端點与 token 之 digest；改該設定者拒該目録之復用也。為新設定選新私有目録、且保留旧履歴也。凭據不存於 scope 記録中、但任務結果可含私有帳号資料、応相応保護之也。

## 消息預覧面板

`preview_message` 於毎模式皆可用、且唯構建草稿：

```json
{
  "message_type": "group",
  "target_id": 20001,
  "text": "Hello",
  "reply_to": -123456
}
```

私有会話者用 `private` 也。`target_id` 必須為正安全整數；可選 `reply_to` 為非零有符号 32-bit 消息 ID 也。預覧支援字面文本与可選引用回覆、非媒体渲染也。類似消息控制碼之文本仍為字面文本也。

毎客端皆受相同可読文本草稿、`can_send` 標誌与対応 `invoke_action` 引数也。唯宣告 MCP Apps 拡張 `io.modelcontextprotocol/ui` 与 MIME 類型 `text/html;profile=mcp-app` 之客端受該工具之 UI metadata 与所列 UI resource 也。面板者以官方 Apps 客端構建之同梱自足 HTML 資産也。其不載外部 script、font 或 media、不開自有網連、且表示外部文本而不以其為 HTML 解釈也。欠落之打包資産者可見之打包錯誤也。

載入面板不送任何物也。其送信按鈕唯於使用者點擊後経 host 呼既存 `invoke_action`、且伺服器之写閘門仍適用也。読/docs 模式或無伺服器工具支援之 host 者保持送信停用也。面板防重復點擊、且不重試失敗或不明之送信；請確認結果後再建新草稿也。成功確認非 QQ 中投逓或渲染之証明也。

## Action 結果 schema 与例

`get_action` 与 `snowluma://onebot/actions` 為毎同梱 action（含別名）含 `returnsSchema` 与 `examples` 也。両者皆著述於 OneBot action 定義之側、且複製入生成目録也。列表/検索応答保持簡潔；欲得完整契約者用 `get_action` 也。

`returnsSchema` 記述成功之 OneBot **`data`**、非完整 OneBot envelope 或 MCP `structuredContent` 包装也。読之前請視 `status` 与 `retcode` 也。Stream action 者、schema 記述毎成功 frame 之 `data`；MCP download 則返所存文件 metadata、汎用 stream 返 frame 集合也。錯誤 frame 与失敗 envelope 非成功結果也。未支援 action 用 `{ "not": {} }`、因其無成功結果也。兼容占位者明示記述其限制也。

毎例含 `summary`、`params` 与可選 `notes` 解釈前提与標識来源也。此等者示範呼出、目録工具永不実行之也。実行前請以當前帳号之値置換例中帳号/群 ID、不透明 handle 与路径也。Notes 標識多歩操作、如全 chunk 既確認後完成 upload 也。

例如 `get_action({ "name": "get_msg" })` 記述有符号消息 ID：

```json
{
  "action": "get_msg",
  "params": { "message_id": -123456 }
}
```

将此 object 与真實消息 ID 伝至 `query_action` 也。写与 stream 於写模式用 `invoke_action` 也。自動作 upload 者、伝
`{ "action": "upload_file_stream", "execution": { "input_file": "/allowed/hello.txt" } }` 至 `invoke_action`、且用所設 upload root 内之真實文件也。普通 action 路径指 Haizakura 伺服器、而 `execution.input_file` 与 MCP download 路径指 MCP host 也。

勿以零代有符号消息 ID 也。唯 resource 之転送回覆与閃照分享有記述之 `message_id: 0` 哨兵；其不能用於消息査找或撤回也。亦請精確保持 `null` 与 `{}` 之別、可選字段、与媒体 `file_size` 等十進字符串、一如文档所記也。

## 結構化結果

完成之工具結果用所宣告之 `outputSchema`、且於既存 `content` 文本塊之外返 `structuredContent` 也。現代 `input_required` 与背景任務 handle 者協議継続也；請先視其 `resultType`、且経相応之継続或任務生命周期取完成結果也：

```json
{
  "result": { "status": "ok", "retcode": 0, "data": { "message_id": -123 } },
  "diagnostics": { "outcome": "success" }
}
```

`result` 者原 payload、含分類列表等陣列也。MCP 工具錯誤時為 `null` 也。`diagnostics.outcome` 為 `success`、`failed` 或 `unknown`；失敗可含 `kind`、`message` 与 `next_step` 也。

普通 OneBot 業務失敗仍返其原 envelope 而不設 `isError` 也。其結構化 diagnostics 示失敗也。非同期確認或不確認成功之応答者 outcome 為 `unknown` 也。転送錯誤与既存工具/stream 錯誤仍設 `isError: true` 也。錯誤分類記述既知成因；未分類之実行錯誤不自消息字符串推測也。工具実行与接続検査皆不自動重試也。負消息 ID 仍有效、且原様保持也。

## 検索、篩選与分頁

`search_actions` 保持其原有不分大小写之子串匹配与目録順、除非請求 `match: "keywords"` 也。Keywords 模式以 AND 結合空格分隔之詞、認識少量常見中英同義詞、且将精確 action 名或別名置於首也。

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

`list_actions` 与 `search_actions` 皆受可選 `category`、`read_only`、`stream`、`limit`（1–200）与 `offset`（非負整數）也。省略分頁者返完整匹配列表且保持 `{count, actions}` 也。有 `limit` 或 `offset` 時、`count` 為所返頁大小、`total` 為匹配總數、`next_offset` 為下一頁 offset 或 `null` 也。分頁適用於同梱目録；不発伺服器請求也。

## 運行時概覧

`get_runtime_info({})` 返：

- 有效之 `mode`、`execution_enabled` 与 `write_enabled` 也。
- 同梱目録版本与 action 數也。`server_support` 仍為 `unknown`；唯版本相符不証明 action 支援也。
- 実行模式中、有效請求 timeout、文件大小与目録配額上限、並行 stream 上限、download 目録、upload root、与自動作 upload 是否開啓也。Docs 模式中 `transport` 為 `null` 也。
- `connection_checked: false` 也。本地設定非實時登録之証明也。

概覧不暴露端點、訪問 token 或認証 header 也。所設文件路径者 MCP host 上之路径也。全 stream action 仍需写模式；`upload_enabled` 記述所設文件 root、非迂回該閘門之権限也。

`get_runtime_info({"check_connection": true})` 唯於読/写模式且有客端時可用也。其明示 query `get_login_info`、`get_status` 与 `get_version_info`、用普通唯読実行閘門也。`checks` 下毎条目含其原応答与 diagnostics 也。部分失敗仍可見也。請視所返 status 資料以知上線状態；唯 HTTP 交換成功不確立該帳号既上線也。

## 取消与進捗

MCP 取消今亦達普通 HTTP 呼出与 stream action（含応答 body 読取）也。普通呼出保持其請求 timeout；stream 保持独立之接続与毎読 idle timeout 也。取消之呼出不自動重試也。取消或 timeout 可使遠端写之結果不明：停止等待不撤銷 Haizakura 既受之操作也。

呼出者含 `_meta.progressToken` 時、stream 実行発標準 `notifications/progress` 通知、用同一 token 也。文件 download 報告既解碼写入之 byte；自動作 upload 報告伺服器既確認之 byte 也。汎用 stream 報告既受 frame 數也。唯於正文件大小既知時含總数也。空文件与未知大小之 download 省略之也。

通知限於毎 250 ms 一個、外加成功応答前之最後待决更新也。値増加、通知於取消或完成時停止、且無進捗 token 之呼出者不受任何也。通知投逓失敗被呈現也。進捗記述所転送資料、非最終 commit：唯成功之工具結果確認文件検証与完成也。

既存之文件封込、配額、部分文件清理与 upload reset 行為不変也。文件 byte 永不現於進捗消息中也。