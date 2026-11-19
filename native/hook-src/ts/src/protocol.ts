// The Haizakura hook wire protocol, in TypeScript.
//
// ---------------------------------------------------------------------------
// Why this lives on the Node side at all
// ---------------------------------------------------------------------------
// A frame is a fixed 40-byte header followed by three tightly packed spans:
// cmd, msg, body.  Everything is little-endian.
//
//   offset  size  field
//        0     4  magic        827344977 (0x31504851, "QHP1")
//        4     2  version      1
//        6     2  op
//        8     4  requestId    correlation for request/ack/reply
//       12     4  status       signed; a non-zero value means "failed"
//       16     2  flags        bit 0 want-reply, bit 2 logged-in
//       18     2  reserved     must be zero
//       20     4  cmdLen
//       24     4  msgLen
//       28     4  bodyLen
//       32     8  value0       op-specific, u64
//
// Decoding this is pure bookkeeping over a byte buffer -- no address-space access,
// no machine code -- so it belongs here rather than in the .so.  The payload keeps
// only what genuinely cannot move: binding the sockets and running on QQ's threads.
//
// The closed-source implementation put both halves in one 425 KB shared object.
// Splitting them means a protocol change is a TypeScript edit and a reload, not a
// cross-compile plus a deployment.
//
// ---------------------------------------------------------------------------
// The one thing that is easy to get wrong
// ---------------------------------------------------------------------------
// The length fields are not advisory.  A decoder that trusts cmdLen and then reads
// past the buffer turns a malformed frame from the payload into an out-of-bounds
// read on the Node side, and the payload runs in a process we do not control. So
// every length is validated against what actually arrived before anything is
// sliced, and a frame that fails is rejected whole -- see `decodeFrame`.

/** Header size in bytes. Fixed; the three spans start immediately after it. */
export const FRAME_HEADER_SIZE = 40;

/** 0x31504851, as "QHP1" little-endian. */
export const PIPE_MAGIC = 827344977;

export const PIPE_VERSION = 1;

/** Control channel: the request/ack/reply conversation. */
export const Op = {
  hello: 1,
  request: 2,
  ack: 3,
  reply: 4,
  error: 5,
  loginState: 7,
} as const;

/**
 * Recv channel: QQ data flowing one way, payload to Node.
 *
 * These never appear on control and the control ops never appear here -- the two
 * channels carry disjoint halves of the same op space. A handler that accepted
 * either op on either channel would misparse a packet as a request.
 */
export const RecvOp = {
  hello: 1,
  packet: 6,
  loginState: 7,
  clientMessageReceipt: 21,
  privateMessageReporting: 22,
} as const;

export const Flag = {
  wantReply: 1 << 0,
  /**
   * Set on op 7. The receiver ORs this with `status !== 0`, because the two
   * indicators were introduced at different times and a payload may set either.
   */
  loggedIn: 1 << 2,
} as const;

/** Refuse a cmd span larger than this. Not a protocol limit; a sanity bound. */
export const MAX_CMD = 4096;

/** Refuse a msg span larger than this. QQ UIDs and pipe names fit comfortably. */
export const MAX_MSG = 65536;

export interface FrameHeader {
  magic: number;
  version: number;
  op: number;
  requestId: number;
  status: number;
  flags: number;
  cmdLen: number;
  msgLen: number;
  bodyLen: number;
  value0: bigint;
}

export interface Frame {
  header: FrameHeader;
  /** Service command, e.g. "MessageSvc.PbSendMsg". Empty when the frame carries none. */
  cmd: string;
  /** Message field: pipe name on hello, uin on login state, service cmd on packet. */
  msg: string;
  /** Opaque payload. A Buffer sharing the input, not a copy. */
  body: Buffer;
}

export type DecodeResult =
  | { ok: true; frame: Frame; bytesConsumed: number }
  | { ok: false; reason: string };

/**
 * Decodes one frame from `input` starting at `offset`.
 *
 * Returns the number of bytes consumed so a caller can drain a stream: frames are
 * not self-delimiting on the wire beyond their lengths, and a single read() can
 * carry one and a half frames.
 *
 * On failure returns a reason rather than throwing, because the caller is a socket
 * read loop: an exception there would either kill the process or need a try/catch
 * around every read, and a malformed frame is an expected condition when talking to
 * a component we are still developing.
 */
export function decodeFrame(input: Buffer, offset = 0): DecodeResult {
  if (input.length - offset < FRAME_HEADER_SIZE) {
    return { ok: false, reason: "short header" };
  }

  const magic = input.readUInt32LE(offset + 0);
  if (magic !== PIPE_MAGIC) {
    return { ok: false, reason: `bad magic 0x${magic.toString(16)}` };
  }

  const version = input.readUInt16LE(offset + 4);
  if (version !== PIPE_VERSION) {
    return { ok: false, reason: `unsupported version ${version}` };
  }

  const cmdLen = input.readUInt32LE(offset + 20);
  const msgLen = input.readUInt32LE(offset + 24);
  const bodyLen = input.readUInt32LE(offset + 28);

  // Validate before slicing. Each bound is checked separately so the failure names
  // the field that was wrong -- a combined check would report the same reason for
  // three different bugs.
  if (cmdLen > MAX_CMD) return { ok: false, reason: `cmd too large: ${cmdLen}` };
  if (msgLen > MAX_MSG) return { ok: false, reason: `msg too large: ${msgLen}` };

  const total = FRAME_HEADER_SIZE + cmdLen + msgLen + bodyLen;
  if (input.length - offset < total) {
    return { ok: false, reason: `incomplete frame: want ${total}, have ${input.length - offset}` };
  }

  const cmdStart = offset + FRAME_HEADER_SIZE;
  const msgStart = cmdStart + cmdLen;
  const bodyStart = msgStart + msgLen;

  return {
    ok: true,
    bytesConsumed: total,
    frame: {
      header: {
        magic,
        version,
        op: input.readUInt16LE(offset + 6),
        requestId: input.readUInt32LE(offset + 8),
        status: input.readInt32LE(offset + 12),
        flags: input.readUInt32LE(offset + 16),
        cmdLen,
        msgLen,
        bodyLen,
        value0: input.readBigUInt64LE(offset + 32),
      },
      cmd: input.toString("utf8", cmdStart, msgStart),
      msg: input.toString("utf8", msgStart, bodyStart),
      body: input.subarray(bodyStart, bodyStart + bodyLen),
    },
  };
}

/**
 * Builds a frame.
 *
 * `value0` is a bigint because it carries a uin, and a QQ account number fits in 32
 * bits today but the field is 64 bits wide. Accepting a number here would make the
 * truncation silent.
 */
export function encodeFrame(parts: {
  op: number;
  requestId?: number;
  status?: number;
  flags?: number;
  cmd?: string;
  msg?: string;
  body?: Buffer;
  value0?: bigint;
}): Buffer {
  const cmd = Buffer.from(parts.cmd ?? "", "utf8");
  const msg = Buffer.from(parts.msg ?? "", "utf8");
  const body = parts.body ?? Buffer.alloc(0);

  if (cmd.length > MAX_CMD) throw new Error(`cmd too large: ${cmd.length}`);
  if (msg.length > MAX_MSG) throw new Error(`msg too large: ${msg.length}`);

  const out = Buffer.alloc(FRAME_HEADER_SIZE + cmd.length + msg.length + body.length);
  out.writeUInt32LE(PIPE_MAGIC, 0);
  out.writeUInt16LE(PIPE_VERSION, 4);
  out.writeUInt16LE(parts.op, 6);
  out.writeUInt32LE(parts.requestId ?? 0, 8);
  out.writeInt32LE(parts.status ?? 0, 12);
  out.writeUInt32LE(parts.flags ?? 0, 16);
  out.writeUInt32LE(cmd.length, 20);
  out.writeUInt32LE(msg.length, 24);
  out.writeUInt32LE(body.length, 28);
  out.writeBigUInt64LE(parts.value0 ?? 0n, 32);
  cmd.copy(out, FRAME_HEADER_SIZE);
  msg.copy(out, FRAME_HEADER_SIZE + cmd.length);
  body.copy(out, FRAME_HEADER_SIZE + cmd.length + msg.length);
  return out;
}

/**
 * op 7: the login announcement, decoded.
 *
 * `loggedIn = (flags & 0x4) || status !== 0`, which is what the original receiver
 * does -- the two indicators were added at different times and either may be set.
 *
 * `uin` can legitimately be null. The payload reports logged-in-without-a-number
 * when it could not read the account out of wrapper.node, and inventing a value
 * here would be the one error the rest of the stack cannot detect: every message
 * that follows would be attributed to an account that does not exist.
 */
export function decodeLoginState(frame: Frame): { loggedIn: boolean; uin: string | null } {
  const loggedIn = (frame.header.flags & Flag.loggedIn) !== 0 || frame.header.status !== 0;
  if (!loggedIn) return { loggedIn: false, uin: null };

  // The msg field is the uin as text; value0 is the numeric form. Either alone is
  // enough, and the payload sets both when it knows the number.
  const text = frame.msg.trim();
  if (text.length > 0) return { loggedIn: true, uin: text };
  if (frame.header.value0 > 0n) return { loggedIn: true, uin: frame.header.value0.toString() };
  return { loggedIn: true, uin: null };
}
/**
 * The fixed refusal messages the reference payload sends on op 5, by status.
 *
 * Copied from the reference implementation so a caller's user-facing wording matches what the
 * real product shows. The status codes and their meanings are the payload's, not ours:
 *
 *   0  malformed request
 *   1  not logged in yet
 *   2  the session changed under us
 *   3  could not prepare the request (the payload is not resolving runtime targets)
 *   -  anything else: could not send
 *
 * See docs/reverse-socket-protocol.md for the address each string was read from.
 */
export const REFUSAL_MESSAGES: Readonly<Record<number, string>> = {
  0: "This request is not valid. Please check it and try again.",
  1: "QQ is not ready. Please finish signing in and try again.",
  2: "The QQ connection changed. Please restart QQ and try again.",
  3: "SnowLuma could not prepare the request. Please restart SnowLuma and try again.",
};

export const REFUSAL_FALLBACK =
  "SnowLuma could not send the request. Please try again.";

/**
 * Interprets an op 5 frame.
 *
 * The msg field carries the payload's own message; status carries the reason code. Both are
 * returned rather than one being preferred, because they answer different questions: status is
 * for code that wants to branch, msg is for anything that shows text.
 *
 * When msg is empty the documented message for that status is substituted -- an empty string
 * would render as nothing in a UI, which reads as "no error" to the person seeing it.
 */
export function decodeRefusal(frame: Frame): { status: number; message: string } {
  const status = frame.header.status;
  const text = frame.msg.trim();
  const message =
    text.length > 0 ? text : (REFUSAL_MESSAGES[status] ?? REFUSAL_FALLBACK);
  return { status, message };
}
