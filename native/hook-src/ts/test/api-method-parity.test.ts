// ===========================================================================
// api-method-parity — the forwarders that were missing under existing specs
// ===========================================================================
//
// WHY THIS FILE EXISTS
//
// A method-level audit against the reference found eight `*Api` methods that did not
// exist. Five of them had their `OidbSpec` ported and tested already, so nothing failed
// until an action called them: the OneBot layer then answered either
//
//     TypeError: ctx.bridge.apis.misc.ocrImage is not a function      (crash)
//     "at-all remain is unavailable"                                  (silent lie)
//
// depending on whether the action guarded the call. Both are invisible to a suite that
// only tests the specs, and `EXTENDED_ACTION_STATE` said `"live"` for all of them.
//
// These tests therefore assert the FORWARDER, not the protocol: each one proves the call
// reaches the packet transport rather than dying before it. A "no packet sender attached"
// failure is the SUCCESS signal here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { encodeGroupAvatarExtra } from "../src/bridge/apis/profile.js";

const SELF_UIN = 10001;
const GROUP_ID = 123456;

/** A bridge with no packet client — every network call fails at the transport. */
function bareBridge(): Bridge {
  return new Bridge(new MemoryIdentity(String(SELF_UIN), "bot"));
}

/**
 * Call `run` and report whether it got there.
 *
 * Returns the thrown message (or the response wording) so a failure names itself. The
 * assertion is on the TRANSPORT marker: a `TypeError` means the forwarder is missing, and
 * any other error means it is present and something downstream rejected the input.
 */
async function reachedTransport(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = (await run()) as { wording?: string } | undefined;
    return String(result?.wording ?? "");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function assertForwarderPresent(message: string, who: string): void {
  assert.equal(
    /is not a function/.test(message),
    false,
    `${who} must exist as a method, got: ${message}`,
  );
}

// ---------------------------------------------------------------------------
// MiscApi — five forwarders, all over specs that already existed
// ---------------------------------------------------------------------------

test("MiscApi.ocrImage reaches ImageOcr (0xeb7_12)", async () => {
  const message = await reachedTransport(() =>
    bareBridge().apis.misc.ocrImage("https://example.com/a.png"),
  );
  assertForwarderPresent(message, "MiscApi.ocrImage");
  assert.match(message, /no packet sender attached/);
});

test("MiscApi.sendGroupSign supplies selfUin, which the request requires", async () => {
  // `SendGroupSignParams.selfUin` is REQUIRED and the public signature takes only the
  // group, so the identity has to be read inside. Omitting it would throw a type error at
  // build time, but a wrong value (e.g. 0) would silently sign for uin 0.
  const message = await reachedTransport(() => bareBridge().apis.misc.sendGroupSign(GROUP_ID));
  assertForwarderPresent(message, "MiscApi.sendGroupSign");
  assert.match(message, /no packet sender attached/);
});

test("MiscApi.translateEn2Zh accepts a readonly list without mutating it", async () => {
  const words = Object.freeze(["hello", "world"]) as readonly string[];
  const message = await reachedTransport(() => bareBridge().apis.misc.translateEn2Zh(words));
  assertForwarderPresent(message, "MiscApi.translateEn2Zh");
  assert.match(message, /no packet sender attached/);
  assert.deepEqual([...words], ["hello", "world"]);
});

test("MiscApi.clickInlineKeyboardButton forwards all five positional fields", async () => {
  const message = await reachedTransport(() =>
    bareBridge().apis.misc.clickInlineKeyboardButton(GROUP_ID, 1, "btn", "cb", 9),
  );
  assertForwarderPresent(message, "MiscApi.clickInlineKeyboardButton");
  assert.match(message, /no packet sender attached/);
});

test("MiscApi.getDecryptKey reports a TRANSPORT failure as a failure, never a key", async () => {
  // The contract has two failure modes and the reference distinguishes them. With no
  // transport the wrapped `requestDbKeyResult` must answer `success: false`, which this
  // method turns into a throw — a returned string here would be a fabricated key.
  const message = await reachedTransport(() => bareBridge().apis.misc.getDecryptKey("salt"));
  assertForwarderPresent(message, "MiscApi.getDecryptKey");
  assert.doesNotMatch(message, /^[0-9a-f]+$/i, "must not answer a key-shaped value");
});

// ---------------------------------------------------------------------------
// GroupAdminApi / ProfileApi
// ---------------------------------------------------------------------------

test("GroupAdminApi.getAtAllRemain supplies selfUin and reaches 0x8a7", async () => {
  const message = await reachedTransport(() =>
    bareBridge().apis.groupAdmin.getAtAllRemain(GROUP_ID),
  );
  assertForwarderPresent(message, "GroupAdminApi.getAtAllRemain");
  assert.match(message, /no packet sender attached/);
});

test("GroupAdminApi.setRemark reaches 0xf16", async () => {
  const message = await reachedTransport(() =>
    bareBridge().apis.groupAdmin.setRemark(GROUP_ID, "remark"),
  );
  assertForwarderPresent(message, "GroupAdminApi.setRemark");
  assert.match(message, /no packet sender attached/);
});

test("GroupAdminApi.fetchGroupPrivilegeFlag is derived from the state read", async () => {
  // One `FetchGroupDetail` answers both the flag and the owner uid; asking twice could
  // straddle a change. The flag accessor must therefore go through the state read.
  const message = await reachedTransport(() =>
    bareBridge().apis.groupAdmin.fetchGroupPrivilegeFlag(GROUP_ID, "admin", "before"),
  );
  assertForwarderPresent(message, "GroupAdminApi.fetchGroupPrivilegeFlag");
  assert.match(message, /no packet sender attached/);
});

test("ProfileApi.customFaceUrl assembles the CDN URL with the self uin", () => {
  const url = bareBridge().apis.profile.customFaceUrl("123_0");
  assert.equal(url, `https://p.qpic.cn/qq_expression/${SELF_UIN}/123_0/0`);
});

test("ProfileApi.dispatchSetStatus reaches the status service", async () => {
  const message = await reachedTransport(() =>
    bareBridge().apis.profile.dispatchSetStatus({
      status: 10,
      extStatus: 0,
      batteryStatus: 0,
    }),
  );
  assertForwarderPresent(message, "ProfileApi.dispatchSetStatus");
  assert.match(message, /no packet sender attached/);
});

// ---------------------------------------------------------------------------
// ContactsApi.sendTuwenArk — the one gap with a live caller
// ---------------------------------------------------------------------------

test("ContactsApi.sendTuwenArk reaches 0xdc2_34 for both peer types", async () => {
  for (const peerType of [0, 1]) {
    const message = await reachedTransport(() =>
      bareBridge().apis.contacts.sendTuwenArk({
        targetId: GROUP_ID,
        peerType,
        title: "t",
        desc: "d",
        summary: "s",
        previewUrl: "https://example.com/p.png",
        jumpUrl: "https://example.com/",
      }),
    );
    assertForwarderPresent(message, `ContactsApi.sendTuwenArk(peerType=${peerType})`);
    assert.match(message, /no packet sender attached/);
  }
});

// ---------------------------------------------------------------------------
// GroupAvatarExtra — hand-encoded, so the bytes are asserted literally
// ---------------------------------------------------------------------------

test("encodeGroupAvatarExtra writes the five fields the reference's writer writes", () => {
  const bytes = encodeGroupAvatarExtra(GROUP_ID);
  // Verified against the reference's own writer (reference:333128-333230):
  //   f1 type=101 (varint, 1 byte)        08 65
  //   f2 groupUin  (varint, 5 bytes here) 10 <varint>
  //   f3 submessage { f1: 1 }             1a 02 08 01
  //   f5 = 3                              28 03
  //   f6 = 1                              30 01
  const expected = Uint8Array.from([
    0x08,
    101,
    0x10,
    ...varint(GROUP_ID),
    0x1a,
    0x02,
    0x08,
    0x01,
    0x28,
    0x03,
    0x30,
    0x01,
  ]);
  assert.deepEqual([...bytes], [...expected]);
});

/** Minimal LEB128, so the expectation above is built independently of the writer. */
function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

// ---------------------------------------------------------------------------
// Satori: advertised features must all be servable
// ---------------------------------------------------------------------------

test("every advertised Satori feature has a handler", async () => {
  // The reference advertises 26 features but serves 24: `message.list.from` and
  // `guild.plain` appear in `SATORI_FEATURES` (reference:343812-343838) with no entry in
  // `SATORI_API` (reference:344176), so a client that trusts the list gets a 404 for both.
  //
  // This port deliberately deviates: it advertises exactly what it serves. The assertion is
  // one-directional on purpose — an EXTRA handler is fine (that is how a future method lands
  // here), but an advertised name without a handler is the bug.
  const { SATORI_API_FOR_TEST } = await import("../src/onebot/network/satori-server-adapter.js");
  const served = new Set(Object.keys(SATORI_API_FOR_TEST));
  // Read the COMPILED file: this test runs from `build/`, where the source tree is not
  // reachable by a relative URL, and the emitted `.js` keeps the array literal verbatim.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/onebot/network/satori-server-adapter.js", import.meta.url), "utf8"),
  );
  const block = /const SATORI_FEATURES = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, "SATORI_FEATURES must be a literal array");
  const listed = block[1] ?? "";
  const advertised = [...listed.matchAll(/"([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));

  assert.ok(advertised.length > 20, `expected a real list, got ${advertised.length}`);
  for (const name of advertised) {
    assert.equal(served.has(name), true, `advertised "${name}" has no handler`);
  }
  assert.equal(advertised.includes("guild.plain"), false, "reference defect: advertised, unserved");
  assert.equal(
    advertised.includes("message.list.from"),
    false,
    "reference defect: advertised, unserved",
  );
});
