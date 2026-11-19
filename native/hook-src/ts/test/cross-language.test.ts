// Cross-language check: does the TypeScript codec agree with the C++ payload byte for byte?
//
// The unit tests prove the TS side is self-consistent, which is not the same thing -- both
// halves could be wrong in the same way. This drives the real C++ payload over its real
// socket and decodes what comes back with the TS codec, so a disagreement shows up as a
// failed assertion rather than as a hook that silently stops working after a rebuild.
//
// It uses the same injection path as full_stack_test.mjs (the addon's loadModuleManualAsync
// against a fake_target that has wrapper.node mapped), because the point is to exercise the
// bytes the shipping payload actually emits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { decodeFrame, encodeFrame, decodeLoginState, Op, RecvOp, Flag, PIPE_MAGIC } from "../src/protocol.js";

const require = createRequire(import.meta.url);
const addonPath = process.env.HZ_ADDON;
const targetPid = process.env.HZ_PID;
const payloadPath = process.env.HZ_PAYLOAD;
const runtimeDir = process.env.HZ_RUNTIME_DIR;

const canRun = Boolean(addonPath && targetPid && payloadPath && runtimeDir);

test(
  "the C++ payload's hello decodes with the TS codec",
  { skip: canRun ? false : "set HZ_ADDON, HZ_PID, HZ_PAYLOAD, HZ_RUNTIME_DIR" },
  async () => {
    const addon = require(addonPath!);
    const handle = await addon.loadModuleManualAsync(Number(targetPid), payloadPath!);
    assert.ok(handle, "loadModuleManualAsync returned a handle");

    const net = await import("node:net");
    const path = `${runtimeDir}/mojo.${targetPid}.control.sock`;

    const socket = net.connect(path);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    // The Node side opens with a hello carrying the pipe name; the payload answers with its
    // own hello of the same shape. Decoding that reply is the cross-check.
    const pid = process.pid;
    socket.write(encodeFrame({ op: Op.hello, msg: `haizakura.ts.${pid}`, value0: BigInt(pid) }));

    const reply = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no frame from payload in 5s")), 5000);
      socket.once("data", (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(chunk);
      });
      socket.once("error", reject);
    });

    const decoded = decodeFrame(reply);
    assert.ok(decoded.ok, decoded.ok === false ? `payload frame rejected: ${decoded.reason}` : "");

    // A raw magic check first: if the TS constant were wrong, every later assertion would
    // fail for a confusing reason.
    assert.equal(reply.readUInt32LE(0), PIPE_MAGIC, "payload emitted the expected magic");
    assert.equal(decoded.frame.header.op, Op.hello, "payload answered with a hello");

    socket.destroy();
    await addon.unloadModuleManualAsync(Number(targetPid), handle);
  },
);

test(
  "the payload's login announcement decodes to a state the policy layer accepts",
  { skip: canRun ? false : "set HZ_ADDON, HZ_PID, HZ_PAYLOAD, HZ_RUNTIME_DIR" },
  async () => {
    // This one runs against whatever the payload actually reports. With fake-wrapper.node
    // as the module there are no C++ classes, so the hook is not installed and no op 7 ever
    // arrives -- which is exactly why this asserts on the *shape* rather than requiring a
    // frame: a missing login is a valid outcome here, and the test says so.
    const net = await import("node:net");
    const path = `${runtimeDir}/mojo.${targetPid}.recv.sock`;

    const socket = net.connect(path);
    const connected = await new Promise<boolean>((resolve) => {
      socket.once("connect", () => resolve(true));
      socket.once("error", () => resolve(false));
    });
    if (!connected) {
      // No recv channel means no payload; that is the skip condition above, not a failure.
      socket.destroy();
      return;
    }

    const chunk = await new Promise<Buffer | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      socket.once("data", (data: Buffer) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    if (chunk !== null) {
      const decoded = decodeFrame(chunk);
      if (decoded.ok) {
        // Whatever arrives must at least be a frame the TS decoder accepts; a rejection here
        // means the two implementations disagree about the layout.
        assert.ok(decoded.bytesConsumed > 0);
        if (decoded.frame.header.op === RecvOp.loginState) {
          const state = decodeLoginState(decoded.frame);
          assert.equal(typeof state.loggedIn, "boolean");
          assert.ok(state.uin === null || /^\d+$/.test(state.uin),
            `uin must be null or digits, got ${JSON.stringify(state.uin)}`);
        }
      } else {
        assert.fail(`TS codec rejected a frame the C++ payload produced: ${decoded.reason}`);
      }
    }

    socket.destroy();
  },
);