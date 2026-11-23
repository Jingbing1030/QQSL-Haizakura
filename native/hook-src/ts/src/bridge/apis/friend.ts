// `FriendApi` — the two members this batch's actions reach.
//
// Reference region: `src/bridge/apis/friend.ts` (reference/index.mjs:203899-203980,
// 82 lines). The reference class has nine members; this port implements the two that
// the 3 friend actions and 2 request actions call, and OMITS the other seven with the
// reasoning below.
//
// ---------------------------------------------------------------------------
// `delete` — the swallow and the dataline guard, both observable
// ---------------------------------------------------------------------------
//   1. `if (findDatalineDeviceByUin(userId)) throw new Error("this contact cannot be
//      deleted")` — the three 我的电脑/手机/Pad pseudo-contacts are not friends. Sending
//      `0x126b_0` for one would either fail server-side or, worse, delete something
//      that is not what the caller meant. So the guard runs BEFORE the packet.
//   2. `DeleteFriend.invoke({userId, block})` — `0x126b_0`. Note it takes a *uin* and
//      resolves the uid inside the spec's caller path, unlike `handleRequest`.
//   3. the friend-list refresh is wrapped in `try/catch` that only LOGS. That is
//      deliberate and it is the behaviour a caller observes: a successful delete
//      answers ok even when the roster refresh cannot be sent. Propagating it would
//      report a completed deletion as a failure, and the caller would retry a delete
//      that already happened.
//
// ---------------------------------------------------------------------------
// `handleRequest` — the digit-only rule lives HERE because the spec is synchronous
// ---------------------------------------------------------------------------
// The reference's `HandleFriendRequest.serialize` is `async` and does the uid
// resolution inline (`reference/index.mjs:201291`):
//
//     const targetUid = /^\d+$/.test(p.uidOrFlag) ? await ctx.resolveUserUid(...) : p.uidOrFlag;
//
// This port's `OidbSpec.serialize` is SYNCHRONOUS (`0xd69-d72.ts` takes the resolver
// as an argument via `resolveFriendTarget` instead), so the async half has to live in
// this API layer. That is a **structural difference from the reference with no wire
// consequence** — the bytes are identical — but it is worth stating: the digit-only
// translation happens one layer up from where the reference does it.
//
// Why the translation matters at all: a digit-only `flag` is an ACCOUNT NUMBER, and
// the approval packet needs a UID. Sending the number as a uid produces a request the
// server rejects, and the reference says so in exactly those terms.
//
// ---------------------------------------------------------------------------
// `setRemark` uses the 0x912e set / 0x912f clear pair; an empty remark clears.
// Doubt-request resolution and approval mirror the reference's fallback rules and
// the existing specs' distinct command, operation discriminator and uinForm.

import { createLogger } from "../../onebot/log.js";
import type { BridgeContext } from "../context.js";
import { DeleteFriend } from "../../oidb/services/0x126b.js";
import { ClearFriendRemark, SetFriendRemark, confirmFriendRemark } from "../../oidb/services/0x912e.js";
import {
  ApproveDoubtBuddyReq,
  GetDoubtBuddyReq,
  HandleFriendRequest,
  RejectDoubtBuddyReq,
  resolveFriendTarget,
  type DoubtRequest,
} from "../../oidb/services/0xd69-d72.js";
import { oidbCaller } from "../oidb-invoke.js";
import { findDatalineDeviceByUin } from "./dataline.js";

const log = createLogger("Bridge.Friend");

const handleFriendRequestCall = oidbCaller(HandleFriendRequest);
const deleteFriendCall = oidbCaller(DeleteFriend);
const setFriendRemarkCall = oidbCaller(SetFriendRemark);
const clearFriendRemarkCall = oidbCaller(ClearFriendRemark);
const getDoubtRequestsCall = oidbCaller(GetDoubtBuddyReq);
const approveDoubtRequestCall = oidbCaller(ApproveDoubtBuddyReq);
const rejectDoubtRequestCall = oidbCaller(RejectDoubtBuddyReq);

export class FriendApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  /**
   * Accept or reject an inbound friend request.
   *
   * `uidOrFlag` is a pre-resolved UID string or a digit-only account number (resolved
   * here). `0xb5d_44`, via the `HandleFriendRequest` spec.
   */
  async handleRequest(uidOrFlag: string, approve: boolean): Promise<void> {
    const targetUid = await resolveFriendTarget(uidOrFlag, (uin) => this.#ctx.resolveUserUid(uin));
    await handleFriendRequestCall.invoke(this.#ctx, { uidOrFlag: targetUid, approve });
  }

  /** Set or clear a friend remark; dataline pseudo-contacts do not support remarks. */
  async setRemark(userId: number, remark: string): Promise<void> {
    if (findDatalineDeviceByUin(userId)) throw new Error("this contact does not support remarks");
    const targetUid = await this.#ctx.resolveUserUid(userId);
    if (remark === "") {
      await clearFriendRemarkCall.invoke(this.#ctx, { targetUid });
      return;
    }
    const result = await setFriendRemarkCall.invoke(this.#ctx, { targetUid, remark });
    confirmFriendRemark(result, { targetUid, targetUin: userId, remark });
  }

  /** List likely-friend requests, filling missing identity data from the roster. */
  async getDoubtRequests(count: number): Promise<DoubtRequest[]> {
    const list = await getDoubtRequestsCall.invoke(this.#ctx, { count });
    return Promise.all(
      list.map(async (item) => {
        let uid = item.uid;
        let userId = item.user_id;
        if (userId <= 0 && uid) userId = this.#ctx.identity.findUinByUid(uid) ?? 0;
        if (!uid && userId > 0) {
          try {
            uid = await this.#ctx.resolveUserUid(userId);
          } catch (error) {
            log.warn(
              "doubt-request uid resolve failed: user=%d err=%s",
              userId,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        return { ...item, uid: uid || "", user_id: userId };
      }),
    );
  }

  /** Approve a likely-friend request identified by a UID or digit-only UIN. */
  async approveDoubtRequest(uidOrFlag: string): Promise<void> {
    const uid = await resolveFriendTarget(uidOrFlag, (uin) => this.#ctx.resolveUserUid(uin));
    const selfUid = this.#ctx.identity.selfUid ?? (await this.#ctx.resolveUserUid(Number(this.#ctx.identity.uin)));
    await approveDoubtRequestCall.invoke(this.#ctx, { uid, selfUid });
  }

  /** Reject a likely-friend request identified by a UID or digit-only UIN. */
  async rejectDoubtRequest(uidOrFlag: string): Promise<void> {
    const uid = await resolveFriendTarget(uidOrFlag, (uin) => this.#ctx.resolveUserUid(uin));
    await rejectDoubtRequestCall.invoke(this.#ctx, { uid });
  }

  /** Delete a friend, optionally blocking them. Throws for a dataline pseudo-contact. */
  async delete(userId: number, block = false): Promise<void> {
    if (findDatalineDeviceByUin(userId)) throw new Error("this contact cannot be deleted");
    // `_DeleteFriend.serialize` is `async` in the reference and does
    // `targetUid: await ctx.resolveUserUid(p.userId)` (reference:198278) — the spec
    // takes the resolved uid. Same structural split as `handleRequest`, same bytes.
    const targetUid = await this.#ctx.resolveUserUid(userId);
    await deleteFriendCall.invoke(this.#ctx, { targetUid, block });
    try {
      // The roster refresh goes through the contacts API when it is attached. A host
      // that has `friend` but no `contacts` — a test double, say — must not make the
      // delete fail, which is the same reasoning the reference applies to a refresh
      // ERROR.
      const contacts = this.#ctx.apis.contacts as { fetchFriendList?: () => Promise<unknown> } | undefined;
      if (contacts?.fetchFriendList) await contacts.fetchFriendList();
    } catch (error) {
      log.warn(
        "friend-list refresh failed after deleting user=%d: %s",
        userId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * `resolveDoubtFlag` — turn a "doubt flag" into a uid.
   *
   * A doubt flag IS a uid in an older encoding, but the reference's contract is
   * "all-digits means resolve, anything else is already a uid". The regex is the whole
   * discriminator, and the non-numeric branch still returns a Promise so callers can await
   * both arms without a branch of their own.
   */
  resolveDoubtFlag(uidOrFlag: string): Promise<string> {
    if (!/^\d+$/.test(uidOrFlag)) return Promise.resolve(uidOrFlag);
    return this.#ctx.resolveUserUid(Number.parseInt(uidOrFlag, 10));
  }
}