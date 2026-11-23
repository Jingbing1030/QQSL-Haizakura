/**
 * msg-push `elem.generalFlags` — classification of the tags the reference DROPS.
 *
 * ## Evidence status (read this first)
 *
 * These four tags are observed **only as "dropped by the reference"** in real
 * SnowLuma 2.4.0 logs. Nothing in this file is validated by decoding a real
 * `generalFlags` body byte-for-byte: the reference never exposes the payload, it
 * only reports the tag, the wire type and the encoded byte length. Every claim
 * below is therefore either (a) a fact about the reference's *source*, which is
 * checkable, or (b) explicitly labelled a guess.
 *
 * Observed lines (read-only, from `/app/data/logs/snowluma-2026-11-22.log`
 * inside the `snowluma-hz` and `hz-test` containers):
 *
 *     [MsgPush.UnknownElement] wire element ignored unknownTag=10 wireType=0 count=1 bytes=1   reason=no schema decoder path=elem.generalFlags
 *     [MsgPush.UnknownElement] wire element ignored unknownTag=12 wireType=0 count=1 bytes=1   reason=no schema decoder path=elem.generalFlags
 *     [MsgPush.UnknownElement] wire element ignored unknownTag=13 wireType=0 count=1 bytes=1   reason=no schema decoder path=elem.generalFlags
 *     [MsgPush.UnknownElement] wire element ignored unknownTag=19 wireType=2 count=1 bytes=96..111 reason=no schema decoder path=elem.generalFlags
 *
 * ## Why "ignore" is the correct answer, not a cop-out
 *
 * The reference *does* have a `GeneralFlags` schema — it just has no field for
 * any of these four tags. `protobuf_decode_GeneralFlags$5`
 * (`reference/index.mjs:128384`) is a `switch (_tag)` over exactly five cases:
 *
 *     L128412  case 8   -> field 1  bubbleDiyTextId  (varint)
 *     L128430  case 16  -> field 2  groupFlagNew     (varint)
 *     L128448  case 24  -> field 3  uin              (int64)
 *     L128464  case 48  -> field 6  longTextFlag     (varint)
 *     L128482  case 58  -> field 7  longTextResId    (string)
 *
 * The `_result` object it builds (L128531–L128537) has exactly those five
 * properties. Tags 10/12/13/19 produce no matching `case`, so they reach
 * `default:` (L128502), which calls `__skipUnknownField$92` (L122543) and
 * records the field in the unknown-field metadata. There is **no schema to
 * port**. Inventing field numbers here would fabricate wire semantics the
 * reference does not have, so this module declares IGNORE — and says why.
 *
 * This was verified empirically, not just by reading: running the reference's
 * own extracted `protobuf_decode_GeneralFlags$5` over a body containing
 * tags 10/12/13 (varint) and 19 (110-byte length-delimited) leaves all five
 * known properties `null` and reports exactly those four fields as unknown.
 * Haizakura's `decodeGeneralFlags` (`msg-push-fields.ts:1937`) does the same.
 *
 * ## Who emits the log line
 *
 * `convertElements` calls `logUnknownWireMetadata(elem, "elem")`
 * (`reference/index.mjs:135291`). That walks the object graph
 * (L135166–L135176) appending `.${key}`, so it reaches the `generalFlags`
 * sub-message as path `elem.generalFlags`, and `logUnknownWireFields`
 * (L135177–L135181) formats each entry with
 * `unknownElementLog` (L134923) as
 * `wire element ignored unknownTag=%d wireType=%d count=%d bytes=%d reason=no schema decoder path=%s`.
 * The `reason=no schema` in the log is literally the reference telling you the
 * schema table has no entry — it is not a decode failure.
 *
 * ## What the numbers mean (and what they do not)
 *
 * `bytes=` is `offset - _unknownStart` (L128507), where `_unknownStart` is
 * taken *after* the tag byte was consumed (`const _unknownStart = offset`,
 * L128503; the tag itself is read at L128397). So the logged length is the
 * **value encoding only** — the tag byte is excluded.
 *
 *   * Tags 10/12/13, `wireType=0`, `bytes=1`
 *     A one-byte varint, i.e. a value in `0..127`. Protobuf encoders skip
 *     default (zero) values, so in practice this is `1..127` — most likely
 *     `0x01`, a bool or small enum. **Guess**: these are small flags, exactly
 *     as the bitfield nature of `generalFlags` suggests. The reference throws
 *     the value away, so the actual value is not recoverable from the logs.
 *
 *   * Tag 19, `wireType=2`, `bytes=96..111` (2026-11-22; range 64..184 across
 *     2026-11-20..22)
 *     Length-delimited. `bytes=` counts the length prefix *plus* the payload, so
 *     payload is `bytes - 1` (= 95..110) whenever the length fits in one byte.
 *     **Proven**: it is a nested, self-describing blob the reference skips
 *     opaquely — it never recurses into it, so nothing inside is decoded or
 *     logged. **Guess**: it is a sub-message, not a string; a 95–110 byte
 *     UTF-8 string would be unusual here, and the reference's other
 *     length-delimited `generalFlags` field (7, `longTextResId`) is a string,
 *     which would make 19 something new. Not provable from the logs.
 *
 * ## Scope caveat — {10,12,13,19} is a *subset*
 *
 * The same logs also show `unknownTag=16` (varint, 1 byte) and `unknownTag=17`
 * (varint, 1..3 bytes) at `path=elem.generalFlags`. They are outside this
 * study's brief and therefore have no documented decision here; the fail-open
 * default below routes them to `"decode"` so a caller cannot mistake "not
 * studied" for "known safe to drop". They are dropped by the same reference
 * `default:` branch, so a caller that sees `"decode"` for 16/17 should read the
 * note before acting.
 *
 * @see ts/src/msg-push-fields.ts — `GENERAL_FLAGS_FIELDS` (L1266) / `decodeGeneralFlags` (L1937)
 * @see ts/src/msg-push.ts — `convertElements`, `DECODED_WIRE_FIELDS`, `METADATA_WIRE_FIELDS`
 */

import { WireType } from "./oidb/wire.js";

/**
 * What to do with an unknown `elem.generalFlags` tag.
 *
 * - `"ignore"` — a documented, evidence-backed decision to drop the field,
 *   matching the reference. The note says which reference lines justify it.
 * - `"decode"` — the fail-open default: this tag is **not** covered by a
 *   documented decision, so it must not be silently swallowed. A caller should
 *   surface it (log, metric, or escalation) rather than assume it is safe to
 *   drop. Only tags whose decision was actually established get `"ignore"`.
 */
export type ElemTagAction = "ignore" | "decode";

/** The result of {@link classifyUnknownElemTag}. */
export interface ElemTagClassification {
  /** Documented decision for this tag. */
  readonly action: ElemTagAction;
  /** Human-readable justification, always non-empty. */
  readonly note: string;
}

/**
 * The field numbers the reference's `GeneralFlags` schema **does** decode.
 *
 * From `protobuf_decode_GeneralFlags$5` (`reference/index.mjs:128384`): the
 * switch cases are `8, 16, 24, 48, 58`, i.e. field numbers `tag >>> 3` =
 * `1, 2, 3, 6, 7`. Mirrored by `GENERAL_FLAGS_FIELDS` in
 * `ts/src/msg-push-fields.ts:1266`. Exported so a test can assert that none of
 * the tags in this study collides with a real field.
 */
export const ELEM_GENERAL_FLAGS_DECODED_FIELD_NUMBERS: ReadonlySet<number> =
  new Set([1, 2, 3, 6, 7]);

/** Reference line of each `case` in `protobuf_decode_GeneralFlags$5`, keyed by field number. */
const GENERAL_FLAGS_CASE_LINES: ReadonlyMap<number, number> = new Map([
  [1, 128412],
  [2, 128430],
  [3, 128448],
  [6, 128464],
  [7, 128482],
]);

/** `default:` in `protobuf_decode_GeneralFlags$5` — the branch that skips and records. */
const GENERAL_FLAGS_DEFAULT_LINE = 128502;

/** `protobuf_decode_GeneralFlags$5` function declaration. */
const GENERAL_FLAGS_DECODER_LINE = 128384;

/** `unknownElementLog = createLogger("MsgPush.UnknownElement")`. */
const UNKNOWN_ELEMENT_LOG_LINE = 134923;

/** `logUnknownWireMetadata(elem, "elem")` — the call site that produces `path=elem.generalFlags`. */
const LOG_METADATA_CALL_LINE = 135291;

/** `logUnknownWireFields` — formats the `reason=no schema` line. */
const LOG_FIELDS_LINE = 135179;

const varint = WireType.varint;
const lengthDelimited = WireType.lengthDelimited;

/** One documented decision, before it is keyed into the lookup table. */
interface Decision {
  readonly tag: number;
  readonly action: ElemTagAction;
  readonly note: string;
}

/**
 * The four tags this study covers, with the reasoning that produced each
 * decision. Kept as an ordered array so the table is readable as a document and
 * so tests can pin order and completeness.
 *
 * Every entry is `"ignore"`, and that is the *load-bearing* result: the
 * reference has no decoder for any of them, so "decode" would require inventing
 * field numbers.
 */
const DECISIONS: readonly Decision[] = [
  {
    tag: 10,
    action: "ignore",
    note:
      "IGNORE — no schema. The reference's GeneralFlags decoder " +
      `(reference/index.mjs:${GENERAL_FLAGS_DECODER_LINE}) has cases only for fields ` +
      "1/2/3/6/7 (L128412/L128430/L128448/L128464/L128482); tag 10 wireType=0 " +
      `hits default: (L${GENERAL_FLAGS_DEFAULT_LINE}), is skipped, and is logged as ` +
      `reason=no schema (L${UNKNOWN_ELEMENT_LOG_LINE}/L${LOG_FIELDS_LINE}). ` +
      "Shape: one-byte varint, so value 0..127 (in practice 1..127, since " +
      "defaults are not serialised) — a small flag/bool. Value is not logged and " +
      "is not recoverable; do not guess one. Dropping it matches the reference.",
  },
  {
    tag: 12,
    action: "ignore",
    note:
      "IGNORE — no schema. Same path as tag 10: no case in " +
      `protobuf_decode_GeneralFlags$5 (reference/index.mjs:${GENERAL_FLAGS_DECODER_LINE}, ` +
      `cases at L128412..L128482), so it falls to default: (L${GENERAL_FLAGS_DEFAULT_LINE}). ` +
      "Shape: one-byte varint (value 0..127, in practice 1..127) — a small " +
      "flag/bool alongside 10 and 13. Dropping it matches the reference.",
  },
  {
    tag: 13,
    action: "ignore",
    note:
      "IGNORE — no schema. Same path as tags 10 and 12: no case in " +
      `protobuf_decode_GeneralFlags$5 (reference/index.mjs:${GENERAL_FLAGS_DECODER_LINE}, ` +
      `cases at L128412..L128482), so it falls to default: (L${GENERAL_FLAGS_DEFAULT_LINE}). ` +
      "Shape: one-byte varint (value 0..127, in practice 1..127). 10/12/13 " +
      "arrive as a group on essentially every message. Dropping it matches the " +
      "reference.",
  },
  {
    tag: 19,
    action: "ignore",
    note:
      "IGNORE — no schema, and this one is length-delimited, so do not assume it " +
      "is a flag. The reference's GeneralFlags decoder " +
      `(reference/index.mjs:${GENERAL_FLAGS_DECODER_LINE}) has no case for it; it ` +
      `reaches default: (L${GENERAL_FLAGS_DEFAULT_LINE}) and __skipUnknownField$92 ` +
      "(L122543) skips the whole blob opaquely — the reference never recurses " +
      "into it, so nothing inside is decoded or logged. Shape: wireType=2 with " +
      "bytes=96..111 on 2026-11-22 (64..184 over 2026-11-20..22). The logged " +
      "length is the value encoding only — the tag byte is excluded " +
      "(L128503 takes _unknownStart after the tag is read at L128397) — so " +
      "payload = bytes-1 = 95..110 for a one-byte length prefix. Guess (not " +
      "proven): a nested sub-message. No field numbers are invented here.",
  },
];

/** Lookup table keyed by field number, built once from {@link DECISIONS}. */
const BY_TAG: ReadonlyMap<number, ElemTagClassification> = new Map(
  DECISIONS.map((d): [number, ElemTagClassification] => [
    d.tag,
    Object.freeze({ action: d.action, note: d.note }),
  ]),
);

/** The tags this module has a documented decision for, in study order. */
export const DOCUMENTED_ELEM_TAGS: readonly number[] = Object.freeze(
  DECISIONS.map((d) => d.tag),
);

/**
 * The documented decision for a tag, or `undefined` if this study does not
 * cover it. Prefer {@link classifyUnknownElemTag}, which fails open.
 */
export function documentedElemTagDecision(
  tag: number,
): ElemTagClassification | undefined {
  return BY_TAG.get(tag);
}

/** `true` when this study establishes a decision for `tag`. */
export function isDocumentedElemTag(tag: unknown): boolean {
  return typeof tag === "number" && BY_TAG.has(tag);
}

/**
 * Classify an unknown `elem.generalFlags` wire element.
 *
 * **Fail-open contract.** Only tags {@link DOCUMENTED_ELEM_TAGS} ({10, 12, 13,
 * 19}) can ever return `"ignore"`. Any other valid tag returns `"decode"`, so a
 * caller cannot mistake "not studied" for "proven safe to drop". In particular
 * tags 16 and 17 — which do appear at `path=elem.generalFlags` in the same logs
 * — come back as `"decode"` here, even though the reference also drops them,
 * because this module establishes no decision for them.
 *
 * **Wire type does not change the decision.** The reference switches on
 * `field << 3 | wireType`, so a documented tag arriving with an unexpected wire
 * type simply matches no case and is still skipped. Returning `"ignore"` for it
 * therefore still matches the reference; the note records the deviation so it is
 * visible rather than silent.
 *
 * @param tag        Protobuf field number (`_tag >>> 3`). Must be a positive
 *                   safe integer — field number 0 is invalid on the wire.
 * @param wireType   `_tag & 7`; must be one of the six defined wire types
 *                   (0..5). 6 and 7 are rejected, mirroring
 *                   `__skipUnknownField$92`'s "protobuf invalid wire type".
 * @param byteLength `bytes=` from the log — the encoded **value** length, which
 *                   excludes the tag byte. Must be a non-negative safe integer.
 * @returns The documented decision for a studied tag, otherwise the fail-open
 *          `"decode"` default. Never `undefined`.
 * @throws {RangeError} If any argument is not an integer in its valid range.
 */
export function classifyUnknownElemTag(
  tag: number,
  wireType: number,
  byteLength: number,
): ElemTagClassification {
  if (!Number.isSafeInteger(tag) || tag < 1) {
    // Field number 0 is invalid protobuf, and a non-integer cannot be a tag.
    // Throwing is the opposite of silent, which is what fail-open is about.
    throw new RangeError(
      `invalid protobuf field number: ${String(tag)} (expected a positive safe integer)`,
    );
  }
  if (!Number.isSafeInteger(wireType) || wireType < 0 || wireType > 5) {
    throw new RangeError(
      `invalid protobuf wire type: ${String(wireType)} (expected 0..5; 6 and 7 are invalid on the wire)`,
    );
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError(
      `invalid wire byte length: ${String(byteLength)} (expected a non-negative safe integer)`,
    );
  }

  const decision = BY_TAG.get(tag);
  if (decision !== undefined) {
    return Object.freeze({
      action: decision.action,
      note: `${decision.note} Observed as wireType=${wireType} bytes=${byteLength}.`,
    });
  }

  return Object.freeze({
    action: "decode",
    note:
      `FAIL-OPEN — tag ${tag} has no documented decision in this study ` +
      `(documented tags: ${DOCUMENTED_ELEM_TAGS.join(", ")}). It is not ` +
      "silently swallowed: do not assume it is safe to drop. The reference " +
      `would also skip it via default: (reference/index.mjs:${GENERAL_FLAGS_DEFAULT_LINE}), ` +
      "but that is the reference's behaviour, not a decision recorded here. " +
      `Observed as wireType=${wireType} bytes=${byteLength}.`,
  });
}

/**
 * Describe the part of the schema this module is *not* responsible for: the
 * five `GeneralFlags` fields the reference really decodes. Useful in a log line
 * or test to show the contrast between "has a field" and "has no field".
 */
export function describeDecodedGeneralFlagsFields(): string {
  const parts = [...ELEM_GENERAL_FLAGS_DECODED_FIELD_NUMBERS]
    .sort((a, b) => a - b)
    .map((field) => `${field} (L${GENERAL_FLAGS_CASE_LINES.get(field)})`);
  return `GeneralFlags decodes fields ${parts.join(", ")}; tags ${DOCUMENTED_ELEM_TAGS.join(", ")} are not among them (dropped at L${GENERAL_FLAGS_DEFAULT_LINE}, logged at L${LOG_METADATA_CALL_LINE} -> L${LOG_FIELDS_LINE})`;
}

/**
 * Convenience predicate for the two wire-type shapes seen in the logs, so a
 * caller can assert "this still looks like what we studied" without duplicating
 * magic numbers. Does not affect classification.
 */
export function matchesObservedShape(
  tag: number,
  wireType: number,
  byteLength: number,
): boolean {
  switch (tag) {
    case 10:
    case 12:
    case 13:
      return wireType === varint && byteLength === 1;
    case 19:
      // 2026-11-20..22 observed range; the study brief quoted 96..111.
      return wireType === lengthDelimited && byteLength >= 64 && byteLength <= 184;
    default:
      return false;
  }
}
