// The highway transfer frame — the wrapper every chunk of a large upload or download
// travels inside.
//
// Reference region: `../protocol/src/highway/utils.ts` (reference/index.mjs:18290-18314),
// functions `packHighwayFrame` / `unpackHighwayFrame`.
//
// ---------------------------------------------------------------------------
// Why this is not `protobuf`
// ---------------------------------------------------------------------------
// Every other message in this repo is protobuf: a tag, then a length, then the
// payload, recursively. This one is not. It is a fixed 9-byte header, the raw
// `head` bytes, the raw `body` bytes, and one trailing byte:
//
//     offset 0        byte   0x28  '('
//     offset 1..4    uint32  head length   BIG-ENDIAN
//     offset 5..8    uint32  body length   BIG-ENDIAN
//     offset 9       ...     head
//     9+headLen      ...     body
//     last           byte   0x29  ')'
//
// The two 0x28/0x29 bytes are a literal paren pair, not a protobuf tag. Read them
// as a tag and the "field number" comes out as 5 (wire type 0), which then fails
// to parse as a varint for any real head length — a confusing failure a long way
// from the mistake.
//
// The lengths are **big-endian**, which is the trap: every other length in this
// codebase (`protocol.ts` frame header included) is little-endian, because the
// client side is all LE. Getting it backwards produces a frame whose declared
// head length is 16 million and whose body is empty, and the peer answers with a
// parse error rather than a length error.
//
// ---------------------------------------------------------------------------
// `head` and `body` are views, not copies
// ---------------------------------------------------------------------------
// `unpackHighwayFrame` returns `subarray` views into the input buffer. That is
// deliberate and matches the reference: the caller immediately passes `head` to
// `decodeRespDataHighwayHead`, and copying a 1 MiB body per chunk would double
// the transfer's peak memory for no benefit. The consequence is that the input
// buffer must stay alive while the views are used, and that mutating it mutates
// the views — neither of which any caller does, but both of which are why this
// function is not `Buffer.from(...)`.

/** Literal opening byte `'('`. */
export const HIGHWAY_FRAME_OPEN = 0x28;

/** Literal closing byte `')'`. */
export const HIGHWAY_FRAME_CLOSE = 0x29;

/** Bytes of framing overhead: 1 open + 4 headLen + 4 bodyLen. The close byte is extra. */
export const HIGHWAY_FRAME_HEADER_SIZE = 9;

/** Smallest legal frame: header + close byte, with empty head and body. */
export const HIGHWAY_FRAME_MIN_SIZE = HIGHWAY_FRAME_HEADER_SIZE + 1;

/**
 * Wrap an encoded highway head and its body chunk into one frame.
 *
 * Accepts `Uint8Array` rather than `Buffer` because the head comes from
 * `ProtoWriter.finish()`, which produces a plain `Uint8Array`.
 */
export function packHighwayFrame(head: Uint8Array, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(
    HIGHWAY_FRAME_HEADER_SIZE + head.length + body.length + 1,
  );
  frame[0] = HIGHWAY_FRAME_OPEN;
  // DataView writes big-endian when the littleEndian argument is omitted/false, which is
  // exactly what this protocol wants. Writing `true` here would produce a frame that every
  // other implementation rejects.
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(1, head.length, false);
  view.setUint32(5, body.length, false);
  frame.set(head, HIGHWAY_FRAME_HEADER_SIZE);
  frame.set(body, HIGHWAY_FRAME_HEADER_SIZE + head.length);
  frame[frame.length - 1] = HIGHWAY_FRAME_CLOSE;
  return frame;
}

/** The two halves of a frame, as views into the input. */
export interface HighwayFrame {
  /** The encoded `DataHighwayHead` / `RespDataHighwayHead`. */
  head: Uint8Array;
  /** The chunk payload. Empty for the final "this upload is complete" frame. */
  body: Uint8Array;
}

/**
 * Split a frame back into its head and body.
 *
 * Throws `"invalid highway response frame"` — the reference's exact wording — for
 * a frame that is too short or whose delimiters are wrong. That message is
 * reproduced verbatim because it is what operators grep for in the field, and
 * because a *different* message here would suggest the frame parsed far enough to
 * diagnose, which it did not.
 *
 * NOTE: the declared lengths are trusted once the delimiters check out. A frame
 * that claims a head length past the end of the buffer yields short views rather
 * than throwing, matching the reference. The caller validates against
 * `Content-Length` at the HTTP layer, which is where a truncated body is actually
 * detectable.
 */
export function unpackHighwayFrame(frame: Uint8Array): HighwayFrame {
  if (
    frame.length < HIGHWAY_FRAME_MIN_SIZE ||
    frame[0] !== HIGHWAY_FRAME_OPEN ||
    frame[frame.length - 1] !== HIGHWAY_FRAME_CLOSE
  ) {
    throw new Error("invalid highway response frame");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const headLen = view.getUint32(1, false);
  const bodyLen = view.getUint32(5, false);
  return {
    head: frame.subarray(HIGHWAY_FRAME_HEADER_SIZE, HIGHWAY_FRAME_HEADER_SIZE + headLen),
    body: frame.subarray(
      HIGHWAY_FRAME_HEADER_SIZE + headLen,
      HIGHWAY_FRAME_HEADER_SIZE + headLen + bodyLen,
    ),
  };
}
