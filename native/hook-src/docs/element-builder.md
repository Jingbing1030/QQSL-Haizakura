# element-builder：消息段 → protobuf 编码层

> 本文对应 `ts/src/element-builder.ts`，是从 `reference/index.mjs` 逆向重写的产物。
> 所有字段号、wire type、省略条件均**逐条从参考实现的写码函数中读出**，不是按 protobuf
> 惯例猜的；文末「字节级验证」一节记录了如何证明这一点。

---

## 1. 参考实现的位置

`element-builder` 在 `reference/index.mjs` 里是**一段连续代码**，不含跨 region 的碎片：

| 内容 | 行号 | 规模 |
| --- | --- | --- |
| `//#region ../protocol/src/element-builder.ts` | **110973** | 起点 |
| 该 region 的 `//#endregion` | **121793** | 终点（紧跟 `encodePrivateRichText`） |
| 上一 region（`highway/ptt-upload.ts`） | 110768–110972 | 不属本任务 |
| 下一 region（`msg-push/helpers.ts`） | 121794 起 | 不属本任务 |
| 配套 `../protocol/src/element-manifest.ts` | **6371–6904** | 类型清单与字段白名单 |

判定依据：`grep -n "^//#region" reference/index.mjs`。region 内共 108 个顶层函数。

### 1.1 逐个函数的行号对照

| 参考函数 | 行号 | 本文对应 |
| --- | --- | --- |
| `protobuf_encode_Elem` | 111206 | `encodeElem` |
| `__size_Elem$2` / `__write_Elem$2` | 111212 / 111351 | `encodeElem`（合并为单趟写入） |
| `__size/_write_TextElem$2` | 112010 / 112052 | `encodeTextElem` |
| `__size/_write_FaceElem$2` | 112221 / 112243 | `encodeFaceElem` |
| `__size/_write_OnlineImage$2` | 112327 / 112349 | `Elem.onlineImage`（占位，见 §4） |
| `__size/_write_NotOnlineImage$2` | 112436 / 112620 | `encodeNotOnlineImage` |
| `__size/_write_TransElem$2` | 112914 / 112930 | `encodeTransElem` |
| `__size/_write_MarketFace$2` | 112980 / 113064 | `encodeMarketFace` |
| `__size/_write_CustomFace$2` | 113408 / 113625 | `encodeCustomFace` |
| `__size/_write_RichMsg$2` | 114532 / 114566 | `encodeRichMsg` |
| `__size/_write_GroupFileElem$2` | 114702 / 114762 | `encodeGroupFileElem` |
| `__size/_write_ExtraInfo$2` | 114992 / 115064 | `encodeExtraInfo` |
| `__size/_write_VideoFile$2` | 115359 / 115481 | `encodeVideoFile` |
| `__size/_write_GeneralFlags$2` | 115985 / 116016 | `encodeGeneralFlags` |
| `__size/_write_SrcMsg$2` | 116126 / 116188 | `encodeSrcMsg` |
| `__size/_write_LightAppElem$2` | 116441 / 116457 | `encodeLightAppElem` |
| `__size/_write_CommonElem$2` | 116516 / 116538 | `encodeCommonElem` |
| `protobuf_encode_SendRichText` | 117360 | `encodeSendRichText` |
| `protobuf_encode_QFaceExtra` | 119231 | `encodeQFaceExtra` |
| `protobuf_encode_MarkdownData` | 119493 | `encodeMarkdownData` |
| `protobuf_encode_GroupFileExtra` | 120128 | `encodeGroupFileExtra` |
| `protobuf_encode_GroupFileInfo` | 120215 | `encodeGroupFileInfo` |
| `protobuf_encode_QSmallFaceExtra` | 120975 | `encodeQSmallFaceExtra` |
| `protobuf_encode_MentionExtraSend` | 121079 | `encodeMentionExtraSend` |
| `protobuf_encode_PokeExtra` | 121209 | `encodePokeExtra` |
| `protobuf_encode_MarketFacePbReserve` | 121245 | `encodeMarketFacePbReserve` |
| `makeTextElem` | 121367 | `makeTextElem` |
| `makeFaceElem` | 121370 | `makeFaceElem` |
| `resolveMentionDisplay` | 121397 | `resolveMentionDisplay` |
| `makeMentionElem` | 121407 | `makeMentionElem` |
| `makeReplyElem` | 121427 | `makeReplyElem` |
| `makeReplyMentionElem` | 121435 | `makeReplyMentionElem` |
| `makeDeflatedPayload` | 121453 | `makeDeflatedPayload` |
| `makeJsonElem` | 121460 | `makeJsonElem` |
| `makeXmlElem` | 121463 | `makeXmlElem` |
| `makeMarkdownElem` | 121470 | `makeMarkdownElem` |
| `makePokeElem` | 121477 | `makePokeElem` |
| `makeMarketFaceElem` | 121495 | `makeMarketFaceElem` |
| `escapeXml` / `xmlPreviewText` / `escapeForwardPreview` | 121538 / 121540 / 121544 | 同名私有函数 |
| `makeForwardElem` | 121521 | `makeForwardElem` |
| `md5BytesFromHex` | 121566 | `md5BytesFromHex` |
| `fingerprintsFromEncodedMsgInfo` | 121571 | **未实现**（需 `MsgInfo` 解码器，属 msg-push） |
| `makeLegacyForwardImageElem` | 121593 | `makeLegacyForwardImageElem` |
| `makeImageElem` | 121617 | `makeImageElem` |
| `makePttElem` | 121633 | `makePttElem` |
| `makeGroupFileElem` | 121667 | `makeGroupFileElem` |
| `makeVideoElem` | 121698 | `makeVideoElem` |
| `buildSendContent` | 121713 | `buildSendContent` |
| `buildSendElems` | 121783 | `buildSendElems` |
| `encodePrivateRichText` | 121786 | `encodePrivateRichText` |

---

## 2. 消息段类型清单

`element-manifest.ts` 是权威：它同时是参考实现自己的校验表，其 `directions.W`（发送）
一列与 `buildSendContent` 的 `switch` **逐字对齐**。

### 2.1 全部 16 种

| # | 类型 | D 解码 | S 上报 | P 解析 | **W 发送** | 本文件 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `text` | yes | yes | yes | yes | ✅ `makeTextElem` |
| 2 | `at` | yes | yes | yes | yes | ✅ `makeMentionElem` |
| 3 | `face` | yes | yes | yes | yes | ✅ `makeFaceElem` |
| 4 | `reply` | yes | yes | yes | yes | ✅ `makeReplyElem` (+`makeReplyMentionElem`) |
| 5 | `json` | yes | yes | yes | yes | ✅ `makeJsonElem` |
| 6 | `xml` | yes | yes | yes | yes | ✅ `makeXmlElem` |
| 7 | `forward` | yes | yes | yes | yes | ✅ `makeForwardElem` |
| 8 | `image` | yes | yes | yes | yes | ✅ `makeImageElem`（仅信封） |
| 9 | `record` | yes | yes | yes | yes | ✅ `makePttElem`（仅信封） |
| 10 | `video` | yes | yes | yes | yes | ✅ `makeVideoElem`（仅信封） |
| 11 | `mface` | yes | yes | yes | yes | ✅ `makeMarketFaceElem` |
| 12 | `file` | yes | yes | yes | yes | ✅ `makeGroupFileElem`（仅 forward 路径） |
| 13 | `poke` | yes | yes | yes | yes | ✅ `makePokeElem` |
| 14 | `markdown` | yes | yes | yes | yes | ✅ `makeMarkdownElem` |
| 15 | `inline_keyboard` | yes | yes | **no** | **no** | ❌ 见 §2.2 |
| 16 | `flash_file` | yes | yes | by-design-no | **by-design-no** | ❌ 见 §2.2 |

**覆盖率：14 / 16 可发送类型全覆盖。**
两个未覆盖者不是遗漏 —— 参考实现本身就不在 `buildSendContent` 里给它们 case：

- **`inline_keyboard`**：manifest 明确 `W: "no"`，注释写「当前仅解码并上报，不支持作为普通消息发送」。
- **`flash_file`**：manifest 明确 `W: "by-design-no"`，走独立 action `send_flash_msg`；
  参考的校验码对它会给出专门错误：「use the send_flash_msg Action instead」。

两者都在本文件里以 `UNENCODED_SEGMENT_TYPES` **显式登记**并附原因，调用方拿到的是
`UNSENDABLE_TYPE` 而不是含糊的「未知类型」。

### 2.2 三个媒体类型的边界

`image` / `record` / `video` 的 `pbElem` 是 NTV2 highway 上传产出的 `MsgInfo`，
而上传代码**不在**本 region 内：

| 上传函数 | 行号 | 所在 region |
| --- | --- | --- |
| `uploadImageMsgInfo` | 110501 | `highway/image-upload.ts` |
| `uploadPtt` | 110879 | `highway/ptt-upload.ts` |
| `uploadVideoMsgInfo` | 37622 | `highway/video-upload.ts` |

因此本文件只负责**信封**：把已上传的 `MsgInfo` 装进
`commonElem{serviceType:48, businessType, pbElem}`。这不是简化 —— 参考实现的
`makeImageElem` / `makePttElem` / `makeVideoElem` 在拿到 `msgInfo` 之后做的也正是这件事。
上传由调用方通过 `SendContext.uploadMedia` 注入，属 `highway` 任务的产出。

---

## 3. protobuf 字段映射表

格式：`字段号 wire_type 名称 (类型, 省略条件)`。
"省略条件" 即参考实现的 `__size_*` 里那条 `if`，默认值不写是 proto3 语义，
**必须照抄**，否则字节与线上实现不一致。

### 3.1 `Elem`（外层容器，reference 111206）

| 字段 | wire | 名称 | 备注 |
| --- | --- | --- | --- |
| 1 | 2 | `text` | TextElem |
| 2 | 2 | `face` | FaceElem |
| 3 | 2 | `onlineImage` | 发送路径**从不**构造 |
| 4 | 2 | `notOnlineImage` | 转发路径的 legacy 图片 |
| 5 | 2 | `transElem` | 群文件 |
| 6 | 2 | `marketFace` | 商城表情 |
| **7** | — | **缺号** | 参考实现的 writer 里确实没有 field 7，不要"修"成 8 |
| 8 | 2 | `customFace` | 转发路径的 legacy 图片（群） |
| 12 | 2 | `richMsg` | xml / forward 卡片 |
| 13 | 2 | `groupFile` | 收侧；发送走 transElem(24) |
| 16 | 2 | `extraInfo` | 发送路径不写 |
| 19 | 2 | `videoFile` | 收侧 |
| 37 | 2 | `generalFlags` | 发送路径不写 |
| 45 | 2 | `srcMsg` | 引用回复 |
| 51 | 2 | `lightApp` | JSON 卡片 |
| 53 | 2 | `commonElem` | 服务分发信封 |

> 45 与 53 是多字节 tag：`45<<3|2 = 362 → ea 02`，`53<<3|2 = 426 → aa 03`。

### 3.2 `TextElem`（112010）与 `MentionExtraSend`（121079）

| 字段 | wire | 名称 | 省略条件 |
| --- | --- | --- | --- |
| 1 | 2 | `str` | `!== ""` |
| 2 | 2 | `link` | `!== ""` |
| 3 | 2 | `attr6Buf` | `length > 0` |
| 4 | 2 | `attr7Buf` | `length > 0` |
| 11 | 2 | `buf` | `length > 0` |
| 12 | 2 | `pbReserve` | `length > 0`，**@ 提及就装在这里** |

`MentionExtraSend` 的字段号是 **3 / 4 / 5 / 9**，不是 1/2/3：

| 字段 | wire | 名称 | 说明 |
| --- | --- | --- | --- |
| 3 | 0 | `type` | 1 = @全体，2 = @单人 |
| 4 | 0 | `uin` | @全体时为 0 |
| 5 | 0 | `field5` | 恒为 0 |
| 9 | 2 | `uid` | @全体时为字面量 `"all"` |

### 3.3 `FaceElem` / `QSmallFaceExtra` / `QFaceExtra`

`FaceElem`（112221）：`1 wire0 index`、`2 wire2 oldData`、`11 wire2 buf`。
注意 **`index` 是 varint 而非字符串**。

`QSmallFaceExtra`（120975，serviceType 33）：`1 wire0 faceId`、`2/3 wire2 preview/preview2`。

`QFaceExtra`（119231，serviceType 37）：

| 字段 | wire | 名称 | 说明 |
| --- | --- | --- | --- |
| 1 | 2 | `packId` | **字符串**（超 2^31） |
| 2 | 2 | `stickerId` | **字符串** |
| 3 | 0 | `qsid` | 即 faceId |
| 4 | 0 | `sourceType` | 恒 1 |
| 5 | 0 | `stickerType` | |
| 6 | 2 | `resultId` | |
| 7 | 2 | `text` | |
| 9 | 0 | `randomType` | 恒 1 |

三种 face 编码（`makeFaceElem`，121370）：

| 条件 | 编码 | businessType |
| --- | --- | --- |
| 目录中 `aniStickerType > 0` | `commonElem{37, QFaceExtra}` | `stickerType < 4 ? stickerType : 1` |
| 未命中且 `faceId >= 260` | `commonElem{33, QSmallFaceExtra}` | 1 |
| 未命中且 `faceId < 260` | `face{index}` | — |

### 3.4 `SrcMsg`（116126）—— 引用回复

| 字段 | wire | 名称 | 类型 |
| --- | --- | --- | --- |
| 1 | 0 | `origSeqs` | **repeated uint32**（每个元素一个 tag） |
| 2 | 0 | `senderUin` | uint64（bigint） |
| 3 | 0 | `time` | uint32 |
| 4 | 0 | `flag` | uint32 |
| 5 | 2 | `elemsRaw` | **repeated bytes**（每元素 tag+len+数据） |
| 6 | 0 | `type` | uint32 |
| 7 | 2 | `richMsg` | bytes |
| 8 | 2 | `pbReserve` | bytes |
| 9 | 2 | `sourceMsg` | bytes |
| 10 | 0 | `toUin` | uint64 |
| 11 | 2 | `troopName` | bytes |

`origSeqs` 是 wire 0、`elemsRaw` 是 wire 2 —— 两者混淆会让 QQ 接受消息却引用空内容。

### 3.5 `RichMsg` / `LightAppElem`（卡片）

| RichMsg (114532) | wire | | LightAppElem (116441) | wire |
| --- | --- | --- | --- | --- |
| 1 `template1` | 2 | | 1 `data` | 2 |
| 2 `serviceId` | 0 | | 2 `msgResid` | 2 |
| 3 `msgResId` | 2 | | | |
| 4 `rand` | 0 | | | |
| 5 `seq` | 0 | | | |

两者的 payload 都是 **`0x01` 前缀 + deflate 压缩**（`makeDeflatedPayload`，121453）。
前缀标记是必需的：缺了它客户端把卡片渲染成空白而不是报错。

### 3.6 `CommonElem`（116516）+ 服务类型表

| 字段 | wire | 名称 |
| --- | --- | --- |
| 1 | 0 | `serviceType` |
| 2 | 2 | `pbElem` |
| 3 | 0 | `businessType` |

| serviceType | 含义 | 内层消息 | businessType |
| --- | --- | --- | --- |
| 2 | 窗口抖动 | `PokeExtra{1 type}` | = pokeType |
| 33 | 小表情 | `QSmallFaceExtra` | 1 |
| 37 | 超级表情 | `QFaceExtra` | 见 §3.3 |
| 45 | markdown | `MarkdownData{1 content}` | 1 |
| 48 | NT 媒体 | `MsgInfo` | 群 20/22/21，C2C 10/12/11 |

`serviceType 48` 的 businessType 是**三对**，不可混用（121617/121633/121698）：

| 类型 | 群 | C2C |
| --- | --- | --- |
| image | **20** | **10** |
| record | **22** | **12** |
| video | **21** | **11** |

### 3.7 `MarketFace`（112980）与固定常量

| 字段 | wire | 名称 | 发送时的值 |
| --- | --- | --- | --- |
| 1 | 2 | `faceName` | `text` |
| 2 | 0 | `itemType` | **恒 6** |
| 3 | 0 | `faceInfo` | **恒 1** |
| 4 | 2 | `faceId` | `emojiId` **转成的原始字节**（非 hex 字符串） |
| 5 | 0 | `tabId` | `emojiPackageId` |
| 6 | 0 | `subType` | **恒 3** |
| 7 | 2 | `key` | `emojiKey` |
| 8 | 2 | `param` | |
| 9 | 0 | `mediaType` | |
| 10 | 0 | `imageWidth` | **恒 300** |
| 11 | 0 | `imageHeight` | **恒 300** |
| 12 | 2 | `mobileParam` | |
| 13 | 2 | `pbReserve` | `MarketFacePbReserve{8:1}` |

这些常量照抄 NapCat `PacketMsgMarkFaceElement.buildElement`，是服务端把表情转发出去的条件。

### 3.8 `TransElem`（112914）与群文件

`1 wire0 elemType`（发送恒 **24**）、`2 wire2 elemValue`。

`elemValue` 的结构（`makeGroupFileElem`，121667）：

```
0x01 | BE16(len) | GroupFileExtra
```

⚠️ 长度是**大端**，与文件里其它所有小端编码相反；参考实现限制 `len <= 65535`。

`GroupFileExtra`（120128）/ `GroupFileExtraInner`（120206）/ `GroupFileInfo`（120215）：

| GroupFileExtra | wire | | Inner | wire | | FileInfo | wire |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 `field1` | 0 | | 2 `info` | 2 | | 1 `busId` | 0 |
| 2 `fileName` | 2 | | | | | 2 `fileId` | 2 |
| 3 `display` | 2 | | | | | 3 `fileSize` | 0 (uint64) |
| **7** `inner` | 2 | | | | | 4 `fileName` | 2 |
| | | | | | | 5 `field5` | 0 |
| | | | | | | 6 `fileSha` | 2 |
| | | | | | | 7 `extInfoString` | 2 |
| | | | | | | 8 `fileMd5` | 2 |

发送时 `field1 = 6`、`busId = 102`。

> ⚠️ 群文件在**实时发送**时**不能**用 `transElem(24)` —— QQ-NT 服务端返回 `result=79`。
> 实时发送走 OIDB `0x6d9_4`；`transElem(24)` 只用于长消息（转发/多消息）上传内部。

### 3.9 其余消息（发送路径不构造，字段表备查）

| 消息 | 行号 | 字段（号/wire/名） |
| --- | --- | --- |
| `NotOnlineImage` | 112436 | 1/2 filePath, 2/0 fileLen, 7/2 picMd5, 8/0 picHeight, 9/0 picWidth, 13/0 original, **20/0 oldPicMd5（仅在 `=== true` 时写常量 1）** |
| `CustomFace` | 113408 | 2/2 filePath, 13/2 md5, 22/0 width, 23/0 height, 25/0 size |
| `VideoFile` | 115359 | 1/2 fileUuid, 2/2 fileMd5, 3/2 fileName, 4/0 fileFormat, 6/0 fileSize, 16/0 fileWidth, 17/0 fileHeight |
| `ExtraInfo` | 114992 | 1/2 nick, 2/2 groupCard, 3/0 level … 12/0 newGroupFlag |
| `GroupFileElem` | 114702 | 1/2 filename, 2/0 fileSize, 3/2 fileId … 10/2 pbReserve |
| `GeneralFlags` | 115985 | 1/0 bubbleDiyTextId, 2/0 groupFlagNew, 3/0 uin, 6/0 longTextFlag, 7/2 longTextResId |
| `MarkdownData` | 119493 | 1/2 content, 2/2 field2, 3/2 field3, 4/2 processMsg, 5/2 summary, 6/0 extType, 7/2 extInfo |

`OnlineImage`（112327）在参考实现里有编解码对，但**发送路径从不构造它**（对端图片一律是
`notOnlineImage`）。本文件把它保留为字段 3 的占位类型而不是删除，以免 `Elem` 的字段号
看上去像是连号。

### 3.10 `SendRichText`（117360）

`2 wire2 elems`（repeated Elem）。**字段 2，不是 1。**

---

## 4. 私有消息的语音兼容块

`encodePrivateRichText`（121786）的返回值不是单纯的 `SendRichText`：

```
SendRichText{elems} || Anonymous{ptt}
```

是**字节拼接**，不是嵌套。触发条件是：`scene === "direct-private"` 且该消息**恰好一条**
`record`。若上传返回的兼容块里没有 `Anonymous.ptt`（field 4），参考实现直接报错
`private voice upload returned incomplete playback information` —— 宁可失败也不发半条。

本文件用 `anonymousHasPtt()` 只扫这一个字段，不做完整 `Anonymous` 解码。

---

## 5. 校验规则（element-manifest.ts 的 W 方向部分）

| 规则 | 参考行号 | 本文件 |
| --- | --- | --- |
| 未知字段 → `UNEXPECTED_FIELD` | 6896 | `SEGMENT_FIELDS` 白名单 |
| 未知类型 → `UNKNOWN_TYPE` | 6890 | `assertValidSegment` default 分支 |
| 不支持发送 → `UNSENDABLE_TYPE` | 6891 | `UNENCODED_SEGMENT_TYPES` |
| 必填字段缺失 → `MISSING_FIELD` | 6895 | 各 builder 的前置判断 |
| `md5Hex` 必须 32 hex / `sha1Hex` 必须 40 hex | 6855-6859 | `assertValidSegment` |
| `text`/`xml`/`markdown` 非空；`json` 必须是 JSON **对象** | 6861-6882 | `assertValidSegment` |
| `replySeq` 必须正整数 | 6884 | `assertValidSegment` |
| `faceId` 非负整数；`large:false` 与 `resultId` 互斥 | 6873-6880 | `assertValidSegment` + `makeFaceElem` |
| video 只能单独成条 | 6383 `assertVideoSendPolicy` | 同名函数 |
| poke 只能私聊且单独成条 | 6375 `assertWindowShakeSendPolicy` | 同名函数 |
| 媒体段必须有 `SendContext` | 121719 | `buildSendContent` 预检 |
| `file` 段必须走 forward 路径 | 121720 | `buildSendContent` 预检 |

---

## 6. 字节级验证

字段号是这次逆向的全部知识，所以必须证明它抄对了，而不是靠肉眼比对。

做法：把参考 region 抽成可执行模块，用同一批输入跑参考实现，把输出当作 fixture。

1. 抽取 region：`sed -n '110973,121793p' reference/index.mjs > region.mjs`
2. 补 12 个外部依赖的最小桩（`createLogger`/`hexToBytes`/`deflateSync`/`randomUUID`/
   `MessageElementValidationError`/三个 `assert*`/`sysFaceStore`/三个 `upload*`）
3. 跑参考实现，得到 **37 条 hex fixture**（含 1 条数组）
4. 跑本文件，逐条比对

结果：**37 / 37 全部逐字节相同**，包含

- `text`（ASCII / 中文 / 空串）
- `face` 三种编码（classic / small / super）
- `at`（@单人 / @全体 / 无身份回退）
- `reply`（裸引用 / 带发送者+时间+引用文本）
- `json` / `xml` / `markdown` / `poke` / `mface`
- `forward`（XML 卡片；`randomUUID` 需固定才能比对）
- `groupFile`（含大端长度头）
- `SendRichText` 与完整 dispatch 顺序
- `encodePrivateRichText`
- 各独立消息编码器（`QFaceExtra` / `QSmallFaceExtra` / `MentionExtraSend` /
  `PokeExtra` / `MarketFacePbReserve` / `MarkdownData` / `GroupFileExtra`）

这些 fixture 全部写进了 `ts/src/element-builder.test.ts`（32 个 test，全绿）。

---

## 7. 已知未覆盖 / 已知差异

| 项 | 原因 | 影响 |
| --- | --- | --- |
| `inline_keyboard` / `flash_file` | 参考实现不支持发送 | 无，调用方拿到明确的 `UNSENDABLE_TYPE` |
| `fingerprintsFromEncodedMsgInfo`（121571） | 依赖 `MsgInfo` 解码器，属 msg-push | 转发图片少了「从 MsgInfo 反推 md5」这一路；显式调用方仍可传 `md5Hex` |
| 媒体上传本体 | 在 `highway/*`，不在本 region | 由 `SendContext.uploadMedia` 注入 |
| `OnlineImage` 编码 | 发送路径不用 | `Elem.onlineImage` 是占位，写入时给出零长度 body |
| 单趟写入 vs 参考的两趟 | 实现选择，非行为差异 | §6 已证字节完全相同 |

---

## 8. 与参考实现的三处实现差异（均不改变字节）

1. **单趟写入**。参考实现先 `__size_*` 再 `__write_*`，用 slot 表传嵌套长度。本文件用
   可增长缓冲一次性写完 —— 少一遍遍历，也没有"两趟不一致"这类 bug 的空间。字段仍按
   升序写，故字节序相同。
2. **`SendContext` 收窄**。参考实现的 `bridge` 是个大对象（账号状态、highway 客户端、
   缓存）。这里只保留本模块真正用到的四个调用（`findGroupMember` / `findFriend` /
   `resolveUid` / `recallUploadedFile`）+ `uploadMedia`，使 builder 可在无 QQ 会话时测试。
3. **`makeForwardElem` 多一个 `generateUuid` 参数**，只为测试固定 `uniseq`；生产调用不传，
   行为与参考实现的 `randomUUID()` 一致。

---

## 9. 测试

```bash
cd ts
npm run build                 # tsc 类型检查
node --test build/test/element-builder.test.js
```

32 个 test，分两类：

- **字节 fixture（11 个 test，覆盖 37 条 fixture）** —— 断言与参考实现完全相同
- **行为（21 个 test）** —— 校验、错误码、face 分类、媒体 businessType、转发 legacy sibling、
  语音兼容块、reply 附带 mention、字段省略

`npm run build` 全量通过。全仓 `npm test`：117 test / 115 pass / **0 fail** / 2 skip
（skip 的是 `cross-language.test.ts`，需要 `HZ_ADDON`/`HZ_PID` 等真机环境变量）。
