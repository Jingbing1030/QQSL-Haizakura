// The group category tag trio — 0x967c_0, 0x967d_0, 0x967e_0.
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// All three batch-brief labels were right: the reference's spec variables are
// `GetGroupCategoryTags` (38524 / 0x967c), `AddGroupCategoryTag` (38525 / 0x967d)
// and `DeleteGroupCategoryTag` (38526 / 0x967e), all `subCommand = 0`, no
// `uinForm` (reference/index.mjs:229668 / 230681 / 231691).
//
// These are the only commands in this batch where the three consecutive numbers
// really are one family — read, add, remove of the same object. That is worth
// saying explicitly because MEMORY.md §2.3k established that adjacency predicts
// nothing (0x6d7/6d8/6d9 are the group-FILE family). Here the adjacency happens
// to be genuine, and the way to know is the shared `groupClass` field and the
// shared `OidbChangeGroupCategoryTag` message, not the numbers.
//
// ---------------------------------------------------------------------------
// What a "category tag" is
// ---------------------------------------------------------------------------
// `groupClass` is a **number** (0..4294967295), not a name: it is the account's
// own classification bucket for its groups (the client's "my groups" folders).
// Both mutating specs validate it locally (`assertGroupClass`), so an
// out-of-range value never reaches the wire.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbGetGroupCategoryTags        reference/index.mjs:229207 / 229217 (write)
//     1 groupClass uint32   **bare `!= null` guard** -> an explicit 0 IS sent
//
//   OidbChangeGroupCategoryTag      reference/index.mjs:230609 / 230626 (add) and
//                                   231619 / 231636 (remove)
//     1 groupClass uint32   bare `!= null` -> explicit 0 IS sent
//     2 name       string   `!= null && !== ""` -> empty is dropped (and rejected
//                            by the local validator first, so it never gets that far)
//
//   ⚠️ `groupClass` is `uint32Present`, not `uint32`: the writer's guard is
//   `_f0 != null` with no `!== 0` (both regions), so
//   `getGroupCategoryTags({groupClass: 0})` emits `08 00` — golden `tags_zero`
//   pins it as `...2202 0800`. With the ordinary uint32 rule that request would
//   be an empty body, which the server reads as "class unspecified".
//
//   ⚠️ Add and delete share the message NAME `OidbChangeGroupCategoryTag` but not
//   the encoder function: the add region's copy is `...$1`
//   (reference/index.mjs:230367) and the delete region's is the unsuffixed
//   `...ChangeGroupCategoryTag` (:231377). Here the two happen to be
//   byte-identical (both are 1 + 2 with the same guards), so a shared codec is
//   safe — but that is a fact worth having checked rather than assumed, because
//   `$1` usually means the bodies differ.
//
// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
//   OidbGetGroupCategoryTagsResp    reference/index.mjs:229456 (decode)
//     1 tags repeated message
//   OidbGroupCategoryTag            reference/index.mjs:229541 (decode)
//     1 id   uint32
//     2 name string
//     3 type uint32
//
//   `GetGroupCategoryTags.deserialize` (:229673) maps each tag through `toTag`
//   (:229684), which `??`-defaults all three fields — so a tag message with no
//   fields decodes to `{id: 0, name: "", type: 0}` rather than `{}`. That matters
//   because the result is an array of concrete objects, and an empty object would
//   break `tag.id` at the call site.
//
//   Add and delete answer with `OidbEmpty` (`OidbEmpty$7` / `OidbEmpty$6`), so
//   their `deserialize`s discard the body.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 38524 = 0x967c. */
export const GET_GROUP_CATEGORY_TAGS_COMMAND = 0x967c;

/** 38525 = 0x967d. */
export const ADD_GROUP_CATEGORY_TAG_COMMAND = 0x967d;

/** 38526 = 0x967e. */
export const DELETE_GROUP_CATEGORY_TAG_COMMAND = 0x967e;

/** All three use sub-command 0; none has another sub-command. */
export const GROUP_CATEGORY_TAG_SUB_COMMAND = 0;

export const OidbGetGroupCategoryTagsField = { groupClass: 1 } as const;
export const OidbChangeGroupCategoryTagField = { groupClass: 1, name: 2 } as const;

export const OidbGetGroupCategoryTagsRespField = { tags: 1 } as const;
export const OidbGroupCategoryTagField = { id: 1, name: 2, type: 3 } as const;

/** The upper bound both validators enforce (`assertGroupClass`, :229681). */
export const GROUP_CLASS_MAX = 4294967295;

/**
 * Validate `groupClass` exactly as the reference does.
 *
 * All three specs call this before building the request, so an out-of-range value
 * is a local throw, never a wire value. The message text is copied verbatim
 * because callers key off it.
 */
export function assertGroupClass(groupClass: number): void {
  if (!Number.isInteger(groupClass) || groupClass < 0 || groupClass > GROUP_CLASS_MAX) {
    throw new Error(`group class ${groupClass} is out of range`);
  }
}

/**
 * The mutating specs additionally reject an empty name
 * (`assertTagChange` / `assertTagChange$1`, :230697 / :231707).
 */
export function assertTagChange(groupClass: number, name: string): void {
  assertGroupClass(groupClass);
  if (name.length === 0) throw new Error("tag name must not be empty");
}

// ---------------------------------------------------------------------------
// Read — 0x967c_0
// ---------------------------------------------------------------------------

export interface OidbGetGroupCategoryTags {
  groupClass: number;
}

export function encodeOidbGetGroupCategoryTags(body: OidbGetGroupCategoryTags): Uint8Array {
  // Bare `!= null`, so an explicit 0 is emitted — see the header.
  return new ProtoWriter()
    .uint32Present(OidbGetGroupCategoryTagsField.groupClass, body.groupClass)
    .finish();
}

export interface OidbGroupCategoryTag {
  id: number;
  name: string;
  type: number;
}

export interface OidbGetGroupCategoryTagsResp {
  tags: OidbGroupCategoryTag[];
}

export function decodeOidbGroupCategoryTag(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupCategoryTag {
  const reader = new ProtoReader(data, offset, end);
  const tag: OidbGroupCategoryTag = { id: 0, name: "", type: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGroupCategoryTagField.id, WireType.varint):
        tag.id = reader.uint32();
        break;
      case tagOf(OidbGroupCategoryTagField.name, WireType.lengthDelimited):
        tag.name = reader.string();
        break;
      case tagOf(OidbGroupCategoryTagField.type, WireType.varint):
        tag.type = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return tag;
}

export function decodeOidbGetGroupCategoryTagsResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGetGroupCategoryTagsResp {
  const reader = new ProtoReader(data, offset, end);
  const response: OidbGetGroupCategoryTagsResp = { tags: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbGetGroupCategoryTagsRespField.tags, WireType.lengthDelimited)) {
      response.tags.push(reader.message(decodeOidbGroupCategoryTag));
    } else {
      reader.skip(unknown);
    }
  }
  return response;
}

/** `toTag` (:229684): every field `??`-defaulted, so the shape is always complete. */
export function toTag(tag: OidbGroupCategoryTag): OidbGroupCategoryTag {
  return { id: tag.id ?? 0, name: tag.name ?? "", type: tag.type ?? 0 };
}

export interface GroupCategoryTagsParams {
  groupClass: number;
}

export interface GroupCategoryTagList {
  tags: OidbGroupCategoryTag[];
}

export const GetGroupCategoryTags: OidbSpec<
  GroupCategoryTagsParams,
  OidbGetGroupCategoryTags,
  OidbGetGroupCategoryTagsResp,
  GroupCategoryTagList
> = {
  command: GET_GROUP_CATEGORY_TAGS_COMMAND,
  subCommand: GROUP_CATEGORY_TAG_SUB_COMMAND,
  serialize: (params) => {
    assertGroupClass(params.groupClass);
    return { groupClass: params.groupClass };
  },
  encodeBody: encodeOidbGetGroupCategoryTags,
  decodeBody: decodeOidbGetGroupCategoryTagsResp,
  deserialize: (body) => ({ tags: (body.tags ?? []).map(toTag) }),
};

// ---------------------------------------------------------------------------
// Add / delete — 0x967d_0 and 0x967e_0
// ---------------------------------------------------------------------------

export interface OidbChangeGroupCategoryTag {
  groupClass: number;
  name: string;
}

/**
 * One encoder for both mutations.
 *
 * The two regions' codecs are byte-identical (checked tag by tag against
 * reference/index.mjs:230626 and :231636), so sharing is safe here. If a future
 * bundle version diverges, this is the function to split.
 */
export function encodeOidbChangeGroupCategoryTag(body: OidbChangeGroupCategoryTag): Uint8Array {
  return new ProtoWriter()
    .uint32Present(OidbChangeGroupCategoryTagField.groupClass, body.groupClass)
    .string(OidbChangeGroupCategoryTagField.name, body.name)
    .finish();
}

/** Both mutations answer `OidbEmpty`. */
export interface GroupCategoryTagChangeResp {
  readonly _empty?: never;
}

export function decodeGroupCategoryTagChangeResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupCategoryTagChangeResp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

export interface GroupCategoryTagChangeParams {
  groupClass: number;
  name: string;
}

export const AddGroupCategoryTag: OidbSpec<
  GroupCategoryTagChangeParams,
  OidbChangeGroupCategoryTag,
  GroupCategoryTagChangeResp,
  void
> = {
  command: ADD_GROUP_CATEGORY_TAG_COMMAND,
  subCommand: GROUP_CATEGORY_TAG_SUB_COMMAND,
  serialize: (params) => {
    assertTagChange(params.groupClass, params.name);
    return { groupClass: params.groupClass, name: params.name };
  },
  encodeBody: encodeOidbChangeGroupCategoryTag,
  decodeBody: decodeGroupCategoryTagChangeResp,
  deserialize: () => undefined,
};

export const DeleteGroupCategoryTag: OidbSpec<
  GroupCategoryTagChangeParams,
  OidbChangeGroupCategoryTag,
  GroupCategoryTagChangeResp,
  void
> = {
  command: DELETE_GROUP_CATEGORY_TAG_COMMAND,
  subCommand: GROUP_CATEGORY_TAG_SUB_COMMAND,
  serialize: (params) => {
    assertTagChange(params.groupClass, params.name);
    return { groupClass: params.groupClass, name: params.name };
  },
  encodeBody: encodeOidbChangeGroupCategoryTag,
  decodeBody: decodeGroupCategoryTagChangeResp,
  deserialize: () => undefined,
};