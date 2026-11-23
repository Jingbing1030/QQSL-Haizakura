// The ApiHub: one object holding every bridge API, constructed once per Bridge.
//
// Reference region: src/bridge/apis/index.ts (reference/index.mjs:339168, 30
// lines). The reference's own comment states the construction policy:
//
//     "Called once from the Bridge constructor. Eager construction means every
//      Bridge instance pays the cost up-front (a few object allocations) —
//      there's no lazy path because that would require either a thunk-based
//      wrapper or runtime-mutated `apis.xxx` slots, neither of which is worth the
//      complexity for ~13 small classes."
//
// So this stays eager. All sixteen slots are filled as of the flash-transfer batch:
// `flashTransfer` used to be the one OMITTED key, and it is now a real
// `FlashTransferApi` in its reference position (after `profile`, before `forward`).
//
// ---------------------------------------------------------------------------
// Why the hub is a plain object and not a class
// ---------------------------------------------------------------------------
// The reference builds it with an object literal inside `buildApiHub` and never
// gives it a class identity; nothing does `instanceof`. Keeping the literal means
// key order matches the reference, which matters for anything that serializes the
// hub for diagnostics.
//
// ---------------------------------------------------------------------------
// The sixteen present slots
// ---------------------------------------------------------------------------
// Present (reference key order):
//
//   collection    ported before this batch
//   message       ported before this batch (OneBot-facing; NOT the OIDB `message`
//                 API — the OIDB sends live in `oidb/services/` and are reached
//                 through `MessageApi`'s own `sendRawPacket` calls)
//   contacts      earlier batch
//   groupAdmin    earlier batch
//   groupFile     ★ wired in an earlier batch — the class existed but was never
//                 constructed here, so ten 擴展 actions read `undefined`
//   groupAlbum    ported before this batch
//   qzone         ported before this batch
//   interaction   ★ wired in an earlier batch — existed, unreachable
//   friend        ★ wired in an earlier batch — existed, unreachable (see the caveat)
//   profile       earlier batch
//   flashTransfer ★ wired in this batch — the read-only half. `createFlashTask` is
//                 the one member that throws (it needs the upload pipeline); the
//                 other eleven are real, which unblocks ten of the eleven flash
//                 actions. See `apis/flash-transfer.ts`'s header.
//   forward       ★ wired in an earlier batch — merged forward
//   misc          ★ wired in an earlier batch — `get_mini_app_ark`
//   extras        ★ wired in this batch — AI voice / group todo / stranger status;
//                 this is what unblocks `send_group_ai_record`
//   web           ported before this batch
//   systemFace    ★ wired in an earlier batch — existed, unreachable
//
// No key is absent any more. The `?: never` members this interface used to carry
// (`flashTransfer`, and `extras` before it) are gone; each was removed in the batch
// that ported the module.
//
// ---------------------------------------------------------------------------
// ★ Why four slices were orphaned, and the lesson worth keeping
// ---------------------------------------------------------------------------
// `interaction.ts`, `friend.ts`, `group-file.ts` and `system-face.ts` were all
// implemented and typechecked for several batches while answering `undefined` at
// runtime, because `buildApiHub` never listed them. Nothing caught it: the classes
// are only *constructed* here, so no test imported them through the hub, and the
// action layer's `ActionApiHub` declares them as non-optional members satisfied by
// whatever a host injects. A compile-clean module is not a reachable module.
//
// `extras` is the fifth instance of the same trap, caught one batch earlier: the OIDB
// specs (`0x929b`/`0x929d`/`0x9474`/`0x0f90`/`0xfe1`) were all ported and tested
// while `send_group_ai_record` stayed `"blocked"`, because the class had no `extras`
// slot to reach them through.
//
// ---------------------------------------------------------------------------
// ⚠️ `friend` is wired but only PARTIALLY satisfies the action layer
// ---------------------------------------------------------------------------
// `FriendApi` implements `handleRequest` and `delete`. The four members the 擴展
// family calls — `setRemark`, `getDoubtRequests`, `approveDoubtRequest`,
// `rejectDoubtRequest` — are NOT on the class. Wiring the slice therefore fixes
// `delete_friend` / `set_friend_add_request` but leaves `set_friend_remark`,
// `get_doubt_friends_add_request` and `set_doubt_friends_add_request` throwing
// "is not a function". Their OIDB specs already exist (`oidb/services/0x912e.ts`,
// `0xd69-d72.ts`), so the gap is in `apis/friend.ts`, not in the protocol layer.
// Declaring the four here would only move the failure, so they are left absent.
//
// `profile` is present and now carries its highway members: `addCustomFace` (one frame,
// `commandId: 9`) and `setAvatar` (`commandId: 90`) are both implemented, so the old
// "omitted because they need the Highway upload channel" note no longer holds. Still
// absent is `setGroupAvatar`, which additionally needs a hand-encoded `GroupAvatarExtra`.
// See `apis/profile.ts` for the per-method reasoning.

import type { BridgeApiHub, BridgeContext, GroupFileApiSlice } from "../context.js";
import { ContactsApi } from "./contacts.js";
import { GroupAdminApi } from "./group-admin.js";
import { GroupAlbumApi } from "./group-album.js";
import { GroupFileApi } from "./group-file.js";
import { InteractionApi } from "./interaction.js";
import { FriendApi } from "./friend.js";
import { CollectionApi } from "./collection.js";
import { MessageApi } from "./message.js";
import { ProfileApi } from "./profile.js";
import { QzoneApi } from "./qzone.js";
import { ForwardApi } from "./forward.js";
import { FlashTransferApi } from "./flash-transfer.js";
import { MiscApi } from "./misc.js";
import { ExtrasApi } from "./extras.js";
import { SystemFaceApi } from "./system-face.js";
import { WebApi } from "./web.js";

/**
 * The hub with every ported API narrowed from `unknown` to its real type.
 *
 * The former `?: never` members (`flashTransfer`, and `extras` before it) are real
 * types now. That is not cosmetic: `BridgeApiHub.flashTransfer?: unknown` would let
 * `ctx.apis.flashTransfer.anything()` typecheck and fail at runtime, which is exactly
 * the failure mode this port is trying to avoid.
 */
export interface PortedApiHub extends BridgeApiHub {
  collection: CollectionApi;
  message: MessageApi;
  contacts: ContactsApi;
  groupAdmin: GroupAdminApi;
  /**
   * An INTERSECTION, and not just `GroupFileApi`, for a reason worth stating.
   *
   * `BridgeApiHub` types this slot as `GroupFileApiSlice`, whose `getPrivateUrl`
   * takes TWO arguments (`userId, fileId`). The real `GroupFileApi.getPrivateUrl`
   * takes THREE (`userId, fileId, fileHash`) — `fileHash` is required by
   * `0xe37_1200`, and `group-file.ts.pending` calls it with three. Under
   * `strictFunctionTypes` a 3-required-arg method is NOT assignable to a 2-arg
   * signature ("target signature provides too few arguments"), so
   * `groupFile: GroupFileApi` alone fails to compile with TS2430.
   *
   * The intersection keeps both: the class's real 3-arg member is what the action
   * layer calls, and the slice's 2-arg declaration is still satisfied for
   * `BridgeApiHub` assignability. The underlying mismatch is a defect in
   * `context.ts`'s `GroupFileApiSlice` (it predates the class gaining `fileHash`);
   * the correct long-term fix is to add the third parameter there, at which point
   * this can collapse to plain `GroupFileApi`.
   */
  groupFile: GroupFileApi & GroupFileApiSlice;
  groupAlbum: GroupAlbumApi;
  qzone: QzoneApi;
  interaction: InteractionApi;
  friend: FriendApi;
  profile: ProfileApi;
  /**
   * The flash-transfer slice — read half and uploader.
   *
   * Reference key order puts it AFTER `profile` and BEFORE `forward`; the port
   * reproduces that, which is why it is declared here rather than next to `extras`.
   *
   * ★ `createFlashTask` is real too: it owns the local upload pipeline (staging,
   * streaming MD5/sha1, 1 MiB slicing, the `sliceupload` POST, and the two placeholder
   * thumbnails), so all eleven flash actions are live. See `apis/flash-transfer.ts`'s
   * header for the five-phase ordering.
   */
  flashTransfer: FlashTransferApi;
  /**
   * Merged forward. `ForwardApi` satisfies the slot as declared; the `as` on the hub
   * member is the same `getPrivateUrl`-arity widening `groupFile` needs, for the same
   * reason (`context.ts`'s `GroupFileApiSlice` predates the class gaining `fileHash`).
   */
  forward: ForwardApi;
  /**
   * The `misc` slot, ported for `get_mini_app_ark`. Only the one member an action needs is
   * present; the reference's other dozen (`inline keyboard`, `group sign`, `db key`) have
   * no caller here and are added when one appears.
   */
  misc: MiscApi;
  /**
   * The `extras` slot — AI voice, group todo, stranger status.
   *
   * Reference: `var ExtrasApi = class` at reference/index.mjs:82407-82611 (205 lines,
   * eleven members). Eight are ported; `convertRecord` and `translatePttToText` are
   * named refusals, each because the dependency genuinely does not exist in this
   * package (a SILK-capable ffmpeg addon and the `pttTrans` codec pair respectively).
   * See `apis/extras.ts`'s header for the per-method reasoning.
   *
   * ★ `sendAiVoice` is the reason this slot mattered: it is a REQUEST + RECEIPT-WAIT
   * composite rather than an `invoke`-and-return, so it needs `ctx.events` (which
   * `BridgeContext` has had all along) and cross-call claim state (which lives on the
   * `ExtrasApi` instance). That is what unblocked `send_group_ai_record`.
   */
  extras: ExtrasApi;
  web: WebApi;
  systemFace: SystemFaceApi;
}

/**
 * Build the ApiHub for one Bridge.
 *
 * Key order is the reference's (`collection`, `message`, `contacts`, `groupAdmin`,
 * `groupFile`, `groupAlbum`, `qzone`, `interaction`, `friend`, `profile`,
 * `flashTransfer`, `forward`, `misc`, `extras`, `web`, `systemFace`;
 * reference/index.mjs:339178) so a diagnostic dump of the hub diffs cleanly against
 * the reference's. Every key is present as of the flash-transfer batch.
 */
export function buildApiHub(ctx: BridgeContext): PortedApiHub {
  return {
    collection: new CollectionApi(ctx),
    message: new MessageApi(ctx),
    contacts: new ContactsApi(ctx),
    groupAdmin: new GroupAdminApi(ctx),
    // The cast is the price of the `getPrivateUrl` arity conflict documented on
    // `PortedApiHub.groupFile` above: TypeScript cannot see that the 3-arg method
    // also satisfies the slice's 2-arg declaration, though it does at runtime.
    groupFile: new GroupFileApi(ctx) as GroupFileApi & GroupFileApiSlice,
    groupAlbum: new GroupAlbumApi(ctx),
    qzone: new QzoneApi(ctx),
    interaction: new InteractionApi(ctx),
    friend: new FriendApi(ctx),
    profile: new ProfileApi(ctx),
    // Reference key order: `flashTransfer` comes AFTER `profile` and BEFORE
    // `forward`. Its `createFlashTask` throws (the uploader is a separate batch).
    flashTransfer: new FlashTransferApi(ctx),
    forward: new ForwardApi(ctx),
    // `misc` follows `forward` in the reference's key order.
    misc: new MiscApi(ctx),
    // `extras` sits between `misc` and `web` in the reference's literal
    // (reference:339192), so it goes here and NOT at the end. `systemFace` stays last.
    extras: new ExtrasApi(ctx),
    web: new WebApi(ctx),
    systemFace: new SystemFaceApi(ctx),
  };
}