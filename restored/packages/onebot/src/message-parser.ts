// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/message-parser.ts"
// original bundle lines 22205-22570  (364 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
var log$58 = createLogger("MsgParser");
var CQ_REGEX = /\[CQ:([A-Za-z][A-Za-z0-9_]*)(?:,([^\]]*))?\]/g;
function parseCQParams(raw) {
	const params = {};
	if (!raw) return params;
	for (const pair of raw.split(",")) {
		const eq = pair.indexOf("=");
		if (eq > 0) params[pair.substring(0, eq)] = pair.substring(eq + 1).replaceAll("&#91;", "[").replaceAll("&#93;", "]").replaceAll("&#44;", ",").replaceAll("&amp;", "&");
	}
	return params;
}
function isSegmentArray(val) {
	return Array.isArray(val) && val.every((item) => typeof item === "object" && item !== null && !Array.isArray(item) && typeof item.type === "string" && item.type.trim().length > 0);
}
function normalizeSegmentType(type) {
	return type.toLowerCase();
}
function isExplicitEmptyTextPlaceholder(segment) {
	return normalizeSegmentType(segment.type) === "text" && segmentPayload(segment).text === "";
}
/** Node segments from an exclusive forward payload, or null if it is not one. */
function exclusiveForwardNodeList(message, autoEscape) {
	if (autoEscape && typeof message === "string") return null;
	if (typeof message === "object" && message !== null && !Array.isArray(message)) {
		const type = message.type;
		return typeof type === "string" && normalizeSegmentType(type) === "node" ? [message] : null;
	}
	if (!Array.isArray(message) || message.length === 0) return null;
	const nodes = [];
	for (const item of message) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
		const type = item.type;
		if (typeof type !== "string" || type.trim().length === 0) return null;
		if (isExplicitEmptyTextPlaceholder(item)) continue;
		if (normalizeSegmentType(type) !== "node") return null;
		nodes.push(item);
	}
	return nodes.length > 0 ? nodes : null;
}
function outboundInputSegmentSummary(message, autoEscape) {
	if (typeof message === "string") {
		if (autoEscape) return {
			rawTypes: ["text"],
			effectiveVideoTypes: ["text"]
		};
		const types = [];
		let lastIndex = 0;
		for (const match of message.matchAll(CQ_REGEX)) {
			if (match.index > lastIndex) types.push("text");
			types.push(normalizeSegmentType(match[1] ?? ""));
			lastIndex = match.index + match[0].length;
		}
		if (lastIndex < message.length) types.push("text");
		return {
			rawTypes: types,
			effectiveVideoTypes: types
		};
	}
	if (Array.isArray(message)) {
		const rawTypes = [];
		const effectiveVideoTypes = [];
		for (const item of message) {
			if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
			const type = item.type;
			if (typeof type !== "string") continue;
			const normalizedType = normalizeSegmentType(type);
			rawTypes.push(normalizedType);
			if (!isExplicitEmptyTextPlaceholder(item)) effectiveVideoTypes.push(normalizedType);
		}
		return {
			rawTypes,
			effectiveVideoTypes
		};
	}
	if (typeof message === "object" && message !== null) {
		const type = message.type;
		const types = typeof type === "string" ? [normalizeSegmentType(type)] : [];
		return {
			rawTypes: types,
			effectiveVideoTypes: types
		};
	}
	return {
		rawTypes: [],
		effectiveVideoTypes: []
	};
}
/**
* Reject unsupported message combinations before parsers can resolve
* identities, fetch cards, sign music, or perform any other externally
* visible work.
*/
function assertOutboundMessageInput(message, autoEscape, scene) {
	const { rawTypes, effectiveVideoTypes } = outboundInputSegmentSummary(message, autoEscape);
	assertVideoSendPolicy(effectiveVideoTypes.filter((type) => type === "video").length, effectiveVideoTypes.length);
	const shakeCount = rawTypes.filter((type) => type === "poke" || type === "shake").length;
	assertWindowShakeSendPolicy(shakeCount, rawTypes.length, scene);
}
function invalidMessageShape(message) {
	return new MessageElementValidationError("MISSING_FIELD", message, void 0, "message");
}
function validatedOutboundElement(element) {
	assertValidMessageElement(element, "P");
	assertValidMessageElement(element, "W");
	return element;
}
function assertScalarSegmentData(type, data) {
	for (const [field, value] of Object.entries(data)) {
		if (value === void 0 || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || type === "json" && (field === "data" || field === "config") && typeof value === "object" && value !== null && !Array.isArray(value)) continue;
		throw new MessageElementValidationError("INVALID_FIELD", `message segment "${type}" field "${field}" must be a scalar value`, type, field);
	}
}
function requireNonEmptyStringField(type, data, field) {
	const value = data[field];
	if (typeof value !== "string" || !value.trim()) throw new MessageElementValidationError("INVALID_FIELD", `message segment "${type}" field "${field}" must be a non-empty string`, type, field);
	return value;
}
function requireCoordinate(data, field) {
	const raw = data[field];
	const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
	const value = Number(text);
	const limit = field === "lat" ? 90 : 180;
	if (!text.trim() || text !== text.trim() || !Number.isFinite(value) || value < -limit || value > limit) throw new MessageElementValidationError("INVALID_FIELD", `message segment "location" field "${field}" must be a finite coordinate between ${String(-limit)} and ${String(limit)}`, "location", field);
	return text;
}
function replyInteger(data, field, defaultValue, max, min = 1) {
	const raw = data[field];
	const value = raw === void 0 ? defaultValue : intOr(raw);
	if (raw === null || typeof raw === "string" && !raw.trim() || value < min || value > max) throw new MessageElementValidationError("INVALID_FIELD", `reply.${field} must be an integer between ${min} and ${max}`, "reply", field);
	return value;
}
async function parseForwardReply(data, context) {
	const { message, ...metadata } = data;
	assertScalarSegmentData("reply", metadata);
	const replySenderUin = replyInteger(data, "qq", context.senderUin, Number.MAX_SAFE_INTEGER);
	const replyTime = replyInteger(data, "time", context.time ?? Math.floor(Date.now() / 1e3), 4294967295, 0);
	return validatedOutboundElement({
		type: "reply",
		replySeq: replyInteger(data, "seq", 1, 4294967295),
		replySenderUin,
		replyTime,
		replyElements: elementsToReplyPreview(await parseMessage(message, false, { replyPreview: true }))
	});
}
async function segmentToElement(type, data, options) {
	const normalizedType = normalizeSegmentType(type);
	if (options?.replyPreview) assertReplyPreviewType(normalizedType);
	if (normalizedType === "reply" && Object.hasOwn(data, "message")) {
		if (!options?.forwardReply) throw new MessageElementValidationError("UNSENDABLE_TYPE", "reply.message is only supported inside a forward node", "reply", "message");
		return parseForwardReply(data, options.forwardReply);
	}
	if (normalizedType !== "node" && normalizedType !== "anonymous") assertScalarSegmentData(normalizedType, data);
	switch (normalizedType) {
		case "node": throw new MessageElementValidationError("UNSENDABLE_TYPE", "message segment \"node\" is only valid inside a forward node list", normalizedType);
		case "share": {
			const url = requireNonEmptyStringField(normalizedType, data, "url");
			const title = requireNonEmptyStringField(normalizedType, data, "title");
			const content = String(data.content ?? "");
			const image = String(data.image ?? "");
			return validatedOutboundElement({
				type: "json",
				text: JSON.stringify({
					app: "com.tencent.structmsg",
					view: "news",
					prompt: title,
					meta: { news: {
						title,
						desc: content,
						jumpUrl: url,
						preview: image
					} }
				})
			});
		}
		case "music": {
			const musicType = requireNonEmptyStringField(normalizedType, data, "type");
			const hasMusicId = data.id !== void 0 && data.id !== null && String(data.id).trim() !== "";
			const hasCustomMusicData = [
				"url",
				"audio",
				"title",
				"image",
				"content"
			].some((field) => Object.prototype.hasOwnProperty.call(data, field));
			const usesCustomMusicData = musicType === "custom" || !hasMusicId && hasCustomMusicData;
			if (usesCustomMusicData) {
				requireNonEmptyStringField(normalizedType, data, "url");
				requireNonEmptyStringField(normalizedType, data, "audio");
				requireNonEmptyStringField(normalizedType, data, "title");
			} else if (!hasMusicId) throw new MessageElementValidationError("MISSING_FIELD", "message segment \"music\" requires field \"id\" for a platform card", normalizedType, "id");
			const signUrl = options?.musicSignUrl || "https://ss.xingzhige.com/music_card/card";
			try {
				let postData;
				if (usesCustomMusicData) postData = {
					type: musicType,
					id: void 0,
					url: String(data.url ?? ""),
					audio: String(data.audio ?? ""),
					title: String(data.title ?? ""),
					image: String(data.image ?? ""),
					singer: String(data.content ?? "")
				};
				else postData = {
					type: musicType,
					id: String(data.id ?? "")
				};
				const resp = await fetch(signUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(postData)
				});
				if (!resp.ok) throw new Error(`music sign HTTP ${resp.status}`);
				return validatedOutboundElement({
					type: "json",
					text: await resp.text()
				});
			} catch (e) {
				log$58.warn("music sign failed: %s, falling back to local card", e instanceof Error ? e.message : String(e));
				const title = String(data.title ?? "Music");
				return validatedOutboundElement({
					type: "json",
					text: JSON.stringify({
						app: "com.tencent.structmsg",
						view: "music",
						prompt: `[音乐]${title}`,
						meta: { music: {
							title,
							desc: String(data.content ?? ""),
							jumpUrl: String(data.url ?? ""),
							musicUrl: String(data.audio ?? ""),
							preview: String(data.image ?? "")
						} }
					})
				});
			}
		}
		case "location": {
			const lat = requireCoordinate(data, "lat");
			const lon = requireCoordinate(data, "lon");
			const title = String(data.title ?? "位置");
			const content = String(data.content ?? `${lat},${lon}`);
			return validatedOutboundElement({
				type: "json",
				text: JSON.stringify({
					app: "com.tencent.map",
					view: "LocationShare",
					prompt: `[位置]${title}`,
					meta: { Location: {
						lat,
						lng: lon,
						title,
						address: content
					} }
				})
			});
		}
		case "contact": {
			const contactType = requireNonEmptyStringField(normalizedType, data, "type");
			if (contactType !== "qq" && contactType !== "group") throw new MessageElementValidationError("INVALID_FIELD", "message segment \"contact\" field \"type\" must be \"qq\" or \"group\"", normalizedType, "type");
			const contactId = String(data.id ?? "").trim();
			const numericId = intOr(contactId, 0);
			if (numericId <= 0) throw new MessageElementValidationError("INVALID_FIELD", "message segment \"contact\" field \"id\" must be a positive integer", normalizedType, "id");
			const normalizedContactType = contactType.trim().toLowerCase();
			if (numericId > 0 && options?.resolveContactArk && (normalizedContactType === "qq" || normalizedContactType === "group")) {
				const ark = await options.resolveContactArk(contactType, numericId);
				if (!ark) throw new Error(`contact ark unavailable for ${contactType}:${numericId}`);
				return validatedOutboundElement({
					type: "json",
					text: ark
				});
			}
			return validatedOutboundElement({
				type: "json",
				text: JSON.stringify({
					app: "com.tencent.contact.lua",
					view: "contact",
					prompt: `[推荐${contactType === "group" ? "群" : "好友"}]`,
					meta: { contact: {
						type: contactType,
						id: contactId
					} }
				})
			});
		}
		case "rps": return validatedOutboundElement({
			type: "face",
			faceId: 359
		});
		case "dice": return validatedOutboundElement({
			type: "face",
			faceId: 358
		});
		case "shake": return validatedOutboundElement({
			type: "poke",
			subType: 1
		});
		case "anonymous": throw new MessageElementValidationError("UNSENDABLE_TYPE", "message segment \"anonymous\" has no executable send semantics", normalizedType);
	}
	const codec = getElementCodec(normalizedType);
	if (codec?.fromSegment) {
		const element = await codec.fromSegment(data, options);
		if (!element) {
			if (normalizedType === "reply") return null;
			throw new MessageElementValidationError("MISSING_FIELD", `message segment "${normalizedType}" is missing required or usable fields`, normalizedType);
		}
		return validatedOutboundElement(element);
	}
	if (Object.hasOwn(ELEMENT_MANIFEST, normalizedType)) assertValidMessageElement({ type: normalizedType }, "P");
	throw new MessageElementValidationError("UNKNOWN_TYPE", `unknown message segment type: ${type}`, normalizedType);
}
function segmentPayload(seg) {
	const topLevel = { ...seg };
	delete topLevel.type;
	delete topLevel.data;
	if (normalizeSegmentType(seg.type) === "json" && typeof seg.data === "string") return {
		...topLevel,
		data: seg.data
	};
	const nested = seg.data && typeof seg.data === "object" && !Array.isArray(seg.data) ? seg.data : {};
	return {
		...topLevel,
		...nested
	};
}
async function parseMessage(message, autoEscape, options) {
	if (typeof message === "string") {
		if (message.length === 0) throw invalidMessageShape("message must not be empty");
		if (autoEscape) return [validatedOutboundElement({
			type: "text",
			text: message
		})];
		const elements = await parseFromCQString(message, options);
		if (elements.length === 0) throw invalidMessageShape("message must contain at least one sendable segment");
		return elements;
	}
	if (Array.isArray(message)) {
		if (!isSegmentArray(message)) throw new MessageElementValidationError("INVALID_FIELD", "message segment array entries must be objects with a non-empty string type", void 0, "message");
		if (message.length === 0) throw invalidMessageShape("message segment array must not be empty");
		const elements = [];
		for (const seg of message) {
			const data = segmentPayload(seg);
			if (isExplicitEmptyTextPlaceholder(seg)) {
				log$58.debug("ignored explicit empty text placeholder in message segment array");
				continue;
			}
			const elem = await segmentToElement(seg.type, data, options);
			if (elem) elements.push(elem);
		}
		if (elements.length === 0) throw invalidMessageShape("message must contain at least one sendable segment");
		return elements;
	}
	if (typeof message === "object" && message !== null && !Array.isArray(message)) {
		const seg = message;
		if (typeof seg.type === "string" && seg.type.trim()) {
			const data = segmentPayload(seg);
			const elem = await segmentToElement(seg.type, data, options);
			if (elem) return [elem];
			throw invalidMessageShape("message must contain at least one sendable segment");
		}
		throw new MessageElementValidationError("MISSING_FIELD", "single message segment requires a non-empty string type", void 0, "type");
	}
	throw new MessageElementValidationError("INVALID_FIELD", "message must be a string, a segment object, or a segment array", void 0, "message");
}
export {};
