// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/actions/system-face.ts"
// original bundle lines 21049-21208  (158 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function faceEntry(face) {
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
		is_super: isSuperFaceEntry(face)
	};
}
var refreshField = () => f$1.bool().default(false).describe("是否强制从 QQ 刷新目录");
var faceIdField = () => f$1.faceId().describe("QQ 系统表情编号");
var nullableInteger = { type: ["integer", "null"] };
var faceSchema = {
	type: "object",
	properties: {
		q_sid: {
			type: "string",
			description: "QQ 表情目录标识（部分 emoji 为 Unicode 表情字符串）"
		},
		q_des: {
			type: "string",
			description: "表情描述"
		},
		em_code: { type: "string" },
		q_cid: nullableInteger,
		ani_sticker_type: nullableInteger,
		ani_sticker_pack_id: nullableInteger,
		ani_sticker_id: nullableInteger,
		url: { type: ["string", "null"] },
		emoji_name_alias: {
			type: "array",
			items: { type: "string" }
		},
		ani_sticker_width: nullableInteger,
		ani_sticker_height: nullableInteger,
		is_super: {
			type: "boolean",
			description: "是否使用超级表情格式"
		}
	},
	required: [
		"q_sid",
		"q_des",
		"em_code",
		"q_cid",
		"ani_sticker_type",
		"ani_sticker_pack_id",
		"ani_sticker_id",
		"url",
		"emoji_name_alias",
		"ani_sticker_width",
		"ani_sticker_height",
		"is_super"
	]
};
var actions = [
	defineAction({
		name: "fetch_sys_faces",
		examples: [{
			summary: "获取 QQ 系统表情目录",
			params: { refresh: false }
		}],
		summary: "获取 QQ 系统表情目录",
		readOnly: true,
		returns: "按分组返回完整的 QQ 系统表情映射。",
		returnsSchema: {
			type: "object",
			properties: { packs: {
				type: "array",
				items: {
					type: "object",
					properties: {
						pack_name: { type: "string" },
						emojis: {
							type: "array",
							items: faceSchema
						}
					},
					required: ["pack_name", "emojis"]
				}
			} },
			required: ["packs"]
		},
		params: { refresh: refreshField() },
		run: async (params, ctx) => {
			return okResponse({ packs: (await ctx.bridge.apis.systemFace.fetchCatalog(params.refresh)).map((pack) => ({
				pack_name: pack.packName,
				emojis: pack.emojis.map(faceEntry)
			})) });
		}
	}),
	defineAction({
		name: "fetch_face_entity",
		examples: [{
			summary: "按编号查询 QQ 系统表情",
			params: { face_id: 14 }
		}],
		summary: "按编号查询 QQ 系统表情",
		readOnly: true,
		returns: "表情详情；编号不存在时返回 null。",
		returnsSchema: { anyOf: [faceSchema, { type: "null" }] },
		params: {
			face_id: faceIdField(),
			refresh: refreshField()
		},
		run: async (params, ctx) => {
			const face = await ctx.bridge.apis.systemFace.fetchFace(params.face_id, params.refresh);
			return okResponse(face ? faceEntry(face) : null);
		}
	}),
	defineAction({
		name: "search_sys_faces",
		examples: [{
			summary: "搜索 QQ 系统表情",
			params: { query: "微笑" }
		}],
		summary: "搜索 QQ 系统表情",
		readOnly: true,
		returns: "匹配编号、名称、别名或分组名的表情列表。",
		returnsSchema: {
			type: "object",
			properties: { faces: {
				type: "array",
				items: faceSchema
			} },
			required: ["faces"]
		},
		params: { query: f$1.string({ allowEmpty: false }).describe("编号、名称、别名或分组名") },
		run: async (params, ctx) => okResponse({ faces: (await ctx.bridge.apis.systemFace.search(params.query)).map(faceEntry) })
	}),
	defineAction({
		name: "fetch_super_face_id",
		examples: [{
			summary: "判断 QQ 系统表情是否使用超级表情格式",
			params: { face_id: 14 }
		}],
		summary: "判断 QQ 系统表情是否使用超级表情格式",
		readOnly: true,
		returns: "是否使用超级表情格式。",
		returnsSchema: {
			type: "object",
			properties: { is_super: { type: "boolean" } },
			required: ["is_super"]
		},
		params: {
			face_id: faceIdField(),
			refresh: refreshField()
		},
		run: async (params, ctx) => okResponse({ is_super: await ctx.bridge.apis.systemFace.isSuper(params.face_id, params.refresh) })
	})
];
export {};
