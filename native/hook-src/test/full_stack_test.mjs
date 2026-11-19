// The full stack, in the order the real product uses it:
//
//   Node.js  →  addon.loadModuleManualAsync(pid, payload.so)
//            →  ManualLoader maps + relocates + runs init + calls start_dynamic
//            →  payload creates mojo control/recv sockets
//            →  a client connects and completes the handshake
//
// This is the closest thing to the real deployment that can run without QQ: everything above the
// target process is the real addon, loaded by real Node, driven through its real N-API surface.
// The only stand-in is the target itself (fake_target, which has a real wrapper.node mapping).
//
// It exists because the per-layer tests each pass while the seams between them can still be
// wrong -- the in-process hook tested fine on its own, yet the payload could not have used it
// until the in-process variant existed.  Seams are where this project's defects have been.
import { createRequire } from "node:module";
import { existsSync, unlinkSync } from "node:fs";
import net from "node:net";

const require = createRequire(import.meta.url);
const [, , addonPath, pidArg, payloadPath] = process.argv;
if (!addonPath || !pidArg || !payloadPath) {
  console.error("usage: node full_stack_test.mjs <addon.node> <pid> <payload.so>");
  process.exit(2);
}
const pid = Number(pidArg);

let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

// The paths the payload now derives, matching mojoPipeName() in the Node side:
// <XDG_RUNTIME_DIR>/mojo.<pid>.control.sock.  The hardcoded /tmp names are gone from the payload
// on purpose -- they were the reason a real SnowLuma could never connect.
// HZ_CONTROL_SOCK / HZ_RECV_SOCK pin the paths for this test.  The derived mojo.<pid> names are
// asserted separately by run_ts_handshake.sh, against the Node side's own rule; here the point is
// the injection lifecycle, and pinning removes environment drift as a variable.
// Same rule the payload uses inside the target: the payload cannot see THIS process's environment,
// so the two have to derive the path the same way rather than share a variable.
const runtimeDir = () => {
  const dir = process.env.HZ_RUNTIME_DIR ||
    (process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR !== "" ? process.env.XDG_RUNTIME_DIR : null);
  return dir || `/tmp/snowluma-${typeof process.geteuid === "function" ? process.geteuid() : 1000}`;
};
const CONTROL = `${runtimeDir()}/mojo.${pid}.control.sock`;
const RECV = `${runtimeDir()}/mojo.${pid}.recv.sock`;

// Wait for a path to appear/disappear.
const waitFor = async (p, want, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(p) === want) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return existsSync(p) === want;
};

// Reads one 40-byte frame header plus variable payload.
const readFrame = (sock) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let need = 40;
    const onData = (d) => {
      chunks.push(d);
      const buf = Buffer.concat(chunks);
      if (buf.length >= 40 && need === 40) {
        const magic = buf.readUInt32LE(0);
        const version = buf.readUInt16LE(4);
        const op = buf.readUInt16LE(6);
        const status = buf.readInt32LE(12);
        const flags = buf.readUInt32LE(16);
        const cmdLen = buf.readUInt32LE(20);
        const msgLen = buf.readUInt32LE(24);
        const bodyLen = buf.readUInt32LE(28);
        const value0 = buf.readBigUInt64LE(32);
        need = 40 + cmdLen + msgLen + bodyLen;
        if (buf.length >= need) {
          sock.off("data", onData);
          resolve({ magic, version, op, status, flags, cmdLen, msgLen, bodyLen, value0 });
        }
      }
    };
    sock.on("data", onData);
    sock.once("error", reject);
  });

const main = async () => {
  const addon = require(addonPath);
  check(typeof addon.loadModuleManualAsync === "function", "addon exposes loadModuleManualAsync");

  // Clean slate: a socket left by a previous run would make the "appeared" check meaningless.
  for (const p of [CONTROL, RECV]) if (existsSync(p)) unlinkSync(p);

  console.log(`injecting ${payloadPath} into pid ${pid} via the addon`);
  const handle = await addon.loadModuleManualAsync(pid, payloadPath);
  console.log(`  handle: base=0x${handle.base.toString(16)} entry=0x${handle.entry.toString(16)} ` +
              `size=0x${handle.size.toString(16)}`);
  check(handle.base !== 0n, "the module was mapped");
  check(handle.entry !== 0n, "an entry point was found");
  check(handle.size > 0n, "the mapping has a size");

  // The loader calls start_dynamic itself; the sockets appearing is the proof.
  check(await waitFor(CONTROL, true), "control socket appeared (start_dynamic ran)");
  check(await waitFor(RECV, true), "recv socket appeared");

  // Complete a handshake on the control channel, as the Node bridge does: connect, then send
  // op 1 (hello) and expect op 1 back.
  const control = net.createConnection(CONTROL);
  await new Promise((res, rej) => {
    control.once("connect", res);
    control.once("error", rej);
  });
  check(true, "connected to the control channel");

  const hello = Buffer.alloc(40);
  hello.writeUInt32LE(827344977, 0); // QHP1
  hello.writeUInt16LE(1, 4);          // version
  hello.writeUInt16LE(1, 6);          // op = hello
  control.write(hello);
  const reply = await readFrame(control);
  console.log(`  hello reply: magic=0x${reply.magic.toString(16)} op=${reply.op} version=${reply.version}`);
  check(reply.magic === 827344977, "the reply's magic is QHP1");
  check(reply.version === 1, "the reply's version is 1");
  check(reply.op === 1, "the reply is op 1 (hello)");
  control.destroy();

  // And the recv channel accepts a client too: the payload has an accept thread for it.
  const recv = net.createConnection(RECV);
  await new Promise((res, rej) => {
    recv.once("connect", res);
    recv.once("error", rej);
  });
  check(true, "connected to the recv channel");
  recv.destroy();

  // Unloading must remove both sockets; leaving them bound would make the next start fail with
  // EADDRINUSE and look like a payload bug.
  await addon.unloadModuleManualAsync(pid, handle);
  check(await waitFor(CONTROL, false), "control socket removed on unload");
  check(await waitFor(RECV, false), "recv socket removed on unload");

  // And the cycle must repeat.  This is the check that fails when stop_dynamic is skipped: the
  // first injection works, the second cannot bind, and the symptom ("injection broken") points at
  // the injector rather than at the missing stop.
  console.log("second cycle: inject again into the same process");
  const handle2 = await addon.loadModuleManualAsync(pid, payloadPath);
  check(handle2.base !== 0n, "the second mapping succeeded");
  check(await waitFor(CONTROL, true), "control socket re-appeared (no EADDRINUSE)");
  check(await waitFor(RECV, true), "recv socket re-appeared");

  const control2 = net.createConnection(CONTROL);
  await new Promise((res, rej) => {
    control2.once("connect", res);
    control2.once("error", rej);
  });
  const hello2 = Buffer.alloc(40);
  hello2.writeUInt32LE(827344977, 0);
  hello2.writeUInt16LE(1, 4);
  hello2.writeUInt16LE(1, 6);
  control2.write(hello2);
  const reply2 = await readFrame(control2);
  check(reply2.magic === 827344977 && reply2.op === 1,
        "the second instance also answers the handshake");
  control2.destroy();

  await addon.unloadModuleManualAsync(pid, handle2);
  check(await waitFor(CONTROL, false), "control socket removed after the second unload");
  check(await waitFor(RECV, false), "recv socket removed after the second unload");

  console.log(failures ? `FAIL (${failures} failures)` : "PASS");
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
