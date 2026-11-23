// OidbSvcTrpcTcp.0x112a_2 — TWO different specs on one command/sub-command pair.
//
// ---------------------------------------------------------------------------
// The trap in this command id
// ---------------------------------------------------------------------------
// `0x112a_2` is not one command.  The reference defines two independent specs,
// both on `command 4394, subCommand 2`, with **different request messages and
// different response decoders**:
//
//   SetProfile        reference/index.mjs:331456   encode OidbBase__OidbSetProfile
//                                                  decode Oidb0x112aResp$1
//   SetSelfLongNick   reference/index.mjs:332544   encode OidbBase__Oidb0x112aReq
//                                                  decode Oidb0x112aResp
//
// They are the `set_qq_profile` and `set_self_longnick` actions respectively.
// Whichever one the caller means is impossible to tell from the id alone — the
// discriminator is *which encoder was used to build the body*.  Sending the
// `OidbSetProfile` body to a server expecting `Oidb0x112aReq` produces a request
// whose field 2 is a repeated message where a single message is expected, which
// the server reads as "no profile", i.e. a silent no-op success.
//
// This is the same shape as the already-ported `0x102a_0`/`0x102a_1` split: one
// id, several bodies.  The two specs are kept as separate exports here so a
// caller cannot accidentally pick "the" 0x112a encoder.
//
// ---------------------------------------------------------------------------
// SetProfile field numbers            (reference/index.mjs:331284 .. 331451)
// ---------------------------------------------------------------------------
//   OidbSetProfile
//     1 uin           uint64                    the CALLER's own uin
//     2 stringProfiles repeated OidbProfileStringItem
//     3 intProfiles    repeated OidbProfileIntItem
//
//   OidbProfileStringItem   1 fieldId uint32 / 2 value string
//   OidbProfileIntItem      1 fieldId uint32 / 2 value uint64   <-- note uint64
//
// The field ids inside those items are the profile *field selectors*, and they
// are not contiguous or guessable (reference/index.mjs:331462):
//
//     nickname     -> 20002   (string)
//     personalNote -> 102     (string)
//     sex          -> 20009   (int, sent as BigInt)
//
// `sex` is the only one that goes in `intProfiles`, and it is a uint64 on the
// wire even though the value is 0/1/2.
//
// ---------------------------------------------------------------------------
// SetSelfLongNick field numbers       (reference/index.mjs:332167 .. 332264)
// ---------------------------------------------------------------------------
//   Oidb0x112aReq
//     1 uin     uint64
//     2 profile Oidb0x112aProfileInfo    <-- singular message, not repeated
//   Oidb0x112aProfileInfo
//     1 tag   uint32   hard-coded 102
//     2 value string   the long nick
//
// The `tag: 102` is the same selector family as `personalNote` above; the
// long-nick field is the "102" slot holding a different string.
//
// ---------------------------------------------------------------------------
// uinForm: none
// ---------------------------------------------------------------------------
// Neither spec sets `uinForm` (reference/index.mjs:331454 / 332542), so
// `reserved` is 0.
//
// ---------------------------------------------------------------------------
// The short-circuit nobody expects
// ---------------------------------------------------------------------------
// `SetProfile.serialize` returns an *empty request* when all three parameters are
// undefined, and the reference's `invoke` for that action checks for exactly this
// and skips the packet entirely (nothing to change => no reason to call the
// server).  Encoding an empty body would still be a valid wire message, so the
// no-packet behaviour has to be modelled explicitly: `hasProfileChanges` below.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4394 = 0x112a.  Shared by both specs below. */
export const PROFILE_COMMAND = 0x112a;

/** 2 for both `set_qq_profile` and `set_self_longnick`. */
export const PROFILE_SUB_COMMAND = 2;

/**
 * The profile field selectors.
 *
 * These are the values that go into `OidbProfileStringItem.fieldId` /
 * `OidbProfileIntItem.fieldId`, and into `Oidb0x112aProfileInfo.tag`.
 */
export const PROFILE_FIELD_ID = {
  nickname: 20002,
  personalNote: 102,
  sex: 20009,
  /** The `tag` `set_self_longnick` hard-codes (same 102 slot as personalNote). */
  longNick: 102,
} as const;

export const OidbSetProfileField = { uin: 1, stringProfiles: 2, intProfiles: 3 } as const;

export const ProfileStringItemField = { fieldId: 1, value: 2 } as const;

export const ProfileIntItemField = { fieldId: 1, value: 2 } as const;

export const Oidb0x112aReqField = { uin: 1, profile: 2 } as const;

export const Oidb0x112aProfileInfoField = { tag: 1, value: 2 } as const;

// ---------------------------------------------------------------------------
// SetProfile request
// ---------------------------------------------------------------------------

export interface ProfileStringItem {
  fieldId: number;
  value: string;
}

export interface ProfileIntItem {
  fieldId: number;
  /** uint64 on the wire. */
  value: bigint;
}

export interface OidbSetProfile {
  /** The caller's own uin as a uint64. */
  uin: bigint;
  stringProfiles: ProfileStringItem[];
  intProfiles: ProfileIntItem[];
}

export function encodeProfileStringItem(body: ProfileStringItem): Uint8Array {
  return new ProtoWriter()
    .uint32(ProfileStringItemField.fieldId, body.fieldId)
    .string(ProfileStringItemField.value, body.value)
    .finish();
}

export function encodeProfileIntItem(body: ProfileIntItem): Uint8Array {
  return new ProtoWriter()
    .uint32(ProfileIntItemField.fieldId, body.fieldId)
    .uint64(ProfileIntItemField.value, body.value)
    .finish();
}

export function encodeOidbSetProfile(body: OidbSetProfile): Uint8Array {
  return new ProtoWriter()
    .uint64(OidbSetProfileField.uin, body.uin)
    .repeatedMessage(
      OidbSetProfileField.stringProfiles,
      (body.stringProfiles ?? []).map((item) => encodeProfileStringItem(item)),
    )
    .repeatedMessage(
      OidbSetProfileField.intProfiles,
      (body.intProfiles ?? []).map((item) => encodeProfileIntItem(item)),
    )
    .finish();
}

// ---------------------------------------------------------------------------
// SetProfile response
// ---------------------------------------------------------------------------

export const Oidb0x112aRespField = { field1: 1, field2: 2 } as const;

export interface Oidb0x112aResp {
  field1: number;
  field2: string;
}

/**
 * The `$1` variant's response decoder.
 *
 * The reference's generated decoder for this message reads only fields 1 and 2
 * and leaves both at their defaults when absent — there is no retcode inside it,
 * so the caller learns nothing beyond "the envelope succeeded".
 */
export function decodeOidb0x112aResp1(data: Uint8Array, offset = 0, end = data.length): Oidb0x112aResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0x112aResp = { field1: 0, field2: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x112aRespField.field1, WireType.varint):
        resp.field1 = reader.uint32();
        break;
      case tagOf(Oidb0x112aRespField.field2, WireType.lengthDelimited):
        resp.field2 = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// SetSelfLongNick request
// ---------------------------------------------------------------------------

export interface Oidb0x112aProfileInfo {
  tag: number;
  value: string;
}

export interface Oidb0x112aReq {
  /** The caller's own uin as a uint64. */
  uin: bigint;
  profile: Oidb0x112aProfileInfo;
}

export function encodeOidb0x112aProfileInfo(body: Oidb0x112aProfileInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(Oidb0x112aProfileInfoField.tag, body.tag)
    .string(Oidb0x112aProfileInfoField.value, body.value)
    .finish();
}

export function encodeOidb0x112aReq(body: Oidb0x112aReq): Uint8Array {
  return new ProtoWriter()
    .uint64(Oidb0x112aReqField.uin, body.uin)
    .message(Oidb0x112aReqField.profile, encodeOidb0x112aProfileInfo(body.profile))
    .finish();
}

// ---------------------------------------------------------------------------
// Params and specs
// ---------------------------------------------------------------------------

export interface SetProfileParams {
  /** The caller's own uin (from the identity), not a target. */
  selfUin: number | bigint;
  nickname?: string | undefined;
  personalNote?: string | undefined;
  /** 0 = unknown, 1 = male, 2 = female — passed through, not validated. */
  sex?: number | undefined;
}

/**
 * True when there is at least one field to change.
 *
 * The reference's `invoke` skips the packet entirely in this case rather than
 * sending an empty profile (see the header).  Callers that want that behaviour
 * check this first; the spec itself still encodes, because an encoder that
 * refuses to produce bytes is impossible to test.
 */
export function hasProfileChanges(params: SetProfileParams): boolean {
  return params.nickname !== undefined || params.personalNote !== undefined || params.sex !== undefined;
}

/**
 * `set_qq_profile`.
 *
 * Every `undefined` parameter is omitted; an empty string is NOT omitted (the
 * reference tests `!== void 0`, not truthiness), so "clear my nickname" is
 * expressible as `nickname: ""` and produces a `fieldId 20002, value ""` item —
 * a uint32 field and a length-0 string on the wire.  Note that the *string*
 * encoder drops empty values, so the item still encodes as `fieldId` alone;
 * that is the reference's behaviour, not a choice made here.
 */
export const SetProfile: OidbSpec<SetProfileParams, OidbSetProfile, Oidb0x112aResp, void> = {
  command: PROFILE_COMMAND,
  subCommand: PROFILE_SUB_COMMAND,
  serialize: (params) => {
    const stringProfiles: ProfileStringItem[] = [];
    const intProfiles: ProfileIntItem[] = [];
    if (params.nickname !== undefined) {
      stringProfiles.push({ fieldId: PROFILE_FIELD_ID.nickname, value: params.nickname });
    }
    if (params.personalNote !== undefined) {
      stringProfiles.push({ fieldId: PROFILE_FIELD_ID.personalNote, value: params.personalNote });
    }
    if (params.sex !== undefined) {
      intProfiles.push({ fieldId: PROFILE_FIELD_ID.sex, value: BigInt(params.sex) });
    }
    return {
      uin: BigInt(params.selfUin),
      stringProfiles,
      intProfiles,
    };
  },
  encodeBody: encodeOidbSetProfile,
  decodeBody: decodeOidb0x112aResp1,
  deserialize: () => undefined,
};

export interface SetSelfLongNickParams {
  /** The caller's own uin (from the identity), not a target. */
  selfUin: number | bigint;
  longNick: string;
}

/** `set_self_longnick` — writes the 102 slot, the same one `personalNote` uses. */
export const SetSelfLongNick: OidbSpec<SetSelfLongNickParams, Oidb0x112aReq, Oidb0x112aResp, void> = {
  command: PROFILE_COMMAND,
  subCommand: PROFILE_SUB_COMMAND,
  serialize: (params) => ({
    uin: BigInt(params.selfUin),
    profile: { tag: PROFILE_FIELD_ID.longNick, value: String(params.longNick) },
  }),
  encodeBody: encodeOidb0x112aReq,
  decodeBody: decodeOidb0x112aResp1,
  deserialize: () => undefined,
};