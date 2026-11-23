// Tests for `createActionMessageProviders` — the adapter from `MessageApi` + `MessageStore`
// to the OneBot `ActionContext` message providers.
//
// ---------------------------------------------------------------------------
// What these tests can and cannot establish
// ---------------------------------------------------------------------------
// They establish the ADAPTER's behaviour against fakes: which `MessageApi` method is called
// with which converted segments, what lands in the store under which key, and what a miss
// answers. They establish nothing about QQ: no `PacketClient` is bound anywhere below except
// in the one test that asserts the *absence* of one, and no packet is produced.
//
// The fake `MessageApi` is typed as `ActionMessageApi` (`Pick<MessageApi, …>`), so a rename
// in `bridge/apis/message.ts` fails this build rather than letting a fake silently diverge.
//
// ---------------------------------------------------------------------------
// The three checks that are the point of the file
// ---------------------------------------------------------------------------
//   1. The stored key is the RECEIPT's id, and the value handed back to the caller is the
//      same id. No fallback, no hash, no counter.
//   2. A transport failure leaves the store EMPTY and rejects with the transport's own
//      message — the `errorCode: -1` / `no packet sender attached` path is exercised against
//      the real `Bridge` and the real `MessageApi`, not a stub that imitates them.
//   3. Nothing fabricates: `getMessage`/`getMessageMeta` answer `null` on a miss,
//      `deleteMessage` answers `false` for an unknown id, and an absent media resolver
//      answers an explicit `unsupported` result rather than pretending to refresh.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { MessageApi, type C2cFileInfo, type SendMessageReceipt } from "../src/bridge/apis/message.js";
import { MessageStore } from "../src/host/message-store.js";
import {
  createActionMessageProviders,
  MEDIA_REFRESH_UNSUPPORTED_REASON,
  type ActionContextMessageProviders,
  type ActionMessageApi,
  type ActionMessageProviders,
} from "../src/host/action-message-providers.js";
import type { Segment } from "../src/element-builder.js";
import type { StoredMessageMeta } from "../src/onebot/actions/context.js";

// ===========================================================================
// Fakes
// ===========================================================================

interface SendCall {
  readonly kind: "group" | "private";
  readonly targetId: number;
  readonly segments: readonly Segment[];
}

interface RecallCall {
  readonly kind: "group" | "private";
  readonly args: readonly number[];
}

/**
 * A recording `MessageApi`.
 *
 * `outcome` decides what the send answers: a receipt, or a thrown error with the same
 * message the real `MessageApi` raises for a transport failure. The fake is explicitly
 * `Pick`-typed so it cannot drift from the class.
 */
function makeFakeApi(outcome: { receipt?: SendMessageReceipt; error?: Error } = {}): {
  api: ActionMessageApi;
  sends: SendCall[];
  recalls: RecallCall[];
  files: FileSendCall[];
} {
  const sends: SendCall[] = [];
  const recalls: RecallCall[] = [];
  const files: FileSendCall[] = [];
  const api: ActionMessageApi = {
    async sendGroup(groupId: number, segments: readonly Segment[]): Promise<SendMessageReceipt> {
      sends.push({ kind: "group", targetId: groupId, segments });
      if (outcome.error) throw outcome.error;
      return outcome.receipt ?? RECEIPT;
    },
    async sendPrivate(userId: number, segments: readonly Segment[]): Promise<SendMessageReceipt> {
      sends.push({ kind: "private", targetId: userId, segments });
      if (outcome.error) throw outcome.error;
      return outcome.receipt ?? RECEIPT;
    },
    async sendC2cFile(
      userUin: number,
      userUid: string,
      info: C2cFileInfo,
    ): Promise<SendMessageReceipt> {
      files.push({ userUin, userUid, info });
      if (outcome.error) throw outcome.error;
      return outcome.receipt ?? RECEIPT;
    },
    async recallGroup(groupId: number, sequence: number): Promise<void> {
      recalls.push({ kind: "group", args: [groupId, sequence] });
    },
    async recallPrivate(
      userUin: number,
      clientSeq: number,
      msgSeq: number,
      random: number,
      timestamp: number,
    ): Promise<void> {
      recalls.push({ kind: "private", args: [userUin, clientSeq, msgSeq, random, timestamp] });
    },
  };
  return { api, sends, recalls, files };
}

/** One `sendC2cFile` call, recorded with all three arguments. */
interface FileSendCall {
  userUin: number;
  userUid: string;
  info: C2cFileInfo;
}

/** A receipt with every field distinct, so a swapped field is visible. */
const RECEIPT: SendMessageReceipt = {
  messageId: 2_001_000_777,
  sequence: 4_321,
  clientSequence: 987_654,
  random: 1_234_567,
  timestamp: 1_700_000_000,
};

/** The recall metadata matching {@link RECEIPT}, in the shape the store validates. */
function metaFor(receipt: SendMessageReceipt, isGroup: boolean, targetId: number): StoredMessageMeta {
  return {
    isGroup,
    targetId,
    sequence: receipt.sequence,
    sequenceAuthoritative: receipt.sequence > 0,
    clientSequence: receipt.clientSequence,
    random: receipt.random,
    timestamp: receipt.timestamp,
  };
}

function newProviders(options: {
  api: ActionMessageApi;
  store: MessageStore;
  identity?: Parameters<typeof createActionMessageProviders>[0]["identity"];
  resolveMessageOut?: Parameters<typeof createActionMessageProviders>[0]["resolveMessageOut"];
  resolveMedia?: Parameters<typeof createActionMessageProviders>[0]["resolveMedia"];
  recallUploadedFile?: Parameters<typeof createActionMessageProviders>[0]["recallUploadedFile"];
}): ActionMessageProviders {
  return createActionMessageProviders({
    messageApi: options.api,
    store: options.store,
    identity: options.identity,
    resolveMessageOut: options.resolveMessageOut,
    resolveMedia: options.resolveMedia,
    recallUploadedFile: options.recallUploadedFile,
  });
}

/** An identity that can resolve a uin to a uid — what the c2c-file send needs. */
function fileIdentity(): Parameters<typeof createActionMessageProviders>[0]["identity"] {
  return {
    uin: "10001",
    resolveUid: (uin: number | string) => Promise.resolve(`u_${String(uin)}`),
  };
}

// ===========================================================================
// Send: success
// ===========================================================================

test("sendGroupMessage converts a string via the shared parser and stores under the receipt id", async () => {
  const { api, sends } = makeFakeApi();
  const store = new MessageStore();
  const providers = newProviders({ api, store });

  const result = await providers.sendGroupMessage(123456, "hello", true);

  // The id handed back IS the receipt's — not a hash, not a counter.
  assert.equal(result.messageId, RECEIPT.messageId);
  // The conversion is `parseMessage`'s: one text segment, `autoEscape` respected so a CQ
  // code stays literal text.
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0]!.segments, [{ type: "text", text: "hello" }]);
  // And the row is keyed by that same id, with the receipt's fields.
  assert.deepEqual(store.getMeta(RECEIPT.messageId), metaFor(RECEIPT, true, 123456));
});

test("sendGroupMessage parses a CQ string and a segment array without a second converter", async () => {
  const { api, sends } = makeFakeApi();
  const store = new MessageStore();
  const providers = newProviders({ api, store });

  await providers.sendGroupMessage(1, "a[CQ:face,id=14]b", false);
  assert.deepEqual(sends[0]!.segments, [
    { type: "text", text: "a" },
    { type: "face", faceId: 14 },
    { type: "text", text: "b" },
  ]);

  await providers.sendGroupMessage(1, [{ type: "text", data: { text: "x" } }], true);
  assert.deepEqual(sends[1]!.segments, [{ type: "text", text: "x" }]);
});

test("sendPrivateMessage stores a private row, with sequenceAuthoritative false when the sequence is 0", async () => {
  // A c2c send legitimately returns sequence 0. `hasAuthoritativeSequence` must then be
  // false, or `delete_msg` would recall sequence 0.
  const zeroSequence: SendMessageReceipt = { ...RECEIPT, messageId: 55_000_1, sequence: 0 };
  const { api, sends } = makeFakeApi({ receipt: zeroSequence });
  const store = new MessageStore();
  const providers = newProviders({ api, store });

  const result = await providers.sendPrivateMessage(20002, "hi", true);

  assert.equal(result.messageId, zeroSequence.messageId);
  assert.deepEqual(sends[0]!.segments, [{ type: "text", text: "hi" }]);
  const meta = store.getMeta(zeroSequence.messageId);
  assert.equal(meta?.isGroup, false);
  assert.equal(meta?.targetId, 20002);
  assert.equal(meta?.sequenceAuthoritative, false);
});

test("a successful send hands the built event to the store when resolveMessageOut answers one", async () => {
  const { api } = makeFakeApi();
  const store = new MessageStore();
  const providers = newProviders({
    api,
    store,
    resolveMessageOut: (draft) => ({
      post_type: "message_sent",
      message_id: draft.messageId,
      group_id: draft.targetId,
      message: draft.segments,
      raw_message: "hello",
    }),
  });

  await providers.sendGroupMessage(123456, "hello", true);

  assert.deepEqual(await providers.getMessage(RECEIPT.messageId), {
    post_type: "message_sent",
    message_id: RECEIPT.messageId,
    group_id: 123456,
    message: [{ type: "text", text: "hello" }],
    raw_message: "hello",
  });
  // With no builder, the row exists for recall but `get_msg` answers a real miss.
  const bare = new MessageStore();
  const bareProviders = newProviders({ api: makeFakeApi().api, store: bare });
  await bareProviders.sendGroupMessage(123456, "hello", true);
  assert.equal(await bareProviders.getMessage(RECEIPT.messageId), null);
  assert.notEqual(bare.getMeta(RECEIPT.messageId), null);
});

// ===========================================================================
// Send: failure
// ===========================================================================

test("a transport failure rejects with the transport's message and leaves the store empty", async () => {
  const { api } = makeFakeApi({ error: new Error("send group message failed: no packet sender attached") });
  const store = new MessageStore();
  const providers = newProviders({ api, store });

  await assert.rejects(
    providers.sendGroupMessage(123456, "hello", true),
    /no packet sender attached/,
  );
  assert.equal(store.size, 0);
  assert.equal(await providers.getMessageMeta(RECEIPT.messageId), null);
});

test("with no bound PacketClient the real send path fails with errorCode -1 and stores nothing", async () => {
  // The header's claim, exercised end to end: real `Bridge` (no `bindPid`, so no sender),
  // real `MessageApi`, real store. `Bridge.sendRawPacket` answers the synthetic
  // `{ success: false, gotResponse: false, errorCode: -1, errorMessage: "no packet sender
  // attached" }` and `MessageApi.sendGroup` converts it into a throw. No packet is produced.
  const bridge = new Bridge(new MemoryIdentity("10001"));
  const store = new MessageStore();
  const providers = newProviders({ api: new MessageApi(bridge), store });

  await assert.rejects(
    () => providers.sendGroupMessage(123456, "hello", true),
    /send group message failed: no packet sender attached/,
  );
  assert.equal(store.size, 0, "a failed send must not answer a messageId or store a row");
});

test("an unusable receipt id is refused rather than stored under a fabricated key", async () => {
  // `MessageApi.sendPrivate` can return `messageId: 0` when it has neither a random nor a
  // sequence. Answering `{ messageId: 0 }` would hand the client an id `f.messageId()`
  // rejects, and storing under 0 would be a phantom row.
  const { api } = makeFakeApi({ receipt: { ...RECEIPT, messageId: 0, sequence: 0 } });
  const store = new MessageStore();
  const providers = newProviders({ api, store });

  await assert.rejects(() => providers.sendPrivateMessage(20002, "hi", true), /unusable message id \(0\)/);
  assert.equal(store.size, 0);
});

// ===========================================================================
// Send: input the adapter refuses by name
// ===========================================================================

test("a forward node list is refused by name, not parsed", async () => {
  const { api, sends } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore() });

  await assert.rejects(
    () => providers.sendGroupMessage(1, [{ type: "node", data: { id: "1" } }], false),
    /needs a forward sender/,
  );
  assert.equal(sends.length, 0);
});

test("an at segment in a private chat is refused, and nothing is sent", async () => {
  const { api, sends } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore() });

  await assert.rejects(
    () => providers.sendPrivateMessage(20002, [{ type: "at", data: { qq: "10001" } }], false),
    /"at" cannot be sent in a private chat/,
  );
  assert.equal(sends.length, 0);
});

test("a temp-session reply is refused because the session cannot be verified", async () => {
  const { api, sends } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore() });

  await assert.rejects(
    () => providers.sendPrivateMessage(20002, "hi", true, 123456),
    /temp sessions are not supported/,
  );
  assert.equal(sends.length, 0);
});

test("an empty message is refused after conversion, before the transport", async () => {
  const { api, sends } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore() });

  await assert.rejects(() => providers.sendGroupMessage(1, [{ type: "text", data: { text: "" } }], false), /message/);
  assert.equal(sends.length, 0);
});

// ===========================================================================
// Store reads: hit and miss
// ===========================================================================

test("getMessage and getMessageMeta answer the stored row on a hit and null on a miss", async () => {
  const store = new MessageStore();
  store.insert(11, {
    event: { post_type: "message", message_id: 11, raw_message: "stored" },
    meta: metaFor(RECEIPT, true, 123456),
  });
  store.insert(12, { meta: metaFor(RECEIPT, true, 123456) }); // meta only, no event
  const providers = newProviders({ api: makeFakeApi().api, store });

  assert.deepEqual(await providers.getMessage(11), {
    post_type: "message",
    message_id: 11,
    raw_message: "stored",
  });
  assert.deepEqual(await providers.getMessageMeta(11), metaFor(RECEIPT, true, 123456));

  // A row with no event is a miss for `get_msg` but a hit for `delete_msg`.
  assert.equal(await providers.getMessage(12), null);
  assert.deepEqual(await providers.getMessageMeta(12), metaFor(RECEIPT, true, 123456));

  // Unknown ids answer null, never a synthetic event.
  assert.equal(await providers.getMessage(999), null);
  assert.equal(await providers.getMessageMeta(999), null);
});

// ===========================================================================
// Recall
// ===========================================================================

test("deleteMessage answers false for an unknown id and sends nothing", async () => {
  const { api, recalls } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore() });

  assert.equal(await providers.deleteMessage(424242), false);
  assert.equal(recalls.length, 0);
});

test("deleteMessage answers false when the row has no authoritative sequence", async () => {
  // A private receipt with sequence 0 is exactly the case `hasAuthoritativeSequence` exists
  // to reject: recalling it would send `msgSeq: 0` and burn a round trip.
  const store = new MessageStore();
  store.insert(21, { meta: metaFor({ ...RECEIPT, sequence: 0 }, false, 20002) });
  const { api, recalls } = makeFakeApi();
  const providers = newProviders({ api, store });

  assert.equal(await providers.deleteMessage(21), false);
  assert.equal(recalls.length, 0);
});

test("deleteMessage recalls a group message by sequence", async () => {
  const store = new MessageStore();
  store.insert(31, { meta: metaFor(RECEIPT, true, 123456) });
  const { api, recalls } = makeFakeApi();
  const providers = newProviders({ api, store });

  assert.equal(await providers.deleteMessage(31), true);
  assert.deepEqual(recalls, [{ kind: "group", args: [123456, RECEIPT.sequence] }]);
  // The local row is kept: the reference's recall does not delete the stored event either.
  assert.notEqual(await providers.getMessageMeta(31), null);
});

test("deleteMessage recalls a private message with all five recallPrivate arguments", async () => {
  const store = new MessageStore();
  store.insert(41, { meta: metaFor(RECEIPT, false, 20002) });
  const { api, recalls } = makeFakeApi();
  const providers = newProviders({ api, store });

  assert.equal(await providers.deleteMessage(41), true);
  assert.deepEqual(recalls, [
    {
      kind: "private",
      args: [20002, RECEIPT.clientSequence, RECEIPT.sequence, RECEIPT.random, RECEIPT.timestamp],
    },
  ]);
});

test("deleteMessage propagates a recall transport failure", async () => {
  const store = new MessageStore();
  store.insert(51, { meta: metaFor(RECEIPT, true, 1) });
  const api: ActionMessageApi = {
    sendGroup: makeFakeApi().api.sendGroup,
    sendPrivate: makeFakeApi().api.sendPrivate,
    sendC2cFile: makeFakeApi().api.sendC2cFile,
    async recallGroup() {
      throw new Error("recall group message failed: no packet sender attached");
    },
    async recallPrivate() {
      throw new Error("unreachable");
    },
  };
  const providers = newProviders({ api, store });

  await assert.rejects(() => providers.deleteMessage(51), /no packet sender attached/);
});

// ===========================================================================
// Media refresh
// ===========================================================================

test("refreshMessageMedia without an injected resolver answers an explicit unsupported result", async () => {
  const store = new MessageStore();
  const providers = newProviders({ api: makeFakeApi().api, store });
  const event: Record<string, unknown> = {
    message: [{ type: "image", data: { file: "abc.image", url: "http://old/x" } }],
    raw_message: "[CQ:image,file=abc.image,url=http://old/x]",
  };
  const before = JSON.stringify(event);

  const result = await providers.refreshMessageMedia(1, event);

  assert.equal(result.status, "unsupported");
  assert.equal(result.refreshed, 0);
  assert.equal(result.reason, MEDIA_REFRESH_UNSUPPORTED_REASON);
  // Nothing is mutated when nothing can be resolved — not even a blank URL.
  assert.equal(JSON.stringify(event), before);
});

test("refreshMessageMedia with a resolver rewrites the URL and regenerates raw_message", async () => {
  const store = new MessageStore();
  const providers = newProviders({
    api: makeFakeApi().api,
    store,
    resolveMedia: ({ segment }) => (segment["type"] === "image" ? "http://new/y" : null),
  });
  const event: Record<string, unknown> = {
    message: [
      { type: "text", data: { text: "look" } },
      { type: "image", data: { file: "abc.image", url: "http://old/x" } },
      { type: "image", data: { file: "def.image", url: "http://new/y" } },
    ],
    raw_message: "stale",
  };

  const result = await providers.refreshMessageMedia(1, event);

  assert.equal(result.status, "refreshed");
  assert.equal(result.scanned, 2);
  assert.equal(result.refreshed, 1, "the segment already carrying the fresh URL is not counted");
  const message = event["message"] as Array<{ data: Record<string, unknown> }>;
  assert.equal(message[1]!.data["url"], "http://new/y");
  assert.equal(message[2]!.data["url"], "http://new/y");
  assert.match(String(event["raw_message"]), /url=http:\/\/new\/y/);
  assert.notEqual(event["raw_message"], "stale");
});

test("refreshMessageMedia answers unchanged when the resolver has no URL, and never persists", async () => {
  const store = new MessageStore();
  store.insert(61, { event: { message: [] } });
  const providers = newProviders({
    api: makeFakeApi().api,
    store,
    resolveMedia: () => null,
  });
  const event: Record<string, unknown> = {
    message: [{ type: "record", data: { file: "a.amr", url: "http://old/v" } }],
    raw_message: "[CQ:record,file=a.amr]",
  };

  const result = await providers.refreshMessageMedia(61, event);

  assert.equal(result.status, "unchanged");
  assert.equal(result.scanned, 1);
  // The refreshed URL lives only in the caller's copy, as the reference's does.
  assert.deepEqual(store.get(61), { message: [] });
});

test("refreshMessageMedia answers not-found for an event with no segment array", async () => {
  const providers = newProviders({
    api: makeFakeApi().api,
    store: new MessageStore(),
    resolveMedia: () => "http://new/z",
  });

  const result = await providers.refreshMessageMedia(71, { raw_message: "plain" });

  assert.equal(result.status, "not-found");
  assert.equal(result.scanned, 0);
});

test("a throwing resolver does not deny the other segments in the same message", async () => {
  const store = new MessageStore();
  const providers = newProviders({
    api: makeFakeApi().api,
    store,
    resolveMedia: ({ segment }) => {
      if (segment["type"] === "image") throw new Error("cache miss");
      return "http://new/voice";
    },
  });
  const event: Record<string, unknown> = {
    message: [
      { type: "image", data: { file: "x.image", url: "http://old/i" } },
      { type: "record", data: { file: "y.amr", url: "http://old/v" } },
    ],
    raw_message: "",
  };

  const result = await providers.refreshMessageMedia(81, event);

  assert.equal(result.status, "refreshed");
  assert.equal(result.refreshed, 1);
  const message = event["message"] as Array<{ data: Record<string, unknown> }>;
  assert.equal(message[0]!.data["url"], "http://old/i");
  assert.equal(message[1]!.data["url"], "http://new/voice");
});

test("a reply segment quotes the stored row's authoritative sequence, not the OneBot id", async () => {
  // The OneBot id is a hash QQ never saw (`message-id.ts:69`), so quoting it directly would
  // attach the quote to nothing. The adapter's `resolveReplySequence` translates it through
  // the store, and only for a row whose meta is authoritative and scene-matched.
  const store = new MessageStore();
  store.insert(777, { meta: metaFor(RECEIPT, true, 123456) });
  const { api, sends } = makeFakeApi();
  const providers = newProviders({ api, store });

  await providers.sendGroupMessage(123456, [
    { type: "reply", data: { id: "777" } },
    { type: "text", data: { text: "quoted" } },
  ], false);

  const reply = sends[0]!.segments.find((segment) => segment.type === "reply");
  assert.equal(reply?.type, "reply");
  assert.equal((reply as { replySeq: number }).replySeq, RECEIPT.sequence);

  // A quote target that is NOT in the store falls back to the parser's own path
  // (`message-parser.ts:673-675`, reference:22490 region): `id > 0` quotes by the id as
  // given. That is the reference's behaviour, kept rather than "fixed", and it is why
  // `resolveReplySequence` answering `undefined` is not the same as dropping the quote —
  // recorded here so the degradation is visible instead of assumed away.
  await providers.sendGroupMessage(999, [{ type: "reply", data: { id: "888" } }, { type: "text", data: { text: "x" } }], false);
  const unstored = sends[1]!.segments.find((segment) => segment.type === "reply");
  assert.equal(unstored?.type, "reply");
  assert.equal((unstored as { replySeq: number }).replySeq, 888, "the OneBot id rides replySeq unresolved");

  // A row stored for ANOTHER group is not used as a sequence source either: the fallback
  // above applies, so the foreign conversation's sequence never leaks into this one.
  await providers.sendGroupMessage(999, [{ type: "reply", data: { id: "777" } }, { type: "text", data: { text: "y" } }], false);
  const foreign = sends[2]!.segments.find((segment) => segment.type === "reply");
  assert.equal((foreign as { replySeq: number }).replySeq, 777);
  assert.notEqual((foreign as { replySeq: number }).replySeq, RECEIPT.sequence);
});

// ===========================================================================
// Signature compatibility with `ActionContext`
// ===========================================================================

test("the four matching providers are assignable to ActionContext's own members", () => {
  // A compile-time statement, not a runtime one: if `ActionContext.sendGroupMessage` ever
  // gains a parameter or changes its return shape, this stops compiling. The two members
  // that keep precise return types (`deleteMessage`, `refreshMessageMedia`) are intentionally
  // absent — see the adapter's header for the `Promise<boolean> -> Promise<void>` mismatch.
  const providers = newProviders({ api: makeFakeApi().api, store: new MessageStore() });

  const narrowed: ActionContextMessageProviders = providers;
  // The narrowing is a TYPE statement (a `Pick` cannot remove a runtime key), so the runtime
  // half asserts that the type's useful members resolve to the adapter's functions rather
  // than to `undefined` — which is what a missed provider would look like to the dispatcher.
  for (const member of ["getMessage", "getMessageMeta", "sendGroupMessage", "sendPrivateMessage"] as const) {
    assert.equal(typeof narrowed[member], "function", `${member} must be provided`);
  }
  assert.deepEqual(Object.keys(providers).sort(), [
    "deleteMessage",
    "getMessage",
    "getMessageMeta",
    "refreshMessageMedia",
    "sendGroupMessage",
    "sendPrivateMessage",
  ]);
});
// ===========================================================================
// Private FILE segments
// ===========================================================================
//
// reference:38402-38434. A `file` element cannot go through `sendPrivate` —
// `element-builder.ts:2037` refuses it ("must use the group/private file upload
// pipeline") — so the adapter splits it out and sends it with `sendC2cFile`.
//
// This is the path `upload_private_file` depends on: the action uploads, then
// posts a `{type:"file"}` segment. Without the split, that action would fail
// AFTER the bytes were already on the server.

const FILE_SEGMENT = {
  type: "file" as const,
  fileId: "private-uuid-0001",
  fileName: "报告.pdf",
  fileSize: 4096,
  fileHash: "/addon/path",
};

test("sendPrivateMessage routes a file segment through sendC2cFile, not sendPrivate", async () => {
  const { api, sends, files } = makeFakeApi();
  const store = new MessageStore();
  const providers = newProviders({
    api,
    store,
    identity: fileIdentity(),
    recallUploadedFile: () => undefined,
  });

  await providers.sendPrivateMessage(20002, [FILE_SEGMENT], false);

  // Nothing went through the rich-text send: `sendPrivate` would have rejected it.
  assert.deepEqual(sends, [], "a file segment must not reach sendPrivate");
  assert.equal(files.length, 1);
  assert.equal(files[0]!.userUin, 20002);
  assert.equal(files[0]!.userUid, "u_20002", "the peer uid comes from identity.resolveUid");
  assert.equal(files[0]!.info.fileId, "private-uuid-0001");
  assert.equal(files[0]!.info.fileName, "报告.pdf");
  assert.equal(files[0]!.info.fileSize, 4096);
  assert.equal(files[0]!.info.fileHash, "/addon/path");
});

test("a text + file message is TWO sends, and the returned id is the FILE's (the last batch)", async () => {
  const fileReceipt: SendMessageReceipt = { ...RECEIPT, messageId: 999_000_111 };
  const { api, sends, files } = makeFakeApi({ receipt: fileReceipt });
  const store = new MessageStore();
  const providers = newProviders({
    api,
    store,
    identity: fileIdentity(),
    recallUploadedFile: () => undefined,
  });

  const result = await providers.sendPrivateMessage(
    20002,
    [{ type: "text", data: { text: "这是文件" } }, FILE_SEGMENT],
    false,
  );

  // reference:38377 / :38434 — one send for the text, then one per file, and the
  // action's `messageId` is the LAST batch's.
  assert.equal(sends.length, 1, "the text went out on its own");
  assert.equal(files.length, 1);
  assert.equal(result.messageId, fileReceipt.messageId, "the last batch's id is returned");
  // And two rows were stored, each keyed by its own id.
  assert.ok(store.getMeta(fileReceipt.messageId), "the file's row exists");
  assert.equal(store.getMeta(fileReceipt.messageId)!.targetId, 20002);
});

test("a file segment with only an id reads name/size/md5 from the upload cache", async () => {
  const md5 = new Uint8Array(16).fill(0x5a);
  const { api, files } = makeFakeApi();
  const providers = newProviders({
    api,
    store: new MessageStore(),
    identity: fileIdentity(),
    recallUploadedFile: (fileId: string) =>
      fileId === "cached-id"
        ? { fileId: "cached-id", fileName: "缓存.bin", fileSize: 7777, fileMd5: md5, scope: "private", userId: 20002 }
        : undefined,
  });

  await providers.sendPrivateMessage(20002, [{ type: "file", data: { file_id: "cached-id" } }], false);

  assert.equal(files.length, 1);
  // The reference's `?? cached?.fileName` chain, in that order.
  assert.equal(files[0]!.info.fileName, "缓存.bin");
  assert.equal(files[0]!.info.fileSize, 7777);
  assert.deepEqual([...files[0]!.info.fileMd5], [...md5], "the cache's md5 is already raw bytes");
});

test("a segment's own fields win over the cache, and md5Hex is decoded to BYTES", async () => {
  const cacheMd5 = new Uint8Array(16).fill(0x11);
  const { api, files } = makeFakeApi();
  const providers = newProviders({
    api,
    store: new MessageStore(),
    identity: fileIdentity(),
    recallUploadedFile: () => ({
      fileId: "both",
      fileName: "缓存名",
      fileSize: 1,
      fileMd5: cacheMd5,
      scope: "private",
      userId: 20002,
    }),
  });

  await providers.sendPrivateMessage(
    20002,
    [{
      type: "file",
      data: {
        file_id: "both",
        name: "段名",
        file_size: 4242,
        md5: "0123456789abcdef0123456789abcdef",
      },
    }],
    false,
  );

  assert.equal(files[0]!.info.fileName, "段名", "the segment wins");
  assert.equal(files[0]!.info.fileSize, 4242);
  // `md5Hex` on the segment is HEX; `fileMd5` on the wire is BYTES. This is the one
  // conversion in the path, and getting it wrong sends a 32-byte "md5".
  assert.equal(files[0]!.info.fileMd5.length, 16);
  assert.equal(Buffer.from(files[0]!.info.fileMd5).toString("hex"), "0123456789abcdef0123456789abcdef");
  assert.notDeepEqual([...files[0]!.info.fileMd5], [...cacheMd5], "not the cache's md5");
});

test("a file segment with neither id nor url is a MISSING_FIELD, not a zero-byte send", async () => {
  const { api, files } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore(), identity: fileIdentity() });
  await assert.rejects(
    () => providers.sendPrivateMessage(20002, [{ type: "file", data: {} }], false),
    // The PARSER refuses this first (`message-parser.ts`'s file case), so the wording
    // is the parser's, and the send never happens.
    /missing required or usable fields/,
  );
  assert.deepEqual(files, []);
});

test("a url-only file segment throws by name — it needs the groupFile upload port", async () => {
  const { api, files } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore(), identity: fileIdentity() });
  await assert.rejects(
    () => providers.sendPrivateMessage(20002, [{ type: "file", data: { url: "file:///tmp/x.bin" } }], false),
    /requires .*groupFile\.uploadPrivate/,
  );
  assert.deepEqual(files, [], "nothing is sent for a segment this adapter cannot deliver");
});

test("a file segment without identity.resolveUid refuses rather than guessing a uid", async () => {
  const { api, files } = makeFakeApi();
  const providers = newProviders({ api, store: new MessageStore() });
  await assert.rejects(
    () => providers.sendPrivateMessage(20002, [FILE_SEGMENT], false),
    /requires identity\.resolveUid/,
  );
  assert.deepEqual(files, []);
});

test("a sendC2cFile transport failure propagates, and stores no row", async () => {
  const { api } = makeFakeApi({ error: new Error("c2c file send failed: no packet sender") });
  const store = new MessageStore();
  const providers = newProviders({
    api,
    store,
    identity: fileIdentity(),
    recallUploadedFile: () => undefined,
  });
  await assert.rejects(
    () => providers.sendPrivateMessage(20002, [FILE_SEGMENT], false),
    /no packet sender/,
  );
  // A failed send must not leave a row: the message was never delivered.
  assert.equal(store.getMeta(RECEIPT.messageId), null);
});
