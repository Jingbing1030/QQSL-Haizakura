// OIDB batch A — codec tests driven by reference-evaluated fixtures.
//
// ---------------------------------------------------------------------------
// Where the expected bytes come from
// ---------------------------------------------------------------------------
// NOT hand-written.  `test/oidb-batch-a.fixtures.json` is produced by
// `work/oidb-a/goldens.mjs` and `work/oidb-a/goldens-6ff.mjs`, which cut the
// named `//#region` blocks out of `reference/index.mjs` verbatim, import them,
// and then call the reference's own functions:
//
//   requests   reference `spec.serialize(ctx, params)` -> reference `encode`
//   responses  reference `decode(bytes)`               -> reference `deserialize`
//
// Regenerate with:
//     cd work/oidb-a && node build-all.mjs && node goldens.mjs \
//       && node goldens-6ff.mjs && node export-fixtures.mjs
//
// Reading a fixture file rather than inlining the hex is deliberate: the file
// records the *params* alongside the bytes, so a test failure points at the
// input that produced it instead of at an opaque string.
//
// ---------------------------------------------------------------------------
// What these tests are actually guarding
// ---------------------------------------------------------------------------
// The bugs this batch was most likely to contain were all "transcription" bugs:
// a field number nudged by one, a uint64 narrowed to uint32, an int32 read as
// uint32, a skipped field "tidied up", or a presence rule applied to the wrong
// message.  Each is invisible in a round-trip test (encode then decode with the
// same wrong table passes), and visible immediately against reference bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeOidbEnvelope, decodeOidbEnvelope, oidbWireName } from "../src/oidb/envelope.js";
import { ProtoWriter } from "../src/oidb/wire.js";
import {
  // group-file folders (0x6d7)
  CreateGroupFolder,
  DeleteGroupFolder,
  RenameGroupFolder,
  FolderInfoRespField,
  // group-file listing / quota (0x6d8)
  ListGroupFilesPage,
  GetGroupFileCount,
  GetGroupFileSpace,
  GroupFileViewReqField,
  GroupFileCountViewReqField,
  // group-file transfer / publish (0x6d9)
  TransGroupFile,
  PublishGroupFile,
  GroupSendFileReqField,
  // likes (0x7e5_104, 0x7ed_12/_13)
  SendLike,
  GetLike,
  sendLikeParams,
  getLikeParams,
  getLikeSubCommand,
  GET_LIKE_SUB_COMMAND,
  deserializeUserInfo,
  // admin / leave (0x1096_1, 0x1097_1)
  SetGroupAdmin,
  SetGroupLeave,
  setAdminParams,
  // profile / long nick (0x112a_2, two specs) and keyboard (0x112e_1)
  SetProfile,
  SetSelfLongNick,
  hasProfileChanges,
  PROFILE_FIELD_ID,
  ClickInlineKeyboardButton,
  // highway session (HttpConn.0x6ff_501, NOT an OIDB spec)
  HttpConnSession,
  HTTPCONN_SESSION_REQUEST,
  HTTPCONN_SESSION_WIRE_NAME,
  encodeHttpConn0x6FF501Request,
  decodeHttpConn0x6FF501Response,
  httpConnAddrHost,
  toHighwaySession,
} from "../src/oidb/services/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  oidb: Record<string, any>;
  httpconn: Record<string, any>;
}

/**
 * The fixture lives in the *source* tree, not next to the compiled output, so
 * walk up to the package root instead of resolving against `import.meta.url`
 * (`build/test/` has no JSON).  Same locator as `onebot-harness.ts`.
 */
function fixturePath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const here = join(dir, "oidb-batch-a.fixtures.json");
    if (existsSync(here)) return here;
    const inTest = join(dir, "test", "oidb-batch-a.fixtures.json");
    if (existsSync(inTest)) return inTest;
    dir = dirname(dir);
  }
  throw new Error("oidb-batch-a.fixtures.json not found");
}

const FIXTURES: Fixture = JSON.parse(readFileSync(fixturePath(), "utf8"));

const hex = (input: Uint8Array): string => Buffer.from(input).toString("hex");
const bytes = (source: string): Uint8Array => Uint8Array.from(Buffer.from(source, "hex"));

/** Rebuild bigint / Uint8Array values that JSON cannot carry. */
function revive(value: any): any {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    if (typeof value.__bigint === "string") return BigInt(value.__bigint);
    if (typeof value.__bytes === "string") return bytes(value.__bytes);
    // The fixture records a `void` result as a sentinel because JSON has no
    // undefined; unwrap it so a spec that returns nothing compares as nothing.
    if (value.__undefined === true) return undefined;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
}

/** Stable, key-order-insensitive rendering for deep comparison. */
function canon(value: any): string {
  if (value instanceof Uint8Array) return `bytes:${hex(value)}`;
  if (typeof value === "bigint") return `bigint:${value}`;
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The specs under test, by the name the fixtures record. */
const SPECS: Record<string, any> = {
  CreateGroupFolder,
  DeleteGroupFolder,
  RenameGroupFolder,
  ListGroupFilesPage,
  GetGroupFileCount,
  GetGroupFileSpace,
  TransGroupFile,
  PublishGroupFile,
  SendLike,
  GetLike,
  SetGroupAdmin,
  SetGroupLeave,
  SetProfile,
  SetSelfLongNick,
  ClickInlineKeyboardButton,
};

/**
 * Turn a fixture's params into the ctx-free params our specs take.
 *
 * The reference resolves uids (and, for the profile specs, the caller's uin)
 * *inside* `serialize`, from `ctx`.  Our `OidbSpec` has no ctx, so the adapters
 * under test do that work — running the fixtures through them tests the real
 * caller path rather than a shortcut.
 */
async function paramsFor(label: string, record: any): Promise<any> {
  const params = revive(record.params ?? {});
  const ctx = record.ctx ?? {};
  const resolveUid = (id: any) => ctx.uidOf?.[String(id)] ?? `uid-${id}`;
  switch (record.spec) {
    case "SendLike":
      return sendLikeParams(params, resolveUid);
    case "GetLike":
      return getLikeParams(params, {
        selfUin: ctx.uin ?? 0,
        resolveSelfUid: () => ctx.selfUid ?? "self-uid",
        resolveUserUid: resolveUid,
      });
    case "SetGroupAdmin":
      return setAdminParams(params, resolveUid);
    case "SetProfile":
    case "SetSelfLongNick":
      return { ...params, selfUin: ctx.uin ?? 0 };
    default:
      return params;
  }
}

/** Encode a request the way `invokeOidb` does, without a transport. */
function encodeRequest(spec: any, params: any): Uint8Array {
  const body = spec.encodeBody(spec.serialize(params));
  const subCommand = spec.resolveSubCommand ? spec.resolveSubCommand(params) : (spec.subCommand ?? 0);
  return encodeOidbEnvelope({
    command: spec.command,
    subCommand,
    errorCode: 0,
    body,
    errorMsg: "",
    reserved: spec.uinForm ? 1 : 0,
  });
}

/**
 * Decode a response through a spec, the way `invokeOidb` does.
 *
 * The fixtures record the **whole envelope** (the reference's `spec.decode`
 * takes envelope bytes and returns `.body`), so this decodes that directly.
 * Wrapping it in another envelope first — the mistake the sibling test file
 * guards against in the other direction — would land the payload in field 4 of a
 * field-4 body and yield `null` rather than an error.
 */
function decodeEnvelope(spec: any, envelopeHex: string): any {
  const decoded = decodeOidbEnvelope(bytes(envelopeHex), spec.decodeBody);
  return decoded.body ?? {};
}

/** Build a one-field envelope around a bare body, for hand-built micro-fixtures. */
function wrapBody(bodyHex: string): Uint8Array {
  return encodeOidbEnvelope({
    command: 0, subCommand: 0, errorCode: 0, body: bytes(bodyHex), errorMsg: "", reserved: 0,
  });
}

function decodeBody(spec: any, bodyHex: string): any {
  const decoded = decodeOidbEnvelope(wrapBody(bodyHex), spec.decodeBody);
  return decoded.body ?? {};
}

// ---------------------------------------------------------------------------
// Request vectors
// ---------------------------------------------------------------------------

for (const [label, record] of Object.entries(FIXTURES.oidb)) {
  if (record.kind !== "req") continue;
  test(`batch A request: ${label}`, async () => {
    const spec = SPECS[record.spec];
    assert.ok(spec, `no spec named ${record.spec}`);
    const params = await paramsFor(label, record);
    // 0x6d9_4 embeds Math.random(); the fixture was produced with it pinned to
    // 0.5, so pin the same value here (see the explicit test below as well).
    const real = Math.random;
    Math.random = () => 0.5;
    try {
      assert.equal(hex(encodeRequest(spec, params)), record.hex, `${label} bytes`);
    } finally {
      Math.random = real;
    }
  });
}

// The random freshness marker in `_4` is pinned so the vector is reproducible;
// the fixtures record the seeded value, so pin the same value here.
test("batch A request: 0x6d9_4 publish is reproducible with the RNG pinned", () => {
  const record = Object.values(FIXTURES.oidb).find((r: any) => r.spec === "PublishGroupFile" && r.kind === "req");
  assert.ok(record, "publish fixture missing");
  const real = Math.random;
  Math.random = () => 0.5;
  try {
    const encoded = hex(encodeRequest(PublishGroupFile, { groupId: 123456, fileId: "file-1" }));
    assert.equal(encoded, record.hex);
  } finally {
    Math.random = real;
  }
  // And the same bytes must be reachable deterministically via the explicit seam.
  const seeded = hex(encodeRequest(PublishGroupFile, { groupId: 123456, fileId: "file-1", random: 0.5 * 2147483647 }));
  assert.equal(seeded, record.hex);
});

// ---------------------------------------------------------------------------
// Response vectors
// ---------------------------------------------------------------------------

for (const [label, record] of Object.entries(FIXTURES.oidb)) {
  if (record.kind !== "resp") continue;
  const spec = SPECS[record.spec];
  test(`batch A response: ${label}`, () => {
    assert.ok(spec, `no spec named ${record.spec}`);
    const body = decodeEnvelope(spec, record.rawHex);
    const want = canon(revive(record.result));
    try {
      const got = canon(spec.deserialize(body));
      if (record.error) {
        assert.fail(`${label}: expected an error (${record.error}) but deserialize returned ${got}`);
      }
      assert.equal(got, want, `${label} projection`);
    } catch (error: any) {
      assert.ok(record.error, `${label} threw unexpectedly: ${error.message}`);
      assert.equal(error.message, record.error, `${label} error text`);
    }
  });
}

// ---------------------------------------------------------------------------
// Field-number traps, asserted directly
// ---------------------------------------------------------------------------
//
// These are the specific "tidying" edits that would still pass every vector
// above if someone also regenerated the fixtures from their own code. Keeping
// them as explicit assertions means the intent is recorded even when the bytes
// are regenerated.

test("0x6d7 info: modifyUin is field 9, not 7", () => {
  assert.equal(FolderInfoRespField.createUin, 6);
  assert.equal(FolderInfoRespField.modifyUin, 9);
  // The create request skips field 2 entirely.
  assert.equal(encodeRequest(CreateGroupFolder, { groupId: 1, parentId: "/", folderName: "f" }).length > 0, true);
  assert.equal(FolderInfoRespField.folderName, 3);
});

test("0x6d8: the list payload is field 2, and count/space are 3/4", () => {
  assert.equal(GroupFileViewReqField.list, 2);
  assert.equal(GroupFileCountViewReqField.count, 3);
  assert.equal(GroupFileCountViewReqField.space, 4);
});

test("0x6d8: uinForm is true for listing only", () => {
  assert.equal(ListGroupFilesPage.uinForm, true);
  assert.equal(GetGroupFileCount.uinForm, undefined);
  assert.equal(GetGroupFileSpace.uinForm, undefined);
});

test("0x6d9: trans and publish fill different halves of the request", () => {
  assert.equal(GroupSendFileReqField.transFile, 1);
  assert.equal(GroupSendFileReqField.body, 5);
  const trans = TransGroupFile.serialize({ groupId: 1, fileId: "f" }) as any;
  assert.ok(trans.transFile);
  assert.equal(trans.body, undefined, "_0 must not send the publish half");
  const publish = PublishGroupFile.serialize({ groupId: 1, fileId: "f", random: 1 }) as any;
  assert.ok(publish.body);
  assert.equal(publish.transFile, undefined, "_4 must not send the trans half");
});

test("0x6d9: trans reads retCode as int32 so -1 survives", () => {
  const record = Object.values(FIXTURES.oidb).find(
    (r: any) => r.kind === "resp" && r.spec === "TransGroupFile" && r.error,
  );
  assert.ok(record, "negative-retcode fixture missing");
  assert.match(record.error, /code=-1\b/);
});

test("0x7e5: send_like puts the uid in field 11", () => {
  const body = SendLike.serialize({ targetUid: "u1", count: 1 });
  assert.equal(body.sourceId, 71);
  const encoded = hex(SendLike.encodeBody(body));
  // field 11 wire 2 => tag 90 = 0x5a
  assert.match(encoded, /^5a/);
});

test("0x7ed: there is no sub-command 0; the split is 12/13", () => {
  assert.equal(GetLike.subCommand, undefined, "_GetLike sets resolveSubCommand, not subCommand");
  assert.equal(getLikeSubCommand(1000, undefined), GET_LIKE_SUB_COMMAND.self);
  assert.equal(getLikeSubCommand(1000, 0), GET_LIKE_SUB_COMMAND.self);
  assert.equal(getLikeSubCommand(1000, 1000), GET_LIKE_SUB_COMMAND.self, "naming yourself is still self");
  assert.equal(getLikeSubCommand(1000, 2000), GET_LIKE_SUB_COMMAND.other);
  // And the resolved sub-command must match what the fixtures recorded.
  for (const [label, record] of Object.entries(FIXTURES.oidb)) {
    if (record.kind !== "req" || record.spec !== "GetLike") continue;
    const params = revive(record.params);
    assert.equal(
      getLikeSubCommand(record.ctx?.uin ?? 0, params.userId),
      record.subCommand,
      `${label} sub-command`,
    );
  }
});

test("0x7ed: wire flags are uint32 but project to booleans", () => {
  const user = deserializeUserInfo({
    uid: "u", src: 0, latestTime: 0, count: 0, giftCount: 0, customId: 0, lastCharged: 0,
    availableCount: 0, todayVotedCount: 0, nick: "", gender: 0, age: 0,
    isFriend: 1, isVip: 0, isSvip: 1,
  });
  assert.equal(user.isFriend, true);
  assert.equal(user.isvip, false);
  assert.equal(user.isSvip, true);
  assert.equal(user.bAvailableCnt, 0);
});

test("0x1096: revoke drops field 3 instead of writing false", () => {
  const grant = hex(SetGroupAdmin.encodeBody(SetGroupAdmin.serialize({ groupId: 1, uid: "u", enable: true })));
  const revoke = hex(SetGroupAdmin.encodeBody(SetGroupAdmin.serialize({ groupId: 1, uid: "u", enable: false })));
  assert.equal(grant.endsWith("1801"), true, "grant must end with field 3 = true");
  assert.equal(revoke.endsWith("1801"), false, "revoke must not write isAdmin:false");
});

test("0x112a: two different request schemas share one command/sub", () => {
  assert.equal(SetProfile.command, SetSelfLongNick.command);
  assert.equal(SetProfile.subCommand, SetSelfLongNick.subCommand);
  // ...but they encode different messages: the profile body is a repeated item
  // list, the long-nick body a single nested message. Both start with the uin.
  const profile = SetProfile.serialize({ selfUin: 1, nickname: "n" });
  const longNick = SetSelfLongNick.serialize({ selfUin: 1, longNick: "n" });
  assert.ok(Array.isArray(profile.stringProfiles));
  assert.equal(profile.stringProfiles.length, 1);
  assert.equal(profile.stringProfiles[0]!.fieldId, PROFILE_FIELD_ID.nickname);
  assert.equal(longNick.profile.tag, PROFILE_FIELD_ID.longNick);
});

test("0x112a: the three profile selectors are 20002 / 102 / 20009", () => {
  assert.equal(PROFILE_FIELD_ID.nickname, 20002);
  assert.equal(PROFILE_FIELD_ID.personalNote, 102);
  assert.equal(PROFILE_FIELD_ID.sex, 20009);
  assert.equal(hasProfileChanges({ selfUin: 1 }), false);
  assert.equal(hasProfileChanges({ selfUin: 1, sex: 0 }), true, "sex 0 is a real change, not an absence");
});

test("0x112e: request and response both start at field 3", () => {
  const encoded = hex(
    ClickInlineKeyboardButton.encodeBody(
      ClickInlineKeyboardButton.serialize({
        botAppid: 1, msgSeq: 2, buttonId: "b", groupId: 3,
      }),
    ),
  );
  // field 3 wire 0 => tag 24 = 0x18
  assert.match(encoded, /^18/);
  // `result` is field 3 with wire type 0: tag 24 = 0x18, then the value 5.
  // (`180105` would be value 1 followed by a tag of field 0, which protobuf
  // forbids and the reader rejects — a useful reminder that the tag and value
  // are separate varints.)
  const body = decodeBody(ClickInlineKeyboardButton, "1805");
  assert.equal(body.result, 5);
  // A length-delimited field 3 (0x1a) is a *different* tag and must not be read
  // as the result — that mistake silently yields 0.
  assert.equal(decodeBody(ClickInlineKeyboardButton, "1a0105").result, 0);
});

// ---------------------------------------------------------------------------
// HttpConn.0x6ff_501 — the non-envelope family
// ---------------------------------------------------------------------------

test("0x6ff_501 is not an OIDB envelope and uses its own wire name", () => {
  assert.equal(HTTPCONN_SESSION_WIRE_NAME, "HttpConn.0x6ff_501");
  assert.equal(HttpConnSession.wireName, HTTPCONN_SESSION_WIRE_NAME);
  assert.equal((HttpConnSession as any).command, undefined, "it must not masquerade as an OidbSpec");
  // oidbWireName would produce "OidbSvcTrpcTcp.0x6ff_501", which is not the name
  // the reference uses.
  assert.notEqual(oidbWireName(0x6ff, 501), HTTPCONN_SESSION_WIRE_NAME);
});

for (const [label, record] of Object.entries(FIXTURES.httpconn)) {
  const caseOf = record as any;
  if (caseOf.kind === "req-shape") {
    test(`0x6ff_501 request: ${label}`, () => {
      const encoded = hex(encodeHttpConn0x6FF501Request({ httpConn: revive(caseOf.conn) }));
      assert.equal(encoded, caseOf.hex);
    });
    continue;
  }
  test(`0x6ff_501 response: ${label}`, () => {
    const decoded = decodeHttpConn0x6FF501Response(bytes(caseOf.rawHex));
    assert.equal(canon(decoded), canon(revive(caseOf.decoded)), `${label} decode`);
    try {
      const session = toHighwaySession(decoded);
      if (caseOf.error) {
        assert.fail(`${label}: expected ${caseOf.error}, got a session`);
      }
      assert.equal(canon(session), canon(revive(caseOf.session)), `${label} session`);
    } catch (error: any) {
      assert.ok(caseOf.error, `${label} threw unexpectedly: ${error.message}`);
      assert.equal(error.message, caseOf.error, `${label} error text`);
    }
  });
}

test("0x6ff_501: the bootstrap request is the reference's fixed message", () => {
  assert.deepEqual(HTTPCONN_SESSION_REQUEST.httpConn.serviceTypes, [1, 5, 10, 21]);
  assert.equal(HTTPCONN_SESSION_REQUEST.httpConn.ver, "1.0.1");
  assert.equal(HTTPCONN_SESSION_REQUEST.httpConn.field3, 16);
  assert.equal(HTTPCONN_SESSION_REQUEST.httpConn.field10, 9);
});

test("0x6ff_501: repeated serviceTypes is unpacked, so a zero still emits a tag", () => {
  const withZero = hex(
    encodeHttpConn0x6FF501Request({
      httpConn: { ...HTTPCONN_SESSION_REQUEST.httpConn, serviceTypes: [0, 1] },
    }),
  );
  // tag 56 = 0x38 for field 7 wire 0, and the zero element appears as `3800`.
  assert.match(withZero, /38003801/);
  // ...and it must NOT be packed into a length-delimited field (tag 0x3a).
  assert.equal(withZero.includes("3a"), false);
});

test("0x6ff_501: ip is fixed32 and renders low octet first", () => {
  // 11.0.0.10 stored as 0x0a00000b
  assert.equal(httpConnAddrHost(0x0a00000b), "11.0.0.10");
  assert.equal(httpConnAddrHost(0x0a00000b), "11.0.0.10");
  // A reversed implementation would produce "10.0.0.11"; assert we do not.
  assert.notEqual(httpConnAddrHost(0x0a00000b), "10.0.0.11");
});

test("0x6ff_501: only serviceType 1 servers are accepted, deduped on host:port", () => {
  const record = (FIXTURES.httpconn as any)["6ff_501 resp session"];
  const session = toHighwaySession(decodeHttpConn0x6FF501Response(bytes(record.rawHex)));
  assert.deepEqual(session.servers, [
    { host: "11.0.0.10", port: 8080 },
    { host: "100.1.168.192", port: 443 },
  ]);
  // The duplicate 8080 endpoint, the serviceType-5 server, the port-0 and
  // port-70000 addresses were all filtered out.
  assert.equal(session.servers.length, 2);
});

// ---------------------------------------------------------------------------
// The sub-command each spec actually emits
// ---------------------------------------------------------------------------
//
// `oidbWireName` is what the transport puts on the wire; a wrong sub-command is
// a request to a different RPC, so pin all of them against the fixtures.

test("batch A: every request's wire name matches the fixture's command/sub", () => {
  for (const [label, record] of Object.entries(FIXTURES.oidb)) {
    if (record.kind !== "req") continue;
    const spec = SPECS[record.spec];
    const params = revive(record.params);
    const sub = spec.resolveSubCommand ? spec.resolveSubCommand(params) : (spec.subCommand ?? 0);
    assert.equal(
      oidbWireName(record.command, sub),
      oidbWireName(record.command, record.subCommand),
      `${label} wire name`,
    );
  }
});