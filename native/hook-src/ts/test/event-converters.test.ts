// Tests for the MsgPushEvent → OneBot event converter layer.
//
// What these pin down is FIELD SEMANTICS, not shape. Every converter produces an
// object with the right keys easily enough; the interesting failures are all
// "right key, wrong account in it":
//
//   * `operator_id` vs `user_id` on a recall (an admin recalling my message must not
//     read as "I recalled it");
//   * `user_id` on a self-sent private message (the bot) vs `target_id` (the peer);
//   * `sender.card`/`role` existing on a group message and NOT on a private one;
//   * `message_id` being a hash of the right namespace (`group_message` vs
//     `private_message` vs `private_message_nt`) — a wrong event name produces a
//     plausible integer that resolves to nothing;
//   * `time` staying in SECONDS.
//
// So most assertions name the value AND the field it must not be confused with.
//
// Inputs are real-shaped `MsgPushEvent` objects — every field the decoder actually
// fills, including the optionals a given path omits (`peerUin` on a received message,
// `joinType` on a self-join). A sparse literal would let a converter pass by reading
// `undefined` where the reference reads a number.
//
// Line numbers in the assertions point at `reference/index.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONVERTERS,
  NON_CONVERTED_KINDS,
  applyMessageIdResolver,
  convertBotOffline,
  convertEvent,
  convertFriendAdd,
  convertFriendInputStatus,
  convertFriendMessage,
  convertFriendPoke,
  convertFriendProfileLike,
  convertFriendRecall,
  convertFriendRequest,
  convertGroupAdmin,
  convertGroupCardChange,
  convertGroupEssence,
  convertGroupFileUpload,
  convertGroupInvite,
  convertGroupMemberJoin,
  convertGroupMemberLeave,
  convertGroupMessage,
  convertGroupMsgEmojiLike,
  convertGroupMute,
  convertGroupNameChange,
  convertGroupPoke,
  convertGroupRecall,
  convertGroupTitleChange,
  convertTempMessage,
  isSameActor,
  type ConverterContext,
  type OneBotEvent,
} from "../src/bridge/event-converters.js";
import { GROUP_MESSAGE_EVENT, hashMessageIdInt32 } from "../src/onebot/actions/message-id.js";
import type { MsgPushEvent, MessageSegment } from "../src/msg-push.js";

// ===========================================================================
// Fixtures
// ===========================================================================

const SELF = 10001;
const PEER = 20002;
const OTHER = 30003;
const GROUP = 200001;
const NOW = 1_750_000_000; // seconds, as QQ sends it — 2025-06-15, not ms.

/** A context with no media seams and NO id resolver, i.e. the reference's fallback. */
const BARE: ConverterContext = { selfId: SELF };

/** A context whose resolver records its calls, so the id NAMESPACE is assertable. */
function resolverContext(): ConverterContext & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    selfId: SELF,
    calls,
    messageIdResolver: (isGroup, sessionId, sequence, eventName, timestamp) => {
      calls.push([isGroup, sessionId, sequence, eventName, timestamp]);
      return hashMessageIdInt32(sequence, sessionId, String(eventName));
    },
  };
}

const text = (t: string): MessageSegment => ({ type: "text", text: t });

function groupMessageEvent(overrides: Partial<MsgPushEvent> = {}): MsgPushEvent {
  return {
    kind: "group_message",
    time: NOW,
    selfUin: SELF,
    senderUin: OTHER,
    msgSeq: 4211,
    msgId: 777,
    elements: [text("hello")],
    groupId: GROUP,
    groupName: "测试群",
    senderNick: "nick",
    senderCard: "card",
    senderRole: "admin",
    ...overrides,
  } as MsgPushEvent;
}

function friendMessageEvent(overrides: Partial<MsgPushEvent> = {}): MsgPushEvent {
  return {
    kind: "friend_message",
    time: NOW,
    selfUin: SELF,
    senderUin: PEER,
    senderUid: "u_peer",
    peerUin: PEER,
    msgSeq: 512,
    ntMsgSeq: 0,
    clientSeq: 99001,
    sequenceAuthoritative: true,
    msgId: 888,
    elements: [text("hi")],
    senderNick: "peer nick",
    ...overrides,
  } as MsgPushEvent;
}

// ===========================================================================
// Helpers
// ===========================================================================

function fields(event: OneBotEvent | null): Record<string, unknown> {
  assert.ok(event !== null, "expected a converted event, got null");
  return event as Record<string, unknown>;
}

// ===========================================================================
// The envelope — reference:23020-23049
// ===========================================================================

test("envelope: time is passed through in SECONDS and self_id is the context uin", async () => {
  // reference:23040 `message` — `{time: event.time, self_id: ctx.selfId, post_type}`.
  // No ×1000 anywhere in the three envelopes. A millisecond `time` would make every
  // client's timestamp 55 years in the future.
  const out = fields(await convertGroupMessage(BARE, groupMessageEvent()));
  assert.equal(out["time"], NOW);
  assert.equal(out["time"], 1_750_000_000);
  assert.ok(Number(out["time"]) < 1e11, "time must not be in milliseconds");
  assert.equal(out["self_id"], SELF);
});

test("envelope: post_type distinguishes notice / request / message / message_sent", async () => {
  assert.equal(fields(await convertFriendAdd(BARE, { kind: "friend_add", time: NOW, selfUin: SELF, userUin: PEER } as MsgPushEvent))["post_type"], "notice");
  assert.equal(fields(convertFriendRequest(BARE, { kind: "friend_request", time: NOW, selfUin: SELF, fromUin: PEER, fromUid: "u", message: "m", flag: "f" } as MsgPushEvent))["post_type"], "request");
  assert.equal(fields(await convertFriendMessage(BARE, friendMessageEvent()))["post_type"], "message");
  // reference:23060 — the SAME shape with `senderUin === selfId` is `message_sent`.
  assert.equal(
    fields(await convertFriendMessage(BARE, friendMessageEvent({ senderUin: SELF })))["post_type"],
    "message_sent",
  );
});

// ===========================================================================
// The message-id seam — reference:21682
// ===========================================================================

test("applyMessageIdResolver: with no resolver the RAW SEQUENCE is the id", async () => {
  // reference:21682 falls through to `Math.trunc(sequence)` — NOT a hash. Unreachable
  // in production (the host always supplies a resolver) but pinned here because a
  // "cleaner" fallback of 0 or a hash would silently break `get_msg`.
  assert.equal(await applyMessageIdResolver(null, true, GROUP, 4211, GROUP_MESSAGE_EVENT), 4211);
  assert.equal(await applyMessageIdResolver(undefined, true, GROUP, 4211, GROUP_MESSAGE_EVENT), 4211);
  // A 0 sequence stays 0 rather than becoming a hash or 1.
  assert.equal(await applyMessageIdResolver(null, true, GROUP, 0, GROUP_MESSAGE_EVENT), 0);
  // A fractional sequence truncates toward zero — no rounding.
  assert.equal(await applyMessageIdResolver(null, true, GROUP, 4211.9, GROUP_MESSAGE_EVENT), 4211);
});

test("applyMessageIdResolver: a non-integer or zero resolver result is IGNORED", async () => {
  // reference:21688 `if (Number.isInteger(resolved) && resolved !== 0) return resolved`.
  // The sequence wins. (The reference's `resolveReplyId` at :21691 instead THROWS on a
  // non-integer — contradiction C in event-converters.ts's header. Both are reproduced.)
  for (const bad of [0, 1.5, Number.NaN]) {
    assert.equal(
      await applyMessageIdResolver(() => bad, true, GROUP, 4211, GROUP_MESSAGE_EVENT),
      4211,
      `resolver returning ${bad} must fall back to the sequence`,
    );
  }
  assert.equal(
    await applyMessageIdResolver(() => -7, true, GROUP, 4211, GROUP_MESSAGE_EVENT),
    -7,
    "a negative integer is a valid non-zero integer and is accepted",
  );
});

test("convertGroupMessage: message_id is the hash of (seq, group, 'group_message')", async () => {
  const ctx = resolverContext();
  const out = fields(await convertGroupMessage(ctx, groupMessageEvent()));
  assert.equal(out["message_id"], hashMessageIdInt32(4211, GROUP, GROUP_MESSAGE_EVENT));
  // The NAMESPACE is the fourth argument; a wrong one hashes to a different integer
  // that resolves to nothing, which is why the call is asserted and not just the value.
  assert.deepEqual(ctx.calls[0], [true, GROUP, 4211, GROUP_MESSAGE_EVENT, undefined]);
  // `message_seq` is the raw sequence and survives independently of the id.
  assert.equal(out["message_seq"], 4211);
});

// ===========================================================================
// convertFriendMessage — reference:23096 → shared body at :23059
// ===========================================================================

test("convertFriendMessage: private envelope, sender without card/role", async () => {
  const out = fields(await convertFriendMessage(BARE, friendMessageEvent()));
  assert.equal(out["message_type"], "private");
  assert.equal(out["sub_type"], "friend");
  assert.equal(out["user_id"], PEER);
  assert.equal(out["font"], 0);
  assert.equal(out["raw_message"], "hi");
  assert.deepEqual(out["message"], [{ type: "text", data: { text: "hi" } }]);

  // reference:23081 builds the private sender with FOUR keys. `card` and `role` are
  // absent because a private chat has no member record — an empty string there would
  // read as "this member has no card" rather than "there is no card concept".
  const sender = out["sender"] as Record<string, unknown>;
  assert.deepEqual(Object.keys(sender).sort(), ["age", "nickname", "sex", "user_id"]);
  assert.equal(sender["user_id"], PEER);
  assert.equal(sender["nickname"], "peer nick");
  assert.equal(sender["sex"], "unknown");
  assert.equal(sender["age"], 0);

  // A received message names no target: `user_id` already is the peer.
  assert.ok(!("target_id" in out), "target_id belongs to a self-sent echo only");
});

test("convertFriendMessage: a self-sent echo flips post_type and adds target_id", async () => {
  // reference:23060-23062 + :23088. `senderUin === selfId` ⇒ `message_sent`, and the
  // PEER moves to `target_id` because `user_id` is now the bot.
  const out = fields(await convertFriendMessage(BARE, friendMessageEvent({ senderUin: SELF, peerUin: PEER })));
  assert.equal(out["post_type"], "message_sent");
  assert.equal(out["user_id"], SELF, "user_id is the SENDER, which is the bot on an echo");
  assert.equal(out["target_id"], PEER);
  // The conversation is still keyed by the peer, so the id matches what a later
  // lookup against the peer's session would compute — not a self-with-self hash.
  assert.equal(out["message_id"], 512, "no resolver ⇒ raw msgSeq");
});

test("convertFriendMessage: target_id is omitted when the peer IS the bot", async () => {
  // reference:23088 `sessionId > 0 && sessionId !== ctx.selfId`. A message from the
  // bot to itself would otherwise produce `user_id === target_id`, which a client
  // renders as a conversation with an unknown party.
  const out = fields(
    await convertFriendMessage(BARE, friendMessageEvent({ senderUin: SELF, peerUin: SELF })),
  );
  assert.equal(out["post_type"], "message_sent");
  assert.ok(!("target_id" in out));
});

test("convertFriendMessage: sessionId prefers peerUin over senderUin", async () => {
  // reference:23064. Asserted through the resolver's argument list rather than the
  // hash, because a hash of the wrong session is just a different opaque integer.
  const ctx = resolverContext();
  await convertFriendMessage(ctx, friendMessageEvent({ senderUin: SELF, peerUin: PEER }));
  assert.equal(ctx.calls[0]![1], PEER, "the CONVERSATION, not the sender");

  // Built without `peerUin` at all rather than with `peerUin: undefined` —
  // `exactOptionalPropertyTypes` makes those different, and the decoder omits the
  // field on a received message rather than setting it to undefined.
  const received = friendMessageEvent() as Extract<MsgPushEvent, { kind: "friend_message" }>;
  delete received.peerUin;
  const noPeer = resolverContext();
  await convertFriendMessage(noPeer, received);
  assert.equal(noPeer.calls[0]![1], PEER, "with no peerUin the sender is the conversation");
});

test("convertFriendMessage: ntMsgSeq selects the id sequence and the _nt namespace", async () => {
  // reference:23065-23072. A canonical NT sequence (>0 AND authoritative) ids by
  // `ntMsgSeq` under `private_message_nt`; otherwise by `msgSeq` under
  // `private_message`/`private_message_sent`. The two namespaces deliberately differ
  // so the same message cannot collide across them.
  const withNt = resolverContext();
  await convertFriendMessage(withNt, friendMessageEvent({ ntMsgSeq: 77, msgSeq: 512 }));
  assert.deepEqual(withNt.calls[0], [false, PEER, 77, "private_message_nt", undefined]);

  const notAuthoritative = resolverContext();
  await convertFriendMessage(
    notAuthoritative,
    friendMessageEvent({ ntMsgSeq: 77, sequenceAuthoritative: false }),
  );
  assert.deepEqual(notAuthoritative.calls[0], [false, PEER, 512, "private_message", undefined]);

  const sent = resolverContext();
  await convertFriendMessage(sent, friendMessageEvent({ senderUin: SELF, ntMsgSeq: 0 }));
  assert.deepEqual(sent.calls[0], [false, PEER, 512, "private_message_sent", undefined]);
});

// ===========================================================================
// convertGroupMessage — reference:23102
// ===========================================================================

test("convertGroupMessage: sender carries card, role and the group's identity fields", async () => {
  const out = fields(await convertGroupMessage(BARE, groupMessageEvent()));
  assert.equal(out["message_type"], "group");
  assert.equal(out["sub_type"], "normal");
  assert.equal(out["group_id"], GROUP);
  assert.equal(out["group_name"], "测试群");
  assert.equal(out["user_id"], OTHER);
  // reference:23102's `anonymous: null` — the KEY must exist so a client can test it.
  assert.ok("anonymous" in out);
  assert.equal(out["anonymous"], null);

  const sender = out["sender"] as Record<string, unknown>;
  assert.equal(sender["user_id"], OTHER);
  assert.equal(sender["nickname"], "nick");
  assert.equal(sender["card"], "card");
  assert.equal(sender["role"], "admin");
});

test("convertGroupMessage: senderRole '' falls back to 'member', card is NOT defaulted", async () => {
  // reference:23120 `event.senderRole || "member"`. An empty CARD stays empty (it is a
  // real state: a member with no card), while an empty ROLE would read as "not a
  // member" to some clients — hence the asymmetry.
  const out = fields(
    await convertGroupMessage(BARE, groupMessageEvent({ senderRole: "", senderCard: "" })),
  );
  const sender = out["sender"] as Record<string, unknown>;
  assert.equal(sender["role"], "member");
  assert.equal(sender["card"], "");
});

test("convertGroupMessage: the bot's own group message is message_sent", async () => {
  const out = fields(await convertGroupMessage(BARE, groupMessageEvent({ senderUin: SELF })));
  assert.equal(out["post_type"], "message_sent");
  assert.equal(out["user_id"], SELF);
});

// ===========================================================================
// convertTempMessage — reference:23099
// ===========================================================================

test("convertTempMessage: sub_type 'group', sender carries group_id, never a role", async () => {
  // reference:23077 — the temp sender gets `group_id` (so a client can resolve the
  // member) but NO card/role, because the card belongs to a group membership the
  // decoder for a temp message does not read.
  const event: MsgPushEvent = {
    kind: "temp_message",
    time: NOW,
    selfUin: SELF,
    senderUin: OTHER,
    msgSeq: 60,
    ntMsgSeq: 0,
    clientSeq: 61,
    sequenceAuthoritative: true,
    elements: [text("temp")],
    groupId: GROUP,
    senderNick: "stranger",
  };
  const out = fields(await convertTempMessage(BARE, event));
  assert.equal(out["message_type"], "private");
  assert.equal(out["sub_type"], "group");
  const sender = out["sender"] as Record<string, unknown>;
  assert.equal(sender["group_id"], GROUP);
  assert.ok(!("card" in sender));
  assert.ok(!("role" in sender));

  // reference:23077 `groupId > 0` guard — an unknown group omits the key entirely.
  const noGroup = fields(
    await convertTempMessage(BARE, { ...event, groupId: 0 } as MsgPushEvent),
  );
  assert.ok(!("group_id" in (noGroup["sender"] as Record<string, unknown>)));
});

test("convertTempMessage: a temp message NEVER uses the NT namespace", async () => {
  // reference:23064 — its sequence is the GROUP's, so the conversation-wide NT
  // namespace does not apply, whatever `ntMsgSeq` the decoder happened to fill.
  const ctx = resolverContext();
  const event = {
    kind: "temp_message",
    time: NOW,
    selfUin: SELF,
    senderUin: OTHER,
    msgSeq: 60,
    ntMsgSeq: 999,
    clientSeq: 61,
    sequenceAuthoritative: true,
    elements: [],
    groupId: GROUP,
    senderNick: "s",
  } as MsgPushEvent;
  await convertTempMessage(ctx, event);
  assert.deepEqual(ctx.calls[0], [false, OTHER, 60, "private_message", undefined]);
});

// ===========================================================================
// Member join / leave — reference:23130, :23139
// ===========================================================================

test("convertGroupMemberJoin: explicit joinType wins over the operator inference", async () => {
  const base = {
    kind: "group_member_join",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    userUin: OTHER,
    operatorUin: 40004,
    userUid: "u_other",
    operatorUid: "u_op",
  } as const;
  assert.equal(
    fields(convertGroupMemberJoin(BARE, { ...base, joinType: "invite" } as MsgPushEvent))["sub_type"],
    "invite",
  );
  assert.equal(
    fields(convertGroupMemberJoin(BARE, { ...base, joinType: "approve" } as MsgPushEvent))["sub_type"],
    "approve",
  );

  // No joinType ⇒ infer from whether operator and member are the same account
  // (reference:23134). Same actor ⇒ self-approval ⇒ "approve".
  assert.equal(
    fields(
      convertGroupMemberJoin(BARE, { ...base, operatorUin: OTHER } as MsgPushEvent),
    )["sub_type"],
    "approve",
  );
  const out = fields(convertGroupMemberJoin(BARE, base as unknown as MsgPushEvent));
  assert.equal(out["notice_type"], "group_increase");
  assert.equal(out["group_id"], GROUP);
  assert.equal(out["operator_id"], 40004);
  assert.equal(out["user_id"], OTHER);
});

test("isSameActor: uin wins when both are known, uid is the fallback", async () => {
  // reference:21675. Two uins present ⇒ compared as numbers, and the uids are ignored
  // even if they disagree (they come from different decode variants and a stale uid
  // must not split one account into two).
  assert.equal(isSameActor(5, "a", 5, "b"), true);
  assert.equal(isSameActor(5, "a", 6, "a"), false);
  // Either uin missing ⇒ uid equality, and an EMPTY uid never matches
  // (`Boolean(leftUid) && ...`).
  assert.equal(isSameActor(0, "a", 5, "a"), true);
  assert.equal(isSameActor(0, "", 0, ""), false, "an empty uid is not an identity");
  assert.equal(isSameActor(0, "a", 0, "b"), false);
  // ⚠️ BOTH uins present short-circuits BEFORE the uid is looked at, so two empty
  // uids on the same account still compare equal — the uin is the identity and the
  // uid is only the fallback. Asserted because the opposite reads as the "safer"
  // behaviour and would silently change `group_member_join`'s sub_type inference.
  assert.equal(isSameActor(5, "", 5, ""), true);
});

test("convertGroupMemberLeave: kick/kick_me/disband/leave", async () => {
  const base = {
    kind: "group_member_leave",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    userUin: OTHER,
    operatorUin: 40004,
    userUid: "u",
    operatorUid: "o",
  } as const;
  const sub = (leaveType: string, userUin: number) =>
    fields(
      convertGroupMemberLeave(BARE, { ...base, leaveType, userUin } as unknown as MsgPushEvent),
    )["sub_type"];

  assert.equal(sub("kick", OTHER), "kick");
  // reference:23144 — the SAME kick is `kick_me` when the target is the bot. Without
  // this a bot cannot tell "I was removed" from "someone was removed".
  assert.equal(sub("kick", SELF), "kick_me");
  assert.equal(sub("disband", OTHER), "disband");
  assert.equal(sub("leave", OTHER), "leave");
  const out = fields(convertGroupMemberLeave(BARE, base as unknown as MsgPushEvent));
  assert.equal(out["notice_type"], "group_decrease");
  assert.equal(out["operator_id"], 40004);
});

// ===========================================================================
// Mute / admin — reference:23158, :23168
// ===========================================================================

test("convertGroupMute: duration>0 is ban, 0 is lift_ban, and the duration is echoed", async () => {
  const base = {
    kind: "group_mute",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    operatorUin: 40004,
    userUin: OTHER,
  } as const;
  const banned = fields(convertGroupMute(BARE, { ...base, duration: 600 } as MsgPushEvent));
  assert.equal(banned["notice_type"], "group_ban");
  assert.equal(banned["sub_type"], "ban");
  assert.equal(banned["duration"], 600);
  // reference:23163 `duration > 0 ? "ban" : "lift_ban"` — 0 is UNMUTE, not a no-op.
  assert.equal(
    fields(convertGroupMute(BARE, { ...base, duration: 0 } as MsgPushEvent))["sub_type"],
    "lift_ban",
  );
  assert.equal(
    fields(convertGroupMute(BARE, { ...base, duration: 0 } as MsgPushEvent))["duration"],
    0,
  );
  assert.equal(banned["operator_id"], 40004);
  assert.equal(banned["user_id"], OTHER);
});

test("convertGroupAdmin: set/unset, and NO operator_id", async () => {
  const event = {
    kind: "group_admin",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    userUin: OTHER,
    set: true,
  } as MsgPushEvent;
  const out = fields(convertGroupAdmin(BARE, event));
  assert.equal(out["notice_type"], "group_admin");
  assert.equal(out["sub_type"], "set");
  assert.equal(out["user_id"], OTHER);
  // reference:23168 emits no operator. Inventing one would attribute the promotion to
  // the promoted member, which is the one thing the field could not mean.
  assert.ok(!("operator_id" in out));
  assert.equal(
    fields(convertGroupAdmin(BARE, { ...event, set: false } as MsgPushEvent))["sub_type"],
    "unset",
  );
});

// ===========================================================================
// Recalls — reference:23176, :23184
// ===========================================================================

test("convertGroupRecall: operator_id is the RECALLER, user_id is the AUTHOR", async () => {
  // reference:23184. An admin (40004) recalling another member's (OTHER) message:
  // reading `user_id` as "who recalled" misattributes the action to the victim.
  const ctx = resolverContext();
  const event: MsgPushEvent = {
    kind: "group_recall",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    operatorUin: 40004,
    authorUin: OTHER,
    msgSeq: 4211,
  };
  const out = fields(await convertGroupRecall(ctx, event));
  assert.equal(out["notice_type"], "group_recall");
  assert.equal(out["operator_id"], 40004);
  assert.equal(out["user_id"], OTHER);
  assert.notEqual(out["operator_id"], out["user_id"], "the two are different accounts here");
  // The recalled message is id'd in the GROUP namespace from the author's sequence.
  assert.equal(out["message_id"], hashMessageIdInt32(4211, GROUP, GROUP_MESSAGE_EVENT));
  assert.deepEqual(ctx.calls[0], [true, GROUP, 4211, GROUP_MESSAGE_EVENT, undefined]);
  // reference:23184 emits no `message_seq` — unlike `group_essence`, which does.
  assert.ok(!("message_seq" in out));
});

test("convertGroupRecall: a self-recall makes the two ids equal", async () => {
  const event: MsgPushEvent = {
    kind: "group_recall",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    operatorUin: OTHER,
    authorUin: OTHER,
    msgSeq: 1,
  };
  const out = fields(await convertGroupRecall(BARE, event));
  assert.equal(out["operator_id"], out["user_id"]);
});

test("convertFriendRecall: only user_id, no operator_id, and the id carries a timestamp", async () => {
  // reference:23176. A private recall names ONE account: the peer. There is no
  // operator concept — a friend recalling their own message has no third party, and
  // the wire packet does not carry one.
  const ctx = resolverContext();
  const event: MsgPushEvent = {
    kind: "friend_recall",
    time: NOW,
    selfUin: SELF,
    userUin: PEER,
    msgSeq: 512,
    clientSeq: 99001,
    recalledBySelf: false,
  };
  const out = fields(await convertFriendRecall(ctx, event));
  assert.equal(out["notice_type"], "friend_recall");
  assert.equal(out["user_id"], PEER);
  assert.ok(!("operator_id" in out));
  // THE ONLY message-id call in the file that passes a timestamp (reference:23178):
  // a private recall addresses a SENDER-LOCAL sequence, which can be reused, so the
  // store needs the time to disambiguate.
  assert.deepEqual(ctx.calls[0], [false, PEER, 512, "private_message", NOW]);

  // `recalledBySelf` moves the namespace, and the hardcoded `false` for NT means
  // `private_message_sent` — never the `_nt` variant.
  const selfRecall = resolverContext();
  await convertFriendRecall(selfRecall, { ...event, recalledBySelf: true } as MsgPushEvent);
  assert.deepEqual(selfRecall.calls[0], [false, PEER, 512, "private_message_sent", NOW]);
});

// ===========================================================================
// Pokes — reference:23194, :23206
// ===========================================================================

test("convertFriendPoke: four ids, and user_id is the CONVERSATION not the poker", async () => {
  // reference:23194. A poke in a group-temp conversation pokes someone inside a chat
  // whose peer is a third account: `user_id` (peer), `sender_id` (poker) and
  // `target_id` (poked) are all different here and must stay different.
  const event: MsgPushEvent = {
    kind: "friend_poke",
    time: NOW,
    selfUin: SELF,
    peerUin: PEER,
    senderUin: OTHER,
    targetUin: SELF,
    action: "戳了戳",
    suffix: "",
    actionImgUrl: "https://example/poke.png",
  };
  const out = fields(convertFriendPoke(BARE, event));
  assert.equal(out["notice_type"], "notify");
  assert.equal(out["sub_type"], "poke");
  assert.equal(out["user_id"], PEER);
  assert.equal(out["sender_id"], OTHER);
  assert.equal(out["target_id"], SELF);
  assert.equal(out["action"], "戳了戳");
  assert.equal(out["suffix"], "");
  assert.equal(out["action_img_url"], "https://example/poke.png");
});

test("convertGroupPoke: no sender_id, group_id instead", async () => {
  // reference:23206 — a group poke is attributed by membership, so `user_id` ALREADY
  // is the poker and a `sender_id` would duplicate it.
  const event: MsgPushEvent = {
    kind: "group_poke",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    userUin: OTHER,
    targetUin: SELF,
    action: "戳了戳",
    suffix: "一下",
    actionImgUrl: "",
  };
  const out = fields(convertGroupPoke(BARE, event));
  assert.equal(out["group_id"], GROUP);
  assert.equal(out["user_id"], OTHER);
  assert.equal(out["target_id"], SELF);
  assert.ok(!("sender_id" in out));
  assert.equal(out["action_img_url"], "");
});

// ===========================================================================
// Essence — reference:23218
// ===========================================================================

test("convertGroupEssence: user_id AND sender_id both name the author", async () => {
  // reference:23218 writes the author twice under two keys; `operator_id` is the
  // moderator. A reader that expects `sender_id` (a poke-ism) must still find it.
  const event: MsgPushEvent = {
    kind: "group_essence",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    senderUin: OTHER,
    operatorUin: 40004,
    msgSeq: 4211,
    random: 12345,
    set: true,
  };
  const out = fields(await convertGroupEssence(BARE, event));
  assert.equal(out["notice_type"], "essence");
  assert.equal(out["sub_type"], "add");
  assert.equal(out["user_id"], OTHER);
  assert.equal(out["sender_id"], OTHER);
  assert.equal(out["operator_id"], 40004);
  assert.equal(out["message_id"], 4211, "no resolver ⇒ raw sequence");
  assert.equal(out["message_seq"], 4211);
  assert.equal(out["random"], 12345, "the wire random names the message with the seq");
  assert.equal(
    fields(await convertGroupEssence(BARE, { ...event, set: false } as MsgPushEvent))["sub_type"],
    "delete",
  );
});

// ===========================================================================
// group_msg_emoji_like — reference:23304
// ===========================================================================

test("convertGroupMsgEmojiLike: likes is a one-element ARRAY with emoji_id and count", async () => {
  // reference:23312. The array shape is the whole point: a client iterates `likes`,
  // so a bare `{emoji_id, count}` object would throw on `.map`. And the wire push
  // carries exactly one emoji at a time, so the array has exactly one entry.
  const event: MsgPushEvent = {
    kind: "group_msg_emoji_like",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    operatorUin: OTHER,
    operatorUid: "u",
    msgSeq: 4211,
    emojiId: "185",
    count: 7,
    isAdd: true,
  };
  const out = fields(await convertGroupMsgEmojiLike(BARE, event));
  assert.equal(out["notice_type"], "group_msg_emoji_like");
  assert.equal(out["sub_type"], "add");
  assert.deepEqual(out["likes"], [{ emoji_id: "185", count: 7 }]);
  assert.ok(Array.isArray(out["likes"]));
  // `emoji_id` is a STRING on the wire and must not be coerced to a number: QQ's
  // ids include values with no numeric reading.
  assert.equal(typeof (out["likes"] as { emoji_id: unknown }[])[0]!["emoji_id"], "string");
  assert.equal((out["likes"] as { emoji_id: unknown }[])[0]!["emoji_id"], "185");

  // reference:23310 writes the SAME account into both keys. Not a bug to "fix": one
  // names the actor of the notice, the other the owner of the reaction.
  assert.equal(out["user_id"], OTHER);
  assert.equal(out["operator_id"], OTHER);
  assert.equal(out["message_id"], 4211);
  assert.equal(out["message_seq"], 4211);

  assert.equal(
    fields(await convertGroupMsgEmojiLike(BARE, { ...event, isAdd: false } as MsgPushEvent))["sub_type"],
    "remove",
  );
});

// ===========================================================================
// group_file_upload — reference:23232 (no producer; contradiction A)
// ===========================================================================

test("convertGroupFileUpload: file.busid is lowercase on the wire", async () => {
  // reference:23239. The event field is `busId` (camel) and the OneBot key is `busid`
  // (all lowercase) — a "consistent" spelling here changes the response a client reads.
  const event: MsgPushEvent = {
    kind: "group_file_upload",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    userUin: OTHER,
    fileId: "fe123",
    fileName: "a.zip",
    fileSize: 4096,
    busId: 9001,
  };
  const out = fields(convertGroupFileUpload(BARE, event));
  assert.equal(out["notice_type"], "group_upload");
  assert.equal(out["group_id"], GROUP);
  assert.equal(out["user_id"], OTHER);
  assert.deepEqual(out["file"], { id: "fe123", name: "a.zip", size: 4096, busid: 9001 });
  assert.ok(!("busId" in (out["file"] as Record<string, unknown>)));
});

// ===========================================================================
// The remaining small notices
// ===========================================================================

test("convertFriendAdd: one field beyond the envelope", async () => {
  const out = fields(
    convertFriendAdd(BARE, { kind: "friend_add", time: NOW, selfUin: SELF, userUin: PEER } as MsgPushEvent),
  );
  assert.deepEqual(out, {
    time: NOW,
    self_id: SELF,
    post_type: "notice",
    notice_type: "friend_add",
    user_id: PEER,
  });
});

test("convertGroupCardChange: card_new / card_old, and no operator", async () => {
  const out = fields(
    convertGroupCardChange(
      BARE,
      {
        kind: "group_card_change",
        time: NOW,
        selfUin: SELF,
        groupId: GROUP,
        userUin: OTHER,
        cardNew: "new",
        cardOld: "old",
      } as MsgPushEvent,
    ),
  );
  assert.equal(out["notice_type"], "group_card");
  assert.equal(out["card_new"], "new");
  assert.equal(out["card_old"], "old");
  assert.ok(!("operator_id" in out), "the derived event names no actor (reference:23251)");
});

test("convertBotOffline: user_id is the BOT, not a peer", async () => {
  // reference:23260 — the only notice here about the account being driven. Copying
  // the `userUin` convention of the others would report some stranger going offline.
  const out = fields(
    convertBotOffline(
      BARE,
      { kind: "bot_offline", time: NOW, selfUin: SELF, tag: "KICKED_OUT", message: "signed in on another device" } as MsgPushEvent,
    ),
  );
  assert.equal(out["notice_type"], "bot_offline");
  assert.equal(out["user_id"], SELF);
  assert.equal(out["tag"], "KICKED_OUT");
  assert.equal(out["message"], "signed in on another device");
});

test("convertFriendProfileLike: operator_id/operator_nick, not user_id", async () => {
  // reference:23268. A like is a MUTUAL action, so the actor is an operator; and the
  // notice carries no `user_id` at all, which is why a client cannot read the likers'
  // conversation from it.
  const out = fields(
    convertFriendProfileLike(
      BARE,
      { kind: "friend_profile_like", time: NOW, selfUin: SELF, operatorUin: OTHER, operatorNick: "liker", times: 3 } as MsgPushEvent,
    ),
  );
  assert.equal(out["notice_type"], "notify");
  assert.equal(out["sub_type"], "profile_like");
  assert.equal(out["operator_id"], OTHER);
  assert.equal(out["operator_nick"], "liker");
  assert.equal(out["times"], 3);
  assert.ok(!("user_id" in out));
});

test("convertGroupTitleChange: notice_type notify, sub_type title", async () => {
  const out = fields(
    convertGroupTitleChange(
      BARE,
      { kind: "group_title_change", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, title: "水群小能手" } as MsgPushEvent,
    ),
  );
  assert.equal(out["notice_type"], "notify");
  assert.equal(out["sub_type"], "title");
  assert.equal(out["group_id"], GROUP);
  assert.equal(out["user_id"], OTHER);
  assert.equal(out["title"], "水群小能手");
});

test("convertGroupNameChange: user_id is the OPERATOR and there is no name_old", async () => {
  // reference:23286. Two traps: `user_id` is who renamed the group (NOT the group
  // number, which is in `group_id`), and the wire notice carries only the new name —
  // a `name_old: ""` would be an invented field.
  const out = fields(
    convertGroupNameChange(
      BARE,
      { kind: "group_name_change", time: NOW, selfUin: SELF, groupId: GROUP, operatorUin: OTHER, name: "新名字" } as MsgPushEvent,
    ),
  );
  assert.equal(out["sub_type"], "group_name");
  assert.equal(out["group_id"], GROUP);
  assert.equal(out["user_id"], OTHER);
  assert.notEqual(out["user_id"], GROUP, "the operator, not the group");
  assert.equal(out["name_new"], "新名字");
  assert.ok(!("name_old" in out));
});

test("convertFriendInputStatus: event_type raw beside status_text", async () => {
  // reference:23295 — both are emitted so a client can branch on the NUMBER without
  // parsing Chinese. Dropping `event_type` would leave string comparison as the only
  // option, which breaks with the locale.
  const out = fields(
    convertFriendInputStatus(
      BARE,
      { kind: "friend_input_status", time: NOW, selfUin: SELF, userUin: PEER, userUid: "u", eventType: 1, statusText: "对方正在输入…" } as MsgPushEvent,
    ),
  );
  assert.equal(out["sub_type"], "input_status");
  assert.equal(out["user_id"], PEER);
  assert.equal(out["event_type"], 1);
  assert.equal(out["status_text"], "对方正在输入…");
});

// ===========================================================================
// Requests — reference:23322, :23330
// ===========================================================================

test("convertFriendRequest: flag is echoed unchanged", async () => {
  // reference:23322 — the flag is the request's sourceUid, which the client sends
  // back to `set_friend_add_request`. Any normalisation breaks the approval.
  const out = fields(
    convertFriendRequest(
      BARE,
      { kind: "friend_request", time: NOW, selfUin: SELF, fromUin: PEER, fromUid: "u", message: "我是张三", flag: "A:1:2" } as MsgPushEvent,
    ),
  );
  assert.deepEqual(out, {
    time: NOW,
    self_id: SELF,
    post_type: "request",
    request_type: "friend",
    user_id: PEER,
    comment: "我是张三",
    flag: "A:1:2",
  });
});

test("convertGroupInvite: invited_id is ABSENT when the invitee is unknown", async () => {
  // reference:23334 `...(invitedId > 0 ? { invited_id: invitedId } : {})`. The
  // join-request path never fills `invitedUin`, and a `0` there names a user that does
  // not exist rather than saying "unknown".
  const base = {
    kind: "group_invite",
    time: NOW,
    selfUin: SELF,
    groupId: GROUP,
    fromUin: OTHER,
    fromUid: "u",
    subType: "invite",
    message: "m",
    flag: "f",
  } as const;
  const withoutInvitee = fields(convertGroupInvite(BARE, base as unknown as MsgPushEvent));
  assert.ok(!("invited_id" in withoutInvitee));
  const zero = fields(convertGroupInvite(BARE, { ...base, invitedUin: 0 } as unknown as MsgPushEvent));
  assert.ok(!("invited_id" in zero), "0 and absent produce the same wire output");

  const withInvitee = fields(
    convertGroupInvite(BARE, { ...base, invitedUin: SELF } as unknown as MsgPushEvent),
  );
  assert.equal(withInvitee["invited_id"], SELF);
  assert.equal(withInvitee["request_type"], "group");
  assert.equal(withInvitee["sub_type"], "invite");
  assert.equal(withInvitee["user_id"], OTHER, "user_id is the INVITER");
  assert.equal(withInvitee["flag"], "f");

  // reference:23333 `event.subType || "invite"` — an empty sub-type falls back.
  assert.equal(
    fields(convertGroupInvite(BARE, { ...base, subType: "" } as unknown as MsgPushEvent))["sub_type"],
    "invite",
  );
});

// ===========================================================================
// The table and the dispatcher — reference:23344, :23372
// ===========================================================================

test("CONVERTERS: 23 converters and exactly 3 nulls, matching the reference's key set", () => {
  const keys = Object.keys(CONVERTERS) as (keyof typeof CONVERTERS)[];
  assert.equal(keys.length, 26, "23 + 3 explicit nulls");
  assert.equal(keys.filter((k) => CONVERTERS[k] !== null).length, 23);
  // reference:23368-23370. These three decode to real events and have no OneBot
  // notice; inventing one would put fields on the wire the reference never sends.
  assert.deepEqual([...NON_CONVERTED_KINDS].sort(), [
    "friend_remark_changed",
    "online_devices_changed",
    "ptt_trans_result",
  ]);
});

test("convertEvent: the three null entries return null, not an empty notice", async () => {
  for (const event of [
    { kind: "ptt_trans_result", time: NOW, selfUin: SELF, seq: 1, text: "x" },
    { kind: "online_devices_changed", time: NOW, selfUin: SELF, devices: [] },
    { kind: "friend_remark_changed", time: NOW, selfUin: SELF, userUin: PEER, remark: "r" },
  ] as unknown as MsgPushEvent[]) {
    assert.equal(await convertEvent(BARE, event), null, `${event.kind} must not convert`);
  }
});

test("convertEvent: dispatch reaches every converter and passes the event through", async () => {
  // One real event per converter, run through the DISPATCHER rather than the
  // function, so a table entry pointing at the wrong converter is caught — the
  // per-converter tests above would pass in that case.
  const cases: MsgPushEvent[] = [
    friendMessageEvent(),
    groupMessageEvent(),
    {
      kind: "temp_message", time: NOW, selfUin: SELF, senderUin: OTHER, msgSeq: 1,
      ntMsgSeq: 0, clientSeq: 1, sequenceAuthoritative: true, elements: [], groupId: GROUP, senderNick: "s",
    },
    { kind: "group_member_join", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, operatorUin: 4, userUid: "a", operatorUid: "b" },
    { kind: "group_member_leave", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, operatorUin: 4, userUid: "a", operatorUid: "b", leaveType: "leave" },
    { kind: "group_mute", time: NOW, selfUin: SELF, groupId: GROUP, operatorUin: 4, userUin: OTHER, duration: 60 },
    { kind: "group_admin", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, set: true },
    { kind: "friend_recall", time: NOW, selfUin: SELF, userUin: PEER, msgSeq: 1, clientSeq: 1, recalledBySelf: false },
    { kind: "group_recall", time: NOW, selfUin: SELF, groupId: GROUP, operatorUin: 4, authorUin: OTHER, msgSeq: 1 },
    { kind: "friend_poke", time: NOW, selfUin: SELF, peerUin: PEER, senderUin: OTHER, targetUin: SELF, action: "a", suffix: "", actionImgUrl: "" },
    { kind: "group_poke", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, targetUin: SELF, action: "a", suffix: "", actionImgUrl: "" },
    { kind: "group_essence", time: NOW, selfUin: SELF, groupId: GROUP, senderUin: OTHER, operatorUin: 4, msgSeq: 1, random: 1, set: true },
    { kind: "group_file_upload", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, fileId: "f", fileName: "n", fileSize: 1, busId: 2 },
    { kind: "friend_add", time: NOW, selfUin: SELF, userUin: PEER },
    { kind: "friend_input_status", time: NOW, selfUin: SELF, userUin: PEER, userUid: "u", eventType: 1, statusText: "s" },
    { kind: "friend_profile_like", time: NOW, selfUin: SELF, operatorUin: OTHER, operatorNick: "n", times: 1 },
    { kind: "bot_offline", time: NOW, selfUin: SELF, tag: "t", message: "m" },
    { kind: "group_name_change", time: NOW, selfUin: SELF, groupId: GROUP, operatorUin: OTHER, name: "n" },
    { kind: "group_title_change", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, title: "t" },
    { kind: "group_card_change", time: NOW, selfUin: SELF, groupId: GROUP, userUin: OTHER, cardNew: "a", cardOld: "b" },
    { kind: "group_msg_emoji_like", time: NOW, selfUin: SELF, groupId: GROUP, operatorUin: OTHER, operatorUid: "u", msgSeq: 1, emojiId: "185", count: 1, isAdd: true },
    { kind: "friend_request", time: NOW, selfUin: SELF, fromUin: PEER, fromUid: "u", message: "m", flag: "f" },
    { kind: "group_invite", time: NOW, selfUin: SELF, groupId: GROUP, fromUin: OTHER, fromUid: "u", subType: "invite", message: "m", flag: "f" },
  ];

  const kinds = new Set(cases.map((event) => event.kind));
  assert.equal(kinds.size, 23, "one case per non-null converter");
  for (const event of cases) {
    const out = await convertEvent(BARE, event);
    assert.notEqual(out, null, `${event.kind} should convert`);
    const envelope = fields(out);
    assert.equal(envelope["time"], NOW, `${event.kind} must pass event.time through`);
    assert.equal(envelope["self_id"], SELF, `${event.kind} must carry ctx.selfId`);
    // Every kind's own post_type, straight from the envelope helper it uses.
    const expected =
      event.kind === "friend_message" || event.kind === "group_message" || event.kind === "temp_message"
        ? "message"
        : event.kind === "friend_request" || event.kind === "group_invite"
          ? "request"
          : "notice";
    assert.equal(envelope["post_type"], expected, `${event.kind} post_type`);
  }
});

test("convertEvent: every converter rejects a mismatched event kind", async () => {
  // Each converter opens with a kind guard. Asserted because the guards are what stop
  // a table typo (two keys pointing at one converter) from producing an event with
  // the wrong `notice_type` instead of an error.
  const intruder = groupMessageEvent();
  for (const convert of Object.values(CONVERTERS)) {
    if (convert === null) continue;
    // `group_message` is the correct kind for one of them; skip that one.
    if (convert === CONVERTERS["group_message"]) continue;
    // The callback must be `async`: several converters throw SYNCHRONOUSLY, and
    // `Promise.resolve(convert(...))` would evaluate the call before `assert.rejects`
    // ever saw a promise, so the throw escaped the assertion.
    await assert.rejects(
      async () => convert(BARE, intruder),
      /wrong kind|convert\w+ called with group_message/,
      `${convert.name} should reject a group_message`,
    );
  }
});

// ===========================================================================
// Segments — the one media-bearing message shape
// ===========================================================================

test("a text + at + face group message renders segments and raw_message together", async () => {
  const event = groupMessageEvent({
    elements: [
      { type: "text", text: "hi " },
      { type: "at", targetUin: OTHER, text: "@nick" },
      { type: "face", faceId: 178 },
    ],
  });
  const out = fields(await convertGroupMessage(BARE, event));
  const segments = out["message"] as Record<string, unknown>[];
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], { type: "text", data: { text: "hi " } });
  assert.equal(segments[1]!["type"], "at");
  assert.equal((segments[1]!["data"] as Record<string, unknown>)["qq"], String(OTHER));
  assert.equal(segments[2]!["type"], "face");
  assert.deepEqual(segments[2]!["data"], { id: "178" });
  // reference:22969's segment output is what `raw_message` is then built FROM, so
  // asserting both pins the CQ round trip.
  // reference:22592 — `raw_message` is `segmentToCQ` of each ALREADY-CONVERTED
  // segment, so a codec that drops a field drops it from the raw text too. `face`
  // carries only `id` (reference:22578), and `at` only `qq`.
  assert.equal(out["raw_message"], "hi [CQ:at,qq=30003][CQ:face,id=178]");
});
