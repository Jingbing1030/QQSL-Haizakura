# The highway file-transfer gap — measured

Scope: what "highway" actually is in `reference/index.mjs` (13,916,690 B, 472
`//#region` blocks), where every one of its call sites lives, what `ts/` has
today, and the smallest sequence of work that makes **one** highway operation
work end to end.

Evidence grades used throughout:

| grade | meaning |
| --- | --- |
| 【实测】 | I ran the command in this session and the output is quoted |
| 【指令级】 | static reading of the reference bundle / our source, line numbers given |
| 【推断】 | inference from naming, structure or protocol convention — not confirmed |
| 【未确认】 | nobody has verified this; do not build on it |

`reference/index.mjs` was **not modified**. No build, `tsc`, or test run was
performed (shared build dir).

---

## 0. The one-paragraph answer

Highway is **QQ's raw-TCP binary transport, not HTTP-over-`fetch` and not SSO**.
It is bootstrapped by a bare `sendRawPacket("HttpConn.0x6ff_501", …)` that
returns a `sig_session` plus a list of `ip:port` upload servers; each 1 MiB
chunk is then a `POST /cgi-bin/httpconn?htcmd=0x6FF0087&uin=<uin>` over a
hand-written HTTP/1.1 request on a raw socket, carrying a 9-byte
`'(' | BE32 headLen | BE32 bodyLen | head | body | ')'` frame. The reference
implements **all three legs** (upload ticket, POST, completion/ack) in 4,677 lines
of `highway-client.ts` plus 6,456 lines of generated NTV2 codec. Our rewrite
has the **ticket codec** (`ts/src/oidb/services/0x6ff.ts`, 465 L) and, as of
this measurement, an **in-flight partial transport** (`ts/src/highway/`) that
nothing imports yet — and **no uploader, no NTV2 upload OIDB spec, and no
`SendContext.uploadMedia` implementation**. Every highway entry point on our side
is either absent or a named throw.

---

## 1. Every highway call site in the reference

### 1.1 Method

`//#region` banners give the module a line range; hits inside that range belong
to that module. Exact commands:

```bash
cd /home/ubuntu/hook-rewrite
# 472 regions, start<TAB>end<TAB>name
awk '/^\/\/#region /{r=$0; sub(/^\/\/#region /,"",r); start=NR}
     /^\/\/#endregion/{print start"\t"NR"\t"r}' reference/index.mjs > /tmp/regions.tsv

# whole-file occurrence counts (NOT line counts — a line can carry several)
for p in highway Highway HIGHWAY HttpConn; do
  printf '%-10s %s\n' "$p" "$(grep -o -F "$p" reference/index.mjs | wc -l)"
done
```

【实测】 whole-file occurrence counts:

| token | occurrences |
| --- | ---: |
| `highway` | 73 |
| `Highway` | 111 |
| `HIGHWAY` | 25 |
| `HttpConn` | 20 |

【实测】 Per-region counts (`grep -o -i highway` restricted to the region's line
range, so `highway`+`Highway`+`HIGHWAY` collapse into one column):

| region | lines | occ | what it uploads/downloads |
| --- | ---: | ---: | --- |
| `../protocol/src/highway/upload-settings.ts` | 5110–5123 | 1 | concurrency policy (1–4) for video chunk PUTs |
| `../protocol/src/element-manifest.ts` | 6371–6904 | 1 | comment only: "media … 经 highway 上传" |
| `../protocol/src/highway/download-settings.ts` | 17924–17967 | 1 | download size cap / timeout env |
| `../protocol/src/highway/utils.ts` | 17968–18320 | 8 | `packHighwayFrame`/`unpackHighwayFrame` + `loadBinarySource` |
| `../protocol/src/highway/ffmpeg-addon.ts` | 23416–23588 | 2 | SILK transcode for **voice** (`ptt`) before upload |
| `../protocol/src/oidb-services/highway/ntv2-upload-request.ts` | 23589–30044 | 3 | **the upload-ticket OIDB spec** (`0x11c4/0x11c5/0x11e9/0x11ea/0x126d/0x126e`, sub-cmd 100) |
| `../protocol/src/highway/highway-client.ts` | 30045–34721 | **125** | **the transport**: session bootstrap, frame, TCP, chunk loop |
| `../protocol/src/highway/pipeline.ts` | 34722–37075 | 19 | `runNtv2Upload` — ticket → PUTs → `MsgInfo` |
| `../protocol/src/highway/stage.ts` | 37076–37278 | 2 | stage a source onto disk (4 GiB cap) |
| `../protocol/src/highway/sha1-stream.ts` | 37279–37375 | 1 | per-1 MiB SHA-1 state list (resumable upload) |
| `../protocol/src/highway/hash-file.ts` | 37376–37471 | 1 | streaming md5+sha1(+head md5) |
| `../protocol/src/highway/video-upload.ts` | 37472–37737 | 3 | **video** uploader (cmd 1001/1002/1005/1006, `0x11e9/0x11ea`) |
| `../onebot/src/modules/message-actions.ts` | 37905–39059 | 5 | `isHighwaySizeError` + video→file fallback |
| `../protocol/src/highway/image-upload.ts` | 109848–110578 | 2 | **image** uploader (cmd 1003/1004, `0x11c4/0x11c5`) |
| `../protocol/src/highway/ptt-waveform.ts` | 110579–110767 | 1 | waveform (`PttWaveform` proto) for voice |
| `../protocol/src/highway/ptt-upload.ts` | 110768–110972 | 2 | **voice** uploader (cmd 1007/1008, `0x126d/0x126e`) |
| `../protocol/src/element-builder.ts` | 110973–121793 | 1 | comment only: NTV2 upload via `SendContext` |
| `../protocol/src/web/group-album.ts` | 234338–234749 | 1 | comment only: same ceiling as highway video |
| **`src/bridge/apis/group-file.ts`** | **288485–290023** | **4** | **group/private file upload** (cmd 71 / 95) |
| **`src/bridge/apis/message.ts`** | **298712–309793** | **1** | comment only (media triggers uploads) |
| `../protocol/src/oidb-services/custom-face/add-custom-face.ts` | 317321–319326 | 17 | **favicon/emoji upload** (`PicUp.DataUp`, cmd 9) |
| **`src/bridge/apis/profile.ts`** | **332559–333544** | **6** | **avatar / group avatar** (cmd 90 / 3000) |

【实测】 `src/bridge/apis/group-album.ts` (234750–244037) contains **0**
highway mentions (`grep -c -i -E 'highway|ntv2|uploadHighway'` → 0, rc=1). The
layer map's "transitively by group-album.ts uploads" is wrong: the album upload
path is the **qzone web endpoint** (`uploadAlbumSlice`), a different protocol.
The only highway reference near it is the *comment* at 234339 in the
neighbouring `protocol/src/web/group-album.ts` region.

### 1.2 The actual upload entry points (the four `uploadHighwayHttp` call sites)

【实测】 `grep -n 'uploadHighwayHttp(' reference/index.mjs`:

| line | module (region) | cmdId | body | what it moves |
| ---: | --- | ---: | --- | --- |
| 34470 | `highway/highway-client.ts` | — | — | **definition** |
| 37036 | `highway/pipeline.ts` `runPuts` | `sub.cmdId` | `BufferChunkSource`/`FileChunkSource` | generic NTV2 media (image/voice/video) |
| 37037 | same, `concurrency` variant | `sub.cmdId` | same | video (parallel chunks) |
| 289790 | `src/bridge/apis/group-file.ts` `upload` | **71** | `FileChunkSource` | **group file** |
| 289859 | `src/bridge/apis/group-file.ts` `uploadPrivate` | **95** | `FileChunkSource` | **private (c2c) file** |
| 333404 | `src/bridge/apis/profile.ts` `setAvatar` | **90** | `BufferChunkSource` | **personal avatar** |
| 333429 | `src/bridge/apis/profile.ts` `setGroupAvatar` | **3000** | `BufferChunkSource` | **group avatar** |

Plus one **independent** uploader that does *not* use `uploadHighwayHttp`:

【实测】 `add-custom-face.ts:319254` calls `fetchHighwaySession(deps)` then does
its own `fetch()` POST at `319309` to
`http://${host}:${port}/cgi-bin/httpconn?htcmd=0x6FF0087&uin=${uin}` — i.e. the
same endpoint reached with `fetch` instead of a raw socket. So the reference has
**two** transports for the same wire protocol: the raw-socket one
(`httpPostFrame`) for uploads, and a `fetch` one for favicons.

### 1.3 Negative evidence — what is NOT in the bundle

【实测】 Each of these was grepped and returned nothing:

```bash
grep -c -F 'txz.qq.com'    reference/index.mjs   # 0
grep -c -F 'PttCenterSvr'  reference/index.mjs   # 0
grep -c -F 'highway_url'   reference/index.mjs   # 0
grep -c -F 'upload_ticket' reference/index.mjs   # 0
```

`nsso` → 1 hit, `upv` → 9 hits, all inside the base64 docs corpus
(`reference/index.mjs:350697` onwards) and the `qzone public upvote` code
(`:337084`). **None is a highway identifier.** `HttpServer` → 4 hits, all
`onebot/src/network/http-server-adapter.ts` (the OneBot HTTP *adapter*), not
highway.

Conclusion 【指令级】: there is **no** `txz.qq.com` upload host, no
`PttCenterSvr`, and no `*_url`/`upload_ticket` OIDB command carrying uploads.
The ticket is `HttpConn.0x6ff_501` (field 1281) and the transfer endpoint is
`/cgi-bin/httpconn?htcmd=0x6FF0087` — those are the only two, and they are the
ones the brief was guessing at.

### 1.4 The protocol, exactly

【指令级】 `reference/index.mjs` unless noted.

**(a) Upload target — the ticket.** `fetchHighwaySession` (`:34138`) sends
`bridge.sendRawPacket("HttpConn.0x6ff_501", request)` (`:34161`). The request
body is `HttpConn0x6FF501Request{ httpConn: { field1:0, field2:0, field3:16,
field4:1, field6:3, serviceTypes:[1,5,10,21], field9:2, field10:9, field11:8,
ver:"1.0.1" } }`. Response → `{ sigSession, sessionKey, servers[] }`; only
`serverInfos[].serviceType === 1` is used, addresses need `ip != 0 && 0 < port
<= 65535`, and duplicates collapse on `host:port`. Two hard failures:
`"HttpConn response missing sig_session"`, `"HttpConn response has no upload
servers"`.

**(b) The POST.** `httpPostFrame` (`:34396`) writes, over a socket from
`tcpConnect` (`:34267`):

```
POST /cgi-bin/httpconn?htcmd=0x6FF0087&uin=<uin> HTTP/1.1
Host: <ip>:<port>
Connection: keep-alive
Accept-Encoding: identity
User-Agent: Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2)
Content-Length: <n>
```

`pathStr` is built once at `:34506`. Chunk size is `HIGHWAY_BLOCK_SIZE = 1 MiB`
(`:34098`); `HIGHWAY_APP_ID = 1600001604`; the head is
`ReqDataHighwayHead{ msgBaseHead{version:1, uin, command:"PicUp.DataUp", seq,
retryTimes, appId, dataFlag:16, commandId}, msgSegHead{filesize, dataOffset,
dataLength, serviceTicket:sigSession, md5:chunkMd5, fileMd5, …},
bytesReqExtendInfo, timestamp:0, msgLoginSigHead{loginSigType:8, appId} }`
(`makeHighwayHead`, `:34204`).

**(c) The frame.** `packHighwayFrame` (`:18290`): byte `0x28`, BE32 headLen,
BE32 bodyLen, head, body, byte `0x29`. **Big-endian**, and the parens are
literals, not a protobuf tag.

**(d) The completion / ack.** Per chunk, after the POST the reference decodes
`RespDataHighwayHead` (`:34624`) and requires `errorCode === 0 &&
segRetCode === 0`, then verifies the acknowledgement triple
`msgBaseHead.seq === requestSequence`, `msgSegHead.filesize === totalSize`,
`msgSegHead.dataOffset === offset`, `msgSegHead.dataLength === chunkSize`, else
`"highway acknowledgement mismatch …"` (`:34648`). Special case: error codes
`102902` / `302902` (`HIGHWAY_DELAY_RETRY_CODES`) are *backpressure* — sleep
250 ms, drop concurrency to 1, retry up to 8 times (`:34631`). Transport retries
cap at 3 with `300 * attempt` ms backoff. The upload is only "done" when
`trace.uploadedBytes === totalSize && contiguous === pieces` (`:34699`).

**Important:** there is no separate "commit" RPC. The ack on the last chunk *is*
the completion, and `pipeline.ts`'s job is then to re-encode the server's
`msgInfo` into the outgoing `commonElem`
(`finalizeMediaMsgInfo`, `:37054` → `protobuf_encode_EncodableMediaMsgInfo`).
For group files the "completion" is a **separate OIDB call**:
`PublishGroupFile` (`:277345`, command 1753 sub 4) — and it is only called when
`publishFile` is true.

---

## 2. What our rewrite currently has

### 2.1 Inventory

【实测】 `find ts/src -iname '*upload*' -o -iname '*binary*' -o -iname '*highway*' -o -iname '*frame*'`:

```
ts/src/bridge/web/album-upload.ts     (879 L)  qzone web album — NOT highway
ts/src/bridge/web/binary-source.ts    (227 L)  loadBinarySource only
ts/src/highway/frame.ts               (119 L)  packHighwayFrame/unpackHighwayFrame
ts/src/highway/head.ts                (286 L)  ReqDataHighwayHead codec
ts/src/highway/transport.ts           (376 L)  tcpConnect/connectHighway/httpPostFrame
ts/src/oidb/services/0x6ff.ts         (465 L)  the upload-ticket codec
```

⚠️ **`ts/src/highway/` is untracked and was being written by another agent
while I measured** (`git status --short` → `?? ts/src/highway/`; `head.ts`
appeared at 04:51 between two of my listings). Treat §2.2/§2.3 as a snapshot:
at 04:55 `frame.ts` md5 `b133f04…` (119 L), `head.ts` `0c9c279…` (297 L, **changed twice
while I measured: 286 L at 04:51, 297 L at 04:55**), `transport.ts` `2b09e9f…` (376 L).
Re-check with `wc -l ts/src/highway/*.ts` before relying on any line number in §2.

### 2.2 What is genuinely implemented

| piece | file | state |
| --- | --- | --- |
| upload ticket **codec** | `ts/src/oidb/services/0x6ff.ts` | 【指令级】 complete: encode request (field 1281, unpacked `serviceTypes`), decode response, `toHighwaySession` with the reference's exact filter chain and both error strings |
| ticket **projection** | same, `HighwaySession` | 【指令级】 `{sigSession, sessionKey, servers[]}` |
| frame pack/unpack | `ts/src/highway/frame.ts` | 【指令级】 BE32 + `0x28`/`0x29`, `"invalid highway response frame"` verbatim |
| `ReqDataHighwayHead` encode | `ts/src/highway/head.ts:212` | 【指令级】 `encodeReqDataHighwayHead` + constants |
| `RespDataHighwayHead` decode | `ts/src/highway/head.ts:272` | 【指令级】 `decodeRespDataHighwayHead` |
| raw-socket transport | `ts/src/highway/transport.ts` | 【指令级】 `tcpConnect`/`connectHighway`/`readHttpResponseBody`/`httpPostFrame`, same UA and headers |
| streaming hashing | `ts/src/bridge/web/album-upload.ts:864` | 【指令级】 `hashFileStreaming` → md5+sha1+hex. **No `sha1Blocks`, no `headMd5`** — the doc comment says so explicitly |
| binary loading | `ts/src/bridge/web/binary-source.ts` | 【指令级】 `loadBinarySource`/`inlineBase64Payload`/`resolveLocalFilePath` |
| image sniffing | `ts/src/bridge/web/album-upload.ts:122` | 【指令级】 `detectImageFormat` |
| media seam **type** | `ts/src/element-builder.ts:1230` | 【指令级】 `uploadMedia?: MediaUploader` declared on `SendContext` |

### 2.3 What is a stub, a throw, or absent

**【实测】 nothing imports `ts/src/highway/`:**

```bash
cd /home/ubuntu/hook-rewrite/ts
grep -rn 'highway/frame\|highway/transport\|from "../highway\|from "../../highway"' src/
# rc=1, no output
grep -rn 'HttpConnSession\.\|encodeHttpConn0x6FF501Request(' src/
# rc=0 but the ONLY hit is the definition at src/oidb/services/0x6ff.ts:216
```

So the ticket codec is **exported from `oidb/services/index.ts` and never
invoked**; the transport is **not reachable from any code path**. Both are
library code with no caller.

The codecs are *tested*, which makes the point sharper — this is not
half-finished work, it is finished work with nothing plugged into it:

【实测】 `ls ts/test/*highway* ; grep -rln '0x6ff\|highway' ts/test/`
→ `test/highway-frame.test.ts` (158 L), `test/oidb-batch-a.test.ts` (the
`0x6ff_501` request/response goldens, at `:433-460`), plus
`test/element-builder.test.ts` and `test/bridge-album.test.ts`. The only test
that mentions the uploader names is `test/group-file-actions.test.ts:671`, and it
asserts the **throw message** — nothing exercises an upload.

**【实测】 `SendContext.uploadMedia` is never assigned:**

```bash
grep -rn 'uploadMedia:' src/     # rc=1, no output
```

`element-builder.ts` therefore always throws
`'message element "image" requires SendContext'` (`:1905`, `:1932`, `:1952`).

**Hard stubs (quoted):**

`ts/src/bridge/apis/group-file.ts:383` — `upload`:

> ```ts
> throw new Error(
>   "upload_group_file is not implemented in this port: the file transfer needs the Highway " +
>     "upload channel (fetchHighwaySession -> uploadHighwayHttp with a FileUploadExt body), " +
>     "which does not exist here. The OIDB half (0x6d6_0 UploadGroupFile) is ported; the " +
>     "QQQ frame packer and the resumable PUT loop are not.",
> );
> ```

`ts/src/bridge/apis/group-file.ts:406` — `uploadPrivate`: same shape, throwing
`"upload_private_file is not implemented in this port: … (PrivateFileUploadExt, command 95), …"`.

`ts/src/host/action-context-host.ts:575` — `profile.setGroupAvatar`:

> ```ts
> setGroupAvatar: (): Promise<void> =>
>   Promise.reject(
>     new HostNotImplementedError(
>       "bridge.apis.profile.setGroupAvatar",
>       "needs the Highway upload channel and a hand-encoded GroupAvatarExtra blob, " +
>         "neither of which exists in this port (profile.ts header)",
>     ),
>   ),
> ```

`ts/src/host/action-context-host.ts:1303,1314,1325,1335` — `sendForwardMsg` /
`sendGroupForwardMsg` / `sendPrivateForwardMsg` / `forwardSingleMsg` all
`notImplemented(…)` citing "the Highway forward uploader". (Note: this one is
【指令级】 **over-cautious** — see §3.4.)

`ts/src/bridge/apis/profile.ts` — `setAvatar`, `setGroupAvatar` and
`addCustomFace` are **absent entirely** (not stubbed); the header at `:41-51`
says so.

**【实测】 absent codecs (all rc=1):**

```bash
grep -rn 'subCommand: 100'                  src/   # rc=1  — no NTV2 upload OIDB spec
grep -rn 'UploadRichMedia'                  src/   # rc=1  — no NTV2UploadRichMediaReq/Resp
grep -rn 'EncodableMediaMsgInfo'            src/   # rc=1  — no MsgInfo encoder
grep -rn 'FileUploadExt'                    src/   # rc=1  — only in comments
grep -rn 'PrivateFileUploadExt'             src/   # rc=1  — only in comments
grep -rn 'GroupAvatarExtra'                 src/   # rc=1  — only in comments
grep -rn 'makeHighwayHead\|buildHighwayExtend' src/ # rc=1
grep -rn 'FileChunkSource\|BufferChunkSource'  src/ # rc=1
grep -rn 'HIGHWAY_BLOCK_SIZE'               src/   # rc=1
grep -rn 'isHighwaySizeError'               src/   # rc=1
grep -rn 'computeMd5'                       src/   # rc=1  (only md5FromEmojiId / md5BytesFromHex)
```

---

## 3. The concrete seam

The brief's three-part model is right, with one correction: **the completion
call is not part of highway for media** — it is a separate OIDB packet, and for
group files it is *optional*.

### 3.1 Upload target (`HttpConn.0x6ff_501` → `sig_session` + servers)

| | reference | our rewrite | where it would live |
| --- | --- | --- | --- |
| encode request | 【指令级】 `:34142` (the hard-coded values) | 【指令级】 `0x6ff.ts:216` ✅ | — |
| decode response | 【指令级】 `:34165` | 【指令级】 `0x6ff.ts:352` ✅ | — |
| session projection + filters | 【指令级】 `:34168` | 【指令级】 `0x6ff.ts:404` ✅ | — |
| **the `sendRawPacket` call itself** | 【指令级】 `:34161` | ❌ **absent** | new `ts/src/highway/session.ts`, ~30 L, over `BridgeContext.sendRawPacket` (already exists, `bridge.ts:342`) |

The only missing piece is a 20-line function that calls
`ctx.sendRawPacket(HTTPCONN_SESSION_WIRE_NAME, encodeHttpConn0x6FF501Request(HTTPCONN_SESSION_REQUEST))`
and passes the result to `toHighwaySession`. Everything it needs is already
written and already tested.

### 3.2 The HTTP POST

| | reference | our rewrite | where |
| --- | --- | --- | --- |
| frame packer | 【指令级】 `:18290` | 【指令级】 `highway/frame.ts:61` ✅ | — |
| `ReqDataHighwayHead` encode | 【指令级】 `:34204` | 【指令级】 `highway/head.ts:212` ✅ | — |
| raw socket + HTTP/1.1 | 【指令级】 `:34267`, `:34302`, `:34330`, `:34396` | 【指令级】 `highway/transport.ts` ✅ | — |
| **the chunk loop** | 【指令级】 `:34470-34720` ⬅ `uploadHighwayHttpOperation` is `:34504` | ❌ **absent** | `ts/src/highway/upload.ts`, ~250 L |
| **`RespDataHighwayHead` ack check** | 【指令级】 decode `:34624`, verify `:34648` | ⚠️ decoder ✅ (`head.ts:272`), **verify absent** | same |
| **`FileUploadExt` / `PrivateFileUploadExt` / `GroupAvatarExtra` / `NTV2RichMediaHighwayExt` encoders** | 【指令级】 `:289652`, `:289690`, `:333425`, `:34237` | ❌ **absent** (4 messages) | `ts/src/highway/ext.ts` or the owning API module |
| **`FileChunkSource` / `BufferChunkSource`** | 【指令级】 `:34424,34445` | ❌ **absent** | `ts/src/highway/source.ts`, ~60 L |

The chunk loop is the load-bearing piece: read 1 MiB → md5 → build head →
`packHighwayFrame` → `httpPostFrame` → `unpackHighwayFrame` → decode ack →
verify → next chunk, with the retry/backpressure state machine. **All of its
imports already exist**; it is pure new control flow.

### 3.3 The completion call

| | reference | our rewrite |
| --- | --- | --- |
| media: re-encode `msgInfo` into `commonElem` | 【指令级】 `finalizeMediaMsgInfo` `:37054` | ❌ `EncodableMediaMsgInfo` encoder absent |
| media: the "done" signal | 【指令级】 the last chunk's ack (`:34699`) | ❌ (falls out of §3.2) |
| group file: `PublishGroupFile` (1753_4) | 【指令级】 `:289733` → `:277345` | 【指令级】 `0x6d9.ts:339` ✅ **ported** |
| private file: `sendC2cFile` | 【指令级】 `:289862` | 【指令级】 `message.ts` ✅ (the `sendC2cFile` path exists) |

So the completion leg is **not** a gap for group files — `PublishGroupFile` is
already ported. It *is* a gap for media, but that gap is one encoder
(`EncodableMediaMsgInfo` + `ExtBizInfo`), not a transport.

### 3.4 Why the forward stubs are over-cautious (a free win)

【实测】

```bash
awk -F'\t' '$3 ~ /apis\/forward.ts/' /tmp/regions.tsv
#   177314  194906  src/bridge/apis/forward.ts
awk 'NR>=177314 && NR<=194906' reference/index.mjs | grep -c -i highway
#   0   (rc=1)
```

`uploadForwardMessage` (`:38545`) is
`parseForwardNodes(...)` → `ref.bridge.apis.forward.upload(nodes, groupId)`, and
`src/bridge/apis/forward.ts` has **zero** highway references. The merged-forward
card is a `ForwardNode[]` inside `SsoRecvLongMsg`, not a highway upload. The
four `notImplemented` throws at `action-context-host.ts:1303-1335` cite a
dependency that does not exist; they are gated on `apis/forward.ts` being
ported, not on highway. **Worth reporting to whoever owns that file** — it is
not part of this gap.

---

## 4. Minimum viable slice

**Recommendation: image upload for `send_group_msg`.** Reasons, all 【指令级】:

1. Its body is `BufferChunkSource` — **no disk staging** (`stage.ts`, 203 L) and
   **no `FileChunkSource`** (60 L) needed for the first cut.
2. It has **one** sub-upload, so no `subFileInfos` / `subFileIndex` /
   `fastUpload` / multi-PUT orchestration (`runPuts`'s loop over `uploads`).
3. Its `extend` blob is `NTV2RichMediaHighwayExt` (`:33545`) — the *generic*
   media one, shared with voice and video, so it is not throwaway work.
4. The completion leg is the `finalizeMediaMsgInfo` re-encode, which is the
   same for voice and video.
5. It does **not** need `PublishGroupFile` (already ported) or
   `GroupAvatarExtra` (hand-encoded constants) or SILK/ffmpeg (voice) or
   thumbnailing (video).
6. Group scene omits the c2c `bytesPbReserveC2c` branch entirely
   (`:110510`), halving the `PicExtBizInfo` work.

### 4.1 Ordered steps

Each step is independently testable. **Do not start step *n+1* before step *n*
has a passing test**, because every later step's failure mode is a silent
protocol mismatch.

| # | step | file | ~L | done when |
| ---: | --- | --- | ---: | --- |
| 1 | **`fetchHighwaySession`** — call `sendRawPacket("HttpConn.0x6ff_501", …)` and project. Everything else exists. | new `ts/src/highway/session.ts` | 30 | a fake `sendRawPacket` returning a canned `HttpConn0x6FF501Response` yields `{sigSession, servers}`; both error strings reproduce |
| 2 | **`BufferChunkSource`** — `size`/`read(offset,len)`/`close()` (`:34424`) | new `ts/src/highway/source.ts` | 30 | read past end returns short slice; `close()` resolves |
| 3 | **`makeHighwayHead`** — `ReqDataHighwayHead` with `commandId`, `uin`, `sigSession` as `serviceTicket`, `md5` = chunk md5, `fileMd5` = whole-file md5, `extend` | new `ts/src/highway/upload.ts` | 50 | golden-bytes test against a hand-built head; field numbers 1/2/3/4/5, no field 5 in `SegHead` |
| 4 | **`httpPostFrame` + frame round-trip** — already written; **add a test** | `ts/src/highway/transport.ts` (exists) | 0 | a local `net.createServer` echoing a valid `RespDataHighwayHead` frame decodes |
| 5 | **`NTV2RichMediaHighwayExt` encoder** (`:33545`) — `fileUuid`, `uKey`, `network.ipv4s`, `msgInfoBody[]`, `blockSize`, `hash.fileSha1` | new `ts/src/highway/ext.ts` | 120 | byte-identical to a golden extracted from the reference's own encoder |
| 6 | **the chunk loop** — single-chunk path only: one 1 MiB (or smaller) read, one POST, ack verify, return. **No retry, no concurrency, no `102902`** | `ts/src/highway/upload.ts` | 120 | against a fake server: success path returns; `errorCode != 0` throws; ack mismatch throws |
| 7 | **`NTV2UploadRichMediaReq` / `…Resp` OIDB spec** — command `0x11c5` (c2c) / `0x11c4` (group), sub-command **100**, `uinForm: true`, `resolveCommand: p => p.oidbCmd`. This is the 6,456-line generated region; **port only the fields image needs** | `ts/src/oidb/services/0x11c4.ts` | 200–400 | request encodes; response's `upload.msgInfo` decodes |
| 8 | **`EncodableMediaMsgInfo` encoder** — inside `finalizeMediaMsgInfo` (`:37054`); `msgInfoBody[]` + `extBizInfo{pic}` | `ts/src/highway/ext.ts` | 80 | byte-identical golden |
| 9 | **`runNtv2Upload`** — image-only: build `uploadInfo[1]`, call the spec, if `uKey` non-empty do step 6, then step 8 | `ts/src/highway/pipeline.ts` | 100 | end-to-end against fakes |
| 10 | **wire `SendContext.uploadMedia`** — `makeImageElem`'s `ctx.uploadMedia(segment)` must be supplied by whoever builds `SendContext`; today **nobody assigns it** | `ts/src/host/action-context-host.ts` (or `message.ts:544` `sendGroup`) | 40 | `send_group_msg` with an `image` segment reaches `runNtv2Upload` instead of throwing |

**Total: roughly 800–1,100 hand-written lines**, plus the generated NTV2 codec
(step 7, the only mechanically large piece — and it can be image-only).

### 4.2 What is explicitly NOT in this slice

- **Disk staging** (`stage.ts`) and **`FileChunkSource`** — needed for group
  files and >4 GiB media only.
- **`sha1Blocks`** (per-1 MiB SHA-1 state list) — needed for resumable video,
  not for image. `hashFileStreaming` in `album-upload.ts` already documents
  that it omits it.
- **`PublishGroupFile`** — already ported, so nothing to do.
- **`FileUploadExt` / `PrivateFileUploadExt` / `GroupAvatarExtra`** — three
  separate encoders for three separate commands (71 / 95 / 90+3000).
- **`isHighwaySizeError` + video→file fallback** — a `message-actions` concern.
- **Concurrency / backpressure / retry** — image is one chunk; the 3-attempt
  transport retry and the `102902` sleep-to-1-concurrency path are video-only
  value.

### 4.3 The one thing to verify before writing any of this

【未确认】 No step above has been run against a real QQ. Steps 1, 5, 7 and 8
are all **byte-exactness** problems — if any of them is off by one field number
the server answers with a parse error, not a diagnostic. Extract goldens from
`reference/index.mjs`'s own encoders (they are all in the bundle, e.g.
`protobuf_encode_NTV2RichMediaHighwayExt` at `:33545`) **before** writing the encoders, and diff the
bytes. That is cheaper than debugging a silent rejection.
