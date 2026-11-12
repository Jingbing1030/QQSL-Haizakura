// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/element-codecs.ts"
// original bundle lines 21698-22155  (456 lines) of dist/index.mjs
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
var log$59 = createLogger("MsgParser");
function intOr(value, fallback = 0) {
	if (value === void 0 || value === null) return fallback;
	if (typeof value === "number") {
		if (Number.isSafeInteger(value)) return value;
		throw new MessageElementValidationError("INVALID_FIELD", `numeric message segment field must be a safe integer, received ${String(value)}`);
	}
	if (typeof value === "string") {
		const text = value.trim();
		if (!text) return fallback;
		if (!/^[+-]?\d+$/.test(text)) throw new MessageElementValidationError("INVALID_FIELD", `numeric message segment field must contain only an integer, received ${JSON.stringify(value)}`);
		const parsed = Number(text);
		if (Number.isSafeInteger(parsed)) return parsed;
	}
	throw new MessageElementValidationError("INVALID_FIELD", `numeric message segment field must be a safe integer, received ${String(value)}`);
}
/** Build a market-face (`mface`) element from an OneBot segment's data.
*  Shared by the dedicated `mface` segment and the `image`-with-`emoji_id`
*  round-trip path. `emojiId` is the hex GUID the wire builder converts back
*  to `MarketFace.faceId`. */
function marketFaceElement(emojiId, data) {
	return {
		type: "mface",
		text: String(data.summary ?? data.name ?? ""),
		emojiId,
		emojiPackageId: intOr(data.emoji_package_id ?? data.tab_id, 0),
		emojiKey: String(data.key ?? "")
	};
}
/**
* Pick the best loadable source from a media segment's `file` / `url` / `path`
* / `media` fields.
*
* `file` is normally the canonical OneBot field and wins, but it can also be a
* QQ-internal media id (e.g. `<md5>.png`) that this process cannot resolve to a
* local path. When a bot framework echoes a received image back (Yunzai et al.
* resend the original `file=<md5>.ext` together with the download `url`), using
* `file` makes the send path `statSync` the id as a bogus local path and throw
* `ENOENT`. So: keep `file` when it is a directly loadable source (inline
* bytes, a remote url, or a filesystem path with a separator); otherwise, if a
* real http(s) `url` accompanies it, prefer that. (issue #155)
*/
function isInlineMediaSource(value) {
	return /^(base64:\/\/|data:)/i.test(value);
}
function pickMediaSource(data) {
	const file = String(data.file ?? "").trim();
	const url = String(data.url ?? "").trim();
	const fallback = file || url || String(data.path ?? "").trim() || String(data.media ?? "").trim();
	if (!file) return fallback;
	if (isInlineMediaSource(file) || /^(https?:\/\/|file:\/\/)/i.test(file) || /[\\/]/.test(file)) return file;
	if (/^https?:\/\//i.test(url)) return url;
	return fallback;
}
var ELEMENT_CODECS = {
	text: {
		async toSegment(element) {
			return {
				type: "text",
				data: { text: element.text ?? "" }
			};
		},
		async fromSegment(data) {
			const text = String(data.text ?? "");
			return text ? {
				type: "text",
				text
			} : null;
		}
	},
	face: {
		async toSegment(element) {
			return {
				type: "face",
				data: {
					id: String(element.faceId ?? 0),
					...element.resultId !== void 0 ? { resultId: element.resultId } : {}
				}
			};
		},
		async fromSegment(data) {
			const id = intOr(data.id, -1);
			if (id < 0) return null;
			const element = {
				type: "face",
				faceId: id
			};
			if (data.resultId !== void 0) if (typeof data.resultId === "string") element.resultId = data.resultId;
			else if (typeof data.resultId === "number" && Number.isSafeInteger(data.resultId) && data.resultId >= 0) element.resultId = String(data.resultId);
			else throw new MessageElementValidationError("INVALID_FIELD", "face.resultId must be a string or non-negative safe integer", "face", "resultId");
			if (data.large !== void 0) if (data.large === true || data.large === "true" || data.large === 1 || data.large === "1") element.large = true;
			else if (data.large === false || data.large === "false" || data.large === 0 || data.large === "0") element.large = false;
			else throw new MessageElementValidationError("INVALID_FIELD", "face.large must be a boolean");
			return element;
		}
	},
	at: {
		async toSegment(element) {
			return {
				type: "at",
				data: { qq: element.uid === "all" || element.targetUin === 0 ? "all" : String(element.targetUin ?? 0) }
			};
		},
		async fromSegment(data, options) {
			const qq = String(data.qq ?? "").trim();
			if (qq === "all") return {
				type: "at",
				targetUin: 0,
				uid: "all",
				text: "@全体成员 "
			};
			const uin = intOr(qq, 0);
			if (uin <= 0) return null;
			const name = String(data.name ?? data.nickname ?? data.card ?? "").trim();
			let uid = String(data.uid ?? "").trim();
			if (!uid && options?.resolveMentionUid) uid = (await options.resolveMentionUid(uin))?.trim() ?? "";
			const element = {
				type: "at",
				targetUin: uin
			};
			if (uid) element.uid = uid;
			if (name) element.text = `@${name} `;
			return element;
		}
	},
	reply: {
		async toSegment(element, ctx) {
			const sentBySelf = !ctx.isGroup && ctx.selfId > 0 && element.replySenderUin === ctx.selfId;
			const eventName = ctx.isGroup ? GROUP_MESSAGE_EVENT : privateMessageEventName(sentBySelf, false);
			const id = element.replyMessageId ?? await resolveReplyId(ctx.isGroup, ctx.sessionId, element.replySeq ?? 0, ctx.messageIdResolver, eventName, element.replyTime && element.replyTime > 0 ? element.replyTime : Number.MAX_SAFE_INTEGER, element.replyElements, ctx.currentMessage);
			return {
				type: "reply",
				data: { id: String(id) }
			};
		},
		async fromSegment(data, options) {
			let id;
			try {
				id = intOr(data.id, 0);
			} catch (error) {
				if (!(error instanceof MessageElementValidationError)) throw error;
				log$59.warn("could not quote the target message");
				return null;
			}
			if (id === 0) {
				log$59.warn("could not quote the target message");
				return null;
			}
			const meta = await options?.resolveReplyMeta?.(id) ?? null;
			if (options?.resolveReplySequence) {
				const resolved = await options.resolveReplySequence(id);
				if (typeof resolved === "number" && resolved > 0) {
					const element = {
						type: "reply",
						replySeq: resolved,
						replyMessageId: id
					};
					if (meta) {
						element.replySenderUin = meta.senderUin;
						element.replyTime = meta.time;
						element.replyRandom = meta.random;
						element.replyElements = meta.elements;
					}
					return element;
				}
			}
			if (meta?.sequenceAuthoritative === false) {
				log$59.warn("could not quote the target message");
				return null;
			}
			if (id > 0) return {
				type: "reply",
				replySeq: id
			};
			log$59.warn("could not quote the target message");
			return null;
		}
	},
	image: {
		async toSegment(element, ctx) {
			const source = (element.imageUrl || element.url || "").trim();
			const inline = isInlineMediaSource(source);
			const resolved = !inline && source && !element.imageUrl ? {
				...element,
				imageUrl: source
			} : element;
			const data = {
				url: inline ? "" : ctx.imageUrlResolver ? await ctx.imageUrlResolver(resolved, ctx.isGroup) : source,
				file: element.fileId || (element.md5Hex ? `${element.md5Hex.toLowerCase()}.png` : "") || (inline ? "" : source),
				sub_type: element.subType ?? 0,
				summary: element.summary ?? ""
			};
			if (element.flash) data.type = "flash";
			if (ctx.mediaSegmentSink) await ctx.mediaSegmentSink("image", element, data, ctx.isGroup, ctx.sessionId);
			return {
				type: "image",
				data
			};
		},
		async fromSegment(data) {
			const imgEmojiId = String(data.emoji_id ?? "").trim();
			if (imgEmojiId) return marketFaceElement(imgEmojiId, data);
			return {
				type: "image",
				url: pickMediaSource(data),
				flash: data.type === "flash",
				subType: intOr(data.sub_type ?? data.subType, 0),
				summary: data.summary ? String(data.summary) : void 0
			};
		}
	},
	record: {
		async toSegment(element, ctx) {
			const rawUrl = ctx.mediaUrlResolver ? await ctx.mediaUrlResolver(element, ctx.isGroup, ctx.sessionId) : element.url ?? "";
			const url = isInlineMediaSource(rawUrl) ? "" : rawUrl;
			const data = {
				file: element.fileName ?? element.fileId ?? "",
				url
			};
			if (ctx.mediaSegmentSink) await ctx.mediaSegmentSink("record", element, data, ctx.isGroup, ctx.sessionId);
			return {
				type: "record",
				data
			};
		},
		async fromSegment(data) {
			const source = pickMediaSource(data);
			if (!source) return null;
			return {
				type: "record",
				url: source
			};
		}
	},
	video: {
		async toSegment(element, ctx) {
			const rawUrl = ctx.mediaUrlResolver ? await ctx.mediaUrlResolver(element, ctx.isGroup, ctx.sessionId) : element.url ?? "";
			const url = isInlineMediaSource(rawUrl) ? "" : rawUrl;
			const data = {
				file: element.fileName ?? element.fileId ?? "",
				url
			};
			if (ctx.mediaSegmentSink) await ctx.mediaSegmentSink("video", element, data, ctx.isGroup, ctx.sessionId);
			return {
				type: "video",
				data
			};
		},
		async fromSegment(data) {
			const source = pickMediaSource(data);
			if (!source) return null;
			return {
				type: "video",
				url: source,
				thumbUrl: data.thumb ? String(data.thumb) : void 0
			};
		}
	},
	json: {
		async toSegment(element) {
			return {
				type: "json",
				data: { data: element.text ?? "" }
			};
		},
		async fromSegment(data) {
			const raw = data.data;
			const text = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? JSON.stringify(raw) : raw;
			if (typeof text !== "string" || !text.trim()) throw new MessageElementValidationError("INVALID_FIELD", "message segment \"json\" field \"data\" must be a JSON object or non-empty JSON string", "json", "data");
			return {
				type: "json",
				text
			};
		}
	},
	xml: {
		async toSegment(element) {
			return {
				type: "xml",
				data: {
					data: element.text ?? "",
					resid: element.subType ?? 35
				}
			};
		},
		async fromSegment(data) {
			return {
				type: "xml",
				text: String(data.data ?? ""),
				subType: intOr(data.resid ?? data.id, 0)
			};
		}
	},
	file: {
		async toSegment(element, ctx) {
			const url = ctx.mediaUrlResolver ? await ctx.mediaUrlResolver(element, ctx.isGroup, ctx.sessionId) : element.url ?? "";
			const fileName = element.fileName ?? "";
			const fileSize = element.fileSize ?? 0;
			const fileId = element.fileId ?? "";
			return {
				type: "file",
				data: {
					file: fileName,
					file_id: fileId,
					file_size: fileSize,
					name: fileName,
					size: fileSize,
					id: fileId,
					url,
					file_hash: element.fileHash ?? ""
				}
			};
		},
		async fromSegment(data) {
			const fileId = String(data.file_id ?? data.fileId ?? data.id ?? "").trim();
			const source = pickMediaSource(data);
			if (!fileId && !source) {
				log$59.warn("[MsgParser] file segment without file_id or file/url is unsupported");
				return null;
			}
			const fileName = String(data.name ?? data.filename ?? data.fileName ?? "").trim();
			const fileSize = intOr(data.file_size ?? data.size ?? data.fileSize, 0);
			const md5Hex = String(data.md5 ?? data.md5Hex ?? "").trim();
			const sha1Hex = String(data.sha1 ?? data.sha1Hex ?? "").trim();
			const fileHash = String(data.file_hash ?? data.fileHash ?? "").trim();
			const elem = fileId ? {
				type: "file",
				fileId
			} : {
				type: "file",
				url: source
			};
			if (fileName) elem.fileName = fileName;
			if (fileSize > 0) elem.fileSize = fileSize;
			if (md5Hex) elem.md5Hex = md5Hex;
			if (sha1Hex) elem.sha1Hex = sha1Hex;
			if (fileHash) elem.fileHash = fileHash;
			return elem;
		}
	},
	mface: {
		async toSegment(element) {
			const emojiId = element.emojiId ?? "";
			const dir = emojiId.slice(0, 2);
			const url = emojiId ? `https://gxh.vip.qq.com/club/item/parcel/item/${dir}/${emojiId}/raw300.gif` : "";
			return {
				type: "image",
				data: {
					file: emojiId ? `${dir}-${emojiId}.gif` : "",
					url,
					summary: element.text ?? "",
					sub_type: 0,
					emoji_id: emojiId,
					emoji_package_id: element.emojiPackageId ?? 0,
					key: element.emojiKey ?? ""
				}
			};
		},
		async fromSegment(data) {
			const emojiId = String(data.emoji_id ?? "").trim();
			if (!emojiId) {
				log$59.warn("[MsgParser] mface segment without emoji_id is unsupported");
				return null;
			}
			return marketFaceElement(emojiId, data);
		}
	},
	poke: {
		async toSegment(element) {
			return {
				type: "poke",
				data: { type: element.subType ?? 0 }
			};
		},
		async fromSegment(data) {
			if (data.type === void 0 && data.id === void 0) return null;
			return {
				type: "poke",
				subType: intOr(data.type ?? data.id, 0)
			};
		}
	},
	flash_file: { async toSegment(element) {
		return {
			type: "flash_file",
			data: {
				title: element.fileName ?? "",
				file_set_id: element.filesetId ?? "",
				scene_type: element.sceneType ?? 0,
				thumb: element.thumbUrl ?? ""
			}
		};
	} },
	forward: {
		async toSegment(element) {
			return {
				type: "forward",
				data: { id: element.resId ?? "" }
			};
		},
		async fromSegment(data) {
			return {
				type: "forward",
				resId: String(data.id ?? data.res_id ?? data.forward_id ?? "")
			};
		}
	},
	markdown: {
		async toSegment(element) {
			return {
				type: "markdown",
				data: { content: element.text }
			};
		},
		async fromSegment(data) {
			return {
				type: "markdown",
				text: String(data.content ?? "")
			};
		}
	},
	inline_keyboard: { async toSegment(element) {
		return {
			type: "inline_keyboard",
			data: {
				bot_appid: element.botAppid,
				rows: element.rows.map((row) => ({ buttons: row.buttons.map((button) => ({
					id: button.id,
					label: button.label,
					visited_label: button.visitedLabel,
					style: button.style,
					type: button.type,
					click_limit: button.clickLimit,
					unsupport_tips: button.unsupportedTips,
					data: button.data,
					at_bot_show_channel_list: button.atBotShowChannelList,
					permission_type: button.permissionType,
					specify_role_ids: button.specifyRoleIds,
					specify_user_ids: button.specifyUserIds,
					is_reply: button.isReply,
					enter: button.enter,
					anchor: button.anchor
				})) }))
			}
		};
	} }
};
/**
* Dynamic lookup boundary. Each table entry is checked against its precise
* discriminant above; callers with a runtime type receive the safe union view.
*/
function getElementCodec(type) {
	if (!Object.hasOwn(ELEMENT_CODECS, type)) return;
	return ELEMENT_CODECS[type];
}
export {};
