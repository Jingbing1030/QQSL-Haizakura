# msg-push：入站推送解码层

> 本文对应 `ts/src/msg-push-fields.ts`（生成层）与 `ts/src/msg-push.ts`（手写层），
> 是从 `reference/index.mjs` 逆向重写的产物。所有字段号、wire type、窄化方式均
> **逐条从参考实现的解码函数中读出**并标注行号；本文 §6 记录如何用可执行的方式证明这一点。

---

## 1. 参考实现的位置

`protocol/msg-push` 在 `reference/index.mjs` 里是 **21 个相邻 region**，不是一段连续代码。
本任务只取到 registry 为止，历史拉取等后续 region 不在范围内（见 §7）。

| region | 起点行 | 终点行 | 内容 |
| --- | --- | --- | --- |
| `msg-push/helpers.ts` | **121794** | 122299 | hex/utf8/URL/解压/Identity/模板/unwrap |
| `msg-push/xml-card.ts` | 122301 | 122358 | `readXmlMsgAttributes` 属性解析 |
| `msg-push/rich-body-decoder.ts` | **122359** | 135845 | 全部 `protobuf_decode_*` + `convertElements` |
| `msg-push/blank-filter.ts` | 135846 | 135921 | 回复后空文本过滤 |
| `msg-push/context.ts` | 135922 | 143079 | `buildContext` / `buildContextFromMessage` |
| `msg-push/enums.ts` | **143080** | 143223 | `PkgType` / `Event0x2DCSubType` / `Event0x210SubType` |
| `msg-push/decoders/event-0x210.ts` | 143224 | 146726 | 好友/资料类事件 |
| `msg-push/decoders/event-0x2dc.ts` | 146727 | 151741 | 群通知类事件 |
| `msg-push/decoders/friend-message.ts` | **151742** | 151793 | 私聊消息 |
| `msg-push/decoders/group-admin.ts` | 151794 | 152282 | 群管理变更（未移植） |
| `msg-push/decoders/group-join-request.ts` | 152283 | 153343 | 加群/邀请（未移植） |
| `msg-push/decoders/group-member-change.ts` | 153344 | 153923 | 群成员增减（未移植） |
| `msg-push/decoders/group-message.ts` | **153924** | 153955 | 群消息 |
| `msg-push/decoders/temp-message.ts` | 153956 | 153983 | 群临时会话 |
| `msg-push/registry.ts` | 153984 | 154038 | `MsgPushRegistry` |
| `msg-push/index.ts` | **177162** | — | `parseMsgPush`（在后续 region 之后，未移植） |

判定依据：`grep -n "^//#region ../protocol/src/msg-push" reference/index.mjs`（21 条）。

---

## 2. 为什么字段表是生成的，而不是手写的

参考实现的每个解码函数形如：

```js
function protobuf_decode_ExtraInfo(data, offset = 0, end = data.length) {
    let _f0 = null; let _f1 = null; ...
    while (offset < end) {
        let _tag = data[offset++];
        ...
        switch (_tag) {
            case 10: { ... _f0 = ...; break }   // tag 10 => field 1, wire 2
            ...
        }
    }
    const _result = { "nick": _f0, "groupCard": _f1, ... };
    return _result;
}
```

三处信息必须同时读对，缺一处就会错：

1. **字段号** 来自 `case <tag>:`，`field = tag >> 3`；
2. **窄化方式** 来自赋值右侧：`_val` → uint32，`_val | 0` → **有符号** int32，
   `_val !== 0` → **布尔**，`BigInt(..)` → int64，`data.slice` → bytes，
   `__utf8Read` → string，`protobuf_decode_X` → 嵌套消息，`.push(..)` → repeated；
3. **属性名** 来自 `const _result = { ... }`，**按槽位下标**（`_f0`、`_f1` …）索引。

第 3 点是关键陷阱：**槽位下标并不总等于字段顺序**。手写时先按字段号写出「合理」的属性名，
正是这样把 4 条消息写错的——字段号全对，名字全错：

| 消息 | 错在哪 |
| --- | --- |
| `ExtraInfo` | 真名 `nick`/`groupCard`/`level`/`flags`/…，手写成 `field1`… |
| `NotOnlineImagePbReserve` | 真名 `subType`/`field3`/`summary`…，且字段在 1/3/4/8/10/20/30/31 |
| `NotOnlineImagePbReserve2` | 真名 `field1`…`field7`，字段号跳跃 |
| `CustomFacePbReserve` | 真实只有 `{1: subType, 9: summary}` |

因此字段表**全部由脚本生成**：

```bash
python3 work/msgpush/generate-tables.py --interfaces > work/msgpush/gen-interfaces.ts
python3 work/msgpush/generate-tables.py              > work/msgpush/gen-tables.ts
python3 work/msgpush/assemble-fields.py   # 拼装 ts/src/msg-push-fields.ts
```

`ts/src/msg-push-fields.ts` **不要手改**：每张表都带 `// <消息名> — reference L<行号>` 头注释，
每个字段带 `// L<行号>` 尾注释，改了就与参考脱钩。
`work/msgpush/schema-msgpush.txt` 是同一份数据的可读表（58 个解码器，逐字段行号）。
生成器覆盖 90 个消息（含嵌套闭包），0 个 `!!` 警告。

### 2.1 驱动器的语义（**不是** stock protobuf）

`decodeFields` 一个函数驱动全部 90 张表，复现的是参考实现的行为：

- 缺席字段是 **`null`**（不是 `undefined`，不是 proto3 默认值）；
- repeated 默认 `[]`；
- 64 位字段是 **`bigint`**；
- **已知字段以错误的 wire type 出现 → 落到 unknown 分支被跳过，不是报错**（参考对
  `field<<3|wire` 做 switch，tag 只是不匹配而已）；
- 未知字段跳过并计数（上限 64 条），从不拒绝。

---

## 3. 字段号「意外」清单

以下每一条都在参考实现里核实过，都是**违反 protobuf 惯例但不违反线格式**的地方。
照惯例「修正」它们会导致真实服务器数据解不出来。

| # | 消息 | 意外 | 行号 |
| --- | --- | --- | --- |
| 1 | `Elem` | 字段 7 **空缺**：`marketFace`(6) 之后直接是 `customFace`(**8**) | L123837 |
| 2 | `RichText` | `elems` 是字段 **2** 而不是 1；字段 1 空缺 | L123574 |
| 3 | `NotifyMessageBody` | `type`=1 但 `groupUin`=**4**；2、3 是别的东西 | L147288 |
| 4 | `FriendRequestInfo` | `newSource`=**5**，`message`=**10**；3、4、6..9 空缺 | L144783 / L144803 |
| 5 | `GeneralFlags` | `uin`=3(int64)、`longTextFlag`=**6**；4、5 空缺 | L128464 |
| 6 | `Ptt` | `groupFileKey`=**10**、`fileKey`=**14** | L129550 / L129570 |
| 7 | `ContentHead` | 7 之后跳到 **11**（`ntMsgSeq`）；8、9、10 空缺 | L123354 |
| 8 | `VideoFile` | 19 之后跳到 **24**（`pbReserve`） | L128302 |
| 9 | `NotOnlineFile` | 12 之后跳到 **50**，再 55 → 56 → 57 | L129276 |
| 10 | `SrcMsg` | `origSeqs` **同一字段号同时接受 packed(wire 2) 与 unpacked(wire 0)** | L128601 / L128583 |
| 11 | `SendRichText`（出站） | `elems`=2，与 `RichText` 对称（见 `docs/element-builder.md`） | — |

### 3.1 三种窄化形式不可混用

| 形式 | 语义 | 例子 | 错了会看到什么 |
| --- | --- | --- | --- |
| `_val` | **uint32** | `MarketFace.tabId`、`GroupMute.groupUin` | 大值正常，负值变正 |
| `_val \| 0` | **有符号 int32** | `FaceElem.index`、`VideoFile.fileSize`、`PushMsg.status` | 负值变 4294967295 |
| `_val !== 0` | **布尔** | `VideoFile.supportProgressive`、`NotOnlineImage.oldPicMd5` | 1 与 true 的差别 |

第 3 类只有 10 处，极易漏。手写版本把 `supportProgressive` 写成 `1`，差分测试第一轮就抓到。

### 3.2 varint 宽松规则

参考实现有**两套**溢出检查，不能混用：

- **tag / 长度**读取：`if (_s === 28 && _b > 15) throw` —— ~32 位上界；
- **值**读取（u32/i32/i64/bool）：`if (_s === 63 && _b > 1) throw` —— 64 位上界，
  **超过 32 位的部分被丢弃而不是拒绝**（`if (_s < 32) _val |= (_b & 127) << _s;`）。

10 字节 varint 合法（负 int32 就是这么编码的）。严格的 5 字节读取器会拒绝真实的服务器数据。
本移植**复用 `oidb/wire.ts` 的 `ProtoReader`**（同一个 lenient 实现，见 `docs/oidb.md` §5），
不重复实现一份。

---

## 4. `Elem` → 消息段（`convertElements`，L135276）

这是 OneBot 层真正读的一层。规则是**策略**，不是协议，所以逐条写明：

| 输入 | 输出 | 判定 |
| --- | --- | --- |
| `srcMsg` | `reply` | `origSeqs[0] > 0`；递归解码 `elemsRaw`；`sourceMsg` 中的文件名回填成 `file` 段 |
| `text` | `at` | 有可用 `attr6Buf`（长度 > 11）**或** mention `type` 为 1/2 |
| `text` | `text` | 否则；**若整条消息另有富内容（卡片/markdown/闪传）则抑制**（QQ 会把卡片标题重复成一个文本段） |
| `text` | （丢弃） | 回复后紧跟的空白分隔文本；旧客户端大表情兼容文本（按字节比对 `TextElem` 重编码结果） |
| `face` | `face` | `index >= 0` |
| `marketFace` | `mface` | **仅当 `faceId.length === 16`** |
| `notOnlineImage` / `customFace` | `image` | **仅当 md5 长度 16**；`md5Hex` 大写 |
| `videoFile` | `video` | 带 `mediaNode.type.type = 2` |
| `groupFile` / `transElem` | `file` | `transElem` 需 `elemType == 24`，长度是 **big-endian**（`val[1]<<8|val[2]`） |
| `commonElem` svc 2 | `poke` | `subType = businessType` |
| `commonElem` svc 3 | `image`(flash) | payload 是「varint 长度 + `NotOnlineImage`」 |
| `commonElem` svc 48 / biz 10,20 | `image` | NT 图；无 URL 时由 fileUuid 或 md5 合成 |
| `commonElem` biz 12,22 | `record` | 带 `mediaNode.type.type = 3` |
| `commonElem` biz 11,21 | `video` | 带 `mediaNode.type.type = 2` |
| `commonElem` svc 33 | `face` | `QSmallFaceExtra.faceId` |
| `commonElem` svc 37 | `face` | `QFaceExtra.qsid`（需 `Number.isSafeInteger` 且 ≥ 0） |
| `commonElem` svc 45 | `markdown` | biz 在 {1,3,4}；biz 3 且是闪传则转 `flash_file` |
| `richMsg` / `lightApp` | `json`/`xml`/`forward` | 见 §4.1 |

### 4.1 卡片解码（L134949–L135097）

卡片不是 protobuf：payload 是**一字节标记 + 内容**，不是 zlib magic 嗅探。

| 标记 | 含义 |
| --- | --- |
| `0x01` | 其后是 zlib 压缩，`maxOutputLength` 直接传给 zlib（防解压炸弹） |
| `0x00` | 其后是明文 UTF-8 |
| 其他 | **整段**都是明文 UTF-8 |

> 猜测成「zlib magic 嗅探」的写法会在 marker-1 上碰巧正确，在 marker-0 且首字符恰为 `0x78`
> 的卡片上解错——这是本移植最初写错的地方之一。

`richMsg` 按 `serviceId` 分派：35（或 serviceId 0 且根属性 `serviceID="35"`）→ `forward`，
带 `resId`（`m_resid`，或 `action="viewMultiMsg"` 且 `m_fileName` 匹配 UUID 模式时用文件名）；
1 → 必须是合法 JSON → `json`；其余 → `xml`，带 `subType = serviceId`。

### 4.2 图片去重（L135613–L135651）

同一张图可能同时以 legacy（`notOnlineImage`/`customFace`）和 NT（`commonElem` svc 48）
两种形式到达。legacy 的 `gchat.qpic.cn` URL 常已失效，NT 的 `multimedia.nt.qq.com.cn` 可用。
策略是**保留 NT、丢弃 legacy 兄弟**，但只在能证明「同一个文件」时才丢
（`fileId` 相同或 `md5Hex` 相同），避免误删另一张图。

---

## 5. 事件

`PkgType` / `Event0x2DCSubType` / `Event0x210SubType` 的取值全部来自 `enums.ts`（L143080–L143223）。

### 5.1 完整解码

| 事件 | PkgType | subType | 解码器 | 行号 |
| --- | --- | --- | --- | --- |
| 群消息 | 82 | — | `decodeGroupMessage` | L153924 |
| 私聊消息 | 166 / 9 / 208 / 529 | — | `decodeFriendMessage` | L151742 |
| 群临时会话 | 141 | — | `decodeTempMessage` | L153956 |
| 群撤回 | 732 | 17 | `decodeGroupRecall` | L149461 |
| 群禁言 | 732 | 12 | `decodeGroupMute` | L149446 |
| 群戳一戳 | 732 | 20 | `decodeGroupGreyTip` | L149479 |
| 好友申请 | 528 | 35 | `decodeFriendRequest` | L146626 |
| 好友撤回（双向） | 528 | 138 / 139 | `decodeFriendRecall` | L146640 |
| 加好友成功 | 528 | 179 / 226 | `decodeNewFriend` | L146655 |
| 好友戳一戳 | 528 | 290 | `decodeFriendPoke` | L146703 |

三条容易踩的语义：

1. **自己发的私聊消息**：`fromUin === selfUin`，会话对端在 `responseHead.toUin`。
   用 `fromUin` 会把机器人自己的消息记成「和机器人自己对话」。
2. **UID 解析不到就是 0**，不是随便找个 uin 顶上（`resolveUidToUin` L122224 的注释明说
   「miss is unresolved (0), decoder must not invent a UIN」）。发给 0 的事件找不到人。
3. **永久禁言**：线上 `duration` 是 `4294967295`，OneBot 用 `2147483647` 表示同一含义。

### 5.2 明确 acknowledge 后丢弃（与参考一致，不是未实现）

| subType | 原因 |
| --- | --- |
| 528/38 `GroupAppStatePush` | QQ 客户端的群小程序角标/未读数状态推送，无 OneBot 事件对应 |
| 528/380 `UnmappedClientState380` | QQ NT 客户端状态推送，Lagrange 系各实现也都不映射 |

静默返回 `[]` 是刻意的：参考实现在这里返回 `[]` 只是为了「别在未知日志里刷屏」，
本移植把原因写在此表而不是日志里，以便区分「已确认丢弃」与「没做」。

### 5.3 骨架（返回 `[]`，未移植）

`0x2DC` 的 16（群表情回应）与 21（群精华）；`0x210` 的 39（名片赞）、61（语音转文字结果）、
277（输入状态）、349（在线设备）、364（好友备注同步）；以及 PkgType 的
33/34（群成员增减）、44（群管理变更）、84（加群申请）、85（自助入群）、87（群邀请）、525（受邀入群）。
另加 `commonElem` 的 inline_keyboard（svc 46/50/51）与 `flash_file` 的完整字段（只解出标识）。

---

## 6. 如何证明（可执行）

### 6.1 差分测试：与**运行中的**参考实现逐字段对比

`work/msgpush/region-export.mjs` 是把参考实现 121794–154109 行抽出来做成的**可运行模块**
（74 个导出，依赖用 `stubs.mjs` 补齐）。`work/msgpush/compare.mjs` 把同一份字节同时喂给
参考解码器和本移植，做结构比较（`Uint8Array` 比内容、`bigint` 比数值、键集合不同即失败）。

```
$ node work/msgpush/compare.mjs
16/16 matched
```

覆盖：`TextElem`、`FaceElem`、`MarketFace`、`TransElem`、`RichMsg`、`GroupFileElem`（int64 大小）、
`VideoFile`、`GeneralFlags`、`CustomFace`（34 字段含 pbRes）、`SrcMsg`（packed 与 unpacked 两种）、
`RichText.elems`=2、`Elem` 跳过字段 7、未知字段（含 fixed32/fixed64/group）、
`ContentHead.msgId` 的 10 字节负 varint。

### 6.2 往返测试：`element-builder` → `msg-push`

**这是主要的正确性证明**（`ts/test/msg-push.test.ts`，55 项全绿）：

```
$ cd ts && npx tsc -p tsconfig.json && node --test build/test/msg-push.test.js
# pass 55
# fail 0
```

思路：用 `element-builder.ts`（其字段号已被参考字节 fixture 钉住）编码一个 `Elem`，
用本模块解码，要求还原。因为编码侧的字段号本身有独立证据，往返一致就把解码侧的字段号也钉住了，
不必为每个字段手写一份期望值。

事件层测试则用手写 fixture 断言**策略**，每条都在注释里标了对应行号——手写 fixture 里
字段号写错的概率很高，写作过程中就被抓到 6 处（`recall`=11、`recallMessages`=3、
`generalGrayTip`=26、`msgTemplParam`=7、`GroupMute.data`=5、`GroupMuteState` 字段顺序），
全部以生成的字段表为准修正。这本身也是「手写会错」的一个实证。

### 6.3 全量测试

```
$ cd ts && npm test          # 全仓
# tests 259 / pass 257 / fail 0 / skipped 2
```
（2 项 skipped 是 `rtti.test.js`，它会挂起；与本模块无关。本模块自身 55 项见 §6.2。）

---

## 7. 已知未覆盖

| 未覆盖 | 影响 | 说明 |
| --- | --- | --- |
| `parseMsgPush`（L177162） | 无 | 它在 154110 之后的 region，不在抽取范围内 |
| 群成员增减 / 群管理 / 加群申请 / 群邀请 | 对应 OneBot notice 拿不到 | 见 §5.3 |
| inline_keyboard / flash_file 完整字段 | 这两类消息段退化成 `[]` / 只有标识 | 不在 228-action 主路径上 |
| 历史消息拉取（L154110 / 169717） | — | `buildContextFromMessage` 已移植，可用于同一路解码 |
| sysmsg 去重（L154039） | 未做 | 重复撤回等可能重复上报 |

`$4` 与 `$5` 两个解码器变体在本区内**逐字段相同**（实测 0 处差异）：`$4` 供
`rich-body-decoder` 使用，`$5` 供 `convertElements` 使用，因此只移植一份。

---

## 8. 文件分工

| 文件 | 角色 | 手改 |
| --- | --- | --- |
| `ts/src/msg-push-fields.ts` | 90 张字段表 + 90 个解码器（生成） | **不要** |
| `ts/src/msg-push.ts` | 消息段模型、`convertElements`、卡片、事件、registry（手写） | 可以 |
| `work/msgpush/generate-tables.py` | 从 `reference/index.mjs` 抽取字段表 | 可以 |
| `work/msgpush/assemble-fields.py` | 幂等拼装 `msg-push-fields.ts` | 可以 |
| `work/msgpush/compare.mjs` | 差分测试 | 可以 |
| `ts/test/msg-push.test.ts` | 往返 + 事件测试 | 可以 |
