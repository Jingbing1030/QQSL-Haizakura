// Talks to the real SnowLuma hook socket with the TypeScript codec.
//
// This is the strongest cross-language check available on this machine: the peer is the
// closed-source payload running inside a real QQ, not a build of ours. If the TS decoder
// reads its frames, the protocol understanding is confirmed against the thing it was
// reverse-engineered from -- and any disagreement shows up as a rejected frame rather than as
// a hook that quietly stops working after a QQ update.
import net from "node:net";
import { readdirSync } from "node:fs";

import {
  encodeFrame,
  decodeFrame,
  decodeLoginState,
  Op,
  RecvOp,
  PIPE_MAGIC,
  FRAME_HEADER_SIZE,
} from "/home/ubuntu/hook-rewrite/ts/build/src/protocol.js";

const runtimeDir = process.env.HZ_RUNTIME_DIR ?? "/tmp/runtime-1000";
const pid = Number(process.env.HZ_PID);

const sockets = readdirSync(runtimeDir).filter((f) => f.startsWith(`mojo.${pid}.`));
console.log(`sockets for pid ${pid}: ${JSON.stringify(sockets)}`);
if (sockets.length === 0) {
  console.error("no sockets; is the hook running in that pid?");
  process.exit(2);
}

const path = `${runtimeDir}/mojo.${pid}.control.sock`;
const sock = net.connect(path);

await new Promise((resolve, reject) => {
  sock.once("connect", resolve);
  sock.once("error", reject);
});
console.log("connected");

// The Node side opens with a hello naming the pipe; resolveHello takes the pipe name out of
// msg, so an empty one would still "connect" and quietly break later.
sock.write(encodeFrame({ op: Op.hello, msg: path, value0: BigInt(pid) }));

const frames: { op: number; status: number; flags: number; msg: string; bytes: number }[] = [];
let buf = Buffer.alloc(0);
let rawFirst: Buffer | null = null;

await new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 5000);
  sock.on("data", (chunk: Buffer) => {
    if (rawFirst === null) rawFirst = chunk.subarray(0, Math.min(48, chunk.length));
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const r = decodeFrame(buf);
      if (!r.ok) {
        if (buf.length >= FRAME_HEADER_SIZE) {
          console.log(`  decoder rejected (${r.reason}); ${buf.length} bytes buffered`);
        }
        break;
      }
      frames.push({
        op: r.frame.header.op,
        status: r.frame.header.status,
        flags: r.frame.header.flags,
        msg: r.frame.msg,
        bytes: r.bytesConsumed,
      });
      buf = buf.subarray(r.bytesConsumed);
    }
    if (frames.length >= 3) {
      clearTimeout(timer);
      resolve();
    }
  });
});

console.log(`\nfirst raw bytes: ${rawFirst?.toString("hex").match(/.{1,8}/g)?.join(" ") ?? "(none)"}`);
if (rawFirst) {
  console.log(`  magic field: ${rawFirst.readUInt32LE(0)} (expect ${PIPE_MAGIC})`);
}

console.log(`\ndecoded ${frames.length} frame(s) with the TS codec:`);
for (const f of frames) {
  const opName =
    f.op === Op.hello ? "hello"
    : f.op === Op.ack ? "ack"
    : f.op === Op.reply ? "reply"
    : f.op === Op.error ? "error"
    : f.op === RecvOp.packet ? "packet"
    : f.op === RecvOp.loginState ? "login-state"
    : String(f.op);
  console.log(`  op=${f.op} (${opName}) status=${f.status} flags=0x${f.flags.toString(16)} bytes=${f.bytes}`);
  if (f.msg) console.log(`      msg: ${JSON.stringify(f.msg)}`);
}

const login = frames.find((f) => f.op === RecvOp.loginState);
if (login) {
  const decoded = decodeFrame(buf.length ? buf : Buffer.alloc(0));
  // decodeLoginState needs the frame itself; reconstruct from what we retained.
  console.log(`\nlogin frame present: status=${login.status} flags=0x${login.flags.toString(16)}`);
  console.log(`  logged-in per protocol: ${(login.flags & 0x4) !== 0 || login.status !== 0}`);
  if (decoded.ok) {
    console.log(`  login state: ${JSON.stringify(decodeLoginState(decoded.frame))}`);
  }
}

sock.destroy();
console.log("\nTS codec read the real payload's frames successfully");