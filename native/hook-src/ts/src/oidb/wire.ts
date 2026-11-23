// Hand-rolled protobuf wire-format primitives for the OIDB layer.
//
// ---------------------------------------------------------------------------
// Why hand-rolled
// ---------------------------------------------------------------------------
// The reference bundle (reference/index.mjs) ships a generated codec: for every
// message it emits three functions -- `__size_<T>`, `__write_<T>` and
// `protobuf_decode_<T>` -- that between them cover exactly the protobuf subset
// QQ's OIDB messages use.  Nothing in that subset needs a schema compiler:
//
//   * wire type 0  varint        (uint32, uint64, int32, bool)
//   * wire type 2  length-delimited (string, bytes, nested message, repeated)
//
// There is no zigzag, no fixed32/fixed64, no packed repeated field, and no
// groups in anything we encode.  (The *decoder* still has to be able to skip
// wire types 1/3/4/5 because servers send unknown fields -- see `skipField`.)
// A dependency would buy us nothing here and would put a generated-schema step
// between the extracted field numbers and the bytes on the wire, which is the
// one thing this rewrite is supposed to make auditable.
//
// ---------------------------------------------------------------------------
// The one thing that is easy to get wrong
// ---------------------------------------------------------------------------
// Length-delimited fields need their length *before* their content.  The
// reference solves this with a two-pass `__size_` walk plus a `sizes` side
// stack.  We instead encode each nested message to its own buffer first and
// prepend the length, which is the same bytes with far less bookkeeping --
// and it makes every nested encode function independently testable.
//
// References (all in reference/index.mjs, the codec copy that sits beside the
// envelope and is therefore the one the envelope actually uses):
//   18841  __utf8Read$135        UTF-8 decode, fast path + strict fallback
//   18878  __readVarint32$137    bounded 32-bit varint
//   18898  __checkedEnd$137      length-vs-parent bounds check
//   18902  __skipUnknownField$137 wire types 0/1/2/3/4/5 skipping
//   19173  __utf8Len$130         UTF-8 length without allocating
//   19206  __utf8Write$130       UTF-8 encode
//   23806  __varint64Size$50     varint byte length
//   18793  protobuf_getUnknownFieldMetadata  the 64-entry cap mirrored below

/** Protobuf wire types, as they appear in the low three bits of a tag. */
export const WireType = {
  varint: 0,
  fixed64: 1,
  lengthDelimited: 2,
  startGroup: 3,
  endGroup: 4,
  fixed32: 5,
} as const;

export type WireTypeValue = (typeof WireType)[keyof typeof WireType];

/**
 * The tag byte(s) for a field: `fieldNumber << 3 | wireType`.
 *
 * The reference's generated decoders switch on this combined value rather than
 * on the field number alone (reference/index.mjs:18961 `switch (_tag)`), so a
 * field arriving with an unexpected wire type falls through to the unknown-field
 * branch and is skipped.  Matching that is not pedantry: it is what stops a
 * server that sends field 4 as a varint from being misread as a nested body.
 */
export function tagOf(fieldNumber: number, wireType: number): number {
  return fieldNumber * 8 + wireType;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");
const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });

/** Encode a UTF-8 string, matching `__utf8Len`/`__utf8Write` in the reference. */
export function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/** Decode UTF-8, falling back to replacement characters on malformed input. */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return strictTextDecoder.decode(bytes);
  } catch {
    return textDecoder.decode(bytes);
  }
}

function varintByteLength(value: bigint): number {
  if (value < 0n) throw new RangeError("varint cannot encode a negative value");
  let n = 1;
  let v = value >> 7n;
  while (v > 0n) {
    n++;
    v >>= 7n;
  }
  return n;
}

/**
 * Append a growable byte sink.
 *
 * Deliberately minimal: `append` plus the typed field writers every generated
 * message needs.  Each writer mirrors the *presence rule* the reference encoder
 * uses for that field type, because skipping a field whose value equals the
 * proto3 default is what makes the reference's output byte-identical to QQ's
 * own client.  Getting that rule wrong yields a message the server still
 * parses but which never matches the reference byte-for-byte.
 *
 * Reference presence rules (reference/index.mjs:19981-20180):
 *   uint32 / uint64 / int32  emitted when `!= null && !== 0`  (or `!== 0n`)
 *   bool                     emitted when `=== true`          (so `false` drops)
 *   string                   emitted when `!= null && !== ""`
 *   bytes                    emitted when `!= null && length > 0`
 *   nested message           emitted when `!= null`           (so `{}` still emits)
 */
export class ProtoWriter {
  #buf: Uint8Array;
  #len: number;

  constructor(initialCapacity = 64) {
    // Sanitise the capacity rather than trusting it.
    //
    // `new Uint8Array(NaN)` silently yields a zero-length array, and #ensure then loops
    // `cap *= 2` on a NaN, which never becomes >= need -- so a writer constructed with a
    // non-numeric size hangs forever instead of failing. The caller that does this is easy to
    // write by accident: passing an object where the body length was meant. A hang inside a
    // codec looks like a slow server, which is the most expensive kind of bug to find.
    const requested = Number.isFinite(initialCapacity) ? Math.floor(initialCapacity) : 64;
    this.#buf = new Uint8Array(Math.max(16, requested));
    this.#len = 0;
  }

  /** Bytes written so far. */
  get length(): number {
    return this.#len;
  }

  #ensure(extra: number): void {
    const need = this.#len + extra;
    if (need <= this.#buf.length) return;
    // Start from 16 if the buffer is degenerate, so the doubling below always makes progress.
    // Without this floor, a zero-length buffer keeps cap at 0 and the loop never advances.
    let cap = this.#buf.length > 0 ? this.#buf.length : 16;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.#buf.subarray(0, this.#len));
    this.#buf = next;
  }

  #byte(value: number): void {
    this.#ensure(1);
    this.#buf[this.#len++] = value & 0xff;
  }

  #varint(value: bigint): void {
    if (value < 0n) throw new RangeError("varint cannot encode a negative value");
    let v = value;
    while (v > 0x7fn) {
      this.#byte(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    this.#byte(Number(v));
  }

  #tag(fieldNumber: number, wireType: number): void {
    if (!Number.isInteger(fieldNumber) || fieldNumber <= 0) {
      throw new RangeError(`invalid protobuf field number: ${fieldNumber}`);
    }
    this.#varint(BigInt(fieldNumber) * 8n + BigInt(wireType));
  }

  /**
   * Field of wire type 0 from an unsigned 32-bit value, written even when it is zero.
   *
   * Protobuf treats "absent" and "present but zero" as equivalent for scalars, so most callers
   * should keep using {@link uint32}. The exception is a field the peer requires to be PRESENT:
   * `SegHead.retCode` is emitted unconditionally by the reference
   * (`buf[offset++] = 40;` with no guard), and dropping it produces a head the server parses as
   * complete but missing its return code.
   */
  uint32Always(fieldNumber: number, value: number | undefined | null): this {
    if (value == null) return this;
    this.#tag(fieldNumber, WireType.varint);
    this.#varint(BigInt(value >>> 0));
    return this;
  }

  /** Field of wire type 0 from an unsigned 32-bit value. */
  uint32(fieldNumber: number, value: number | undefined | null): this {
    if (value == null || value === 0) return this;
    const v = value >>> 0;
    this.#tag(fieldNumber, WireType.varint);
    this.#varint(BigInt(v));
    return this;
  }

  /** Field of wire type 0 from a signed 32-bit value (two's complement, 64-bit sign extended). */
  int32(fieldNumber: number, value: number | undefined | null): this {
    if (value == null || value === 0) return this;
    this.#tag(fieldNumber, WireType.varint);
    this.#varint(BigInt.asUintN(64, BigInt(value | 0)));
    return this;
  }

  /** Field of wire type 0 from a 64-bit value. */
  uint64(fieldNumber: number, value: bigint | number | undefined | null): this {
    if (value == null || value === 0n || value === 0) return this;
    this.#tag(fieldNumber, WireType.varint);
    this.#varint(BigInt.asUintN(64, BigInt(value)));
    return this;
  }

  /** Field of wire type 0 that is only emitted when `true` (reference `=== true` rule). */
  bool(fieldNumber: number, value: boolean | undefined | null): this {
    if (value !== true) return this;
    this.#tag(fieldNumber, WireType.varint);
    this.#byte(1);
    return this;
  }

  /** Field of wire type 2 holding UTF-8 text; dropped when empty. */
  string(fieldNumber: number, value: string | undefined | null): this {
    if (value == null || value === "") return this;
    this.#lengthDelimited(fieldNumber, encodeUtf8(value));
    return this;
  }

  /**
   * Field of wire type 0 emitted even when the value is zero.
   *
   * A few messages in the reference use `!= null` as their only presence test
   * instead of the usual `!= null && !== 0`
   * (e.g. Oidb0x89a_0SearchSettings, reference/index.mjs:228492).  For those,
   * an explicit 0 is meaningful — it says "set this to off" — and dropping it
   * would turn a deliberate clear into "leave unchanged".  The rule is per
   * message, not per type, so it gets its own method instead of a flag.
   */
  uint32Present(fieldNumber: number, value: number | undefined | null): this {
    if (value == null) return this;
    this.#tag(fieldNumber, WireType.varint);
    this.#varint(BigInt(value >>> 0));
    return this;
  }

  /**
   * Repeated uint32 emitted non-packed: one tag per element.
   *
   * Non-packed matters. The generated codec in the reference emits repeated uint32 this way
   * (see Oidb0x6ff501's serviceTypes), and an element that happens to be zero still produces a
   * tag -- so "packed would be shorter" is not a valid reason to change the encoding. A decoder
   * that accepts packed input should still accept this, but a peer comparing bytes will not.
   */
  repeatedUint32(fieldNumber: number, values: readonly number[] | undefined | null): this {
    if (values == null) return this;
    for (const value of values) {
      this.#tag(fieldNumber, WireType.varint);
      this.#varint(BigInt(value >>> 0));
    }
    return this;
  }

  /**
   * Field of wire type 0 from an unsigned 64-bit value, emitted even when zero.
   *
   * The 64-bit twin of `uint32Present`, for the same reason: a handful of messages use
   * `!= null` as their whole presence test on a 64-bit field, so an explicit 0 is a real
   * request rather than an absent one. `GetGroupAdminReceiveVerifyRequest`'s
   * `field3: 0` (reference/index.mjs:216368) is the live example -- the reference writes
   * it as `18 00`, and dropping it would change the request.
   */
  uint64Present(fieldNumber: number, value: bigint | number | undefined | null): this {
    if (value == null) return this;
    this.#tag(fieldNumber, WireType.varint);
    this.#varint(BigInt.asUintN(64, BigInt(value)));
    return this;
  }

  /**
   * Repeated uint64 emitted non-packed: one tag per element.
   *
   * The 64-bit twin of `repeatedUint32`. Both are needed because the generated codec picks
   * by field *type*, not by field number: `memberUins` in GetGroupAdminPermissionsRequest is
   * repeated uint64 (`10` per element, reference/index.mjs:214749) while `serviceTypes` in
   * 0x6ff501 is repeated uint32. Reusing one helper for the other happens to produce the same
   * bytes for small values, which is exactly why it would go unnoticed until a uin above
   * 2^32 appears.
   */
  repeatedUint64(fieldNumber: number, values: readonly bigint[] | undefined | null): this {
    if (values == null) return this;
    for (const value of values) {
      this.#tag(fieldNumber, WireType.varint);
      this.#varint(BigInt.asUintN(64, value));
    }
    return this;
  }

  /**
   * Repeated uint32 emitted packed: one tag, then a length, then the values.
   *
   * Provided separately rather than as an option on the method above, because which one a
   * message needs is a property of that message, not of the caller's mood. Mixing them up is
   * silent: both decode to the same array, only the bytes differ.
   */
  packedUint32(fieldNumber: number, values: readonly number[] | undefined | null): this {
    if (values == null || values.length === 0) return this;
    const inner = new ProtoWriter(values.length * 2 + 8);
    for (const value of values) inner.#varint(BigInt(value >>> 0));
    this.#lengthDelimited(fieldNumber, inner.finish());
    return this;
  }

  /** Field of wire type 2 holding UTF-8 text, emitted even when empty (`!= null` rule). */
  stringPresent(fieldNumber: number, value: string | undefined | null): this {
    if (value == null) return this;
    this.#lengthDelimited(fieldNumber, encodeUtf8(value));
    return this;
  }

  /** Field of wire type 2 holding raw bytes; dropped when empty. */
  bytes(fieldNumber: number, value: Uint8Array | undefined | null): this {
    if (value == null || value.length === 0) return this;
    this.#lengthDelimited(fieldNumber, value);
    return this;
  }

  /** Field of wire type 2 holding an already-encoded nested message; emitted even when empty. */
  message(fieldNumber: number, value: Uint8Array | undefined | null): this {
    if (value == null) return this;
    this.#lengthDelimited(fieldNumber, value);
    return this;
  }

  /**
   * Repeated field of wire type 2 holding nested messages; emits one tag per item,
   * and nothing at all for an empty list (reference `_f5 != null && _f5.length > 0`).
   */
  repeatedMessage(fieldNumber: number, values: readonly Uint8Array[] | undefined | null): this {
    if (values == null) return this;
    for (const item of values) this.#lengthDelimited(fieldNumber, item);
    return this;
  }

  /** Repeated field of wire type 2 holding strings. */
  repeatedString(fieldNumber: number, values: readonly string[] | undefined | null): this {
    if (values == null) return this;
    for (const item of values) {
      if (item === "") continue;
      this.#lengthDelimited(fieldNumber, encodeUtf8(item));
    }
    return this;
  }

  #lengthDelimited(fieldNumber: number, payload: Uint8Array): void {
    this.#tag(fieldNumber, WireType.lengthDelimited);
    this.#varint(BigInt(payload.length));
    this.#ensure(payload.length);
    this.#buf.set(payload, this.#len);
    this.#len += payload.length;
  }

  /** A copy of the written bytes. */
  finish(): Uint8Array {
    return this.#buf.slice(0, this.#len);
  }
}

/** Metadata about one unknown field the reader skipped (mirrors the reference's bookkeeping). */
export interface UnknownField {
  fieldNumber: number;
  wireType: number;
  count: number;
  totalByteLength: number;
}

/** Aggregate unknown-field metadata, matching `protobuf_getUnknownFieldMetadata`. */
export interface UnknownFieldMetadata {
  fields: UnknownField[];
  totalOccurrences: number;
  omittedOccurrences: number;
  omittedByteLength: number;
}

export const EMPTY_UNKNOWN_FIELD_METADATA: UnknownFieldMetadata = {
  fields: [],
  totalOccurrences: 0,
  omittedOccurrences: 0,
  omittedByteLength: 0,
};

/** Reference caps the per-message unknown-field list at 64 entries. */
const MAX_TRACKED_UNKNOWN_FIELDS = 64;

/** Collects skipped fields while reading, so a re-encode can be checked for loss. */
export class UnknownFieldCollector {
  #byKey = new Map<number, UnknownField>();
  #fields: UnknownField[] = [];
  #totalOccurrences = 0;
  #omittedOccurrences = 0;
  #omittedByteLength = 0;

  record(fieldNumber: number, wireType: number, byteLength: number): void {
    this.#totalOccurrences++;
    const key = fieldNumber * 8 + wireType;
    const known = this.#byKey.get(key);
    if (known) {
      known.count++;
      known.totalByteLength += byteLength;
      return;
    }
    if (this.#fields.length < MAX_TRACKED_UNKNOWN_FIELDS) {
      const entry: UnknownField = { fieldNumber, wireType, count: 1, totalByteLength: byteLength };
      this.#fields.push(entry);
      this.#byKey.set(key, entry);
      return;
    }
    this.#omittedOccurrences++;
    this.#omittedByteLength += byteLength;
  }

  snapshot(): UnknownFieldMetadata {
    return {
      fields: this.#fields.map((f) => ({ ...f })),
      totalOccurrences: this.#totalOccurrences,
      omittedOccurrences: this.#omittedOccurrences,
      omittedByteLength: this.#omittedByteLength,
    };
  }
}

/**
 * Bounds-checked protobuf reader.
 *
 * Every length is validated against the parent range before a slice happens:
 * the reference does the same (`__checkedEnd`), and it matters here because the
 * bytes come from the server, not from us.  A malformed length is a thrown
 * error, never a read past the end of the buffer.
 */
export class ProtoReader {
  readonly #data: Uint8Array;
  #offset: number;
  readonly #end: number;
  #fieldNumber = 0;
  #wireType = 0;
  #tag = 0;

  constructor(data: Uint8Array, offset = 0, end = data.length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)) {
      throw new Error("Invalid protobuf bounds");
    }
    if (offset < 0 || end > data.length || offset > end) {
      throw new Error("Invalid protobuf bounds");
    }
    this.#data = data;
    this.#offset = offset;
    this.#end = end;
  }

  /** Absolute read position, for callers that need to hand a sub-range to a decoder. */
  get offset(): number {
    return this.#offset;
  }

  get end(): number {
    return this.#end;
  }

  get fieldNumber(): number {
    return this.#fieldNumber;
  }

  /** The full tag (`field << 3 | wireType`) of the current field. */
  get tag(): number {
    return this.#tag;
  }

  get wireType(): number {
    return this.#wireType;
  }

  get done(): boolean {
    return this.#offset >= this.#end;
  }

  #readByte(): number {
    if (this.#offset >= this.#end) throw new Error("Truncated protobuf varint");
    return this.#data[this.#offset++]!;
  }

  /** Read a varint of at most 64 bits, returned as a bigint. */
  #readVarint64(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = this.#readByte();
      if (i === 9 && byte > 1) throw new Error("protobuf varint overflow");
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new Error("protobuf varint overflow");
  }

  /**
   * Read a varint and narrow it to 32 bits, exactly as every generated decoder in
   * the reference does.
   *
   * The reference does NOT use a 5-byte-limited reader here.  Its generated
   * decoders inline the same loop (e.g. reference/index.mjs:248540):
   *
   *     let _val = data[offset++];
   *     if (_val & 128) { ...
   *       do { _b = data[offset++];
   *            if (_s === 63 && _b > 1) throw new Error("Invalid protobuf varint");
   *            if (_s < 32) _val |= (_b & 127) << _s;      // bits past 32 are dropped
   *            _s += 7; } while (_b & 128);
   *       _val >>>= 0;
   *     }
   *
   * Two consequences, both load-bearing:
   *
   *  - A 10-byte varint is legal even for a 32-bit field.  That is how a negative
   *    int32 is encoded on the wire (`-1` -> ff ff ff ff ff ff ff ff ff 01), so a
   *    5-byte limit would reject every negative retCode the server can send.
   *  - The `_s < 32` guard means bytes beyond the 32nd bit are skipped, not
   *    rejected.  The value is the low 32 bits, then `>>> 0`.
   *
   * `__readVarint32` (5-byte, strict) also exists in the reference, but only the
   * envelope/tag-machinery helpers use it; no generated field decoder does.
   */
  #readVarint32(): number {
    let byte = this.#readByte();
    if ((byte & 0x80) === 0) return byte >>> 0;
    let value = byte & 0x7f;
    let shift = 7;
    for (;;) {
      if (this.#offset >= this.#end) throw new Error("Truncated protobuf varint");
      byte = this.#readByte();
      // Only the tenth byte may carry a bit above 63; anything larger means the
      // varint does not fit in 64 bits at all.
      if (shift === 63 && byte > 1) throw new Error("Invalid protobuf varint");
      if (shift < 32) value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return value >>> 0;
  }

  /**
   * Advance to the next field.  Returns false at the end of the range.
   * Throws on a field number of 0, which protobuf forbids.
   */
  next(): boolean {
    if (this.#offset >= this.#end) return false;
    const tag = this.#readVarint32();
    const fieldNumber = tag >>> 3;
    if (fieldNumber === 0) throw new Error("Invalid protobuf field number");
    this.#fieldNumber = fieldNumber;
    this.#wireType = tag & 7;
    this.#tag = tag;
    return true;
  }

  /** Read the current field as an unsigned 32-bit varint. */
  uint32(): number {
    return this.#readVarint32();
  }

  /** Read the current field as an unsigned 64-bit varint. */
  uint64(): bigint {
    return this.#readVarint64();
  }

  /** Read the current field as a signed 32-bit value, matching the reference's `| 0`. */
  int32(): number {
    return this.#readVarint32() | 0;
  }

  /** Read the current field as a bool. */
  bool(): boolean {
    return this.#readVarint32() !== 0;
  }

  /** Read the current field as a length-delimited range. */
  #range(): { start: number; end: number } {
    const length = this.#readVarint32();
    const start = this.#offset;
    if (length > this.#end - start) throw new Error("protobuf length-delimited field exceeds parent bounds");
    this.#offset = start + length;
    return { start, end: start + length };
  }

  /** Read the current field as UTF-8 text. */
  string(): string {
    const { start, end } = this.#range();
    return decodeUtf8(this.#data.subarray(start, end));
  }

  /** Read the current field as raw bytes (a copy, so the caller owns it). */
  bytes(): Uint8Array {
    const { start, end } = this.#range();
    return this.#data.slice(start, end);
  }

  /**
   * Read the current field as a nested message, decoded by `decode` over the
   * sub-range.  Passing the range rather than a copy keeps large nested
   * payloads (file lists, group lists) from being copied twice.
   */
  message<T>(decode: (data: Uint8Array, offset: number, end: number) => T): T {
    const { start, end } = this.#range();
    return decode(this.#data, start, end);
  }

  /** Skip the current field, reporting it to the collector when one is supplied. */
  skip(collector?: UnknownFieldCollector): void {
    const start = this.#offset;
    this.#skipValue(this.#wireType, this.#fieldNumber);
    collector?.record(this.#fieldNumber, this.#wireType, this.#offset - start);
  }

  #skipValue(wireType: number, fieldNumber: number, depth = 0): void {
    if (depth > 64) throw new Error("protobuf group nesting exceeds 64");
    switch (wireType) {
      case WireType.varint:
        this.#readVarint64();
        return;
      case WireType.fixed64:
        if (this.#end - this.#offset < 8) throw new Error("protobuf truncated fixed64 field");
        this.#offset += 8;
        return;
      case WireType.lengthDelimited: {
        const length = this.#readVarint32();
        if (length > this.#end - this.#offset) {
          throw new Error("protobuf length-delimited field exceeds parent bounds");
        }
        this.#offset += length;
        return;
      }
      case WireType.startGroup:
        for (;;) {
          if (this.#offset >= this.#end) throw new Error("protobuf unterminated group");
          const tag = this.#readVarint32();
          const nestedField = tag >>> 3;
          const nestedWire = tag & 7;
          if (nestedField === 0) throw new Error("protobuf field number 0 is invalid");
          if (nestedWire === WireType.endGroup) {
            if (nestedField !== fieldNumber) throw new Error("protobuf mismatched end-group tag");
            return;
          }
          this.#skipValue(nestedWire, nestedField, depth + 1);
        }
      case WireType.endGroup:
        throw new Error("protobuf unexpected end-group tag");
      case WireType.fixed32:
        if (this.#end - this.#offset < 4) throw new Error("protobuf truncated fixed32 field");
        this.#offset += 4;
        return;
      default:
        throw new Error("protobuf invalid wire type " + wireType);
    }
  }
}