# Group invitations and join identities


When member A invites B and administrator C approves, the inviter, the joiner, and the handler are three distinct identities.
Do not treat `group_increase.operator_id` as the inviter, and do not infer that the two are the same from `sub_type: invite` alone.

## Join notifications

`group_increase` keeps the existing `user_id`, `operator_id`, and `sub_type`, and adds:

| Field | Meaning |
| --- | --- |
| `invitor_id` | A separate inviter QQ number explicitly supplied by QQ; `0` when it cannot be determined |
| `invitor_status` | `known` means the inviter QQ number is known; `unknown` means it cannot be determined |

Some approval pushes carry separate inviter information, and Haizakura reads the identity from that push.
QR-code sharers are handled separately from inviters; legacy pushes, self-join notifications, and notifications missing source information keep `unknown`.
It never guesses an invitation relationship from the same group, the same member, or closeness in time, and never fills the inviter with the operator.
A failed identity lookup leaves a log entry; join events are still reported under the existing policy, and an unknown inviter does not block the notification.

## Group request list

Each record returned by `get_group_system_msg` gains the following fields:

| Field | Meaning |
| --- | --- |
| `target_uin`, `target_nick` | The requester or the invited joiner, always B |
| `operator_uin`, `operator_nick` | The operator handling the request; in an approval scenario this is C |
| `target_status`, `invitor_status`, `operator_status` | The corresponding QQ number is either `known` or `unknown` |

The original `invitor_uin` and `invitor_nick` denote A. `requester_uin` stays compatible: a normal request means the requester,
while a record inviting the logged-in account into a group means the inviter. To distinguish all three parties, use `target_uin`, `invitor_uin`, and `operator_uin`.
When QQ supplies only a UID, the corresponding QQ number is looked up; lookups are deduplicated and concurrency-limited, and a failed lookup returns an interface error rather than disguising itself as an empty list.

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

**`0` or `unknown` does not mean "there is no inviter".** QQ not supplying an identity, an invisible record, or an identity not yet resolved are none of them proof that no inviter exists.
The confirmed fields are not sufficient to decide "no inviter" reliably, so no such inference is emitted.
Likewise, `checked: true` only means the request has been handled, not that it was necessarily approved; `operator_uin` may also be the person who declined it.

`count` limits how many records are read from each inbox (100 at most); `group_id` filters after reading,
and does not query the complete history of the named group. `only_pending` defaults to `false`. An empty array means no record matched within this read,
which does not prove that a particular join had no inviter. Debug logs record the inbox count, the type filter, and the final filtered count separately.

The SDK's `getGroupSystemMessages()` exposes the corresponding types. The new fields are optional in the SDK for compatibility with older servers;
when connecting to an older server, missing statuses should likewise be treated as unknown.
