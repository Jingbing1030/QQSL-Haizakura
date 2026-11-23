# The bridge layer (`src/bridge`)

Status as of 2026-11-21. Everything below is measured against
`reference/index.mjs` (13,916,690 B, 472 `//#region` markers) — region line
numbers are 1-based and current. Nothing here is inferred from a bundle-wide
grep: a bare-name search across the bundle reads a *different* module's code,
because each region re-declares its helpers with `$N` suffixes. Every claim below
was read out of its own region.

---

## 1. The `ctx` contract

### 1.1 `ctx` is the `Bridge` instance

Not a facade, not a slice object, not a plain record. It is the `Bridge` object
itself, passed whole, and every bridge module receives it verbatim:

```js
// reference/index.mjs:338910  (src/bridge/apis/web.ts)
function asBridge(ctx) {
	return ctx;
}
```

The `asBridge` helper is the proof and the reason it exists: `WebApi`'s methods are
declared `async getCookies(domain)` and read `this.ctx`, and `asBridge(this.ctx)`
tells the type checker that the `BridgeContext` it holds is assignable to whatever
the free functions below it demand (`Bridge`). It is an identity function with a
type annotation, and any implementation that made `ctx` a narrower object would
have to delete it.

The other end of the same fact:

```js
// reference/index.mjs:82649-82650  (../protocol/src/self-uid.ts)
 * Takes just the `BridgeContext` slice it needs, so both a full `Bridge` and a
 * bare context (e.g. an OIDB service's Deps) satisfy it.
```

So the contract is *structural* and deliberately loose: an OIDB service's dependency
object and a full `Bridge` both satisfy `BridgeContext`. That is what lets
`invokeOidb` be called with either.

### 1.2 The complete member list — ten members, counted

Across all 21 bridge regions there are exactly **ten** distinct members read off
`ctx`. Counted by grep over the split regions, not remembered:

| member | uses | what it is |
| --- | --- | --- |
| `ctx.identity` | 87 | the roster (`IdentityService`) |
| `ctx.apis` | 39 | the cross-API hub |
| `ctx.sendRawPacket` | 19 | the OIDB/raw transport |
| `ctx.resolveUserUid` | 8 | uin→uid with a group hint |
| `ctx.nextMessageRandom` | 5 | 32-bit LCG |
| `ctx.nextClientSequence` | 4 | monotonic counter |
| `ctx.recallUploadedFile` | 3 | upload-metadata cache read |
| `ctx.events` | 2 | the event bus |
| `ctx.rememberUploadedFile` | 2 | upload-metadata cache write |
| `ctx.dispose` | 1 | comments only |

There is **no `ctx.log`, no `ctx.config`, no `ctx.request`, no `ctx.bridge`, no
`ctx.options`, no `ctx.store`.** Four things people expect to find and will not:

- **Logging is not on `ctx`.** Each module creates its own logger at module scope:
  `var log$30 = createLogger("Bridge.GroupAdmin")` (reference/index.mjs:234065).
  Twenty-one modules, twenty-one loggers, zero `ctx.log` calls. A port that put a
  logger on the context would make every module's scope depend on construction
  order, which the reference avoids on purpose.
- **Config is not on `ctx`.** The handful of tunables come from `process.env` read at
  module scope (`SNOWLUMA_VERBOSE_WARMUP`, `SNOWLUMA_PACKET_TIMEOUT_MS`, …).
- **No HTTP client on `ctx`.** Every web call goes through `RequestUtil`, a module
  singleton, or through `ctx.apis.web.getCookies` for credentials only.
- **`identity.uin` is a string.** `IdentityService.uin_` is assigned from the
  constructor's `uin` argument and every URL builder concatenates it:
  `"...&clientuin=" + bridge.identity.uin + "&clientkey=" + ...`. Typing it as a
  number would silently change those URLs (no `.0`, but a different `String()`
  coercion path once anything does arithmetic). Bridge code that needs a number
  does `Number(this.ctx.identity.uin)` explicitly — e.g.
  `apis/group-admin.ts` at reference/index.mjs:234618.

### 1.3 `ctx.identity` — the 17 members bridge code touches

`IdentityService` is 1074 lines and mostly SQLite; the bridge layer touches this
slice:

```
close                       findGroupMember          forgetGroup
findUidByUin                findUinByUid             initialization
nickname                    rememberFriends          rememberGroupMembers
rememberGroupRequests       rememberGroups           rememberUserProfile
resolveUid                  selfUid                  setFetcher
setSelfProfile              uin
```

Two of these need comment:

- **`initialization` is a promise nothing in the bridge layer reads a value from.**
  `Bridge.onPacket` chains *every* inbound packet on it
  (`reference/index.mjs:347456`), so a packet that arrives before the roster is
  warm is **delayed, not dropped**. Any port that resolves packets immediately
  will emit events with `uid === ""`.
- **`resolveUid` throws; `findUidByUin` returns null.** They are not interchangeable.
  The OIDB `serialize` hooks use `resolveUid` (14 call sites) because a request with
  no uid cannot be built at all; the bridge uses `findUidByUin` where "unknown"
  is an acceptable answer that becomes `0`.

### 1.4 `ctx` ⊃ `OidbContext`, one-way

`ts/src/oidb/spec.ts` declares:

```ts
export interface OidbContext {
  sendRawPacket(wireName: string, request: Uint8Array, timeoutMs?: number): Promise<OidbTransportResult>;
}
```

The port's `BridgeContext` declares the same method with `PacketSendResult`, which
it defines as `interface PacketSendResult extends OidbTransportResult {}`. That
makes `BridgeContext` assignable to `OidbContext` with no cast, which is the whole
reason the two layers compose: `invokeOidb(ctx, spec, params)` accepts a `Bridge`
directly.

The one place the shapes almost diverged: the reference's "no sender" answer sets
`responseData: null` (`reference/index.mjs:347543`), while `OidbTransportResult`
declares it optional-and-absent. `invokeOidb` reads it as
`result.responseData ?? new Uint8Array(0)` (reference/index.mjs:19136 region), so
`null` and `undefined` are interchangeable to it. The port uses `undefined`,
which keeps the types compatible under `exactOptionalPropertyTypes` without a
widening cast.

### 1.5 The `.invoke` adapter, and why it is not on the specs

Every bridge call site reads `ClassName.invoke(this.ctx, params)`. That member is
attached to the spec *after* its declaration:

```js
_GetPskey.invoke = (deps, params) => invokeOidb(deps, GetPskey, params);
// reference/index.mjs:42569
```

`ts/src/oidb/spec.ts` does not have it (and is not to be modified), so the port
rebuilds the surface in `ts/src/bridge/oidb-invoke.ts` as
`oidbCaller(spec).invoke(ctx, params, timeoutMs?)`.

Putting `.invoke` on the specs instead would invert the dependency: the OIDB barrel
would become the authority on the bridge context, and the same three-line template
would be redefined for each of the 92 commands. One adapter, one place.

### 1.6 The transport's failure policy

With no PID bound, `sendRawPacket` **returns** a sentinel and does not throw:

```js
return {
  success: false,
  gotResponse: false,
  errorCode: -1,
  errorMessage: "no packet sender attached",
  responseData: null
};
// reference/index.mjs:347538-347544
```

This is load-bearing. `invokeOidb` turns `gotResponse: false` into an error naming
the *command*, so "QQ is not running" reaches the OneBot caller as a failed action
with a useful message. Throwing here would surface as an unhandled rejection from a
background task instead.

---

## 2. Module inventory

### 2.1 Totals

**46,399 lines / 1,502,776 bytes across 21 regions.** The task's figure matches.

Ported in this pass: **4,787 lines** of new TypeScript across 17 files, plus 904
lines of tests. That is ~10% of the reference's line count but a much larger share
of the layer's *usable* surface, because the ported modules are the ones everything
else authenticates through.

### 2.2 Every module, with line count and OIDB dependency count

`deps` = distinct `X.invoke(` classes in the region. `missing` = those not yet
exported by `ts/src/oidb/services/*.ts`. Regenerate with
`node work/bridge-deps.mjs`.

| module | lines | deps | missing | verdict |
| --- | ---: | ---: | ---: | --- |
| `apis/collection.ts` | 21 | 1 | 0 | **PORTED** |
| `apis/web.ts` | 232 | 2 | 0 | **PORTED** |
| `apis/message.ts` | 11,082 | 1 | **0** | **PORTED** (rebase; see §2.6) |
| `apis/extras.ts` | 1,422 | 5 | 4 | blocked |
| `apis/friend.ts` | 83 | 7 | 4 | blocked |
| `apis/misc.ts` | 789 | 5 | 4 | blocked |
| `apis/contacts.ts` | 386 | 15 | 5 | blocked |
| `apis/interaction.ts` | 65 | 6 | 5 | blocked |
| `apis/group-file.ts` | 1,539 | 19 | 6 | blocked |
| `apis/group-admin.ts` | 274 | 27 | 8 | blocked |
| `apis/profile.ts` | 986 | 12 | 9 | blocked |
| `apis/flash-transfer.ts` | 1,692 | 13 | 12 | blocked |

And the nine modules that call **no** OIDB layer, and are therefore invisible to
`bridge-deps.mjs`:

| module | lines | what it actually needs |
| --- | ---: | --- |
| `apis/forward.ts` | 17,593 | `sendRawPacket` directly (`trpc.group.long_msg_interface.MsgService.SsoSendLongMsg` / `SsoRecvLongMsg`), plus `contacts.*` and `groupFile.*` |
| `apis/group-album.ts` | 9,288 | cookies only (`apis.web.getCookies("qzone.qq.com")`) |
| `apis/qzone.ts` | 158 | cookies only |
| `bridge.ts` | 371 | `contacts.*` (6 methods) + the packet pipeline |
| `manager.ts` | 249 | `Bridge` + the hook's PID lifecycle |
| `apis/history-request-gate.ts` | 72 | nothing |
| `apis/forward-cache.ts` | 39 | nothing |
| `apis/index.ts` | 30 | the 15 API classes |
| `apis/system-face.ts` | 28 | `MessageApi` (cross-API) |

### 2.3 The headline number under-describes the work, and over-describes it

Two corrections to the "73 missing OIDB classes" framing, both structural:

**Under-describes.** Three of the 21 modules — `forward.ts`, `group-album.ts`,
`qzone.ts` — total **28,039 lines, 60% of the layer's bulk**, and never touch OIDB
at all. `forward.ts` is the single largest file in the layer at 17,593 lines, and it
talks to `trpc.group.long_msg_interface` over raw packets. Anyone scheduling the
layer by OIDB dependencies will not see 60% of it.

**Over-describes.** `apis/group-admin.ts` is 274 lines and needs **27** OIDB
classes. Effort is roughly *inverse* to file size across this layer: the four
smallest OIDB-using modules (`friend.ts` 83, `interaction.ts` 65, `group-admin.ts`
274, `contacts.ts` 386) need 55 classes between them, while `message.ts` at 11,082
lines needs exactly **one**.

The reason is that a bridge module is thin by construction — its methods are
`return SomeOidbClass.invoke(this.ctx, {...})` — so a module's line count measures
how many *fields* it maps, and its dependency count measures how many *commands* it
wraps. `group-admin.ts` is 27 commands of pure delegation; `message.ts` is one
command (`MessageSvc.PbSendMsg`, which already exists) plus 11,000 lines of element
marshalling and result mapping.

### 2.4 The missing classes, grouped by module

58 distinct classes still missing (down from 73 as sibling batches land). Grouped by
the module that needs them, in ascending order of blocking severity:

**`apis/message.ts`** — **0 classes.** `FinalizeOfflineFile` was recorded here as
missing and it was not: it has existed since the 0x3639 batch at
`ts/src/oidb/services/0x3639-offline.ts:721`, with exactly the parameter shape the
reference calls it with (`{senderUid, receiverUid, fileUuid, fileHash}`) and a result
of `OidbOfflineFileMetadata | Record<string, never>`. The `1` in this table was a
**barrel-export gap**, not a missing implementation: the spec is not re-exported from
`ts/src/oidb/services/index.ts`. `message.ts` imports it from its defining module
directly, so the gap is now a one-line change for whoever owns the barrel — nothing
left to port. See §2.6.
**`apis/extras.ts`** — 4: `FetchAiVoice`, `FetchAiVoiceList`, `GetGroupTodoList`, `GroupTodo`
**`apis/friend.ts`** — 4: `ApproveDoubtBuddyReq`, `GetDoubtBuddyReq`, `HandleFriendRequest`, `RejectDoubtBuddyReq`
**`apis/misc.ts`** — 4: `ImageOcr`, `RequestDbKey`, `SendGroupSign`, `TranslateEnToZh`
**`apis/contacts.ts`** — 5: `FetchDownloadRkeys`, `FetchGroupRequestsByUid`, `FetchRobotUinRanges`, `GetGroupShareLink`, `SendTuwenArk`
**`apis/interaction.ts`** — 5: `FetchReactionSummary`, `GetEmojiLikes`, `SendPoke`, `SetEssence`, `SetReaction`
**`apis/group-file.ts`** — 6: `GetGroupVideoUrl`, `GetPrivateFileUrl`, `GetPrivatePttUrl`, `GetPrivateVideoUrl`, `UploadGroupFileRequest`, `UploadPrivateFileRequest`
**`apis/group-admin.ts`** — 8: `LeaveGroup`, `MuteAll`, `SetAddOption`, `SetAdmin`, `SetMemberInvitePolicy`, `SetMemberPermission`, `SetNewMemberHistoryVisibility`, `SetSearch`
**`apis/profile.ts`** — 9: `AddCustomFace`, `DeleteCustomFace`, `FetchCustomFaceDetail`, `FetchCustomFaceList`, `GetUnidirectionalFriendList`, `ModifyCustomFace`, `MoveCustomFace`, `OrderCustomFace`, `SetInputStatus`
**`apis/flash-transfer.ts`** — 12: `ApplyFileset`, `ApplyUpload`, `CommitFile`, `CompleteFileset`, `DeleteFlashFile`, `GetDownloadUrl`, `GetFilesetDetail`, `ListFilesets`, `PrepareUpload`, `RenameFlashFile`, `SendFlashMsg`, `SetFilesetStatus`

**Every missing class has exactly one consumer.** There is no "port this one class
and unblock six modules" win anywhere in the layer — the reuse graph is flat. That
changes the scheduling calculus completely: porting order should follow *user-facing
value per class*, not fan-in, because fan-in is uniformly 1.

### 2.5 Cross-API calls — the five modules that reach across

`ctx.apis` exists so an API can call another. Only five modules do:

| caller | reaches |
| --- | --- |
| `apis/forward.ts` | `contacts.fetchGroupMemberList`, `contacts.fetchUserProfile`, `groupFile.getPrivateUrl/getUrl/upload/uploadPrivate` |
| `apis/friend.ts` | `contacts.fetchFriendList` |
| `apis/group-album.ts` | `web.getCookies` |
| `apis/qzone.ts` | `web.getCookies` |
| `apis/group-file.ts` | `message.sendC2cFile` |
| `bridge.ts` | `contacts.fetchFriendList/fetchGroupList/fetchGroupMemberList/fetchUserProfile/fetchUserProfileByUid/groupInvites/resolveGroupJoinRequest` |

Note what this means for construction order: `WebApi` must exist before
`GroupAlbumApi` and `QzoneApi` can be *called* (not constructed — the hub is built
eagerly, and the reference says so in `apis/index.ts`'s own comment: *"Called once
from the Bridge constructor. Eager construction means every Bridge instance pays the
cost up-front (a few object allocations) — there's no lazy path because that would
require either a thunk-based wrapper or runtime-mutated `apis.xxx` slots, neither of
which is worth the complexity for ~13 small classes."*).

### 2.6 `apis/message.ts` — how 11,082 lines became 660

This module was the largest single blocker in the layer and it turned out to be
almost entirely generated code. Recording the shape, because the same rebase applies
to the other big modules.

| | lines | what it is |
| --- | ---: | --- |
| reference region (298712–309793) | 11,081 | one `//#region` |
| generated codec | ~10,420 | 99 functions: 24 messages × (`protobuf_encode_*`, `__size_*`, `__write_*`) + 5 decoder trees |
| real logic | **661** | `MessageApi` + 15 helpers + constants |
| **ported to** `message-wire.ts` | 1,130 | all of the codec, on `ProtoWriter`/`ProtoReader` |
| **ported to** `dataline.ts` | 500 | the dataline codec + the 3-device table |
| **ported to** `message.ts` | 1,403 | `MessageApi` + helpers + documented traps |
| **ported to** `history-fetch.ts` | 401 | the 3 history fetchers + the blank filter |
| **ported to** `history-request-gate.ts` | 159 | the 71-line gate |
| `test/bridge-message.test.ts` | 1,077 | 69 differential + behavioural tests |
| `test/helpers/message-oracle.ts` | 206 | rebuilds the oracle from `reference/index.mjs` |

The five ported source files total 3,593 lines against 11,081 reference lines, of
which **2,379 are non-comment, non-blank** (message-wire 729, message 984, dataline
334, history-fetch 253, gate 79). The remaining 1,214 are comments, and the density is
deliberate: each of the seven corrected assumptions above is a trap that produces
bytes which decode cleanly and mean something else, so the field number and *why it
is not the obvious one* are recorded next to the code rather than in a commit message.

**No message and no field was dropped.** All 24 messages in the closure are written,
including the fields the reference writes as present-and-zero. What changed is only
how they are expressed: the generated three-pass codec (size pass, slot table, write
pass) collapsed into one `ProtoWriter` call per field, which is where the 10,420 →
990 reduction comes from.

**Corrected assumptions (each was a documented belief that was wrong):**

1. **`FinalizeOfflineFile` was never missing** — see §2.4. This removed the module's
   only recorded blocker.
2. **This region has zero `$N` functions.** 121 top-level functions, all bare-named.
   MEMORY.md §2.3ab's `$N`-selection hazard does not apply *here* — but it does apply
   to the two satellite history regions, where `SsoGetC2cMsg$1` and
   `PushMsgBody$1`/`$3` had to be selected by call site.
3. **`RoutingHead.trans0x211` is field 15, not 4.** Tag `122`. Every other routing
   member is sequential 1..3, so 4 is the obvious guess and it silently routes a
   dataline or c2c-file send into a field the server ignores.
4. **The send envelope's fields are 1,2,3,4,5,6,8,9,12,14** — `via` 8, `dataStatist` 9,
   `ctrl` 12, `multiSendSeq` 14. There is no field 7, 10, 11 or 13. `ctrl` at 8 is the
   natural guess and it is wrong by four.
5. **`SsoGetGroupMsgInfo` (request) numbers its three fields 1/2/3, while
   `SsoGetGroupMsgResponseBody` numbers the same names 3/4/5.** Same command pair,
   same field names, different numbers. Using the response's table for the request
   produces well-formed protobuf that the server answers with an empty page.
6. **`SsoGetC2cMsg` and `SsoGetRoamMsg` are different messages**, not two spellings:
   `friendUid` is field 2 in the former's request and 1 in the latter's, and field 4 in
   the former's response and 3 in the latter's.
7. **`ts/src/send-message-request.ts`'s header comment is stale** (the code is right).
   It records `clientSequence` at field 3, `via` 48, `dataStatist` 56, `ctrl` 66. The
   real tags are `10,18,26,32,40,50,64,72,98,112` → fields 1,2,3,4,5,6,8,9,12,14, so
   `clientSequence` is 4, `via` 8, `dataStatist` 9, `ctrl` **12**. Not edited: that file
   is outside this task's write scope. It also implements only the group path.
8. **`BridgeContext.GroupMemberInfo.role` was typed `number`; the reference stores the
   string `"owner" | "admin" | "member"`.** Corrected in `context.ts` and in the one
   test that had baked in `role: 0`. The numeric form exists only at the 0xfe7 wire
   boundary, which the sibling OIDB batch already maps.

**What could NOT be ported, and why:** nothing in this region. The OIDB calls
(`FinalizeOfflineFile`) go through the existing `invokeOidb` adapter rather than a new
implementation, which is the intended pattern. The one genuine gap left behind is the
`services/index.ts` barrel re-export of `FinalizeOfflineFile` — owned by the sibling
agent, one line, no implementation work.

**Differential verification.** Every request encoder is compared byte-for-byte against
the reference's own generated encoder, loaded as a live module built at test time from
the tracked `reference/index.mjs` (`ts/test/helpers/message-oracle.ts`). 69 tests in
`ts/test/bridge-message.test.ts`, 0 skipped. The oracle is regenerated on every run, so
it cannot go stale against the reference and cannot be absent from a fresh checkout —
an oracle stored under gitignored `work/` would have made 20 comparisons silently skip
while the suite stayed green.

Three deliberate mutations were used to confirm the tests bite: moving `trans0x211` to
field 4, `ctrl` to field 8, and the request info block to fields 3–5 each produced
2–3 failures. Restored, the file is green.

---

## 3. What was ported, and what each port preserves

### 3.1 Ported files

| file | lines | reference region |
| --- | ---: | --- |
| `src/bridge/context.ts` | 391 | (new — the contract, §1) |
| `src/bridge/bridge.ts` | 581 | `src/bridge/bridge.ts` (371) + `MemoryIdentity` |
| `src/bridge/events.ts` | 159 | `../protocol/src/event-bus.ts` (78) |
| `src/bridge/env.ts` | 39 | `../common/src/env.ts` |
| `src/bridge/oidb-invoke.ts` | 56 | (new — the `.invoke` adapter, §1.5) |
| `src/bridge/apis/index.ts` | 55 | `src/bridge/apis/index.ts` (30) |
| `src/bridge/apis/collection.ts` | 85 | `src/bridge/apis/collection.ts` (21) |
| `src/bridge/apis/web.ts` | 486 | `src/bridge/apis/web.ts` (232) |
| `src/bridge/web/request-util.ts` | 467 | `../protocol/src/web/request-util.ts` (454) |
| `src/bridge/web/collection.ts` | 457 | `../protocol/src/web/collection.ts` (4,394) |
| `src/bridge/web/collection-wire.ts` | 754 | same region, codec half |
| `src/bridge/web/group-notice.ts` | 380 | `../protocol/src/web/group-notice.ts` (204) |
| `src/bridge/web/group-honor.ts` | 122 | `../protocol/src/web/group-honor.ts` (41) |
| `src/bridge/web/group-essence.ts` | 114 | `../protocol/src/web/group-essence.ts` (56) |
| `src/bridge/web/group-signin.ts` | 105 | `../protocol/src/web/group-signin.ts` (57) |
| `src/bridge/web/friend-dress.ts` | 310 | `../protocol/src/web/friend-dress.ts` (155) |
| `src/bridge/web/binary-source.ts` | 226 | `../protocol/src/highway/utils.ts` (353), load half |
| `src/bridge/album/packet.ts` | 2,007 | `src/bridge/apis/group-album.ts` (9,288), codec half |
| `src/bridge/apis/group-album.ts` | 1,096 | same region, logic half |
| `src/bridge/web/album-upload.ts` | 879 | `../protocol/src/web/group-album.ts` (411), upload half |
| `src/bridge/web/qzone.ts` | 1,711 | `../protocol/src/web/qzone.ts` (1,072) |
| `src/bridge/web/qzone-public.ts` | 808 | `../protocol/src/web/qzone-public.ts` (637) |
| `src/bridge/web/qzone-feed-content.ts` | 254 | `../protocol/src/web/qzone-feed-content.ts` (94) |
| `src/bridge/web/qzone-feed-cursor.ts` | 228 | `../protocol/src/web/qzone-feed-cursor.ts` (88) |
| `src/bridge/web/html.ts` | 710 | (new — replaces htmlparser2/domhandler/domutils/entities, §3.7) |
| `src/bridge/apis/qzone.ts` | 377 | `src/bridge/apis/qzone.ts` (158) |
| `test/bridge-layer.test.ts` | 904 | — |
| `test/bridge-album.test.ts` | 1,435 | — |
| `test/bridge-qzone.test.ts` | 1,240 | — |

### 3.2 `CollectionApi` — the 21-line module

The whole class body in the reference is four statements. Reproduced verbatim:

```js
const { domainPskeyMap } = await GetPskey.invoke(this.ctx, { domainList: [COLLECTION_DOMAIN] });
const pskey = domainPskeyMap.get(COLLECTION_DOMAIN);
if (!pskey) throw new Error(`QQ did not return a p_skey for ${COLLECTION_DOMAIN}`);
return getCollectionList({ uin: this.ctx.identity.uin, pskey, category, count });
```

The `!pskey` throw is not defensive padding. `GetPskey.deserialize` drops empty
`(domain, pskey)` pairs, so a domain the server declined to mint a key for arrives
as a **missing map entry**. Without the throw, the next call fails with a Weiyun
`retCode` that says nothing about the real cause.

### 3.3 `WebApi` — the module everything authenticates through

Twelve public methods; two of its operations are OIDB and the rest are HTTPS:

```
ForceFetchClientKey  0x102a_1  -> clientkey + keyindex
GetPskey             0x102a_0  -> a p_skey for one domain
GET ssl.ptlogin2.qq.com/jump   -> a cookie jar
```

**This is where the "is it HTTP or OIDB?" question resolves, and the answer is
"both, in a fixed order":**

1. mint a clientkey over OIDB,
2. GET the jump URL with that clientkey → cookie jar,
3. if the jar has no `p_skey`, ask OIDB for one and graft it in.

Step 3 is a **fallback, not a retry**, and it fails open: when the `GetPskey` repair
throws, the partially-populated jar is returned rather than an error raised — because
a jar with `skey` alone still works for endpoints that accept `skey`. Callers that
truly need a `p_skey` detect its absence themselves (that is exactly what
`CollectionApi.list`'s throw is for), so "no p_skey" stays distinguishable from "the
request failed".

Forcing either half into an `OidbSpec` would be a category error: the jump call has
no command number, no protobuf body and no envelope, and its entire output is HTTP
headers. They stay two mechanisms; `web.ts` is where they meet.

Details that must not be "cleaned up":

- **`buildJumpUrl` uses string concatenation, not `URLSearchParams`.** `u1` is
  double-encoded (`%2F` inside `%3A%2F%2F` inside `%2F`). A query builder collapses
  it to one level, and the endpoint answers with a redirect loop instead of cookies.
- **`getSKey` is a different jump URL, not a different ticket.** It asks for a
  Qzone-specific `u1` and reads `skey` instead of `p_skey`. The two URLs are not
  interchangeable: asking the group-notice `u1` for a `skey` yields no skey at all.
- **Two bkn helpers with two return types.** `getBknFromSKey` returns a **number**
  (published as `token` and `csrf_token`); `getBknFromCookie` returns a **string**
  (every URL builder concatenates it). A single helper would force one side to
  convert, "which is precisely the kind of cleanup that changes the wire."
- **`getCredentials` publishes `p_skey || skey`'s bkn, and `0` when neither exists.**
  Not a throw — a caller asking for credentials on a logged-out session gets
  `token: 0`.

### 3.4 The Weiyun collection codec — the one place a non-OIDB frame was needed

`getCollectionList` posts to `collector.weiyun.com/collector.fcg` with a hand-rolled
16-byte header in front of two protobuf messages:

```
offset 0   4 bytes  magic           20 13 03 29   (not a protobuf tag)
offset 4   2 bytes  version         00 01
offset 6   4 bytes  totalLength     BE, INCLUDING the 16-byte header
offset 10  4 bytes  bodyLength      BE, header not included
offset 14  2 bytes  reserved        00 00
offset 16  n bytes  head            protobuf CollectionRequestHead
...        m bytes  body            protobuf CollectionRequestBody
```

`totalLength` counts the header and `bodyLength` does not, so the head occupies
`totalLength - 16 - bodyLength`. **The port's encoder is byte-identical to the
reference's own**, verified against the reference region loaded as a module:

```
2013032900010000005000000017000008914e1001180120a09c0128cfacf8fa85c2013004381b5a0950534b45592d414243700878090a1582e2091120ffffffffffffffffff01280238324001
```

That 80-byte frame is asserted verbatim in `test/bridge-layer.test.ts`. A
round-trip test would have passed with both lengths swapped; only the golden bytes
catch it.

**A bug in the reference itself, found while porting:** its decoder rejects a frame
whose head is zero bytes (`bodyLength >= totalLength - 16`), and its encoder
zero-suppresses every head field — so a "success with no prompts" head encodes to
zero bytes and is then rejected by its own decoder. In practice the server always
sets at least one head field, so it is unreachable in production. The port keeps the
guard and the test documents the asymmetry rather than "fixing" it.

**Pagination.** Four independent bounds, each guarding a different failure: the
caller's `count`, 100 pages, a 60 s deadline across the whole walk (not per page),
and a 10 s per-page timeout clipped to whatever remains of the 60 s. The cursor is
the lowest `modifyTime` on the page just read, and the loop **requires it to
strictly decrease** — a page that returns the same cursor means the server is
repeating itself, and without that check the walk would issue 100 identical requests
and then blame the page cap.

**`reachedBottom` reads backwards:** `serverHasMore = (reachedBottom ?? 0) === 0`.
Zero means more data. Inverting it turns one page into the whole list.

**Where the port deliberately stops short:** the reference expands five summary
variants (`linkSummary`, `gallerySummary`, `audioSummary`, `videoSummary`,
`fileSummary`, `locationSummary`) into their own decoders — ~2,600 lines that exist
only to be handed to `jsonSafe()` and dropped into the OneBot payload. The port
decodes them structurally (`OpaqueSummary`, preserving their bytes as base64) and
names `textSummary` and `richMediaSummary` only, because those are the two an action
actually reads. When a caller needs `linkSummary.url`, that variant gets its own
decoder. `CollectionLocationSummary` would additionally need **fixed64 doubles**,
which `ts/src/oidb/wire.ts` does not currently provide — a real gap, noted rather
than papered over.

### 3.5 The four `qun.qq.com` web modules

Each has one behaviour that looks like a bug and is not:

- **`group-notice.ts`: two bkn values in the same request.** `calculateBkn(skey)`
  goes in the form body; `calculateBkn(pskey || skey)` goes on the query string. The
  server validates them against different cookies, so using one for both gets a
  silent `ec: 100`. The `p_skey` fallback is why the bug is invisible until a
  `p_skey`-expiring account hits it.
- **`group-notice.ts`: `inst` wins over `feeds`.** `list_announce` returns two
  collections that can contain the same `fid`. The merge REPLACES in place, keeping
  `feeds` ordering, so the output has one entry per announcement reported as
  `send_to_new_members`. Skipping the duplicate instead would report an announcement
  as regular when it is also pinned for new members.
- **`group-notice.ts`: `deleteNotice` returns `false` on ANY failure**, including
  transport. Asymmetric with the rest of the module, deliberate: the OneBot action
  depends on "already gone" and "we could not ask" both meaning "stop retrying".
- **`group-essence.ts`: an explicit "normalise an empty page" branch.** A group with
  no essence answers `{retcode: 0, data: {is_end: true}}` with `msg_list` ABSENT, and
  the strict validity check right after it would reject that. The empty branch runs
  first and manufactures the `[]`. The 20-page cap **throws** rather than truncating,
  so a truncated list is never mistaken for the complete one.
- **`group-honor.ts`: two different error policies.** `fetchHonorData` propagates
  (it is the raw fetch, wrapped in a Chinese message naming group and type);
  `getHonorListWebAPI` swallows to `[]` — because `getHonorInfo` asks for up to five
  lists at once and one unavailable type must not blank the other four.
- **`group-signin.ts`: rank is de-skewed.** The server sends 1, 3, 5, … so ties can
  interleave; the human rank is `(rank - 1) / 2 + 1`. Reading the raw value looks
  right on the first row and is off by a factor of two from the second onward.
  Errors **propagate** here, unlike honour: a missing `response.page` is what this
  endpoint returns for an expired cookie, and mapping that to "nobody signed in"
  would make an auth failure indistinguishable from an empty group.
- **`friend-dress.ts`: three app ids are unreachable.** `UNRESOLVABLE_APPS =
  {2, 5, 23}` (气泡 / 字体 / 头像) are never resolved truthfully when queried by
  `targetUin`; the server always answers the default. They are filtered out of the
  result rather than reported as "default", because "default" is a wrong answer, not
  a partial one. Its four `FriendDressError` kinds (`network`, `parse`, `structure`,
  `uin_mismatch`) exist because the caller must treat them differently —
  `uin_mismatch` is the security-relevant one, since a mis-routed request would
  otherwise report another user's dress as the target's.

### 3.6 group-album — the 9,288-line module was mostly generated

The single largest unported module. The task premise was that it "needs only
cookies". **It does not**, and the correction matters:

| operation | transport | wire name |
| --- | --- | --- |
| `listQun` / `list` | `ctx.sendRawPacket`, bare protobuf | `trpc.qzone.qzone_emotion_get_qun_album_list.QzoneEmotionGetQunAlbumList` |
| `getMediaList` | same | `trpc.qzone.qzone_emotion_get_qun_media_list…` |
| `comment` | same | `trpc.qzone.qzone_comment…` |
| `like` | same | `trpc.qzone.qzone_like…` |
| `delete` | same | `trpc.qzone.qzone_photo_delete…` |
| `getQunFeedDetail` | same | `trpc.qzone.qzone_emotion_get_qun_feed_detail…` |
| `upload` / `uploadVideo` | HTTPS slice upload | `photo.qzone.qq.com` (in `../protocol/src/web/group-album.ts`) |

So six of the eight operations are the SAME cookie→packet channel the OIDB work
already used, and only the two uploads are CGI. The reason the module looked
cookie-only is that the upload half lives in a *different region* with a nearly
identical name.

**Where the lines are.** Measured on the split region:

| part | lines | share |
| --- | ---: | ---: |
| generated protobuf codec, 38 messages | ~8,390 | 90% |
| class + 19 pure helpers (the actual logic) | ~603 | 6.5% |
| per-region copies of the UTF-8/varint/skip helpers | ~295 | 3.2% |

The 9,288 lines are **not dead** — every encoder/decoder is referenced by one of
the eight operations. They are **heavily duplicative**: the reference's bundler
re-emits an identical UTF-8 length/write/skip helper set in every region, and the
same 38 field tables appear once. Expressed against the shared `ProtoWriter` /
`ProtoReader` that already existed, the codec fits in `album/packet.ts` at 2,007
lines — a 76% reduction with no loss of behaviour, because the duplication
collapses rather than any message being dropped.

**What could not be ported:** `uploadVideoToGroupAlbum` needs an injected
`probe`, because the reference calls `getFFmpegAddon().getVideoInfo` — a native
addon that is not part of this package. `unavailableAlbumVideoProbe` throws with
that reason rather than pretending to measure a video. The IMAGE path is complete.

Note the two upload paths are genuinely different, not cosmetic variants: the
image path uses a constant `slice_size=16384` and clamps `end`, while the video
path sends `String(chunkBytes.length)` and `offset + len`. They were not unified,
because unifying them would change one of the two wire formats.

### 3.7 `html.ts` — four vendored packages replaced by 710 lines

`qzone-feed-content.ts` extracts post text from a feed's `html` field. The
reference does that through htmlparser2 → domhandler → domutils → entities, and
this package has **zero runtime dependencies** (`ts/package.json` has devDeps
only), so a choice was forced: add four npm deps to a zero-dependency package, or
write the subset needed.

The subset was written. What it reproduces:

* tree building with `parent`/`children`, lowercased names, first-duplicate-wins
  attributes, quoted/unquoted/valueless attribute forms;
* the `openImpliesClose` table transcribed verbatim (46 keys) and applied **before**
  `appendChild` — the ordering is load-bearing;
* `VOID_ELEMENTS`, raw-text handling for `script`/`style`, and the separate
  `script`/`style` node types that `isTag` accepts but the text walker does not
  descend into;
* `<title>` decoding entities while `<textarea>` does **not** (htmlparser2 starts an
  entity decoder only for `Sequences.TitleEnd`);
* a synthetic empty `<p>` for a stray `</p>` and a synthetic `<br>` for `</br>`,
  both of which htmlparser2 emits and which change paragraph breaking;
* `/>` IGNORED on non-void elements — `recognizeSelfClosing` is `!htmlMode`, so
  `<span/>t` keeps `t` inside the span;
* the domutils `findAll` stack-of-stacks pre-order walk, copied;
* `decodeEntities` with ~65 named entities plus decimal/hex numeric references,
  guarded against out-of-range and surrogate code points.

**Fidelity evidence** — a differential test against the reference region itself,
loaded as a live module carrying the real four packages
(`work/bridge-parts/ref/qzone-feed-content.mjs`). Three corpora:

| corpus | fixtures | result |
| --- | ---: | --- |
| hand-written edge cases (§ `test/bridge-qzone.test.ts`) | 16 | all match |
| generated realistic markup (well-formed nesting, entities, `<br/>`, images) | 1,500 | all match |
| generated tag soup (mismatched closes, raw-text mid-document, attributes everywhere) | 1,500 | all match |

The generated corpora are part of the committed test suite, seeded for
reproducibility. This is a substitution, not a reimplementation of htmlparser2:
the tokenizer is not conformant to the full HTML5 spec, and the one known
divergence (a tag name of exactly one character truncated at EOF) is documented in
the source rather than papered over. For Qzone feed markup — which is generated by
one server-side template — that subset is what is exercised.

### 3.8 qzone — three surfaces, not one

The 158-line `apis/qzone.ts` looked like the whole target. It is a thin adapter;
the work sits behind it in four modules:

| module | reference lines | surface |
| --- | ---: | --- |
| `web/qzone.ts` | 1,072 | 16 `cgi-bin` endpoints, `g_tk` + form-urlencoded |
| `web/qzone-public.ts` | 637 | gotrpc JSON, `x-oidb` header, 7 services |
| `web/qzone-feed-content.ts` | 94 | HTML → text (`html.ts`) |
| `web/qzone-feed-cursor.ts` | 88 | base64url feed pagination state |

`qzone-public.ts` was on the blocker list as "needs a non-`OidbSpec` `x-oidb`
envelope". That diagnosis was half right and the conclusion was wrong. It does not
fit `OidbSpec` — there is no binary body and no `toBody`/`fromBody` pair — but the
surface is plain JSON over HTTP, so it needs **no** new adapter: `HttpGetJson`
already existed. The only protobuf in the entire module is a 25-byte `ugc_id` blob
that `GetFeedDetail` wants base64'd into a JSON string, and that is expressed
through the existing `ProtoWriter`. So this module became portable for the cost of
reading it, which is a better outcome than the dependency report predicted.

Two parsers exist in `web/qzone.ts` for a real reason. Most endpoints return JSON
or `_Callback({...})`. `feeds3_html_more` returns a **JS object literal** —
unquoted keys, single quotes, `\xNN` escapes, literal `undefined` — that
`JSON.parse` rejects in every parameter combination. `parseJsLiteral` handles it by
recursive descent that can only produce values; it never `eval`s, and it DROPS a
`__proto__` key because assigning one would set the prototype instead of creating
an own property.

Not ported: nothing. All 30 functions and the adapter are present.

### 3.9 `Bridge` — what is ported and where the line falls

Ported: the whole `ctx` surface (identity/apis/events), connection bookkeeping,
`sendRawPacket`, `resolveUserUid`, both counters, the upload cache, `getOnlineClients`,
`dispose`, receive-health.

Not ported, **because they are gated on modules this port does not have** — not
because they are hard:

| not ported | waits on |
| --- | --- |
| the constructor's `setFetcher` + `IncomingPacketPipeline` wiring | `apis.contacts` (5 missing classes) + the 535-line packet pipeline + `IdentityService`'s SQLite |
| `registerCmd` / `handlesCmd` / `onPacket` / `processClientMessage` | same |
| `runRosterWarmup` / `whenRosterWarmupSettled` / `maybeStartRosterWarmup` | `contacts.fetchFriendList`, `contacts.fetchGroupList` |
| `manager.ts` in full | `Bridge` + the hook's PID lifecycle |

`MemoryIdentity` (in `bridge.ts`) is **not** a port of `IdentityService`. It exists so
every ported API is reachable in a test and so `Bridge` is constructible today. What
it does model faithfully is the identity-mapping rules, because those are what the
OIDB specs depend on: `uin` stays a string, `selfUid` is `""` before warmup, the two
`find*` lookups are synchronous cache-only and return `null`, `resolveUid` is the
one with a network fallback and the only one that throws, and member uids are
group-scoped.

---

## 4. What is portable without a live QQ, honestly

The question the task actually asks is not "how many lines" but "how much of
46,399 lines can be landed without ever running QQ". Three different answers,
depending on what counts:

**By line count: ~44% is landed; maybe 92% is reachable.** The ported ~20,500 lines
now cover the credential/web half, group-album, the whole Qzone surface, and — new —
`message.ts` with its dataline and history satellites. Of the remaining ~25,900,
`forward.ts` alone is 68%:

- **`forward.ts` (17,593)** — 42% of the layer — needs **no OIDB classes at all**.
  Its blocker is different in kind: the long-message TRPC framing has to be
  understood (a research job, not a porting job).
- **`group-album.ts` (9,288)** — **now ported** (§3.6). The premise that it "needs
  only cookies" was wrong: six of its eight operations are bare-protobuf packets on
  `ctx.sendRawPacket` with `trpc.qzone.*` wire names, and only the two uploads are
  CGI. It was unblocked, just not for the stated reason. It also turned out to be
  90% generated codec, so the real work was ~600 lines.
- **`message.ts` (11,082)** — **ported.** It needed **zero** classes: the one recorded
  blocker (`FinalizeOfflineFile`) already existed, and the codec rebased onto
  `ProtoWriter` (§2.6). With it, the two largest modules in the layer are done.
- The remaining 9 modules (~3,700 lines total) need the 58 missing classes. At the
  observed rate (the count fell 73→58 during this session alone), that is a few
  more batches.

**By module count: 10 of 21 are blocked on OIDB classes, 11 are not.** The blocked
ones are now 35% of the lines. Porting `message.ts` moved it out of the blocked set
entirely, which is why the remainder shifted back down: the module that was 11,082
lines and "blocked" turned out to need nothing.

**By line count: ~34% of the layer is landed; ~92% of the codec is.** The ported
lines are ~21,000 of the ~21,900 non-blocked lines, but the raw count is the wrong
measure here: the generated codec is 60%+ of the layer's bulk and is nearly all
ported now (message, dataline, collection, group-album, web), while the blocked
remainder is small modules made of real logic. Counting *logic* lines rather than
total lines, the landed fraction is higher still.

**By usability: nearly 0% of it is *runnable* end-to-end, and that is the honest
headline.** Every ported module typechecks and its pure functions are tested, but
nothing in this layer can be exercised against a real QQ account until
`Bridge.onPacket` exists — which needs the packet pipeline and the durable roster.
And the whole layer is downstream of the project's actual P0 (`PROGRESS.md` §3: who
puts `MessageSvc.PbSendMsg` bytes on the network). **A perfect bridge layer sends
nothing.** That fact should govern how much more of it gets ported before §3's
blocker moves.

What a continuation should do, in order:

1. ~~`apis/group-album.ts`~~ — **done**, along with `apis/qzone.ts`,
   `web/qzone.ts`, `web/qzone-public.ts` and the four `web/` helpers it needed.
2. ~~`apis/message.ts`~~ — **done** (§2.6), with `message-wire.ts`, `dataline.ts`,
   `history-fetch.ts` and `history-request-gate.ts`. Zero missing classes.
3. The 58 missing classes, following user-facing value rather than fan-in — fan-in
   is uniformly 1, so there is no efficiency argument for any particular order.
   One of them is already written and merely unexported (`FinalizeOfflineFile`).
4. `IdentityService`'s durable half (1,074 lines) — currently the widest gap between
   "the bridge compiles" and "the bridge runs".
5. `packet-pipeline.ts` (535 lines) + `manager.ts` (249) — the last pieces before
   the layer is hook-attachable.
6. `forward.ts` (17,593) — now the single largest remaining target by a wide margin,
   and the only one whose blocker is research rather than porting (§4).

---

## 5. Structurally surprising things

Collected in one place, because each one cost real time to establish:

1. **`ctx` is the `Bridge` object itself**, and `asBridge(ctx) { return ctx; }`
   exists purely to say so (§1.1).
2. **Ten members, and no logger.** Logging is per-module `createLogger` at module
   scope (§1.2). Anyone adding `ctx.log` changes 21 modules' initialisation order.
3. **`identity.uin` is a string.** Type it as a number and URL construction changes
   (§1.2).
4. **60% of the layer never touches OIDB**, so `bridge-deps.mjs`'s "58 missing
   classes" describes 35% of the bulk (§2.3).
5. **Effort is inverse to file size.** `group-admin.ts` (274 lines) needs 27
   classes; `message.ts` (11,082 lines) needed **zero** (§2.3, §2.6).
6. **Every missing class has exactly one consumer.** No fan-in to exploit; scheduling
   must follow user-facing value instead (§2.4).
7. **`web.ts` is the one place OIDB and HTTP meet in a fixed order**, and the OIDB
   half is a *fallback* that fails open (§3.3).
8. **The biggest modules were the cheapest to port.** `group-album.ts` is 9,288
   lines, 90% of them generated codec; `message.ts` is 11,082 lines, of which only
   **661** are logic — the other 10,420 are 99 generated codec functions that
   collapse from 10,420 lines to 990 against the shared `ProtoWriter`, with no
   message and no field dropped (§2.6). Line count was a bad predictor of effort in
   both directions: 274 lines of `group-admin.ts` need 27 classes (§3.6). Across the
   layer, the generated codec is the majority of the bulk and is now nearly all
   ported; what remains blocked is small modules of real logic.
9. **A "blocker" can dissolve on inspection — twice now.** `qzone-public.ts` was
   recorded as needing a new non-`OidbSpec` adapter; it is plain JSON over HTTP and
   needed no new code at all (§3.8). And `message.ts` was recorded as blocked on
   `FinalizeOfflineFile`, which had already existed for weeks in
   `0x3639-offline.ts` — the "missing class" was a barrel-export gap (§2.4, §2.6).
   Both times the recorded blocker was a stale fact rather than an absent
   implementation. Verify a blocker against the tree before scheduling around it.
10. **Two spaced-apart modules can share a name.** The group-album upload half lives
    in `../protocol/src/web/group-album.ts`, a different region from
    `src/bridge/apis/group-album.ts`. Reading only the latter produces the false
    conclusion that the module is cookie-only.
11. **`<textarea>` does not decode entities but `<title>` does.** Both are
    "escapable raw text" in the HTML spec; htmlparser2 starts an entity decoder for
    only one. This is invisible until a fixture contains `&amp;` inside one (§3.7).
12. **A stray `</p>` is not a no-op.** htmlparser2 synthesises an empty `<p>`, so
    dropping the close tag joins two paragraphs that the reference keeps apart
    (§3.7).
8. **`u1` is double-encoded**, so a `URLSearchParams` builder breaks the jump call
   into a redirect loop (§3.3).
9. **Two bkn helpers with different return types** — number for the payload, string
   for URLs (§3.3).
10. **The collection frame's two length fields disagree by 16**, and only golden
    bytes catch a swap (§3.4).
11. **The reference's own collection decoder rejects a head its own encoder can
    produce** (§3.4).
12. **The collection cursor must strictly decrease**, or the walk spins to the page
    cap and reports the wrong cause (§3.4).
13. **`reachedBottom: 0` means "more data"** (§3.4).
14. **`wire.ts` has no fixed64/double reader**, so `CollectionLocationSummary` cannot
    be decoded losslessly with the current primitives (§3.4).
15. **`.invoke` is not part of `OidbSpec`** — the reference attaches it post-hoc via
    an IIFE, and the port keeps `spec.ts` untouched by rebuilding it in the bridge
    (§1.5).
16. **`sendRawPacket` returns `-1` instead of throwing** when no PID is bound, so the
    error names the command rather than becoming an unhandled rejection (§1.6).
17. **`identity.initialization` delays packets rather than dropping them.** Resolve
    packets immediately and they emit with `uid === ""` (§1.3).
18. **`apis/index.ts` is eagerly constructed on purpose**, and says so in its own
    comment — there is no lazy path (§2.5).

---

## 6. Verification

- `npx tsc -p tsconfig.json` → **exit 0**, no diagnostics.
- `node --test build/test/*.test.js` → **862 tests, 860 pass, 0 fail, 0 cancelled,
  2 skipped**, exit 0, duration ~230s. Baseline before this pass was 793/791/0/2; the
  delta is this pass's 69 new tests plus sibling agents' OIDB work. (Note the 793
  baseline already superseded the 784 recorded earlier — sibling batches landed in
  between. The two skips are pre-existing and unrelated.)
- `node --test build/test/bridge-message.test.js` → **69/69 pass, 0 skipped**.
- `node --test build/test/bridge-layer.test.js` → **56/56 pass**.
- `node --test build/test/bridge-album.test.js` → **76/76 pass**.
- `node --test build/test/bridge-qzone.test.js` → **92/92 pass**.
- Collection request frame → **byte-identical** to the reference's own encoder
  (§3.4).
- Message-region request frames → **byte-identical** to the reference's encoded
  output for all 8 send/recall/report builders, the 3 history request builders, and
  the dataline text body across all three devices (§2.6). The oracle is the
  reference's own generated code, built **at test time** from the tracked
  `reference/index.mjs` (`ts/test/helpers/message-oracle.ts`, 223 codec functions,
  0 missing roots), so it cannot go stale and cannot be absent from a fresh checkout.
- Three deliberate mutations were applied to confirm the differential tests bite:
  `trans0x211` 15→4, `ctrl` 12→8, and the request info block 1-3→3-5 each produced
  failures in 2–3 tests. All restored; suite green.
- Group-album request frames → **byte-identical** to the reference's encoder across
  every one of the six packet operations, checked against golden bytes produced by
  running the reference region as a live module (`work/bridge-parts/ref/group-album.mjs`).
- `parseQzoneFeedContent` → **identical** to the vendored htmlparser2/domhandler/
  domutils/entities stack on 3,016 fixtures (§3.7).

Reproduce the dependency report with `node work/bridge-deps.mjs`. Reproject the
region splits with the scripts under `work/bridge-parts/` (`ref/collection.mjs` is
the reference's collection region loaded as a live module, used to produce the
golden bytes).
