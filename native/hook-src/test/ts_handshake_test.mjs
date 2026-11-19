// The handshake as SnowLuma's own TS layer performs it, against our payload.
//
// The frame layout, the socket names and the hello semantics here are copied from index.mjs
// (encodeFrame at 1950, mojoPipeName at 1827, resolveHello at 2512), not invented.  That is the
// point: a self-consistent test proves nothing about interoperating with the real client.
//
// Usage: node ts_handshake_test.mjs <pid>
// The payload must already be injected into <pid>.
import net from "node:net";

const PIPE_MAGIC = 827344977;

const encodeFrame = ({ op, requestId = 0, status = 0, flags = 0, value0 = 0n, cmd = "", msg = "", body = Buffer.alloc(0) }) => {
  const cmdBuf = Buffer.from(cmd, "utf8");
  const msgBuf = Buffer.from(msg, "utf8");
  const header = Buffer.alloc(40);
  header.writeUInt32LE(PIPE_MAGIC, 0);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(op, 6);
  header.writeUInt32LE(requestId >>> 0, 8);
  header.writeInt32LE(status | 0, 12);
  header.writeUInt32LE(flags >>> 0, 16);
  header.writeUInt32LE(cmdBuf.length >>> 0, 20);
  header.writeUInt32LE(msgBuf.length >>> 0, 24);
  header.writeUInt32LE(body.length >>> 0, 28);
  header.writeBigUInt64LE(BigInt(value0), 32);
  return Buffer.concat([header, cmdBuf, msgBuf, body]);
};

const decodeFrame = (buf) => {
  if (buf.length < 40) return null;
  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt16LE(4);
  const op = buf.readUInt16LE(6);
  const requestId = buf.readUInt32LE(8);
  const status = buf.readInt32LE(12);
  const flags = buf.readUInt32LE(16);
  const cmdLen = buf.readUInt32LE(20);
  const msgLen = buf.readUInt32LE(24);
  const bodyLen = buf.readUInt32LE(28);
  const value0 = buf.readBigUInt64LE(32);
  const total = 40 + cmdLen + msgLen + bodyLen;
  if (buf.length < total) return null;
  let at = 40;
  const cmd = buf.subarray(at, at + cmdLen).toString();
  at += cmdLen;
  const msg = buf.subarray(at, at + msgLen).toString();
  at += msgLen;
  const body = buf.subarray(at, at + bodyLen);
  return { magic, version, op, requestId, status, flags, value0, cmd, msg, body, total };
};

// Reads frames until one satisfies `want`, so a login push arriving before the hello cannot make
// the test report the wrong frame.
const readUntil = (sock, want, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout waiting for frame")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); sock.off("data", onData); };
    const onData = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const f = decodeFrame(pending);
        if (!f) return;
        pending = pending.subarray(f.total);
        if (want(f)) { cleanup(); resolve(f); return; }
      }
    };
    sock.on("data", onData);
  });

const connect = (path) => new Promise((res, rej) => {
  const s = net.createConnection(path);
  s.once("connect", () => res(s));
  s.once("error", rej);
});

const main = async () => {
  const pid = Number(process.argv[2]);
  if (!Number.isInteger(pid)) { console.error("usage: node ts_handshake_test.mjs <pid>"); process.exit(2); }
  const runtimeDir = process.env.XDG_RUNTIME_DIR || "/run/user/1000";
  const controlPath = `${runtimeDir}/mojo.${pid}.control.sock`;
  const recvPath = `${runtimeDir}/mojo.${pid}.recv.sock`;

  let failures = 0;
  const check = (ok, what, extra = "") => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${extra ? "  " + extra : ""}`);
    if (!ok) failures++;
  };

  console.log(`connecting the way SnowLuma does: ${controlPath}`);
  const control = await connect(controlPath);
  check(true, "control pipe connected");

  control.write(encodeFrame({ op: 1 }));
  const hello = await readUntil(control, (f) => f.op === 1);
  check(hello.magic === PIPE_MAGIC, "hello magic is PIPE_MAGIC");
  check(hello.version === 1, "hello version is 1");
  check(Number(hello.value0) === pid, "hello value0 is the pid", `got ${hello.value0}`);
  // resolveHello takes the pipe name out of msg; an empty msg yields an empty pipeName and the
  // session still "connects", so this is worth asserting explicitly.
  check(hello.msg === controlPath, "hello msg is the control pipe name", `got ${hello.msg || "(empty)"}`);

  console.log(`connecting recv: ${recvPath}`);
  const recv = await connect(recvPath);
  check(true, "recv pipe connected");
  recv.write(encodeFrame({ op: 1 }));
  const rhello = await readUntil(recv, (f) => f.op === 1);
  check(rhello.magic === PIPE_MAGIC, "recv hello magic is PIPE_MAGIC");
  check(rhello.msg === recvPath, "recv hello msg is the recv pipe name", `got ${rhello.msg || "(empty)"}`);

  // The login push (op 7) is NOT checked here, and the reason is worth stating precisely: it is
  // emitted when QQ's own login callback fires, which this harness cannot cause -- the target is
  // fake_target, not a logged-in QQ.  Asserting it produced a permanent FAIL that said nothing
  // about the payload.
  //
  // It is covered by login_state_test.cc, which drives do_announce_login() directly -- the same
  // function the real callback calls, so the frame on the wire is the production frame -- and
  // asserts the login-then-reconnect ordering that the Node side depends on.
  console.log("  (op 7 login push is covered by login_state_test, not here: this target is not QQ)");

  control.destroy();
  recv.destroy();
  console.log(failures ? `FAIL (${failures})` : "PASS");
  process.exit(failures ? 1 : 0);
};

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
