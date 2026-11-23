// 4.6 (part 2) — the four 系统表情 (system face) actions.
//
// Reference region: reference/index.mjs:21049-21209 (`actions`, 4 definitions).
//
// ---------------------------------------------------------------------------
// These four are the cheapest actions in the port and the most deceptive
// ---------------------------------------------------------------------------
// Each `run` is a mapping over `ctx.bridge.apis.systemFace.*` — `faceEntry` is the
// only helper, and it is a straight field rename. The temptation is to treat that
// as "wiring" and stop. The problem is what sits underneath:
//
//   * `fetchCatalog` is NOT a stateless call. `SysFaceStore.getCatalog` must first
//     `ensureReady`, which either restores a persisted catalog or issues
//     `OidbSvcTrpcTcp.0x9154_1`; `search` calls `ensureReady` too, so
//     `search_sys_faces` on a cold process performs a catalog fetch the caller did
//     not ask for.
//   * `fetchFace` has THREE paths, not one: a catalog hit, a `refresh`-forced
//     re-read of the cached index, and a single-face `0x9155_1` lookup. The third
//     one validates that the returned entry's `qSid` equals the requested id and
//     throws `"system face lookup id mismatch"` otherwise.
//   * `isSuper` is defined as `face !== null && isSuperFaceEntry(face)` — so an
//     unknown id answers `is_super: false`, NOT a failure. Reading it as "the
//     lookup must succeed" would turn a legitimate "no such face" into a 100.
//
// That is why this batch ports the store (`ts/src/bridge/apis/system-face.ts`) and
// the two OIDB codecs (`oidb/services/0x9154-9155.ts`) rather than declaring the
// interface and leaving a throwing stub. The subagent that built `profile.ts`
// correctly refused to fake `getUnidirectionalFriendList` because it is bare
// `…0xe17_0` JSON-in-protobuf; here the equivalent hazard is different — the two
// commands ARE ordinary protobuf, so they are codec-able — and the honest gap was
// the store, which is now closed.
//
// ---------------------------------------------------------------------------
// `faceEntry` and the nullability it preserves
// ---------------------------------------------------------------------------
// Eleven fields, and the six numeric ones pass `null` through unchanged. They are
// `null`, not `undefined` and not `0`: `validateCatalog` requires each to be either
// `null` or a safe integer, and the OneBot schema declares
// `type: ["integer", "null"]` for all six. Coercing a null `aniStickerType` to 0
// would make `isSuperFaceEntry` answer true (`0 > 0` is false — so actually 0 is
// SAFE for that one) but would corrupt `qCid`, where 0 is a real face-class id.
//
// `is_super` is COMPUTED (`aniStickerType != null && aniStickerType > 0`), never
// read from the wire. So a catalog entry with a `null` type is not super, and the
// port reproduces that instead of trusting a similarly-named upstream field.

import { defineAction, f, okResponse, type ActionSpec } from "./kit.js";
import type { ActionContext, SystemFaceEntry } from "./context.js";

/** `isSuperFaceEntry` — reference:21045. The only classification the 4 actions share. */
export function isSuperFaceEntry(face: SystemFaceEntry): boolean {
  return face.aniStickerType != null && face.aniStickerType > 0;
}

/**
 * `faceEntry` — reference:21050.
 *
 * A field RENAME from the wire shape to the OneBot shape, with `is_super` computed.
 * The key ORDER is the reference's (`q_sid, q_des, em_code, q_cid, ani_sticker_type,
 * ani_sticker_pack_id, ani_sticker_id, url, emoji_name_alias, ani_sticker_width,
 * ani_sticker_height, is_super`) and it is observable — `deepStrictEqual` does not
 * compare key order, but a client that renders the object does, and the reference's
 * own schema lists them in this order.
 */
function faceEntry(face: SystemFaceEntry): Record<string, unknown> {
  return {
    q_sid: face.qSid,
    q_des: face.qDes,
    em_code: face.emCode,
    q_cid: face.qCid,
    ani_sticker_type: face.aniStickerType,
    ani_sticker_pack_id: face.aniStickerPackId,
    ani_sticker_id: face.aniStickerId,
    url: face.url,
    emoji_name_alias: face.emojiNameAlias,
    ani_sticker_width: face.aniStickerWidth,
    ani_sticker_height: face.aniStickerHeight,
    is_super: isSuperFaceEntry(face),
  };
}

/** `refreshField` — reference:21064. A factory, because each use is its own field. */
const refreshField = () => f.bool().default(false).describe("是否强制从 QQ 刷新目录");

/** `faceIdField` — reference:21065. */
const faceIdField = () => f.faceId().describe("QQ 系统表情编号");

const systemFaceActions: ActionSpec<Record<string, unknown>, ActionContext>[] = [];

systemFaceActions.push(
  defineAction<{ refresh: boolean }, ActionContext>({
    name: "fetch_sys_faces",
    readOnly: true,
    summary: "获取 QQ 系统表情目录",
    returns: "按分组返回完整的 QQ 系统表情映射。",
    params: { refresh: refreshField() },
    run: async (p, ctx) => {
      const catalog = await ctx.bridge.apis.systemFace.fetchCatalog(p.refresh);
      // The map is OUTSIDE the object literal, exactly as the reference writes it:
      // `{ packs: (await …).map((pack) => ({…})) }`. Building the object first and
      // then assigning would change the key order relative to `data`.
      return okResponse({
        packs: catalog.map((pack) => ({
          pack_name: pack.packName,
          emojis: pack.emojis.map(faceEntry),
        })),
      });
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

systemFaceActions.push(
  defineAction<{ face_id: number; refresh: boolean }, ActionContext>({
    name: "fetch_face_entity",
    readOnly: true,
    summary: "按编号查询 QQ 系统表情",
    returns: "表情详情；编号不存在时返回 null。",
    params: { face_id: faceIdField(), refresh: refreshField() },
    run: async (p, ctx) => {
      const face = await ctx.bridge.apis.systemFace.fetchFace(p.face_id, p.refresh);
      // `face ? faceEntry(face) : null` — an unknown id is `data: null` with
      // `status: "ok"`, not a failure. That distinction is the action's contract:
      // the schema is `anyOf: [faceSchema, { type: "null" }]`.
      return okResponse(face ? faceEntry(face) : null);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

systemFaceActions.push(
  defineAction<{ query: string }, ActionContext>({
    name: "search_sys_faces",
    readOnly: true,
    summary: "搜索 QQ 系统表情",
    returns: "匹配编号、名称、别名或分组名的表情列表。",
    params: { query: f.string({ allowEmpty: false }).describe("编号、名称、别名或分组名") },
    run: async (p, ctx) => okResponse({ faces: (await ctx.bridge.apis.systemFace.search(p.query)).map(faceEntry) }),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

systemFaceActions.push(
  defineAction<{ face_id: number; refresh: boolean }, ActionContext>({
    name: "fetch_super_face_id",
    readOnly: true,
    summary: "判断 QQ 系统表情是否使用超级表情格式",
    returns: "是否使用超级表情格式。",
    params: { face_id: faceIdField(), refresh: refreshField() },
    // Named unlike its siblings on purpose: the reference's canonical name is
    // `fetch_super_face_id` even though it RETURNS a boolean and takes a face id.
    // Renaming it to something clearer would break every client that already sends
    // this name, so the port keeps the reference's.
    run: async (p, ctx) =>
      okResponse({ is_super: await ctx.bridge.apis.systemFace.isSuper(p.face_id, p.refresh) }),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export { systemFaceActions, faceEntry };
export const SYSTEM_FACE_ACTION_COUNT = systemFaceActions.length;