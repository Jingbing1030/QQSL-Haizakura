# The NTV2 rich-media upload request — byte-exact codec spec

Scope: `NTV2UploadRichMediaReq`, the OIDB request (`0x11c4`/`0x11c5`/`0x11e9`/`0x11ea`/`0x126d`/`0x126e`,
**sub-command 100**) that asks QQ's server for a highway upload session for images, voice and
video — plus the `NTV2RichMediaHighwayExt` blob that goes inside each highway chunk's
`bytesReqExtendInfo`.

Evidence grades used throughout:

| grade | meaning |
| --- | --- |
| 【实测】 | I ran it in this session and the output is quoted verbatim |
| 【指令级】 | static reading of `reference/index.mjs` / `ts/src/`, line numbers given |
| 【推断】 | inference from naming, structure or protocol convention |
| 【未确认】 | nobody has verified this; do not build on it |

`reference/index.mjs` was **not modified**. No `tsc`, no `node --test`, nothing under `ts/src/`
was touched (shared `build/`). All harness code lives in `/tmp/codec/`.

---

## 0. How the field numbers in this document were established

**They were not read by hand.** Every table below was *generated* from the reference's own
`__write_` functions, and then **proven by round-trip**: I built an independent, schema-driven
protobuf encoder that knows nothing but the extracted field numbers / wire types / presence
guards, and checked it reproduces the reference's bytes exactly.

### 0.1 Extraction

`/tmp/codec/schema2.mjs` does this, per message:

1. `extractFn('__write_<Name>')` — slice the flat ESM bundle at column-0 `function` … column-0 `}`.
2. Read the `const _fN = obj["<key>"];` prologue to learn each field's **name** and **declaration order**.
3. Read the literal tag bytes: `buf[offset++] = 8` → field 1 varint; `= 18` → field 2 length-delimited.
   **Multi-byte tags are accumulated and varint-decoded** — this matters: `168, 6` is
   `0xa8 0x06` → tag `0xA8`… `0x2A8` = **808** → field **101**, *not* field 21. Half the fields in
   `NTV2UploadSceneInfo` and `PicExtBizInfo` are only correct if you do this.
4. Read the matching `__size_<Name>` function for the **presence guard** of each field, because
   proto3 default-elision is part of the byte contract (`_f0 != null && _f0 !== 0`,
   `_f1 === true`, `_f2 != null && _f2.length > 0`, `_f3 != null` …).
5. Classify the payload by the code that follows the tag: a `offset = __write_X(...)` call is a
   nested message, `sizes[sizes[0]++]` + `buf.set` is raw bytes, `__utf8Write` is a string.

### 0.2 Evaluation

The reference region `:23589`–`:30044` (`ntv2-upload-request.ts`) is **self-contained**: stubbing
only `init_ffmpeg_addon()` makes it import cleanly as an ES module, with its own `$129` utf8
helpers, `$131` allocator and `$50` varint64 helpers. Same for the highway-client protobuf region
`:30048`–`:33966` (`$128`/`$130`/`$49`) and `NotOnlineImagePbReserve` (`:109864`–`:110238`, `$89`/`$91`).

```bash
# what I actually ran
node /tmp/codec/gen.mjs      # → /tmp/codec/region.mjs     (57 exports, imports OK)
node /tmp/codec/gen2.mjs     # → /tmp/codec/highway.mjs    (45 exports, imports OK)
node /tmp/codec/gen3.mjs     # → /tmp/codec/pbreserve.mjs  (imports OK)
node /tmp/codec/crosscheck2.mjs
```

### 0.3 The proof

【实测】`node /tmp/codec/crosscheck2.mjs`:

```
minimal        ref=  34B  reimpl=  34B  MATCH
groupImage     ref= 228B  reimpl= 228B  MATCH
privateImage   ref= 276B  reimpl= 276B  MATCH
highwayExtend  ref= 447B  reimpl= 447B  MATCH

*** ALL SCHEMAS PROVEN BY ROUND-TRIP ***
```

`ref` is `protobuf_encode_OidbBase__NTV2UploadRichMediaReq` evaluated from the bundle; `reimpl` is
my generic encoder fed only the tables in §2 and §4. Byte-identical on all four. **A wrong field
number cannot survive this check**, which is the whole point — that is how the previous port's two
bad field numbers would have been caught in seconds.

---

## 1. The golden vectors

These go straight into a test file. All five are 【实测】, produced by the reference's own encoders.

> **`reserved` is 1, not 0.** `Ntv2UploadRequest.uinForm = true` (`:29987`), and
> `makeOidbEnvelope` (`:18818`) sets `reserved: isUid ? 1 : 0`. So the real envelope carries
> field **12 = 1** → trailing `60 01`. A vector without it will still parse server-side but is
> **not** what the client sends. Do not drop it.

### 1.1 `GOLDEN_MINIMAL` — 34 bytes

Only the required spine: common head, scene (no target), client meta, an **empty** `uploadInfo`
list. Note what is *absent*: `upload` is `12 00` (a present-but-empty message — `uploadInfo` is
empty so it writes nothing, and every bool/zero field elides).

Input object:

```js
{
  command: 4548, subCommand: 100, errorCode: 0, errorMsg: "", reserved: 1,
  body: {
    reqHead: {
      common: { requestId: 1, command: 100 },
      scene:  { requestType: 2, businessType: 1, sceneType: 1 },
      client: { agentType: 2 },
    },
    upload: { uploadInfo: [], srvSendMsg: false, clientSeq: 0, noNeedCompatMsg: false },
  },
}
```

```
08c423106422190a150a04080110641209a80602b00601c00c011a02080212006001
```

Decoded 【实测】:

```
f1  wt0 varint  = 4548                      [tag 08]   command
f2  wt0 varint  = 100                       [tag 10]   subCommand
f4  wt2 message len=25                      [tag 22]   body
    f1 wt2 message len=21                   [tag 0a]     reqHead
        f1 wt2 message len=4                [tag 0a]       common
            f1 wt0 varint = 1               [tag 08]         requestId
            f2 wt0 varint = 100             [tag 10]         command
        f2 wt2 message len=9                [tag 12]       scene
            f101 wt0 varint = 2             [tag a806]       requestType
            f102 wt0 varint = 1             [tag b006]       businessType
            f200 wt0 varint = 1             [tag c00c]       sceneType
        f3 wt2 message len=2                [tag 1a]       client
            f1 wt0 varint = 2               [tag 08]         agentType
    f2 wt2 bytes len=0                      [tag 12]     upload  (present, empty)
f12 wt0 varint = 1                          [tag 60]   reserved  (uinForm)
```

### 1.2 `GOLDEN_GROUP_IMAGE` — 228 bytes

Group image, `0x11c4` (4548), businessType 1, sceneType 2, `group.groupUin`, full `fileInfo`,
group-arm `extBizInfo.pic.extData`.

Input object:

```js
{
  command: 4548, subCommand: 100, errorCode: 0, errorMsg: "", reserved: 1,
  body: {
    reqHead: {
      common: { requestId: 1, command: 100 },
      scene:  { requestType: 2, businessType: 1, sceneType: 2,
                group: { groupUin: 987654321 } },
      client: { agentType: 2 },
    },
    upload: {
      uploadInfo: [{
        fileInfo: {
          fileSize: 245760,
          fileHash: 'd41d8cd98f00b204e9800998ecf8427e',   // md5 hex, 32 chars
          fileSha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709', // sha1 hex, 40 chars
          fileName: '0123456789abcdef0123456789abcdef.jpg',
          type: { type: 1, picFormat: 1000, videoFormat: 0, voiceFormat: 0 },
          width: 1280, height: 720, time: 0, original: 1,
        },
        subFileType: 0,
      }],
      tryFastUploadCompleted: true,
      srvSendMsg: false,
      clientRandomId: 0x0123456789abcdefn,
      compatQmsgSceneType: 2,
      extBizInfo: {
        pic: { bizType: 0, textSummary: '[图片]',
               extData: { subType: 0, textSummary: '[图片]' } },
        video: { bytesPbReserve: new Uint8Array(0) },
        ptt: { bytesReserve: new Uint8Array(0), bytesPbReserve: new Uint8Array(0),
               bytesGeneralFlags: new Uint8Array(0) },
      },
      clientSeq: 0,
      noNeedCompatMsg: false,
    },
  },
}
```

```
08c423106422da010a1e0a04080110641212a80602b00601c00c02d20c0608b1d1f9d6031a02080212b7010a88010a85010880800f122064343164386364393866303062323034653938303039393865636638343237651a2864613339613365653565366234623064333235356266656639353630313839306166643830373039222430313233343536373839616263646566303132333435363738396162636465662e6a70672a05080110e80730800a38d0054801100120ef9bafcdf8acd191012802321c0a1612085be59bbee789875d620a4a085be59bbee789875d12001a006001
```

Decoded 【实测】 (abridged to the load-bearing lines):

```
f1  wt0 = 4548                              [tag 08]
f2  wt0 = 100                               [tag 10]
f4  wt2 message len=218                     [tag 22]  body
    f1 wt2 message len=30                   [tag 0a]    reqHead
        f2 wt2 message len=18               [tag 12]      scene
            f101 = 2                        [tag a806]      requestType
            f102 = 1                        [tag b006]      businessType
            f200 = 2                        [tag c00c]      sceneType
            f202 wt2 message len=6          [tag d20c]      group
                f1 = 987654321              [tag 08]          groupUin
    f2 wt2 message len=183                  [tag 12]    upload
        f1 wt2 message len=136              [tag 0a]      uploadInfo[0]
            f1 wt2 message len=133          [tag 0a]        fileInfo
                f1 = 245760                 [tag 08]          fileSize
                f2 = "d41d8cd9…f8427e"      [tag 12]          fileHash   (32-char md5 hex)
                f3 = "da39a3ee…fd80709"     [tag 1a]          fileSha1   (40-char sha1 hex)
                f4 = "0123…cdef.jpg"        [tag 22]          fileName
                f5 wt2 message len=5        [tag 2a]          type
                    f1 = 1                  [tag 08]            type
                    f2 = 1000               [tag 10]            picFormat
                f6 = 1280                   [tag 30]          width
                f7 = 720                    [tag 38]          height
                f9 = 1                      [tag 48]          original
        f2 = 1                              [tag 10]      tryFastUploadCompleted
        f4 = 81985529216486895              [tag 20]      clientRandomId
        f5 = 2                              [tag 28]      compatQmsgSceneType
        f6 wt2 message len=28               [tag 32]      extBizInfo
            f1 wt2 message len=22           [tag 0a]        pic
                f2 = "[图片]"               [tag 12]          textSummary
                f12 wt2 message len=10      [tag 62]          extData
                    f9 = "[图片]"           [tag 4a]            textSummary
            f2 wt2 bytes len=0              [tag 12]        video
            f3 wt2 bytes len=0              [tag 1a]        ptt
f12 wt0 = 1                                 [tag 60]  reserved
```

### 1.3 `GOLDEN_PRIVATE_IMAGE` — 276 bytes

Same shape, private arm: `0x11c5` (4549), sceneType 1, `c2c.targetUid`, and the **`bytesPbReserveC2c`
sub-protobuf** instead of `extData`.

Input object:

```js
{
  command: 4549, subCommand: 100, errorCode: 0, errorMsg: "", reserved: 1,
  body: {
    reqHead: {
      common: { requestId: 1, command: 100 },
      scene:  { requestType: 2, businessType: 1, sceneType: 1,
                c2c: { accountType: 2,
                       targetUid: 'u_AbCdEfGhIjKlMnOpQrStUvWxYz012345' } },
      client: { agentType: 2 },
    },
    upload: {
      uploadInfo: [{
        fileInfo: {
          fileSize: 51200,
          fileHash: '0cc175b9c0f1b6a831c399e269772661',
          fileSha1: '86f7e437faa5a7fce15d1ddcb9eaeaea377667b8',
          fileName: 'ffffffffffffffffffffffffffffffff.png',
          type: { type: 1, picFormat: 1001, videoFormat: 0, voiceFormat: 0 },
          width: 256, height: 256, time: 0, original: 1,
        },
        subFileType: 0,
      }],
      tryFastUploadCompleted: true,
      srvSendMsg: false,
      clientRandomId: 0x7fffffffffffffffn,
      compatQmsgSceneType: 1,
      extBizInfo: {
        pic: { bizType: 1, textSummary: '[动画表情]',
               // = protobuf_encode_NotOnlineImagePbReserve({ subType: 1, summary: '[动画表情]' })
               bytesPbReserveC2c: <18-byte sub-protobuf, §1.5> },
        video: { bytesPbReserve: new Uint8Array(0) },
        ptt: { bytesReserve: new Uint8Array(0), bytesPbReserve: new Uint8Array(0),
               bytesGeneralFlags: new Uint8Array(0) },
      },
      clientSeq: 0,
      noNeedCompatMsg: false,
    },
  },
}
```

```
08c5231064228a020a3e0a04080110641232a80602b00601c00c01ca0c2608021222755f4162436445664768496a4b6c4d6e4f705172537455765778597a3031323334351a02080212c7010a88010a850108809003122030636331373562396330663162366138333163333939653236393737323636311a2838366637653433376661613561376663653135643164646362396561656165613337373636376238222466666666666666666666666666666666666666666666666666666666666666662e706e672a05080110e9073080023880024801100120ffffffffffffffff7f2801322c0a260801120e5be58aa8e794bbe8a1a8e683855d5a120801420e5be58aa8e794bbe8a1a8e683855d12001a006001
```

Decoded 【实测】 (the parts that differ from §1.2):

```
f1  wt0 = 4549                              [tag 08]
    f2 wt2 message len=50                   [tag 12]      scene
        f201 wt2 message len=38             [tag ca0c]      c2c
            f1 = 2                          [tag 08]          accountType
            f2 = "u_AbCd…z012345"           [tag 12]          targetUid
        ...
        f6 wt2 message len=44               [tag 32]      extBizInfo
            f1 wt2 message len=38           [tag 0a]        pic
                f1 = 1                      [tag 08]          bizType
                f2 = "[动画表情]"            [tag 12]          textSummary
                f11 wt2 message len=18      [tag 5a]          bytesPbReserveC2c  ← §1.5
                    f1 = 1                  [tag 08]
                    f8 = "[动画表情]"        [tag 42]
f12 wt0 = 1                                 [tag 60]  reserved
```

### 1.4 `GOLDEN_HIGHWAY_EXTEND` — 447 bytes

The `bytesReqExtendInfo` payload, i.e. `NTV2RichMediaHighwayExt` (§4).

Input object:

```js
{
  fileUuid: '0123456789abcdef0123456789abcdef',
  uKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  network: { ipv4s: [{ domain: { isEnable: true, ip: '1.2.3.4' }, port: 443 }] },
  msgInfoBody: [{
    index: {
      info: {
        fileSize: 245760,
        fileHash: 'd41d8cd98f00b204e9800998ecf8427e',
        fileSha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        fileName: '0123456789abcdef0123456789abcdef.jpg',
        type: { type: 1, picFormat: 1000, videoFormat: 0, voiceFormat: 0 },
        width: 1280, height: 720, time: 0, original: 1,
      },
      fileUuid: '0123456789abcdef0123456789abcdef',
      storeId: 1, uploadTime: 1700000000, ttl: 86400, subType: 0,
    },
    picture: {
      urlPath: '/download?appid=1407&fileid=0123456789abcdef',
      ext: { originalParameter: '1200', bigParameter: '800', thumbParameter: '300' },
      domain: 'multimedia.nt.qq.com.cn',
    },
    fileExist: true,
    hashSum: {
      bytesPbReserveC2c: { friendUid: 'u_AbCdEfGhIjKlMnOpQrStUvWxYz012345' },
      troopSource: { groupUin: 987654321 },
    },
  }],
  blockSize: 1048576,
  hash: { fileSha1: [ /* repeated bytes — one entry per 1 MiB block */
    [0xda,0x39,0xa3,0xee,0x5e,0x6b,0x4b,0x0d,0x32,0x55,0xbf,0xef,0x95,0x60,0x18,0x90,0xaf,0xd8,0x07,0x09],
  ] },
}
```

```
0a203031323334353637383961626364656630313233343536373839616263646566122061316232633364346535663630373138323933613462356336643765386639302a120a100a0b08011207312e322e332e3410bb0332c8020ab6010a85010880800f122064343164386364393866303062323034653938303039393865636638343237651a2864613339613365653565366234623064333235356266656639353630313839306166643830373039222430313233343536373839616263646566303132333435363738396162636465662e6a70672a05080110e80730800a38d00548011220303132333435363738396162636465663031323334353637383961626364656618012080e2cfaa062880a30512590a2c2f646f776e6c6f61643f61707069643d313430372666696c6569643d3031323334353637383961626364656612100a043132303012033830301a033330301a176d756c74696d656469612e6e742e71712e636f6d2e636e28013230ca0c241222755f4162436445664768496a4b6c4d6e4f705172537455765778597a303132333435d20c0608b1d1f9d603508080405a160a14da39a3ee5e6b4b0d3255bfef95601890afd80709
```

Decoded 【实测】:

```
f1  wt2 string  len=32 = "0123456789abcdef0123456789abcdef"   [tag 0a]   fileUuid
f2  wt2 string  len=32 = "a1b2c3d4e5f60718293a4b5c6d7e8f90"   [tag 12]   uKey
f5  wt2 message len=18                                        [tag 2a]   network
    f1 wt2 message len=16                                     [tag 0a]     ipv4s[0]
        f1 wt2 message len=11                                 [tag 0a]       domain
            f1 wt0 = 1                                        [tag 08]         isEnable
            f2 wt2 string len=7 = "1.2.3.4"                   [tag 12]         ip
        f2 wt0 = 443                                          [tag 10]       port
f6  wt2 message len=328                                       [tag 32]   msgInfoBody[0]
    f1 wt2 message len=182                                    [tag 0a]     index
        f1 wt2 message len=133                                [tag 0a]       info (FileInfo)
            f1 = 245760                                       [tag 08]
            f2 = "d41d8cd9…f8427e"                            [tag 12]
            f3 = "da39a3ee…fd80709"                           [tag 1a]
            f4 = "0123…cdef.jpg"                              [tag 22]
            f5 wt2 message len=5                              [tag 2a]       type
                f1 = 1 / f2 = 1000                            [tag 08/10]
            f6 = 1280 / f7 = 720 / f9 = 1                     [tag 30/38/48]
        f2 wt2 string len=32 = "0123…cdef"                     [tag 12]       fileUuid
        f3 wt0 = 1                                            [tag 18]       storeId
        f4 wt0 = 1700000000                                   [tag 20]       uploadTime
        f5 wt0 = 86400                                        [tag 28]       ttl
    f2 wt2 message len=89                                     [tag 12]     picture
        f1 = "/download?appid=1407&fileid=0123…"               [tag 0a]       urlPath
        f2 wt2 message len=16                                 [tag 12]       ext
            f1 = "1200" / f2 = "800" / f3 = "300"             [tag 0a/12/1a]
        f3 = "multimedia.nt.qq.com.cn"                         [tag 1a]       domain
    f5 wt0 = 1                                                [tag 28]     fileExist  (bool true)
    f6 wt2 message len=48                                     [tag 32]     hashSum
        f201 wt2 message len=36                               [tag ca0c]     bytesPbReserveC2c
            f2 = "u_AbCd…z012345"                             [tag 12]         friendUid
        f202 wt2 message len=6                                [tag d20c]     troopSource
            f1 = 987654321                                    [tag 08]         groupUin
f10 wt0 = 1048576                                             [tag 50]   blockSize
f11 wt2 message len=22                                        [tag 5a]   hash
    f1 wt2 bytes len=20 = da39a3ee…fd80709                     [tag 0a]     fileSha1[0]
```

### 1.5 `GOLDEN_PB_RESERVE_C2C` — 18 bytes

The `bytesPbReserveC2c` sub-protobuf (`NotOnlineImagePbReserve`) that the **private** arm puts at
`PicExtBizInfo` field 11. Encoded by `protobuf_encode_NotOnlineImagePbReserve` (`:109961`).

Input: `{ subType: 1, summary: '[动画表情]' }` — i.e. an animated-sticker image.

```
0801420e5be58aa8e794bbe8a1a8e683855d
```

Decoded 【实测】:

```
f1 wt0 varint = 1                    [tag 08]   subType
f8 wt2 string len=14 = "[动画表情]"   [tag 42]   summary
```

Full field map of that message 【指令级】, from `__write_NotOnlineImagePbReserve$3` (`:110026`):
1 `subType` uint32 · 3 `field3` uint32 · 4 `field4` uint32 · 8 `summary` string ·
10 `field10` uint32 · 20 `field20` msg · 30 `url` string · 31 `md5Str` string. Only 1 and 8 are
supplied by `uploadImageMsgInfo` (`:110510`).

### 1.6 Highway chunk-head goldens (bonus — two live bugs found)

These are not the upload request, but they sit in the same `bytesReqExtendInfo` path and the
exercise turned up two wrong field numbers in **our** `ts/src/highway/head.ts` (§5.3).

【实测】`node /tmp/codec/headgolden.mjs`, reference encoders, `commandId: 1003`:

```
SegHead (cachePort=0)     50  10808040208080403204010203044210aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4a10bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
SegHead (cacheAddr+port)  58  10808040208080403204010203044210aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4a10bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb508486880868903f
DataHighwayHead           34  0801120531303030311a0c50696355702e44617461557030c4acf8fa05381040eb07
LoginSigHead               8  080818c4acf8fa05
ReqDataHighwayHead       102  0a220801120531303030311a0c50696355702e44617461557030c4acf8fa05381040eb07123210808040208080403204010203044210aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4a10bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1a02dead2a08080818c4acf8fa05
```

with input `seg = { serviceId:0, filesize:1048576n, dataOffset:0n, dataLength:1048576, retCode:0,
serviceTicket:[1,2,3,4], flag:0, md5:16×0xaa, fileMd5:16×0xbb, cacheAddr:0x01020304, cachePort:8080 }`,
`base = { version:1, uin:'10001', command:'PicUp.DataUp', seq:0, retryTimes:0,
appId:1600001604, dataFlag:16, commandId:1003 }`, extend `[0xde,0xad]`, timestamp `0`.

Decoded 【实测】 — the two decisive lines:

```
f10 wt0 = 16909060   [tag 50]   cacheAddr
f13 wt0 = 8080       [tag 68]   cachePort   ← field THIRTEEN, not 11
```

```
f1 wt0 = 8           [tag 08]   loginSigType
f3 wt0 = 1600001604  [tag 18]   appId       ← field THREE (LoginSigHead skips 2)
```

---

## 2. The message tree

Legend: `wt` = protobuf wire type. Presence is the reference's own `__size_` guard, quoted
verbatim — it is part of the byte contract, not an implementation detail.

### 2.1 `OidbBase` envelope — `__write_OidbBase__NTV2UploadRichMediaReq` (`:27092`)

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `command` |
| 2 | 0 | varint | `_f1 != null && _f1 !== 0` | `subCommand` |
| 3 | 0 | varint | `_f2 != null && _f2 !== 0` | `errorCode` |
| 4 | 2 | `NTV2UploadRichMediaReq` | `_f3 != null` | `body` |
| 5 | 2 | string | `_f4 != null && _f4 !== ""` | `errorMsg` |
| 11 | 2 | `OidbProperty` | repeated | `properties` |
| 12 | 0 | varint | `_f6 != null && _f6 !== 0` | `reserved` |

> Field **11** for `properties` — the envelope skips 6–10. `reserved` is **12**.

### 2.2 `NTV2UploadRichMediaReq` — `:27296`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `NTV2UploadReqHead` | `_f0 != null` | `reqHead` |
| 2 | 2 | `NTV2UploadReq` | `_f1 != null` | `upload` |

### 2.3 `NTV2UploadReqHead` — `:27382`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `NTV2CommonHead` | `_f0 != null` | `common` |
| 2 | 2 | `NTV2UploadSceneInfo` | `_f1 != null` | `scene` |
| 3 | 2 | `NTV2ClientMeta` | `_f2 != null` | `client` |

### 2.4 `NTV2CommonHead` (`_t2vciu`) — `:27479`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `requestId` |
| 2 | 0 | varint | `_f1 != null && _f1 !== 0` | `command` |

This `command` is the **sub-command** (100), not the OIDB command — a second, independent copy.

### 2.5 `NTV2UploadSceneInfo` — `:27677` ⚠️ hundred-based, multi-byte tags

| # | wt | tag bytes | type | presence | key |
| --- | --- | --- | --- | --- | --- |
| **101** | 0 | `a8 06` | varint | `_f0 != null && _f0 !== 0` | `requestType` |
| **102** | 0 | `b0 06` | varint | `_f1 != null && _f1 !== 0` | `businessType` |
| **200** | 0 | `c0 0c` | varint | `_f2 != null && _f2 !== 0` | `sceneType` |
| **201** | 2 | `ca 0c` | `NTV2C2CUserInfo` | `_f3 != null` | `c2c` |
| **202** | 2 | `d2 0c` | `NTV2GroupInfo` | `_f4 != null` | `group` |

> **This is where a hand port goes wrong.** `buf[offset++] = 168; buf[offset++] = 6;` is the
> two-byte varint tag `0xA8 0x06` = 808 = (101<<3)|0. Read as "field 21, field 24" — which is what
> a naive first-byte reading gives — the scene block names no target and the server rejects it.
> `c2c` vs `group` is the **only** scene difference between private and group.

### 2.6 `NTV2C2CUserInfo` (`_1a59ptf`) — `:27835`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `accountType` |
| 2 | 2 | string | `_f1 != null && _f1 !== ""` | `targetUid` |
| **3** | 2 | bytes | repeated (`_f2.length > 0`) | `routingHead` |

> Field **3** carries a **pre-encoded `RoutingHead`** (`protobuf_encode_RoutingHead`, `:24006`),
> only for temp-session group uploads. `Ntv2UploadRequest.serialize` (`:29992`) sets it from
> `grpTmp: { groupUin, toUid }` and throws if the context is inconsistent. Ordinary private and
> group sends leave it unset — hence absent from `GOLDEN_PRIVATE_IMAGE`.

### 2.7 `NTV2GroupInfo` (`_1txa7qw`) — `:27928`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `groupUin` |

### 2.8 `NTV2ClientMeta` (`_6kbrno`) — `:27966`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `agentType` |

### 2.9 `NTV2UploadReq` — `:28036`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `NTV2UploadInfo` | **repeated** | `uploadInfo` |
| 2 | 0 | bool | `_f1 === true` | `tryFastUploadCompleted` |
| 3 | 0 | bool | `_f2 === true` | `srvSendMsg` |
| 4 | 0 | **uint64** | `_f3 != null && _f3 !== 0n` | `clientRandomId` |
| 5 | 0 | varint | `_f4 != null && _f4 !== 0` | `compatQmsgSceneType` |
| 6 | 2 | `NTV2ExtBizInfo` | `_f5 != null` | `extBizInfo` |
| 7 | 0 | varint | `_f6 != null && _f6 !== 0` | `clientSeq` |
| 8 | 0 | bool | `_f7 === true` | `noNeedCompatMsg` |

> `clientRandomId` is **uint64** — encode as BigInt (`BigInt.asUintN(64, …)`), not `>>> 0`.
> A 32-bit truncation still parses but no longer matches NapCat/QQ.

### 2.10 `NTV2UploadInfo` — `:28180`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `NTV2FileInfo` | `_f0 != null` | `fileInfo` |
| 2 | 0 | varint | `_f1 != null && _f1 !== 0` | `subFileType` |

`subFileType`: **0** = the primary file; **100** = a sub-file (video thumbnail). 【指令级】
`uploadVideoMsgInfo` (`:37677`, `:37695`) sends `0` then `100`.

### 2.11 `NTV2FileInfo` (`_1n3cqxd`) — `:28298`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `fileSize` |
| 2 | 2 | string | `_f1 != null && _f1 !== ""` | `fileHash` |
| 3 | 2 | string | `_f2 != null && _f2 !== ""` | `fileSha1` |
| 4 | 2 | string | `_f3 != null && _f3 !== ""` | `fileName` |
| 5 | 2 | `NTV2FileType` | `_f4 != null` | `type` |
| 6 | 0 | varint | `_f5 != null && _f5 !== 0` | `width` |
| 7 | 0 | varint | `_f6 != null && _f6 !== 0` | `height` |
| 8 | 0 | varint | `_f7 != null && _f7 !== 0` | `time` |
| 9 | 0 | varint | `_f8 != null && _f8 !== 0` | `original` |

> ⚠️ `fileHash` / `fileSha1` are **strings of lowercase hex**, not raw 20/16-byte digests.
> 32 chars for md5, 40 for sha1 — see the goldens. Sending raw bytes makes the length 16/20 and the
> server rejects the hash.

### 2.12 `NTV2FileType` (`_1u8lwol`) — `:28561`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `type` |
| 2 | 0 | varint | `_f1 != null && _f1 !== 0` | `picFormat` |
| 3 | 0 | varint | `_f2 != null && _f2 !== 0` | `videoFormat` |
| 4 | 0 | varint | `_f3 != null && _f3 !== 0` | `voiceFormat` |

`type`: 1 = image, 2 = video, 3 = voice. 【指令级】`:110545`, `:37661`, `:110911`.
`picFormat` values come from `detectImageFormat` (`:18192`): **1000** jpg, **1001** png,
**1002** gif/webp, **1005** bmp.

### 2.13 `NTV2ExtBizInfo` — `:28701`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `PicExtBizInfo` | `_f0 != null` | `pic` |
| 2 | 2 | `VideoExtBizInfo` | `_f1 != null` | `video` |
| 3 | 2 | `PttExtBizInfo` | `_f2 != null` | `ptt` |
| 10 | 0 | varint | `_f3 != null && _f3 !== 0` | `busiType` |

All three arms are supplied on **every** media type — the unused ones are present but empty
(they encode to a single byte `12 00` / `1a 00`, or vanish if every sub-field elides). See the
call-site literals in §3.

### 2.14 `PicExtBizInfo` — `:25700`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `bizType` |
| 2 | 2 | string | `_f1 != null && _f1 !== ""` | `textSummary` |
| **11** | 2 | bytes | repeated (`_f2.length > 0`) | `bytesPbReserveC2c` |
| **12** | 2 | `PicExtData` | `_f3 != null` | `extData` |
| 1001 | 0 | `b8 3e` | `_f4 != null && _f4 !== 0` | `fromScene` |
| 1002 | 0 | `c0 3e` | `_f5 != null && _f5 !== 0` | `toScene` |
| 1003 | 0 | `c8 3e` | `_f6 != null && _f6 !== 0` | `oldFileId` |

> **`extData` (12) is the group arm; `bytesPbReserveC2c` (11) is the private arm.** They are
> mutually exclusive at the call site — `uploadImageMsgInfo` (`:110506-110513`) spreads one or the other.
> Sending both is not what the client does.

### 2.15 `PicExtData` — `:26115`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `subType` |
| **9** | 2 | string | `_f1 != null && _f1 !== ""` | `textSummary` |

> Field **9**, not 2. Note `subType: 0` elides, which is why the group golden shows only `4a 08`…

### 2.16 `VideoExtBizInfo` — `:26299`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | varint | `_f0 != null && _f0 !== 0` | `fromScene` |
| 2 | 0 | varint | `_f1 != null && _f1 !== 0` | `toScene` |
| 3 | 2 | bytes | repeated (`_f2.length > 0`) | `bytesPbReserve` |

### 2.17 `PttExtBizInfo` — `:26561`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | **uint64** | `_f0 != null && _f0 !== 0n` | `srcUin` |
| 2 | 0 | varint | `_f1 != null && _f1 !== 0` | `pttScene` |
| 3 | 0 | varint | `_f2 != null && _f2 !== 0` | `pttType` |
| 4 | 0 | varint | `_f3 != null && _f3 !== 0` | `changeVoice` |
| 5 | 2 | bytes | repeated | `waveform` |
| 6 | 0 | varint | `_f5 != null && _f5 !== 0` | `autoConvertText` |
| 11 | 2 | bytes | repeated | `bytesReserve` |
| 12 | 2 | bytes | repeated | `bytesPbReserve` |
| 13 | 2 | bytes | repeated | `bytesGeneralFlags` |

---

## 3. Where each field's value comes from

Two levels: `Ntv2UploadRequest.serialize` (`:29992`, the OIDB spec) is the **generic** mapper from
params → message; the per-media call sites are `uploadImageMsgInfo` (`:110499`),
`uploadPtt` (`:110885`) and `uploadVideoMsgInfo` (`:37617`); all three funnel through
`runNtv2Upload` (`:36928`) → `runNtv2UploadOperation` (`:36966`) → `requestUpload` (`:36972`) → `Ntv2UploadRequest.invoke` (`:36975`).

### 3.1 Constants — identical on every media type, every session

| field | value | source |
| --- | --- | --- |
| envelope `subCommand` | **100** | `_Ntv2UploadRequest.subCommand = 100` (`:29986`) |
| envelope `errorCode` / `errorMsg` | **0** / `""` | `makeOidbEnvelope` (`:18818`) |
| envelope `reserved` | **1** (`uinForm: true`) | `:29987` + `:18818` |
| `reqHead.common.command` | **100** | `serialize` (`:30002`) |
| `reqHead.scene.requestType` | **2** | `serialize` (`:30005`) — all three call sites agree |
| `reqHead.client.agentType` | **2** | `serialize` (`:30014`) |
| `upload.srvSendMsg` | **false** | `serialize` (`:30019`) — elided |
| `upload.clientSeq` | **0** | `serialize` (`:30023`) — elided |
| `upload.noNeedCompatMsg` | **false** | `serialize` (`:30024`) — elided |
| `uploadInfo[].subFileType` | **0** (primary) / **100** (thumb) | `:110532`, `:37677`, `:37695` |
| `fileInfo.type.type` | **1** image / **2** video / **3** voice | `:110545`, `:37661`, `:110911` |

### 3.2 Per-media constants

| field | image | video | voice |
| --- | --- | --- | --- |
| OIDB cmd (group / private) | **4548** / **4549** | **4586** / **4585** | **4718** / **4717** |
| `h.wireName` | `OidbSvcTrpcTcp.0x11c4_100` / `…0x11c5_100` | `…0x11ea_100` / `…0x11e9_100` | `…0x126e_100` / `…0x126d_100` |
| `businessType` (f102) | **1** | **2** | **3** |
| `requestId` | **1** | **3** | group **1** / private **4** |
| `compatQmsgSceneType` | 2 if group else 1 | **2** (both) | 2 if group else 1 |
| `fileInfo.type.picFormat` | `detectImageFormat` → 1000/1001/1002/1005 | 0 | 0 |
| `fileInfo.type.videoFormat` | 0 | 0 | 0 |
| `fileInfo.type.voiceFormat` | 0 | 0 | `ptt.voiceFormat` |
| `fileInfo.original` | **1** | **0** | **0** |
| `fileInfo.width/height` | measured | group: real, private: **0** | **0 / 0** |
| `fileInfo.time` | **0** | `video.duration` | `ptt.duration` |
| highway `cmdId` (group / private) | **1004** / **1003** | **1005** / **1001** (+ thumb **1006** / **1002**) | **1008** / **1007** |

Sources: image `:110499-110560`; video `:37650-37690`; voice `:110895-110935`;
cmd ids `:34122`, `:37481-37484`, `:110778-110779`. 【指令级】

### 3.3 From the media segment (already hashed by the caller)

| field | source |
| --- | --- |
| `fileInfo.fileSize` | byte length of the loaded media (`loadImage`/`loadPtt`/`loadVideo`) |
| `fileInfo.fileHash` | **md5 hex string**, `computeHashes(...).md5Hex` |
| `fileInfo.fileSha1` | **sha1 hex string**, `.sha1Hex` |
| `fileInfo.fileName` | `md5Hex + ext` (`:110480`), or `image.fileName`; video hardcodes `'nya.mp4'`, thumb `'nya.jpg'` |
| `fileInfo.type.picFormat` | `detectImageFormat(bytes).format` (`:18192`) |
| `fileInfo.width/height` | `detectImageFormat(bytes)` |
| `uploadInfo[].subFileType` / array length | 1 element, except video = 2 (video + thumb) |

### 3.4 From the session

| field | source |
| --- | --- |
| `clientRandomId` | **`crypto.randomBytes(8).readBigUInt64BE() & 0x7FFF_FFFF_FFFF_FFFFn`** — see `makeClientRandomId` (`:36896`) |
| envelope `command` | `params.oidbCmd` via `resolveCommand: (params) => params.oidbCmd` (`:29988`) — the cmd id is a *parameter*, not baked into the spec |
| `reqHead.common.requestId` | `params.requestId` (§3.2) |
| `scene.sceneType` | `params.isGroup ? 2 : 1` |
| `scene.group.groupUin` | `Number(params.targetIdOrUid)` when group |
| `scene.c2c.targetUid` | `String(params.targetIdOrUid)` when private |
| `scene.c2c.accountType` | **2** (uid form) |
| `scene.c2c.routingHead` | only for temp sessions: `protobuf_encode_RoutingHead({grpTmp:{groupUin, toUid}})` |
| highway session (`sig_session`, server list) | a **separate** OIDB call `HttpConn.0x6ff_501` — *not* part of this request |

### 3.5 From the file hash (the part that feeds `bytesReqExtendInfo`)

`buildHighwayExtend` (`:34237`) is called **per sub-file**, from `runPuts` (`:37029`):

```js
const extend = buildHighwayExtend(uKey, msgInfo, target.ipv4s ?? [], sub.sha1, sub.subFileIndex ?? 0);
```

| `NTV2RichMediaHighwayExt` field | source |
| --- | --- |
| `fileUuid` | `msgInfo.msgInfoBody[fileIndex].index.fileUuid` — **from the upload response**, not the request |
| `uKey` | `target.uKey` where `target = sub.source === "top" ? upload : upload.subFileInfos?.[sub.source]` |
| `network.ipv4s[]` | `target.ipv4s`, filtered to entries with both `outIp` **and** `outPort` non-zero; `ip` rendered by `ipv4ToString` (`:34124`, little-endian: `b0.b1.b2.b3` of `value & 255`, `>>8`, `>>16`, `>>24`); `domain.isEnable` always `true` |
| `msgInfoBody[]` | the **whole** `msgInfo.msgInfoBody` array, projected to `{index, picture, fileExist, hashSum}` |
| `blockSize` | `HIGHWAY_BLOCK_SIZE` = **1024 × 1024** (`:34098`) |
| `hash.fileSha1[]` | `sub.sha1` — **one 20-byte sha1 per 1 MiB block** (`sha1Blocks`); the thumb uses its own single-block sha1 |

> **Critical ordering constraint** 【指令级】: the request carries only hashes and sizes; `uKey`,
> `ipv4s`, `index.fileUuid` and `picture` all come back **in the response** and are what
> `bytesReqExtendInfo` is built from. So the OIDB request must be sent and decoded *before* any
> highway chunk can be framed. `runNtv2UploadOperation` does exactly that (`:37044` → `:37029`, `buildHighwayExtend` at the top of `runPuts`).

---

## 4. The `bytesReqExtendInfo` / `FileUploadExt` payload

`ReqDataHighwayHead` field **3** (`ts/src/highway/head.ts:219`, reference `:32279`) is a `bytes`
field carrying a **further protobuf**. For NTV2 media it is `NTV2RichMediaHighwayExt`
(`protobuf_encode_NTV2RichMediaHighwayExt`, `:33545`) — not the older `FileUploadExt`
(`buildGroupFileUploadExt`, `:289652`) / `GroupAvatarExtra`. 【指令级】`buildHighwayExtend` (`:34237`) is the only builder on
this path.

### 4.1 Wire format

The `ReqDataHighwayHead` frame around it 【实测, decoded from §1.6】:

```
f1 wt2  msgBaseHead        DataHighwayHead   version/uin/command/seq/retryTimes/appId/dataFlag/commandId
f2 wt2  msgSegHead         SegHead           serviceId/filesize/dataOffset/dataLength/retCode/
                                             serviceTicket/md5(CHUNK)/fileMd5(WHOLE)/cacheAddr/**13** cachePort
f3 wt2  bytesReqExtendInfo ← NTV2RichMediaHighwayExt   (this section)
f4 wt0  timestamp          uint64
f5 wt2  msgLoginSigHead    LoginSigHead      1 loginSigType, **3** appId
```

`DataHighwayHead`: 1 version · 2 uin (**string**) · 3 command (**string** `"PicUp.DataUp"`) ·
4 seq · 5 retryTimes · 6 appId · 7 dataFlag · 8 commandId.
`SegHead`: 1 serviceId · 2 filesize · 3 dataOffset · 4 dataLength · 5 retCode ·
6 serviceTicket (**repeated bytes**) · 7 flag · 8 md5 (**repeated bytes**) · 9 fileMd5
(**repeated bytes**) · 10 cacheAddr · **13** cachePort.

### 4.2 `NTV2RichMediaHighwayExt` — `:33603`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | string | `_f0 != null && _f0 !== ""` | `fileUuid` |
| 2 | 2 | string | `_f1 != null && _f1 !== ""` | `uKey` |
| 5 | 2 | `HighwayNetwork` | `_f2 != null` | `network` |
| 6 | 2 | `HighwayMsgInfoBody` | **repeated** | `msgInfoBody` |
| 10 | 0 | varint | `_f4 != null && _f4 !== 0` | `blockSize` |
| 11 | 2 | `HighwayHash` | `_f5 != null` | `hash` |

> Fields **3 and 4 do not exist** — the numbering skips them.

### 4.3 `HighwayNetwork` — `:33776`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `HighwayIPv4` | **repeated** | `ipv4s` |

### 4.4 `HighwayIPv4` — `:33824`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `HighwayDomain` | `_f0 != null` | `domain` |
| 2 | 0 | varint | `_f1 != null && _f1 !== 0` | `port` |

### 4.5 `HighwayDomain` — `:33891`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 0 | **bool** | `_f0 === true` | `isEnable` |
| 2 | 2 | string | `_f1 != null && _f1 !== ""` | `ip` |

### 4.6 `HighwayHash` — `:33936`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | **repeated bytes** (non-packed) | `_f0 != null && _f0.length > 0` | `fileSha1` |

> One tag `0a` **per** block hash — not length-delimited-packed. `HIGHWAY_BLOCK_SIZE` is 1 MiB,
> so a 3 MiB file has three `fileSha1` entries.

### 4.7 `HighwayMsgInfoBody` — `:30312` (echoes the upload response's `msgInfoBody`)

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `IndexNode` | `_f0 != null` | `index` |
| 2 | 2 | `PictureInfo` | `_f1 != null` | `picture` |
| 5 | 0 | **bool** | `_f2 === true` | `fileExist` |
| 6 | 2 | `HashSum` | `_f3 != null` | `hashSum` |

### 4.8 `IndexNode` — `:30442`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | `FileInfo` | `_f0 != null` | `info` |
| 2 | 2 | string | `_f1 != null && _f1 !== ""` | `fileUuid` |
| 3 | 0 | varint | `_f2 != null && _f2 !== 0` | `storeId` |
| 4 | 0 | varint | `_f3 != null && _f3 !== 0` | `uploadTime` |
| 5 | 0 | varint | `_f4 != null && _f4 !== 0` | `ttl` |
| 6 | 0 | varint | `_f5 != null && _f5 !== 0` | `subType` |

### 4.9 `FileInfo` — `:30662`

Identical numbering to `NTV2FileInfo` (§2.11): 1 `fileSize` · 2 `fileHash` · 3 `fileSha1` ·
4 `fileName` · 5 `type` (`FileType`) · 6 `width` · 7 `height` · 8 `time` · 9 `original`.
`FileType` (`:30925`) is 1 `type` · 2 `picFormat` · 3 `videoFormat` · 4 `voiceFormat`.

### 4.10 `PictureInfo` — `:31055`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| 1 | 2 | string | `_f0 != null && _f0 !== ""` | `urlPath` |
| 2 | 2 | `PicUrlExtInfo` | `_f1 != null` | `ext` |
| 3 | 2 | string | `_f2 != null && _f2 !== ""` | `domain` |

`PicUrlExtInfo` (`:31163`): 1 `originalParameter` · 2 `bigParameter` · 3 `thumbParameter`, all strings.

### 4.11 `HashSum` — `:31269`

| # | wt | type | presence | key |
| --- | --- | --- | --- | --- |
| **201** | 2 | `C2cSource` | `_f0 != null` | `bytesPbReserveC2c` |
| **202** | 2 | `TroopSource` | `_f1 != null` | `troopSource` |

`C2cSource` (`:31337`): field **2** `friendUid` string (field 1 does not exist).
`TroopSource` (`:31377`): field 1 `groupUin` varint.

> Same hundred-based trap as §2.5: `ca 0c` = 1608 = (201<<3)|0.

### 4.12 The upload **response** (needed to build the extend payload)

【指令级】from the `protobuf_decode_*` functions. Note the request has **no** encoder counterpart
for these — they are decode-only in the reference, which is why the whole region is
"request encoder + response decoder".

`NTV2UploadRichMediaResp` (`:29169`): 1 `respHead` · 2 `upload` (`NTV2UploadRespBody`).
`NTV2UploadRespHead` (`:29278`): 1 `retCode` · 2 `message`… (1 wt2 string, 2 wt0, 3 wt2).

`NTV2UploadRespBody` (`:29407`) — this is the one that matters:

| # | wt | name | feeds |
| --- | --- | --- | --- |
| 1 | 2 | `uKey` (string) | `HighwayExt.uKey` |
| 2 | 0 | `uKeyTtl` | — |
| 3 | 2 | `ipv4s` (`NTV2IPv4`) | `HighwayExt.network.ipv4s` |
| 5 | 0 | `msgSeq` | — |
| 6 | 2 | `msgInfo` (`NTV2UploadRespMsgInfo`) | `HighwayExt.msgInfoBody`, `fileUuid` |
| 8 | 2 | `compatQMsg` | the `commonElem` compat blob |
| 10 | 2 | `subFileInfos` (`NTV2SubFileInfoResp`) | thumb `uKey`/`ipv4s`/`fileUuid` |

`NTV2IPv4` (`:29620`): 1 `outIp` · 2 `outPort`.
`NTV2UploadRespMsgInfo` (`:29725`): 1 `msgInfoBody` (repeated) · 2 `extBizInfo`.
`NTV2SubFileInfoResp` (`:29834`): 1 `subType` · 2 `uKey` · 3 `uKeyTtl` · 4 `ipv4s`.

`buildHighwayExtend`'s two throw conditions 【指令级】 (`:34238`, `:34241`):
`upload response missing msg_info body` (empty `msgInfoBody`) and, upstream,
`upload response missing msgInfo` / `missing msgInfo` → mapped to `response_invalid` at `:37001`.

---

## 5. Our side — what exists and exactly what is missing

### 5.1 Inventory 【指令级】

| file | lines | state |
| --- | --- | --- |
| `ts/src/highway/frame.ts` | 119 | frame pack/unpack (`'(' | BE32 headLen | BE32 bodyLen`) — implemented |
| `ts/src/highway/head.ts` | 297 | `ReqDataHighwayHead` encode + `RespDataHighwayHead` decode — implemented, **2 field bugs** (§5.3) |
| `ts/src/highway/transport.ts` | 376 | raw-socket HTTP/1.1 POST — implemented |
| `ts/src/highway/session.ts` | 230 | session cache — implemented |
| `ts/src/highway/upload.ts` | 485 | chunk loop, retries, concurrency — implemented |
| `ts/src/oidb/services/0x6ff.ts` | 464 | `HttpConn.0x6ff_501` request builder + response decode — implemented |
| `ts/src/oidb/services/0x126e.ts` | 1370 | NTV2 **download/URL** half: `RichMediaReqField`, `ReqHeadField`, `CommonHeadField`, `SceneInfoField` (101/102/200/201/202), `ClientMetaField`, `IndexNodeField` — reusable |
| `ts/src/oidb/services/0x3639-offline.ts` | — | three NTV2 **URL** specs (`0x126d/0x11e9/0x11ea` sub 200) |
| `ts/src/oidb/wire.ts` | — | `ProtoWriter` with the **correct** presence rules already documented and implemented (`uint32`/`uint64`/`bool`/`string`/`bytes`/`message`/`repeatedMessage`) |
| `ts/src/msg-push-fields.ts` | — | decoders for `MsgInfoBody`/`IndexNode`/`PictureInfo`/`PicUrlExtInfo`/`HashSum`/`C2cSource`/`TroopSource`/`FileInfo`/`FileType`/`ExtBizInfo` — **exactly the response side of §4.7–4.11**, reusable as-is |

**Good news**: `ProtoWriter` (`ts/src/oidb/wire.ts:95-110`) already states and implements the same
presence rules the reference uses, so the encoders in §2 can be written directly against it with
no new primitives. `uint64` and `bool` variants both exist.

### 5.2 Missing — the checklist

Everything below is **absent**; each line is one deliverable.

- [ ] **1. `NTV2UploadRichMediaReq` encoders** — a new `ts/src/oidb/services/0x11c4.ts` (or
      `ntv2-upload.ts`). 17 messages, §2.1–2.17. Reuse `SceneInfoField` (`0x126e.ts:94`) and
      `CommonHeadField`/`ClientMetaField`; **add** the upload-only messages
      (`NTV2UploadReq`, `NTV2UploadInfo`, `NTV2FileInfo`, `NTV2FileType`, `NTV2ExtBizInfo`,
      `PicExtBizInfo`, `PicExtData`, `VideoExtBizInfo`, `PttExtBizInfo`).
      ⚠️ `NTV2FileInfo` here is a **different message** from `msg-push-fields.ts`'s `FileInfo`
      (that one is the server-push one) — do not reuse the decoder's field table.
- [ ] **2. `NotOnlineImagePbReserve` encoder** — §1.5, for the private-image
      `bytesPbReserveC2c`. 8 fields, only 1 and 8 used.
- [ ] **3. `PttExtBizInfo`'s opaque reserve blobs** — the call site hardcodes
      `bytesReserve: [8,0,56,0]`, and for groups `bytesGeneralFlags: [154,1,7,170,3,4,8,8,18,0]`
      plus `waveform` from `encodePttWaveform` (`:110748`). 【指令级】`:110920-110950`.
- [ ] **4. The OIDB spec itself** — `command: 0`, `subCommand: 100`, `uinForm: true`,
      `resolveCommand: (p) => p.oidbCmd`, `encodeBody`, `decodeBody = protobuf_decode_OidbBase__
      NTV2UploadRichMediaResp`, `deserialize = deserializeUpload`. The reference's `serialize`
      is §3.1–3.4. `acceptedEnvelopeCodes` is **not** set on this spec.
- [ ] **5. `NTV2UploadRichMediaResp` decoders** — §4.12: `RespHead`, `RespBody`, `RespMsgInfo`,
      `SubFileInfoResp`, `IPv4`. Plus the two throw messages so failures get the same
      `response_invalid` / `business_rejected` classification (`:36991`, `:37001`).
- [ ] **6. `NTV2RichMediaHighwayExt` encoder** — §4.2–4.11. Must live where `upload.ts` can
      reach it (e.g. `ts/src/highway/ext.ts`); `upload.ts` already accepts `extend?: Uint8Array`
      and threads it into `bytesReqExtendInfo` (`upload.ts:290`, `:373`), so this is purely additive.
- [ ] **7. `buildHighwayExtend`** — the projection in §3.5, including the `outIp && outPort`
      filter, `ipv4ToString`, and the "one sha1 per 1 MiB block" rule.
- [ ] **8. Per-block sha1 streaming** — `hash.fileSha1[]` needs a sha1 per `HIGHWAY_BLOCK_SIZE`
      block. `ts/src/highway/` has no streaming sha1; the whole-file md5/sha1 is all the caller
      computes today. Video already needs this (its `sha1` is `sha1Blocks`).
- [ ] **9. Per-media param builders** — the tables in §3.2, plus `makeClientRandomId`
      (`crypto.randomBytes(8).readBigUInt64BE() & 0x7FFF_FFFF_FFFF_FFFFn`).
- [ ] **10. Envelope `reserved: 1`** — verify the spec carries `uinForm: true`;
      `encodeOidbEnvelope` already maps it (`envelope.ts:152`).

### 5.3 Two field-number bugs in `ts/src/highway/head.ts` — one fixed, one already correct

Found while extracting §1.6 by machine, i.e. by diffing golden bytes rather than by reading code.

| location | was | reference | status |
| --- | --- | --- | --- |
| `head.ts` `w.uint32(11, seg.cachePort)` | field **11** | field **13** | **FIXED** in `c39a2bc` — now `w.uint32(13, …)` |
| `head.ts:47` comment `11 cachePort` | documented 11 | **13** | **FIXED** — comment now reads `13 cachePort  <-- 11 and 12 are BOTH skipped` |
| `head.ts` `LoginSigHead.appId` | field 3 | field **3** | **already correct** |

Both facts are proven by §1.6 【实测】: `__write_SegHead` emits `68 90 3f` for
`cachePort = 8080`, and `68` = 104 = 13<<3 → field **13**. Field **11** would be `58`.
`__write_LoginSigHead` emits `18` = 24 = 3<<3 → field **3**, not 2.

**Why it was latent and why goldens are mandatory.** `cachePort` is `0` on every NTV2 call site,
and `ProtoWriter.uint32` elides a zero — so a golden vector with `cachePort = 0` passes under
*either* field number. The bug only surfaces on the first caller that sends a non-zero
`cachePort`. A structural (encode-then-decode) test can never catch this class of bug, because a
wrong field number makes the encoder and decoder wrong **in the same way** and they agree with
each other. Only a byte-for-byte golden extracted from the reference catches it — which is exactly
the failure mode this document exists to prevent, and it is the same lesson as the previous port's
two bad field numbers.

### 5.4 Suggested test shape

```ts
// test/ntv2-upload-codec.test.ts  (do not add to build/ — this is for the port owner)
import { GOLDEN_MINIMAL, GOLDEN_GROUP_IMAGE, GOLDEN_PRIVATE_IMAGE,
         GOLDEN_HIGHWAY_EXTEND, GOLDEN_PB_RESERVE_C2C } from "./fixtures/ntv2-goldens.js";
assert.equal(hex(encodeNTV2UploadRichMediaReq(input)), GOLDEN_GROUP_IMAGE);
```

Five vectors cover: envelope + empty body, group scene + group extBizInfo arm, private scene +
`bytesPbReserveC2c` arm, the highway extend blob, and the nested reserve sub-protobuf. Every
nested message in §2 and §4 appears in at least one of them.

---

## 6. Reproducing all of this

```bash
cd /tmp/codec
node gen.mjs && node gen2.mjs && node gen3.mjs   # build the 3 evaluable modules from the bundle
node schema2.mjs $(...) > schema_all2.json       # extract every table in §2 and §4
node crosscheck2.mjs                             # print the 4 MATCH lines + all goldens
node headgolden.mjs                              # the §1.6 chunk-head goldens
node verify.mjs && node verify2.mjs              # independent generic wire-dump of each golden
```

`reference/index.mjs` is opened read-only throughout; nothing is written outside `/tmp/`.
