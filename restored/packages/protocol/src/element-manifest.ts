// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/element-manifest.ts"
// original bundle lines 6371-6904  (532 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/**
* Window shake is an action-like CommonElem, not ordinary message content.
* Keep its narrow send contract in the protocol package so every caller
* rejects unsupported destinations and mixed payloads before side effects.
*/
function assertWindowShakeSendPolicy(windowShakeCount, segmentCount, scene) {
	if (windowShakeCount === 0) return;
	if (scene !== "direct-private") throw new MessageElementValidationError("UNSENDABLE_TYPE", "message element \"poke\" can only be sent in a direct private chat", "poke");
	if (windowShakeCount !== 1 || segmentCount !== 1) throw new MessageElementValidationError("UNSENDABLE_TYPE", "message element \"poke\" must be the only segment in a private window-shake request", "poke");
}
/**
* QQ clients treat a video as a standalone message: sibling elements remain
* on the wire but are not rendered, and additional videos cannot be opened.
* Reject that ambiguous wire shape instead of reporting a successful send
* whose visible content differs from the caller's request.
*/
function assertVideoSendPolicy(videoCount, effectiveSegmentCount) {
	if (videoCount === 0) return;
	if (videoCount !== 1) throw new MessageElementValidationError("UNSENDABLE_TYPE", "message element \"video\" may appear only once in a message", "video");
	if (effectiveSegmentCount !== 1) throw new MessageElementValidationError("UNSENDABLE_TYPE", "message element \"video\" must be the only segment in a message", "video");
}
/**
* Compile-time exact-field guard: an unknown field is rejected by the tuple's
* element type; omitting a legal field makes the synthetic __missingFields
* property unsatisfied. The returned tuple remains available at runtime.
*/
function fieldsFor() {
	return (fields) => fields;
}
/**
* 全部规范元素类型 × 四向支持。此表须与那 4 处派发代码逐字一致，否则对账测试报红。
*/
var ELEMENT_MANIFEST = {
	text: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()(["text"]),
		requiredFields: ["text"]
	},
	at: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"targetUin",
			"uid",
			"text"
		]),
		requiredFields: ["targetUin"]
	},
	face: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"faceId",
			"large",
			"resultId"
		]),
		requiredFields: ["faceId"]
	},
	reply: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"replySeq",
			"replyMessageId",
			"replySenderUin",
			"replyTime",
			"replyRandom",
			"replyElements"
		]),
		requiredFields: ["replySeq"]
	},
	json: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()(["text"]),
		requiredFields: ["text"]
	},
	xml: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()(["text", "subType"]),
		requiredFields: ["text"]
	},
	forward: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"resId",
			"forwardSource",
			"forwardSummary",
			"forwardPrompt",
			"forwardNews",
			"forwardTSum",
			"forwardUuid"
		]),
		requiredFields: ["resId"]
	},
	image: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"imageUrl",
			"fileId",
			"fileName",
			"fileSize",
			"url",
			"subType",
			"summary",
			"width",
			"height",
			"flash",
			"md5Hex",
			"sha1Hex",
			"picFormat",
			"noByteFallback"
		]),
		requiredFields: [],
		note: "media：W（打包）经 highway 上传、异步，需 SendContext"
	},
	record: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"fileName",
			"fileId",
			"fileSize",
			"fileHash",
			"url",
			"duration",
			"md5Hex",
			"sha1Hex",
			"voiceFormat",
			"noByteFallback",
			"mediaNode"
		]),
		requiredFields: [],
		note: "media"
	},
	video: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"fileName",
			"fileId",
			"fileSize",
			"fileHash",
			"url",
			"thumbUrl",
			"duration",
			"width",
			"height",
			"md5Hex",
			"sha1Hex",
			"videoFormat",
			"noByteFallback",
			"mediaNode"
		]),
		requiredFields: [],
		note: "media"
	},
	mface: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"emojiId",
			"emojiPackageId",
			"emojiKey",
			"text"
		]),
		requiredFields: ["emojiId"],
		note: "商城表情三角：S（转 OneBot）输出 image 段并挂 emoji_id/emoji_package_id/key 标记，P（解）再从该 image 段认回"
	},
	file: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()([
			"fileId",
			"fileName",
			"fileSize",
			"fileHash",
			"url",
			"md5Hex",
			"sha1Hex"
		]),
		requiredFields: [],
		note: "W 特殊：live-send 在 OneBot 层被拆走走独立上传管线，仅 forwardFake 时落 transElem(24)"
	},
	poke: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()(["subType"]),
		requiredFields: ["subType"],
		note: "W 仅支持普通好友私聊窗口抖动；send_poke Action 仍表示拍一拍"
	},
	markdown: {
		directions: {
			D: "yes",
			S: "yes",
			P: "yes",
			W: "yes"
		},
		fields: fieldsFor()(["text"]),
		requiredFields: ["text"]
	},
	inline_keyboard: {
		directions: {
			D: "yes",
			S: "yes",
			P: "no",
			W: "no"
		},
		fields: fieldsFor()(["botAppid", "rows"]),
		requiredFields: ["botAppid", "rows"],
		note: "机器人消息的交互按钮；当前仅解码并上报，不支持作为普通消息发送"
	},
	flash_file: {
		directions: {
			D: "yes",
			S: "yes",
			P: "by-design-no",
			W: "by-design-no"
		},
		fields: fieldsFor()([
			"filesetId",
			"sceneType",
			"fileName",
			"thumbUrl"
		]),
		requiredFields: ["filesetId"],
		note: "闪传文件：收侧解码 markdown commonElem（旧卡 JSON data.fileSetId，现网 extType=1/extInfo + open_fileset scheme，#199/#200/#358）；发送走 send_flash_msg，故 P/W 按设计不支持"
	}
};
/** Stable typed error for callers that map invalid messages to BAD_REQUEST. */
var MessageElementValidationError = class extends Error {
	code;
	elementType;
	field;
	name = "MessageElementValidationError";
	constructor(code, message, elementType, field) {
		super(message);
		this.code = code;
		this.elementType = elementType;
		this.field = field;
	}
};
var STRING_FIELDS = /* @__PURE__ */ new Set([
	"text",
	"uid",
	"imageUrl",
	"fileId",
	"fileName",
	"fileHash",
	"url",
	"thumbUrl",
	"summary",
	"emojiId",
	"emojiKey",
	"resId",
	"filesetId",
	"forwardSource",
	"forwardSummary",
	"forwardPrompt",
	"forwardUuid",
	"md5Hex",
	"sha1Hex",
	"botAppid",
	"resultId"
]);
var NUMBER_FIELDS = /* @__PURE__ */ new Set([
	"faceId",
	"targetUin",
	"fileSize",
	"replySeq",
	"replyMessageId",
	"replySenderUin",
	"replyTime",
	"replyRandom",
	"subType",
	"duration",
	"width",
	"height",
	"emojiPackageId",
	"sceneType",
	"forwardTSum",
	"picFormat",
	"videoFormat",
	"voiceFormat"
]);
var BOOLEAN_FIELDS = /* @__PURE__ */ new Set([
	"flash",
	"noByteFallback",
	"large"
]);
function throwValidation(code, message, elementType, field) {
	throw new MessageElementValidationError(code, message, elementType, field);
}
function validateFieldValue(type, field, value) {
	if (value === void 0) return;
	if (STRING_FIELDS.has(field)) {
		if (typeof value !== "string") throwValidation("INVALID_FIELD", `message element "${type}" field "${field}" must be a string`, type, field);
		return;
	}
	if (NUMBER_FIELDS.has(field)) {
		if (typeof value !== "number" || !Number.isSafeInteger(value)) throwValidation("INVALID_FIELD", `message element "${type}" field "${field}" must be a safe integer`, type, field);
		return;
	}
	if (BOOLEAN_FIELDS.has(field)) {
		if (typeof value !== "boolean") throwValidation("INVALID_FIELD", `message element "${type}" field "${field}" must be a boolean`, type, field);
		return;
	}
	if (field === "replyElements") {
		if (!Array.isArray(value)) throwValidation("INVALID_FIELD", "message element \"reply\" field \"replyElements\" must be an array", type, field);
		for (const quoted of value) assertValidMessageElement(quoted);
		return;
	}
	if (field === "forwardNews") {
		if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item) || typeof item.text !== "string" || Object.keys(item).some((key) => key !== "text"))) throwValidation("INVALID_FIELD", "message element \"forward\" field \"forwardNews\" must contain only { text: string } entries", type, field);
		return;
	}
	if (field === "rows") {
		const stringFields = /* @__PURE__ */ new Set([
			"id",
			"label",
			"visitedLabel",
			"unsupportedTips",
			"data"
		]);
		const numberFields = /* @__PURE__ */ new Set([
			"style",
			"type",
			"clickLimit",
			"permissionType",
			"anchor"
		]);
		const booleanFields = /* @__PURE__ */ new Set([
			"atBotShowChannelList",
			"isReply",
			"enter"
		]);
		const stringArrayFields = /* @__PURE__ */ new Set(["specifyRoleIds", "specifyUserIds"]);
		const buttonFields = /* @__PURE__ */ new Set([
			...stringFields,
			...numberFields,
			...booleanFields,
			...stringArrayFields
		]);
		if (!(Array.isArray(value) && value.every((row) => {
			if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
			const rowRecord = row;
			if (Object.keys(rowRecord).some((key) => key !== "buttons") || !Array.isArray(rowRecord.buttons)) return false;
			return rowRecord.buttons.every((button) => {
				if (typeof button !== "object" || button === null || Array.isArray(button)) return false;
				const buttonRecord = button;
				if (Object.keys(buttonRecord).some((key) => !buttonFields.has(key))) return false;
				return [...stringFields].every((key) => typeof buttonRecord[key] === "string") && [...numberFields].every((key) => typeof buttonRecord[key] === "number" && Number.isSafeInteger(buttonRecord[key]) && buttonRecord[key] >= 0) && [...booleanFields].every((key) => typeof buttonRecord[key] === "boolean") && [...stringArrayFields].every((key) => Array.isArray(buttonRecord[key]) && buttonRecord[key].every((entry) => typeof entry === "string"));
			});
		}))) throwValidation("INVALID_FIELD", "message element \"inline_keyboard\" field \"rows\" must contain normalized button rows", type, field);
		return;
	}
	if (field === "mediaNode") {
		if (typeof value !== "object" || value === null || Array.isArray(value)) throwValidation("INVALID_FIELD", `message element "${type}" field "mediaNode" must be an object`, type, field);
		return;
	}
	throw new Error(`element manifest field has no runtime validator: ${type}.${field}`);
}
function requireNonEmptyString(element, type, field) {
	const value = element[field];
	if (typeof value !== "string" || value.length === 0) throwValidation("INVALID_FIELD", `message element "${type}" field "${field}" must not be empty`, type, field);
}
function validateSemantics(element, direction) {
	const nonNegativeFields = [
		"targetUin",
		"faceId",
		"fileSize",
		"replySeq",
		"replySenderUin",
		"replyTime",
		"subType",
		"duration",
		"width",
		"height",
		"emojiPackageId",
		"sceneType",
		"forwardTSum",
		"picFormat",
		"videoFormat",
		"voiceFormat"
	];
	const record = element;
	for (const field of nonNegativeFields) {
		const value = record[field];
		if (typeof value === "number" && value < 0) throwValidation("INVALID_FIELD", `message element "${element.type}" field "${field}" must be non-negative`, element.type, field);
	}
	if (element.md5Hex !== void 0 && !/^[0-9a-fA-F]{32}$/.test(element.md5Hex)) throwValidation("INVALID_FIELD", `message element "${element.type}" field "md5Hex" must be exactly 32 hexadecimal characters`, element.type, "md5Hex");
	if (element.sha1Hex !== void 0 && !/^[0-9a-fA-F]{40}$/.test(element.sha1Hex)) throwValidation("INVALID_FIELD", `message element "${element.type}" field "sha1Hex" must be exactly 40 hexadecimal characters`, element.type, "sha1Hex");
	switch (element.type) {
		case "text":
		case "xml":
		case "markdown":
			requireNonEmptyString(element, element.type, "text");
			return;
		case "inline_keyboard":
			requireNonEmptyString(element, element.type, "botAppid");
			if (!/^\d+$/.test(element.botAppid)) throwValidation("INVALID_FIELD", "message element \"inline_keyboard\" field \"botAppid\" must be an unsigned decimal integer", element.type, "botAppid");
			return;
		case "json":
			requireNonEmptyString(element, element.type, "text");
			if (direction !== "P" && direction !== "W") return;
			try {
				const parsed = JSON.parse(element.text);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
			} catch {
				throwValidation("INVALID_FIELD", "message element \"json\" field \"text\" must contain a JSON object", element.type, "text");
			}
			return;
		case "at":
			if (!Number.isInteger(element.targetUin) || element.targetUin < 0) throwValidation("INVALID_FIELD", "message element \"at\" field \"targetUin\" must be a non-negative integer", element.type, "targetUin");
			return;
		case "face":
			if (!Number.isInteger(element.faceId) || element.faceId < 0) throwValidation("INVALID_FIELD", "message element \"face\" field \"faceId\" must be a non-negative integer", element.type, "faceId");
			if (element.resultId !== void 0 && (direction === "P" || direction === "W")) {
				if (!element.resultId.trim()) throwValidation("INVALID_FIELD", "face.resultId must not be empty", element.type, "resultId");
				if (element.large === false) throwValidation("INVALID_FIELD", "face.resultId requires an animated face; large cannot be false", element.type, "resultId");
			}
			return;
		case "reply":
			if (!Number.isInteger(element.replySeq) || element.replySeq <= 0) throwValidation("INVALID_FIELD", "message element \"reply\" field \"replySeq\" must be a positive integer", element.type, "replySeq");
			return;
		case "mface":
			if (!/^[0-9a-fA-F]{32}$/.test(element.emojiId)) throwValidation("INVALID_FIELD", "message element \"mface\" field \"emojiId\" must be exactly 32 hexadecimal characters", element.type, "emojiId");
			return;
		case "forward":
			requireNonEmptyString(element, element.type, "resId");
			return;
		case "image": {
			if (direction !== "P" && direction !== "W") return;
			if (element.noByteFallback === true && (!element.md5Hex?.trim() || !element.sha1Hex?.trim())) throwValidation("MISSING_FIELD", `message element "${element.type}" with noByteFallback requires md5Hex + sha1Hex`, element.type, "md5Hex");
			const hasSource = Boolean(element.url?.trim() || element.imageUrl?.trim() || element.fileId?.trim());
			const hasFingerprint = element.noByteFallback === true && Boolean(element.md5Hex?.trim() && element.sha1Hex?.trim());
			if (!hasSource && !hasFingerprint) throwValidation("MISSING_FIELD", `message element "${element.type}" requires a file/url source or a complete fast-upload fingerprint`, element.type, "url");
			return;
		}
		case "record":
		case "video": {
			if (direction !== "P" && direction !== "W") return;
			if (element.noByteFallback === true && (!element.md5Hex?.trim() || !element.sha1Hex?.trim())) throwValidation("MISSING_FIELD", `message element "${element.type}" with noByteFallback requires md5Hex + sha1Hex`, element.type, "md5Hex");
			const hasSource = Boolean(element.url?.trim() || element.fileId?.trim());
			const hasFingerprint = element.noByteFallback === true && Boolean(element.md5Hex?.trim() && element.sha1Hex?.trim());
			if (!hasSource && !hasFingerprint) throwValidation("MISSING_FIELD", `message element "${element.type}" requires a file/url source or a complete fast-upload fingerprint`, element.type, "url");
			return;
		}
		case "file":
			if ((direction === "P" || direction === "W") && !element.url?.trim() && !element.fileId?.trim()) throwValidation("MISSING_FIELD", "message element \"file\" requires file_id or file/url", element.type, "fileId");
			return;
		case "poke":
		case "flash_file": return;
	}
}
/**
* Validate a runtime value against the same field table checked by TypeScript.
* P/W additionally enforce sendability and source requirements.
*/
function assertValidMessageElement(value, direction) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throwValidation("INVALID_FIELD", "message element must be an object");
	const element = value;
	const rawType = element.type;
	if (typeof rawType !== "string" || !Object.hasOwn(ELEMENT_MANIFEST, rawType)) throwValidation("UNKNOWN_TYPE", `unknown message element type: ${String(rawType)}`, String(rawType));
	const type = rawType;
	const spec = ELEMENT_MANIFEST[type];
	if (direction && spec.directions[direction] !== "yes") throwValidation("UNSENDABLE_TYPE", `message element "${type}" cannot be sent; ${type === "flash_file" ? "use the send_flash_msg Action instead" : `direction ${direction} is not supported`}`, type);
	const allowed = /* @__PURE__ */ new Set(["type", ...spec.fields]);
	for (const key of Object.keys(element)) if (!allowed.has(key)) throwValidation("UNEXPECTED_FIELD", `message element "${type}" does not allow field "${key}"`, type, key);
	for (const field of spec.requiredFields) if (element[field] === void 0 || element[field] === null) throwValidation("MISSING_FIELD", `message element "${type}" requires field "${field}"`, type, field);
	for (const field of spec.fields) validateFieldValue(type, field, element[field]);
	validateSemantics(element, direction);
}
function assertValidMessageElements(values, direction) {
	for (const value of values) assertValidMessageElement(value, direction);
}
export {};
