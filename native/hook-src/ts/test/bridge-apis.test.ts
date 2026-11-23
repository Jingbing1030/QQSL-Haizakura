// The ApiHub's wiring: which slices `buildApiHub` actually CONSTRUCTS, and which
// OneBot actions can therefore reach their bridge API at runtime.
//
// ---------------------------------------------------------------------------
// Why this file exists, and why "it compiles" was not enough
// ---------------------------------------------------------------------------
// `interaction.ts`, `friend.ts`, `group-file.ts` and `system-face.ts` were each
// implemented, reviewed and typechecked for several batches while answering
// `undefined` at runtime, because `buildApiHub` never listed them in its object
// literal. Nothing caught it, and the reason is structural rather than careless:
//
//   1. `buildApiHub` only *constructs* the classes. A test that imports
//      `new InteractionApi(ctx)` directly — which is what the slice tests do — is
//      green whether or not the hub ever holds one.
//   2. The action layer's `ActionApiHub` declares `interaction`, `friend`,
//      `groupFile`, `systemFace` as NON-OPTIONAL members, satisfied structurally by
//      whatever a host injects. So the action modules typecheck against a hub shape
//      the real hub did not provide.
//
// The consequence is a class of defect no compiler can see: a slice that exists,
// exports, and passes its own unit tests, but is unreachable from production. The
// tests below assert the two things that actually distinguish reachable from
// merely-present, and they assert them THROUGH `buildApiHub`/`Bridge` rather than
// by importing the classes:
//
//   a) the hub's own key order and instance identity (wired, not just imported), and
//   b) end-to-end dispatch of the real OneBot actions through the real hub, with the
//      result classified as "reached the slice" vs "the slice had no such method".
//
// (b) is the assertion that would have caught the original defect. A shape check
// alone would not have: `friend` was present in the type all along.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { buildApiHub, type PortedApiHub } from "../src/bridge/apis/index.js";
import { CollectionApi } from "../src/bridge/apis/collection.js";
import { MessageApi } from "../src/bridge/apis/message.js";
import { ContactsApi } from "../src/bridge/apis/contacts.js";
import { GroupInviteTracker } from "../src/bridge/apis/group-invite-tracker.js";
import { GroupAdminApi } from "../src/bridge/apis/group-admin.js";
import { GroupAlbumApi } from "../src/bridge/apis/group-album.js";
import { QzoneApi } from "../src/bridge/apis/qzone.js";
import { ProfileApi } from "../src/bridge/apis/profile.js";
import {
  UNIDIRECTIONAL_FRIEND_WIRE_NAME,
  buildUnidirectionalFriendRequest,
  toUnidirectionalFriends,
} from "../src/oidb/services/index.js";
import { WebApi } from "../src/bridge/apis/web.js";
import { GroupFileApi } from "../src/bridge/apis/group-file.js";
import { InteractionApi } from "../src/bridge/apis/interaction.js";
import { FriendApi } from "../src/bridge/apis/friend.js";
import { ExtrasApi } from "../src/bridge/apis/extras.js";
import { FlashTransferApi } from "../src/bridge/apis/flash-transfer.js";
import { SystemFaceApi } from "../src/bridge/apis/system-face.js";
import { actionRegistry, dispatchAction } from "../src/onebot/actions/index.js";
import type { ActionContext } from "../src/onebot/actions/context.js";

// ===========================================================================
// Fixtures
// ===========================================================================

const SELF_UIN = 10001;
const PEER_UIN = 20002;
const GROUP_ID = 111222333;

/**
 * A real `Bridge` over an in-memory roster, with no packet client bound.
 *
 * No client is deliberate: nothing here may touch the network, and an unbound
 * `sendRawPacket` answers `{success: false, errorMessage: "no packet sender
 * attached"}` instead of hanging on a timeout. That gives every action a fast,
 * deterministic "reached the slice, got as far as the transport" outcome, which is
 * exactly the signal these tests need.
 */
function makeBridge(): Bridge {
  const identity = new MemoryIdentity(String(SELF_UIN), "bot");
  identity.rememberFriends([{ uin: PEER_UIN, uid: `u_${PEER_UIN}`, nickname: "peer", remark: "" }]);
  return new Bridge(identity);
}

/**
 * The minimum `ActionContext` an `actionRegistry.bind` needs.
 *
 * The required members are the message store and the send path, neither of which any
 * action under test reaches — they exist so binding succeeds. Everything the
 * actions read (`ctx.bridge.apis.*`) comes from the REAL `Bridge`, which is the
 * entire point: a fake hub would reproduce the bug this file is testing for.
 */
function makeCtx(bridge: Bridge): ActionContext {
  const ctx = {
    bridge,
    getLoginInfo: () => ({ user_id: SELF_UIN, nickname: "bot" }),
    isOnline: () => true,
    getUptimeMs: () => 0,
    getMessage: async () => null,
    refreshMessageMedia: async () => {},
    getMessageMeta: async () => null,
    deleteMessage: async () => {},
    sendGroupMessage: async () => ({ messageId: 1 }),
    sendPrivateMessage: async () => ({ messageId: 1 }),
  };
  return ctx as unknown as ActionContext;
}

/** Dispatch one action and return `[retcode, wording]`. */
async function dispatch(
  handlers: ReturnType<typeof actionRegistry.bind>,
  name: string,
  params: Record<string, unknown>,
): Promise<{ retcode: number; wording: string }> {
  const response = await dispatchAction(handlers, name, params);
  const wording = typeof response.wording === "string" ? response.wording : "";
  return { retcode: response.retcode, wording };
}

// ===========================================================================
// 1. The hub's shape: the four newly wired slices are constructed, in order
// ===========================================================================

test("buildApiHub constructs the four previously-orphaned slices", () => {
  const bridge = makeBridge();
  const hub = buildApiHub(bridge);

  // Instance identity, not key presence: a hub could hold `undefined` under a
  // present key, and `exactOptionalPropertyTypes` is the only thing that forbids it.
  assert.ok(hub.groupFile instanceof GroupFileApi);
  assert.ok(hub.interaction instanceof InteractionApi);
  assert.ok(hub.friend instanceof FriendApi);
  assert.ok(hub.systemFace instanceof SystemFaceApi);

  // The eight that were already wired must still be wired — a construction that
  // dropped one while adding four would otherwise pass the assertions above.
  assert.ok(hub.collection instanceof CollectionApi);
  assert.ok(hub.message instanceof MessageApi);
  assert.ok(hub.contacts instanceof ContactsApi);
  assert.ok(hub.groupAdmin instanceof GroupAdminApi);
  assert.ok(hub.groupAlbum instanceof GroupAlbumApi);
  assert.ok(hub.qzone instanceof QzoneApi);
  assert.ok(hub.profile instanceof ProfileApi);
  assert.ok(hub.web instanceof WebApi);
  // `extras` is the newest slice and the fifth instance of the orphan trap this file
  // documents: the OIDB specs were all ported and green while `send_group_ai_record`
  // stayed "blocked", because the hub had no slot to reach them through.
  assert.ok(hub.extras instanceof ExtrasApi);
});

test("the hub's key order is the reference's, all sixteen present", () => {
  const bridge = makeBridge();

  // The reference's own literal (reference/index.mjs:339178) is:
  //   collection, message, contacts, groupAdmin, groupFile, groupAlbum, qzone,
  //   interaction, friend, profile, flashTransfer, forward, misc, extras, web,
  //   systemFace
  // Nothing is absent any more: `flashTransfer` (the last holdout) is a real
  // `FlashTransferApi` in its reference position — AFTER `profile`, BEFORE `forward`.
  // Note `systemFace` is LAST — it is the one slot whose position is easiest to get
  // wrong by guessing, so it is asserted by index too.
  //
  // `extras` sits between `misc` and `web`, which is the position most easily got
  // wrong: appending it after `systemFace` would still pass a "contains" assertion.
  const expected = [
    "collection",
    "message",
    "contacts",
    "groupAdmin",
    "groupFile",
    "groupAlbum",
    "qzone",
    "interaction",
    "friend",
    "profile",
    "flashTransfer",
    "forward",
    "misc",
    "extras",
    "web",
    "systemFace",
  ] as const;

  assert.deepEqual(Object.keys(bridge.apis), [...expected]);
  assert.equal(Object.keys(bridge.apis).at(-1), "systemFace");

  // No key is absent from the value any more. Asserted POSITIVELY rather than by
  // deleting the old absence loop, so a future slice cannot be dropped silently.
  assert.ok(bridge.apis.flashTransfer instanceof FlashTransferApi);
});

test("the hub's four new slices carry the members their actions call", () => {
  const bridge = makeBridge();
  const hub = bridge.apis;

  // Every one of these is read by a registered action, so a rename in a slice module
  // must fail here rather than at dispatch time in production.
  for (const method of ["sendPoke", "sendLike", "setReaction"] as const) {
    assert.equal(typeof hub.interaction[method], "function", `interaction.${method}`);
  }
  for (const method of ["handleRequest", "delete"] as const) {
    assert.equal(typeof hub.friend[method], "function", `friend.${method}`);
  }
  for (const method of ["getCount", "getSpace", "deleteFolder", "getUrl", "list"] as const) {
    assert.equal(typeof hub.groupFile[method], "function", `groupFile.${method}`);
  }
  for (const method of ["fetchCatalog", "fetchFace", "search", "isSuper"] as const) {
    assert.equal(typeof hub.systemFace[method], "function", `systemFace.${method}`);
  }
  // `extras` — the eight the 擴展 family calls, including the composite one. A rename
  // in `apis/extras.ts` must fail here rather than at dispatch time.
  for (const method of [
    "getStrangerStatus",
    "fetchAiVoiceList",
    "fetchAiVoice",
    "getGroupTodoList",
    "setGroupTodo",
    "completeGroupTodo",
    "cancelGroupTodo",
    "sendAiVoice",
  ] as const) {
    assert.equal(typeof hub.extras[method], "function", `extras.${method}`);
  }
});

// ===========================================================================
// 2. The `groupFile` slot's arity: the defect the intersection works around
// ===========================================================================

test("groupFile.getPrivateUrl keeps its real three-argument signature", async () => {
  const bridge = makeBridge();
  // `BridgeApiHub.groupFile` is typed as `GroupFileApiSlice`, whose `getPrivateUrl`
  // takes TWO arguments. The real method requires THREE (`fileHash` is part of the
  // `0xe37_1200` request). `PortedApiHub` declares the slot as an INTERSECTION so the
  // action layer keeps the 3-arg call; this asserts the arity did not silently
  // collapse to the 2-arg slice shape.
  assert.equal(bridge.apis.groupFile.getPrivateUrl.length, 3);

  // And the call itself accepts three arguments and runs — it fails one step later,
  // on the self-uid lookup, which is ordinary identity plumbing rather than an arity
  // problem. Awaited (not fire-and-forget): an un-awaited call here rejects after the
  // test ends and surfaces as an unhandledRejection attributed to this file.
  await assert.rejects(
    bridge.apis.groupFile.getPrivateUrl(0, "file", "hash"),
    /cannot resolve uid|no fetcher installed/,
  );
});

// ===========================================================================
// 3. End-to-end: the ten actions the prior report called unreachable
// ===========================================================================
//
// These are the exact names `MEMORY.md` §2.3ah listed as "接线即通" (one wire and
// done). Each is dispatched through the REAL hub, and the outcome is classified by
// whether the failure came from the slice being absent (TypeError, "is not a
// function") or from the slice working and the transport being unavailable.
//
// The distinction is the whole test: both are `retcode: 100`, so a test that only
// asserted "fails" would pass on a hub that is still broken.

/** `true` when the wording is the action reaching a slice member that does not exist. */
function isMissingMethod(wording: string): boolean {
  return /is not a function/.test(wording);
}

test("nine formerly unreachable actions now reach their slice", async () => {
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));

  const reached = {
    send_like: { user_id: PEER_UIN, times: 1 },
    friend_poke: { user_id: PEER_UIN },
    group_poke: { group_id: GROUP_ID, user_id: PEER_UIN },
    send_poke: { user_id: PEER_UIN },
    get_group_file_system_info: { group_id: GROUP_ID },
    delete_group_folder: { group_id: GROUP_ID, folder_id: "folder" },
    set_friend_remark: { user_id: PEER_UIN, remark: "x" },
    get_doubt_friends_add_request: { count: 10 },
    set_doubt_friends_add_request: { flag: "flag", approve: true },
  } as const;

  for (const [name, params] of Object.entries(reached)) {
    const { retcode, wording } = await dispatch(handlers, name, params);
    // The slice resolved, so the failure is downstream of it. Some actions fail on
    // uid resolution (no identity fetcher), and the rest on the unbound transport;
    // NEITHER is the hub being unwired.
    assert.equal(isMissingMethod(wording), false, `${name} must reach its slice, got: ${wording}`);
    assert.equal(retcode, 100, name);
    assert.match(wording, /no packet sender attached|cannot resolve uid/, name);
  }
});

test("trans_group_file reaches its slice", async () => {
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));
  const { retcode, wording } = await dispatch(handlers, "trans_group_file", {
    group_id: GROUP_ID,
    file_id: "file",
  });

  assert.equal(retcode, 100);
  assert.match(wording, /no packet sender attached/);
  assert.equal(isMissingMethod(wording), false);
});

test("the four registered `systemFace` actions reach their slice", async () => {
  // `actions/index.ts` registers these actions. Give each its valid parameters so
  // dispatch reaches SystemFaceApi and fails only when its OIDB transport is absent.
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));

  const actions = {
    fetch_sys_faces: { refresh: false },
    fetch_face_entity: { face_id: 1, refresh: false },
    search_sys_faces: { query: "face" },
    fetch_super_face_id: { face_id: 1, refresh: false },
  } as const;

  for (const [name, params] of Object.entries(actions)) {
    assert.ok(actionRegistry.resolve(name), `${name} is registered`);
    const { retcode, wording } = await dispatch(handlers, name, params);
    assert.equal(retcode, 100, name);
    assert.match(wording, /no packet sender attached/, name);
    assert.equal(isMissingMethod(wording), false, `${name} must reach its slice`);
  }
});

// ===========================================================================
// 3b. get_unidirectional_friend_list — the bare-packet transport
// ===========================================================================

test("get_unidirectional_friend_list reaches the transport, not a missing method", async () => {
  // `0x0e17_0` is the one spec that must NOT go through `invokeOidb`: its wire service is
  // `MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0` and the body is a bare request protobuf,
  // with no `{cmd, svc, result, body}` envelope. A wrapper would send a frame the server
  // rejects — and because the failure would look like a transport error, this test pins the
  // distinction: the slice must be REACHED, and the failure must be the unbound sender.
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));

  const { retcode, wording } = await dispatch(handlers, "get_unidirectional_friend_list", {});
  assert.equal(retcode, 100);
  assert.match(wording, /no packet sender attached/);
  assert.equal(isMissingMethod(wording), false, "the slice method must exist");
});

test("get_unidirectional_friend_list declares the bare wire name, not an OidbSvcTrpcTcp one", () => {
  // The wire name is the whole reason this command bypasses `invokeOidb`. Asserting on it
  // catches a future "cleanup" that routes it through the generic caller.
  assert.equal(UNIDIRECTIONAL_FRIEND_WIRE_NAME, "MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0");
  assert.equal(
    UNIDIRECTIONAL_FRIEND_WIRE_NAME.includes("OidbSvcTrpcTcp"),
    false,
    "an OidbSvcTrpcTcp name would mean the envelope path",
  );
});

test("the unidirectional request is JSON smuggled through protobuf fields 2 and 3", () => {
  // Two things go wrong silently here: the sub-command is duplicated (envelope field AND
  // body field 2), and the numbers are STRINGS because a UIN exceeds 2^53 as often as not.
  const body = buildUnidirectionalFriendRequest("10001");
  assert.equal(body.subCommand, 0, "sub-command is 0 and also lives in the body");
  const parsed = JSON.parse(body.jsonBody) as Record<string, unknown>;
  assert.equal(parsed.uint64_uin, "10001", "the UIN is a string, not a number");
  assert.equal(typeof parsed.uint64_uin, "string");
  assert.equal(parsed.uint32_req_num, 99);
  assert.equal(parsed.bytes_cookies, "", "`bytes_cookies` is a STRING, not bytes");
});

test("a well-formed envelope wrapping a failed ActionStatus is an error, not an empty list", () => {
  // The response carries two error layers: the protobuf `errorCode` and, inside the JSON,
  // `ActionStatus`/`ErrorCode`. Checking only the first reports a failure as "no one-way
  // friends", which is a plausible wrong answer.
  assert.throws(
    () => toUnidirectionalFriends({ errorCode: null, jsonBody: JSON.stringify({ ActionStatus: "FAIL", ErrorCode: 42, ErrorInfo: "denied" }), errorMessage: null }),
    /get unidirectional friend list failed: 42 denied/,
  );

  // A missing ErrorCode is named "missing" rather than rendered as `undefined`.
  assert.throws(
    () => toUnidirectionalFriends({ errorCode: null, jsonBody: JSON.stringify({ ActionStatus: "FAIL" }), errorMessage: null }),
    /get unidirectional friend list failed: missing/,
  );

  // An absent jsonBody is its own message — the envelope succeeded but carried nothing.
  assert.throws(
    () => toUnidirectionalFriends({ errorCode: null, jsonBody: null, errorMessage: null }),
    /get unidirectional friend list empty/,
  );

  // A non-array block list is an error: iterating it would silently yield nothing.
  assert.throws(
    () => toUnidirectionalFriends({ errorCode: null, jsonBody: JSON.stringify({ ActionStatus: "OK", ErrorCode: 0, rpt_block_list: {} }), errorMessage: null }),
    /get unidirectional friend list invalid block list/,
  );
});

test("a successful response returns the server's own blocks, unreshaped", () => {
  // Pass-through on purpose: the reference does not walk these into friend objects, and
  // inventing a `nickname` here would fabricate a field the response never carried.
  const blocks = [{ uint64_uin: "20002", uint64_top: 1, nickname: "peer" }];
  const result = toUnidirectionalFriends({
    errorCode: null,
    jsonBody: JSON.stringify({ ActionStatus: "OK", ErrorCode: 0, rpt_block_list: blocks }),
    errorMessage: null,
  });
  assert.deepEqual(result, blocks);
});

// ===========================================================================
// 3c. friend categories and the robot add option
// ===========================================================================

test("get_friends_with_category reaches the slice and groups the roster", async () => {
  // The action wants `contacts.fetchFriendCategories`, which is a PROJECTION over the
  // existing `0xfd4_0` roster walk — not a second `0x1cfe` command. The distinction
  // matters: a missing slice member reports "unavailable" while a projection failure
  // reports a transport error, and only the latter proves the wiring.
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));

  const { retcode, wording } = await dispatch(handlers, "get_friends_with_category", {});
  assert.equal(retcode, 100);
  assert.equal(/is not a function/.test(wording), false, "the slice method must exist");
});

test("set_friends_category refuses a friend whose uid is unknown", async () => {
  // `SetFriendCategoryParams.uid` (0x1255.ts:99) is the friend's uid, not the uin the
  // action receives. Sending a uin instead produces a well-formed request about a
  // nonexistent friend, which the server accepts without complaint — a silent no-op that
  // looks like success. The observable guard is the uid lookup: a roster that does not know
  // the friend must fail BEFORE a mutation, not after one that changed nothing.
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));

  // The param names are the reference's own (`uin` / `categoryId` / `categoryName`, NOT
  // snake_case). `categoryId` alone satisfies the `exactlyOneOf` rule; sending both is 1400.
  const { retcode, wording } = await dispatch(handlers, "set_friends_category", {
    uin: 999999,
    categoryId: 1,
  });
  assert.equal(retcode, 100);
  // Either the uid lookup fails (correct) or the call reaches the transport. Both prove the
  // uin was resolved rather than sent straight through.
  assert.match(wording, /no uid known for friend 999999|no packet sender attached/);
});

test("set_group_robot_add_option keeps an omitted switch distinct from 0", async () => {
  // `0xf00_3` carries two independent switches. The encoder writes a field only when the
  // argument is not `undefined`, so "leave this setting alone" and "turn it off" are
  // different requests. A `?? 0` default would silently disable a switch the caller never
  // mentioned, so the params stay optional all the way down.
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));

  const { retcode, wording } = await dispatch(handlers, "set_group_robot_add_option", {
    group_id: GROUP_ID,
    robot_member_switch: 1,
  });
  assert.equal(retcode, 100);
  assert.match(wording, /no packet sender attached/);
  assert.equal(isMissingMethod(wording), false);
});

// ===========================================================================
// 3d. every formerly-blocked action reaches its slice
// ===========================================================================

test("the eight newly unblocked actions all reach their slice, none stop at a guard", async () => {
  // The stub-era `if (!ctx.bridge.apis.xxx.method)` guards could never fire once the method
  // became a real class member, and a guard that CANNOT fire is worse than no guard: it
  // answers "unavailable" for a genuine failure. This asserts each action got PAST its
  // slice — the failure is the unbound transport, or a data lookup that legitimately needs
  // a live session, never the "… is unavailable" wording.
  const bridge = makeBridge();
  const handlers = actionRegistry.bind(makeCtx(bridge));

  const cases = {
    get_unidirectional_friend_list: {},
    get_friends_with_category: {},
    get_mini_app_ark: { type: "bili" },
    fetch_custom_face_detail: {},
    // A real-shaped id: seven underscore segments with a 32-hex md5 in the fifth. A
    // malformed one is rejected by `md5FromEmojiId` BEFORE the transport, which would
    // still pass a looser assertion.
    modify_custom_face: { emoji_id: `10001_0_0_0_${"A".repeat(32)}_0_0`, desc: "x" },
    move_custom_face_to_front: { emoji_id: `10001_0_0_0_${"A".repeat(32)}_0_0` },
    set_group_robot_add_option: { group_id: GROUP_ID, robot_member_switch: 1 },
    set_friends_category: { uin: PEER_UIN, categoryId: 1 },
  } as const;

  for (const [name, params] of Object.entries(cases)) {
    const { wording } = await dispatch(handlers, name, params);
    assert.equal(/is unavailable/.test(wording), false, `${name} must not report a missing slice: ${wording}`);
    assert.equal(
      /no packet sender attached|no uid known|cannot resolve uid/.test(wording),
      true,
      `${name} must reach the transport or a data lookup, got: ${wording}`,
    );
  }
});

// ===========================================================================
// 4. The type-level guard
// ===========================================================================

test("PortedApiHub is assignable to the looser BridgeApiHub", () => {
  const bridge = makeBridge();
  // `Bridge implements BridgeContext` already proves this at compile time; restating
  // it here keeps the relationship explicit at runtime, so a future narrowing of
  // either interface has a named place to fail.
  const hub: PortedApiHub = bridge.apis;
  assert.equal(typeof hub.interaction.sendPoke, "function");
});

// ===========================================================================
// 5. The seven `ContactsApi` members that used to be absent
// ===========================================================================
//
// These were the last gap on the class, and they divide into three kinds — each
// failing in a different way, which is why each is asserted separately rather than
// in one loop:
//
//   1. THREE tracker delegations (`groupInvites`) — pure state, no transport, so
//      "reaches the transport" is not even the question. They are asserted on their
//      RETURN VALUE, because the failure mode is a wrong pairing, not a missing
//      method;
//   2. THREE network methods (`fetchGroupMemberListUncached`, `loadFriendProfile`,
//      `fetchGroupRequestsByUid`) — asserted to reach the transport, which on an
//      unbound bridge means the "no packet sender attached" sentinel;
//   3. `resolveGroupJoinRequest` — the composite. It calls two inboxes, and on an
//      unbound bridge BOTH reject; per the reference's ordered `allSettled` check the
//      rethrown reason is `main`'s. That ordering is the assertion: with `Promise.all`
//      it would be whichever rejected first.

test("ContactsApi exposes the seven formerly-missing members", () => {
  // A shape check first, because a `TypeError: … is not a function` at call time is
  // a worse failure than a named one here. The four that used to be `undefined` on
  // the hub are the four this batch added.
  const contacts = makeBridge().apis.contacts;
  for (const method of [
    "getGroupInviteCardSequence",
    "rememberGroupInviteCardSequence",
    "findGroupInviteCardGroupBySequence",
    "fetchGroupMemberListUncached",
    "fetchGroupRequestsByUid",
    "loadFriendProfile",
    "resolveGroupJoinRequest",
  ] as const) {
    assert.equal(typeof contacts[method], "function", `contacts.${method} must exist`);
  }
  // `groupInvites` is the STATE the first three delegate to, and it must be a live
  // instance rather than a shape: `new GroupInviteTracker()` in a field initialiser is
  // the only thing that makes the three delegations stateful.
  assert.ok(contacts.groupInvites instanceof GroupInviteTracker);
});

test("the three tracker delegations are stateful, not no-ops", () => {
  // The defect these catch: a delegation that answers a plausible constant. A
  // `getGroupInviteCardSequence` returning `undefined` unconditionally, or a
  // `rememberGroupInviteCardSequence` returning `true` unconditionally, both typecheck
  // and both make the approval action unable to find its own card.
  const contacts = makeBridge().apis.contacts;

  assert.equal(contacts.getGroupInviteCardSequence(GROUP_ID), undefined, "no card seen yet");
  // ⚠️ `true` = UNPAIRED = "dispatch this card yourself". See the tracker's header for
  // why the flag is inverted.
  assert.equal(contacts.rememberGroupInviteCardSequence(GROUP_ID, 77), true);
  assert.equal(contacts.getGroupInviteCardSequence(GROUP_ID), 77, "the card was recorded");
  // A repeat of the same group/sequence is the same invitation, so it must NOT
  // dispatch — this is the dedupe, and it is the reason the return value matters.
  assert.equal(contacts.rememberGroupInviteCardSequence(GROUP_ID, 77), false);

  assert.equal(contacts.findGroupInviteCardGroupBySequence(77), GROUP_ID, "scoped by sequence");
  assert.equal(contacts.findGroupInviteCardGroupBySequence(77, GROUP_ID), GROUP_ID, "and by group");
  assert.equal(contacts.findGroupInviteCardGroupBySequence(404), undefined);

  // Two groups sharing a sequence makes the SCOPED lookup mandatory: the unscoped one
  // throws rather than picking a group, because approving the wrong group's invitation
  // is not a recoverable guess.
  contacts.rememberGroupInviteCardSequence(GROUP_ID + 1, 77);
  assert.throws(() => contacts.findGroupInviteCardGroupBySequence(77), /multiple groups match/);
  assert.equal(contacts.findGroupInviteCardGroupBySequence(77, GROUP_ID + 1), GROUP_ID + 1);
});

test("the three network members reach the transport", async () => {
  // An unbound bridge answers `{success: false, errorMessage: "no packet sender
  // attached"}` rather than hanging on a timeout, so every one of these must fail
  // with THAT message and not with "is not a function". Each is wrapped in
  // `rejects` because the OIDB caller turns the sentinel into a rejection.
  const contacts = makeBridge().apis.contacts;

  await assert.rejects(
    () => contacts.fetchGroupMemberListUncached(GROUP_ID),
    /no packet sender attached/,
    "fetchGroupMemberListUncached must go straight to the page walk",
  );

  // ⚠️ `loadFriendProfile` WRAPS the transport error ("friend profile query failed
  // for N") with the original as `cause`, so the message is the wrapper, not the
  // sentinel. Asserting the wrapper is what proves the concurrency gate let the call
  // through; asserting the sentinel would pass on a version that never reached it.
  await assert.rejects(
    () => contacts.loadFriendProfile(PEER_UIN),
    /friend profile query failed for 20002/,
    "loadFriendProfile must reach the profile query",
  );

  await assert.rejects(
    () => contacts.fetchGroupRequestsByUid(false, 50),
    /no packet sender attached/,
    "fetchGroupRequestsByUid must reach 0x496_9067",
  );
});

test("resolveGroupJoinRequest rethrows the MAIN inbox's reason when both fail", async () => {
  // `Promise.allSettled` + an ordered pair of `if (status === "rejected") throw`
  // (reference:74695). Both inboxes fail on an unbound bridge, but they fail with the
  // SAME message — so asserting on the transport sentinel would pass equally under
  // `Promise.all`, where the rethrown reason is whichever settled first.
  //
  // The two calls are therefore stubbed with DISTINCT reasons, which is the only
  // version of this test that actually pins the order. `filtered` is made to reject
  // FIRST in real time (0 ms timer vs 10 ms) so a `Promise.all` implementation would
  // answer "filtered" — the wrong one — and fail here.
  const contacts = makeBridge().apis.contacts;
  const real = contacts.fetchGroupRequestsByUid.bind(contacts);
  contacts.fetchGroupRequestsByUid = async (filtered = false) => {
    if (filtered) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      throw new Error("filtered inbox failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw new Error("main inbox failed");
  };
  try {
    // ⚠️ `main`'s reason, even though `filtered` rejects first. That is the point.
    await assert.rejects(
      () => contacts.resolveGroupJoinRequest(GROUP_ID, `u_${PEER_UIN}`, "add", undefined),
      /main inbox failed/,
      "the MAIN inbox's reason must win, regardless of settlement order",
    );
  } finally {
    contacts.fetchGroupRequestsByUid = real;
  }

  // And with the transport really unbound the same method rejects, which is the
  // production behaviour the stub above replaces for one assertion.
  await assert.rejects(
    () => makeBridge().apis.contacts.resolveGroupJoinRequest(GROUP_ID, `u_${PEER_UIN}`, "add", undefined),
    /no packet sender attached/,
  );
});