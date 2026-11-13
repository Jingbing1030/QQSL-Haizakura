// ---------------------------------------------------------------------------
// satori-elements.ts — Satori 元素串 <-> OneBot v11 消息段 双向编码
//
// 契约：docs-notes/SATORI-INTERFACE.md 第 1 节「消息编码」
// 参考：reference/satori/message.ts（LLBot MessageEncoder.visit）+ utils.ts
//
// 设计约束（SnowLuma 单一扁平作用域 bundle）：
//   * 无 import、无真 export（结尾只有 `export {};`，构建时被剥掉）；
//   * 不引用 bundle 内任何既有标识符 —— 纯函数、零依赖，
//     因此插在任意初始化点之后都安全（不会出 TypeError）；
//   * 所有顶层名统一 satori / SATORI 前缀，避免与既有 8392 个顶层名冲突。
//   * 健壮性优先：任何未知元素 / 未知段 / 畸形输入都降级，绝不抛错。
// ---------------------------------------------------------------------------
// @ts-nocheck

/** OneBot v11 消息段：{ type, data } */
interface SatoriOneBotSegment {
	type: string;
	data: Record<string, any>;
}

/** 解析出来的元素属性表 */
type SatoriElementAttrs = Record<string, string>;

/** Satori 文本/属性中会出现的 HTML 实体（命名实体表） */
var SATORI_HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0"
};

/** Satori 里需要「丢弃标签、保留内部内容」的修饰元素（仅为可读性登记，行为与未知元素一致） */
var SATORI_MODIFIER_ELEMENTS = {
	b: true,
	strong: true,
	i: true,
	em: true,
	u: true,
	s: true,
	del: true,
	code: true,
	sup: true,
	sub: true,
	span: true,
	a: true,
	author: true
};

/** 空元素（不会成对出现，不参与配对栈） */
var SATORI_VOID_ELEMENTS = {
	br: true,
	at: true,
	img: true,
	image: true,
	audio: true,
	video: true,
	file: true,
	emoji: true,
	face: true,
	quote: true
};

/* ===========================================================================
 * HTML 转义 / 反转义
 * =========================================================================== */

/** HTML 反转义：命名实体 + &#NN; + &#xNN;（单趟扫描，不递归） */
function satoriUnescapeHtml(value: string): string {
	if (typeof value !== "string" || value.indexOf("&") < 0) return value;
	return value.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, function (match, body: string): string {
		if (body.charCodeAt(0) === 35 /* '#' */) {
			const isHex = body[1] === "x" || body[1] === "X";
			const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
			if (!isFinite(code) || code < 0 || code > 1114111) return match;
			try {
				return String.fromCodePoint(code);
			} catch {
				return match;
			}
		}
		const named = SATORI_HTML_ENTITIES[body.toLowerCase()];
		return named === undefined ? match : named;
	});
}

/** 属性值 HTML 转义（" & < >） */
function satoriEscapeAttr(value: any): string {
	return String(value === undefined || value === null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** 文本节点 HTML 转义（& < >；引号保持原样，与 Satori 一致） */
function satoriEscapeText(value: any): string {
	return String(value === undefined || value === null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/* ===========================================================================
 * 词法：标签扫描 + 属性解析
 * =========================================================================== */

/** 从 from 起找到标签的结束 '>'（跳过引号内的内容）；找不到返回 -1 */
function satoriFindTagEnd(text: string, from: number): number {
	let quote = "";
	for (let i = from; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === quote) quote = "";
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === ">") return i;
	}
	return -1;
}

/** 解析标签属性串：k="v" / k='v' / k=v / 裸 k */
function satoriParseAttrs(rawBody: string): SatoriElementAttrs {
	const attrs: SatoriElementAttrs = {};
	if (!rawBody) return attrs;
	const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(rawBody)) !== null) {
		const name = m[1].toLowerCase();
		const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
		attrs[name] = satoriUnescapeHtml(raw);
		// 零宽匹配保护
		if (m.index === re.lastIndex) re.lastIndex++;
	}
	return attrs;
}

/* ===========================================================================
 * 1. Satori 元素串 → OneBot 消息段数组
 * =========================================================================== */

/**
 * Satori 元素串 → OneBot v11 消息段数组。
 *
 * 映射（契约 §1）：
 *   text              → text
 *   at id=/type=all    → at { qq }
 *   img / image        → image  { file: src }
 *   audio              → record { file: src }
 *   video              → video  { file: src }
 *   file               → file   { file: src }
 *   quote              → reply  { id }
 *   message            → forward{ id }（无 id 时当作容器，继续处理子元素）
 *   emoji / face       → face   { id }
 *   br / p             → text "\n"（p 按段落语义：必要时补前导换行、末尾补换行）
 *   b/i/u/s/code/...   → 丢弃标签、保留内部内容（降级为纯文本）
 *   未知元素            → 丢弃标签、保留内部内容
 */
function satoriDecodeToSegments(content: string): SatoriOneBotSegment[] {
	if (typeof content !== "string" || content.length === 0) return [];

	const segments: SatoriOneBotSegment[] = [];
	const stack: string[] = [];
	/** <p> 是否已经补过前导换行（同一次 p 只补一次，闭合标签不重复补） */
	let paragraphOpened = false;

	const pushText = (text: string): void => {
		if (!text) return;
		segments.push({ type: "text", data: { text } });
	};
	const pushSegment = (type: string, data: Record<string, any>): void => {
		segments.push({ type, data });
	};
	/** 需要段落分隔时返回 true：前面已有输出、且它不以换行结尾 */
	const paragraphSeparatorNeeded = (): boolean => {
		if (segments.length === 0) return false;
		const last = segments[segments.length - 1];
		return !(last.type === "text" && String(last.data.text).endsWith("\n"));
	};
	/** <p> 开始：必要时补一个前导换行，使段落另起一行 */
	const openParagraph = (): void => {
		if (paragraphOpened) return;
		paragraphOpened = true;
		if (paragraphSeparatorNeeded()) pushText("\n");
	};
	/** </p> 结束：补一个换行（契约表：p → text "\n"） */
	const closeParagraph = (): void => {
		paragraphOpened = false;
		if (!paragraphSeparatorNeeded()) return; // 已以 \n 结尾，不重复追加
		pushText("\n");
	};

	let i = 0;
	const len = content.length;

	while (i < len) {
		const lt = content.indexOf("<", i);
		if (lt < 0) {
			pushText(satoriUnescapeHtml(content.slice(i)));
			break;
		}
		if (lt > i) pushText(satoriUnescapeHtml(content.slice(i, lt)));

		// HTML 注释：整段丢弃
		if (content.startsWith("<!--", lt)) {
			const end = content.indexOf("-->", lt + 4);
			i = end < 0 ? len : end + 3;
			continue;
		}

		const head = /^<(\/?)([A-Za-z][A-Za-z0-9_:.\-]*)/.exec(content.slice(lt));
		if (!head) {
			// 例如 "a < b" / "<3"：'<' 是普通文本
			pushText("<");
			i = lt + 1;
			continue;
		}
		const tagEnd = satoriFindTagEnd(content, lt + head[0].length);
		if (tagEnd < 0) {
			// 未闭合的 '<name'：'<' 当文本，剩余部分下一轮按文本处理
			pushText("<");
			i = lt + 1;
			continue;
		}

		const closing = head[1] === "/";
		const name = head[2].toLowerCase();
		const rawBody = content.slice(lt + head[0].length, tagEnd);
		const selfClosing = closing ? false : /\/\s*$/.test(rawBody) || !!SATORI_VOID_ELEMENTS[name];
		i = tagEnd + 1;

		if (closing) {
			const idx = stack.lastIndexOf(name);
			if (idx >= 0) {
				for (let k = stack.length - 1; k >= idx; k--) if (stack[k] === "p") closeParagraph();
				stack.length = idx;
			}
			continue;
		}

		if (name === "p") openParagraph();
		if (!selfClosing) stack.push(name);

		switch (name) {
			case "br": {
				pushText("\n");
				break;
			}
			case "p": {
				if (selfClosing) closeParagraph();
				break;
			}
			case "at": {
				const attrs = satoriParseAttrs(rawBody);
				const id = String(attrs.id ?? "").trim();
				if (attrs.type === "all" || id === "all") pushSegment("at", { qq: "all" });
				else if (id) pushSegment("at", { qq: id });
				break;
			}
			case "img":
			case "image": {
				const attrs = satoriParseAttrs(rawBody);
				const src = String(attrs.src ?? attrs.url ?? "").trim();
				if (src) pushSegment("image", { file: src });
				break;
			}
			case "audio": {
				const attrs = satoriParseAttrs(rawBody);
				const src = String(attrs.src ?? attrs.url ?? "").trim();
				if (src) pushSegment("record", { file: src });
				break;
			}
			case "video": {
				const attrs = satoriParseAttrs(rawBody);
				const src = String(attrs.src ?? attrs.url ?? "").trim();
				if (src) pushSegment("video", { file: src });
				break;
			}
			case "file": {
				const attrs = satoriParseAttrs(rawBody);
				const src = String(attrs.src ?? attrs.url ?? "").trim();
				if (src) pushSegment("file", { file: src });
				break;
			}
			case "quote": {
				const attrs = satoriParseAttrs(rawBody);
				const id = String(attrs.id ?? "").trim();
				if (id) pushSegment("reply", { id });
				break;
			}
			case "message": {
				const attrs = satoriParseAttrs(rawBody);
				const id = String(attrs.id ?? "").trim();
				// 带 id → 合并转发；不带 id → 容器，子元素继续按常规处理
				if (id) pushSegment("forward", { id });
				break;
			}
			case "emoji":
			case "face": {
				const attrs = satoriParseAttrs(rawBody);
				const id = String(attrs.id ?? "").trim();
				if (id) pushSegment("face", { id });
				break;
			}
			default: {
				// 修饰元素 / 未知元素：丢弃标签本身，内部内容已由主循环继续处理
				break;
			}
		}
	}

	return satoriMergeTextSegments(segments);
}

/** 合并相邻 text 段；丢弃空 text 段（保持段数组紧凑，便于下游 raw_message 生成） */
function satoriMergeTextSegments(segments: SatoriOneBotSegment[]): SatoriOneBotSegment[] {
	const merged: SatoriOneBotSegment[] = [];
	for (const seg of segments) {
		const last = merged[merged.length - 1];
		if (seg.type === "text" && last && last.type === "text") {
			last.data.text = String(last.data.text) + String(seg.data.text);
			continue;
		}
		merged.push(seg);
	}
	return merged.filter((seg) => !(seg.type === "text" && seg.data.text === ""));
}

/* ===========================================================================
 * 2. OneBot 消息段数组 → Satori 元素串
 * =========================================================================== */

/** 取段的负载：优先 data 对象，其次段自身的扁平字段（兼容两种 OneBot 形状） */
function satoriSegmentPayload(segment: any): Record<string, any> {
	const payload: Record<string, any> = {};
	if (!segment || typeof segment !== "object") return payload;
	for (const key of Object.keys(segment)) {
		if (key === "type" || key === "data") continue;
		payload[key] = segment[key];
	}
	const nested = segment.data;
	if (nested && typeof nested === "object" && !Array.isArray(nested)) Object.assign(payload, nested);
	else if (typeof nested === "string") payload.data = nested;
	return payload;
}

/** 媒体段的源：file 优先，其次 url / path / media */
function satoriMediaSource(data: Record<string, any>): string {
	for (const key of ["file", "url", "path", "media"]) {
		const value = data[key];
		if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
	}
	return "";
}

/** 单个 OneBot 段 → Satori 元素串（未知段降级为 `[type]`） */
function satoriEncodeSegment(type: string, data: Record<string, any>): string {
	switch (type) {
		case "text":
			return satoriEscapeText(data.text !== undefined ? data.text : data.content !== undefined ? data.content : "");
		case "at": {
			const qq = String(data.qq ?? "").trim();
			if (!qq) return satoriEscapeText("[at]");
			if (qq === "all") return '<at type="all"/>';
			return '<at id="' + satoriEscapeAttr(qq) + '"/>';
		}
		case "face": {
			const id = String(data.id ?? "").trim();
			if (!id) return satoriEscapeText("[face]");
			return '<emoji id="' + satoriEscapeAttr(id) + '"/>';
		}
		case "image": {
			const src = satoriMediaSource(data);
			if (!src) return satoriEscapeText("[image]");
			return '<img src="' + satoriEscapeAttr(src) + '"/>';
		}
		case "record": {
			const src = satoriMediaSource(data);
			if (!src) return satoriEscapeText("[record]");
			return '<audio src="' + satoriEscapeAttr(src) + '"/>';
		}
		case "video": {
			const src = satoriMediaSource(data);
			if (!src) return satoriEscapeText("[video]");
			return '<video src="' + satoriEscapeAttr(src) + '"/>';
		}
		case "file": {
			const src = satoriMediaSource(data);
			if (!src) return satoriEscapeText("[file]");
			return '<file src="' + satoriEscapeAttr(src) + '"/>';
		}
		case "reply": {
			const id = String(data.id ?? data.message_id ?? "").trim();
			if (!id) return satoriEscapeText("[reply]");
			return '<quote id="' + satoriEscapeAttr(id) + '"/>';
		}
		case "forward": {
			const id = String(data.id ?? data.res_id ?? data.forward_id ?? "").trim();
			if (!id) return satoriEscapeText("[forward]");
			return '<message id="' + satoriEscapeAttr(id) + '"/>';
		}
		default:
			return satoriEscapeText("[" + type + "]");
	}
}

/**
 * OneBot v11 消息段数组 → Satori 元素串。
 * 未知段降级为文本 `[type]`，不抛错。
 */
function satoriEncodeFromSegments(segments: any): string {
	if (!Array.isArray(segments)) return "";
	const parts: string[] = [];
	for (const segment of segments) {
		if (!segment || typeof segment !== "object") continue;
		const type = typeof segment.type === "string" ? segment.type.trim().toLowerCase() : "";
		if (!type) continue;
		try {
			parts.push(satoriEncodeSegment(type, satoriSegmentPayload(segment)));
		} catch {
			parts.push(satoriEscapeText("[" + type + "]"));
		}
	}
	return parts.join("");
}

/* ===========================================================================
 * 3. 便捷包装：OneBot message（string | array）→ Satori 元素串
 * =========================================================================== */

/** CQ 参数值反转义（与 bundle 的 parseCQParams 同规则，但自带实现保持零依赖） */
function satoriCqUnescape(value: string): string {
	return String(value)
		.replace(/&#91;/g, "[")
		.replace(/&#93;/g, "]")
		.replace(/&#44;/g, ",")
		.replace(/&amp;/g, "&");
}

/** CQ 码字符串 → OneBot 段数组（未知 CQ 码降级为 `[type]` 文本段） */
function satoriParseCqSegments(text: string): SatoriOneBotSegment[] {
	const segments: SatoriOneBotSegment[] = [];
	const re = /\[CQ:([A-Za-z][A-Za-z0-9_]*)((?:,[^\]]*)?)\]/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m.index > last) {
			const plain = satoriCqUnescape(text.slice(last, m.index));
			if (plain) segments.push({ type: "text", data: { text: plain } });
		}
		last = m.index + m[0].length;
		const type = m[1].toLowerCase();
		const params: Record<string, string> = {};
		for (const pair of String(m[2] || "").replace(/^,/, "").split(",")) {
			const eq = pair.indexOf("=");
			if (eq > 0) params[pair.slice(0, eq).trim().toLowerCase()] = satoriCqUnescape(pair.slice(eq + 1));
		}
		const data: Record<string, any> = {};
		if (type === "text") data.text = params.text ?? "";
		else if (type === "at") data.qq = params.qq ?? "";
		else if (type === "face") data.id = params.id ?? "";
		else if (type === "reply") data.id = params.id ?? "";
		else if (type === "forward") data.id = params.id ?? params.res_id ?? "";
		else Object.assign(data, params);
		segments.push({ type, data });
	}
	if (last < text.length) {
		const plain = satoriCqUnescape(text.slice(last));
		if (plain) segments.push({ type: "text", data: { text: plain } });
	}
	return segments;
}

/**
 * OneBot 的 message 字段（string 或 segment 数组）→ Satori 元素串。
 *   string 且含 CQ 码 → 解析 CQ 后走段编码；否则整体作为纯文本（转义）。
 *   array             → 直接走段编码。
 *   { type, data }    → 单段，等价于长度 1 的数组。
 */
function satoriEncodeMessage(message: any): string {
	if (typeof message === "string") {
		if (message.indexOf("[CQ:") >= 0) return satoriEncodeFromSegments(satoriParseCqSegments(message));
		return satoriEscapeText(message);
	}
	if (Array.isArray(message)) return satoriEncodeFromSegments(message);
	if (message && typeof message === "object" && typeof message.type === "string") return satoriEncodeFromSegments([message]);
	return "";
}

export {};
