# OneBot action parity table: Haizakura vs. the SnowLuma reference oracle

Generated from two live sources, not from a hand-written list. The reference side is
`reference/index.mjs` evaluated by `ts/test/helpers/actions-oracle.ts`; the category
labels and grouping are parsed out of the bundle's own `var ACTION_GROUPS = [...]`
block (reference:21316-21365). The port side is the compiled `actionRegistry` in
`ts/src/onebot/actions/index.ts`.

**Measured:** reference 222 definitions / 228 executable names / 12 categories; port 222 definitions / 230 executable names / 12 categories.

**Verdict:** every action name in the reference has a registry implementation and every registry name is a reference name — the 222/228/12 claim holds.

The audited claim is 222 reference definitions / 228 executable names / 12 categories.
All three measured exactly: 222, 228, 12.

## 1. Definitions and executable names per category

| # | category (reference) | port label | ref definitions | port definitions | ref names | port names | parity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 信息 | 信息 | 5 | 5 | 5 | 5 | ✅ equal |
| 2 | 消息 | 消息 | 6 | 6 | 6 | 6 | ✅ equal |
| 3 | 好友 | 好友 | 3 | 3 | 3 | 3 | ✅ equal |
| 4 | 群信息 | 群信息 | 7 | 7 | 7 | 7 | ✅ equal |
| 5 | 群管理 | 群管理 | 24 | 24 | 24 | 24 | ✅ equal |
| 6 | 群文件 | 群文件 | 12 | 12 | 12 | 12 | ✅ equal |
| 7 | 请求 | 请求 | 2 | 2 | 2 | 2 | ✅ equal |
| 8 | 扩展 | 擴展 | 115 | 115 | 121 | 121 | ⚠️ counts equal, label differs |
| 9 | 群相册 | 群相册 | 9 | 9 | 9 | 9 | ✅ equal |
| 10 | 空间 | 空间 | 29 | 29 | 29 | 29 | ✅ equal |
| 11 | 系统表情 | 系统表情 | 4 | 4 | 4 | 4 | ✅ equal |
| 12 | 流式接口 | 流式接口 | 6 | 6 | 6 | 6 | ✅ equal |
| — | **total** | — | **222** | **222** | **228** | **230** | ⚠️ differ |

`definitions` counts actions (one per `defineAction`/`defineStreamAction`);
`names` counts every executable name, i.e. canonical plus alias.

## 2. Every action name, grouped by category

### 信息 (5 definitions, 5 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `can_send_image` | — | normal |
| `can_send_record` | — | normal |
| `get_login_info` | — | normal |
| `get_status` | — | normal |
| `get_version_info` | — | normal |

### 消息 (6 definitions, 6 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `delete_msg` | — | normal |
| `get_msg` | — | normal |
| `send_custom_face` | — | normal |
| `send_group_msg` | — | normal |
| `send_msg` | — | normal |
| `send_private_msg` | — | normal |

### 好友 (3 definitions, 3 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `delete_friend` | — | normal |
| `get_friend_list` | — | normal |
| `get_stranger_info` | — | normal |

### 群信息 (7 definitions, 7 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `get_group_honor_info` | — | normal |
| `get_group_info` | — | normal |
| `get_group_list` | — | normal |
| `get_group_member_info` | — | normal |
| `get_group_member_list` | — | normal |
| `get_group_share_link` | — | normal |
| `get_group_system_msg` | — | normal |

### 群管理 (24 definitions, 24 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `add_group_tag` | — | normal |
| `delete_group_tag` | — | normal |
| `get_group_admin_permissions` | — | normal |
| `get_group_admin_settings` | — | normal |
| `get_group_tags` | — | normal |
| `set_group_add_option` | — | normal |
| `set_group_admin` | — | normal |
| `set_group_admin_permissions` | — | normal |
| `set_group_admin_receive_verify` | — | normal |
| `set_group_anonymous` | — | normal |
| `set_group_anonymous_ban` | — | normal |
| `set_group_ban` | — | normal |
| `set_group_card` | — | normal |
| `set_group_kick` | — | normal |
| `set_group_kick_members` | — | normal |
| `set_group_leave` | — | normal |
| `set_group_member_invite_policy` | — | normal |
| `set_group_member_permissions` | — | normal |
| `set_group_name` | — | normal |
| `set_group_new_member_history_visibility` | — | normal |
| `set_group_portrait` | — | normal |
| `set_group_search` | — | normal |
| `set_group_special_title` | — | normal |
| `set_group_whole_ban` | — | normal |

### 群文件 (12 definitions, 12 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `create_group_file_folder` | — | normal |
| `delete_group_file` | — | normal |
| `delete_group_file_folder` | — | normal |
| `get_group_file_url` | — | normal |
| `get_group_files_by_folder` | — | normal |
| `get_group_root_files` | — | normal |
| `get_private_file_url` | — | normal |
| `move_group_file` | — | normal |
| `rename_group_file` | — | normal |
| `rename_group_file_folder` | — | normal |
| `upload_group_file` | — | normal |
| `upload_private_file` | — | normal |

### 请求 (2 definitions, 2 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `set_friend_add_request` | — | normal |
| `set_group_add_request` | — | normal |

### 扩展 (115 definitions, 121 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `_del_group_notice` | — | normal |
| `_get_friend_dress` | — | normal |
| `_get_group_notice` | — | normal |
| `_get_model_show` | — | normal |
| `_mark_all_as_read` | — | normal |
| `_send_group_notice` | — | normal |
| `_set_model_show` | — | normal |
| `.get_word_slices` | — | normal |
| `add_custom_face` | — | normal |
| `bot_exit` | — | normal |
| `cancel_group_todo` | — | normal |
| `check_url_safely` | — | normal |
| `clean_cache` | — | normal |
| `click_inline_keyboard_button` | — | normal |
| `complete_group_todo` | — | normal |
| `create_collection` | — | normal |
| `create_flash_task` | — | normal |
| `delete_custom_face` | — | normal |
| `delete_essence_msg` | — | normal |
| `delete_flash_file` | — | normal |
| `delete_group_folder` | — | normal |
| `download_file` | — | normal |
| `download_fileset` | — | normal |
| `fetch_custom_face` | — | normal |
| `fetch_custom_face_detail` | — | normal |
| `fetch_emoji_like` | — | normal |
| `fetch_ptt_text` | `get_ptt_text`, `get_record_text` | normal |
| `forward_friend_single_msg` | — | normal |
| `forward_group_single_msg` | — | normal |
| `friend_poke` | — | normal |
| `get_ai_characters` | — | normal |
| `get_ai_record` | — | normal |
| `get_clientkey` | — | normal |
| `get_collection_list` | — | normal |
| `get_cookies` | — | normal |
| `get_credentials` | — | normal |
| `get_csrf_token` | — | normal |
| `get_doubt_friends_add_request` | — | normal |
| `get_emoji_likes` | — | normal |
| `get_essence_msg_list` | — | normal |
| `get_file` | — | normal |
| `get_fileset_id` | — | normal |
| `get_fileset_info` | — | normal |
| `get_flash_file_list` | — | normal |
| `get_flash_file_url` | — | normal |
| `get_forward_msg` | — | normal |
| `get_friend_msg_history` | — | normal |
| `get_friends_with_category` | — | normal |
| `get_group_at_all_remain` | — | normal |
| `get_group_detail_info` | — | normal |
| `get_group_file_system_info` | — | normal |
| `get_group_ignore_add_request` | — | normal |
| `get_group_ignored_notifies` | — | normal |
| `get_group_info_ex` | — | normal |
| `get_group_msg_history` | — | normal |
| `get_group_shut_list` | — | normal |
| `get_group_signed_list` | — | normal |
| `get_group_todo_list` | — | normal |
| `get_image` | — | normal |
| `get_mini_app_ark` | — | normal |
| `get_msg_emoji_likes` | — | normal |
| `get_online_clients` | — | normal |
| `get_profile_like` | — | normal |
| `get_recent_contact` | — | normal |
| `get_record` | — | normal |
| `get_rkey` | `nc_get_rkey` | normal |
| `get_rkey_server` | — | normal |
| `get_share_link` | — | normal |
| `get_unidirectional_friend_list` | — | normal |
| `group_poke` | — | normal |
| `list_filesets` | — | normal |
| `mark_group_msg_as_read` | — | normal |
| `mark_msg_as_read` | — | normal |
| `mark_private_msg_as_read` | — | normal |
| `modify_custom_face` | — | normal |
| `move_custom_face_to_front` | — | normal |
| `nc_get_packet_status` | — | normal |
| `nc_get_user_status` | — | normal |
| `ocr_image` | `.ocr_image` | normal |
| `rename_flash_file` | — | normal |
| `request_decrypt_key` | — | normal |
| `send_ark_share` | — | normal |
| `send_flash_msg` | — | normal |
| `send_forward_msg` | — | normal |
| `send_group_ai_record` | — | normal |
| `send_group_ark_share` | — | normal |
| `send_group_forward_msg` | — | normal |
| `send_like` | — | normal |
| `send_packet` | `.send_packet` | normal |
| `send_poke` | — | normal |
| `send_private_forward_msg` | — | normal |
| `send_tuwen_ark` | — | normal |
| `set_diy_online_status` | — | normal |
| `set_doubt_friends_add_request` | — | normal |
| `set_essence_msg` | — | normal |
| `set_friend_remark` | — | normal |
| `set_friends_category` | — | normal |
| `set_group_reaction` | — | normal |
| `set_group_remark` | — | normal |
| `set_group_robot_add_option` | — | normal |
| `set_group_sign` | `send_group_sign` | normal |
| `set_group_todo` | — | normal |
| `set_input_status` | — | normal |
| `set_msg_emoji_like` | — | normal |
| `set_online_status` | — | normal |
| `set_qq_avatar` | — | normal |
| `set_qq_profile` | — | normal |
| `set_restart` | — | normal |
| `set_self_longnick` | — | normal |
| `share_group_ex` | — | normal |
| `share_peer` | — | normal |
| `trans_group_file` | — | normal |
| `translate_en2zh` | — | normal |
| `upload_forward_msg` | — | normal |
| `upload_foward_msg` | — | normal |

### 群相册 (9 definitions, 9 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `cancel_group_album_media_like` | — | normal |
| `del_group_album_media` | — | normal |
| `do_group_album_comment` | — | normal |
| `get_group_album_list` | — | normal |
| `get_group_album_media_list` | — | normal |
| `get_qun_album_list` | — | normal |
| `set_group_album_media_like` | — | normal |
| `upload_image_to_qun_album` | — | normal |
| `upload_video_to_qun_album` | — | normal |

### 空间 (29 definitions, 29 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `comment_qzone` | — | normal |
| `comment_qzone_public_feed` | — | normal |
| `delete_qzone_msg` | — | normal |
| `delete_qzone_public_comment` | — | normal |
| `delete_qzone_public_reply` | — | normal |
| `forward_qzone_public_feed` | — | normal |
| `get_qzone_feed_detail` | — | normal |
| `get_qzone_feeds` | — | normal |
| `get_qzone_home_feeds` | — | normal |
| `get_qzone_msg_detail` | — | normal |
| `get_qzone_msg_list` | — | normal |
| `get_qzone_profile` | — | normal |
| `get_qzone_public_capabilities` | — | normal |
| `get_qzone_public_comments` | — | normal |
| `get_qzone_public_feed_detail` | — | normal |
| `get_qzone_public_feeds` | — | normal |
| `get_qzone_public_replies` | — | normal |
| `get_qzone_share_ark` | — | normal |
| `like_qzone` | — | normal |
| `reply_qzone_public_feed` | — | normal |
| `send_qzone_msg` | — | normal |
| `set_qzone_ban` | — | normal |
| `set_qzone_msg_right` | — | normal |
| `set_qzone_profile` | — | normal |
| `set_qzone_public_comment_like` | — | normal |
| `set_qzone_public_follow` | — | normal |
| `set_qzone_public_like` | — | normal |
| `set_qzone_public_upvote` | — | normal |
| `unlike_qzone` | — | normal |

### 系统表情 (4 definitions, 4 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `fetch_face_entity` | — | normal |
| `fetch_super_face_id` | — | normal |
| `fetch_sys_faces` | — | normal |
| `search_sys_faces` | — | normal |

### 流式接口 (6 definitions, 6 executable names)

| canonical | aliases | kind |
| --- | --- | --- |
| `clean_stream_temp_file` | — | normal |
| `download_file_image_stream` | — | stream |
| `download_file_record_stream` | — | stream |
| `download_file_stream` | — | stream |
| `test_download_stream` | — | stream |
| `upload_file_stream` | — | stream |

## 3. The six aliases

Each is a second executable name for an existing definition; the registry binds
both names to the same handler.

| alias | aliases definition | executable names of that definition |
| --- | --- | --- |
| `get_ptt_text` | `fetch_ptt_text`  | `fetch_ptt_text`, `get_ptt_text`, `get_record_text` |
| `get_record_text` | `fetch_ptt_text`  | `fetch_ptt_text`, `get_ptt_text`, `get_record_text` |
| `nc_get_rkey` | `get_rkey`  | `get_rkey`, `nc_get_rkey` |
| `.ocr_image` | `ocr_image`  | `ocr_image`, `.ocr_image` |
| `send_group_sign` | `set_group_sign`  | `set_group_sign`, `send_group_sign` |
| `.send_packet` | `send_packet`  | `send_packet`, `.send_packet` |

## 4. Regenerating this table

This table is emitted by the test file itself, so there is no separate generator
script to drift out of date. From the repository root:

```sh
cd ts && npx tsc -p tsconfig.json
cd ts && ACTION_PARITY_EMIT=1 node build/test/action-parity-table.test.js \
  > ../docs/action-parity-table.md
```

Verifying the same measurements as assertions:

```sh
cd ts && npx tsc -p tsconfig.json
cd ts && node --test build/test/action-parity-table.test.js
```

## 5. Measured divergences and scope notes

### 5.1 One category label differs (counts unaffected)

The bundle's `ACTION_GROUPS` spells the extended family's category **扩展**
(simplified); the port spells it **擴展** (traditional). `category` is copied onto
every action's `doc` and into the `categories` summary, but dispatch never reads
it, so this changes documented metadata only, not routing. Measured mismatches:

- index 7: reference "扩展", port "擴展"

The per-category counts, the definition total and the name set all still match,
which is why the audited 222/228/12 claim holds despite this.

### 5.2 What the 228 does and does not include

228 is the executable-name count of the bundle's **action definitions** (the 14 action
arrays / 12 categories). The bundle's `compileActionRegistry` is also called with two
**raw reservations** — `.handle_quick_operation` and `.handle_quick_operation_async`
(reference:21369-21375) — which live outside `ACTION_GROUPS` and outside the oracle. So
the full reference registry's `executableNames` is 230, not 228.

The port now mirrors that: `rawActions` holds the same two reservations, so
`actionRegistry.executableNames.length` is **230** (228 definition names + 2 raw) while
`actionRegistry.actions.length` stays 222 and `categories` stays 12. The raw names are
excluded from this file's `extraNames` measurement by name, because they are neither a
missing nor a spurious definition — they are a reservation, and a name the reference
registers but that no `ACTION_GROUPS` array contains. The 222/228/12 claim in §1-§4 is a
claim about `ACTION_GROUPS` and is unaffected.

Until this landed the port had no raw reservations at all (`kind === "raw"` count: 0),
so `ts/src/onebot/http.ts`'s `api.handle(".handle_quick_operation", ...)` — the v11
quick-operation reply path — answered 1404 unknown action. That behavioural gap is now
closed; see `ts/test/quick-operation.test.ts`.

### 5.3 How to read this document

- A name is either a **definition** (`canonical`, `names[0]`) or an **alias**
  (`names[1..]`). The registry must contain every reference name exactly once and
  nothing else.
- The parity column compares definition count, name count AND label per group.
  A group with equal counts but a different label is marked as such, not as equal.

## 6. Execution status at HEAD (2026-11-23)

Name parity is only half the claim: a registered action can still be unexecutable.
`EXTENDED_ACTION_STATE` records how each extended action reaches the world, and every
entry was verified by BUILDING its handler, not by reading the table.

| state | count | meaning |
| --- | --- | --- |
| `live` | **67** | answered straight from the bridge layer, no host injection |
| `host` | **54** | needs a provider injected by `ActionContextHost` |
| `blocked` | **0** | ← was 12 before this batch |

`action-context-host.ts` carries exactly **one** `notImplemented` left:
`fetchPttText`. It is deliberate — the reference's own `ptt_trans_result` path maps to
`null`, so there is no ASR request shape to port.

### 6.1 Verification actually performed

- **All 222 reference actions build a handler.** `spec.toHandler({})` was invoked for
  every reference name: 222 built, 0 threw. A registered-but-unbuildable action would
  fail here.
- **All 54 `host` actions build a handler** under a stub context: 54 built, 0 errors.
- **The eight former `blocked` actions reach their slice.** Driven against a real
  `Bridge` with no packet sender attached, each one fails at the TRANSPORT
  (`no packet sender attached`) or a data lookup (`no uid known for friend …`) — never
  at a stub guard. This is asserted in `ts/test/bridge-apis.test.ts`; the stub-era
  `if (!ctx.bridge.apis.x.y)` guards were removed because a guard that can never fire
  hides a real failure behind "… is unavailable".
- **Live QQ, four formerly-blocked endpoints, all `retcode: 0`:**
  `get_friends_with_category` (real roster with 4 buddies), `get_mini_app_ark`
  (real Ark card: `com.tencent.miniapp_01`, `view_8C8E…`, bili appid `1109937557`,
  server-issued `token`), `get_unidirectional_friend_list` (`[]` — the account genuinely
  has none), `list_filesets` (`[]`).

### 6.2 What parity does NOT cover

The reference ships subsystems that are not OneBot actions and are not part of this
claim: `src/webui` (a 7,021-line SPA that is not in this repository) and `src/update`
(677 lines, deliberately not ported). The notification subsystem is ported and wired
into `main.ts`; its `testSend`/`getRecent` have no HTTP caller yet because that caller
is WebUI code.

## 7. Method-level parity (2026-11-23)

Name parity (§1-§2) and execution status (§6) are both necessary but neither is sufficient.
A third axis was audited: **every method of every `*Api` class** in the reference, extracted
mechanically from `var XxxApi = class {` bodies and diffed against this port.

**Result: 15 reference classes, 0 missing methods.**

That number is not interesting by itself. What is interesting is what the audit FOUND: 25
methods were missing, and eight of them were **runtime crashes under a green suite**.

### 7.1 Why the suite was green

The `OidbSpec`s for these calls had been ported and tested — the wire bytes were correct,
the response decoding was correct. What was absent was the one-line forwarder on the API
class. So:

- spec tests passed (protocol is right),
- `EXTENDED_ACTION_STATE` said `"live"` (the action body existed),
- and the action **threw `TypeError: ... is not a function`** when called.

Three of them failed the other way, answering `"… is unavailable"` — a guard that could
never fire said the feature was missing when the only thing missing was the method.

Neither failure mode is visible unless you check "does the action reach its dependency",
which is what `test/api-method-parity.test.ts` now asserts.

### 7.2 The eight crashes

| action | previous symptom | now |
| --- | --- | --- |
| `ocr_image` / `.ocr_image` | `TypeError: … ocrImage is not a function` | reaches `0xeb7_12` |
| `send_group_sign` | `TypeError: … sendGroupSign is not a function` | reaches `0xeb7_6` |
| `translate_en2zh` | `TypeError: … translateEn2Zh is not a function` | returns `["你好","世界"]` on live QQ |
| `set_group_portrait` | `TypeError: … setGroupAvatar is not a function` | cmdId **3000** + `GroupAvatarExtra` |
| `click_inline_keyboard_button` | `"inline keyboard is unavailable"` | reaches `0x112e_1` |
| `get_group_at_all_remain` | `"at-all remain is unavailable"` | live: `can_at_all: true`, 20/10 left |
| `send_tuwen_ark` | `"tuwen ark is unavailable"` | reaches `0xdc2_34` |
| `get_decrypt_key` | (unguarded) `TypeError` | two distinct failures preserved |

`GroupAvatarExtra` had to be hand-encoded — it is not an `OidbSpec`. Field numbers were
read out of the reference's own writer (`reference:333128-333230`) and are asserted
literally in the test: `type`=f1 (101), `groupUin`=f2, `field3`=f3 (nested `{field1:1}`),
`field5`=f5 (3), `field6`=f6 (1).

### 7.3 Satori: a deliberate, documented deviation

The reference advertises **26** features (`SATORI_FEATURES`, reference:343812-343838) but
serves **24** (`SATORI_API`, reference:344176). `message.list.from` and `guild.plain` are
advertised and have no handler, so a client that trusts the list gets a 404.

This port advertises exactly what it serves — 24 and 24. That is a **deviation from the
reference and the correct behaviour**; it is asserted in both directions so a future method
cannot be advertised before it is implemented.

### 7.4 What was NOT a gap

Several apparent gaps dissolved on inspection and are recorded so they are not re-audited:

- `MessageApi.needsName`, `QzoneApi.publish`, `ForwardApi.needsName` — present as `private`
  methods; the first extraction pass missed the modifier.
- `GroupAdminApi.fetchGroupPrivilegeFlag` — a thin derivation of
  `fetchGroupPrivilegeState`, which shares one `FetchGroupDetail` read so the two cannot
  straddle a change.
- `ContactsApi.loadFriendProfile` — a concurrency limiter whose `finally` is
  `if (next) next(); else this.activeProfiles--`, not a plain decrement. Getting that wrong
  lets the concurrency cap drift permanently.
