/**
 * op2 send TRANSPORT seam: `Bridge.bindPid` → `MessageApi.sendGroup` → `PacketClient`.
 *
 * The encode side is pinned byte-for-byte elsewhere
 * (`op2-encode-real-capture.test.ts`), and the real outgoing request + correlated
 * op4 reply are documented in `docs/op2-real-send-proof.md`. This file covers the
 * piece in between: whether `MessageApi` actually reaches a `PacketClient`, with
 * the right command and payload, and whether it refuses to report success when QQ
 * returns no receipt.
 *
 * That last point is the one worth guarding. A send that silently resolves while
 * QQ never acknowledged it would look like success to every caller, and the
 * damage (a recall that cannot work, a reply that points nowhere) shows up much
 * later. `sendGroup` throws "delivery was not confirmed" in that case, and the
 * test below pins it.
 *
 * What this does NOT prove: that a real QQ process accepts the packet. The
 * `PacketClient` here is a stub. The C++ hook side (`emit_packet`, TaskManager
 * slot 5) is still unwired — see PROGRESS.md.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";

const GROUP_ID = 958146070;
const SELF_UIN = "10001";

function makeBridge() {
  const identity = new MemoryIdentity(SELF_UIN);
  identity.setSelfProfile({
    uin: Number(SELF_UIN),
    uid: "u_selfplaceholder000000",
    nickname: "鱼糕",
  } as never);
  return new Bridge(identity);
}

/** Records what the API hands the transport, and replies with a chosen body. */
function recordingClient(replyBody: Uint8Array) {
  const calls: { cmd: string; bodyLength: number }[] = [];
  return {
    calls,
    client: {
      async sendPacket(cmd: string, body: Uint8Array) {
        calls.push({ cmd, bodyLength: body.length });
        return {
          success: true,
          gotResponse: true,
          errorCode: 0,
          errorMessage: "",
          responseData: replyBody,
        };
      },
    },
  };
}

test("with no sender attached, sendRawPacket returns the -1 sentinel instead of throwing", async () => {
  // The `-1` must survive to `invokeOidb` as a result: a throw here would turn a
  // recoverable "not logged in yet" into an unhandled rejection.
  const bridge = makeBridge();
  const result = await bridge.sendRawPacket("MessageSvc.PbSendMsg", new Uint8Array([1, 2, 3]));

  assert.equal(result.success, false);
  assert.equal(result.gotResponse, false);
  assert.equal(result.errorCode, -1);
  assert.match(result.errorMessage ?? "", /no packet sender/i);
});

test("sendGroup reaches the PacketClient with MessageSvc.PbSendMsg and a real payload", async () => {
  const bridge = makeBridge();
  // `result=0` with no `groupSequence` (field 11) — QQ accepted but returned no
  // receipt. `sendGroup` must treat that as a failure.
  const { calls, client } = recordingClient(Uint8Array.from([0x08, 0x00]));
  bridge.bindPid(999, client);

  await assert.rejects(
    () => bridge.apis.message.sendGroup(GROUP_ID, [{ type: "text", text: "hz-probe" }] as never),
    /not confirmed/i,
    "a reply without groupSequence must not be reported as delivered",
  );

  assert.equal(calls.length, 1, "exactly one packet per send");
  assert.equal(calls[0]!.cmd, "MessageSvc.PbSendMsg");
  // The encoded request is never empty, and the marked text plus envelope put it
  // in the tens of bytes — a zero or absurd length means the encoder was skipped.
  assert.ok(calls[0]!.bodyLength > 20, `payload looks too small: ${String(calls[0]!.bodyLength)}B`);
});

test("a reply carrying groupSequence is accepted and produces a receipt", async () => {
  // field 11 = groupSequence, varint 6035  ->  tag (11<<3)|0 = 88 = 0x58
  // field 1  = result 0                    ->  tag (1<<3)|0  = 8  = 0x08
  const reply = Uint8Array.from([0x08, 0x00, 0x58, 0x93, 0x2f]);
  const bridge = makeBridge();
  const { client } = recordingClient(reply);
  bridge.bindPid(999, client);

  const receipt = await bridge.apis.message.sendGroup(GROUP_ID, [
    { type: "text", text: "hz-probe" },
  ] as never);

  assert.equal(receipt.sequence, 6035, "the group sequence comes from field 11");
  // `messageId` is the masked local random, never a value read off the wire.
  assert.equal(typeof receipt.messageId, "number");
  assert.ok(Number.isInteger(receipt.messageId));
});

test("re-binding a different PID moves the active sender to the newest connection", async () => {
  const bridge = makeBridge();
  const first = recordingClient(Uint8Array.from([0x08, 0x00]));
  const second = recordingClient(Uint8Array.from([0x08, 0x00]));

  bridge.bindPid(1, first.client);
  assert.equal(bridge.activePid, 1);
  bridge.bindPid(2, second.client);
  assert.equal(bridge.activePid, 2, "the newest connection sends packets");

  await assert.rejects(
    () => bridge.apis.message.sendGroup(GROUP_ID, [{ type: "text", text: "x" }] as never),
    /not confirmed/i,
  );

  assert.deepEqual(first.calls, [], "the superseded connection must not send");
  assert.equal(second.calls.length, 1);
});
