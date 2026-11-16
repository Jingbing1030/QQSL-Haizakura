# 群招待与入群身分


成員 A 招 B、管理者 C 審批時、招者、入群者、処理者者三独立身分也。
`group_increase.operator_id` 招者視非也、`sub_type: invite` 仅依両者同一推断亦非也。

## 入群通知

`group_increase` 既存之 `user_id`、`operator_id`、`sub_type` 保持、且追加：

| 字段 | 意味 |
| --- | --- |
| `invitor_id` | QQ 明示提供之独立招者 QQ 号；確定不能時者 `0` 也 |
| `invitor_status` | `known` 者招者 QQ 号既知意味；`unknown` 者確定不能意味也 |

一部之審批入群推送者独立招者情報提供、Haizakura 該推送自読取身分解析也。
二次元碼共有者与招者分離処理也；旧式推送、自身入群通知、来源情報欠落之通知者 `unknown` 保持也。
同群、同成員、時間近接依招関係推測非也、操作者依招者充填亦非也。
身分査詢失敗者記録残留、入群事件者既存方針依上報、未知招者者通知阻断非也。

## 群申請列表

`get_group_system_msg` 返却之各記録者以下字段追加也：

| 字段 | 意味 |
| --- | --- |
| `target_uin`、`target_nick` | 申請者或被招入群者、常時 B 表示也 |
| `operator_uin`、`operator_nick` | 該申請処理之操作者；審批場面者 C 表示也 |
| `target_status`、`invitor_status`、`operator_status` | 対応 QQ 号者 `known` 或 `unknown` 也 |

既存之 `invitor_uin`、`invitor_nick` 者 A 表示也。`requester_uin` 者互換保持：通常申請者申請人表示、
登録帳号招入群之記録者招者表示也。三方区別必要場合、`target_uin`、`invitor_uin`、`operator_uin` 使用可也。
QQ 仅 UID 提供場合者対応 QQ 号査詢、査詢去重且並行制限；査詢錯誤者接口錯誤返却、空列表偽装非也。

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

**`0` 或 `unknown` 者「招者無」意味非也。** QQ 身分未提供、記録不可視、身分未解析等之情況皆招者無之証明非也。
當前確認済字段者欠落情報対之「招者無」判断信頼可能非也、故該推断出力非也。
同様、`checked: true` 者処理済仅意味、必然審批通過意味非也；`operator_uin` 者拒否者之場合亦有也。

`count` 者各受信箱読取記録数制限也（最大 100）；`group_id` 者読取後濾過、
指定群之完全履歴査詢非也。`only_pending` 既定 `false` 也。空配列者本次読取範囲内匹配記録無意味、
某入群之招者無証明不能也。調試記録者受信箱数量、類型篩選、最終篩選数量分別記録也。

SDK 之 `getGroupSystemMessages()` 者相応類型提供也。新規字段者 SDK 中任意、旧伺服器互換為也；
旧伺服器接続時、欠落状態亦未知視必要也。
