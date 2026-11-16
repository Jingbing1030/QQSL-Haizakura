# 群招待与入群身分


成員 A 者 B 招待、管理者 C 審批時、招待人、入群者与処理者者三独立身分也。
`group_increase.operator_id` 招待人扱不可、亦 `sub_type: invite` 仅依両者同一推断不可也。

## 入群通知

`group_increase` 者原有之 `user_id`、`operator_id` 与 `sub_type` 保持、以下増加：

| 字段 | 含義 |
| --- | --- |
| `invitor_id` | QQ 明示提供之独立招待人 QQ 号；確定不可時 `0` |
| `invitor_status` | `known` 者招待人 QQ 号既知表；`unknown` 者確定不可表 |

一部審批入群推送者独立招待人信息提供、Haizakura 者該推送自読取且身分解析也。
二次元碼共有者与招待人分離処理也；旧式推送、自身入群通知或来源信息欠之通知者 `unknown` 保持也。
同群、同成員或時刻近接依招待関係推測無、亦操作者依招待人填充事無也。
身分照会失敗者記録残留、入群事件尚既存策略依上報、未知招待人者通知阻断無也。

## 群申請列表

`get_group_system_msg` 返却之毎記録者以下字段増加：

| 字段 | 含義 |
| --- | --- |
| `target_uin`、`target_nick` | 申請或被招待入群者、常 B 表也 |
| `operator_uin`、`operator_nick` | 該申請処理之操作者；審批場面中 C 表也 |
| `target_status`、`invitor_status`、`operator_status` | 対応 QQ 号者 `known` 或 `unknown` |

原有 `invitor_uin`、`invitor_nick` 者 A 表也。`requester_uin` 者互換保持：普通申請者申請人表、
招待登録帳号入群之記録者招待人表也。三方区別必要時、`target_uin`、`invitor_uin`、`operator_uin` 使用求也。
QQ 只 UID 提供時者対応 QQ 号照会、照会去重且並行制限也；照会錯誤者接口錯誤返、空列表偽装無也。

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

**`0` 或 `unknown` 者「招待人無」表非也。** QQ 身分不提供、記録不可見、身分未解析等情況皆招待人無之証明為不可也。
当前既確認之字段者欠落信息対「招待人無」可靠判断為不足、故此推断輸出無也。
同様、`checked: true` 者処理済仅表、必然審批通過表非也；`operator_uin` 者拒否請求之人可能性亦有也。

`count` 者毎受信箱読取之記録数制限（最大 100）；`group_id` 者読取後濾過、
指定群之完全履歴照会非也。`only_pending` 既定 `false` 也。空配列者本次読取範囲中一致記録無表、
某入群対招待人無之証明為不可也。調試記録者受信箱数量、類型篩選与最終篩選数量分別記録也。

SDK 之 `getGroupSystemMessages()` 者相応類型提供也。新增字段者 SDK 中任意、旧伺服器互換為也；
旧伺服器接続時、欠落之状態亦未知扱求也。