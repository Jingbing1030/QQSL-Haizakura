// The reaction + interaction family: 0xed3_1, 0xeac_1|2, 0x9082_1|2,
// 0x9083_1, 0x9084_1.
//
// ---------------------------------------------------------------------------
// Naming: every label in the brief was right, and that is itself worth recording
// ---------------------------------------------------------------------------
// This is the third batch in a row where the brief's labels all resolve to a real
// spec variable of the same name, but the *numbers* still could not have been
// guessed:
//
//   SendPoke            0xed3     (3795)  sub 1
//   SetEssence          0xeac     (3756)  sub 1 when setting, 2 when clearing
//   SetReaction         0x9082   (36994)  sub 1 when setting, 2 when clearing
//   GetEmojiLikes       0x9083   (36995)  sub 1
//   FetchReactionSummary 0x9084  (36996)  sub 1
//
// Note that the three reaction commands **are** a contiguous run (36994/36995/
// 36996) while the two interaction commands are not (3795 and 3756, which are
// merely close). Both facts are accidents; the group was found by grepping the
// spec names, not by walking the numbers.
//
// ---------------------------------------------------------------------------
// The trap in this family: one command, two sub-commands, no `_0`
// ---------------------------------------------------------------------------
// `SetEssence` and `SetReaction` have **no** `subCommand` constant at all — they
// declare only `resolveSubCommand`:
//
//     SetEssence.resolveSubCommand  = (p) => p.enable ? 1 : 2      L293146
//     SetReaction.resolveSubCommand = (p) => p.isSet ? 1 : 2       L296914
//
// So `0x9082_0` and `0xeac_0` do not exist, and unlike 0x8a0_1 the two
// sub-commands carry the *same* message — only the number changes. That is the
// opposite of the 0x8a0_1 situation, and both are one line apart in the spec
// object, so the distinction cannot be inferred from the shape of the code.
//
// ---------------------------------------------------------------------------
// Field-number surprises (all read off the extracted tag bytes, not guessed)
// ---------------------------------------------------------------------------
//   OidbPoke (0xed3_1 body)                     L291980 / 292008
//     1 uin, 2 groupUin, **5 friendUin, 6 ext**   -- fields 3 and 4 do not exist.
//     The request is a single flat message: `isGroup` decides *which* of 2/5 is
//     populated, and the other is written as an explicit 0 and then dropped.
//
//   OidbEssence (0xeac body)                    L293044 / 293066
//     1 groupUin, 2 sequence, 3 random            -- no field for the enable bit:
//     "set" vs "clear" lives *entirely* in the sub-command.
//
//   OidbGroupReaction (0x9082 body)             L296764 / 296797
//     **2 groupUin, 3 sequence, 4 code, 5 type, 6 field6, 7 field7**
//     The message starts at field 2 — there is no field 1. `field6`/`field7` are
//     booleans with the `=== true` rule and `serialize` hard-codes both to false,
//     so they never reach the wire; they are typed and encoded anyway so that a
//     caller who needs them is not silently ignored.
//
//   Oidb0x9084Req (0x9084 body)                 L293817 / 293856
//     **2 groupId(uint64), 3 sequence(uint64), 4 emojiId, 5 emojiType,
//     6 cookie(bytes), 8 count, 12 field12**    -- also starts at 2, and skips 7.
//     `serialize` sends `emojiId: ""`, `emojiType: 0`, `cookie: empty`,
//     `count: 0` and `field12: 1`, so the only fields that survive the presence
//     rules are 2, 3 and 12. Field 12 as a *request* field is unusual — it is not
//     the envelope's `reserved`, it is inside the body.
//
//   Oidb0x9083Req (0x9083 body)                 L295152 / 295192
//     **2 groupId(uint64), 3 sequence(uint64), 4 emojiType, 5 emojiId(string),
//     6 cookie(string!), 7 field7, 8 count**
//     ⚠️ `cookie` is a **string** here and **bytes** in 0x9084. Same name, same
//     request family, different wire type; reading either with the other's
//     decoder yields "" / empty rather than an error.
//
// ---------------------------------------------------------------------------
// Response shapes are NOT the request shapes, and one has a dead field
// ---------------------------------------------------------------------------
//   Oidb0x9084Resp       1 field1, 2 entries[]                  L294210
//   Oidb0x9084RespEntry  1 lastReactionTime(uint64), 2 count, 3 emojiType, 4 emojiId
//   Oidb0x9083Resp       1 users[], 2 cookie, 3 isLast, 4 isFirst
//   Oidb0x9083RespUser   1 uin(uint64), 2 nick, 3 headUrl
//
// `Oidb0x9084Resp.field1` is decoded into a slot that `deserialize` never reads,
// and `isFirst` is likewise decoded and dropped. Both are modelled here so the
// decoder consumes the field instead of skipping it as unknown — the reference's
// own decoder does the same, and a body re-encoded after our decode would
// otherwise lose them.
//
// The three write commands answer with `OidbEmpty`, whose every field is skipped
// and whose `deserialize` returns `undefined` for all of them.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import { decodeOidbEmpty, type OidbEmpty } from "./0x89a-0.js";

// ---------------------------------------------------------------------------
// Command numbers
// ---------------------------------------------------------------------------

/** 3795 = 0xed3 — poke. */
export const SEND_POKE_COMMAND = 0xed3;
/** 3756 = 0xeac — group essence (set / unset). */
export const SET_ESSENCE_COMMAND = 0xeac;
/** 36994 = 0x9082 — message reaction (set / unset). */
export const SET_REACTION_COMMAND = 0x9082;
/** 36995 = 0x9083 — who reacted with one emoji. */
export const GET_EMOJI_LIKES_COMMAND = 0x9083;
/** 36996 = 0x9084 — per-emoji reaction tally. */
export const FETCH_REACTION_SUMMARY_COMMAND = 0x9084;

/** Both reaction-state writes pick 1 to set and 2 to clear; there is no 0. */
export const REACTION_SET_SUB_COMMAND = 1;
export const REACTION_CLEAR_SUB_COMMAND = 2;

/** `SendPoke`, `GetEmojiLikes` and `FetchReactionSummary` are plain `_1`s. */
export const SEND_POKE_SUB_COMMAND = 1;
export const GET_EMOJI_LIKES_SUB_COMMAND = 1;
export const FETCH_REACTION_SUMMARY_SUB_COMMAND = 1;

/**
 * `SetReaction.type` is 2 for a "big" emoji id and 1 otherwise.
 *
 * The threshold is the *string length* of the code, not its numeric value
 * (reference/index.mjs:296917 `type: p.code.length > 3 ? 2 : 1`), so `"76"` is 1
 * and `"128512"` is 2. Written as a named helper because "longer than three
 * characters" reads like a length check for a text field and is in fact the ONLY
 * thing distinguishing a small emoji from a large one on the wire.
 */
export function reactionType(code: string): number {
  return code.length > 3 ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

/** `OidbPoke` — the flat 0xed3_1 body. Fields 3 and 4 do not exist. */
export const OidbPokeField = { uin: 1, groupUin: 2, friendUin: 5, ext: 6 } as const;

/** `OidbEssence` — no enable bit; the sub-command carries it. */
export const OidbEssenceField = { groupUin: 1, sequence: 2, random: 3 } as const;

/** `OidbGroupReaction` — starts at field 2. */
export const OidbGroupReactionField = {
  groupUin: 2,
  sequence: 3,
  code: 4,
  type: 5,
  field6: 6,
  field7: 7,
} as const;

/** `Oidb0x9084Req` — starts at 2, skips 7, and ends with a `field12`. */
export const Oidb0x9084ReqField = {
  groupId: 2,
  sequence: 3,
  emojiId: 4,
  emojiType: 5,
  cookie: 6,
  count: 8,
  field12: 12,
} as const;

/** `Oidb0x9084Resp` / `Oidb0x9084RespEntry`. */
export const Oidb0x9084RespField = { field1: 1, entries: 2 } as const;
export const Oidb0x9084RespEntryField = {
  lastReactionTime: 1,
  count: 2,
  emojiType: 3,
  emojiId: 4,
} as const;

/** `Oidb0x9083Req` — `cookie` is a STRING here, unlike 0x9084's bytes. */
export const Oidb0x9083ReqField = {
  groupId: 2,
  sequence: 3,
  emojiType: 4,
  emojiId: 5,
  cookie: 6,
  field7: 7,
  count: 8,
} as const;

export const Oidb0x9083RespField = { users: 1, cookie: 2, isLast: 3, isFirst: 4 } as const;
export const Oidb0x9083RespUserField = { uin: 1, nick: 2, headUrl: 3 } as const;

// ---------------------------------------------------------------------------
// 0xed3_1 — poke
// ---------------------------------------------------------------------------

export interface OidbPoke {
  /** The poked person's uin; falls back to the peer's own uin in a 1:1 chat. */
  uin: number;
  /** Populated only in a group chat. */
  groupUin: number;
  /** Populated only in a 1:1 chat — note field **5**, not 3. */
  friendUin: number;
  /** Hard-coded to 0 by `serialize`, so never emitted. */
  ext: number;
}

export function encodeOidbPoke(body: OidbPoke): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbPokeField.uin, body.uin)
    .uint32(OidbPokeField.groupUin, body.groupUin)
    .uint32(OidbPokeField.friendUin, body.friendUin)
    .uint32(OidbPokeField.ext, body.ext)
    .finish();
}

// ---------------------------------------------------------------------------
// 0xeac_1|2 — group essence
// ---------------------------------------------------------------------------

export interface OidbEssence {
  groupUin: number;
  sequence: number;
  random: number;
}

export function encodeOidbEssence(body: OidbEssence): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbEssenceField.groupUin, body.groupUin)
    .uint32(OidbEssenceField.sequence, body.sequence)
    .uint32(OidbEssenceField.random, body.random)
    .finish();
}

// ---------------------------------------------------------------------------
// 0x9082_1|2 — message reaction
// ---------------------------------------------------------------------------

export interface OidbGroupReaction {
  groupUin: number;
  sequence: number;
  /** The emoji id as a decimal string, e.g. `"76"` or `"128512"`. */
  code: string;
  /** 1 for a small emoji, 2 for a large one — see `reactionType`. */
  type: number;
  /** `=== true` guard; `serialize` hard-codes false, so it never reaches the wire. */
  field6: boolean;
  /** Same rule; also always false in `serialize`. */
  field7: boolean;
}

export function encodeOidbGroupReaction(body: OidbGroupReaction): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbGroupReactionField.groupUin, body.groupUin)
    .uint32(OidbGroupReactionField.sequence, body.sequence)
    .string(OidbGroupReactionField.code, body.code)
    .uint32(OidbGroupReactionField.type, body.type)
    // `.bool` implements the reference's `=== true` rule; both are always false
    // in `serialize`, so this is dead space on the wire but live in the type.
    .bool(OidbGroupReactionField.field6, body.field6)
    .bool(OidbGroupReactionField.field7, body.field7)
    .finish();
}

// ---------------------------------------------------------------------------
// 0x9084_1 — reaction tally
// ---------------------------------------------------------------------------

export interface Oidb0x9084Req {
  /** uint64 on the wire; `serialize` widens with `BigInt()`. */
  groupId: bigint;
  sequence: bigint;
  /** The reference always sends "" (dropped). */
  emojiId: string;
  /** The reference always sends 0 (dropped). */
  emojiType: number;
  /** **Bytes** here; 0x9083's `cookie` is a string. Empty is dropped. */
  cookie: Uint8Array;
  /** Always 0 in `serialize` (dropped). */
  count: number;
  /** The one non-default constant: `field12: 1`. */
  field12: number;
}

export function encodeOidb0x9084Req(body: Oidb0x9084Req): Uint8Array {
  return new ProtoWriter()
    .uint64(Oidb0x9084ReqField.groupId, body.groupId)
    .uint64(Oidb0x9084ReqField.sequence, body.sequence)
    .string(Oidb0x9084ReqField.emojiId, body.emojiId)
    .uint32(Oidb0x9084ReqField.emojiType, body.emojiType)
    .bytes(Oidb0x9084ReqField.cookie, body.cookie)
    .uint32(Oidb0x9084ReqField.count, body.count)
    .uint32(Oidb0x9084ReqField.field12, body.field12)
    .finish();
}

export interface Oidb0x9084RespEntry {
  /**
   * uint64 on the wire. `null` when absent — the generated decoder starts every
   * scalar at `null`, NOT at `0n` (`let _f0 = null`, reference/index.mjs:294317),
   * and `deserialize` leans on that with `Number(e.lastReactionTime ?? 0n)`.
   */
  lastReactionTime: bigint | null;
  count: number | null;
  emojiType: number | null;
  emojiId: string | null;
}

export interface Oidb0x9084Resp {
  /** Decoded but never read by `deserialize`; kept so it survives a re-encode. */
  field1: number | null;
  entries: Oidb0x9084RespEntry[];
}

export function decodeOidb0x9084RespEntry(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x9084RespEntry {
  const reader = new ProtoReader(data, offset, end);
  // Every slot starts at `null`, exactly as `protobuf_decode_Oidb0x9084RespEntry`
  // does (`_f0.._f3 = null`, reference/index.mjs:294317). Initialising to 0 here
  // would erase the difference between "server sent 0" and "server sent nothing",
  // which is the bug the batch-C probe caught in four goldens at once.
  const entry: Oidb0x9084RespEntry = {
    lastReactionTime: null,
    count: null,
    emojiType: null,
    emojiId: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x9084RespEntryField.lastReactionTime, WireType.varint):
        entry.lastReactionTime = reader.uint64();
        break;
      case tagOf(Oidb0x9084RespEntryField.count, WireType.varint):
        entry.count = reader.uint32();
        break;
      case tagOf(Oidb0x9084RespEntryField.emojiType, WireType.varint):
        entry.emojiType = reader.uint32();
        break;
      case tagOf(Oidb0x9084RespEntryField.emojiId, WireType.lengthDelimited):
        entry.emojiId = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return entry;
}

export function decodeOidb0x9084Resp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x9084Resp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0x9084Resp = { field1: null, entries: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x9084RespField.field1, WireType.varint):
        resp.field1 = reader.uint32();
        break;
      case tagOf(Oidb0x9084RespField.entries, WireType.lengthDelimited):
        resp.entries.push(reader.message(decodeOidb0x9084RespEntry));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/** One emoji's tally, after `deserialize` drops the empty entries. */
export interface ReactionTally {
  emojiId: string;
  /** Defaults to **1** when the server omits it, not to 0. */
  emojiType: number;
  count: number;
  lastReactionTime: number;
}

/**
 * The reference's `FetchReactionSummary.deserialize` (reference/index.mjs:294480).
 *
 * Two behaviours worth keeping: entries whose `count <= 0` are **skipped** rather
 * than reported (a zero-count emoji is a deleted reaction, not an empty page),
 * and `emojiType` defaults to 1.
 */
export function toReactionTallies(resp: Oidb0x9084Resp): ReactionTally[] {
  const out: ReactionTally[] = [];
  for (const entry of resp.entries ?? []) {
    const count = entry.count ?? 0;
    if (count <= 0) continue;
    out.push({
      emojiId: entry.emojiId ?? "",
      emojiType: entry.emojiType ?? 1,
      count,
      lastReactionTime: Number(entry.lastReactionTime ?? 0n),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 0x9083_1 — who reacted
// ---------------------------------------------------------------------------

export interface Oidb0x9083Req {
  groupId: bigint;
  sequence: bigint;
  /** Defaults to 1 in `serialize`. */
  emojiType: number;
  emojiId: string;
  /** A **string**, unlike 0x9084's bytes cookie. Empty is dropped. */
  cookie: string;
  /** Always 0 in `serialize` (dropped). */
  field7: number;
  /** Defaults to 10 in `serialize`. */
  count: number;
}

export function encodeOidb0x9083Req(body: Oidb0x9083Req): Uint8Array {
  return new ProtoWriter()
    .uint64(Oidb0x9083ReqField.groupId, body.groupId)
    .uint64(Oidb0x9083ReqField.sequence, body.sequence)
    .uint32(Oidb0x9083ReqField.emojiType, body.emojiType)
    .string(Oidb0x9083ReqField.emojiId, body.emojiId)
    .string(Oidb0x9083ReqField.cookie, body.cookie)
    .uint32(Oidb0x9083ReqField.field7, body.field7)
    .uint32(Oidb0x9083ReqField.count, body.count)
    .finish();
}

export interface Oidb0x9083RespUser {
  /** uint64; `null` when absent (the reference's slot starts at `null`). */
  uin: bigint | null;
  nick: string | null;
  headUrl: string | null;
}

export interface Oidb0x9083Resp {
  users: Oidb0x9083RespUser[];
  cookie: string | null;
  /**
   * `null` when absent, a boolean when present — the generated decoder narrows
   * field 3 with `_val !== 0` (reference/index.mjs:295617), so this is a BOOL slot.
   * `deserialize` depends on that: `body.isLast ?? !cookie` is `??` over a
   * boolean|null, and a `false` from the server survives it.
   */
  isLast: boolean | null;
  /**
   * Same narrowing (`_val !== 0`, :295636), decoded and then dropped by
   * `deserialize`; kept so a re-encode is lossless.
   */
  isFirst: boolean | null;
}

export function decodeOidb0x9083RespUser(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x9083RespUser {
  const reader = new ProtoReader(data, offset, end);
  const user: Oidb0x9083RespUser = { uin: null, nick: null, headUrl: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x9083RespUserField.uin, WireType.varint):
        user.uin = reader.uint64();
        break;
      case tagOf(Oidb0x9083RespUserField.nick, WireType.lengthDelimited):
        user.nick = reader.string();
        break;
      case tagOf(Oidb0x9083RespUserField.headUrl, WireType.lengthDelimited):
        user.headUrl = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return user;
}

export function decodeOidb0x9083Resp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x9083Resp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0x9083Resp = { users: [], cookie: null, isLast: null, isFirst: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x9083RespField.users, WireType.lengthDelimited):
        resp.users.push(reader.message(decodeOidb0x9083RespUser));
        break;
      case tagOf(Oidb0x9083RespField.cookie, WireType.lengthDelimited):
        resp.cookie = reader.string();
        break;
      case tagOf(Oidb0x9083RespField.isLast, WireType.varint):
        // `.bool`, not `.uint32`: the generated decoder assigns `_val !== 0`.
        resp.isLast = reader.bool();
        break;
      case tagOf(Oidb0x9083RespField.isFirst, WireType.varint):
        resp.isFirst = reader.bool();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface EmojiLikesPage {
  users: { uin: number }[];
  cookie: string;
  isLast: boolean;
}

/**
 * The reference's `GetEmojiLikes.deserialize` (reference/index.mjs:295830).
 *
 * The line is `isLast: body.isLast ?? !cookie`, which works only because the two
 * sides of `??` have the same type: the generated decoder narrows field 3 with
 * `_val !== 0` (reference/index.mjs:295617), so `body.isLast` is `boolean | null`
 * and `!cookie` is a boolean. Hence:
 *
 *   field absent       -> `null ?? !cookie`  -> true when there is no cookie
 *   field present as 0 -> `false`            -> the server's opinion, kept
 *
 * An explicit `false` therefore does NOT fall through to the cookie heuristic —
 * that is the behaviour `emojilikes_resp_explicit_0` pins (cookie present,
 * isLast 0 -> `false`), and it would be lost if the slot were decoded as a number,
 * because `0 ?? x` is `0` and the wrong branch is taken on a truthiness test.
 */
export function toEmojiLikesPage(resp: Oidb0x9083Resp): EmojiLikesPage {
  const users = (resp.users ?? [])
    .map((u) => ({ uin: Number(u?.uin ?? 0) }))
    .filter((u) => u.uin > 0);
  const cookie = resp.cookie ?? "";
  return { users, cookie, isLast: resp.isLast ?? !cookie };
}


// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface SendPokeParams {
  /** The group id in a group chat, the friend's uin in a 1:1 chat. */
  peerUin: number;
  /** The person actually poked; defaults to `peerUin`. */
  targetUin?: number | undefined;
  isGroup: boolean;
}

export const SendPoke: OidbSpec<SendPokeParams, OidbPoke, OidbEmpty, void> = {
  command: SEND_POKE_COMMAND,
  subCommand: SEND_POKE_SUB_COMMAND,
  serialize: (params) => {
    const peerUin = Number(params.peerUin);
    const targetUin = Number(params.targetUin ?? params.peerUin);
    return {
      uin: targetUin,
      // Both are always *set*; the presence rule then drops whichever is 0. In a
      // group chat `friendUin` is 0 and vanishes; in a 1:1 chat `groupUin` is.
      groupUin: params.isGroup ? peerUin : 0,
      friendUin: params.isGroup ? 0 : peerUin,
      ext: 0,
    };
  },
  encodeBody: encodeOidbPoke,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface SetEssenceParams {
  groupId: number | bigint;
  /** The message's sequence, as reported by a msg-push event. */
  sequence: number;
  /** The message's random, as reported by a msg-push event. */
  random: number;
  /** `true` sets the essence, `false` clears it — this is the only difference. */
  enable: boolean;
}

export const SetEssence: OidbSpec<SetEssenceParams, OidbEssence, OidbEmpty, void> = {
  command: SET_ESSENCE_COMMAND,
  // No `subCommand`: the reference resolves 1 or 2 per call and never uses 0.
  resolveSubCommand: (params) => (params.enable ? REACTION_SET_SUB_COMMAND : REACTION_CLEAR_SUB_COMMAND),
  serialize: (params) => ({
    groupUin: Number(params.groupId),
    sequence: params.sequence,
    // `random: 0` is a legitimate value and is dropped by the `!== 0` rule; the
    // reference does the same, so a zero random really is absent on the wire.
    random: params.random,
  }),
  encodeBody: encodeOidbEssence,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface SetReactionParams {
  groupId: number | bigint;
  sequence: number;
  /** The emoji id as a decimal string. Its LENGTH picks `type` (1 vs 2). */
  code: string;
  /** `true` adds the reaction, `false` removes it. */
  isSet: boolean;
}

export const SetReaction: OidbSpec<SetReactionParams, OidbGroupReaction, OidbEmpty, void> = {
  command: SET_REACTION_COMMAND,
  resolveSubCommand: (params) => (params.isSet ? REACTION_SET_SUB_COMMAND : REACTION_CLEAR_SUB_COMMAND),
  serialize: (params) => ({
    groupUin: Number(params.groupId),
    sequence: params.sequence,
    code: params.code,
    // `type` is derived, never passed in: the reference derives it from the code.
    type: reactionType(params.code),
    field6: false,
    field7: false,
  }),
  encodeBody: encodeOidbGroupReaction,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface FetchReactionSummaryParams {
  groupId: number | bigint;
  sequence: number | bigint;
}

export const FetchReactionSummary: OidbSpec<
  FetchReactionSummaryParams,
  Oidb0x9084Req,
  Oidb0x9084Resp,
  ReactionTally[]
> = {
  command: FETCH_REACTION_SUMMARY_COMMAND,
  subCommand: FETCH_REACTION_SUMMARY_SUB_COMMAND,
  serialize: (params) => ({
    groupId: BigInt(params.groupId),
    sequence: BigInt(params.sequence),
    // These four are constants in the reference's `serialize`; every one of them
    // is dropped by the presence rules, so the request that goes out is fields
    // 2, 3 and 12 only.
    emojiId: "",
    emojiType: 0,
    cookie: new Uint8Array(0),
    count: 0,
    field12: 1,
  }),
  encodeBody: encodeOidb0x9084Req,
  decodeBody: decodeOidb0x9084Resp,
  deserialize: toReactionTallies,
};

export interface GetEmojiLikesParams {
  groupId: number | bigint;
  sequence: number | bigint;
  /** The emoji id as a decimal string (the request field is a *string*). */
  emojiId: string;
  /** Defaults to 1. */
  emojiType?: number | undefined;
  /** Continuation cookie from a previous page; omitted on the first call. */
  cookie?: string | undefined;
  /** Defaults to 10. */
  count?: number | undefined;
}

export const GetEmojiLikes: OidbSpec<
  GetEmojiLikesParams,
  Oidb0x9083Req,
  Oidb0x9083Resp,
  EmojiLikesPage
> = {
  command: GET_EMOJI_LIKES_COMMAND,
  subCommand: GET_EMOJI_LIKES_SUB_COMMAND,
  serialize: (params) => ({
    groupId: BigInt(params.groupId),
    sequence: BigInt(params.sequence),
    emojiType: params.emojiType ?? 1,
    emojiId: params.emojiId,
    cookie: params.cookie ?? "",
    field7: 0,
    count: params.count ?? 10,
  }),
  encodeBody: encodeOidb0x9083Req,
  decodeBody: decodeOidb0x9083Resp,
  deserialize: toEmojiLikesPage,
};