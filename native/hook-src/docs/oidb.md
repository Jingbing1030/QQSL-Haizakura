# OIDB 协议层

本文记录 `ts/src/oidb/` 的移植结果：统一信封、protobuf 编解码器和 OIDB 服务。

> **当前 inventory 更正（2026-11-22）**：参考版静态提取有 110 个非零 OIDB spec definitions、91 个固定 `(command, subCommand)` pairs；展开动态 subcommand 后为 106 个可能 pair outcomes。当前代码覆盖所有 actual OIDB IIFEs。历史文本中的 87、41/92 等数字属于旧快照；92 的排除规则不可复现，不应用作当前覆盖率。`FetchCustomFaceList`、`GetUnidirectionalFriendList`、`HttpConn.0x6ff_501` 是有意单独处理的非通用 OIDB 信封协议。逐 spec wire-golden 覆盖率需独立盘点。

**参考源**：`reference/index.mjs`（13,916,690 字节，md5
`aa573eba11688960282efa2e41e6661b`，374,326 行）。文中所有 `L<n>` 均指该文件行号。

**验证状态**：`ts/test/oidb-envelope.test.ts`（33 条）+ `ts/test/oidb-services.test.ts`
（57 条）= 90 条全绿。所有请求编码器的期望字节都来自参考自身的 `serialize → encode`
调用链（见 §9），不是自我往返。

---

## 1. 为什么是「一个信封 + 多个 spec」

参考实现了 87 条 `OidbSvcTrpcTcp.0x<cmd>_<sub>` 命令，覆盖 157 处 action 引用
（统计方式见 §8）。这 87 条**共用同一个信封消息**和同一个 `invokeOidb` 模板
（L19136），每条命令只提供 6 个字段：

```ts
{ command, subCommand, uinForm?, resolveSubCommand?, serialize, encode, decode, deserialize }
```

所以移植的关键不是写 87 份代码，而是：**把信封做对一次，让新命令变成数据**。
这正是 `ts/src/oidb/spec.ts` 的 `OidbSpec` 的作用——加一条命令只需声明字段号，
不需要碰传输、错误处理或信封。

> **例外（A 批实测）**：还有一类命令**不走这个信封**。`HttpConn.0x6ff_501`
> （高速上传会话，L34141）的 wire name 就是字面量 `"HttpConn.0x6ff_501"`，
> 载荷在**字段 1281** 而非 4，响应里带 `sigSession` + 上传服务器列表。
> 它没有 command/subCommand、没有信封 errorCode，`invokeOidb` 也套不上；
> 移植件是 `ts/src/oidb/services/0x6ff.ts` 里的独立 codec +
> `HttpConnSession` 描述符。**「87 条共用信封」这句话对 0x6ff_501 不成立。**
>
> 另：`0x112a_2` 一个 cmd/sub 上挂了**两个不同的 spec**（`set_qq_profile` 用
> `OidbSetProfile`，`set_self_longnick` 用 `Oidb0x112aReq`），所以「一条命令 = 一个
> `OidbSpec`」也不总成立；同类情况还有 `0x102a_0`/`_1`。

---

## 2. 信封结构

每条命令的 payload 都包在同一个 protobuf 消息里（L18818 `makeOidbEnvelope`，
L18935 `protobuf_decode_OidbBaseMeta`）：

```
OidbSvcTrpcTcp.0x<cmd>_<sub>   ← 线上命令名，小写十六进制、不补零
┌─────────────────────────────────────────────────────────────┐
│  OidbBase<T>                                                │
│                                                             │
│  1  command      uint32     ← 0xNNNN，如 4138               │
│  2  subCommand   uint32     ← _N 后缀，如 0                 │
│  3  errorCode    uint32     请求恒 0；响应为服务端返回码     │
│  4  body         T          ← 命令自己的消息，本文 §3 的主题 │
│  5  errorMsg     string     请求恒 ""；响应为错误文案        │
│  11 properties   repeated   ← OidbProperty {1 key, 2 value} │
│  12 reserved     uint32     ← uin/uid 模式开关，见 §2.2      │
│                                                             │
│  未知字段：一律跳过并记账（上限 64 条），不报错               │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 字段存在性规则

参考生成的编码器对每个字段各有一个 `if (...)` 判定。**规则按字段类型走，
不是全局统一**，移植必须逐字段复刻：

| 类型 | 写出条件 | 说明 |
| --- | --- | --- |
| `uint32` / `int32` | `!= null && !== 0` | 0 视为「未设置」而省略 |
| `uint64` | `!= null && !== 0n` | 同上，bigint 比较 |
| `bool` | `=== true` | **只有 true 才写**；false 与「未设置」等价 |
| `string` | `!= null && !== ""` | 空串省略 |
| `bytes` | `length > 0` | 空字节省略 |
| `message` | `!= null` | **空消息 `{}` 也会写出**（占 2 字节 tag+len） |
| `repeated` | `length > 0` | 空数组省略 |

有两处**例外**，参考用 `!= null` 单独判定，因此**零值也要写出**
（`ProtoWriter.uint32Present` / `stringPresent` 就是为此而设）：

- `OidbMuteAllState.state`（L209584）——`0` 是「关闭全员禁言」的有效值；
- `Oidb0x89a_0SearchSettings.noFingerOpen` / `noCodeFingerOpen`（L228492）、
  `Oidb0x89a_0InvitePolicySettings.*`（L225109）、
  `Oidb0x89a_0HistoryVisibilitySettings.*`（L226261）、
  `Oidb0x89a_0MemberPermissionSettings.*`（L227369）、
  `OidbGroupRequestBody.message`（L212983）。

这不是洁癖：`set_group_new_member_history_visibility` 关闭时必须发
`groupFlagExt4: 0` + `mask: 4`（值清零、掩码保留），若按默认规则省略就成了
「什么都不改」的空请求，服务端静默无效。

### 2.2 `reserved`（字段 12）是模式开关，不是填充

参考在 L18810 留了注释说明这个字段名是历史包袱：

> `isUid` 标志把信封 `reserved` 置 1；尽管名字如此（为兼容旧 API 保留），
> 经验上 `reserved = 1` 表示该 OIDB 调用使用 **UIN 形式**。

所以映射是 `uinForm: true → reserved: 1`。**不要**顺手把它改名成 `isUid`——
`0x8b7_5`（true）、`0x12b6_0`（false）、`0x6d6_*`（true）三条命令恰好在这个 bit
上互不相同，改名会掩盖掉唯一的差异点。

解码侧还有一个**类型不对称**必须保留：字段 12 按 `int32` 解码（`_val | 0`），
而字段 1/2/3 是 `uint32`（`_val >>> 0`）。见 §5。

---

## 3. 服务字段表

字段号全部逐条读自参考的 `__size_` / `__write_` / `protobuf_decode_` 三件套，
**没有一个是推测的**。表中 `L` 为定义该字段写法的行号。

### 3.1 `0x102a_0` — GetPskey ／ `0x102a_1` — ForceFetchClientKey

> 这两条命令在 action 表里**没有任何 action**（§8 统计为 0），但 41 个 HTTP
> 类 action 全部依赖它们的凭据，所以优先移植。

| 命令 | 子命令 | `uinForm` | 作用 |
| --- | --- | --- | --- |
| `0x102a` = 4138 | 0 | false | 按域名批量取 pskey |
| `0x102a` = 4138 | 1 | false | 取 clientkey |

**请求** `OidbGetPskeyReq`（L42103）：字段 1 `domainList` repeated string。

**响应** `OidbSvcTrpcTcp0x102aResponse`：

| # | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| 1 | `pskeyItems` | repeated message | → `PskeyItem` |
| — | `PskeyItem.domain` | 1, string | 域名 |
| — | `PskeyItem.pskey` | 2, string | 密钥 |
| — | `PskeyItem.expireTime` | 3, uint64 | 过期时间（**bigint**） |

**请求** `OidbClientKeyReq`：消息存在但**没有字段**
（`__size_OidbClientKeyReq` 返回 0），线上表现为 `22 00`。

**响应** `OidbSvcTrpcTcp0x102a_1Response`：

| # | 字段 | 类型 |
| --- | --- | --- |
| **2** | `keyIndex` | uint32 |
| **3** | `clientKey` | string |
| **4** | `expireTime` | uint32 |

⚠️ 这里的字段号是 **2/3/4，不是 1/2/3**。`expireTime` 在 pskey 里是字段 3
（uint64），在 clientkey 里是字段 4（uint32）——同一个名字、不同类型、不同
字段号。这正是两条命令必须分开编码的原因。

`ForceFetchClientKey.deserialize` 会把缺省值补成 `keyIndex: "19"`,
`expireTime: "1800"`（参考的硬编码回退）。

### 3.2 `0x8b7_5` — 群分享卡片 ／ `0x12b6_0` — 好友分享卡片

| 命令 | 子命令 | `uinForm` | 字段号 |
| --- | --- | --- | --- |
| `0x8b7` = 2231 | 5 | **true** | 见下 |
| `0x12b6` = 4790 | 0 | **false** | 见下 |

**`0x8b7_5` 请求** `OidbGroupRecommendArkReq`（L69988）：1 `reqType` uint32，
2 `groupCode` uint64，5 `flag` uint32。
**响应**：1 `errCode` uint32，**5** `arkJson` string。

**`0x12b6_0` 请求** `OidbBuddyRecommendArkReq`（L68930）：1 `uin` uint64，
2 `phoneNumber` string，3 `jumpUrl` string。
**响应**：**1** `ark` string。

⚠️ 两条响应的卡片所在字段不同（`0x8b7_5` 在 5，`0x12b6_0` 在 1）。
把 0x8b7_5 的响应用 0x12b6_0 的 schema 解，字段 1 的 `errCode` 会被读成
「卡片内容为空」而不是报错——这是一个静默错误，测试里专门钉了一条用例。

好友卡片的 `jumpUrl` 模板是硬编码的（`buddyRecommendArkJumpUrl`）：
`mqqapi://card/show_pslcard?src_type=internal&source=sharecard&version=1&uin=<uin>`。

### 3.3 `0x89a_0` / `0x89a_15` — 群设置

`0x89a` = 2202。**6 个 action 走子命令 0，`set_group_name` 走子命令 15**
（action 表只列了 `0x89a_0`，`_15` 缺项，见 §7）。

子命令 0 的统一外层：1 `groupUin` uint64，2 `settings`（各 action 不同），
12 `field12` uint32。

| action | settings 字段 |
| --- | --- |
| `set_group_whole_ban` | 17 `state` uint32（**`!= null`**，`0xffffffff` = 开启） |
| `set_group_add_option` | 16 `addType`（非零）, 30 `groupQuestion`, 31 `groupAnswer` |
| `set_group_search` | 35 `noFingerOpen`, 36 `noCodeFingerOpen`（均 **`!= null`**） |
| `set_group_member_invite_policy` | 23 `appPrivilegeFlag`, 24 `appPrivilegeMask`, 29 `allowMemberInvite` |
| `set_group_new_member_history_visibility` | 42 `groupFlagExt4`, 43 `groupFlagExt4Mask` |
| `set_group_member_permissions` | 23 `appPrivilegeFlag`, 24 `appPrivilegeMask` |

子命令 15 `OidbRenameGroup`（L220472）：1 `groupUin` **uint32**（注意：这里是
uint32，其余 0x89a 消息都是 uint64），2 `body` → 3 `targetName` string。

**响应**：全部是 `OidbEmpty`（无字段），`deserialize` 返回 `undefined`。

#### 位常量（全部逐字取自参考，非推测）

| 常量 | 值 | 出处 |
| --- | --- | --- |
| `MEMBER_INVITE_PRIVILEGE_MASK` | `101711872` = `0x6100000` | L225187 |
| `POLICY_PRIVILEGE_BITS.disabled` | `67108864` | L225189 |
| `.require_approval` | `0` | L225190 |
| `.no_approval` | `1048576` | L225191 |
| `.no_approval_under_100` | `33554432` | L225192 |
| `GROUP_MEMBER_PERMISSION_MASKS.upload_album` | `1` | L227423 |
| `.temporary_session` | `65536` | L227424 |
| `.create_group` | `32768` | L227425 |

两组语义相反，务必不要「统一」：

- **邀请策略**：`flag = (current & ~mask) | (bits & mask)`，位**置 1** 表示该策略生效。
- **成员权限**：`allow ? current & ~mask : current | mask`，位**置 1** 表示**禁止**
  （`decodeGroupMemberPermissions` 用 `(flag & mask) === 0` 判「允许」）。

`addType` 有一个别名：`55` 等价于 `5`，且 55 属于「需要问答」的模式
（`isQuestionAddType` = 4 / 5 / 55），线上编码为 5。

### 3.4 `0x6d6_0..5` — 群文件

`0x6d6` = 1750，五个操作各占一个**外层槽位**，槽位号是 1/3/4/5/6
（**字段 2 在参考 schema 里被跳过**）：

| 子命令 | action | 外层槽位 |
| --- | --- | --- |
| 0 | `upload_group_file` | 1 `file` |
| 2 | 取下载链接 | 3 `download` |
| 3 | 删除 | 4 `delete` |
| 4 | 重命名 | 5 `rename` |
| 5 | 移动 | 6 `move` |

全部 `uinForm: true`。

**上传请求** `OidbGroupFileUploadReq`（L284486）：1 `groupUin` uint64，
2 `appId`, 3 `busId`, 4 `entrance`, 5 `targetDirectory`, 6 `fileName`,
7 `localDirectory`, 8 `fileSize` uint64, 9 `fileSha1`, 10 `fileSha3`,
11 `fileMd5`（9/10/11 为 bytes）, 15 `field15` bool。

**下载请求**：1 `groupUin`, 2 `appId`（7）, 3 `busId`, 4 `fileId` string。
**删除请求**：1 `groupUin`, 3 `busId`, **5** `fileId` —— 是 5 不是 4。
**重命名请求**：1 `groupUin`, 3 `busId`, 4 `fileId`, 5 `parentFolder`, 6 `newFileName`
（没有 `appId`）。
**移动请求**：1 `groupUin`, 2 `appId`, 3 `busId`, 4 `fileId`,
5 `parentDirectory`, 6 `targetDirectory`。

**响应**：外层槽位与请求相同，每个槽内是操作结果。
上传槽 11 个字段（1 `retCode` **int32**, 2 `retMsg`, 3 `clientWording`,
4 `uploadIp`, 5 `serverDns`, 6 `busId` **int32**, 7 `fileId`, 8 `checkKey`,
9 `fileKey`, 10 `boolFileExist`, 14 `uploadPort`）。
下载槽：1 `retCode`, 2 `retMsg`, 3 `clientWording`, 4 `downloadIp`,
5 `downloadDns`, 6 `downloadUrl` bytes, 11 `saveFileName`。
删除/重命名/移动槽：1 `retCode`, 2 `retMsg`, 3 `clientWording`。

⚠️ `retCode` 的符号性不统一：上传槽按 `int32`（`_val | 0`）解，其余按 `uint32`
（`_val >>> 0`）解。所以删除的 `-1` 会读成 `4294967295`，错误文案是
`failed with retcode 4294967295` —— 这是**参考自身的行为**，移植保持原样。

### 3.5 `0xfe5_2` — 群列表 / 群详情

`0xfe5` = 4069，`uinForm: true`。请求是**常量**：一次要回所有群的全套字段，
4 个 action 只在筛选结果上不同。

**请求** `OidbGroupListRequest`（L55801）：1 `config` →
`OidbGroupListConfig{1 config1, 2 config2, 3 config3}`。

- `Config1`（L56041-56185，**全 bool**）：1 `groupOwner`, 2, 3 `memberMax`,
  4 `memberCount`, 5 `groupName`, 8-18, 19 `question`, 20, 22-32,
  **5001, 5002, 5003**。
- `Config2`（L56222）：1-8，其中 3 是 `remark`。
- `Config3`（L56267）：5, 6。

⚠️ `5001-5003` 不是 `50/51/52` 的笔误：它们声明在 5000 段，编码成**三字节 tag**
（`c8 b8 02`）。任何「字段号都很小」的假设在这里会丢数据。参考发送时
`field5002: false, field5003: false`（bool 规则：false 不上线），`field5001: true`。

**响应** `OidbSvcTrpcTcp0xFE5_2Response`（L56513）：**2** `groups` repeated。

| 消息 | 字段 |
| --- | --- |
| `...Group` (L56600) | 3 `groupUin` uint32, 4 `info`, 5 `customInfo` |
| `...GroupInfo` (L56735) | 1 `groupOwner`→`...Member{2 uid}`, 2 `createdTime`, 3 `memberMax`, 4 `memberCount`, 5 `groupName`, 10 `shutUpAllTimestamp`, 18 `description`, 19 `question`, 30 `announcement` |
| `...CustomInfo` (L57067) | 3 `remark` |

⚠️ `groups` 是**字段 2**，字段 1 在参考 schema 里不存在。

**OneBot 投影**（`toGroupSummary`，对照 L74525）：

- `group_remark` ← `customInfo.remark`（不是 `info` 里的字段）
- `group_memo` ← `announcement || description`（公告为空时回落）
- `group_all_shut` ← **计算值**：`isGroupAllMuted`（L74348）比较
  `shutUpAllTimestamp` 与当前时间，输出 `-1`/`0`。直接吐原始时间戳会得到
  ~1.7e9 这种无意义数字。
- `group_level` ← **本消息里没有**。参考另走 `0x88d_0` 详情接口
  （`getGroupLevel`, L39376）。此处保持 0，并把这条记为跨命令缺口（§7）。

### 3.6 `0x10c0_1` / `0x10c0_2` — 入群请求列表

`0x10c0` = 4288，`uinForm: true`。

> ⚠️ **子命令不是 0**。action 表写作 `0x10c0_0`，但参考的
> `FetchGroupRequests.resolveSubCommand`（L61638）只发 1 或 2：
> `(p) => p.filtered ? 2 : 1`。`_1` = 待处理，`_2` = 已过滤。
> 详见 §7。

**请求** `OidbGroupRequestList`（L59878）：1 `count` uint32（默认 50），
2 `field2` uint64（分页游标，默认 0n，0 不上线）。

**响应**：参考**解码两遍**——同一段字节分别按 by-uin 和 by-uid 两个 schema 解，
再按下标合并（`mergeRequestList`, L61618）。理由见下。

| 消息 | 字段 |
| --- | --- |
| 外层（两个变体编号相同） | 1 `requests`, 2 `field2` uint64, 3 `newLatestSeq` uint64, 4 `field4`, 5 `field5` uint64, 6 `field6` |
| `...ResponseRequest`（L60334 / L61217） | 1 `sequence` uint64, 2 `eventType`, 3 `state`, 4 `group`, 5 `target`, 6 `invitor`, 7 `operatorUser`, 9 `field9` string, 10 `comment` string, 14 `operateTransInfo` bytes |
| `...ResponseGroup` (L60603) | 1 `groupUin` uint32, 2 `groupName` string |
| `...ResponseUserByUin` (L60710) | **1 `uin` uint32**, 2 `name` string |
| `...ResponseUser` (L61486) | **1 `uid` string**, 2 `name` string |

⚠️ 两个用户子消息的**字段 1 类型不同**：by-uin 是 uint32，by-uid 是 string。
按错的那个解，要么得到 0，要么得到乱码 uid —— 而且**不报错**。一次响应可能
两种形态都带，所以参考解两遍。合并规则（L61595）：`uid` 取 by-uid 侧，
`uin` 取 by-uin 侧，`name` 优先 by-uin。

**`flag` 编码**（跨 action 契约，`set_group_add_request` 要把
sequence/group/eventType 从中还原）。参考的规范形式是 6 段冒号分隔
（`formatGroupRequestFlag`, L11184）：

```
slreq:1:<sequence>:<groupId>:<eventType>:<filtered 0|1>
```

`parseGroupRequestFlag`（L39923）还接受两种历史形式：纯数字（只当 sequence）、
`add:<group>:<targetUid>` / `invite:<group>:<targetUid>`（targetUid 可含冒号，
故尾部重新 join）。

`normalizeGroupRequestSequence`（L74354）会**拒绝** ≤0 的 sequence，而不是容忍。

`GROUP_REQUEST_OPERATION_TYPE`（L61570）是一张 18 项映射表，不是算术公式；
`groupRequestOperationType` 在表里查不到时，若值本身属于输出集合则原样返回，
否则返回 `null`。注意**输入输出集合重叠**（2 既是键也是值），所以「输出值映射到
自身」只对「不是键的值」成立 —— 这条在测试里被明确钉住。

---

## 4. 每条命令对应的 action

统计口径：`ONEBOT-ACTION-SPEC.md` 第 9 列（`协议`）中出现该命令名的行，
按 action 名去重。

| 命令 | action 数 | action 列表 |
| --- | --- | --- |
| `0x8b7_5` | 9 | `send_custom_face`, `send_msg`, `send_private_msg`, `send_group_msg`, `upload_private_file`, `share_peer`, `send_ark_share`, `share_group_ex`, `send_group_ark_share` |
| `0x12b6_0` | 7 | `send_custom_face`, `send_msg`, `send_private_msg`, `send_group_msg`, `upload_private_file`, `share_peer`, `send_ark_share` |
| `0x89a_0` | 6 | `set_group_whole_ban`, `set_group_add_option`, `set_group_search`, `set_group_member_invite_policy`, `set_group_new_member_history_visibility`, `set_group_member_permissions` |
| `0x89a_15` | 1 | `set_group_name` — ⚠️ 不在 action 表的命令列里，§7 |
| `0x10c0_0` | 4 | `get_group_system_msg`, `set_group_add_request`, `get_group_ignored_notifies`, `get_group_ignore_add_request` — ⚠️ 见 §7 |
| `0x6d6_0` | 4 | `send_custom_face`, `send_msg`, `send_group_msg`, `upload_group_file` — ⚠️ 见 §7 |
| `0x6d6_2/3/4/5` | 各 1 | 下载链接 / 删除 / 重命名 / 移动 |
| `0xfe5_2` | 4 | `get_group_list`, `get_group_info`, `get_group_info_ex`, `get_group_detail_info` |
| `0x102a_0` | **0** | 无 action；41 个 HTTP 类 action 的凭据来源 |
| `0x102a_1` | **0** | 同上 |

全表口径：**87 条 OIDB 命令，157 处 action 引用**。口径说明：157 是
「action 名 × 命令」的配对去重计数（同一个 action 引用同一条命令两次只算一次），
涉及 **116 个不同的 action 名**。与任务背景给的 87 / 157 一致。

复算脚本（口径可复现）：

```python
cells = [c.strip() for c in line.strip().strip('|').split('|')]   # 第 9 列 = 协议
hits  = re.findall(r'0x([0-9a-fA-F]+)_(\d+)', cells[8])            # 仅 action 行
```

注意**不能**整行扫 `0x.._..`：命令名本身也出现在第 9 列，会多算出一倍。

---

## 5. 解码器的类型不对称（容易出错的地方）

参考的 tag 分发是按**完整 tag**（`field<<3 | wireType`）做的 `switch`，
所以「已知字段 + 错误 wire type」会落进未知字段分支被跳过，而**不是**报错。
移植用 `tagOf()` 复刻了这一点。

类型收窄也不统一，必须逐字段照抄：

| 位置 | 收窄方式 | 结果 |
| --- | --- | --- |
| 信封 1/2/3 | `_val >>> 0` | uint32 |
| 信封 **12** | `_val \| 0` | **int32** |
| 群文件上传 `retCode` / `busId` | `_val \| 0` | int32 |
| 其余 `retCode` | `_val >>> 0` | uint32 |

### varint 宽度：不能用 5 字节限制

参考的**生成解码器**并不用 5 字节版 `__readVarint32`（那个只给信封/跳过逻辑用），
而是内联了一个宽容版本（L248540）：

```js
if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
if (_s < 32) _val |= (_b & 127) << _s;   // 第 32 位以上直接丢弃
```

两个后果都是**载重**的：

1. **10 字节 varint 合法**，即使目标是 32 位字段。负的 int32 正是这样编码的
   （`-1` → `ff ff ff ff ff ff ff ff ff 01`）。用 5 字节限制会拒绝服务端能发的
   **每一个负 retCode**。
2. 超出 32 位的字节被**丢弃**而非拒绝，取低 32 位后 `>>> 0`。

（这条是移植过程中真实的 bug：最初写成 5 字节严格版，`delete` 的 `-1` 直接抛
`uint32 varint overflow`。已修正并加了回归用例。）

---

## 6. 未知字段处理

参考对未知字段不报错，而是记账（L18793 `protobuf_getUnknownFieldMetadata`）：

- 最多保留 **64 条**明细；超出后只累加 `omittedOccurrences` / `omittedByteLength`；
- 同一 `field*8+wireType` 重复出现会**合并**成一条，带 `count` / `totalByteLength`；
- 元数据挂在 `Symbol.for("snowluma.proton.unknownFields")` 上，不可枚举。

移植里对应 `UnknownFieldCollector`（`wire.ts`）。

---

## 7. 未确认 / 与 action 表冲突的条目

以下六条是**已知分歧**，不是遗漏。逐条说明证据，避免后来的人重复考古。

### 7.1 `0x10c0_0` 的子命令 0 不存在

- action 表列 `0x10c0_0` 给 4 个 action；
- 参考只有 `FetchGroupRequests` / `FetchGroupRequestsByUid` 设置 `command = 4288`，
  且 `resolveSubCommand = (p) => p.filtered ? 2 : 1`。**从不发子命令 0**。
- → 本实现按 1/2 实现，并提供 `resolveSubCommand`。

### 7.2 `set_group_add_request` 实际走 `0x10c8`

- action 表把它归在 `0x10c0_0`；
- 参考的 `_SetAddRequest.command = 4296 = 0x10c8`（L213041），消息体与上面完全
  无关：`{1 accept uint32, 2 body{1 sequence uint64, 2 eventType, 3 groupUin,
  4 message string, 7 operateTransInfo bytes}}`。
- → `0x10c0.ts` 末尾**记录**了该 body 的形状与编码器，但明确标注它属于
  0x10c8 服务，不在本文件范围内。真正的 0x10c8 spec 尚未移植。

### 7.3 `0x6d6_0` 与发送类 action 的关系

- action 表把 `send_custom_face` / `send_msg` / `send_group_msg` 列在 `0x6d6_0` 下；
- 参考的 0x6d6 spec 只有五个**文件操作**。发送类 action 在参考实现里**并不发
  0x6d6**（它们走 `MessageSvc.PbSendMsg` / `0xe37_*`）。
- → 视为 action 表与参考实现的分歧。本实现只覆盖文件操作。

### 7.4 `0x8b7_5` / `0x12b6_0` 的 action 归属

- 表中归给这两条命令的是**分享卡片**相关路径（`send_ark_share` 等）；
- 参考确实实现了这两条命令（`GetGroupRecommendArk` / `GetBuddyRecommendArk`），
  但 `send_custom_face` / `send_msg` 等普通发送路径不走它们。
- → 已按参考实现编码器；「哪些 action 真正经过这里」需要在业务层（阶段 3）确认。

### 7.5 `0x89a_15` 缺项

- `set_group_name` 在参考里是 `0x89a_15`，但 action 表的命令列只写了 `0x89a_0`。
- → 本实现两者都覆盖（子命令 0 六个、子命令 15 一个）。

### 7.6 `group_level` 不在 `0xfe5_2` 里

- OneBot schema 有 `group_level`，但 `0xfe5_2` 的响应消息没有对应字段；
- 参考另走 `0x88d_0`（`getGroupLevel`, L39376），带 300 秒 TTL 缓存。
- → `toGroupSummary` 里保持 0，并在文件注释标注。补齐需要移植 0x88d_0。

### 7.7 其它已确认项（**不是**未确认）

邀请策略 / 成员权限的位常量此前一版曾靠推测，现已全部逐字取自参考（L225187、
L227422 等），**属于已确认**。同理 `0x89a` 的零值写出规则、`reserved` 的语义、
`0x102a` 的字段号，均已在参考中读出原文行号，不再标记为 unverified。

---

## 8. 文件清单

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `ts/src/oidb/wire.ts` | 564 | 手写 protobuf 原语：`ProtoWriter` / `ProtoReader` / `UnknownFieldCollector`。零依赖。 |
| `ts/src/oidb/envelope.ts` | 369 | 信封编码/解码、`OidbProperty`、`oidbWireName`、`OidbError` |
| `ts/src/oidb/spec.ts` | 137 | `OidbSpec` 接口 + `invokeOidb`（4 步顺序与参考一致） |
| `ts/src/oidb/services/0x102a.ts` | 233 | pskey / clientkey |
| `ts/src/oidb/services/0x8b7-5.ts` | 219 | 群 / 好友分享卡片 |
| `ts/src/oidb/services/0x89a-0.ts` | 535 | 群设置（7 个 action） |
| `ts/src/oidb/services/0x6d6.ts` | 732 | 群文件（5 个子命令） |
| `ts/src/oidb/services/0xfe5-2.ts` | 515 | 群列表 / 群详情 |
| `ts/src/oidb/services/0x10c0.ts` | 715 | 入群请求（含双解合并、flag 编解码） |
| `ts/src/oidb/services/index.ts` | 279 | 汇总导出 |
| `ts/test/oidb-envelope.test.ts` | 406 | 信封 33 条用例 |
| `ts/test/oidb-services.test.ts` | 818 | 服务 57 条用例 |

---

## 9. 测试方法论：golden 字节从哪来

**这一点决定了移植是否可信**，所以单独说明。

最初用 `work/oidb/probe/golden.mjs` 直接调参考的 `protobuf_encode_*`，但**信封
环境变量是手写的**——于是我自己关于常量（掩码、别名）的猜测混进了「golden」，
测试变成自证。

改用 `work/oidb/probe/specgold.mjs`：它把参考的 **spec IIFE** 连同其闭包（生成的
编解码器 + `mergeGroupMemberPermission` 这类小函数 + `MEMBER_INVITE_PRIVILEGE_MASK`
这类模块级常量）一起求值，然后**调用参考自己的 `serialize(ctx, params)`**，再用
参考的 `makeOidbEnvelope` 语义包信封，最后交给 `encode`。常量因此全部来自
`reference/index.mjs`。

用例在 `work/oidb/probe/spec_cases.json`，产物在 `work/oidb/probe/goldens.json`
（29 条）。这套工具当场抓出了我先前写错的三个期望值：

| 用例 | 我原先的猜测 | 参考实际 | 原因 |
| --- | --- | --- | --- |
| `invitepolicy` mask | `0xff01` (255) | `8080c030` (0x6100000) | 掩码猜成了低位 |
| `memberperm` mask | `40` (64) | `01` (1) | `create_group`=32768/`upload_album`=1，我记混了 |
| `addoption_55` | 只发 addType | 还发空的问答对 | 55 属于需要问答的模式 |

解码侧用例同样是脚本算出来的字节（`Python` 手写 varint），不是手打 hex——
手打 hex 是这套测试里 bug 的最大来源（长度前缀算错、varint 用 10 字节编 32 位
字段等），最终全部换成脚本生成。

### 运行

```bash
cd /home/ubuntu/hook-rewrite/ts
npm run build
node --test build/test/oidb-envelope.test.js build/test/oidb-services.test.js
# → # tests 90, # pass 90, # fail 0
```

全套（排除 `rtti.test.js`，它在本环境会挂起，与本次改动无关）：

```bash
node --test $(ls build/test/*.test.js | grep -v rtti)
# → # tests 168, # pass 166, # fail 0, # skipped 2
```

---

## 10. 后续关注（历史计划已过期）

本文原始计划中的 `41 / ~92`、移植 `0x10c8` / `0x88d_0` 等项目是在早期快照写入；这些命令后来已进入服务 barrel。92 的历史 curated denominator 没有可复现定义，不作当前 coverage 指标。当前静态 inventory 和非 OIDB例外见本文开头。

以下是原计划留下的待审查事项，是否仍成立需针对当前代码重新测量，而不是视为已确认缺口：

- `ensureRetCodeZero` 与 `checkRetCodeZero` 是否可统一为参考措辞。
- `wire.ts` 的非 packed `repeatedUint32`、`fixed32` 读接口及 `ProtoWriter(NaN)` 边界行为。
- 逐 spec wire-golden tests 的完整覆盖矩阵。