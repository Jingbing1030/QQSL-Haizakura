# 群邀請與入群身分


成員 A 邀請 B，管理員 C 審批時，邀請人、入群者與處理者是三個獨立身分。
不要把 `group_increase.operator_id` 當成邀請人，也不要僅憑 `sub_type: invite` 推斷兩者相同。

## 入群通知

`group_increase` 保留原有的 `user_id`、`operator_id` 和 `sub_type`，增加：

| 欄位 | 含義 |
| --- | --- |
| `invitor_id` | QQ 明確提供的獨立邀請人 QQ 號；無法確定時為 `0` |
| `invitor_status` | `known` 表示邀請人 QQ 號已知；`unknown` 表示無法確定 |

部分審批入群推送提供獨立邀請人資訊，Haizakura 從該推送讀取並解析身分。
二維碼分享者與邀請人分開處理；舊式推送、自身入群通知或缺少來源資訊的通知保留 `unknown`。
不會按同群、同成員或時間接近程度猜測邀請關係，也不會用操作者填入邀請人。
身分查詢失敗會留下日誌，入群事件仍按現有策略上報，未知邀請人不阻斷通知。

## 群申請清單

`get_group_system_msg` 傳回的每筆記錄增加以下欄位：

| 欄位 | 含義 |
| --- | --- |
| `target_uin`、`target_nick` | 申請或被邀請入群者，始終表示 B |
| `operator_uin`、`operator_nick` | 處理該申請的操作者；審批場景中表示 C |
| `target_status`、`invitor_status`、`operator_status` | 對應 QQ 號為 `known` 或 `unknown` |

原有 `invitor_uin`、`invitor_nick` 表示 A。`requester_uin` 保持相容：一般申請表示申請人，
邀請登入帳號入群的記錄則表示邀請人。需要區分三方時，應使用 `target_uin`、`invitor_uin`、`operator_uin`。
QQ 只提供 UID 時會查詢對應 QQ 號，查詢會去重並限制併發；查詢錯誤會傳回介面錯誤，不偽裝成空清單。

```json
{
    "target_uin": 10002,
    "target_status": "known",
    "invitor_uin": 10004,
    "invitor_status": "known",
    "operator_uin": 10003,
    "operator_status": "known",
    "checked": true
}
```

**`0` 或 `unknown` 不代表「沒有邀請人」。** QQ 未提供身分、記錄不可見、身分尚未解析等情況均不能證明沒有邀請人。
目前已確認的欄位不足以對缺失資訊可靠作出「無邀請人」的判斷，因此不輸出這種推斷。
同樣，`checked: true` 只表示已處理，不代表必然審批通過；`operator_uin` 也可能是拒絕請求的人。

`count` 限制每個收件匣讀取的記錄數（最多 100）；`group_id` 在讀取後過濾，
並非查詢指定群的完整歷史。`only_pending` 預設為 `false`。空陣列表示本次讀取範圍內沒有符合記錄，
不能證明某次入群沒有邀請人。除錯日誌會分別記錄收件匣數量、類型篩選和最終篩選數量。

SDK 的 `getGroupSystemMessages()` 提供相應型別。新增欄位在 SDK 中為選用，以相容舊伺服器端；
連接舊伺服器端時，缺失的狀態也應視為未知。