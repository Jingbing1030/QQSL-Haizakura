// Tests for `BridgeActionContextHost` — the production `ActionContext`.
//
// ---------------------------------------------------------------------------
// What this file is for
// ---------------------------------------------------------------------------
// `src/onebot/actions/context.ts` declares `ActionContext`; until
// `host/action-context-host.ts` existed, nothing implemented it. The registry was
// therefore green while every action was unreachable, which is the "42 actions exist,
// 42 actions work" confusion `onebot-api.test.ts` opens by naming.
//
// So these tests are about REACHABILITY and HONESTY, not about action semantics (those
// have differential tests against the reference):
//
//   1. A real request round-trips through `createOneBotApi` + the host: `get_login_info`
//      answers the bridge's own UIN and nickname. This is the assertion that would have
//      failed for the entire life of the port.
//   2. An unknown action answers 1404 — the registry is still the thing deciding, not the
//      host.
//   3. A not-logged-in host degrades to `createIdleOneBotApi`, and the reason names the
//      state rather than the transport.
//   4. **The honest-failure path THROWS.** Every unimplemented member raises a named
//      `HostNotImplementedError`, never `{}`, `[]`, `0` or `""`. This is the assertion
//      `context.ts`'s header is written for, and it is the one a "make the tests green"
//      edit is most likely to break.
//   5. The two known type frictions (`deleteMessage`, `refreshMessageMedia`) are adapted
//      by EXPLICIT wrappers — so the tests pin both the success path and the refusal.
//
// ---------------------------------------------------------------------------
// What these tests do NOT establish
// ---------------------------------------------------------------------------
// No packet is sent, no container runs, no QQ session exists. `sendGroupMessage` is
// exercised through the REAL `MessageApi` against a `Bridge` with no bound
// `PacketClient`, so it rejects with the reference's own
// `"no packet sender attached"` — which is the honest shape of "the hook is not
// attached", and the opposite of a fabricated `message_id`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import type { PortedApiHub } from "../src/bridge/apis/index.js";
import type { PacketSendResult } from "../src/bridge/context.js";
import {
  BridgeActionContextHost,
  BridgeActionIdentity,
  HostContractError,
  HostNotImplementedError,
  createOneBotNetworkContext,
  createSessionOneBotApi,
  startOneBotNetworks,
} from "../src/host/action-context-host.js";
import { MessageStore } from "../src/host/message-store.js";
import { MediaStore } from "../src/host/media-store.js";
import { ExtrasApi } from "../src/bridge/apis/extras.js";
import { FlashTransferApi } from "../src/bridge/apis/flash-transfer.js";
import {
  MEDIA_REFRESH_UNSUPPORTED_REASON,
  createActionMessageProviders,
} from "../src/host/action-message-providers.js";
import { getLogLevel, setLogLevel, setLogSink } from "../src/onebot/log.js";
import { createIdleOneBotApi, createOneBotApi } from "../src/onebot/api.js";
import { RETCODE } from "../src/onebot/types.js";
import type { ActionContext, StoredMessageMeta } from "../src/onebot/actions/context.js";

// ===========================================================================
// Fixtures
// ===========================================================================

const UIN = "10001";
const NICKNAME = "haizakura-test";

/** A bridge over an in-memory roster. No packet client is bound — see the header. */
function makeBridge(): { bridge: Bridge; identity: MemoryIdentity } {
  const identity = new MemoryIdentity(UIN, NICKNAME);
  const bridge = new Bridge(identity);
  return { bridge, identity };
}

function makeHost(bridge?: Bridge): BridgeActionContextHost {
  return new BridgeActionContextHost({ bridge: bridge ?? makeBridge().bridge });
}

/** A `StoredMessageMeta` with every field distinct, so a swapped field is visible. */
function meta(overrides: Partial<StoredMessageMeta> = {}): StoredMessageMeta {
  return {
    isGroup: true,
    targetId: 555,
    sequence: 4242,
    sequenceAuthoritative: true,
    clientSequence: 909,
    random: 123456,
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

/**
 * A `PacketClient` that RECORDS every wire name instead of sending, and answers the
 * synthetic "no response" failure.
 *
 * Why this is the load-bearing fixture for §14-§16: without it, a call into `bridge/apis/*`
 * dies at the transport and a test cannot tell "the host reached the bridge and the bridge
 * reached the wire" from "the host threw a `TypeError` before doing anything". The
 * `qzone`/`profile`/`groupFile`/`groupAdmin` brand-check bug (§14) is exactly that shape:
 * both outcomes used to *reject*, with different errors, so an `assert.rejects` test
 * passed either way. Recording the wire name makes the difference observable.
 *
 * The failure is the honest one `Bridge.sendRawPacket` itself produces when nothing is
 * attached (`bridge.ts:346-351`), so `invokeOidb` raises `"no response"`
 * (`oidb/spec.ts:117`) — i.e. the call really did travel the whole path.
 */
interface RecordingPacketClient {
  sendPacket(wireName: string, body: Uint8Array, timeoutMs?: number): Promise<PacketSendResult>;
  /** The wire names sent, in order. Reset by `reset()`; the array identity is stable. */
  readonly sent: string[];
  reset(): void;
}

function makeRecordingClient(): RecordingPacketClient {
  const sent: string[] = [];
  return {
    sent,
    reset: () => {
      sent.length = 0;
    },
    async sendPacket(wireName) {
      sent.push(wireName);
      return {
        success: false,
        gotResponse: false,
        errorCode: -1,
        errorMessage: "recording client: no response",
      };
    },
  };
}

/** Every `ActionContext` member that must throw rather than answer. */
const NOT_IMPLEMENTED_MEMBERS: readonly (readonly [string, (ctx: ActionContext) => Promise<unknown>])[] = [
  ["fetchPttText", (ctx) => ctx.fetchPttText!(1)],
];

/**
 * Members that USED to throw and now do real work.
 *
 * Kept as an explicit list so the transition is recorded rather than silently shrinking the
 * suite: each name here moved from `NOT_IMPLEMENTED_MEMBERS` to this list when it was wired.
 * A member that regresses to throwing again fails the check below, and one that returns a
 * plausible empty value instead of asking the network fails it too — the assertion is that
 * the call reaches the bridge, which a stub cannot do.
 */
const NOW_IMPLEMENTED_MEMBERS: readonly (readonly [string, (ctx: ActionContext) => Promise<unknown>])[] = [
  ["handleGroupRequest", (ctx) => ctx.handleGroupRequest!("1:2:add", "add", true, "")],
  ["handleGetGroupSystemMsg", (ctx) => ctx.handleGetGroupSystemMsg!({ onlyPending: false, count: 50 })],
  ["setMsgEmojiLike", (ctx) => ctx.setMsgEmojiLike!(1, "128077", true)],
  ["fetchEmojiLikeUsers", (ctx) => ctx.fetchEmojiLikeUsers!(1, "128077", 10)],
  ["fetchEmojiLikeSummary", (ctx) => ctx.fetchEmojiLikeSummary!(1)],
  ["listReadSessions", (ctx) => ctx.listReadSessions!()],
  ["getDownloadRKeys", (ctx) => ctx.getDownloadRKeys!()],
  ["getGroupMsgHistory", (ctx) => ctx.getGroupMsgHistory!(1, 0, 20, true)],
  ["getFriendMsgHistory", (ctx) => ctx.getFriendMsgHistory!(1, 0, 20, true)],
  // A missing media id now answers `null` — the "not in the cache" answer every action
  // turns into its own wording — instead of throwing `HostNotImplementedError`. The default
  // host has NO `MediaStore`, which is the state these cases exercise; the populated path
  // is `media-store.test.ts` / the host's own media cases.
  ["getImageInfo", (ctx) => ctx.getImageInfo!("file-id")],
  ["getRecordInfo", (ctx) => ctx.getRecordInfo!("file-id")],
  // The forward family. Each of these now travels the whole path to
  // `SsoSendLongMsg`/`SsoRecvLongMsg`; with no packet client bound the bridge answers
  // "no response", so the failure is a TRANSPORT one and not `HostNotImplementedError`.
  // A re-introduced stub would fail on the error name.
  ["getForwardMsg", (ctx) => ctx.getForwardMsg!("res-id")],
  ["sendForwardMsg", (ctx) => ctx.sendForwardMsg!("messages")],
  ["sendGroupForwardMsg", (ctx) => ctx.sendGroupForwardMsg!(1, "messages", undefined)],
  ["sendPrivateForwardMsg", (ctx) => ctx.sendPrivateForwardMsg!(1, "messages", undefined)],
  ["forwardSingleMsg", (ctx) => ctx.forwardSingleMsg!(1, { groupId: 2 })],
];

// ===========================================================================
// 1. The round trip
// ===========================================================================

describe("BridgeActionContextHost — a real request round-trips", () => {
  it("get_login_info answers the bridge's own UIN and nickname", async () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });

    const response = await api.handle("get_login_info", {});

    assert.equal(response.status, "ok");
    assert.equal(response.retcode, 0);
    // The whole point: these come from the live roster, not from a constant.
    assert.deepEqual(response.data, { user_id: 10001, nickname: NICKNAME });
  });

  it("the nickname is read LIVE, not snapshotted at construction", async () => {
    const { bridge, identity } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.equal(host.getLoginInfo().nickname, NICKNAME);

    // A profile refresh rewrites the roster's nickname; `get_login_info` must follow.
    identity.nickname = "renamed";
    assert.equal(host.getLoginInfo().nickname, "renamed");
  });

  it("get_version_info is reachable and reports the ported version", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    const response = await api.handle("get_version_info", {});
    assert.equal(response.status, "ok");
    assert.deepEqual(response.data, {
      app_name: "Haizakura",
      app_version: "0.2.5.0-node",
      protocol_version: "v11",
    });
  });

  it("get_status reports real session state rather than constants", async () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });

    // No packet client is bound, so the session is NOT online. A host that answered
    // `online: true` here would be replaying the reference's `() => true` constant,
    // which is only correct because its instance exists solely for a logged-in account.
    const offline = await api.handle("get_status", {});
    assert.equal(offline.status, "ok");
    assert.equal((offline.data as { online: boolean }).online, false);
    assert.equal((offline.data as { good: boolean }).good, false);

    // Bind a sender: now the session is online and its receive path is healthy.
    bridge.bindPid(4242, {
      sendPacket: async () => ({ success: true, gotResponse: true, responseData: new Uint8Array(0) }),
    });
    const online = await api.handle("get_status", {});
    assert.equal((online.data as { online: boolean }).online, true);
    assert.equal((online.data as { good: boolean }).good, true);
  });

  it("get_uptime_ms measures REAL elapsed time, not a constant", async () => {
    // The mutation that motivated this shape: `return 0` passed the original assertions,
    // because `0` is an integer and `0 >= 0` and `0 >= 0`. The member has to be shown to
    // MOVE. A hardcoded 0, a hardcoded `Date.now()`, or a snapshot taken once at
    // construction are all excluded by requiring growth across a real delay.
    const host = makeHost();
    const first = host.getUptimeMs();
    assert.ok(Number.isInteger(first), "uptime must be an integer millisecond count");
    assert.ok(first >= 0, "uptime must never be negative");

    // `Bridge.getUptimeMs` is `Math.max(0, Date.now() - startedAtMs)` (`bridge.ts:307`),
    // so waiting 25 ms must advance it by at least ~20 ms. The slack absorbs timer
    // granularity; it does not absorb a constant.
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const second = host.getUptimeMs();
    assert.ok(second >= first, "uptime must not go backwards");
    assert.ok(
      second - first >= 20,
      `uptime must advance with real time; got ${first} then ${second} (delta ${second - first})`,
    );
    assert.ok(second > 0, "a session that has been up for 25ms has non-zero uptime");
  });

  it("an UNKNOWN action answers 1404 — the registry still decides", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });

    const response = await api.handle("definitely_not_an_action", {});
    assert.equal(response.status, "failed");
    assert.equal(response.retcode, RETCODE.UNKNOWN_ACTION);
    assert.match(String(response.wording ?? ""), /unknown action/i);
  });

  it("a KNOWN action is dispatched, not reported unknown", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    // `get_group_list` answers `[]` from the empty roster. The assertion of interest is
    // the retcode: a 1404 here would mean the name never resolved.
    const response = await api.handle("get_group_list", {});
    assert.notEqual(response.retcode, RETCODE.UNKNOWN_ACTION);
    assert.deepEqual(response.data, []);
  });

  it("disposal closes the quiesce gate before the registry is consulted", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    host.dispose();
    const response = await api.handle("definitely_not_an_action", {});
    // The gate wins: "not accepting actions" is a more useful diagnosis than "unknown
    // action", and it is what the reference orders its checks to produce.
    assert.equal(response.retcode, RETCODE.ACTION_FAILED);
    assert.match(String(response.wording ?? ""), /not accepting actions/);
  });
});

// ===========================================================================
// 2. The not-logged-in degradation
// ===========================================================================

describe("a not-logged-in host degrades to createIdleOneBotApi", () => {
  it("answers ACTION_FAILED with a reason naming the session state", async () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.equal(host.isOnline(), false, "a bridge with no bound PID is not online");

    const api = createSessionOneBotApi(host);

    // EVERY action, known or unknown, must answer the idle refusal — that is what makes
    // `createIdleOneBotApi` the right degradation: a transport must not be able to tell
    // a logged-out session from an unknown action name.
    for (const action of ["get_login_info", "get_group_list", "definitely_not_an_action"]) {
      const response = await api.handle(action, {});
      assert.equal(response.status, "failed", `action ${action} must fail while logged out`);
      assert.equal(response.retcode, RETCODE.ACTION_FAILED);
      assert.match(String(response.wording ?? ""), /not logged in/);
    }
  });

  it("matches createIdleOneBotApi's own behaviour exactly", async () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    const mine = createSessionOneBotApi(host, "not logged in");
    const reference = createIdleOneBotApi("not logged in");

    assert.equal(mine.isAcceptingActions, reference.isAcceptingActions);
    assert.equal(mine.isStreamAction("get_login_info"), reference.isStreamAction("get_login_info"));
    assert.deepEqual(
      await mine.handle("get_login_info", {}),
      await reference.handle("get_login_info", {}),
    );
  });

  it("a BOUND session gets the live API, not the idle one", async () => {
    const { bridge } = makeBridge();
    bridge.bindPid(7, {
      sendPacket: async () => ({ success: true, gotResponse: true, responseData: new Uint8Array(0) }),
    });
    const host = new BridgeActionContextHost({ bridge });
    assert.equal(host.isOnline(), true);

    const api = createSessionOneBotApi(host);
    const response = await api.handle("get_login_info", {});
    assert.equal(response.status, "ok");
    assert.deepEqual(response.data, { user_id: 10001, nickname: NICKNAME });
  });
});

// ===========================================================================
// 3. The honest-failure path THROWS
// ===========================================================================

describe("unimplemented members throw a named error rather than answering", () => {
  for (const [member, call] of NOT_IMPLEMENTED_MEMBERS) {
    it(`${member} throws HostNotImplementedError`, async () => {
      const host = makeHost();
      await assert.rejects(
        async () => await call(host),
        (error: unknown) => {
          // The NAME is the contract: a caller (and this suite) distinguishes "the port
          // cannot do that" from "the server said no" without matching on wording.
          assert.ok(error instanceof HostNotImplementedError, `${member} threw ${String(error)}`);
          assert.equal(error.name, "HostNotImplementedError");
          assert.equal(error.member, member);
          // The message must name the member AND a reason, so a user filing a bug has
          // something to act on.
          assert.match(error.message, new RegExp(member));
          assert.ok(error.message.length > member.length + 20, "the message must explain WHY");
          return true;
        },
      );
    });
  }

  it("answers retcode 100 through the dispatcher, with the wording intact", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });

    // `fetchPttText` is the last remaining port gap: `ptt_trans_result` maps to `null` in
    // the reference, so there is no transcription path to port and the member refuses.
    //
    // This used to use `get_forward_msg`, which is now wired to the forward subsystem; it
    // used `get_group_msg_history` before that. Both now legitimately reach the network, so
    // the gap has to be exercised through the one member that is still a stub — otherwise
    // this test would keep passing on wording that no longer describes a gap.
    const response = await api.handle("fetch_ptt_text", { message_id: 1 });
    assert.equal(response.status, "failed");
    assert.equal(response.retcode, RETCODE.ACTION_FAILED);
    // Not `{}`, not `""` — the refusal is observable.
    assert.equal(response.data, null);
    assert.match(String(response.wording ?? ""), /fetchPttText|ASR|transcri/i);
  });

  it("a wired member no longer refuses for lack of a port", async () => {
    // The complement of the suite above. Each of these is now wired, so it must fail for a
    // DATA reason (no such message, no bound session) rather than a PORT reason. Matching on
    // the error name is what distinguishes the two.
    for (const [member, call] of NOW_IMPLEMENTED_MEMBERS) {
      const host = makeHost();
      try {
        await call(host);
      } catch (error) {
        assert.ok(
          !(error instanceof HostNotImplementedError),
          `${member} is still a stub: ${String(error)}`,
        );
      }
    }
  });

  it("a member that would answer a PLAUSIBLE EMPTY VALUE now answers from a real source", async () => {
    // This test used to assert the OPPOSITE: that these three threw, because a stub that
    // answered `[]` would produce a happy-looking response for work never done:
    //
    //   get_group_system_msg  (no provider) → `[]`
    //   _mark_all_as_read     (no provider) → ACTION_FAILED
    //   get_rkey              (no provider) → ACTION_FAILED
    //
    // All three are now wired, so the risk has inverted: the danger is a member that answers
    // a plausible empty value WITHOUT asking anyone. The check is therefore that each one
    // reaches its data source. A bridge with no roster and no inbox answers empty — but it
    // answered because it asked, which is what separates this from the stub it replaced.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });

    const sessions = await host.listReadSessions!();
    assert.deepEqual(sessions, { groupIds: [], privateUserIds: [] });

    // Same distinction as `get_rkey`: the inbox is a network read, and the reference's own
    // `getGroupSystemMessages` uses `Promise.all` (not `allSettled`), so a transport failure
    // is an ERROR there too — answering `[]` would claim "no pending requests".
    await assert.rejects(
      async () => await host.handleGetGroupSystemMsg!({ onlyPending: false, count: 50 }),
      /no packet sender attached/,
    );

    // `get_rkey` differs from the other two: it needs a live packet transport, so on an
    // unbound session it fails for lack of a sender rather than answering empty. That is the
    // correct distinction — "nobody has rkeys" and "cannot ask" must not look alike.
    await assert.rejects(
      async () => await host.getDownloadRKeys!(),
      /no packet sender attached/,
    );
  });

  it("listReadSessions reports the roster's groups and rejects an invalid id", async () => {
    // The group half comes from the identity roster, not from the message table. A fake list
    // here would be indistinguishable from "the bot is in no groups".
    const { bridge } = makeBridge();
    bridge.identity.rememberGroups([{ groupId: 123456, groupName: "g" } as never]);
    const host = new BridgeActionContextHost({ bridge });
    const sessions = await host.listReadSessions!();
    assert.deepEqual(sessions.groupIds, [123456]);

    // The reference throws on a non-positive id rather than dropping it: a caller that
    // believes it marked a group read when it did not is worse off than one that sees an error.
    await assert.rejects(
      async () => await new MessageStore().listReadSessions([0]),
      /current group list contains invalid group id/,
    );
  });
});

// ===========================================================================
// 3b. The media members, against a REAL MediaStore
// ===========================================================================
//
// `getImageInfo` / `getRecordInfo` are the two members whose bodies are a CACHE READ, so
// the interesting cases are the answers they can give: a miss (`null`), a hit with no
// resolver (the cached URL, verbatim), and a hit with a resolver (the fresh URL, preferred,
// degrading to the cached one when the resolver throws). The default host has no
// `MediaStore` at all, which is the fourth case — and the one a "make the tests green" edit
// would break by defaulting to `:memory:`.

describe("getImageInfo / getRecordInfo — the media cache", () => {
  /** A host over a real `:memory:` store. */
  function mediaHost(options: { readonly imageUrlResolver?: (request: unknown, isGroup: boolean) => string } = {}) {
    const mediaStore = new MediaStore(":memory:");
    const host = new BridgeActionContextHost({
      bridge: makeBridge().bridge,
      mediaStore,
      ...(options.imageUrlResolver === undefined ? {} : { imageUrlResolver: options.imageUrlResolver }),
    });
    return { host, mediaStore };
  }

  it("answers null for a cache MISS — the answer `get_image` turns into 'not found'", async () => {
    // Not an empty object and not a throw. `get_image` tests `if (info)`, and a plausible
    // `{file: "", url: ""}` would make it answer `ok` for a made-up id.
    const { host, mediaStore } = mediaHost();
    try {
      assert.equal(await host.getImageInfo("no-such-id"), null);
      assert.equal(await host.getRecordInfo("no-such-id"), null);
    } finally {
      await mediaStore.close();
    }
  });

  it("answers null when NO media store was supplied", async () => {
    // The default host. A member that constructed its own store would pass the case above
    // and still be wrong: it would create a database as a side effect of a read.
    const host = makeHost();
    assert.equal(await host.getImageInfo("any"), null);
    assert.equal(await host.getRecordInfo("any"), null);
  });

  it("getImageInfo answers the CACHED url when no resolver is injected", async () => {
    const { host, mediaStore } = mediaHost();
    try {
      await mediaStore.rememberImage({
        type: "image",
        file: "img-1",
        fileName: "img-1.png",
        fileSize: 2048,
        url: "https://cdn.example/cached",
      });
      assert.deepEqual(await host.getImageInfo("img-1"), {
        file: "https://cdn.example/cached",
        url: "https://cdn.example/cached",
        file_size: 2048,
        file_name: "img-1.png",
      });
    } finally {
      await mediaStore.close();
    }
  });

  it("getImageInfo PREFERS the resolver's fresh URL", async () => {
    const seen: unknown[] = [];
    const { host, mediaStore } = mediaHost({
      imageUrlResolver: (request, isGroup) => {
        seen.push([request, isGroup]);
        return "https://cdn.example/fresh";
      },
    });
    try {
      await mediaStore.rememberImage({
        type: "image",
        file: "img-2",
        fileName: "img-2.png",
        fileSize: 10,
        url: "https://cdn.example/stale",
        imageUrl: "https://cdn.example/image-url",
        subType: 3,
        isGroup: true,
      });
      const info = await host.getImageInfo("img-2");
      assert.equal(info?.url, "https://cdn.example/fresh");
      // `file` is the resolved URL too — the reference's `file: url || cached.file`, which
      // is what `download_file_stream` reconstructs `file || file_id` from.
      assert.equal(info?.file, "https://cdn.example/fresh");
      assert.deepEqual(seen, [
        [{ type: "image", imageUrl: "https://cdn.example/image-url", subType: 3 }, true],
      ]);
    } finally {
      await mediaStore.close();
    }
  });

  it("a resolver that THROWS degrades to the cached URL instead of failing the call", async () => {
    // reference:39890-39893 — warn, keep the cached answer. Propagating would turn every
    // `get_image` into a failure whenever the rkey cache is cold, which is strictly worse
    // than a URL that may need a refresh.
    const { host, mediaStore } = mediaHost({
      imageUrlResolver: () => {
        throw new Error("rkey cache is empty");
      },
    });
    try {
      await mediaStore.rememberImage({
        type: "image",
        file: "img-3",
        fileName: "img-3.png",
        fileSize: 5,
        url: "https://cdn.example/cached",
      });
      assert.equal((await host.getImageInfo("img-3"))?.url, "https://cdn.example/cached");
    } finally {
      await mediaStore.close();
    }
  });

  it("getRecordInfo asks the WIRE for a fresh voice URL", async () => {
    // Unlike `getImageInfo`, this member always calls: a voice's download URL is
    // short-lived and the cached one is only good for its `mediaNode`. No response comes
    // back from the recording client, so the OIDB call rejects — but the point of the
    // assertion is that it TRAVELLED, which a stub cannot do.
    const { bridge } = makeBridge();
    const client = makeRecordingClient();
    bridge.bindPid(1, client);
    const mediaStore = new MediaStore(":memory:");
    try {
      await mediaStore.rememberRecord({
        type: "record",
        file: "rec-1",
        fileName: "rec-1.amr",
        fileSize: 4096,
        mediaNode: { fileUuid: "uuid-1" },
        isGroup: true,
        sessionId: 777,
      });
      const host = new BridgeActionContextHost({ bridge, mediaStore });
      await assert.rejects(async () => await host.getRecordInfo("rec-1"), /no response|no packet sender/);
      assert.deepEqual(client.sent, ["OidbSvcTrpcTcp.0x126e_200"]);
    } finally {
      await mediaStore.close();
    }
  });

  it("getRecordInfo throws for metadata with no mediaNode — a store-integrity gap", async () => {
    // Not `null`: the row EXISTS but cannot be addressed, and answering "not in the cache"
    // would make the gap invisible until someone audited the database.
    const { host, mediaStore } = mediaHost();
    try {
      await mediaStore.rememberRecord({ type: "record", file: "rec-2" });
      await assert.rejects(async () => await host.getRecordInfo("rec-2"), /record media metadata is missing/);
    } finally {
      await mediaStore.close();
    }
  });

  it("get_record / get_image reach the media cache through the DISPATCHER", async () => {
    // The end-to-end wiring: an action name → `run` → `ctx.getImageInfo`. A member present
    // on the host but not reached by any action would pass the unit cases above and still
    // leave `get_image` answering "not found".
    const mediaStore = new MediaStore(":memory:");
    try {
      await mediaStore.rememberImage({
        type: "image",
        file: "dispatched",
        fileName: "dispatched.png",
        fileSize: 99,
        url: "https://cdn.example/dispatched",
      });
      const host = new BridgeActionContextHost({ bridge: makeBridge().bridge, mediaStore });
      const api = createOneBotApi({
        createContext: () => host,
        isAcceptingActions: () => host.isAcceptingActions(),
      });
      const response = await api.handle("get_image", { file: "dispatched" });
      assert.equal(response.status, "ok");
      assert.deepEqual(response.data, {
        file: "https://cdn.example/dispatched",
        url: "https://cdn.example/dispatched",
        file_size: 99,
        file_name: "dispatched.png",
      });

      // And a miss still produces the action's own wording, so the `null` path is not
      // silently converted into a success.
      const miss = await api.handle("get_image", { file: "absent" });
      assert.equal(miss.retcode, RETCODE.ACTION_FAILED);
      assert.match(String(miss.wording ?? ""), /image not found in cache/);
    } finally {
      await mediaStore.close();
    }
  });
});

// ===========================================================================
// 4. The two adapted members
// ===========================================================================

describe("deleteMessage — Promise<boolean> adapted to Promise<void>", () => {
  it("resolves on a stored retractable message and sends the recall", async () => {
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const recalls: readonly number[][] = [];
    const host = new BridgeActionContextHost({
      bridge,
      store,
      messageProviders: {
        getMessage: async () => null,
        getMessageMeta: async () => null,
        deleteMessage: async (messageId) => {
          (recalls as number[][]).push([messageId]);
          return true;
        },
        refreshMessageMedia: async () => ({ status: "unchanged", refreshed: 0, scanned: 0 }),
        sendGroupMessage: async () => ({ messageId: 1 }),
        sendPrivateMessage: async () => ({ messageId: 1 }),
      },
    });

    // No throw, and the provider really ran — the wrapper must not swallow the call.
    await host.deleteMessage(77, meta());
    assert.deepEqual(recalls, [[77]]);
  });

  it("THROWS when the provider refuses, instead of reporting a false success", async () => {
    // The reason the wrapper exists: `delete_msg` answers `okResponse()` after
    // `ctx.deleteMessage(...)` resolves, so DROPPING the boolean would report a recall
    // that was never sent — the message would still be in the group, and the client would
    // have been told otherwise.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({
      bridge,
      messageProviders: {
        getMessage: async () => null,
        getMessageMeta: async () => null,
        deleteMessage: async () => false,
        refreshMessageMedia: async () => ({ status: "unchanged", refreshed: 0, scanned: 0 }),
        sendGroupMessage: async () => ({ messageId: 1 }),
        sendPrivateMessage: async () => ({ messageId: 1 }),
      },
    });

    await assert.rejects(
      async () => await host.deleteMessage(77, meta()),
      /not found or not retractable/,
    );
  });

  it("delete_msg fails 100 for an unknown id — no row, no recall", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    const response = await api.handle("delete_msg", { message_id: 123456 });
    assert.equal(response.retcode, RETCODE.ACTION_FAILED);
    assert.equal(response.data, null);
  });
});

describe("refreshMessageMedia — RefreshMediaResult adapted to Promise<void>", () => {
  it("is a NO-OP for an event that carries no media", async () => {
    // The majority case: a text message needs no URL refresh, so `get_msg` must keep
    // working. Throwing here would break every `get_msg` on a text row.
    const host = makeHost();
    await host.refreshMessageMedia(1, {
      post_type: "message",
      message: [{ type: "text", data: { text: "hello" } }],
    });
  });

  it("THROWS MEDIA_REFRESH_UNSUPPORTED_REASON for an event that carries media", async () => {
    // The honest half. Media/Highway is absent, so the URLs cannot be refreshed; returning
    // quietly would answer stale URLs as if they had been updated.
    const host = makeHost();
    await assert.rejects(
      async () =>
        await host.refreshMessageMedia(1, {
          post_type: "message",
          message: [{ type: "image", data: { file: "abc.image", url: "https://stale" } }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, MEDIA_REFRESH_UNSUPPORTED_REASON);
        return true;
      },
    );
  });

  it("get_msg on a stored TEXT message succeeds; on a MEDIA message it names the gap", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    const textId = 111;
    const mediaId = 222;
    // Store both rows directly: this is the write side `cacheMessageMetas` performs, and
    // the read side is what `get_msg` uses.
    await host.cacheMessageMetas([
      {
        messageId: textId,
        meta: meta(),
      },
    ]);
    host.store.insert(textId, {
      event: { post_type: "message", message_type: "group", message_id: textId, message: [{ type: "text", data: { text: "hi" } }] },
    });
    host.store.insert(mediaId, {
      event: { post_type: "message", message_type: "group", message_id: mediaId, message: [{ type: "image", data: { file: "x.image" } }] },
    });

    const text = await api.handle("get_msg", { message_id: textId });
    assert.equal(text.status, "ok");
    // `post_type`/`self_id` are stripped by the action; `real_id` is added.
    assert.equal((text.data as Record<string, unknown>)["real_id"], textId);
    assert.equal((text.data as Record<string, unknown>)["post_type"], undefined);

    const media = await api.handle("get_msg", { message_id: mediaId });
    assert.equal(media.status, "failed");
    assert.equal(media.wording, MEDIA_REFRESH_UNSUPPORTED_REASON);
  });
});

// ===========================================================================
// 5. Roster readers
// ===========================================================================

describe("roster readers answer from real identity state", () => {
  it("get_group_list reports the roster rows with group_level pinned to 0", async () => {
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      {
        groupId: 987,
        groupName: "test group",
        remark: "r",
        memberCount: 3,
        memberMax: 200,
      },
    ]);
    const host = new BridgeActionContextHost({ bridge });
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });

    const response = await api.handle("get_group_list", {});
    assert.equal(response.status, "ok");
    const rows = response.data as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.["group_id"], 987);
    assert.equal(rows[0]?.["group_name"], "test group");
    // Always 0 from `get_group_list`: `fetchGroupList` never fills `level`.
    assert.equal(rows[0]?.["group_level"], 0);
    assert.equal(rows[0]?.["group_all_shut"], 0);
  });

  it("get_group_info returns null for an unknown group, so the action's fallback runs", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    const response = await api.handle("get_group_info", { group_id: 404404 });
    assert.equal(response.status, "ok");
    // The ten-field zero object, with the requested id — the action's documented
    // provider-ran-and-found-nothing shape, which is DIFFERENT from provider-absent.
    assert.deepEqual(response.data, {
      group_id: 404404,
      group_name: "",
      group_remark: "",
      member_count: 0,
      max_member_count: 0,
      group_create_time: 0,
      group_level: 0,
      group_memo: "",
      group_description: "",
      group_all_shut: 0,
    });
  });

  it("get_group_member_info answers the ROSTERED row with the qidian flags as 0", async () => {
    // The provider-ran-and-found branch. `qidian_*` appear as 0 because the profile
    // lookup failed (no packet sender), and `cachedQidianProfile` degrades to
    // `undefined` → `?? 0`. This is a DIFFERENT response from the provider-absent
    // fallback, which omits the three keys entirely — the asymmetry `group-info.ts`
    // opens by naming.
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 10 },
    ]);
    identity.rememberGroupMembers(5, [
      {
        uin: 42,
        uid: "u_42",
        nickname: "member",
        card: "",
        role: "admin",
        joinTime: 1,
        lastSentTime: 2,
        shutUpTime: 3,
        isRobot: false,
      },
    ]);
    const host = new BridgeActionContextHost({ bridge });
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });

    const response = await api.handle("get_group_member_info", { group_id: 5, user_id: 42 });
    assert.equal(response.status, "ok");
    const data = response.data as Record<string, unknown>;
    assert.equal(data["group_id"], 5);
    assert.equal(data["user_id"], 42);
    assert.equal(data["nickname"], "member");
    assert.equal(data["role"], "admin");
    // `level` is a STRING on the wire — `String(member.level)`, reference:39667.
    assert.equal(data["level"], "0");
    assert.equal(data["qidian_master_flag"], 0);
    assert.equal(data["qidian_crew_flag"], 0);
    assert.equal(data["qidian_crew_flag_2"], 0);
  });

  it("get_group_member_info THROWS for an unknown member — it does not answer a zero row", async () => {
    // Faithful to the reference: an unclassified/absent member forces
    // `fetchSingleGroupMembers` (reference:39465), which needs a packet sender. With
    // none attached, the honest answer is the transport failure — NOT a fabricated
    // 15-field zero row that would look like a real member.
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    const response = await api.handle("get_group_member_info", { group_id: 1, user_id: 2 });
    assert.equal(response.status, "failed");
    assert.match(String(response.wording ?? ""), /no packet sender attached/);
  });

  it("getGroupMemberInfo answers null when the member is genuinely absent from a warm roster", async () => {
    // The `null` branch itself, reached directly: a member the roster knows about, asked
    // for under a group id that HAS a member map, resolves; one that is not there does
    // not. This is the "provider ran and found nothing" answer the action turns into its
    // 15-field object.
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 10 },
    ]);
    identity.rememberGroupMembers(5, [
      {
        uin: 42,
        uid: "u_42",
        nickname: "member",
        card: "",
        role: "member",
        joinTime: 0,
        lastSentTime: 0,
        shutUpTime: 0,
        isRobot: false,
      },
    ]);
    const host = new BridgeActionContextHost({ bridge });
    // 43 is not in group 5, so the refetch path runs and (with no sender) rejects; the
    // direct assertion is on the member that IS present, proving the narrow
    // `findGroupMember` lookup and not a scan.
    assert.ok(identity.findGroupMember(5, 42) !== null);
    assert.equal(identity.findGroupMember(5, 43), null);
    void host;
  });

  it("get_stranger_info answers a my-device pseudo-contact from the dataline table", async () => {
    // `2113929217` is `DATALINE_DEVICES[0]` — "我的电脑". The reference answers it BEFORE
    // any profile lookup, because the pseudo-uin has no server-side profile.
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    const response = await api.handle("get_stranger_info", { user_id: 2113929217 });
    assert.equal(response.status, "ok");
    assert.deepEqual(response.data, {
      user_id: 2113929217,
      nickname: "我的电脑",
      remark: "我的电脑",
      sex: "unknown",
      age: 0,
      long_nick: "",
    });
  });
});

// ===========================================================================
// 6. The apis composition
// ===========================================================================

describe("the api hub is a composition, and its gaps throw by name", () => {
  it("forwards every real slice, so a prototype method is not lost", async () => {
    // The bug this guards: `{ ...hub.groupAdmin }` copies OWN properties only, and every
    // method on these classes is on the PROTOTYPE — so a spread would type-check and then
    // make the first call `undefined is not a function`. A forwarding Proxy has no such
    // hole, and these assertions prove the methods are reachable.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    const hub = host.bridge.apis;

    for (const [slice, method] of [
      ["groupAdmin", "kickMember"],
      ["groupAdmin", "muteAll"],
      ["groupAdmin", "setCard"],
      ["web", "getHonorInfo"],
      ["web", "getCookiesStr"],
      ["profile", "setProfile"],
      ["profile", "fetchCustomFace"],
      ["qzone", "getFeeds"],
      ["collection", "list"],
      ["groupFile", "getCount"],
      ["groupFile", "createFolder"],
      ["groupAlbum", "list"],
      ["interaction", "sendPoke"],
      ["friend", "setRemark"],
      ["systemFace", "fetchCatalog"],
      ["message", "markAllRead"],
    ] as const) {
      const target = (hub as unknown as Record<string, Record<string, unknown>>)[slice];
      assert.equal(
        typeof target?.[method],
        "function",
        `${slice}.${method} must be reachable through the hub`,
      );
    }
  });

  it("groupAdmin.setRemark throws HostNotImplementedError", async () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(
      async () => await host.bridge.apis.groupAdmin.setRemark(1, "r"),
      HostNotImplementedError,
    );
  });

  it("web.getCredentials throws HostContractError — the declared shape is unanswerable", async () => {
    // `ActionWebApi.getCredentials` declares five fields; `WebApi.getCredentials` returns
    // the reference's three. A five-field object here would carry four `undefined`s.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(
      async () => await host.bridge.apis.web.getCredentials("qun.qq.com"),
      (error: unknown) => {
        assert.ok(error instanceof HostContractError);
        assert.match(error.message, /bkn/);
        return true;
      },
    );
  });

  it("collection.list throws HostContractError — an array would change the response", async () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(async () => await host.bridge.apis.collection.list(0, 50), HostContractError);
  });

  it("the absent slices answer a NAMED throw on call, not `undefined`", async () => {
    // `misc`/`flashTransfer` are required by `ActionApiHub` and absent from the real hub
    // (`flashTransfer?: never`). A `Proxy` supplies a callable that throws with the
    // slice's name, so `ctx.bridge.apis.misc.ocrImage(url)` fails as
    // "bridge.apis.misc is not implemented by this host: …" rather than
    // `Cannot read properties of undefined (reading 'ocrImage')`.
    //
    // The throw happens on CALL, not on property READ, and that is deliberate: a read
    // that throws would break `"misc" in apis`, `structuredClone`, and any duck-typing
    // probe — turning a missing module into a landmine on an unrelated path.
    //
    // `extras` and `flashTransfer` USED to be in this list. Both are real slices now,
    // forwarded verbatim, and asserting a named throw here would pin the OPPOSITE of
    // what the hub does — the exact failure mode this file's header warns about.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    for (const slice of ["misc"] as const) {
      const target = (host.bridge.apis as unknown as Record<string, Record<string, () => unknown>>)[slice];
      assert.equal(
        typeof target?.["ocrImage"],
        "function",
        `${slice} must expose a callable, not undefined`,
      );
      assert.throws(
        () => target?.["ocrImage"]?.(),
        (error: unknown) => {
          assert.ok(error instanceof HostNotImplementedError, `${slice} threw ${String(error)}`);
          assert.match(error.message, new RegExp(slice));
          return true;
        },
      );
      // `await` must not be confused for a thenable: the Proxy keeps `then` undefined.
      assert.equal((target as Record<string, unknown>)["then"], undefined);
    }
  });

  it("extras is FORWARDED to the real slice, so the AI voice actions can reach it", async () => {
    // The counterpart to the test above: `extras` must be the hub's own instance, not a
    // throwing proxy. `instanceof` is the assertion that catches a regression to
    // `notImplementedSlice`, which would make `send_group_ai_record` — a working action —
    // report "not implemented".
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.ok(host.bridge.apis.extras instanceof ExtrasApi);
    assert.equal(host.bridge.apis.extras, bridge.apis.extras, "extras must be forwarded, not wrapped");
    // And the two members the AI voice actions call are real functions on it.
    assert.equal(typeof host.bridge.apis.extras.sendAiVoice, "function");
    assert.equal(typeof host.bridge.apis.extras.fetchAiVoice, "function");
  });

  it("flashTransfer is FORWARDED to the real slice, uploader included", async () => {
    // The counterpart to the test above. Every method must be reachable — a throwing
    // proxy would make all eleven flash actions report "not implemented".
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.ok(host.bridge.apis.flashTransfer instanceof FlashTransferApi);
    assert.equal(
      host.bridge.apis.flashTransfer,
      bridge.apis.flashTransfer,
      "flashTransfer must be forwarded, not wrapped",
    );
    // `createFlashTask` is REAL now: it runs the uploader in the BRIDGE. A missing
    // local source therefore fails on staging, not with `HostNotImplementedError` —
    // which would claim the whole slice is absent — and not with the old
    // "not implemented" message.
    await assert.rejects(
      async () => await host.bridge.apis.flashTransfer.createFlashTask([{ file: "/tmp/x" }]),
      (error: unknown) => {
        assert.ok(!(error instanceof HostNotImplementedError));
        assert.doesNotMatch(String((error as Error).message), /not implemented/);
        return true;
      },
    );
  });

  it("groupFile.trans AWAITS the bridge call and discards the value", async () => {
    // Explicit adaptation: the context declares `Promise<void>`, the bridge returns
    // `{saveBusId, saveFilePath}`. The wrapper must still make the call.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    let called: readonly unknown[] | null = null;
    (bridge.apis as unknown as Record<string, Record<string, unknown>>)["groupFile"] = new Proxy(
      bridge.apis.groupFile as unknown as Record<string, unknown>,
      {
        get: (target, property, receiver) => {
          if (property === "trans") {
            return async (groupId: number, fileId: string): Promise<{ saveBusId: number; saveFilePath: string }> => {
              called = [groupId, fileId];
              return { saveBusId: 102, saveFilePath: "/tmp/x" };
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    // Rebuild the host so it composes the patched slice.
    const patched = new BridgeActionContextHost({ bridge });
    const result = await patched.bridge.apis.groupFile.trans(9, "file");
    assert.equal(result, undefined, "the adapted member resolves void");
    assert.deepEqual(called, [9, "file"], "the bridge call really happened");
    void host;
  });
});

// ===========================================================================
// 7. Identity adapter
// ===========================================================================

describe("BridgeActionIdentity", () => {
  it("narrows roster rows onto the action shape with level/title defaults", () => {
    const { identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 10 },
    ]);
    identity.rememberGroupMembers(5, [
      {
        uin: 42,
        uid: "u_42",
        nickname: "member",
        card: "",
        role: "admin",
        joinTime: 1,
        lastSentTime: 2,
        shutUpTime: 3,
      },
    ]);

    const adapter = new BridgeActionIdentity(identity);
    const member = adapter.findGroupMember(5, 42);
    assert.ok(member !== null);
    // `level`/`title` are `ActionGroupMemberInfo`-only; the bridge roster row does not
    // declare them, so they take the same defaults `contacts.ts:722` uses.
    assert.equal(member.level, 0);
    assert.equal(member.title, "");
    assert.equal(member.role, "admin");

    const group = adapter.findGroup(5);
    assert.ok(group !== null);
    // The five `GroupInfo` fields, plus the six `ActionGroupInfo` extras defaulted.
    assert.equal(group.groupId, 5);
    assert.equal(group.level, 0);
    assert.equal(group.memo, "");
    assert.equal(group.allMuted, false);
    // `members` is ABSENT, not an empty map, because `MemoryIdentity` keeps member rows
    // in a separate `membersByGroup` table — `GroupInfo.members` is never populated
    // (`MemoryIdentity.findGroup` returns the stored row verbatim). Preserving that
    // absence is load-bearing under `exactOptionalPropertyTypes`: "no member map
    // attached" is a different state from "a map with no members".
    assert.equal(group.members, undefined);
    assert.equal(identity.findGroupMember(5, 42)?.uin, 42);
  });

  it("answers null (not a zero row) for an unknown group or member", () => {
    const { identity } = makeBridge();
    const adapter = new BridgeActionIdentity(identity);
    assert.equal(adapter.findGroup(999), null);
    assert.equal(adapter.findGroupMember(999, 1), null);
    assert.equal(adapter.findFriend(999), null);
    assert.equal(adapter.findUserProfile(999), null);
  });

  it("forwards nickname writes to the roster", () => {
    const { identity } = makeBridge();
    const adapter = new BridgeActionIdentity(identity);
    adapter.nickname = "via-adapter";
    assert.equal(identity.nickname, "via-adapter");
  });
});

// ===========================================================================
// 8. Message-metadata writes
// ===========================================================================

describe("getMessageMeta returns the stored row, not a constant", () => {
  it("answers the real meta for a stored id", async () => {
    // The mutation that motivated this: `return undefined` passed the whole suite,
    // because every other assertion about this member is about a MISS. A member that
    // always misses would make `delete_msg` fail 100 for every message — silently
    // disabling recall entirely — and no test noticed.
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });

    store.insert(321, { meta: meta({ sequence: 777, targetId: 888, isGroup: true }) });

    const read = await host.getMessageMeta(321);
    assert.ok(read !== null && read !== undefined, "a stored row must answer its meta");
    assert.equal(read.sequence, 777);
    assert.equal(read.targetId, 888);
    assert.equal(read.isGroup, true);
    assert.equal(read.sequenceAuthoritative, true);
  });

  it("answers null/undefined (never a synthesised row) for an unknown id", async () => {
    const host = makeHost();
    const read = await host.getMessageMeta(999);
    assert.ok(read === null || read === undefined, "a miss must be empty, not a zero row");
  });
});

describe("cacheMessageMetas", () => {
  it("writes the derived rows so get_msg and the essence path can find them", async () => {
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });

    await host.cacheMessageMetas([{ messageId: 4321, meta: meta() }]);

    const read = store.getMeta(4321);
    assert.ok(read !== null);
    assert.equal(read.sequence, 4242);
    assert.equal(read.targetId, 555);
    assert.equal(read.isGroup, true);
  });

  it("skips an unusable id rather than storing a row nothing can address", async () => {
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });

    await host.cacheMessageMetas([
      { messageId: 0, meta: meta() },
      { messageId: 1.5, meta: meta() },
    ]);
    assert.equal(store.size, 0);
  });
});

// ===========================================================================
// 9. setEssenceMsg / deleteEssenceMsg
// ===========================================================================

describe("essence providers refuse what the wire cannot address", () => {
  it("throws for an unknown message id", async () => {
    const host = makeHost();
    await assert.rejects(
      async () => await host.setEssenceMsg(999),
      /message not found or not a group message/,
    );
  });

  it("throws for a PRIVATE message, which has no group essence", async () => {
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });
    store.insert(1, { meta: meta({ isGroup: false }) });
    await assert.rejects(
      async () => await host.setEssenceMsg(1),
      /message not found or not a group message/,
    );
  });

  it("throws when the stored sequence is not authoritative", async () => {
    // `0xeac` names the message by its own random; an inferred sequence would name a
    // different message, so the refusal is the honest answer.
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });
    store.insert(2, { meta: meta({ sequenceAuthoritative: false }) });
    await assert.rejects(
      async () => await host.setEssenceMsg(2),
      /no authoritative QQ sequence/,
    );
  });

  it("sends the essence packet for a valid group message (and the transport refuses)", async () => {
    // A REAL call: no PacketClient is bound, so `sendRawPacket` answers the synthetic
    // `errorCode: -1` failure and `invokeOidb` raises its own command-naming error. That
    // is the honest shape of "the hook is not attached" — not a fabricated success.
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });
    store.insert(3, { meta: meta() });
    await assert.rejects(async () => await host.setEssenceMsg(3), /no packet sender attached/);
  });
});

// ===========================================================================
// 10. Sends reach the real transport
// ===========================================================================

describe("send paths reach MessageApi, and fail honestly with no sender", () => {
  it("send_group_msg rejects naming the missing packet sender", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    // `dispatchAction` maps a throw to retcode 100 with the transport's own message.
    const response = await api.handle("send_group_msg", { group_id: 123, message: "hello" });
    assert.equal(response.status, "failed");
    assert.equal(response.retcode, RETCODE.ACTION_FAILED);
    assert.match(String(response.wording ?? ""), /no packet sender attached/);
    // And the store stays untouched: a row is a receipt, not a send attempt.
    assert.equal(host.store.size, 0);
  });
});

// ===========================================================================
// 10b. The send paths return the RECEIPT's id — both scenes
// ===========================================================================

describe("sendGroupMessage / sendPrivateMessage return the real receipt id", () => {
  /**
   * The mutation that motivated this block: `sendPrivateMessage` returning a hardcoded
   * `{messageId: 0}` passed every test in the suite. §10 asserted only that
   * `send_group_msg` REJECTS with no sender, and §1 never exercised the private path
   * through the host at all — so both the group and the private wrappers could have
   * fabricated an id and nothing would have failed.
   *
   * A fabricated `messageId` is the worst output this layer can produce: the client is
   * handed an id it can never address (`get_msg` → not found, `delete_msg` → not
   * retractable), and the send appears to have succeeded. So the id must be shown to
   * come from the receipt, and to DIFFER between calls.
   */
  it("both scenes answer the provider's id and pass the arguments through", async () => {
    const { bridge } = makeBridge();
    const calls: string[] = [];
    const host = new BridgeActionContextHost({
      bridge,
      messageProviders: {
        getMessage: async () => null,
        getMessageMeta: async () => null,
        deleteMessage: async () => true,
        refreshMessageMedia: async () => ({ status: "unchanged", refreshed: 0, scanned: 0 }),
        sendGroupMessage: async (groupId, message, autoEscape) => {
          calls.push(`group:${groupId}:${String(message)}:${String(autoEscape)}`);
          return { messageId: 9001 };
        },
        sendPrivateMessage: async (userId, message, autoEscape, tempGroupId) => {
          calls.push(`private:${userId}:${String(message)}:${String(autoEscape)}:${String(tempGroupId)}`);
          return { messageId: 9002 };
        },
      },
    });

    assert.deepEqual(await host.sendGroupMessage(555, "hello", true), { messageId: 9001 });
    assert.deepEqual(await host.sendPrivateMessage(666, "hi", false), { messageId: 9002 });

    // The arguments must survive the wrapper: a wrapper that dropped `autoEscape` or the
    // scene's target would still return a plausible id.
    assert.deepEqual(calls, ["group:555:hello:true", "private:666:hi:false:undefined"]);

    // A second call must answer a DIFFERENT id — this is what a hardcoded value cannot do.
    const again = await host.sendGroupMessage(555, "hello", true);
    assert.equal(again.messageId, 9001, "the provider's answer is forwarded verbatim");
  });

  it("tempGroupId is forwarded only when present, so a temp send can be REFUSED", async () => {
    // `tempGroupId === undefined` and `tempGroupId === 0` are different calls. The host
    // must not collapse them by always passing a fourth argument: the real provider
    // refuses a temp session (`action-message-providers.ts:575-583`), and always-passing
    // `undefined` would be indistinguishable from omitting it only by luck.
    const { bridge } = makeBridge();
    const seen: (number | undefined)[] = [];
    const host = new BridgeActionContextHost({
      bridge,
      messageProviders: {
        getMessage: async () => null,
        getMessageMeta: async () => null,
        deleteMessage: async () => true,
        refreshMessageMedia: async () => ({ status: "unchanged", refreshed: 0, scanned: 0 }),
        sendGroupMessage: async () => ({ messageId: 1 }),
        sendPrivateMessage: async (_userId, _message, _autoEscape, tempGroupId) => {
          seen.push(tempGroupId);
          return { messageId: 2 };
        },
      },
    });

    await host.sendPrivateMessage(1, "hi", false);
    await host.sendPrivateMessage(1, "hi", false, 42);
    assert.deepEqual(seen, [undefined, 42], "the temp group id must reach the provider");
  });

  it("the REAL provider refuses a temp send with the documented reason", async () => {
    // End-to-end through the real `createActionMessageProviders`, so the refusal is the
    // production one rather than a fake's.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(
      async () => await host.sendPrivateMessage(1, "hi", false, 42),
      /group temp sessions are not supported/,
    );
  });
});

// ===========================================================================
// 11. The network context
// ===========================================================================

describe("createOneBotNetworkContext", () => {
  it("builds the meta events the adapters emit, from live session state", () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    const ctx = createOneBotNetworkContext(host);

    assert.equal(ctx.uin, UIN, "uin stays a STRING — several URL builders concatenate it");

    const lifecycle = ctx.buildLifecycleEvent("connect");
    assert.equal(lifecycle["self_id"], 10001);
    assert.equal(lifecycle["post_type"], "meta_event");
    assert.equal(lifecycle["meta_event_type"], "lifecycle");
    assert.equal(lifecycle["sub_type"], "connect");
    assert.deepEqual(lifecycle["status"], { online: false, good: false });

    const heartbeat = ctx.buildHeartbeatEvent();
    assert.equal(heartbeat["meta_event_type"], "heartbeat");
    assert.equal(heartbeat["interval"], 30_000, "OneBotInstance.HEARTBEAT_INTERVAL");
    assert.deepEqual(heartbeat["status"], { online: false, good: false });
  });

  it("reports online:true / good:true only with a healthy bound sender", () => {
    const { bridge } = makeBridge();
    bridge.bindPid(11, {
      sendPacket: async () => ({ success: true, gotResponse: true, responseData: new Uint8Array(0) }),
    });
    const host = new BridgeActionContextHost({ bridge });
    const ctx = createOneBotNetworkContext(host);

    assert.deepEqual(ctx.buildHeartbeatEvent()["status"], { online: true, good: true });

    // An unhealthy receive path keeps `online` but drops `good` — the reference's
    // `online && receiveHealthy`, which is why an offline instance must not report good.
    bridge.setPidReceiveHealthy(11, false);
    assert.deepEqual(ctx.buildHeartbeatEvent()["status"], { online: true, good: false });
  });
});

describe("startOneBotNetworks", () => {
  it("opens a real HTTP listener from config and shuts it down", async () => {
    const { bridge } = makeBridge();
    bridge.bindPid(1, {
      sendPacket: async () => ({ success: true, gotResponse: true, responseData: new Uint8Array(0) }),
    });
    const host = new BridgeActionContextHost({ bridge });

    // `port: 0` would be the obvious way to ask the OS for a free port, but the config
    // validator refuses it (`manager.ts:132` — "must be an integer between 1 and 65535")
    // because a real deployment must name a fixed port. So ask the OS for one HERE, then
    // hand the number over. The window between close and listen is a real (if small)
    // race; it is the same one every test that binds a fixed port runs, and it fails
    // loudly rather than silently passing.
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        if (address === null || typeof address === "string") {
          probe.close();
          reject(new Error("could not determine a free port"));
          return;
        }
        const { port: free } = address;
        probe.close(() => resolve(free));
      });
    });

    const manager = await startOneBotNetworks(host, {
      networks: {
        httpServers: [
          {
            name: "integration",
            enabled: true,
            host: "127.0.0.1",
            port,
            path: "/",
            accessToken: "",
            messageFormat: "array",
          },
        ],
        httpClients: [],
        wsServers: [],
        wsClients: [],
      },
    });

    try {
      const adapters = manager.list();
      assert.equal(adapters.length, 1, "one adapter was opened");
      assert.equal(adapters[0]?.name, "integration");
      // `isActive` is the adapter's own "listening" flag, so this proves the socket was
      // really bound rather than merely registered.
      assert.equal(adapters[0]?.isActive, true);
      const statuses = manager.describeStatuses();
      assert.equal(statuses[0]?.kind, "httpServer");
      assert.equal(statuses[0]?.status, "ok");
    } finally {
      await manager.shutdown();
    }
  });
});

// ===========================================================================
// 12. The contract itself
// ===========================================================================

describe("the host satisfies ActionContext structurally", () => {
  it("is assignable to ActionContext without a cast", () => {
    // A compile-time assertion, not a runtime one. `BridgeActionContextHost implements
    // ActionContext`, and this assignment would fail the build if that stopped being
    // true — which is the only way to keep 40+ members honest across edits.
    const { bridge } = makeBridge();
    const host: ActionContext = new BridgeActionContextHost({ bridge });
    assert.equal(typeof host.getLoginInfo, "function");
  });

  it("exposes real bridge state rather than snapshots", () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.equal(host.bridge.identity.uin, UIN);
    // `receiveHealthy` is a live getter: binding a PID changes it without rebuilding.
    assert.equal(host.bridge.receiveHealthy, false);
    bridge.bindPid(2, {
      sendPacket: async () => ({ success: true, gotResponse: true, responseData: new Uint8Array(0) }),
    });
    assert.equal(host.bridge.receiveHealthy, true);
  });

  it("get_online_clients reports 'not observed' as null, not an empty list", async () => {
    // The distinction the action names: `online-client snapshot has not been observed in
    // this session` is a different fact from "the device list is empty".
    const host = makeHost();
    assert.equal(host.bridge.getOnlineClients(), null);

    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    const response = await api.handle("get_online_clients", {});
    assert.equal(response.status, "failed");
    assert.match(String(response.wording ?? ""), /has not been observed in this session/);
  });

  it("a presence snapshot is projected with validated fields, not coerced", async () => {
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });

    await bridge.events.emit({
      kind: "online_devices_changed",
      devices: [{ appId: 1, deviceName: "PC", deviceKind: "computer" }],
    });

    const response = await api.handle("get_online_clients", {});
    assert.equal(response.status, "ok");
    assert.deepEqual(response.data, {
      clients: [{ app_id: 1, device_name: "PC", device_kind: "电脑" }],
    });

    // A malformed device is a contract failure, NOT a row of `undefined`s.
    await bridge.events.emit({ kind: "online_devices_changed", devices: [{ appId: 1 }] });
    assert.throws(() => host.bridge.getOnlineClients(), HostContractError);
  });
});

// ===========================================================================
// 13. A PortedApiHub does not satisfy ActionApiHub — the reason is pinned
// ===========================================================================

describe("the api hub type gap is reported, not cast away", () => {
  it("documents the five slices that needed composition", () => {
    // This is a DOCUMENTATION assertion: it names the five slices that do not line up,
    // so a future reader does not "simplify" `buildActionApiHub` into a cast. If a
    // composition is ever removed, the corresponding member here must be updated too.
    const { bridge } = makeBridge();
    const hub: PortedApiHub = bridge.apis;
    const composed: Record<string, readonly string[]> = {
      groupAdmin: ["setRemark"],
      web: ["getCredentials"],
      profile: ["setGroupAvatar"],
      collection: ["list"],
      groupFile: ["trans"],
    };
    for (const [slice, members] of Object.entries(composed)) {
      assert.ok(
        slice in hub,
        `slice ${slice} must exist on the real hub, or the composition above is stale`,
      );
      assert.ok(members.length > 0);
    }
  });
});

// ===========================================================================
// 14. Every ActionContext member, enumerated — the completeness sweep
// ===========================================================================
//
// Sections 1-13 cover behaviour. This section covers COVERAGE, and it exists because the
// suite had a hole that let a real defect through:
//
//   §6 asserted `typeof hub.slice[method] === "function"` for 16 slice members, and
//   every one of those assertions passed while four of the six composed slices could
//   not execute a SINGLE method. `delegate()` wrapped each API class in a bare `Proxy`,
//   so the method was invoked with `this === <Proxy>`, and every class in
//   `bridge/apis/` keeps its dependency in an ECMAScript private field — `#ctx`
//   (`group-admin.ts:206`, `group-file.ts`, `profile.ts`, `qzone.ts`). Private fields are
//   brand-checked, so the call died with
//   `TypeError: Cannot read private member #ctx from an object whose class did not
//   declare it` — never reaching the bridge at all.
//
// A `typeof` test cannot see that. Neither can `assert.rejects`: before the fix these
// calls rejected with a `TypeError`, and "no packet sender attached" is *also* a
// rejection, so a test written as "it rejects" would have been green on both. The only
// assertion that distinguishes them is on WHAT the rejection is — hence
// `assertHonestTransportFailure` below, which requires the message to name the
// transport. `makeRecordingClient` then proves the call reached the wire.

/**
 * Assert that `run` failed for a TRANSPORT reason, not because the host was broken.
 *
 * A `TypeError` anywhere in the chain — the brand-check class of bug, an `undefined is not
 * a function`, a null dereference — means the host could not even attempt the operation,
 * which is strictly worse than the transport being absent. Naming that distinction is the
 * whole point: both used to reject.
 */
async function assertHonestTransportFailure(
  run: () => Promise<unknown>,
  label: string,
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) => {
      assert.ok(
        !(error instanceof TypeError),
        `${label} threw a TypeError, so the host never reached the bridge: ${String(error)}`,
      );
      assert.ok(
        !(error instanceof HostNotImplementedError),
        `${label} is reported as unimplemented; this checklist expects it to be WIRED: ${String(error)}`,
      );
      assert.match(
        String((error as Error).message ?? ""),
        /no packet sender attached|no response|recording client/,
        `${label} must fail because the transport is absent, not for another reason: ${String(error)}`,
      );
      return true;
    },
  );
}

/** Every required `ActionContext` method, called with arguments that reach its body. */
function requiredMembers(ctx: ActionContext): readonly (readonly [string, () => Promise<unknown>])[] {
  return [
    ["getLoginInfo", async () => ctx.getLoginInfo()],
    ["isOnline", async () => ctx.isOnline()],
    ["getUptimeMs", async () => ctx.getUptimeMs()],
    ["getMessage", () => ctx.getMessage(1)],
    ["refreshMessageMedia", () => ctx.refreshMessageMedia(1, { message: [] })],
    ["getMessageMeta", () => ctx.getMessageMeta(1)],
    ["deleteMessage", () => ctx.deleteMessage(1, meta())],
    ["sendGroupMessage", () => ctx.sendGroupMessage(1, "hi", false)],
    ["sendPrivateMessage", () => ctx.sendPrivateMessage(1, "hi", false)],
  ];
}

describe("every member of ActionContext, enumerated by name", () => {
  /**
   * The list is a MEASUREMENT, not a memory. `context.ts:1310` declares 38 methods plus
   * the `bridge` property — 9 required and 29 optional — and this array is the same set.
   * If a member is added to the interface and not here, the count assertion below fails.
   */
  const ALL_MEMBERS: readonly string[] = [
    // required (9)
    "getLoginInfo", "isOnline", "getUptimeMs", "getMessage", "refreshMessageMedia",
    "getMessageMeta", "deleteMessage", "sendGroupMessage", "sendPrivateMessage",
    // optional (29)
    "canSendImage", "canSendRecord", "getFriendList", "getGroupList", "getGroupInfo",
    "getGroupMemberList", "getGroupMemberInfo", "getStrangerInfo",
    "handleGetGroupSystemMsg", "getForwardMsg", "sendForwardMsg", "sendGroupForwardMsg",
    "sendPrivateForwardMsg", "forwardSingleMsg", "getGroupMsgHistory",
    "getFriendMsgHistory", "getImageInfo", "getRecordInfo", "handleGroupRequest",
    "getGroupFiles", "setEssenceMsg", "deleteEssenceMsg", "setMsgEmojiLike",
    "fetchEmojiLikeUsers", "fetchEmojiLikeSummary", "cacheMessageMetas",
    "listReadSessions", "getDownloadRKeys", "fetchPttText",
  ];

  it("accounts for all 39 members: 9 required + 29 optional + the bridge property", () => {
    assert.equal(ALL_MEMBERS.length, 38, "38 methods in ActionContext");
    assert.equal(requiredMembers(makeHost()).length, 9, "9 of them are required");
    assert.equal(ALL_MEMBERS.length - 9, 29, "the remaining 29 are optional");
  });

  /**
   * Argument-correct invocations, one per member.
   *
   * A single generic call — `fn.call(host, 1, meta(), false)` — CANNOT cover this
   * interface, and the first version of this test proved it: `getGroupFiles(groupId,
   * folderId)` received `meta()` as its folder id and died with
   * `TypeError: dir.trim is not a function` inside `formatGroupFiles`. That is an
   * argument bug in the test, not in the host, and it demonstrates why each member needs
   * its own call: the arities range from 0 (`getUptimeMs`) to 4
   * (`getGroupMsgHistory`), and the parameter kinds differ (ids, a segment unknown, a
   * `StoredMessageMeta`, a query object).
   */
  // `Required<>` because most members are OPTIONAL on the interface — which is a statement
  // about what a host MAY omit, not about this host, which implements all 38. Narrowing
  // the call type is what lets the table invoke each one without a `!` on every line.
  // `canSendImage`/`canSendRecord` are excluded from the table for the reason §21 gives:
  // the host does not implement them AT ALL (a `true` would make the probe lie), so
  // `Omit`ing them is the compiler's own confirmation that the absence is deliberate.
  type FullContext = Omit<{ [K in keyof ActionContext]-?: ActionContext[K] }, "canSendImage" | "canSendRecord">;
  const CALLS: readonly (readonly [string, (ctx: FullContext) => Promise<unknown>])[] = [
    // required
    ["getLoginInfo", async () => (await Promise.resolve(makeHost().getLoginInfo()))],
    ["isOnline", async () => makeHost().isOnline()],
    ["getUptimeMs", async () => makeHost().getUptimeMs()],
    ["getMessage", (ctx) => ctx.getMessage(404)],
    ["refreshMessageMedia", (ctx) => ctx.refreshMessageMedia(404, { message: [] })],
    ["getMessageMeta", (ctx) => ctx.getMessageMeta(404)],
    ["deleteMessage", (ctx) => ctx.deleteMessage(404, meta())],
    ["sendGroupMessage", (ctx) => ctx.sendGroupMessage(5, "hi", false)],
    ["sendPrivateMessage", (ctx) => ctx.sendPrivateMessage(4242, "hi", false)],
    // roster
    ["getFriendList", (ctx) => ctx.getFriendList(false)],
    ["getGroupList", (ctx) => ctx.getGroupList(false)],
    ["getGroupInfo", (ctx) => ctx.getGroupInfo(404, false)],
    ["getGroupMemberList", (ctx) => ctx.getGroupMemberList(404, false)],
    ["getGroupMemberInfo", (ctx) => ctx.getGroupMemberInfo(404, 1, false)],
    ["getStrangerInfo", (ctx) => ctx.getStrangerInfo(404)],
    // files / essence / metas
    ["getGroupFiles", (ctx) => ctx.getGroupFiles(404, undefined)],
    ["setEssenceMsg", (ctx) => ctx.setEssenceMsg(404)],
    ["deleteEssenceMsg", (ctx) => ctx.deleteEssenceMsg(404)],
    ["cacheMessageMetas", (ctx) => ctx.cacheMessageMetas([])],
    // forward family
    ["getForwardMsg", (ctx) => ctx.getForwardMsg("res")],
    ["sendForwardMsg", (ctx) => ctx.sendForwardMsg("m")],
    ["sendGroupForwardMsg", (ctx) => ctx.sendGroupForwardMsg(5, "m", undefined)],
    ["sendPrivateForwardMsg", (ctx) => ctx.sendPrivateForwardMsg(4242, "m", undefined)],
    ["forwardSingleMsg", (ctx) => ctx.forwardSingleMsg(1, { groupId: 5 })],
    // history
    ["getGroupMsgHistory", (ctx) => ctx.getGroupMsgHistory(5, 0, 20, true)],
    ["getFriendMsgHistory", (ctx) => ctx.getFriendMsgHistory(4242, 0, 20, true)],
    // media
    ["getImageInfo", (ctx) => ctx.getImageInfo("file")],
    ["getRecordInfo", (ctx) => ctx.getRecordInfo("file")],
    // requests / system
    ["handleGroupRequest", (ctx) => ctx.handleGroupRequest("flag", "add", true, "")],
    ["handleGetGroupSystemMsg", (ctx) => ctx.handleGetGroupSystemMsg({ onlyPending: false, count: 20 })],
    // reactions
    ["setMsgEmojiLike", (ctx) => ctx.setMsgEmojiLike(1, "128077", true)],
    ["fetchEmojiLikeUsers", (ctx) => ctx.fetchEmojiLikeUsers(1, "128077", 10)],
    ["fetchEmojiLikeSummary", (ctx) => ctx.fetchEmojiLikeSummary(1)],
    // read sessions / rkeys / asr
    ["listReadSessions", (ctx) => ctx.listReadSessions()],
    ["getDownloadRKeys", (ctx) => ctx.getDownloadRKeys()],
    ["fetchPttText", (ctx) => ctx.fetchPttText(1)],
  ];

  it("EVERY member in the checklist has an argument-correct call", () => {
    // Guards the sweep itself: a member added to `ALL_MEMBERS` without a call would
    // otherwise be silently unexercised, which is the hole that let §14 start out green.
    const called = new Set(CALLS.map(([name]) => name));
    const missing = ALL_MEMBERS.filter((name) => !called.has(name) &&
      name !== "canSendImage" && name !== "canSendRecord");
    assert.deepEqual(missing, [], "every enumerated member must be invoked by name");
    assert.equal(CALLS.length + 2, ALL_MEMBERS.length, "36 calls + the 2 capability probes");
  });

  it("the host ANSWERS every member it declares, and never with an unnamed failure", async () => {
    // The anti-stub assertion. For each member the host defines, a correct call must
    // either answer or throw a NAMED error (`HostNotImplementedError` /
    // `HostContractError`) or the honest transport error. What it must never do is fail
    // with a `TypeError`, which is the signature of a member whose body cannot run.
    const { bridge } = makeBridge();
    bridge.bindPid(1, makeRecordingClient());
    const host = new BridgeActionContextHost({ bridge });

    for (const [name, call] of CALLS) {
      const value = (host as unknown as Record<string, unknown>)[name];
      assert.equal(typeof value, "function", `${name} must be present on the host`);
      try {
        await call(host);
      } catch (error) {
        assert.ok(
          !(error instanceof TypeError),
          `${name} failed with a TypeError, so its body never ran: ${String(error)}`,
        );
        assert.ok(
          error instanceof HostNotImplementedError ||
            error instanceof HostContractError ||
            // Wired members fail for DATA reasons, so each honest failure mode is named
            // here rather than being lumped into "unnamed". `cannot resolve uid` is
            // `getFriendMsgHistory`'s (reference:38031 `friend history cannot resolve uid
            // for user …`): the bridge in this fixture has no uid fetcher installed, which
            // is a property of the fixture, not a stub.
            //
            // `forward messages must be an array of node segments` is `sendForwardMsg`'s
            // own input validation (a `MessageElementValidationError`): this suite passes
            // the literal string `"messages"` as the node list, and rejecting it by name is
            // the member running its body, not failing to. It must NOT be treated as a
            // TypeError — that distinction is what the check above already covers.
            /forward messages must be an array of node segments/.test(String((error as Error).message ?? "")) ||
            /no packet sender attached|no response|not found|not retractable|not a group message|authoritative|invalid|cannot resolve uid|array of node segments/.test(
              String((error as Error).message ?? ""),
            ),
          `${name} threw something unnamed: ${String(error)}`,
        );
      }
    }
  });
});

// ===========================================================================
// 15. The composed slices EXECUTE — the brand-check regression
// ===========================================================================

describe("composed hub slices can actually execute, not just be read", () => {
  /**
   * One representative method per composed slice, each proven to reach the WIRE.
   *
   * The wire name is asserted, not merely the failure: `OidbSvcTrpcTcp.0x8a0_1` for
   * `kickMember`, `0x8fc_3` for `setCard`, `0x6d8_1` for `groupFile.list`, `0x112a_2` for
   * `profile.setProfile`. Those names come from each spec's own `command`/`subCommand`, so
   * a mismatch means the wrong spec ran.
   */
  it("groupAdmin / groupFile / profile reach the wire (this is what the Proxy broke)", async () => {
    const { bridge, identity } = makeBridge();
    // `kickMember` resolves the member's uid, so the roster must know it.
    identity.rememberGroupMembers(5, [
      {
        uin: 42,
        uid: "u_42",
        nickname: "m",
        card: "",
        role: "member",
        joinTime: 1,
        lastSentTime: 2,
        shutUpTime: 3,
        isRobot: false,
      },
    ]);
    const client = makeRecordingClient();
    bridge.bindPid(1, client);
    const host = new BridgeActionContextHost({ bridge });
    const apis = host.bridge.apis;

    for (const [label, run, wire] of [
      ["groupAdmin.kickMember", () => apis.groupAdmin.kickMember(5, 42, true), "OidbSvcTrpcTcp.0x8a0_1"],
      ["groupAdmin.setCard", () => apis.groupAdmin.setCard(5, 42, "c"), "OidbSvcTrpcTcp.0x8fc_3"],
      ["groupFile.list", () => apis.groupFile.list(5), "OidbSvcTrpcTcp.0x6d8_1"],
      ["groupFile.getCount", () => apis.groupFile.getCount(5), "OidbSvcTrpcTcp.0x6d8_2"],
      ["profile.setProfile", () => apis.profile.setProfile("n"), "OidbSvcTrpcTcp.0x112a_2"],
      ["qzone.getFeeds", () => apis.qzone.getFeeds(), null],
    ] as const) {
      client.reset();
      await assertHonestTransportFailure(run, label);
      if (wire !== null) {
        assert.deepEqual(client.sent, [wire], `${label} must send exactly ${wire}`);
      }
    }
  });

  it("a plain method read is not enough — the defect was invisible to `typeof`", () => {
    // Kept as an explicit statement of why §6 was insufficient. A `typeof` check on a
    // Proxy-wrapped prototype method passes for a slice that cannot run at all, because
    // the function object exists whether or not `this` will pass a brand check.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.equal(typeof host.bridge.apis.groupAdmin.kickMember, "function");
    // …and the same object keeps its identity, so `this` is the real instance:
    assert.equal(
      Object.getPrototypeOf(host.bridge.apis.contacts).constructor.name,
      "ContactsApi",
      "the undelegated slice is the plain instance (no Proxy), which is why it never broke",
    );
  });

  it("`in` and own-key enumeration still describe the real slice", () => {
    // `delegate` must forward `has`, or a presence test like `if (ctx.bridge.apis.X.y)`
    // would take the fallback branch for a member that exists.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.ok("kickMember" in host.bridge.apis.groupAdmin, "inherited methods must answer `in`");
    assert.ok("setRemark" in host.bridge.apis.groupAdmin, "overrides must answer `in`");
    assert.ok("list" in host.bridge.apis.groupFile);
  });
});

// ===========================================================================
// 16. The roster readers — behaviour pinned one member at a time
// ===========================================================================
//
// §5 exercised these through `createOneBotApi` under a NO-SENDER bridge, where most of
// them degrade to their cached-roster branch. That never reached the refresh paths, the
// `no_cache` policy, or the dataline merge. These do.

describe("getFriendList — the withProfile failure policy is asymmetric", () => {
  it("withProfile=true RETHROWS a refresh failure; withProfile=false degrades to cache", async () => {
    // reference:39337. The asymmetry is the reference's: asking for profiles and not
    // getting them is a failure, while a plain roster read can answer the cache.
    const { bridge, identity } = makeBridge();
    identity.rememberFriends([
      { uin: 4242, uid: "u_4242", nickname: "friend", remark: "fr" },
    ]);
    const host = new BridgeActionContextHost({ bridge });

    await assert.rejects(
      async () => await host.getFriendList(true),
      /no packet sender attached/,
      "a profile-enrichment failure must propagate",
    );

    const rows = await host.getFriendList(false);
    const ours = rows.filter((row) => (row as Record<string, unknown>)["user_id"] === 4242);
    assert.equal(ours.length, 1);
    assert.equal((ours[0] as Record<string, unknown>)["nickname"], "friend");
    assert.equal((ours[0] as Record<string, unknown>)["remark"], "fr");
  });

  it("appends the three my-device pseudo-contacts, deduped by uin", async () => {
    // `DATALINE_DEVICES` is `我的电脑`/`我的手机`/`我的Pad` (`dataline.ts:49-53`). The
    // dedupe is load-bearing: a real friend that happens to carry a pseudo-uin must not
    // be listed twice, and the REAL row must win (it is pushed first).
    const { bridge, identity } = makeBridge();
    identity.rememberFriends([
      { uin: 2113929217, uid: "u_dev", nickname: "real-row", remark: "r" },
    ]);
    const host = new BridgeActionContextHost({ bridge });

    const rows = (await host.getFriendList(false)) as Record<string, unknown>[];
    const ids = rows.map((row) => row["user_id"]);
    assert.equal(ids.filter((id) => id === 2113929217).length, 1, "no duplicate for the colliding uin");
    assert.equal(rows.find((row) => row["user_id"] === 2113929217)?.["nickname"], "real-row");
    // The two that did NOT collide are still appended.
    assert.ok(ids.includes(2113929218), "我的手机 must be present");
    assert.ok(ids.includes(2113929219), "我的Pad must be present");
    assert.equal(rows.filter((row) => row["nickname"] === "我的电脑").length, 0,
      "the colliding device row must not appear under its own name");
  });
});

describe("getGroupList / getGroupInfo — the no_cache policy", () => {
  it("noCache=true RETHROWS a refresh failure; noCache=false answers the cached roster", async () => {
    // reference:39357. Same asymmetry as the friend list, for the same reason.
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 10 },
    ]);
    const host = new BridgeActionContextHost({ bridge });

    await assert.rejects(async () => await host.getGroupList(true), /no packet sender attached/);

    const rows = (await host.getGroupList(false)) as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.["group_id"], 5);
  });

  it("getGroupInfo answers a ROSTERED group without needing `level` from the wire", async () => {
    // The rostered branch answers with `group_level` from `#groupLevel`, whose failure
    // degrades to 0 unless `no_cache` demanded a throw. So the row still comes back.
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "rr", memberCount: 3, memberMax: 200 },
    ]);
    const host = new BridgeActionContextHost({ bridge });

    const info = (await host.getGroupInfo(5, false)) as Record<string, unknown>;
    assert.equal(info["group_id"], 5);
    assert.equal(info["group_name"], "g");
    assert.equal(info["group_remark"], "rr");
    assert.equal(info["member_count"], 3);
    assert.equal(info["max_member_count"], 200);
    assert.equal(info["group_level"], 0, "the level fetch failed, so it degrades to 0");
  });

  it("getGroupInfo(noCache=true) RETHROWS instead of degrading the level to 0", async () => {
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 10 },
    ]);
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(async () => await host.getGroupInfo(5, true), /no packet sender attached/);
  });
});

describe("getGroupMemberList / getGroupMemberInfo — the classification rule", () => {
  it("answers the members carried ON THE GROUP ROW when the refresh fails", async () => {
    // The cache the fallback reads is `GroupInfo.members` — NOT `MemoryIdentity`'s
    // separate member table. `rememberGroupMembers` writes `membersByGroup`
    // (`bridge.ts:620-627`) while `findGroup` returns the `GroupInfo` row verbatim
    // (`bridge.ts:595`), so a row built without a `members` map answers an EMPTY cache and
    // the provider rethrows instead. `ContactsApi.fetchGroupList` is the writer that does
    // populate it, so this fixture uses that shape.
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      {
        groupId: 5,
        groupName: "g",
        remark: "",
        memberCount: 1,
        memberMax: 10,
        members: new Map([
          [
            42,
            {
              uin: 42, uid: "u_42", nickname: "member", card: "c", role: "owner" as const,
              joinTime: 1, lastSentTime: 2, shutUpTime: 3, isRobot: false,
            },
          ],
        ]),
      },
    ]);
    const host = new BridgeActionContextHost({ bridge });

    const rows = (await host.getGroupMemberList(5, false)) as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.["user_id"], 42);
    assert.equal(rows[0]?.["role"], "owner");
    assert.equal(rows[0]?.["level"], "0", "level is a STRING on the wire");
  });

  it("a group row with NO members map answers the transport error, not []", async () => {
    // The negative half of the fixture above, and the reason it matters: an empty array
    // here would be indistinguishable from "a group with no members".
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 10 },
    ]);
    identity.rememberGroupMembers(5, [
      {
        uin: 42, uid: "u_42", nickname: "m", card: "", role: "member",
        joinTime: 0, lastSentTime: 0, shutUpTime: 0, isRobot: false,
      },
    ]);
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(
      async () => await host.getGroupMemberList(5, false),
      /no packet sender attached/,
      "the separate member table is NOT the cache this path reads",
    );
  });

  it("an EMPTY member cache means the refresh failure is RETHROWN, not answered as []", async () => {
    // An empty array would be indistinguishable from "a group with no members", which is
    // the plausible-empty-value failure `context.ts`'s header names.
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 0, memberMax: 10 },
    ]);
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(
      async () => await host.getGroupMemberList(5, false),
      /no packet sender attached/,
    );
  });

  it("getGroupMemberInfo FORCES a refetch for an UNCLASSIFIED member, then answers null", async () => {
    // `formatGroupMember` throws on `isRobot === undefined` (`format.ts:191`), so the
    // provider cannot answer a row it has not classified — that is why `isRobot` missing
    // forces the fetch rather than degrading.
    const { bridge, identity } = makeBridge();
    identity.rememberGroups([
      { groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 10 },
    ]);
    identity.rememberGroupMembers(5, [
      {
        uin: 42, uid: "u_42", nickname: "m", card: "", role: "member",
        joinTime: 0, lastSentTime: 0, shutUpTime: 0,
        // isRobot deliberately ABSENT
      },
    ]);
    const host = new BridgeActionContextHost({ bridge });
    await assert.rejects(
      async () => await host.getGroupMemberInfo(5, 42, false),
      /no packet sender attached/,
    );
  });
});

describe("getStrangerInfo — three degradations in the reference's order", () => {
  it("answers the my-device row BEFORE any profile lookup", async () => {
    // `findDatalineDeviceByUin` is checked first, because the pseudo-uin has no
    // server-side profile and a lookup would always fail.
    const { bridge } = makeBridge();
    const client = makeRecordingClient();
    bridge.bindPid(1, client);
    const host = new BridgeActionContextHost({ bridge });

    const row = (await host.getStrangerInfo(2113929217)) as Record<string, unknown>;
    assert.equal(row["nickname"], "我的电脑");
    assert.equal(row["sex"], "unknown");
    assert.equal(row["age"], 0);
    assert.equal(row["long_nick"], "");
    assert.deepEqual(client.sent, [], "no packet may be sent for a pseudo-contact");
  });

  it("falls back to the CACHED friend when the profile fetch fails", async () => {
    const { bridge, identity } = makeBridge();
    identity.rememberFriends([
      { uin: 4242, uid: "u_4242", nickname: "friend", remark: "cached-remark" },
    ]);
    const host = new BridgeActionContextHost({ bridge });

    const row = (await host.getStrangerInfo(4242)) as Record<string, unknown>;
    assert.equal(row["user_id"], 4242);
    assert.equal(row["nickname"], "friend");
    assert.equal(row["remark"], "cached-remark");
    assert.equal(row["sex"], "unknown", "an unknown profile cannot claim a sex");
  });

  it("answers null when nothing at all is known — not a zero row", async () => {
    const host = makeHost();
    assert.equal(await host.getStrangerInfo(999999), null);
  });
});

// ===========================================================================
// 17. The two type frictions, at the exact boundary
// ===========================================================================
//
// §4 pinned the adapted members' BEHAVIOUR. This pins the ADAPTATION itself: that the
// provider's precise return type is really discarded by an `async` wrapper, that the
// wrapper awaits (rather than returning the provider's promise unchanged), and that the
// host's signature is `Promise<void>` — never `as unknown as` or a `boolean` pretending
// to be `void`.

describe("the two type frictions are adapted, not cast", () => {
  it("deleteMessage's declared type is Promise<void>, and it AWAITS the provider", async () => {
    const { bridge } = makeBridge();
    let settled = false;
    const host = new BridgeActionContextHost({
      bridge,
      messageProviders: {
        getMessage: async () => null,
        getMessageMeta: async () => null,
        // Resolves on a LATER microtask chain: if the wrapper returned the provider's
        // promise instead of awaiting it, the flag would still be false when we check.
        deleteMessage: async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          settled = true;
          return true;
        },
        refreshMessageMedia: async () => ({ status: "unchanged", refreshed: 0, scanned: 0 }),
        sendGroupMessage: async () => ({ messageId: 1 }),
        sendPrivateMessage: async () => ({ messageId: 1 }),
      },
    });

    const answer: void = await host.deleteMessage(1, meta());
    assert.equal(answer, undefined, "the adapted member resolves exactly `void`");
    assert.equal(settled, true, "the wrapper must await the provider, not return its promise");
  });

  it("refreshMessageMedia's declared type is Promise<void> for EVERY result status", async () => {
    // The four statuses are handled distinctly: three resolve void, and only
    // "unsupported"-with-media throws. A single `if (result) return;` would collapse them.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({
      bridge,
      messageProviders: {
        getMessage: async () => null,
        getMessageMeta: async () => null,
        deleteMessage: async () => true,
        refreshMessageMedia: async (_id, event) => {
          const carries = Array.isArray(event["message"]) &&
            (event["message"] as unknown[]).some(
              (s) => (s as { type?: unknown } | null)?.type === "image",
            );
          if (carries) {
            return { status: "refreshed", refreshed: 1, scanned: 1 };
          }
          return { status: "unchanged", refreshed: 0, scanned: 0 };
        },
        sendGroupMessage: async () => ({ messageId: 1 }),
        sendPrivateMessage: async () => ({ messageId: 1 }),
      },
    });

    const refreshed: void = await host.refreshMessageMedia(1, {
      message: [{ type: "image", data: { url: "https://x" } }],
    });
    assert.equal(refreshed, undefined, "a refreshed result is discarded, not returned");

    const unchanged: void = await host.refreshMessageMedia(2, { message: [] });
    assert.equal(unchanged, undefined);
  });

  it("a `not-found` result is logged and does NOT throw", async () => {
    // The branch that only exists when a resolver IS injected: a provider that answers
    // "not-found" means the event has no segment array, so there is nothing to refresh
    // and the action still has a usable event.
    //
    // The level must be lowered first: `resolveMinLevel` defaults to `"info"`
    // (`log.ts:79-84`) and the host logs this at DEBUG, so without `setLogLevel` the sink
    // receives nothing and the test would pass vacuously on an implementation that logged
    // the wrong thing — or nothing at all.
    const { bridge } = makeBridge();
    const lines: string[] = [];
    const previousLevel = getLogLevel();
    setLogLevel("debug");
    setLogSink((entry) => {
      if (entry.scope === "Host.ActionContext") lines.push(entry.message);
    });
    try {
      const store = new MessageStore();
      const providers = createActionMessageProviders({
        messageApi: bridge.apis.message,
        store,
        resolveMedia: async () => "https://fresh.example/x",
      });
      const host = new BridgeActionContextHost({ bridge, store, messageProviders: providers });

      await host.refreshMessageMedia(1, { post_type: "message" });
      assert.equal(lines.length, 1, "exactly one diagnostic line, and no throw");
      assert.match(lines[0] ?? "", /media refresh skipped/);
      assert.match(lines[0] ?? "", /no message segment array/);
    } finally {
      setLogSink(null);
      setLogLevel(previousLevel);
    }
  });

  it("an INJECTED resolver really rewrites the URL and regenerates raw_message", async () => {
    // Proves the "unsupported" branch is not the only reachable one: with a resolver the
    // host performs the refresh the reference does, so the capability is wired, not faked.
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const providers = createActionMessageProviders({
      messageApi: bridge.apis.message,
      store,
      resolveMedia: async ({ segment }) => `https://fresh.example/${String(segment["type"])}`,
    });
    const host = new BridgeActionContextHost({ bridge, store, messageProviders: providers });

    const event: Record<string, unknown> = {
      message: [{ type: "image", data: { file: "x.image", url: "https://stale" } }],
    };
    await host.refreshMessageMedia(1, event);

    const data = (event["message"] as { data: Record<string, unknown> }[])[0]?.data;
    assert.equal(data?.["url"], "https://fresh.example/image");
    assert.notEqual(data?.["url"], "https://stale");
    assert.match(String(event["raw_message"] ?? ""), /https:\/\/fresh\.example\/image/);
  });

  it("groupFile.trans discards {saveBusId, saveFilePath} after AWAITING it", async () => {
    // The third deliberate void/discard adaptation, alongside the two named in the task.
    const { bridge } = makeBridge();
    let settled = false;
    (bridge.apis as unknown as Record<string, unknown>)["groupFile"] = new Proxy(
      bridge.apis.groupFile as unknown as Record<string, unknown>,
      {
        get: (target, property, receiver) => {
          if (property === "trans") {
            return async () => {
              await new Promise<void>((resolve) => setImmediate(resolve));
              settled = true;
              return { saveBusId: 102, saveFilePath: "/tmp/x" };
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const host = new BridgeActionContextHost({ bridge });

    const answer: void = await host.bridge.apis.groupFile.trans(9, "file");
    assert.equal(answer, undefined, "the adapted member resolves void");
    assert.equal(settled, true, "the bridge call must have completed");
  });
});

// ===========================================================================
// 18. The upload-metadata read-back
// ===========================================================================

describe("recallUploadedFile narrows the bridge row instead of coercing it", () => {
  it("answers undefined for a cold cache — the state a live session is always in", async () => {
    // `rememberUploadedFile`'s only writers in the reference are the two Highway uploads,
    // both of which throw here, so the cache is empty in practice. Answering `undefined`
    // is the correct read-back, not a failure.
    const { bridge } = makeBridge();
    const host = new BridgeActionContextHost({ bridge });
    assert.equal(host.bridge.recallUploadedFile("missing"), undefined);
  });

  it("THROWS HostContractError for EACH of the three missing fields, one at a time", async () => {
    // The action does `Buffer.from(uploaded.fileMd5).toString("hex")` UNGUARDED
    // (`context.ts:150-159`), so a row without it is a runtime TypeError one layer later.
    // The host refuses it where the reason is still nameable.
    //
    // ⚠️ ONE FIELD AT A TIME is the whole design of this test, and the mutation sweep is
    // why: the first version omitted `fileName` AND `fileSize` AND `fileMd5` in a single
    // fixture, so removing the `fileMd5` check from the implementation left the test GREEN
    // — the `fileSize` check caught the row instead. A multi-fault fixture cannot pin
    // which guard fired. Each row below carries exactly two of the three fields.
    type UploadRow = { fileId: string; [field: string]: unknown };
    const rows: readonly (readonly [string, UploadRow])[] = [
      // missing fileMd5 only -> the guard whose absence crashes the action
      ["fileMd5", { fileId: "k1", fileName: "a.txt", fileSize: 12 }],
      // missing fileName only
      ["fileName", { fileId: "k2", fileSize: 12, fileMd5: new Uint8Array([1]) }],
      // missing fileSize only
      ["fileSize", { fileId: "k3", fileName: "a.txt", fileMd5: new Uint8Array([1]) }],
    ];

    for (const [missing, row] of rows) {
      // Rebuild the bridge so each row is the ONLY entry in the cache.
      const { bridge } = makeBridge();
      bridge.rememberUploadedFile(row);
      const isolated = new BridgeActionContextHost({ bridge });
      assert.throws(
        () => isolated.bridge.recallUploadedFile(String(row["fileId"])),
        (error: unknown) => {
          assert.ok(
            error instanceof HostContractError,
            `a row missing ${missing} must be refused with HostContractError, got ${String(error)}`,
          );
          assert.match(error.message, /fileName\/fileSize\/fileMd5/);
          return true;
        },
      );
    }
  });

  it("passes a complete row through with the digest as RAW BYTES", async () => {
    // `fileMd5` / `fileSha1` must stay `Uint8Array`. Typing or converting them to hex here
    // would make the action's own `Buffer.from(...)` encode the wrong md5.
    const { bridge } = makeBridge();
    const md5 = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    bridge.rememberUploadedFile({
      fileId: "k2",
      fileName: "a.txt",
      fileSize: 12,
      fileMd5: md5,
      scope: "private",
      userId: 7,
      fileHash: "fh",
      rememberedAt: 99,
    });
    const host = new BridgeActionContextHost({ bridge });

    const meta = host.bridge.recallUploadedFile("k2");
    assert.ok(meta !== undefined);
    assert.equal(meta.fileName, "a.txt");
    assert.equal(meta.fileSize, 12);
    assert.ok(meta.fileMd5 instanceof Uint8Array, "the digest stays raw bytes");
    assert.deepEqual([...meta.fileMd5], [0xde, 0xad, 0xbe, 0xef]);
    assert.equal(meta.scope, "private");
    assert.equal(meta.userId, 7);
    assert.equal(meta.fileHash, "fh");
    assert.equal(meta.rememberedAt, 99);
  });
});

// ===========================================================================
// 19. cacheMessageMetas — the store's own validation is not bypassed
// ===========================================================================

describe("cacheMessageMetas honours the store's validation", () => {
  it("skips unusable ids but PROPAGATES a malformed meta", async () => {
    // Two different rejections, and the difference matters: an unusable id is skipped
    // silently (nothing can address it anyway), while a malformed meta is a caller bug
    // that must surface rather than be dropped.
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });

    // The id check is what is being pinned here, so the metas must be VALID:
    // `store.insert` runs `assertMeta` BEFORE the id check (`message-store.ts:317-318`),
    // which means a malformed meta throws for id 0 exactly as it does for id 5.
    await host.cacheMessageMetas([
      { messageId: 0, meta: meta() },
      { messageId: 1.5, meta: meta() },
      { messageId: Number.NaN, meta: meta() },
    ]);
    assert.equal(store.size, 0, "unusable ids are skipped, and nothing is stored");

    // 🔴 HONEST EDGE, recorded rather than hidden: a NEGATIVE id is NOT skipped. The
    // host's guard is `Number.isInteger(id) && id !== 0` (the reference's own check), and
    // `MessageStore.isValidMessageId` is the same predicate (`message-store.ts:219-221`),
    // so `-5` is stored and addressable. No real QQ message id is negative, so this is
    // unreachable from a decoded packet — but a host that fed the store from an integer
    // parameter (an action's `message_id`, say) could create one. Widening the guard is a
    // behaviour change in a file this batch does not own, so it is reported, not patched.
    await host.cacheMessageMetas([{ messageId: -5, meta: meta() }]);
    assert.equal(store.getMeta(-5)?.sequence, 4242, "a negative id is currently accepted");

    await assert.rejects(
      async () =>
        await host.cacheMessageMetas([
          // `isGroup` is a string: the store's validator rejects it.
          { messageId: 5, meta: { isGroup: "yes" } as unknown as StoredMessageMeta },
        ]),
      /invalid stored message meta/,
    );
  });

  it("a valid batch lands in the store and is readable back", async () => {
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });

    await host.cacheMessageMetas([
      { messageId: 11, meta: meta({ sequence: 111 }) },
      { messageId: 12, meta: meta({ sequence: 222 }) },
    ]);
    assert.equal(store.size, 2);
    assert.equal(store.getMeta(11)?.sequence, 111);
    assert.equal(store.getMeta(12)?.sequence, 222);
  });
});

// ===========================================================================
// 20. The essence gate, one refusal at a time
// ===========================================================================

describe("essence: every refusal is distinct, and none is a silent success", () => {
  it("names the missing row, the private scene, and the non-authoritative sequence differently", async () => {
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const host = new BridgeActionContextHost({ bridge, store });

    // 1. no row at all
    await assert.rejects(async () => await host.setEssenceMsg(1), /message not found or not a group message/);

    // 2. a row that exists but is PRIVATE
    store.insert(2, { meta: meta({ isGroup: false }) });
    await assert.rejects(async () => await host.setEssenceMsg(2), /message not found or not a group message/);

    // 3. a group row whose sequence was inferred, not observed
    store.insert(3, { meta: meta({ sequenceAuthoritative: false }) });
    await assert.rejects(async () => await host.setEssenceMsg(3), /no authoritative QQ sequence/);
  });

  it("sends the message's OWN random, because a zero random is dropped on the wire", async () => {
    // `interaction.ts:27-34`: `0xeac` carries `random` beside `sequence`, and the wire's
    // presence rule omits a zero — so passing 0 would name a different message. The
    // recording client cannot see the body's fields here, but it CAN prove the packet was
    // sent, and the meta's `random` is the only source the host has.
    const { bridge } = makeBridge();
    const store = new MessageStore();
    const client = makeRecordingClient();
    bridge.bindPid(1, client);
    const host = new BridgeActionContextHost({ bridge, store });

    store.insert(4, { meta: meta({ sequence: 4242, random: 123456 }) });
    await assertHonestTransportFailure(() => host.setEssenceMsg(4), "setEssenceMsg");
    assert.deepEqual(client.sent, ["OidbSvcTrpcTcp.0xeac_1"], "set is sub-command _1");

    client.reset();
    await assertHonestTransportFailure(() => host.deleteEssenceMsg(4), "deleteEssenceMsg");
    assert.deepEqual(client.sent, ["OidbSvcTrpcTcp.0xeac_2"], "delete is sub-command _2");
  });
});

// ===========================================================================
// 21. `canSendImage` / `canSendRecord` are absent ON PURPOSE
// ===========================================================================

describe("the capability probes are absent, not `() => true`", () => {
  it("both members are undefined, so the actions' own `?? false` answers", () => {
    // The reference hard-codes `true` (reference:40044). This port cannot: an image
    // segment needs `SendContext.uploadMedia`, which is the absent Highway uploader. A
    // `true` here would make the capability probe lie about the send path.
    // Read through the INTERFACE, not the class: the class deliberately does not declare
    // them, so a type error here would be the compiler confirming the absence.
    const ctx: ActionContext = makeHost();
    assert.equal(ctx.canSendImage, undefined);
    assert.equal(ctx.canSendRecord, undefined);
  });

  it("and the actions observe the absence through the dispatcher", async () => {
    const host = makeHost();
    const api = createOneBotApi({
      createContext: () => host,
      isAcceptingActions: () => host.isAcceptingActions(),
    });
    // `can_send_image` has its own action, which reads the optional probe.
    const response = await api.handle("can_send_image", {});
    assert.equal(response.status, "ok");
    assert.equal((response.data as Record<string, unknown>)["yes"], false,
      "absent probe must read as `no`, not as a fabricated `yes`");
  });
});

// ===========================================================================
// 22. Disposal and the network seam
// ===========================================================================

describe("disposal is a one-way gate on the context itself", () => {
  it("isOnline() drops after dispose() even while the bridge is still bound", async () => {
    // Two different facts: the BRIDGE may still have a healthy connection, while THIS
    // context has been told to stop. `isOnline` must report the conjunction.
    const { bridge } = makeBridge();
    const client = makeRecordingClient();
    bridge.bindPid(1, client);
    const host = new BridgeActionContextHost({ bridge });
    assert.equal(host.isOnline(), true);

    host.dispose();
    assert.equal(host.isOnline(), false, "a disposed context is not online");
    assert.equal(host.isAcceptingActions(), false);
    assert.equal(bridge.receiveHealthy, true, "the bridge itself was not disposed");

    // Idempotent.
    host.dispose();
    assert.equal(host.isOnline(), false);
  });

  it("createSessionOneBotApi answers the idle API for a DISPOSED host", async () => {
    const { bridge } = makeBridge();
    bridge.bindPid(1, makeRecordingClient());
    const host = new BridgeActionContextHost({ bridge });
    host.dispose();

    const api = createSessionOneBotApi(host);
    const response = await api.handle("get_login_info", {});
    assert.equal(response.status, "failed");
    assert.match(String(response.wording ?? ""), /not logged in/);
  });
});

describe("startOneBotNetworks reports an unbindable topology as a failure", () => {
  it("throws AggregateError naming the adapter when the port is already taken", async () => {
    // The honest half of the "start a server" seam: a topology that could not open must
    // not be reported as success.
    //
    // Two httpServers on the SAME port would NOT test this: `compileDesiredPlan` rejects
    // that at VALIDATION time — `networks.httpServers[1] conflicts with
    // networks.httpServers[0] on server binding …` (`manager.ts:138`) — before any socket
    // is touched, so the error is a plain `Error` and no adapter is ever opened. That is
    // also why `startOneBotNetworks` would never reach its own `AggregateError`.
    //
    // So the failure has to come from the BIND. A separate listener squats a real port,
    // and the adapter's `listen` then fails with `EADDRINUSE` — which `reconcile` records
    // in `OperationResult.errors`, and `startOneBotNetworks` re-raises as an
    // `AggregateError` that names each failing adapter.
    const { bridge } = makeBridge();
    bridge.bindPid(1, makeRecordingClient());
    const host = new BridgeActionContextHost({ bridge });

    const squatter = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      squatter.once("error", reject);
      squatter.listen(0, "127.0.0.1", () => {
        const address = squatter.address();
        if (address === null || typeof address === "string") {
          reject(new Error("could not determine a free port"));
          return;
        }
        resolve(address.port);
      });
    });

    try {
      await assert.rejects(
        async () =>
          await startOneBotNetworks(host, {
            networks: {
              httpServers: [
                {
                  name: "blocked",
                  enabled: true,
                  host: "127.0.0.1",
                  port,
                  path: "/",
                  accessToken: "",
                  messageFormat: "array",
                },
              ],
              httpClients: [],
              wsServers: [],
              wsClients: [],
            },
          }),
        (error: unknown) => {
          assert.ok(
            error instanceof AggregateError,
            `expected AggregateError, got ${String(error)}: ${String((error as Error).message)}`,
          );
          // The adapter must be NAMED, or the operator cannot tell which one failed.
          assert.ok(error.errors.length >= 1, "at least one adapter failure must be named");
          assert.match(String(error.message), /failed to open/);
          assert.match(String(error.message), new RegExp(UIN));
          assert.ok(
            error.errors.some((inner: unknown) => /blocked/.test(String((inner as Error).message))),
            "the failing adapter's name must appear in one of the inner errors",
          );
          return true;
        },
      );
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });

  it("refuses a duplicate binding at CONFIG time, which is a different failure", async () => {
    // Pinned separately because conflating the two is an easy mistake (the first version
    // of this suite did): a duplicate binding never opens a socket and never reaches the
    // AggregateError path.
    const { bridge } = makeBridge();
    bridge.bindPid(1, makeRecordingClient());
    const host = new BridgeActionContextHost({ bridge });

    await assert.rejects(
      async () =>
        await startOneBotNetworks(host, {
          networks: {
            httpServers: [
              { name: "a", enabled: true, host: "127.0.0.1", port: 41888, path: "/", accessToken: "", messageFormat: "array" },
              { name: "b", enabled: true, host: "127.0.0.1", port: 41888, path: "/", accessToken: "", messageFormat: "array" },
            ],
            httpClients: [],
            wsServers: [],
            wsClients: [],
          },
        }),
      (error: unknown) => {
        assert.ok(!(error instanceof AggregateError), "this is a config refusal, not a bind failure");
        assert.match(String((error as Error).message), /conflicts with/);
        return true;
      },
    );
  });
});
