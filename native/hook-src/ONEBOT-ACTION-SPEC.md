# SnowLuma OneBot Action 精确规格清单

**222 个定义块 / 228 个可执行名 / 111 条独立 serviceCmd**

数据来源【实测】：生产容器 `snowluma-hz` 的 `/app/runtime/index.mjs`，
12,868,402 B，md5 `b5a37ba5e8b734496932be32131634b1`
（本地副本字节数与容器内 `ls -l` 完全一致）。

全部 `summary` / `params` / `returns` 均为 bundle 原文抽取，无人工改写。抽取与验证方法见 §7。

---

## 0. 规模核对

| 项 | 本清单实测 | MEMORY.md §2.14 基线 | 判定 |
| --- | --- | --- | --- |
| 定义块 | **222** | 222 | ✅ 一致 |
| 可执行名（含别名） | **228** | 228 | ✅ 一致 |
| 分组明细 | 信息5 / 消息6 / 好友3 / 群信息7 / 群管理24 / 群文件12 / 请求2 / 扩展115 / 群相册9 / 空间29 / 系统表情4 / 流式接口6 | 同 | ✅ 一致 |
| 独立 serviceCmd | **111** | 未记录 | 🆕 新增 |
| 参数字段总数 | **457** | 未记录 | 🆕 新增 |
| 需要 bridge（原生） | **202** | 202 | ✅ 一致 |
| 纯 JS | **20** | 23 | ⚠️ 差 3，见 §4.3 |

| 分组 | 定义数 | 源文件 |
| --- | --- | --- |
| 信息 | 5 | info.ts |
| 消息 | 6 | message.ts |
| 好友 | 3 | friend.ts |
| 群信息 | 7 | group-info.ts |
| 群管理 | 24 | group-admin.ts |
| 群文件 | 12 | group-file.ts |
| 请求 | 2 | request.ts |
| 扩展 | 115 | extended.ts |
| 群相册 | 9 | group-album.ts |
| 空间 | 29 | qzone-public.ts<br>qzone.ts |
| 系统表情 | 4 | system-face.ts |
| 流式接口 | 6 | stream-download.ts<br>stream-file.ts |
| **合计** | **222** | 14 个 action 文件 → 12 分组 |

## 1. 逐 action 精确规格

**列含义**

- **params** —— 取自 `params: { ... }` 字面量。格式 `` `字段名` `校验表达式` 可省略性 ``。
  校验表达式是 bundle 里的 `f$1.xxx()` 链，去掉 `f$1.` 前缀后原样保留。
  可省略性三态：**必填** / **可省略**（`.optional()`） / **可省略，默认 X**（`.default(X)`）。
  ⚠️ 字段是否必填由 `FieldImpl.doc.required` 决定，`describe()` 文本已剥离不影响判定。
- **returns** —— `returns:` 字符串原文；无该字段时回退 `returnsSchema.description`（括注来源）。
  第二行是 `returnsSchema` 归纳出的结构。
- **native** —— 是（有目标 serviceCmd） / HTTP（cookie Web API） / 混合（只经 bridge 取 key） / 否。
- **serviceCmd** —— 该 action 沿调用链**第一个声明协议**的节点上的命令；`—` 表示无。

> **预置参数说明【实测】**：`groupAction` / `groupUserAction` 会先注入 `group_id` / `user_id`
> 再转给 `defineAction`，所以它们**不在** `params: {...}` 字面量里。
> 本表按 `../onebot/src/action-kit.ts` 原文补入并标注「预置」。

### 1.1 信息（5）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `get_login_info` | defineAction | Y | **（bundle 无此字段）** | （无参数） | 当前登录账号的 QQ 号与昵称。<br>`{user_id,nickname}` | 混合 | — |
| 2 | `get_status` | defineAction | Y | **（bundle 无此字段）** | （无参数） | 运行状态。`online` 表示账号在线；`good` 表示已确认的收发链路健康状态；`time` 为当前账号服务实例运行秒数，与 #Haizakura 同源。<br>`{online,good,time}` | 混合 | — |
| 3 | `get_version_info` | defineAction | Y | **（bundle 无此字段）** | （无参数） | 实现与协议版本信息。<br>`{app_name,app_version,protocol_version}` | 否 | — |
| 4 | `can_send_image` | defineAction | Y | **（bundle 无此字段）** | （无参数） | 能力查询结果。<br>`{yes}` | 否 | — |
| 5 | `can_send_record` | defineAction | Y | **（bundle 无此字段）** | （无参数） | 能力查询结果。<br>`{yes}` | 否 | — |

### 1.2 消息（6）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | `send_custom_face` | defineAction |  | 发送账号收藏表情（emoji_id 或 MD5），保留表情显示样式 | `emoji_id` `string()` 必填<br>`group_id` `groupId().optional()` 可省略<br>`user_id` `userId().optional()` 可省略<br>`reply_to` `messageId().optional()` 可省略 | { message_id: number }<br>`{message_id}` | 是 | `Faceroam.OpReq`<br>`MessageSvc.PbSendMsg`<br>`OidbSvcTrpcTcp.0x6d6_0`<br>`OidbSvcTrpcTcp.0x6d9_4`<br>`OidbSvcTrpcTcp.0xe37_1700`<br>`OidbSvcTrpcTcp.0xe37_800`<br>`OidbSvcTrpcTcp.0x12b6_0`<br>`OidbSvcTrpcTcp.0x8b7_5`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 7 | `send_msg` | defineAction |  | 发送消息（按 message_type/群号 自动路由群聊或私聊） | `message` `message()` 必填<br>`message_type` `string().optional()` 可省略<br>`group_id` `sendMsgOptionalGroupId()` 必填<br>`user_id` `userId().optional()` 可省略<br>`auto_escape` `bool().default(false)` 可省略，默认 `false` | { message_id: number }<br>`{message_id}` | 是 | `MessageSvc.PbSendMsg`<br>`OidbSvcTrpcTcp.0x6d6_0`<br>`OidbSvcTrpcTcp.0x6d9_4`<br>`OidbSvcTrpcTcp.0xe37_1700`<br>`OidbSvcTrpcTcp.0xe37_800`<br>`OidbSvcTrpcTcp.0x12b6_0`<br>`OidbSvcTrpcTcp.0x8b7_5`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 8 | `send_private_msg` | defineAction |  | 发送私聊消息 | `user_id` `userId()` 必填<br>`message` `message()` 必填<br>`group_id` `int({ min: 0 }).optional()` 可省略<br>`auto_escape` `bool().default(false)` 可省略，默认 `false` | { message_id: number }<br>`{message_id}` | 是 | `MessageSvc.PbSendMsg`<br>`OidbSvcTrpcTcp.0xe37_1700`<br>`OidbSvcTrpcTcp.0xe37_800`<br>`OidbSvcTrpcTcp.0x12b6_0`<br>`OidbSvcTrpcTcp.0x8b7_5`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 9 | `send_group_msg` | groupAction |  | 发送群消息 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`message` `message()` 必填<br>`auto_escape` `bool().default(false)` 可省略，默认 `false` | { message_id: number }<br>`{message_id}` | 是 | `MessageSvc.PbSendMsg`<br>`OidbSvcTrpcTcp.0x6d6_0`<br>`OidbSvcTrpcTcp.0x6d9_4`<br>`OidbSvcTrpcTcp.0x12b6_0`<br>`OidbSvcTrpcTcp.0x8b7_5`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 10 | `get_msg` | defineAction | Y | 获取消息 | `message_id` `messageId()` 必填 | 消息事件对象（去除 post_type/self_id，附带 real_id）；逐个尝试刷新图片、语音和视频 URL，成功使用新地址，失败保留该段原地址并继续返回消息；地址更新时同步 raw_message。<br>`{real_id}` | 混合 | — |
| 11 | `delete_msg` | defineAction |  | 撤回消息 | `message_id` `messageId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `trpc.msg.msg_svc.MsgService.SsoC2CRecallMsg`<br>`trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg` |

### 1.3 好友（3）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12 | `get_friend_list` | defineAction | Y | 获取好友列表 | `with_profile` `bool().default(false)` 可省略，默认 `false` | 好友列表，包含账号、昵称、备注及回包已有的公开资料；with_profile=true 时主动补查，失败会报错。未返回的资料省略，零、空字符串和 false 保留。<br>`array` | 是 | `OidbSvcTrpcTcp.0xfd4_1` |
| 13 | `get_stranger_info` | defineAction | Y | 获取陌生人信息 | `user_id` `userId()` 必填 | 用户资料，含账号标识、等级别名和可用的注册时间、生日、会员信息。注册时间、生日或会员信息未返回时省略对应字段，出生年份未公开时只省略年份；登录天数暂无可靠来源，不返回占位值。<br>`{user_id,uid,qid,nickname,remark,sex,age,long_nick,qq_level,qqLevel,reg_time,birthday_year}`… | 是 | `OidbSvcTrpcTcp.0xfe1_2`<br>`trpc.basic.corp.Datacard.SsoCorpInfo` |
| 14 | `delete_friend` | defineAction |  | 删除好友 | `user_id` `userId()` 必填<br>`block` `bool().default(false)` 可省略，默认 `false` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x126b_0` |

### 1.4 群信息（7）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15 | `get_group_share_link` | groupAction | Y | 获取群分享链接 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`need_short_url` `bool().default(true)` 可省略，默认 `true`<br>`src_id` `int({ min: 0, max: 4294967295 }).default(73)` 可省略，默认 `73`<br>`additional_param` `string().default("")` 可省略，默认 `""` | 用于分享或邀请加群的链接，可作为群二维码内容。<br>`{url}` | 是 | `OidbSvcTrpcTcp.0x9060_3` |
| 16 | `get_group_list` | defineAction | Y | 获取群列表 | `no_cache` `bool().default(false)` 可省略，默认 `false` | 群信息对象数组。<br>`array<{group_id,group_name,group_remark,member_count,max_member_count,group_create_time,group_level,group_memo}>` | 是 | `OidbSvcTrpcTcp.0xfe5_2` |
| 17 | `get_group_info` | groupAction | Y | 获取群信息 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`no_cache` `bool().default(false)` 可省略，默认 `false` | 群信息对象。<br>`{group_id,group_name,group_remark,member_count,max_member_count,group_create_time,group_level,group_memo,group_description,group_all_shut}` | 是 | `OidbSvcTrpcTcp.0x88d_0`<br>`OidbSvcTrpcTcp.0xfe5_2` |
| 18 | `get_group_member_list` | groupAction | Y | 获取群成员列表 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`no_cache` `bool().default(false)` 可省略，默认 `false` | 群成员信息对象数组。<br>`array<{group_id,user_id,nickname,card,is_robot,sex,age,join_time}>` | 是 | `OidbSvcTrpcTcp.0xfe7_3` |
| 19 | `get_group_member_info` | groupUserAction | Y | 获取群成员信息 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`no_cache` `bool().default(false)` 可省略，默认 `false` | 群成员信息对象。<br>`{group_id,user_id,nickname,card,is_robot,sex,age,join_time,last_sent_time,shut_up_timestamp,level,qq_level}`… | 是 | `OidbSvcTrpcTcp.0xfe1_2`<br>`OidbSvcTrpcTcp.0xfe7_3` |
| 20 | `get_group_honor_info` | groupAction | Y | 获取群荣誉信息 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`type` `string().optional()` 可省略 | 当前实现始终为空数组（schema.description）<br>`{group_id,current_talkative,talkative_list,performer_list,legend_list,emotion_list,strong_newbie_list}` | HTTP | —（cookie Web API） |
| 21 | `get_group_system_msg` | defineAction | Y | 获取群系统消息 | `group_id` `groupId().optional()` 可省略<br>`only_pending` `bool().default(false)` 可省略，默认 `false`<br>`count` `int({ min: 1, max: 100 }).default(50)` 可省略，默认 `50` | 群系统消息数组，可按群号或未处理状态过滤。<br>`array<{group_id,group_name,request_id,requester_uin,requester_nick,invitor_uin,invitor_nick,message}>` | 是 | `OidbSvcTrpcTcp.0x10c0_0`<br>`OidbSvcTrpcTcp.0xfe1_2` |

### 1.5 群管理（24）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22 | `set_group_kick` | groupUserAction |  | 踢出群成员 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`reject_add_request` `bool().default(false)` 可省略，默认 `false` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x8a0_1` |
| 23 | `set_group_kick_members` | groupAction |  | 批量踢出群成员 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `array(memberId()).nonEmpty()` 必填<br>`reject_add_request` `bool().default(false)` 可省略，默认 `false` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x8a0_1` |
| 24 | `set_group_ban` | groupUserAction |  | 禁言群成员（duration=0 解除） | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`duration` `duration().default(1800)` 可省略，默认 `1800` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x1253_1` |
| 25 | `set_group_whole_ban` | groupAction |  | 全员禁言开关 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`enable` `bool().default(true)` 可省略，默认 `true` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x89a_0` |
| 26 | `set_group_add_option` | groupAction |  | 设置加群选项 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`add_type` `int({ min: 0 }).default(0)` 可省略，默认 `0`<br>`group_question` `string().optional()` 可省略<br>`group_answer` `string().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x89a_0` |
| 27 | `set_group_search` | groupAction |  | 设置群被搜索方式（群指纹 / 群号搜索开关） | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`no_finger_open` `int({ min: 0 }).optional()` 可省略<br>`no_code_finger_open` `int({ min: 0 }).optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x89a_0` |
| 28 | `set_group_member_invite_policy` | groupAction |  | 设置群成员邀请策略 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`policy` `enum("disabled", "require_approval", "no_approval", "no_approval_under_100")` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x89a_0` |
| 29 | `set_group_new_member_history_visibility` | groupAction |  | 设置新成员是否可查看历史消息 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`visible` `bool()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x89a_0` |
| 30 | `set_group_member_permissions` | groupAction |  | 设置群成员权限（仅群主可改） | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`allow_member_upload_album` `bool().optional()` 可省略<br>`allow_member_temporary_session` `bool().optional()` 可省略<br>`allow_member_create_group` `bool().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x89a_0` |
| 31 | `get_group_admin_settings` | groupAction | Y | 获取群管理设置的当前值 | `group_id` `groupId()` **预置**（由 groupAction 注入） | 与对应设置接口字段对齐的当前群管理设置。<br>`{add_type,group_question,group_answer,robot_member_switch,robot_member_examine,member_invite_policy,allow_member_upload_album,allow_member_temporary_session,allow_member_create_group,new_member_history_visible,no_finger_open,no_code_finger_open}` | 是 | `OidbSvcTrpcTcp.0x88d_0`<br>`OidbSvcTrpcTcp.0xef0_1` |
| 32 | `get_group_tags` | defineAction | Y | 读取某个群分类下的资料标签 | `group_class` `int({ min: 0, max: 4294967295 })` 必填 | 该分类下的资料标签列表。<br>`{tags}` | 是 | `OidbSvcTrpcTcp.0x967c_0` |
| 33 | `add_group_tag` | defineAction |  | 向某个群分类添加资料标签 | `group_class` `int({ min: 0, max: 4294967295 })` 必填<br>`name` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x967d_0` |
| 34 | `delete_group_tag` | defineAction |  | 从某个群分类移除资料标签 | `group_class` `int({ min: 0, max: 4294967295 })` 必填<br>`name` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x967e_0` |
| 35 | `set_group_admin` | groupUserAction |  | 设置/取消管理员 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`enable` `bool().default(true)` 可省略，默认 `true` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x1096_1` |
| 36 | `get_group_admin_permissions` | groupUserAction | Y | 读取指定管理员的撤回、移除成员、每日移除上限及接收验证消息状态 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填 | 服务器返回的管理员权限；未返回或未指定的开关为 null。每日上限仅在移除权限开启时返回，0 表示不限。<br>`{group_id,user_id,recall_member_message,kick_member,kick_member_per_day,receive_verify}` | 是 | `OidbSvcTrpcTcp.0x9164_2`<br>`OidbSvcTrpcTcp.0xfe7_4` |
| 37 | `set_group_admin_permissions` | groupUserAction |  | 设置指定管理员的撤回和移除成员权限 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`recall_member_message` `bool().optional()` 可省略<br>`kick_member` `bool().optional()` 可省略<br>`kick_member_per_day` `int({ min: 0, max: 200 }).optional()` 可省略 | 服务器确认请求后 data 为 null；不代表已经过客户端回读验证。可用 get_group_admin_permissions 查询。（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x9c1c_2` |
| 38 | `set_group_admin_receive_verify` | groupUserAction |  | 设置指定管理员是否接收加群验证消息 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`enable` `bool()` 必填 | 服务器响应确认目标群和管理员后 data 为 null；未确认目标时返回错误。（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x904_1` |
| 39 | `set_group_card` | groupUserAction |  | 设置群名片（空字符串清除） | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`card` `string().default("")` 可省略，默认 `""` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x8fc_3` |
| 40 | `set_group_name` | groupAction |  | 设置群名 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`group_name` `string().default("")` 可省略，默认 `""` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x89a_15` |
| 41 | `set_group_leave` | groupAction |  | 退群 | `group_id` `groupId()` **预置**（由 groupAction 注入） | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x1097_1` |
| 42 | `set_group_special_title` | groupUserAction |  | 设置群头衔 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填<br>`special_title` `string().default("")` 可省略，默认 `""` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x8fc_2` |
| 43 | `set_group_anonymous` | defineAction |  | 匿名开关（未实现，返回 ok） | （无参数） | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 否 | — |
| 44 | `set_group_anonymous_ban` | defineAction |  | 匿名禁言（未实现，返回 ok） | （无参数） | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 否 | — |
| 45 | `set_group_portrait` | groupAction |  | 设置群头像 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`file` `image()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `HttpConn.0x6ff_501` |

### 1.6 群文件（12）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 46 | `upload_group_file` | groupAction |  | 上传群文件 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`file` `file()` 必填<br>`name` `string().default("")` 可省略，默认 `""`<br>`folder` `string().default("")` 可省略，默认 `""`<br>`folder_id` `string().default("")` 可省略，默认 `""`<br>`upload_file` `bool().default(true)` 可省略，默认 `true` | { file_id: string }<br>`{file_id}` | 是 | `OidbSvcTrpcTcp.0x6d6_0` |
| 47 | `upload_private_file` | defineAction |  | 上传私聊文件 | `user_id` `userId()` 必填<br>`file` `file()` 必填<br>`name` `string().default("")` 可省略，默认 `""`<br>`upload_file` `bool().default(true)` 可省略，默认 `true` | { file_id: string }<br>`{file_id}` | 是 | `OidbSvcTrpcTcp.0xe37_1700`<br>`MessageSvc.PbSendMsg`<br>`OidbSvcTrpcTcp.0xe37_800`<br>`OidbSvcTrpcTcp.0x12b6_0`<br>`OidbSvcTrpcTcp.0x8b7_5`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 48 | `get_group_file_url` | groupAction | Y | 获取群文件下载链接 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`file_id` `fileId()` 必填<br>`busid` `raw()` 必填 | 群文件下载链接。<br>`{url}` | 是 | `OidbSvcTrpcTcp.0x6d6_2` |
| 49 | `get_group_root_files` | groupAction | Y | 获取群根目录文件列表 | `group_id` `groupId()` **预置**（由 groupAction 注入） | 群文件系统信息（文件与文件夹列表）。<br>`{files,folders}` | 是 | `OidbSvcTrpcTcp.0x6d8_1` |
| 50 | `get_group_files_by_folder` | groupAction | Y | 获取群子目录文件列表 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`folder_id` `string().default("")` 可省略，默认 `""`<br>`folder` `string().default("")` 可省略，默认 `""` | 群文件系统信息（文件与文件夹列表）。<br>`{files,folders}` | 是 | `OidbSvcTrpcTcp.0x6d8_1` |
| 51 | `delete_group_file` | groupAction |  | 删除群文件 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`file_id` `fileId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x6d6_3` |
| 52 | `move_group_file` | groupAction |  | 移动群文件 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`file_id` `fileId()` 必填<br>`parent_directory` `string({ allowEmpty: false })` 必填<br>`target_directory` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x6d6_5` |
| 53 | `rename_group_file` | groupAction |  | 重命名群文件 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`file_id` `fileId()` 必填<br>`current_parent_directory` `string().default("/")` 可省略，默认 `"/"`<br>`new_name` `string({ allowEmpty: false })` 必填 | `{ok}` | 是 | `OidbSvcTrpcTcp.0x6d6_4` |
| 54 | `create_group_file_folder` | groupAction |  | 创建群文件夹 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`name` `string({ allowEmpty: false })` 必填<br>`parent_id` `string().default("/")` 可省略，默认 `"/"` | { result: { retCode, retMsg }, groupItem: { folderInfo: { folderId, folderName, folderPath, createTime, modifyTime, createUin, modifyUin } } }<br>`{result,groupItem}` | 是 | `OidbSvcTrpcTcp.0x6d7_0` |
| 55 | `delete_group_file_folder` | groupAction |  | 删除群文件夹 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`folder_id` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x6d7_1` |
| 56 | `rename_group_file_folder` | groupAction |  | 重命名群文件夹 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`folder_id` `string({ allowEmpty: false })` 必填<br>`new_folder_name` `string().default("")` 可省略，默认 `""`<br>`name` `string().default("")` 可省略，默认 `""` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x6d7_2` |
| 57 | `get_private_file_url` | defineAction | Y | 获取私聊文件下载链接 | `user_id` `userId().optional()` 可省略<br>`file_id` `fileId()` 必填<br>`file_hash` `string().default("")` 可省略，默认 `""` | 私聊文件下载链接。<br>`{url}` | 是 | `OidbSvcTrpcTcp.0xe37_1200` |

### 1.7 请求（2）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 58 | `set_friend_add_request` | defineAction |  | 处理好友添加请求 | `flag` `string({ allowEmpty: false })` 必填<br>`approve` `bool().default(true)` 可省略，默认 `true` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xb5d_44` |
| 59 | `set_group_add_request` | defineAction |  | 处理加群请求 | `flag` `string({ allowEmpty: false })` 必填<br>`sub_type` `string().optional()` 可省略<br>`type` `string().optional()` 可省略<br>`approve` `bool().default(true)` 可省略，默认 `true`<br>`reason` `string().default("")` 可省略，默认 `""` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x10c0_0`<br>`OidbSvcTrpcTcp.0x10c8_0` |

### 1.8 扩展（115）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 60 | `send_like` | defineAction |  | 点赞 | `user_id` `userId()` 必填<br>`times` `int({ min: 0 }).default(1)` 可省略，默认 `1` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x7e5_104` |
| 61 | `friend_poke` | defineAction |  | 好友拍一拍 | `user_id` `userId()` 必填<br>`target_id` `userId().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xed3_1` |
| 62 | `group_poke` | groupUserAction |  | 群拍一拍 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`user_id` `memberId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xed3_1` |
| 63 | `send_poke` | defineAction |  | 拍一拍（群聊/私聊自动路由） | `user_id` `userId()` 必填<br>`group_id` `groupId().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xed3_1` |
| 64 | `set_essence_msg` | defineAction |  | 设置精华消息 | `message_id` `messageId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xeac_0` |
| 65 | `delete_essence_msg` | defineAction |  | 移除精华消息 | `message_id` `messageId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xeac_0` |
| 66 | `get_essence_msg_list` | groupAction | Y | 获取精华消息列表 | `group_id` `groupId()` **预置**（由 groupAction 注入） | `array<{msg_seq,msg_random,sender_id,sender_nick,sender_time,operator_id,operator_nick,operator_time}>` | HTTP | —（cookie Web API） |
| 67 | `set_group_reaction` | defineAction |  | 群聊表情回应 | `group_id` `groupId().optional()` 可省略<br>`message_id` `messageId()` 必填<br>`code` `string({ allowEmpty: false })` 必填<br>`is_set` `bool().default(true)` 可省略，默认 `true` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x9082_0` |
| 68 | `delete_custom_face` | defineAction |  | 删除收藏表情 | `emoji_id` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `Faceroam.OpReq` |
| 69 | `add_custom_face` | defineAction |  | 添加收藏表情 | `file` `image()` 必填 | `{emoji_id}` | 是 | `ImgStore.BDHExpressionRoam` |
| 70 | `modify_custom_face` | defineAction |  | 修改收藏表情备注 | `emoji_id` `string({ allowEmpty: false })` 必填<br>`desc` `string().default("")` 可省略，默认 `""` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x902e_1` |
| 71 | `move_custom_face_to_front` | defineAction |  | 收藏表情移到最前 | `emoji_id` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x902e_1`<br>`OidbSvcTrpcTcp.0x902f_1` |
| 72 | `get_group_msg_history` | groupAction | Y | 获取群消息历史 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`message_id` `int().default(0).role("message_id")` 可省略，默认 `0`<br>`count` `int({ min: 0 }).default(20)` 可省略，默认 `20`<br>`reverse_order` `bool().default(true)` 可省略，默认 `true` | { messages }：群消息事件对象数组（每项为 OneBot 消息事件，内部字段不固定）。<br>`{messages}` | 是 | `trpc.msg.register_proxy.RegisterProxy.SsoGetGroupMsg` |
| 73 | `get_friend_msg_history` | defineAction | Y | 获取好友消息历史（无锚点时从服务器获取最新双向记录） | `user_id` `userId()` 必填<br>`message_id` `int().default(0).role("message_id")` 可省略，默认 `0`<br>`count` `int({ min: 0 }).default(20)` 可省略，默认 `20`<br>`reverse_order` `bool().default(true)` 可省略，默认 `true` | { messages }：好友消息事件对象数组（每项为 OneBot 消息事件，内部字段不固定）。<br>`{messages}` | 是 | `trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg`<br>`trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg` |
| 74 | `mark_group_msg_as_read` | defineAction |  | 标记群消息已读 | `message_id` `messageId()` 必填<br>`group_id` `groupId().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `trpc.msg.msg_svc.MsgService.SsoReadedReport` |
| 75 | `mark_private_msg_as_read` | defineAction |  | 标记私聊消息已读 | `message_id` `messageId()` 必填<br>`user_id` `userId().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `trpc.msg.msg_svc.MsgService.SsoReadedReport` |
| 76 | `mark_msg_as_read` | defineAction |  | 标记消息已读（群聊/私聊自动路由） | `message_id` `messageId()` 必填<br>`target_id` `uint().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `trpc.msg.msg_svc.MsgService.SsoReadedReport` |
| 77 | `_send_group_notice` | groupAction |  | 发送群公告（支持置顶、弹窗、新成员、群昵称引导与确认） | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`content` `string({ allowEmpty: false })` 必填<br>`image` `string().default("").role("image")` 可省略，默认 `""`<br>`pinned` `int({ min: 0, max: 1 }).default(0)` 可省略，默认 `0`<br>`type` `int().optional()` 可省略<br>`send_to_new_members` `bool().optional()` 可省略<br>`is_show_edit_card` `int({ min: 0, max: 1 }).default(1)` 可省略，默认 `1`<br>`tip_window_type` `int({ min: 0, max: 1 }).default(1)` 可省略，默认 `1`<br>`confirm_required` `int({ min: 0, max: 1 }).default(1)` 可省略，默认 `1` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 78 | `_get_group_notice` | groupAction | Y | 获取群公告 | `group_id` `groupId()` **预置**（由 groupAction 注入） | 普通公告与新成员公告的合并数组；send_to_new_members 标识后者；图片含 id、url、宽高<br>`array<{notice_id,sender_id,publish_time,message,settings,read_num,type,pinned}>` | HTTP | —（cookie Web API） |
| 79 | `upload_forward_msg` | defineAction |  | 上传转发消息 | `messages` `forwardMessagesField` 必填<br>`message` `forwardMessagesField` 必填<br>`group_id` `groupId().optional()` 可省略 | 仅上传资源，不代表已发送消息；0 不能用于消息查询或撤回（schema.description）<br>`{res_id,forward_id,message_id,group_id}` | 是 | `trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 80 | `upload_foward_msg` | defineAction |  | 上传转发消息（别名拼写） | `messages` `forwardMessagesField` 必填<br>`message` `forwardMessagesField` 必填<br>`group_id` `groupId().optional()` 可省略 | 仅上传资源，不代表已发送消息；0 不能用于消息查询或撤回（schema.description）<br>`{res_id,forward_id,message_id}` | 是 | `trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 81 | `get_image` | defineAction | Y | 获取图片信息 | `file` `string().default("").role("image")` 可省略，默认 `""`<br>`file_id` `string().default("").role("file_id")` 可省略，默认 `""` | 媒体地址；图片无地址时可为原文件标识（schema.description）<br>`{file,url,file_size,file_name}` | 否 | — |
| 82 | `get_record` | defineAction | Y | 获取语音信息；传 out_format 则服务端转码并附带 base64 | `file` `string().default("").role("record")` 可省略，默认 `""`<br>`file_id` `string().default("").role("file_id")` 可省略，默认 `""`<br>`out_format` `enum("mp3", "amr", "wma", "m4a", "spx", "ogg", "wav", "flac").optional()` 可省略 | 语音信息（file/url 为向 QQ 获取的当前下载地址）；资源元数据缺失或远端获取失败时返回错误。out_format 指定时附带转码后的 base64。<br>`{out_format,base64}` | 混合 | — |
| 83 | `fetch_ptt_text`<br>↳ `get_ptt_text`、`get_record_text` | defineAction | Y | 获取语音转文字结果 | `message_id` `messageId()` 必填 | { text }：语音识别出的文本。<br>`{text}` | 是 | `pttTrans.TransC2CPttReq`<br>`pttTrans.TransGroupPttReq` |
| 84 | `get_cookies` | defineAction | Y | 获取 Cookies | `domain` `string().default("qun.qq.com")` 可省略，默认 `"qun.qq.com"` | { cookies }：指定域名的 Cookie 字符串。<br>`{cookies}` | HTTP | —（cookie Web API） |
| 85 | `get_csrf_token` | defineAction | Y | 获取 CSRF 令牌 | （无参数） | { token }：CSRF 令牌（bkn，数值）。<br>`{token}` | HTTP | —（cookie Web API） |
| 86 | `get_credentials` | defineAction | Y | 获取凭证 | `domain` `string().default("qun.qq.com")` 可省略，默认 `"qun.qq.com"` | { cookies, token, csrf_token }：Cookie 字符串与 CSRF 令牌（token 与 csrf_token 同值）。<br>`{cookies,token,csrf_token}` | HTTP | —（cookie Web API） |
| 87 | `set_restart` | defineAction |  | 重启（不支持） | （无参数） | 当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording（schema.description）<br>`—` | 否 | — |
| 88 | `clean_cache` | defineAction |  | 清理缓存 | （无参数） | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 否 | — |
| 89 | `set_friend_remark` | defineAction |  | 设置好友备注 | `user_id` `userId()` 必填<br>`remark` `string()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x912e_0`<br>`OidbSvcTrpcTcp.0x912f_0` |
| 90 | `set_group_remark` | defineAction |  | 设置群备注 | `group_id` `groupId()` 必填<br>`remark` `string()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xf16_1` |
| 91 | `set_msg_emoji_like` | defineAction |  | 设置消息表情回应 | `message_id` `messageId()` 必填<br>`emoji_id` `string({ allowEmpty: false })` 必填<br>`set` `bool().default(true)` 可省略，默认 `true` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x9082_0` |
| 92 | `_mark_all_as_read` | defineAction |  | 标记全部已读 | （无参数） | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `trpc.msg.msg_svc.MsgService.SsoReadedReport` |
| 93 | `get_group_file_system_info` | groupAction | Y | 获取群文件系统信息 | `group_id` `groupId()` **预置**（由 groupAction 注入） | { file_count, limit_count, used_space, total_space }：群文件数量与容量信息（均为服务端实际值）。<br>`{file_count,limit_count,used_space,total_space}` | 是 | `OidbSvcTrpcTcp.0x6d8_2`<br>`OidbSvcTrpcTcp.0x6d8_3` |
| 94 | `check_url_safely` | defineAction | Y | 检查链接安全性 | （无参数） | { level }：安全等级（占位实现，恒为 1）。<br>`{level}` | 否 | — |
| 95 | `set_qq_profile` | defineAction |  | 设置 QQ 资料 | `nickname` `string().optional()` 可省略<br>`personal_note` `string().optional()` 可省略<br>`sex` `int({ min: 0, max: 2 }).optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x112a_2` |
| 96 | `set_online_status` | defineAction |  | 设置在线状态 | `status` `int({ nonZero: true })` 必填<br>`ext_status` `int({ min: 0 }).default(0)` 可省略，默认 `0`<br>`battery_status` `int({ min: 0 }).default(100)` 可省略，默认 `100` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `trpc.qq_new_tech.status_svc.StatusService.SetStatus` |
| 97 | `set_diy_online_status` | defineAction |  | 设置自定义在线状态 | `face_id` `faceId()` 必填<br>`face_type` `int({ min: 0 }).default(1)` 可省略，默认 `1`<br>`wording` `string().default("")` 可省略，默认 `""` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `trpc.qq_new_tech.status_svc.StatusService.SetStatus` |
| 98 | `get_group_ignored_notifies` | defineAction | Y | 获取被过滤的入群请求 | （无参数） | 被过滤的入群请求数组，每项含群号、申请人、邀请人、留言与处理标记。<br>`array<{group_id,group_name,request_id,requester_uin,requester_nick,message,checked,actor}>` | 是 | `OidbSvcTrpcTcp.0x10c0_0` |
| 99 | `get_group_ignore_add_request` | defineAction | Y | 获取被忽略的入群请求（NapCat） | （无参数） | 被忽略的入群请求数组（NapCat 字段命名），每项含请求序列、邀请人、群信息与处理标记。<br>`array<{request_id,invitor_uin,invitor_nick,group_id,message,group_name,checked,actor}>` | 是 | `OidbSvcTrpcTcp.0x10c0_0` |
| 100 | `get_group_shut_list` | groupAction | Y | 获取群禁言列表 | `group_id` `groupId()` **预置**（由 groupAction 注入） | 仍在禁言中的成员数组，每项含 QQ 号、昵称与禁言到期时间戳（秒）。<br>`array<{user_id,nickname,shut_up_time}>` | 是 | `OidbSvcTrpcTcp.0xfe7_3` |
| 101 | `get_group_signed_list` | groupAction | Y | 获取群今日打卡列表 | `group_id` `groupId()` **预置**（由 groupAction 注入） | `array<{user_id,nick,time,rank}>` | HTTP | —（cookie Web API） |
| 102 | `forward_friend_single_msg` | defineAction |  | 转发单条消息给好友 | `message_id` `messageId()` 必填<br>`user_id` `userId()` 必填 | `{message_id}` | 是 | `MessageSvc.PbSendMsg`<br>`trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 103 | `forward_group_single_msg` | defineAction |  | 转发单条消息到群 | `message_id` `messageId()` 必填<br>`group_id` `groupId()` 必填 | `{message_id}` | 是 | `MessageSvc.PbSendMsg`<br>`trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 104 | `get_profile_like` | defineAction | Y | 获取资料点赞 | `user_id` `int({ min: 0 }).default(0).role("user_id")` 可省略，默认 `0`<br>`start` `int({ min: 0 }).default(0)` 可省略，默认 `0`<br>`count` `int({ min: 0 }).default(10)` 可省略，默认 `10` | 点赞资料：uid、最近点赞时间、收藏与点赞统计及用户明细。<br>`{uid,time,favoriteInfo,voteInfo}` | 是 | `OidbSvcTrpcTcp.0x7ed_0` |
| 105 | `fetch_custom_face` | defineAction | Y | 获取自定义表情 | `count` `int({ min: 0 }).default(10)` 可省略，默认 `10`<br>`return_type` `string().default("url")` 可省略，默认 `"url"` | 字符串数组：return_type=url 时为图片 URL，return_type=id 时为 emoji_id。<br>`array` | 是 | `Faceroam.OpReq` |
| 106 | `fetch_custom_face_detail` | defineAction | Y | 获取自定义表情详情 | `count` `int({ min: 0 }).default(48)` 可省略，默认 `48` | 自定义表情详情数组，包含资源标识、图片地址、摘要与描述。<br>`array<{emoji_id,resId,url,md5,desc}>` | 是 | `OidbSvcTrpcTcp.0x902e_1` |
| 107 | `get_emoji_likes` | defineAction | Y | 获取表情回应用户 | `message_id` `messageId()` 必填<br>`emoji_id` `string({ allowEmpty: false })` 必填 | { emoji_like_list }：回应该表情的用户列表（nick_name 恒为空串）。<br>`{emoji_like_list}` | 是 | `OidbSvcTrpcTcp.0x9083_1` |
| 108 | `fetch_emoji_like` | defineAction | Y | 获取表情回应用户（NapCat 分页） | `message_id` `messageId()` 必填<br>`emojiId` `string({ allowEmpty: false })` 必填<br>`count` `int({ min: 0 }).default(10)` 可省略，默认 `10`<br>`cookie` `string().default("")` 可省略，默认 `""` | 分页的表情回应用户列表（NapCat 形状），含分页游标 cookie 与首/末页标记。<br>`{result,errMsg,emojiLikesList,cookie,isLastPage,isFirstPage}` | 是 | `OidbSvcTrpcTcp.0x9083_1` |
| 109 | `get_msg_emoji_likes` | defineAction | Y | 获取一条消息的全部表情回应 | `message_id` `messageId()` 必填 | 该消息上每个表情回应的编号、数量与用户列表。<br>`array<{emoji_id,emoji_type,count,last_reaction_time,users}>` | 是 | `OidbSvcTrpcTcp.0x9083_1` |
| 110 | `get_friends_with_category` | defineAction | Y | 获取分组好友列表 | `with_profile` `bool().default(false)` 可省略，默认 `false` | 好友分组数组；buddyList 与 get_friend_list 使用相同资料字段。默认只使用列表回包，with_profile=true 主动补查，失败会报错；未返回的资料省略。<br>`array<{categoryId,categoryName,categoryMbCount,buddyList}>` | 是 | `OidbSvcTrpcTcp.0xfd4_1` |
| 111 | `set_friends_category` | defineAction |  | 移动好友到指定分组 | `uin` `userId()` 必填<br>`categoryId` `int({ min: 0 }).optional()` 可省略<br>`categoryName` `string({ allowEmpty: false }).optional()` 可省略 | 成功时返回空数据。<br>`null` | 是 | `OidbSvcTrpcTcp.0x1255_0` |
| 112 | `get_recent_contact` | defineAction | Y | 获取最近会话（占位） | `count` `int({ min: 0 }).default(10)` 可省略，默认 `10` | 占位实现，恒返回空数组。<br>`array` | 否 | — |
| 113 | `get_online_clients` | defineAction | Y | 获取在线客户端 | `no_cache` `bool().default(false)` 可省略，默认 `false` | { clients }：QQ 本次会话最近推送的在线设备快照。<br>`{clients}` | 混合 | — |
| 114 | `_get_model_show` | defineAction | Y | 获取机型展示（兼容 mock） | `model` `string().default("")` 可省略，默认 `""` | 数组，每项含 variants（回显请求的机型名与 need_pay 标记）。<br>`array<{variants}>` | 否 | — |
| 115 | `_set_model_show` | defineAction |  | 设置机型展示（占位） | （无参数） | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 否 | — |
| 116 | `get_group_at_all_remain` | groupAction | Y | 获取群 @全体成员 剩余次数 | `group_id` `groupId()` **预置**（由 groupAction 注入） | { can_at_all, remain_at_all_count_for_group, remain_at_all_count_for_uin }：@全体可用性与剩余次数。<br>`{can_at_all,remain_at_all_count_for_group,remain_at_all_count_for_uin}` | 是 | `OidbSvcTrpcTcp.0x8a7_0` |
| 117 | `get_unidirectional_friend_list` | defineAction | Y | 获取单向好友列表 | （无参数） | 服务端列表项原样透传，目前未归一化字段，不能假定与 get_friend_list 相同（schema.description）<br>`array` | 是 | `MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0` |
| 118 | `get_clientkey` | defineAction | Y | 获取 clientkey | （无参数） | { clientKey, expireTime, keyIndex }：clientkey 及其过期时间与索引。<br>`{clientKey,expireTime,keyIndex}` | 混合 | — |
| 119 | `share_peer` | defineAction | Y | 分享用户/群 Ark 卡片 | `user_id` `userId().optional()` 可省略<br>`group_id` `groupId().optional()` 可省略<br>`phone_number` `string().default("")` 可省略，默认 `""` | { arkMsg }：服务端生成的推荐联系人 Ark 卡片 JSON 字符串。<br>`{arkMsg}` | 是 | `OidbSvcTrpcTcp.0x12b6_0`<br>`OidbSvcTrpcTcp.0x8b7_5` |
| 120 | `send_ark_share` | defineAction | Y | 分享用户/群 Ark 卡片（NapCat 标准名） | `user_id` `userId().optional()` 可省略<br>`group_id` `groupId().optional()` 可省略<br>`phone_number` `string().default("")` 可省略，默认 `""` | { arkMsg }：服务端生成的推荐联系人 Ark 卡片 JSON 字符串。<br>`{arkMsg}` | 是 | `OidbSvcTrpcTcp.0x12b6_0`<br>`OidbSvcTrpcTcp.0x8b7_5` |
| 121 | `send_tuwen_ark` | defineAction |  | 发送图文 Ark 卡片（私聊/群聊） | `user_id` `userId().optional()` 可省略<br>`group_id` `groupId().optional()` 可省略<br>`title` `string()` 必填<br>`desc` `string()` 必填<br>`summary` `string().default("[分享]")` 可省略，默认 `"[分享]"`<br>`preview_url` `string().default("https://tangram-1251316161.file.myqcloud.com/files/20210721/e50a8e37e08f29bf1ffc7466e1950690.png")` 可省略，默认 `"https://tangram-1251316161.file.myqcloud.com/files/20210721/e50a8e37e08f29bf1ffc7466e1950690.png"`<br>`jump_url` `string()` 必填 | null<br>`null` | 是 | `OidbSvcTrpcTcp.0xdc2_34` |
| 122 | `share_group_ex` | defineAction | Y | 分享群 Ark 卡片 | `group_id` `groupId()` 必填 | 服务端生成的群推荐 Ark 卡片 JSON 字符串。<br>`string` | 是 | `OidbSvcTrpcTcp.0x8b7_5` |
| 123 | `send_group_ark_share` | defineAction | Y | 分享群 Ark 卡片（NapCat 标准名） | `group_id` `groupId()` 必填 | 服务端生成的群推荐 Ark 卡片 JSON 字符串。<br>`string` | 是 | `OidbSvcTrpcTcp.0x8b7_5` |
| 124 | `get_doubt_friends_add_request` | defineAction | Y | 获取可疑好友申请 | `count` `int({ min: 0 }).default(50)` 可省略，默认 `50` | 可疑好友申请数组，每项含 uid（作为处理用 flag）、昵称、来源、留言与申请时间。<br>`array<{uid,user_id,nick,source,reason,msg,group_code,reqTime}>` | 是 | `OidbSvcTrpcTcp.0xd69_0` |
| 125 | `set_doubt_friends_add_request` | defineAction |  | 处理可疑好友申请 | `flag` `string({ allowEmpty: false })` 必填<br>`approve` `bool().default(true)` 可省略，默认 `true` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xd69_0`<br>`OidbSvcTrpcTcp.0xd72_0` |
| 126 | `set_group_robot_add_option` | groupAction |  | 设置群机器人加群选项 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`robot_member_switch` `int({ min: 0 }).optional()` 可省略<br>`robot_member_examine` `int({ min: 0 }).optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xf00_3` |
| 127 | `get_collection_list` | defineAction | Y | 获取收藏列表 | `category` `int({ min: 0 }).default(0)` 可省略，默认 `0`<br>`count` `int({ min: 1, max: 500 }).default(50)` 可省略，默认 `50` | 返回收藏条目、是否还有更多数据及底部时间游标。<br>`{errCode,errMsg,collectionSearchList}` | 混合 | — |
| 128 | `create_collection` | defineAction |  | 创建收藏（未实现） | （无参数） | 当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording（schema.description）<br>`—` | 否 | — |
| 129 | `.get_word_slices` | defineAction | Y | 分词（未实现） | （无参数） | 当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording（schema.description）<br>`—` | 否 | — |
| 130 | `set_qq_avatar` | defineAction |  | 设置 QQ 头像 | `file` `image()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `HttpConn.0x6ff_501` |
| 131 | `set_input_status` | defineAction |  | 设置输入状态 | `user_id` `userId()` 必填<br>`event_type` `int().default(0)` 可省略，默认 `0` | 成功时为空对象 {}，不是 null（schema.description）<br>`object` | 是 | `OidbSvcTrpcTcp.0xcd4_1` |
| 132 | `get_group_info_ex` | defineAction | Y | 获取群信息（扩展） | `group_id` `groupId()` 必填<br>`no_cache` `bool().default(false)` 可省略，默认 `false` | 群号（schema.description）<br>`{group_id,group_name,group_remark,member_count,max_member_count,group_create_time,group_level,group_memo,group_description,group_all_shut}` | 是 | `OidbSvcTrpcTcp.0x88d_0`<br>`OidbSvcTrpcTcp.0xfe5_2` |
| 133 | `get_group_detail_info` | defineAction | Y | 获取群详细信息 | `group_id` `groupId()` 必填<br>`no_cache` `bool().default(false)` 可省略，默认 `false` | 群号（schema.description）<br>`{group_id,group_name,group_remark,member_count,max_member_count,group_create_time,group_level,group_memo,group_description,group_all_shut}` | 是 | `OidbSvcTrpcTcp.0x88d_0`<br>`OidbSvcTrpcTcp.0xfe5_2` |
| 134 | `trans_group_file` | defineAction |  | 转存群文件 | `group_id` `groupId()` 必填<br>`file_id` `fileId()` 必填 | { ok: true }<br>`{ok}` | 是 | `OidbSvcTrpcTcp.0x6d9_0` |
| 135 | `get_file` | defineAction | Y | 获取文件信息（仅图片/语音缓存；群文件请用 get_group_file_url） | `file_id` `string().default("").role("file_id")` 可省略，默认 `""`<br>`file` `string().default("").role("file")` 可省略，默认 `""` | 媒体地址；图片无地址时可为原文件标识（schema.description）<br>`{file,url,file_size,file_name}` | 混合 | — |
| 136 | `bot_exit` | defineAction |  | 退出机器人 | （无参数） | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 否 | — |
| 137 | `nc_get_packet_status` | defineAction | Y | 获取 packet 状态（占位） | （无参数） | 占位实现，恒返回 null。<br>`null` | 否 | — |
| 138 | `delete_group_folder` | groupAction |  | 删除群文件夹 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`folder_id` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x6d7_1` |
| 139 | `nc_get_user_status` | defineAction | Y | 获取用户在线/扩展状态 | `user_id` `userId()` 必填 | { status, ext_status }：用户在线状态码与扩展状态码。<br>`{status,ext_status}` | 是 | `OidbSvcTrpcTcp.0xfe1_2` |
| 140 | `get_ai_characters` | groupAction | Y | 获取 AI 语音角色 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`chat_type` `int({ min: 0 }).default(1)` 可省略，默认 `1` | 按分类分组的 AI 语音角色列表，每组含分类名与角色（id、名称、试听 URL）。<br>`array<{type,characters}>` | 是 | `OidbSvcTrpcTcp.0x929d_0` |
| 141 | `get_ai_record` | groupAction |  | 生成 AI 语音 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`character` `string({ allowEmpty: false })` 必填<br>`text` `string({ allowEmpty: false })` 必填<br>`chat_type` `int({ min: 0 }).default(1)` 可省略，默认 `1` | 生成的下载或分享 URL 字符串，不是含 url 字段的对象（schema.description）<br>`string` | 是 | `OidbSvcTrpcTcp.0x126e_200`<br>`OidbSvcTrpcTcp.0x929b_0` |
| 142 | `send_group_ai_record` | groupAction |  | 发送 AI 语音到群 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`character` `string({ allowEmpty: false })` 必填<br>`text` `string({ allowEmpty: false })` 必填<br>`chat_type` `int({ min: 0 }).default(1)` 可省略，默认 `1` | { message_id }：已发送 AI 语音的 OneBot 消息 ID。<br>`{message_id}` | 是 | `OidbSvcTrpcTcp.0x929b_0` |
| 143 | `request_decrypt_key` | defineAction |  | 请求数据库解密密钥 | `db_path` `string({ allowEmpty: false })` 必填 | 数据库密钥，敏感信息（schema.description）<br>`{db_key}` | 是 | `OidbSvcTrpcTcp.0xcde_2` |
| 144 | `get_rkey`<br>↳ `nc_get_rkey` | defineAction | Y | 获取下载 rkey | （无参数） | 下载密钥，敏感信息（schema.description）<br>`array<{rkey,type,ttl,create_time}>` | 是 | `OidbSvcTrpcTcp.0x9067_202` |
| 145 | `get_rkey_server` | defineAction | Y | 获取 rkey 服务器信息 | （无参数） | { expired_time, name, private_rkey?, group_rkey? }：rkey 过期时间与（存在时的）私聊/群聊 rkey。<br>`{expired_time,name,private_rkey,group_rkey}` | 是 | `OidbSvcTrpcTcp.0x9067_202` |
| 146 | `ocr_image`<br>↳ `.ocr_image` | defineAction | Y | OCR 图片（服务端，需图片 URL 或已缓存的图片 file_id） | `image` `image()` 必填 | { texts, language }：识别文本数组（含置信度与坐标）与识别语言。<br>`{texts,language}` | 是 | `OidbSvcTrpcTcp.0xe07_0` |
| 147 | `_del_group_notice` | groupAction |  | 删除群公告（fid 或 notice_id 二选一） | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`fid` `string().optional()` 可省略<br>`notice_id` `string().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 148 | `send_forward_msg` | defineAction |  | 发送合并转发（按 message_type/群号自动路由） | `messages` `forwardMessagesField` 必填<br>`message` `forwardMessagesField` 必填<br>`message_type` `string().optional()` 可省略<br>`group_id` `int({ min: 0 }).optional()` 可省略<br>`user_id` `int({ min: 0 }).optional()` 可省略 | { message_id, res_id, forward_id }<br>`{message_id,res_id,forward_id}` | 是 | `MessageSvc.PbSendMsg`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 149 | `send_group_forward_msg` | groupAction |  | 发送群合并转发 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`messages` `forwardMessagesField` 必填<br>`message` `forwardMessagesField` 必填 | { message_id, res_id, forward_id }<br>`{message_id,res_id,forward_id}` | 是 | `MessageSvc.PbSendMsg`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 150 | `send_private_forward_msg` | defineAction |  | 发送私聊合并转发 | `user_id` `userId()` 必填<br>`messages` `forwardMessagesField` 必填<br>`message` `forwardMessagesField` 必填 | { message_id, res_id, forward_id }<br>`{message_id,res_id,forward_id}` | 是 | `MessageSvc.PbSendMsg`<br>`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` |
| 151 | `get_forward_msg` | defineAction | Y | 获取合并转发消息（id 或 message_id） | `id` `string().optional()` 可省略<br>`message_id` `string().optional()` 可省略 | { messages }：转发内的消息节点数组（每项为 OneBot 消息事件）；reply 保留 id，有内嵌引用内容时附带 message 和可用的 qq/time/seq，可作为转发节点 content 再次发送。<br>`{messages}` | 是 | `trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg` |
| 152 | `download_file` | defineAction |  | 下载文件（url 或 base64）到 data/downloads | `url` `string().default("")` 可省略，默认 `""`<br>`base64` `string().default("")` 可省略，默认 `""`<br>`name` `string().default("")` 可省略，默认 `""`<br>`headers` `raw()` 必填 | { file }<br>`{file}` | 否 | — |
| 153 | `translate_en2zh` | defineAction | Y | 英译中 | `words` `array(string())` 必填 | { words }：与输入等长的中文译文字符串数组。<br>`{words}` | 是 | `OidbSvcTrpcTcp.0x990_2` |
| 154 | `set_self_longnick` | defineAction |  | 设置个性签名（longNick/long_nick，严格 string） | `longNick` `optionalExactString()` 必填<br>`long_nick` `optionalExactString()` 必填 | 成功时为空对象 {}，不是 null（schema.description）<br>`object` | 是 | `OidbSvcTrpcTcp.0x112a_2` |
| 155 | `get_mini_app_ark` | defineAction | Y | 获取小程序卡片 ark | `type` `string().optional()` 可省略<br>`title` `string().optional()` 可省略<br>`desc` `string().optional()` 可省略<br>`picUrl` `string().optional()` 可省略<br>`pic_url` `string().optional()` 可省略<br>`jumpUrl` `string().optional()` 可省略<br>`jump_url` `string().optional()` 可省略 | 服务端卡片版本，原样透传（schema.description）<br>`{data}` | 是 | `LightAppSvc.mini_app_share.AdaptShareInfo` |
| 156 | `click_inline_keyboard_button` | groupAction |  | 点击内联键盘按钮 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`bot_appid` `uint()` 必填<br>`msg_seq` `uint()` 必填<br>`button_id` `string({ allowEmpty: false })` 必填<br>`callback_data` `string().default("")` 可省略，默认 `""` | 按钮业务结果码，需单独检查（schema.description）<br>`{result,errMsg,status,promptText,promptType,promptIcon}` | 是 | `OidbSvcTrpcTcp.0x112e_1` |
| 157 | `set_group_sign`<br>↳ `send_group_sign` | groupAction |  | 群签到 | `group_id` `groupId()` **预置**（由 groupAction 注入） | 成功时为空对象 {}，不是 null（schema.description）<br>`object` | 是 | `OidbSvcTrpcTcp.0xEB7_1` |
| 158 | `send_packet`<br>↳ `.send_packet` | defineAction |  | 发送原始 SSO 包（cmd + hex data） | `cmd` `string({ allowEmpty: false })` 必填<br>`data` `string().default("")` 可省略，默认 `""`<br>`rsp` `bool().default(true)` 可省略，默认 `true` | rsp=true 时返回的十六进制响应正文（schema.description）<br>`string` | 是 | **动态 `p.cmd`** |
| 159 | `get_group_todo_list` | groupAction | Y | 获取群待办列表 | `group_id` `groupId()` **预置**（由 groupAction 注入） | 群待办数组，包含可用于待办操作的消息标识、服务端摘要与时间<br>`array<{message_id,message_seq,message_random,message,text,create_time,update_time}>` | 是 | `OidbSvcTrpcTcp.0x9474_0` |
| 160 | `set_group_todo` | groupAction |  | 设置群待办 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`message_id` `messageId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xf90_0` |
| 161 | `complete_group_todo` | groupAction |  | 完成群待办 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`message_id` `messageId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xf90_0` |
| 162 | `cancel_group_todo` | groupAction |  | 取消群待办 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`message_id` `messageId()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0xf90_0` |
| 163 | `create_flash_task` | defineAction |  | 创建闪传任务 | `files` `raw()` 必填<br>`name` `string().optional()` 可省略<br>`thumb_path` `string().optional()` 可省略 | 与 fileset_id 相同的兼容字段（schema.description）<br>`{fileset_id,task_id}` | 是 | `OidbSvcTrpcTcp.0x93cf_1`<br>`OidbSvcTrpcTcp.0x93d0_1`<br>`OidbSvcTrpcTcp.0x93d1_1`<br>`OidbSvcTrpcTcp.0x93db_1` |
| 164 | `get_fileset_info` | defineAction |  | 获取文件集信息 | `fileset_id` `string({ allowEmpty: false })` 必填 | `{fileset_id,file_list}` | 是 | `OidbSvcTrpcTcp.0x93d3_1` |
| 165 | `get_flash_file_list` | defineAction |  | 获取闪传文件列表 | `fileset_id` `string({ allowEmpty: false })` 必填 | `array` | 是 | `OidbSvcTrpcTcp.0x93d3_1` |
| 166 | `list_filesets` | defineAction |  | 列出当前账号的所有闪传文件集 | （无参数） | `array` | 是 | `OidbSvcTrpcTcp.0x93d2_1` |
| 167 | `get_flash_file_url` | defineAction |  | 获取闪传文件链接 | `fileset_id` `string({ allowEmpty: false })` 必填<br>`file_name` `string().optional()` 可省略<br>`file_index` `number().optional()` 可省略 | `{url}` | 是 | `OidbSvcTrpcTcp.0x12a9_200`<br>`OidbSvcTrpcTcp.0x93d4_1` |
| 168 | `get_share_link` | defineAction |  | 获取文件分享链接 | `fileset_id` `string({ allowEmpty: false })` 必填 | 生成的下载或分享 URL 字符串，不是含 url 字段的对象（schema.description）<br>`string` | 是 | `OidbSvcTrpcTcp.0x93d3_1` |
| 169 | `delete_flash_file` | defineAction |  | 删除闪传文件 | `fileset_id` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x9407_1` |
| 170 | `rename_flash_file` | defineAction |  | 重命名闪传文件 | `fileset_id` `string({ allowEmpty: false })` 必填<br>`new_name` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | 是 | `OidbSvcTrpcTcp.0x9427_0` |
| 171 | `download_fileset` | defineAction |  | 解析闪传文件下载直链（不下载，由调用方实现下载） | `fileset_id` `string({ allowEmpty: false })` 必填<br>`file_name` `string().optional()` 可省略<br>`file_index` `number().optional()` 可省略 | { url, file_name, file_size }<br>`{url,file_name,file_size}` | 是 | `OidbSvcTrpcTcp.0x12a9_200`<br>`OidbSvcTrpcTcp.0x93d4_1` |
| 172 | `send_flash_msg` | defineAction |  | 发送闪传消息（私聊或群聊，引用 fileset_id 让对端下载） | `fileset_id` `string({ allowEmpty: false })` 必填<br>`user_id` `userId().optional()` 可省略<br>`group_id` `groupId().optional()` 可省略 | { message_id }<br>`{message_id}` | 是 | `OidbSvcTrpcTcp.0x93d7_1` |
| 173 | `get_fileset_id` | defineAction | Y | 从 QQ 闪传分享码或官方分享链接获取 fileset_id | `share_code` `string({ allowEmpty: false })` 必填 | { fileset_id }：解析出的文件集 ID。<br>`{fileset_id}` | 混合 | — |
| 174 | `_get_friend_dress` | defineAction | Y | 获取指定 QQ 号正在使用的个性装扮（挂件/名片/来电/输入状态等） | `user_id` `userId()` 必填 | 装扮信息；目标未使用任何可查询装扮时 items 为空数组。网络失败、未登录态/风控、页面改版、返回账号与请求不一致时返回失败并附具体原因<br>`{target_uin,is_svip,avatar_url,items}` | HTTP | —（cookie Web API） |

### 1.9 群相册（9）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 175 | `get_group_album_list` | groupAction | Y | **（bundle 无此字段）** | `group_id` `groupId()` **预置**（由 groupAction 注入） | 群相册列表数组，每项为一个相册的基本信息。<br>`array<{id,name,picNum,createTime,last_upload_time,cover,createuin,createnickname}>` | 是 | `QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetAlbumList` |
| 176 | `get_qun_album_list` | groupAction | Y | **（bundle 无此字段）** | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`attach_info` `string().default("")` 可省略，默认 `""` | NapCat 风格的相册列表封套：{album_list, attach_info, has_more}。<br>`{album_list,attach_info,has_more}` | 是 | `QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetAlbumList` |
| 177 | `upload_image_to_qun_album` | groupAction |  | **（bundle 无此字段）** | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`album_id` `string({ allowEmpty: false })` 必填<br>`album_name` `string({ allowEmpty: false })` 必填<br>`file` `image()` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 178 | `upload_video_to_qun_album` | groupAction |  | 上传视频到群相册 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`album_id` `string({ allowEmpty: false })` 必填<br>`album_name` `string({ allowEmpty: false })` 必填<br>`file` `video()` 必填 | { id: string }<br>`{id}` | HTTP | —（cookie Web API） |
| 179 | `get_group_album_media_list` | groupAction | Y | **（bundle 无此字段）** | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`album_id` `string({ allowEmpty: false })` 必填<br>`attach_info` `string().default("")` 可省略，默认 `""` | 相册图片/视频列表及下一页分页游标；视频项包含 id、url、cover、尺寸、时长和多规格地址。<br>`{mediaList,nextAttachInfo}` | 是 | `QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetMediaList` |
| 180 | `do_group_album_comment` | groupAction |  | **（bundle 无此字段）** | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`album_id` `string({ allowEmpty: false })` 必填<br>`lloc` `string({ allowEmpty: false })` 必填<br>`content` `string({ allowEmpty: false })` 必填 | 十进制时间字符串（schema.description）<br>`{id,user,content,time,clientKey}` | 是 | `QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunComment` |
| 181 | `set_group_album_media_like` | groupAction |  | **（bundle 无此字段）** | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`album_id` `string({ allowEmpty: false })` 必填<br>`batch_id` `string({ allowEmpty: false })` 必填<br>`lloc` `string().optional()` 可省略 | `{id,status}` | 是 | `QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunLike` |
| 182 | `cancel_group_album_media_like` | groupAction |  | **（bundle 无此字段）** | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`album_id` `string({ allowEmpty: false })` 必填<br>`batch_id` `string({ allowEmpty: false })` 必填<br>`lloc` `string().optional()` 可省略 | `{id,status}` | 是 | `QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunLike` |
| 183 | `del_group_album_media` | groupAction |  | 删除群相册图片或视频 | `group_id` `groupId()` **预置**（由 groupAction 注入）<br>`album_id` `string({ allowEmpty: false })` 必填<br>`lloc` `string({ allowEmpty: false })` 必填 | `{success}` | 是 | `QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.DeleteMedias` |

### 1.10 空间（29）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 184 | `get_qzone_profile` | defineAction | Y | 获取 QQ 空间名称和说明（默认当前账号） | `target_uin` `userId().optional()` 可省略 | 空间名称和说明。<br>`{name,description}` | HTTP | —（cookie Web API） |
| 185 | `set_qzone_profile` | defineAction |  | 修改当前账号的 QQ 空间名称或说明 | `name` `string().optional()` 可省略<br>`description` `string().optional()` 可省略 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 186 | `get_qzone_msg_list` | defineAction | Y | 获取 QQ 空间说说列表（默认机器人自己的空间） | `target_uin` `userId().optional()` 可省略<br>`pos` `int({ min: 0 }).default(0)` 可省略，默认 `0`<br>`num` `int({ min: 1, max: 100 }).default(20)` 可省略，默认 `20` | 说说列表对象，含说说总数与本页说说数组。<br>`{total,msglist}` | HTTP | —（cookie Web API） |
| 187 | `get_qzone_msg_detail` | defineAction | Y | 获取 QQ 空间说说详情与一页评论（含服务端内联回复，需有访问权限） | `tid` `string({ allowEmpty: false })` 必填<br>`target_uin` `userId().optional()` 可省略<br>`pos` `int({ min: 0 }).default(0)` 可省略，默认 `0`<br>`num` `int({ min: 1, max: 100 }).default(20)` 可省略，默认 `20` | 说说详情、服务端报告的评论总数与本页评论；replies 仅含服务端内联返回的二级回复，不保证完整。<br>`{tid,content,comment_num,comments}` | HTTP | —（cookie Web API） |
| 188 | `get_qzone_feeds` | defineAction | Y | 获取 QQ 空间好友动态，支持结构化正文与游标分页 | `page_num` `int({ min: 1 }).default(1)` 可省略，默认 `1`<br>`count` `int({ min: 1, max: 50 }).default(10)` 可省略，默认 `10`<br>`cursor` `string({ allowEmpty: false, maxLen: 65536 }).optional()` 可省略 | 好友动态、可提取的正文与图片、统计值及下一页游标；未知内容或统计为 null，HTML 保留。<br>`{feeds,has_more,next_cursor}` | HTTP | —（cookie Web API） |
| 189 | `send_qzone_msg` | defineAction |  | 发表说说（QQ 空间，支持纯文字或带图；传 images 自动上传；可设置查看权限） | `content` `string({ allowEmpty: false })` 必填<br>`images` `array(string({ allowEmpty: false })).optional()` 可省略<br>`ugc_right` `int({ min: 1 }).default(1)` 可省略，默认 `1`<br>`target_uins` `array(uint()).optional()` 可省略 | `{tid,time}` | HTTP | —（cookie Web API） |
| 190 | `delete_qzone_msg` | defineAction |  | 删除一条说说（QQ 空间，按 tid） | `tid` `string({ allowEmpty: false })` 必填 | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 191 | `set_qzone_msg_right` | defineAction |  | 修改一条已发说说的查看权限（QQ 空间，按 tid） | `tid` `string({ allowEmpty: false })` 必填<br>`ugc_right` `int({ min: 1 })` 必填<br>`target_uins` `array(uint()).optional()` 可省略 | 更新后的权限对象。<br>`{ugc_right}` | HTTP | —（cookie Web API） |
| 192 | `like_qzone` | defineAction |  | 给一条说说点赞（QQ 空间） | `tid` `string({ allowEmpty: false })` 必填<br>`target_uin` `userId().optional()` 可省略<br>`abstime` `int({ min: 0 }).default(0).role("timestamp")` 可省略，默认 `0` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 193 | `unlike_qzone` | defineAction |  | 取消对一条说说的点赞（QQ 空间；取消赞端点待真机核实） | `tid` `string({ allowEmpty: false })` 必填<br>`target_uin` `userId().optional()` 可省略<br>`abstime` `int({ min: 0 }).default(0).role("timestamp")` 可省略，默认 `0` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 194 | `comment_qzone` | defineAction |  | 评论说说或回复指定评论（普通评论支持带图，楼中楼仅支持文字） | `tid` `string({ allowEmpty: false })` 必填<br>`content` `string({ allowEmpty: false })` 必填<br>`target_uin` `userId().optional()` 可省略<br>`comment_id` `string({ allowEmpty: false }).optional()` 可省略<br>`comment_uin` `userId().optional()` 可省略<br>`reply_uin` `userId().optional()` 可省略<br>`reply_name` `string({ allowEmpty: false }).optional()` 可省略<br>`images` `array(string({ allowEmpty: false })).optional()` 可省略 | 新评论或新回复的 ID；普通评论未返回 ID 时为空串，楼中楼回复不会用父编号代替（schema.description）<br>`{comment_id,parent_comment_id,parent_comment_uin}` | HTTP | —（cookie Web API） |
| 195 | `set_qzone_ban` | defineAction |  | 拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单；enable=true 拉黑，false 解除） | `user_id` `userId()` 必填<br>`enable` `bool().default(true)` 可省略，默认 `true` | 成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）<br>`null` | HTTP | —（cookie Web API） |
| 196 | `get_qzone_home_feeds` | defineAction | Y | 读取自己或有权访问的空间主页动态，保留完整分享信息 | `target_uin` `userId().optional()` 可省略<br>`cursor` `string({ allowEmpty: false, maxLen: 65536 }).optional()` 可省略 | 完整动态及分页状态；访问受空间权限限制，旧说说接口保持不变。<br>`{feeds,has_more,next_cursor}` | HTTP | —（cookie Web API） |
| 197 | `get_qzone_feed_detail` | defineAction | Y | 按说说 tid 读取完整空间动态，可用于生成分享卡片 | `tid` `string({ allowEmpty: false, maxLen: 24 })` 必填 | 完整动态及上游详情字段。feed 保留图片、视频、分享信息和未知字段，可直接用于 get_qzone_share_ark；attach_info 保留上游评论游标，不自动翻页。<br>`{feed,attach_info}` | HTTP | —（cookie Web API） |
| 198 | `get_qzone_share_ark` | defineAction |  | 生成空间动态分享卡片，返回原文及分享提示 | `feed` `object()` 必填 | 生成卡片但不发送消息；后续发送仍返回普通消息编号。<br>`{ark,requires_confirmation,notice}` | HTTP | —（cookie Web API） |
| 199 | `get_qzone_public_capabilities` | defineAction | Y | 读取当前账号的空友爱看入口与推权限 | （无参数） | 当前账号的上游入口能力对象，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 200 | `get_qzone_public_feeds` | defineAction | Y | 读取空友爱看推荐动态，支持独立游标分页 | `cursor` `string({ allowEmpty: false, maxLen: 65536 }).optional()` 可省略 | 推荐动态原始 cell 对象及分页状态，保留其余上游页面字段。<br>`{feeds,has_more,next_cursor}` | HTTP | —（cookie Web API） |
| 201 | `get_qzone_public_feed_detail` | defineAction | Y | 读取推荐动态详情及初始评论 | （无参数） | 上游详情 data；初始评论位于 feed.feed.cell_comment.comments，续页使用 attach_info。<br>`object` | HTTP | —（cookie Web API） |
| 202 | `get_qzone_public_comments` | defineAction | Y | 继续读取推荐动态评论 | `cursor` `string({ allowEmpty: false })` 必填 | 上游评论页对象，保留评论、分页和未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 203 | `get_qzone_public_replies` | defineAction | Y | 继续读取指定评论的回复 | `cursor` `string().default("")` 可省略，默认 `""`<br>`page_size` `int({ min: 1 }).default(20)` 可省略，默认 `20` | 上游回复页对象，保留回复、分页和未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 204 | `set_qzone_public_upvote` | defineAction |  | 推或取消推空友爱看动态（独立于普通赞） | `enable` `bool().default(true)` 可省略，默认 `true` | 上游推操作结果，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 205 | `set_qzone_public_like` | defineAction |  | 点赞或取消赞推荐动态 | `enable` `bool().default(true)` 可省略，默认 `true` | 上游普通赞操作结果，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 206 | `set_qzone_public_comment_like` | defineAction |  | 点赞或取消赞推荐动态中的评论或回复 | `enable` `bool().default(true)` 可省略，默认 `true`<br>`reply` `reply.optional()` 可省略 | 上游普通赞操作结果，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 207 | `comment_qzone_public_feed` | defineAction |  | 评论推荐动态，支持文本或上游富文本条目 | （无参数） | 上游评论结果，包含新评论，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 208 | `reply_qzone_public_feed` | defineAction |  | 回复推荐动态的评论或其中某条回复 | `reply` `reply.optional()` 可省略 | 上游回复结果，包含新回复，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 209 | `delete_qzone_public_comment` | defineAction |  | 删除推荐动态的一条评论（需有权限） | （无参数） | 上游删除结果，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 210 | `delete_qzone_public_reply` | defineAction |  | 删除推荐动态评论下的一条回复（需有权限） | （无参数） | 上游删除结果，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 211 | `set_qzone_public_follow` | defineAction |  | 蹲或取消蹲推荐动态作者 | `enable` `bool().default(true)` 可省略，默认 `true` | 上游关系操作结果，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |
| 212 | `forward_qzone_public_feed` | defineAction |  | 将推荐动态转发到当前账号空间 | `reason` `string().default("")` 可省略，默认 `""` | 上游转发结果，保留未知字段。<br>`object` | HTTP | —（cookie Web API） |

### 1.11 系统表情（4）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 213 | `fetch_sys_faces` | defineAction | Y | 获取 QQ 系统表情目录 | `refresh` `refreshField()` 必填 | 按分组返回完整的 QQ 系统表情映射。<br>`{packs}` | 是 | `OidbSvcTrpcTcp.0x9154_1` |
| 214 | `fetch_face_entity` | defineAction | Y | 按编号查询 QQ 系统表情 | `face_id` `faceIdField()` 必填<br>`refresh` `refreshField()` 必填 | 表情详情；编号不存在时返回 null。<br>`null` | 是 | `OidbSvcTrpcTcp.0x9154_1`<br>`OidbSvcTrpcTcp.0x9155_1` |
| 215 | `search_sys_faces` | defineAction | Y | 搜索 QQ 系统表情 | `query` `string({ allowEmpty: false })` 必填 | 匹配编号、名称、别名或分组名的表情列表。<br>`{faces}` | 是 | `OidbSvcTrpcTcp.0x9154_1` |
| 216 | `fetch_super_face_id` | defineAction | Y | 判断 QQ 系统表情是否使用超级表情格式 | `face_id` `faceIdField()` 必填<br>`refresh` `refreshField()` 必填 | 是否使用超级表情格式。<br>`{is_super}` | 是 | `OidbSvcTrpcTcp.0x9154_1`<br>`OidbSvcTrpcTcp.0x9155_1` |

### 1.12 流式接口（6）

| # | name / 别名 | kind | RO | summary（bundle 原文） | params | returns | native | serviceCmd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 217 | `upload_file_stream` | defineStreamAction |  | 以流式分块方式上传文件到机器人本地(返回可用于发送的本地路径) | `stream_id` `string({ allowEmpty: false })` 必填<br>`chunk_data` `string().optional()` 可省略<br>`chunk_index` `int({ min: 0 }).optional()` 可省略<br>`total_chunks` `int({ min: 1 }).optional()` 可省略<br>`file_size` `int({ min: 0 }).optional()` 可省略<br>`expected_sha256` `string().optional()` 可省略<br>`is_complete` `bool().optional()` 可省略<br>`filename` `string().optional()` 可省略<br>`reset` `bool().optional()` 可省略<br>`verify_only` `bool().optional()` 可省略<br>`file_retention` `int({ min: 0 }).default(DEFAULT_RETENTION_MS)` 可省略，默认 `DEFAULT_RETENTION_MS` | 流式帧:分块确认 type=stream、完成 type=response(含 file_path/file_name/file_size/sha256)<br>`{type,stream_id,status,received_chunks,total_chunks}` | 否 | — |
| 218 | `clean_stream_temp_file` | defineAction |  | 清理流式传输临时文件(仅清理 stream 上传/下载目录) | （无参数） | { message, removed }<br>`{message,removed,freed_bytes,skipped_active}` | 否 | — |
| 219 | `download_file_stream` | defineStreamAction |  | 以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体) | （无参数） | 流式帧:file_info → file_chunk* → file_complete<br>`{type,data_type,file_name,file_size,chunk_size}` | 混合 | — |
| 220 | `download_file_image_stream` | defineStreamAction |  | 以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件) | （无参数） | 流式帧:file_info → file_chunk* → file_complete<br>`{type,data_type,file_name,file_size,chunk_size}` | 混合 | — |
| 221 | `download_file_record_stream` | defineStreamAction |  | 以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件) | （无参数） | 流式帧:file_info → file_chunk* → file_complete<br>`{type,data_type,file_name,file_size,chunk_size}` | 混合 | — |
| 222 | `test_download_stream` | defineStreamAction |  | 测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ) | `error` `bool().default(false)` 可省略，默认 `false` | 流式帧:data_chunk*10 → data_complete(error=true 时以 error 帧结束)<br>`{type,data_type,data}` | 否 | — |

## 2. 服务命令汇总表

**111 条独立 serviceCmd**，覆盖 **149 个 action**（另有 73 个 action 不走 SSO 包）。

| serviceCmd | 协议族 | action 数 | 用到它的 action |
| --- | --- | --- | --- |
| `trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` | `trpc.*` | 12 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file`、`upload_forward_msg`、`upload_foward_msg`、`forward_friend_single_msg`、`forward_group_single_msg`、`send_forward_msg`、`send_group_forward_msg`、`send_private_forward_msg` |
| `MessageSvc.PbSendMsg` | `MessageSvc.*` | 10 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file`、`forward_friend_single_msg`、`forward_group_single_msg`、`send_forward_msg`、`send_group_forward_msg`、`send_private_forward_msg` |
| `OidbSvcTrpcTcp.0x8b7_5` | `OidbSvcTrpcTcp.*` | 9 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file`、`share_peer`、`send_ark_share`、`share_group_ex`、`send_group_ark_share` |
| `OidbSvcTrpcTcp.0x12b6_0` | `OidbSvcTrpcTcp.*` | 7 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file`、`share_peer`、`send_ark_share` |
| `OidbSvcTrpcTcp.0x89a_0` | `OidbSvcTrpcTcp.*` | 6 | `set_group_whole_ban`、`set_group_add_option`、`set_group_search`、`set_group_member_invite_policy`、`set_group_new_member_history_visibility`、`set_group_member_permissions` |
| `OidbSvcTrpcTcp.0x10c0_0` | `OidbSvcTrpcTcp.*` | 4 | `get_group_system_msg`、`set_group_add_request`、`get_group_ignored_notifies`、`get_group_ignore_add_request` |
| `OidbSvcTrpcTcp.0x6d6_0` | `OidbSvcTrpcTcp.*` | 4 | `send_custom_face`、`send_msg`、`send_group_msg`、`upload_group_file` |
| `OidbSvcTrpcTcp.0x88d_0` | `OidbSvcTrpcTcp.*` | 4 | `get_group_info`、`get_group_admin_settings`、`get_group_info_ex`、`get_group_detail_info` |
| `OidbSvcTrpcTcp.0x9154_1` | `OidbSvcTrpcTcp.*` | 4 | `fetch_sys_faces`、`fetch_face_entity`、`search_sys_faces`、`fetch_super_face_id` |
| `OidbSvcTrpcTcp.0xe37_1700` | `OidbSvcTrpcTcp.*` | 4 | `send_custom_face`、`send_msg`、`send_private_msg`、`upload_private_file` |
| `OidbSvcTrpcTcp.0xe37_800` | `OidbSvcTrpcTcp.*` | 4 | `send_custom_face`、`send_msg`、`send_private_msg`、`upload_private_file` |
| `OidbSvcTrpcTcp.0xfe1_2` | `OidbSvcTrpcTcp.*` | 4 | `get_stranger_info`、`get_group_member_info`、`get_group_system_msg`、`nc_get_user_status` |
| `OidbSvcTrpcTcp.0xfe5_2` | `OidbSvcTrpcTcp.*` | 4 | `get_group_list`、`get_group_info`、`get_group_info_ex`、`get_group_detail_info` |
| `trpc.msg.msg_svc.MsgService.SsoReadedReport` | `trpc.*` | 4 | `mark_group_msg_as_read`、`mark_private_msg_as_read`、`mark_msg_as_read`、`_mark_all_as_read` |
| `Faceroam.OpReq` | `Faceroam.*` | 3 | `send_custom_face`、`delete_custom_face`、`fetch_custom_face` |
| `OidbSvcTrpcTcp.0x6d9_4` | `OidbSvcTrpcTcp.*` | 3 | `send_custom_face`、`send_msg`、`send_group_msg` |
| `OidbSvcTrpcTcp.0x902e_1` | `OidbSvcTrpcTcp.*` | 3 | `modify_custom_face`、`move_custom_face_to_front`、`fetch_custom_face_detail` |
| `OidbSvcTrpcTcp.0x9083_1` | `OidbSvcTrpcTcp.*` | 3 | `get_emoji_likes`、`fetch_emoji_like`、`get_msg_emoji_likes` |
| `OidbSvcTrpcTcp.0x93d3_1` | `OidbSvcTrpcTcp.*` | 3 | `get_fileset_info`、`get_flash_file_list`、`get_share_link` |
| `OidbSvcTrpcTcp.0xed3_1` | `OidbSvcTrpcTcp.*` | 3 | `friend_poke`、`group_poke`、`send_poke` |
| `OidbSvcTrpcTcp.0xf90_0` | `OidbSvcTrpcTcp.*` | 3 | `set_group_todo`、`complete_group_todo`、`cancel_group_todo` |
| `OidbSvcTrpcTcp.0xfe7_3` | `OidbSvcTrpcTcp.*` | 3 | `get_group_member_list`、`get_group_member_info`、`get_group_shut_list` |
| `trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg` | `trpc.*` | 3 | `forward_friend_single_msg`、`forward_group_single_msg`、`get_forward_msg` |
| `HttpConn.0x6ff_501` | `HttpConn.*` | 2 | `set_group_portrait`、`set_qq_avatar` |
| `OidbSvcTrpcTcp.0x112a_2` | `OidbSvcTrpcTcp.*` | 2 | `set_qq_profile`、`set_self_longnick` |
| `OidbSvcTrpcTcp.0x12a9_200` | `OidbSvcTrpcTcp.*` | 2 | `get_flash_file_url`、`download_fileset` |
| `OidbSvcTrpcTcp.0x6d7_1` | `OidbSvcTrpcTcp.*` | 2 | `delete_group_file_folder`、`delete_group_folder` |
| `OidbSvcTrpcTcp.0x6d8_1` | `OidbSvcTrpcTcp.*` | 2 | `get_group_root_files`、`get_group_files_by_folder` |
| `OidbSvcTrpcTcp.0x8a0_1` | `OidbSvcTrpcTcp.*` | 2 | `set_group_kick`、`set_group_kick_members` |
| `OidbSvcTrpcTcp.0x9067_202` | `OidbSvcTrpcTcp.*` | 2 | `get_rkey`、`get_rkey_server` |
| `OidbSvcTrpcTcp.0x9082_0` | `OidbSvcTrpcTcp.*` | 2 | `set_group_reaction`、`set_msg_emoji_like` |
| `OidbSvcTrpcTcp.0x9155_1` | `OidbSvcTrpcTcp.*` | 2 | `fetch_face_entity`、`fetch_super_face_id` |
| `OidbSvcTrpcTcp.0x929b_0` | `OidbSvcTrpcTcp.*` | 2 | `get_ai_record`、`send_group_ai_record` |
| `OidbSvcTrpcTcp.0x93d4_1` | `OidbSvcTrpcTcp.*` | 2 | `get_flash_file_url`、`download_fileset` |
| `OidbSvcTrpcTcp.0xd69_0` | `OidbSvcTrpcTcp.*` | 2 | `get_doubt_friends_add_request`、`set_doubt_friends_add_request` |
| `OidbSvcTrpcTcp.0xeac_0` | `OidbSvcTrpcTcp.*` | 2 | `set_essence_msg`、`delete_essence_msg` |
| `OidbSvcTrpcTcp.0xfd4_1` | `OidbSvcTrpcTcp.*` | 2 | `get_friend_list`、`get_friends_with_category` |
| `QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetAlbumList` | `QunAlbum.*` | 2 | `get_group_album_list`、`get_qun_album_list` |
| `QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunLike` | `QunAlbum.*` | 2 | `set_group_album_media_like`、`cancel_group_album_media_like` |
| `trpc.qq_new_tech.status_svc.StatusService.SetStatus` | `trpc.*` | 2 | `set_online_status`、`set_diy_online_status` |
| `ImgStore.BDHExpressionRoam` | `ImgStore.*` | 1 | `add_custom_face` |
| `LightAppSvc.mini_app_share.AdaptShareInfo` | `LightAppSvc.*` | 1 | `get_mini_app_ark` |
| `MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0` | `MQUpdateSvc*` | 1 | `get_unidirectional_friend_list` |
| `OidbSvcTrpcTcp.0x1096_1` | `OidbSvcTrpcTcp.*` | 1 | `set_group_admin` |
| `OidbSvcTrpcTcp.0x1097_1` | `OidbSvcTrpcTcp.*` | 1 | `set_group_leave` |
| `OidbSvcTrpcTcp.0x10c8_0` | `OidbSvcTrpcTcp.*` | 1 | `set_group_add_request` |
| `OidbSvcTrpcTcp.0x112e_1` | `OidbSvcTrpcTcp.*` | 1 | `click_inline_keyboard_button` |
| `OidbSvcTrpcTcp.0x1253_1` | `OidbSvcTrpcTcp.*` | 1 | `set_group_ban` |
| `OidbSvcTrpcTcp.0x1255_0` | `OidbSvcTrpcTcp.*` | 1 | `set_friends_category` |
| `OidbSvcTrpcTcp.0x126b_0` | `OidbSvcTrpcTcp.*` | 1 | `delete_friend` |
| `OidbSvcTrpcTcp.0x126e_200` | `OidbSvcTrpcTcp.*` | 1 | `get_ai_record` |
| `OidbSvcTrpcTcp.0x6d6_2` | `OidbSvcTrpcTcp.*` | 1 | `get_group_file_url` |
| `OidbSvcTrpcTcp.0x6d6_3` | `OidbSvcTrpcTcp.*` | 1 | `delete_group_file` |
| `OidbSvcTrpcTcp.0x6d6_4` | `OidbSvcTrpcTcp.*` | 1 | `rename_group_file` |
| `OidbSvcTrpcTcp.0x6d6_5` | `OidbSvcTrpcTcp.*` | 1 | `move_group_file` |
| `OidbSvcTrpcTcp.0x6d7_0` | `OidbSvcTrpcTcp.*` | 1 | `create_group_file_folder` |
| `OidbSvcTrpcTcp.0x6d7_2` | `OidbSvcTrpcTcp.*` | 1 | `rename_group_file_folder` |
| `OidbSvcTrpcTcp.0x6d8_2` | `OidbSvcTrpcTcp.*` | 1 | `get_group_file_system_info` |
| `OidbSvcTrpcTcp.0x6d8_3` | `OidbSvcTrpcTcp.*` | 1 | `get_group_file_system_info` |
| `OidbSvcTrpcTcp.0x6d9_0` | `OidbSvcTrpcTcp.*` | 1 | `trans_group_file` |
| `OidbSvcTrpcTcp.0x7e5_104` | `OidbSvcTrpcTcp.*` | 1 | `send_like` |
| `OidbSvcTrpcTcp.0x7ed_0` | `OidbSvcTrpcTcp.*` | 1 | `get_profile_like` |
| `OidbSvcTrpcTcp.0x89a_15` | `OidbSvcTrpcTcp.*` | 1 | `set_group_name` |
| `OidbSvcTrpcTcp.0x8a7_0` | `OidbSvcTrpcTcp.*` | 1 | `get_group_at_all_remain` |
| `OidbSvcTrpcTcp.0x8fc_2` | `OidbSvcTrpcTcp.*` | 1 | `set_group_special_title` |
| `OidbSvcTrpcTcp.0x8fc_3` | `OidbSvcTrpcTcp.*` | 1 | `set_group_card` |
| `OidbSvcTrpcTcp.0x902f_1` | `OidbSvcTrpcTcp.*` | 1 | `move_custom_face_to_front` |
| `OidbSvcTrpcTcp.0x904_1` | `OidbSvcTrpcTcp.*` | 1 | `set_group_admin_receive_verify` |
| `OidbSvcTrpcTcp.0x9060_3` | `OidbSvcTrpcTcp.*` | 1 | `get_group_share_link` |
| `OidbSvcTrpcTcp.0x912e_0` | `OidbSvcTrpcTcp.*` | 1 | `set_friend_remark` |
| `OidbSvcTrpcTcp.0x912f_0` | `OidbSvcTrpcTcp.*` | 1 | `set_friend_remark` |
| `OidbSvcTrpcTcp.0x9164_2` | `OidbSvcTrpcTcp.*` | 1 | `get_group_admin_permissions` |
| `OidbSvcTrpcTcp.0x929d_0` | `OidbSvcTrpcTcp.*` | 1 | `get_ai_characters` |
| `OidbSvcTrpcTcp.0x93cf_1` | `OidbSvcTrpcTcp.*` | 1 | `create_flash_task` |
| `OidbSvcTrpcTcp.0x93d0_1` | `OidbSvcTrpcTcp.*` | 1 | `create_flash_task` |
| `OidbSvcTrpcTcp.0x93d1_1` | `OidbSvcTrpcTcp.*` | 1 | `create_flash_task` |
| `OidbSvcTrpcTcp.0x93d2_1` | `OidbSvcTrpcTcp.*` | 1 | `list_filesets` |
| `OidbSvcTrpcTcp.0x93d7_1` | `OidbSvcTrpcTcp.*` | 1 | `send_flash_msg` |
| `OidbSvcTrpcTcp.0x93db_1` | `OidbSvcTrpcTcp.*` | 1 | `create_flash_task` |
| `OidbSvcTrpcTcp.0x9407_1` | `OidbSvcTrpcTcp.*` | 1 | `delete_flash_file` |
| `OidbSvcTrpcTcp.0x9427_0` | `OidbSvcTrpcTcp.*` | 1 | `rename_flash_file` |
| `OidbSvcTrpcTcp.0x9474_0` | `OidbSvcTrpcTcp.*` | 1 | `get_group_todo_list` |
| `OidbSvcTrpcTcp.0x967c_0` | `OidbSvcTrpcTcp.*` | 1 | `get_group_tags` |
| `OidbSvcTrpcTcp.0x967d_0` | `OidbSvcTrpcTcp.*` | 1 | `add_group_tag` |
| `OidbSvcTrpcTcp.0x967e_0` | `OidbSvcTrpcTcp.*` | 1 | `delete_group_tag` |
| `OidbSvcTrpcTcp.0x990_2` | `OidbSvcTrpcTcp.*` | 1 | `translate_en2zh` |
| `OidbSvcTrpcTcp.0x9c1c_2` | `OidbSvcTrpcTcp.*` | 1 | `set_group_admin_permissions` |
| `OidbSvcTrpcTcp.0xEB7_1` | `OidbSvcTrpcTcp.*` | 1 | `set_group_sign` |
| `OidbSvcTrpcTcp.0xb5d_44` | `OidbSvcTrpcTcp.*` | 1 | `set_friend_add_request` |
| `OidbSvcTrpcTcp.0xcd4_1` | `OidbSvcTrpcTcp.*` | 1 | `set_input_status` |
| `OidbSvcTrpcTcp.0xcde_2` | `OidbSvcTrpcTcp.*` | 1 | `request_decrypt_key` |
| `OidbSvcTrpcTcp.0xd72_0` | `OidbSvcTrpcTcp.*` | 1 | `set_doubt_friends_add_request` |
| `OidbSvcTrpcTcp.0xdc2_34` | `OidbSvcTrpcTcp.*` | 1 | `send_tuwen_ark` |
| `OidbSvcTrpcTcp.0xe07_0` | `OidbSvcTrpcTcp.*` | 1 | `ocr_image` |
| `OidbSvcTrpcTcp.0xe37_1200` | `OidbSvcTrpcTcp.*` | 1 | `get_private_file_url` |
| `OidbSvcTrpcTcp.0xef0_1` | `OidbSvcTrpcTcp.*` | 1 | `get_group_admin_settings` |
| `OidbSvcTrpcTcp.0xf00_3` | `OidbSvcTrpcTcp.*` | 1 | `set_group_robot_add_option` |
| `OidbSvcTrpcTcp.0xf16_1` | `OidbSvcTrpcTcp.*` | 1 | `set_group_remark` |
| `OidbSvcTrpcTcp.0xfe7_4` | `OidbSvcTrpcTcp.*` | 1 | `get_group_admin_permissions` |
| `QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.DeleteMedias` | `QunAlbum.*` | 1 | `del_group_album_media` |
| `QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetMediaList` | `QunAlbum.*` | 1 | `get_group_album_media_list` |
| `QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunComment` | `QunAlbum.*` | 1 | `do_group_album_comment` |
| **动态 `p.cmd`** | **动态** | 1 | `send_packet` |
| `pttTrans.TransC2CPttReq` | `pttTrans.*` | 1 | `fetch_ptt_text` |
| `pttTrans.TransGroupPttReq` | `pttTrans.*` | 1 | `fetch_ptt_text` |
| `trpc.basic.corp.Datacard.SsoCorpInfo` | `trpc.*` | 1 | `get_stranger_info` |
| `trpc.msg.msg_svc.MsgService.SsoC2CRecallMsg` | `trpc.*` | 1 | `delete_msg` |
| `trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg` | `trpc.*` | 1 | `delete_msg` |
| `trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg` | `trpc.*` | 1 | `get_friend_msg_history` |
| `trpc.msg.register_proxy.RegisterProxy.SsoGetGroupMsg` | `trpc.*` | 1 | `get_group_msg_history` |
| `trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg` | `trpc.*` | 1 | `get_friend_msg_history` |

## 3. 别名映射表

| 规范名 `names[0]` | 别名 | 分组 |
| --- | --- | --- |
| `fetch_ptt_text` | `get_ptt_text`、`get_record_text` | 扩展 |
| `get_rkey` | `nc_get_rkey` | 扩展 |
| `ocr_image` | `.ocr_image` | 扩展 |
| `set_group_sign` | `send_group_sign` | 扩展 |
| `send_packet` | `.send_packet` | 扩展 |

**5 组别名 / 6 个额外可执行名** —— 222 + 6 = 228。

另有两个 **raw action 预留名**（不经 `defineAction`，由 `compileActionRegistry` 的
`rawReservations` 参数注册，见 `../onebot/src/actions/index.ts`）：

| 可执行名 | canonical | 说明 |
| --- | --- | --- |
| `.handle_quick_operation` | `.handle_quick_operation` | OneBot v11 事件快捷操作处理器，由事件侧动态派发 |
| `.handle_quick_operation_async` | `.handle_quick_operation` | NoneBot 1 时代别名 |

## 4. 传输形态与原生依赖

按**实现方式**分四类（比「原生/纯 JS」二分更有用）：

| 形态 | 数量 | 走什么 | 实现成本 |
| --- | --- | --- | --- |
| **SSO 包** | **149** | `sendRawPacket(cmd, protobuf)` | 每条命令都要 protobuf 编解码 |
| **HTTP Web API** | **41** | `https://*.qq.com` + cookie + bkn | 一套 cookie/bkn 机制全覆盖，无需新 SSO |
| 混合（仅取 key） | 12 | 经 bridge 取 pskey/download rkey | 复用 key 获取器 |
| 纯 JS | 20 | 无外部依赖 | 零成本 |
| **合计** | **222** | | |

### 4.1 HTTP Web API 型（41 个）

这些 action **不需要任何新的 SSO 包**，只需要 `0x102a_0` / `0x102a_1` 取 pskey/clientkey，
拼 cookie、算 bkn，然后普通 HTTP 请求。**全部 29 个空间 action 都在这里面。**

`get_group_honor_info`、`get_essence_msg_list`、`_send_group_notice`、`_get_group_notice`、`get_cookies`、`get_csrf_token`、`get_credentials`、`get_group_signed_list`、`_del_group_notice`、`_get_friend_dress`、`upload_image_to_qun_album`、`upload_video_to_qun_album`、`get_qzone_profile`、`set_qzone_profile`、`get_qzone_msg_list`、`get_qzone_msg_detail`、`get_qzone_feeds`、`send_qzone_msg`、`delete_qzone_msg`、`set_qzone_msg_right`、`like_qzone`、`unlike_qzone`、`comment_qzone`、`set_qzone_ban`、`get_qzone_home_feeds`、`get_qzone_feed_detail`、`get_qzone_share_ark`、`get_qzone_public_capabilities`、`get_qzone_public_feeds`、`get_qzone_public_feed_detail`、`get_qzone_public_comments`、`get_qzone_public_replies`、`set_qzone_public_upvote`、`set_qzone_public_like`、`set_qzone_public_comment_like`、`comment_qzone_public_feed`、`reply_qzone_public_feed`、`delete_qzone_public_comment`、`delete_qzone_public_reply`、`set_qzone_public_follow`、`forward_qzone_public_feed`

### 4.2 纯 JS（20 个）

完全不碰 bridge 层，可以立刻实现：

`get_version_info`、`can_send_image`、`can_send_record`、`set_group_anonymous`、`set_group_anonymous_ban`、`get_image`、`set_restart`、`clean_cache`、`check_url_safely`、`get_recent_contact`、`_get_model_show`、`_set_model_show`、`create_collection`、`.get_word_slices`、`bot_exit`、`nc_get_packet_status`、`download_file`、`upload_file_stream`、`clean_stream_temp_file`、`test_download_stream`

### 4.3 与 MEMORY.md §2.14 基线 202/3/23 的对账

| 口径 | 原生 | 纯 JS | 合计 |
| --- | --- | --- | --- |
| MEMORY 基线（**按 228 个可执行名**统计） | 202 | 23（+3 混合） | 228 |
| 本清单（**按 222 个定义统计**） | **202** | **20** | 222 |

**原生数 202 完全对上**（两边都是「是否触及 `bridge` / `sendRawPacket` / `.apis.`」），
差的 3 个是**纯 JS 名单的口径差异**，不是数据冲突。本清单判为纯 JS 但基线可能算作混合的候选：

| action | 本清单判定 | 依据【实测】 |
| --- | --- | --- |
| `get_image` | 纯 JS | 只调 `ctx.getImageInfo`，而 `ref.converterCtx.imageUrlResolver` 在
  runtime 里被显式置 `null`（第 1223516 / 10995487 字节处），静态看不穿透 |
| `download_file` | 纯 JS | 走 `fetchDownloadFile`（Node `fetch`）+ 本地 `fs`，无 SSO |
| `upload_file_stream` / `clean_stream_temp_file` / `test_download_stream` | 纯 JS | 纯本地文件系统 + 内存状态机 |

> 这 3 个差异的**方向是「本清单更保守」**：把靠回调注入的能力判成不可静态确认，
> 而不是硬凑成原生。若实际运行时 `imageUrlResolver` 被别的装配路径填上真回调，
> `get_image` / `get_record` 会需要 `0xfe1_2` 一类 rkey 刷新命令 —— 这一点【未确认】。

## 5. 空实现 / 占位表

**20 个 action 完全不碰 bridge**，实现成本最低。

| name | 分组 | 形态 | `run` 原文（空白已压缩） |
| --- | --- | --- | --- |
| `can_send_image` | 信息 | 本地逻辑，无 bridge 调用 | `(_p, ctx) => { return okResponse({ yes: ctx.canSendImage?.() ?? false }); }` |
| `can_send_record` | 信息 | 本地逻辑，无 bridge 调用 | `(_p, ctx) => { return okResponse({ yes: ctx.canSendRecord?.() ?? false }); }` |
| `get_version_info` | 信息 | 本地逻辑，无 bridge 调用 | `() => { return okResponse({ app_name: "Haizakura", app_version: `${APP_VERSION}-node`, protocol_version: "v11" }); }` |
| `set_group_anonymous` | 群管理 | **真空实现**（`() => okResponse()`，连字段都没有） | `() => okResponse()` |
| `set_group_anonymous_ban` | 群管理 | **真空实现**（`() => okResponse()`，连字段都没有） | `() => okResponse()` |
| `.get_word_slices` | 扩展 | 未实现 → `failedResponse("not yet implemented")` | `async () => { return failedResponse(RETCODE.ACTION_FAILED, "not yet implemented"); }` |
| `_get_model_show` | 扩展 | 本地逻辑，无 bridge 调用 | `async (p) => { return okResponse([{ variants: { model_show: p.model \|\| "snowluma", need_pay: false } }]); }` |
| `_set_model_show` | 扩展 | **真空实现** | `async () => { return okResponse(); }` |
| `bot_exit` | 扩展 | 本机动作 `process.exit(0)` | `async () => { setTimeout(() => process.exit(0), 50); return okResponse(); }` |
| `check_url_safely` | 扩展 | 写死常量 `{ level: 1 }` | `async () => { return okResponse({ level: 1 }); }` |
| `clean_cache` | 扩展 | **真空实现** | `async () => { return okResponse(); }` |
| `create_collection` | 扩展 | 未实现 → `failedResponse("not yet implemented")` | `async () => { return failedResponse(RETCODE.ACTION_FAILED, "not yet implemented"); }` |
| `download_file` | 扩展 | 本地逻辑，无 bridge 调用 | `async (p) => { const url = p.url; const base64 = p.base64; const name = p.name; if (!url && !base64) return failedResponse(RETCODE.BAD_REQUEST, "url or base64 is required"); let buf; if (base64) { if …` |
| `get_image` | 扩展 | 本地逻辑，无 bridge 调用 | `async (p, ctx) => { const file = p.file \|\| p.file_id; if (!file) return failedResponse(RETCODE.BAD_REQUEST, "file is required"); const info = await ctx.getImageInfo(file); if (info) return okRespons…` |
| `get_recent_contact` | 扩展 | 写死空数组 `[]` | `async () => { return okResponse([]); }` |
| `nc_get_packet_status` | 扩展 | 写死 `null` | `async () => { return okResponse(null); }` |
| `set_restart` | 扩展 | 显式拒绝 → `failedResponse("not supported")` | `async () => { return failedResponse(RETCODE.ACTION_FAILED, "not supported"); }` |
| `clean_stream_temp_file` | 流式接口 | 本地逻辑，无 bridge 调用 | `() => { const result = clearInactiveStreamStorage(); for (const failure of result.failures) log$61.warn("failed to remove stream temp %s: %s", failure.item, failure.message); if (result.failures.lengt…` |
| `test_download_stream` | 流式接口 | 本地逻辑，无 bridge 调用 | `async (p, _ctx, sink) => { for (let i = 0; i < 10; i++) await sink.send({ type: StreamStatus.Stream, data: `Index-> ${i + 1}`, data_type: "data_chunk" }); if (p.error) throw new DownloadError("This is…` |
| `upload_file_stream` | 流式接口 | 本地逻辑，无 bridge 调用 | `(p, ctx) => handleUpload(p, accountKey(ctx))` |

**真正完全空转**（`() => okResponse()`，不返回任何字段）只有 2 个：
`set_group_anonymous`、`set_group_anonymous_ban`。

其余 18 个虽无 bridge，但**都在做真实计算**（读本地缓存/文件系统/进程状态），
不能当占位跳过 —— 例如 `download_file_stream` 是完整的本地 HTTP 分块下载状态机。

## 6. 按 serviceCmd 聚合的实现优先级

### 6.1 协议族层面

| 协议族 | 命令数 | 覆盖 action 次 | 实现建议 |
| --- | --- | --- | --- |
| `OidbSvcTrpcTcp.*` | 87 | 157 | **收益最大**。统一 `OidbSvcTrpcTcp.0x<cmd>_<sub>` 信封 + 一条 `invokeOidb` 模板即可复用 |
| `trpc.*` | 10 | 27 | trpc 裸服务名，公私有 protobuf 格式并存 |
| `MessageSvc.*` | 1 | 10 | 老式 SSO 裸命令名，只有 `PbSendMsg` 一条，但覆盖全部发消息 |
| `QunAlbum.*` | 5 | 7 | 群相册专用命名空间，9 个 action 集中于此 |
| `Faceroam.*` | 1 | 3 | 收藏表情漫游（Faceroam.OpReq），1 条 |
| `HttpConn.*` | 1 | 2 | highway 上传/下载通道，媒体必经之路 |
| `pttTrans.*` | 2 | 2 | 语音转文字（PttTrans），2 条 |
| `ImgStore.*` | 1 | 1 | 收藏表情上传（ImgStore），1 条 |
| `MQUpdateSvc*` | 1 | 1 | web 服务名特例（`wireName` 返回非 `OidbSvcTrpcTcp` 前缀），1 条 |
| `LightAppSvc.*` | 1 | 1 | 轻应用分享 Ark，1 条 |

### 6.2 第一梯队：覆盖 ≥4 个 action 的命令（先做收益最大）

| 排名 | serviceCmd | 协议族 | action 数 | 代表 action |
| --- | --- | --- | --- | --- |
| 1 | `trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` | `trpc.*` | 12 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file` |
| 2 | `MessageSvc.PbSendMsg` | `MessageSvc.*` | 10 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file` |
| 3 | `OidbSvcTrpcTcp.0x8b7_5` | `OidbSvcTrpcTcp.*` | 9 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file` |
| 4 | `OidbSvcTrpcTcp.0x12b6_0` | `OidbSvcTrpcTcp.*` | 7 | `send_custom_face`、`send_msg`、`send_private_msg`、`send_group_msg`、`upload_private_file` |
| 5 | `OidbSvcTrpcTcp.0x89a_0` | `OidbSvcTrpcTcp.*` | 6 | `set_group_whole_ban`、`set_group_add_option`、`set_group_search`、`set_group_member_invite_policy`、`set_group_new_member_history_visibility` |
| 6 | `OidbSvcTrpcTcp.0x10c0_0` | `OidbSvcTrpcTcp.*` | 4 | `get_group_system_msg`、`set_group_add_request`、`get_group_ignored_notifies`、`get_group_ignore_add_request` |
| 7 | `OidbSvcTrpcTcp.0x6d6_0` | `OidbSvcTrpcTcp.*` | 4 | `send_custom_face`、`send_msg`、`send_group_msg`、`upload_group_file` |
| 8 | `OidbSvcTrpcTcp.0x88d_0` | `OidbSvcTrpcTcp.*` | 4 | `get_group_info`、`get_group_admin_settings`、`get_group_info_ex`、`get_group_detail_info` |
| 9 | `OidbSvcTrpcTcp.0x9154_1` | `OidbSvcTrpcTcp.*` | 4 | `fetch_sys_faces`、`fetch_face_entity`、`search_sys_faces`、`fetch_super_face_id` |
| 10 | `OidbSvcTrpcTcp.0xe37_1700` | `OidbSvcTrpcTcp.*` | 4 | `send_custom_face`、`send_msg`、`send_private_msg`、`upload_private_file` |
| 11 | `OidbSvcTrpcTcp.0xe37_800` | `OidbSvcTrpcTcp.*` | 4 | `send_custom_face`、`send_msg`、`send_private_msg`、`upload_private_file` |
| 12 | `OidbSvcTrpcTcp.0xfe1_2` | `OidbSvcTrpcTcp.*` | 4 | `get_stranger_info`、`get_group_member_info`、`get_group_system_msg`、`nc_get_user_status` |
| 13 | `OidbSvcTrpcTcp.0xfe5_2` | `OidbSvcTrpcTcp.*` | 4 | `get_group_list`、`get_group_info`、`get_group_info_ex`、`get_group_detail_info` |
| 14 | `trpc.msg.msg_svc.MsgService.SsoReadedReport` | `trpc.*` | 4 | `mark_group_msg_as_read`、`mark_private_msg_as_read`、`mark_msg_as_read`、`_mark_all_as_read` |

### 6.3 基础设施命令（不解锁 action，但不做则媒体/消息全断）

| 优先级 | serviceCmd | 为什么要先做 |
| --- | --- | --- |
| **P0** | `MessageSvc.PbSendMsg` | 所有发消息的落地点（MEMORY §2.3 已确认发送链终点） |
| **P0** | `HttpConn.0x6ff_501` | 取 highway 会话；发图/发语音/传文件的前置 |
| **P0** | `OidbSvcTrpcTcp.0x102a_0` / `0x102a_1` | 取 pskey / clientkey；**41 个 HTTP 型 action 全靠它** |
| P1 | `trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` | 长消息分包，超长文本必走 |
| P2 | `OidbSvcTrpcTcp.0x9154_1` / `0x9155_1` | 系统表情目录/实体（全局缓存一次长期复用） |

### 6.4 一次性命令（只被 1 个 action 使用，最后做）

共 **70** 条：

`ImgStore.BDHExpressionRoam`、`LightAppSvc.mini_app_share.AdaptShareInfo`、`MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0`、`OidbSvcTrpcTcp.0x1096_1`、`OidbSvcTrpcTcp.0x1097_1`、`OidbSvcTrpcTcp.0x10c8_0`、`OidbSvcTrpcTcp.0x112e_1`、`OidbSvcTrpcTcp.0x1253_1`、`OidbSvcTrpcTcp.0x1255_0`、`OidbSvcTrpcTcp.0x126b_0`、`OidbSvcTrpcTcp.0x126e_200`、`OidbSvcTrpcTcp.0x6d6_2`、`OidbSvcTrpcTcp.0x6d6_3`、`OidbSvcTrpcTcp.0x6d6_4`、`OidbSvcTrpcTcp.0x6d6_5`、`OidbSvcTrpcTcp.0x6d7_0`、`OidbSvcTrpcTcp.0x6d7_2`、`OidbSvcTrpcTcp.0x6d8_2`、`OidbSvcTrpcTcp.0x6d8_3`、`OidbSvcTrpcTcp.0x6d9_0`、`OidbSvcTrpcTcp.0x7e5_104`、`OidbSvcTrpcTcp.0x7ed_0`、`OidbSvcTrpcTcp.0x89a_15`、`OidbSvcTrpcTcp.0x8a7_0`、`OidbSvcTrpcTcp.0x8fc_2`、`OidbSvcTrpcTcp.0x8fc_3`、`OidbSvcTrpcTcp.0x902f_1`、`OidbSvcTrpcTcp.0x904_1`、`OidbSvcTrpcTcp.0x9060_3`、`OidbSvcTrpcTcp.0x912e_0`、`OidbSvcTrpcTcp.0x912f_0`、`OidbSvcTrpcTcp.0x9164_2`、`OidbSvcTrpcTcp.0x929d_0`、`OidbSvcTrpcTcp.0x93cf_1`、`OidbSvcTrpcTcp.0x93d0_1`、`OidbSvcTrpcTcp.0x93d1_1`、`OidbSvcTrpcTcp.0x93d2_1`、`OidbSvcTrpcTcp.0x93d7_1`、`OidbSvcTrpcTcp.0x93db_1`、`OidbSvcTrpcTcp.0x9407_1`、`OidbSvcTrpcTcp.0x9427_0`、`OidbSvcTrpcTcp.0x9474_0`、`OidbSvcTrpcTcp.0x967c_0`、`OidbSvcTrpcTcp.0x967d_0`、`OidbSvcTrpcTcp.0x967e_0`、`OidbSvcTrpcTcp.0x990_2`、`OidbSvcTrpcTcp.0x9c1c_2`、`OidbSvcTrpcTcp.0xEB7_1`、`OidbSvcTrpcTcp.0xb5d_44`、`OidbSvcTrpcTcp.0xcd4_1`、`OidbSvcTrpcTcp.0xcde_2`、`OidbSvcTrpcTcp.0xd72_0`、`OidbSvcTrpcTcp.0xdc2_34`、`OidbSvcTrpcTcp.0xe07_0`、`OidbSvcTrpcTcp.0xe37_1200`、`OidbSvcTrpcTcp.0xef0_1`、`OidbSvcTrpcTcp.0xf00_3`、`OidbSvcTrpcTcp.0xf16_1`、`OidbSvcTrpcTcp.0xfe7_4`、`QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.DeleteMedias`、`QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetMediaList`、`QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunComment`、`pttTrans.TransC2CPttReq`、`pttTrans.TransGroupPttReq`、`trpc.basic.corp.Datacard.SsoCorpInfo`、`trpc.msg.msg_svc.MsgService.SsoC2CRecallMsg`、`trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg`、`trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg`、`trpc.msg.register_proxy.RegisterProxy.SsoGetGroupMsg`、`trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg`

## 7. 抽取方法与已知遗漏

### 7.1 方法【实测】

1. **12.8 MB 不走 SSH stdout**（会被终端流控截断），一律在容器内用 `python3` 处理。
   另取本地副本便于反复迭代：`ssh oracle "sudo docker exec snowluma-hz cat /app/runtime/index.mjs" > index.mjs`，
   **字节数与容器 `ls -l` 完全一致**。
2. **按 `//#region <源文件路径>` 切块**，定位 14 个 `../onebot/src/actions/*.ts` 区域。
3. **手写词法扫描**：`skip_string` / `skip_template`（处理 `${}` 嵌套）/ `skip_comment`，
   再做花括号深度匹配，取出每个 `defineAction({...})` / `groupAction({...})` /
   `groupUserAction({...})` / `defineStreamAction({...})` 的完整对象字面量。
   得 225 个块 → 减 3 个 `action-kit.ts` 里的**函数定义本身**（`function defineAction(def)` 等）
   → **222 个真实 action**。
4. **块内取字段**：顶层扫 `name` / `summary` / `returns` / `returnsSchema` / `params` /
   `readOnly` / `run`；`params` 用**顶层逗号**切分（跳过嵌套括号/字符串内的逗号）。
5. **`returnsSchema` 可能是常量引用**（如 `mediaInfoSchema`），需回全局解析为对象字面量。
6. **serviceCmd 靠调用图求解，不是字符串搜索**。构建了：
   - 6,475 个函数体 + 101 个类的全部方法（含类字段初始化 `x = new Cls()`）
   - 111 个 OIDB 规格（`.command` / `.subCommand` / `.wireName`）+ 122 个 IIFE 式协议规格
   - `buildApiHub` 的 16 个命名空间 → 类映射、`buildApiContext` 的 38 个 ctx 方法
   - 构造函数注入回调（`this.f = options.f ?? (...) => ...`）
   - 工厂内联回调（`createSingleFlightCache({ load: ... })`）
   - 对象字面量 lambda 属性（`converterCtx.imageUrlResolver`，**按值引用**也算）
   求解策略：**沿每条分支下行，遇到的第一个「自己声明了协议」的节点即该分支的协议归属，
   命中后停止下潜**。这样避免把 `0x102a_*`（取 key）这类公共前置算成 action 的目标协议。
7. **传输形态判定**：分支上先遇到 HTTP 调用点（`qzone.qq.com` / `ptlogin2` /
   `cookieToString` / `getBknFromCookie` / `HttpsGetCookies`）即判为 HTTP 型。

### 7.2 交叉验证（3 个已知答案，全部命中）【实测】

| action | 本清单 | 已知依据 | 结果 |
| --- | --- | --- | --- |
| `send_group_msg` | `MessageSvc.PbSendMsg` + `0x6d9_4` | MEMORY §2.3 发送链 | ✅ |
| `set_group_kick` | `OidbSvcTrpcTcp.0x8a0_1` | 规格常量 `command: 2208 (0x8a0)` / `subCommand: 1` | ✅ |
| `get_unidirectional_friend_list` | `MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0` | 规格 `wireName` 返回该字面量 | ✅ |

补充验证：`set_group_card` → `0x8fc_3`、`get_group_member_list` → `0xfe7_3`、
`set_group_sign` → `0xEB7_1`（wireName 特例，**大写 EB**）、`get_group_info` → `0x88d_0` + `0xfe5_2`。

### 7.3 已知遗漏与局限（必须知道）

1. **12 个 action 在 bundle 里就没有 `summary` 字段**（不是没抽到）：
   `get_login_info`、`get_status`、`get_version_info`、`can_send_image`、`can_send_record`，
   加上全部 4 个 `system-face` 系列与 3 个群相册 action。表中标为「bundle 无此字段」。
2. **14 个 action 没有 `returns:` 字符串**，只有 `returnsSchema`；表中回退到
   `returnsSchema.description` 并括注来源。
3. **每条命令的 protobuf 字段结构未展开**。本清单只回答「哪个 action 打哪条命令」，
   字节级 encode/decode 是 5.93 MB `oidb-services` 区域的事，需另做。
4. **`send_packet` 是通配后门**：`sendRawPacket(p.cmd, fromHex(p.data))`，
   `p.cmd` 由调用方任意给出，**无法静态枚举**。表中标为动态。
5. **`OidbSvcTrpcTcp.0x0_100`**（NTV2 上传）的 command 在规格里是 0，实际 wire 名可能
   由其它字段推导。本清单按 `0x0_100` 原样呈现 ——【未确认】，需实测。
6. **`readOnly: true` 的 91 个**只是 bundle 静态声明，未与运行时鉴权逻辑交叉验证。
7. **分支首命令归属法有理论盲区**：若某 action 在**同一个函数体内**顺序打两条不同协议，
   会被归到同一节点上（本清单已保留该节点的全部命令，故不会漏，只可能多）。
8. **回调注入点静态不可穿透**：`ref.converterCtx.imageUrlResolver` 在 media-persistence
   路径里被显式置 `null`，因此 `get_image` / `get_record` 的 rkey 刷新链**断在运行时**，
   本清单判为纯 JS。若别的装配路径传入真回调，结论需修正。

