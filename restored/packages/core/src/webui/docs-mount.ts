// @ts-nocheck
// ---------------------------------------------------------------------------
// WebUI 内置离线文档 —— /docs 路由
//
// 为什么用「patch registerStaticFrontend」而不是改 server.ts：
//   server.ts 是现有 region（改它要重编号 432 个 region），而
//   registerStaticFrontend 是【顶层函数】——函数声明可重新赋值，
//   所以在不碰 server.ts 的前提下就能把自己的路由插进同一个 app 实例。
//
// ⚠️ 关键次序（实测，见下方 hzDocsRegisterRoutes 注释）：
//   registerStaticFrontend 内部最后注册了 app.get("*") 兜底路由，
//   Hono 按【注册顺序】匹配，先注册的 "*" 会把后注册的 /docs 全部吞掉。
//   实测：docs 后注册 -> GET /docs 返回 SPA 的 index.html；
//        docs 先注册 -> GET /docs 正常。所以必须先注册 /docs 再调原函数。
//
// 本文件 mode=inline：正文原样贴进 bundle 的扁平作用域，不是闭包。
// 顶层声明一律 hzDocs* 前缀，避免与已有 8392 个顶层名冲突。
// 不写 import：语料、gunzipSync、Buffer、createLogger、getCookie/setCookie、
//   extractWebuiSessionToken、sessionTokens 都已在 bundle 扁平作用域里。
// ---------------------------------------------------------------------------

var hzDocsLog = createLogger("WebUI.Docs");

/** 文档站点前缀 */
var HZ_DOCS_BASE = "/docs";

/** 可选鉴权 cookie（仅在 SNOWLUMA_DOCS_REQUIRE_AUTH=1 时使用） */
var HZ_DOCS_COOKIE = "hz_docs_session";

/** 每个响应都带的缓存策略：内容随构建变化，禁止中间层缓存 */
var hzDocsNoStore = { "Cache-Control": "no-store" };

// ---------------------------------------------------------------------------
// 1. 语料解码（惰性，首次请求时执行一次）
// ---------------------------------------------------------------------------

/** 解码后的语料：{ "guide/faq.md": "<markdown>" }；null 表示尚未解码 */
var hzDocsCorpusCache = null;

/**
 * 把内嵌的 gzip+base64 语料解成 { path: markdown }。
 * 只解一次并常驻（语料是固定的一小撮文件，内存占用有界）。
 */
function hzDocsDecodeCorpus() {
	if (hzDocsCorpusCache) return hzDocsCorpusCache;
	var decoded = {};
	try {
		var raw = gunzipSync(Buffer.from(hzDocsCorpusGzipB64, "base64")).toString("utf8");
		var parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") decoded = parsed;
	} catch (error) {
		hzDocsLog.error(
			"documentation corpus failed to decode: %s",
			error instanceof Error ? error.message : String(error)
		);
	}
	hzDocsCorpusCache = decoded;
	return decoded;
}

// ---------------------------------------------------------------------------
// 2. 路径解析 + 目录穿越防护
// ---------------------------------------------------------------------------

/**
 * 解析 /docs 之后的相对路径。
 *
 * 三道防线：
 *   ① 拒绝 NUL / 反斜杠 / 任何 ".." 段 / 任何以 "." 开头的段
 *   ② 去掉空段与 "."，只保留普通段
 *   ③ 【最关键】最终只接受语料对象的【自有键】—— 即使上面有漏洞，
 *      也只能命中内嵌映射里真实存在的键，不可能读到映射外的文件
 *
 * 返回 { kind: index | doc | dir | missing | invalid | traversal | hidden }
 */
function hzDocsResolvePath(rawPath) {
	var decoded;
	try {
		decoded = decodeURIComponent(rawPath);
	} catch {
		return { kind: "invalid" };
	}
	if (decoded.indexOf("\u0000") !== -1) return { kind: "invalid" };
	if (decoded.indexOf("\\") !== -1) return { kind: "invalid" };
	var segments = [];
	var parts = decoded.split("/");
	for (var i = 0; i < parts.length; i++) {
		var part = parts[i];
		if (part === "" || part === ".") continue;
		if (part === "..") return { kind: "traversal" };
		if (part.charAt(0) === ".") return { kind: "hidden" };
		segments.push(part);
	}
	if (!segments.length) return { kind: "index" };
	var key = segments.join("/");
	var corpus = hzDocsDecodeCorpus();
	if (Object.prototype.hasOwnProperty.call(corpus, key)) return { kind: "doc", key: key };
	if (Object.prototype.hasOwnProperty.call(corpus, key + ".md")) {
		return { kind: "doc", key: key + ".md" };
	}
	var prefix = key + "/";
	var children = Object.keys(corpus).filter((k) => k.indexOf(prefix) === 0).sort();
	if (children.length) return { kind: "dir", key: key, docs: children };
	return { kind: "missing", key: key };
}

// ---------------------------------------------------------------------------
// 3. 行内渲染
// ---------------------------------------------------------------------------

function hzDocsEscapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** 允许原样透传的 HTML 标签白名单（文档只用到这几个） */
var hzDocsRawTagRe = /<\/?(?:a|br|details|summary|kbd|sub|sup)\b[^>]*>/gi;
var hzDocsAllowedTagRe = /^<(\/?)(a|br|details|summary|kbd|sub|sup)((?:\s[^>]*)?)\/?>$/i;

/** 独立的 <a id="..."> 行（文档里 222 处都是这种自闭合写法） */
var hzDocsAnchorLineRe = /^\s*<a\s+id\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>\s*(?:<\/a>)?\s*$/i;

function hzDocsIsValidAnchorId(id) {
	return /^[A-Za-z0-9_.:\-]{1,120}$/.test(id);
}

/** 把独立的 <a id="x"></a> 行渲染成恰好一对标签；不匹配则返回 null */
function hzDocsAnchorLine(line) {
	var m = hzDocsAnchorLineRe.exec(String(line));
	if (!m) return null;
	var id = m[1] !== void 0 ? m[1] : m[2] || "";
	if (!hzDocsIsValidAnchorId(id)) return null;
	return '<a id="' + hzDocsEscapeHtml(id) + '"></a>';
}

/**
 * 校验一个原始 HTML 标签是否在白名单内。
 * 返回安全的 HTML 字符串，或 null（表示不通过 -> 调用方会转义显示）。
 */
function hzDocsSafeRawTag(tag) {
	var m = hzDocsAllowedTagRe.exec(tag);
	if (!m) return null;
	var closing = m[1] === "/";
	var name = m[2].toLowerCase();
	if (name === "a") {
		if (closing) return "</a>";
		var idm = /\bid\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[3] || "");
		if (!idm) return null;
		var id = idm[2] !== void 0 ? idm[2] : idm[3] || "";
		if (!hzDocsIsValidAnchorId(id)) return null;
		// 文档里 anchor 行通常自己带 </a>；这里只发开标签，避免出现 </a></a>
		return '<a id="' + hzDocsEscapeHtml(id) + '">';
	}
	if (name === "br") return "<br>";
	return closing ? "</" + name + ">" : "<" + name + ">";
}

/** 允许原样输出的 href：站内锚点、/docs 内部链接、http(s)、mailto、相对路径 */
function hzDocsSafeHref(href) {
	var value = String(href).trim();
	for (var i = 0; i < 3; i++) {
		value = value.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
	}
	value = value.replace(/[\u0000-\u001f\u007f]/g, "");
	if (/^(?:https?:|mailto:)/i.test(value)) return value;
	if (value.charAt(0) === "#") return value;
	if (/^\/docs(?:\/|$|#|\?)/.test(value)) return value;
	if (/^\/[A-Za-z0-9._~%\-/]*$/.test(value)) return value;
	if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(value)) return value; // 相对路径
	return "";
}

/**
 * 把相对文档链接解析成绝对的 /docs/... 路径。
 * 文档里大量使用同目录相对链接（如 faq.md 里的 `configuration.md`、
 * `../advanced/architecture.md`）。浏览器按当前 URL 解析相对链接在
 * /docs/<file>.md 形式下恰好正确，但换到 /docs/<dir>/ 或去掉 .md 后
 * 就会指错目录。这里按文档自身路径显式解析，任何入口形式都稳定。
 *
 * baseDir 为文档所在目录（如 "guide/"），返回值不带 ".md" 也能命中语料。
 */
function hzDocsResolveDocHref(href, baseDir) {
	if (!baseDir) return null;
	if (!/^[^/#?]/.test(href)) return null;                 // 已是绝对 / 锚点 / 查询
	if (/^(?:https?:|mailto:)/i.test(href)) return null;
	var parts = href.split(/[/\\]+/);
	var stack = String(baseDir).replace(/\/+$/, "").split("/").filter(Boolean);
	for (var i = 0; i < parts.length; i++) {
		var seg = parts[i];
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (stack.length) stack.pop();
			continue;
		}
		stack.push(seg);
	}
	var joined = stack.join("/");
	if (!joined) return null;
	return joined;
}

/** 标题 -> 锚点 id（保留中日韩字符，与 GitHub 风格接近） */
function hzDocsSlug(text) {
	var plain = String(text)
		.replace(/`([^`]*)`/g, "$1")
		.replace(/[*_~]/g, "")
		.toLowerCase();
	var out = "";
	var re = /[\p{L}\p{N}]+/gu;
	var m;
	while ((m = re.exec(plain))) out += (out ? "-" : "") + m[0];
	return out || "section";
}

/** 去掉行内标记，得到纯文本（用于标题/目录） */
function hzDocsPlainText(text) {
	return String(text)
		.replace(/`([^`]*)`/g, "$1")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_~]/g, "")
		.trim();
}

/**
 * 行内 Markdown -> HTML。
 *
 * 顺序很重要：先把「不该被转义/被再次处理」的东西抽成占位符
 * （白名单 HTML、行内代码、自动链接），再整体转义，最后做强调与链接，
 * 最后把占位符还原回真实 HTML。占位符用 \u0000 包裹，转义不会影响它。
 *
 * baseDir 用于把相对文档链接解析成 /docs/... 绝对路径（见 hzDocsResolveDocHref）。
 */
function hzDocsInline(src, baseDir) {
	var stashList = [];
	var stash = (html) => {
		stashList.push(html);
		return "\u0000" + (stashList.length - 1) + "\u0000";
	};

	var text = String(src);

	// ① 白名单原始 HTML + 自动链接 <https://...>
	text = text.replace(hzDocsRawTagRe, (tag) => {
		var safe = hzDocsSafeRawTag(tag);
		return safe === null ? tag : stash(safe);
	});
	text = text.replace(/<(https?:\/\/[^\s<>"']+)>/gi, (all, url) => {
		var href = hzDocsSafeHref(url);
		return href ? stash('<a href="' + hzDocsEscapeHtml(href) + '" rel="noreferrer noopener" target="_blank">' + hzDocsEscapeHtml(url) + "</a>") : all;
	});

	// ② 行内代码（必须先于强调，否则代码里的 ** 会被吞）
	text = text.replace(/(`+)([^`]+?)\1/g, (all, ticks, body) => stash("<code>" + hzDocsEscapeHtml(body) + "</code>"));

	// ③ 整体转义：此后除了我们自己生成的标签，不可能有真实 HTML 注入点
	text = hzDocsEscapeHtml(text);

	// ④ 图片（label/alt 此时已转义，且可能含 ② 的占位符，原样保留）
	text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (all, alt, href) => {
		var safe = hzDocsSafeHref(href);
		if (!safe) return alt;
		return '<img src="' + hzDocsEscapeHtml(safe) + '" alt="' + alt + '" loading="lazy">';
	});

	// ⑤ 链接
	// 链接文字不递归调用 hzDocsInline：内层调用有自己的 stash 表，
	// 返回的占位符会在外层的还原阶段被解析成错误的条目。文字此刻已转义，
	// 直接原样使用即可（其中若有 ② 产生的代码占位符，由 ⑦ 统一还原）。
	// 相对文档链接先解析成 /docs/... 绝对路径，保证任何入口形式下都正确。
	text = text.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (all, label, href) => {
		var safe = hzDocsSafeHref(href);
		if (!safe) return label;
		if (!/^(?:https?:|mailto:)/i.test(safe)) {
			var docPath = hzDocsResolveDocHref(safe, baseDir);
			if (docPath) safe = HZ_DOCS_BASE + "/" + docPath;
		}
		var external = /^https?:/i.test(safe);
		return (
			'<a href="' + hzDocsEscapeHtml(safe) + '"' +
			(external ? ' rel="noreferrer noopener" target="_blank"' : "") +
			">" + label + "</a>"
		);
	});

	// ⑥ 强调（** / __ 先行，再单个 * / _，最后 ~~）
	text = text.replace(/\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/g, "<strong>$1</strong>");
	text = text.replace(/(?<![\w*])__([^\s_](?:[^_]*[^\s_])?)__(?![\w*])/g, "<strong>$1</strong>");
	text = text.replace(/~~([^\s~](?:[^~]*[^\s~])?)~~/g, "<del>$1</del>");
	text = text.replace(/(?<![\w*])\*([^\s*](?:[^*]*[^\s*])?)\*(?![\w*])/g, "<em>$1</em>");
	text = text.replace(/(?<![\w_])_([^\s_](?:[^_]*[^\s_])?)_(?![\w_])/g, "<em>$1</em>");

	// ⑦ 还原占位符
	return text.replace(/\u0000(\d+)\u0000/g, (all, idx) => {
		var html = stashList[Number(idx)];
		return html === void 0 ? "" : html;
	});
}

// ---------------------------------------------------------------------------
// 4. 块级渲染（手写，覆盖文档实际用到的语法子集）
// ---------------------------------------------------------------------------

function hzDocsSplitRow(line) {
	var s = String(line).trim();
	if (s.charAt(0) === "|") s = s.slice(1);
	if (s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
	var cells = [];
	var cur = "";
	for (var i = 0; i < s.length; i++) {
		var ch = s.charAt(i);
		if (ch === "\\" && s.charAt(i + 1) === "|") {
			cur += "|";
			i++;
			continue;
		}
		if (ch === "|") {
			cells.push(cur.trim());
			cur = "";
			continue;
		}
		cur += ch;
	}
	cells.push(cur.trim());
	return cells;
}

function hzDocsIsTableDelim(line) {
	if (typeof line !== "string") return false;
	if (line.indexOf("-") === -1 || line.indexOf("|") === -1) return false;
	var cells = hzDocsSplitRow(line);
	return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function hzDocsRenderTable(lines, start, html, baseDir) {
	var head = hzDocsSplitRow(lines[start]);
	var align = hzDocsSplitRow(lines[start + 1]).map((cell) => {
		var left = cell.charAt(0) === ":";
		var right = cell.charAt(cell.length - 1) === ":";
		return left && right ? "center" : right ? "right" : left ? "left" : "";
	});
	var styleOf = (idx) => (align[idx] ? ' style="text-align:' + align[idx] + '"' : "");
	var out = ['<div class="tw"><table><thead><tr>'];
	for (var h = 0; h < head.length; h++) {
		out.push("<th" + styleOf(h) + ">" + hzDocsInline(head[h], baseDir) + "</th>");
	}
	out.push("</tr></thead><tbody>");
	var i = start + 2;
	while (i < lines.length && lines[i].indexOf("|") !== -1 && !/^\s*$/.test(lines[i])) {
		if (hzDocsIsTableDelim(lines[i])) break;
		var row = hzDocsSplitRow(lines[i]);
		out.push("<tr>");
		for (var c = 0; c < head.length; c++) {
			out.push("<td" + styleOf(c) + ">" + hzDocsInline(row[c] === void 0 ? "" : row[c], baseDir) + "</td>");
		}
		out.push("</tr>");
		i++;
	}
	out.push("</tbody></table></div>");
	html.push(out.join(""));
	return i;
}

/** 列表渲染：按缩进递归处理嵌套（文档里嵌套很浅，两层足够） */
function hzDocsRenderList(lines, start, html, baseDir) {
	var i = start;
	var baseIndent = /^(\s*)/.exec(lines[i])[1].length;
	var ordered = /^\s*\d{1,9}[.)]\s+/.test(lines[i]);
	var tag = ordered ? "ol" : "ul";
	html.push("<" + tag + ">");
	while (i < lines.length) {
		var line = lines[i];
		if (/^\s*$/.test(line)) {
			if (
				i + 1 < lines.length &&
				/^\s*(?:[-*+]|\d{1,9}[.)])\s+/.test(lines[i + 1]) &&
				/^(\s*)/.exec(lines[i + 1])[1].length >= baseIndent
			) {
				i++;
				continue;
			}
			break;
		}
		var m = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/.exec(line);
		if (!m) break;
		var indent = m[1].length;
		if (indent < baseIndent) break;
		if (indent > baseIndent) {
			// 嵌套：把整段子列表去缩进后递归渲染
			var sub = [];
			while (i < lines.length) {
				var mm = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+/.exec(lines[i]);
				if (!mm || mm[1].length < indent) break;
				sub.push(lines[i].slice(indent));
				i++;
			}
			hzDocsRenderList(sub, 0, html, baseDir);
			continue;
		}
		var itemLines = [m[4]];
		i++;
		// 续行：缩进更深，且本身不是新的列表项
		while (
			i < lines.length &&
			!/^\s*$/.test(lines[i]) &&
			!/^\s*(?:[-*+]|\d{1,9}[.)])\s+/.test(lines[i]) &&
			/^(\s*)/.exec(lines[i])[1].length > baseIndent
		) {
			itemLines.push(lines[i].trim());
			i++;
		}
		html.push("<li>" + hzDocsInline(itemLines.join(" "), baseDir) + "</li>");
	}
	html.push("</" + tag + ">");
	return i;
}

/** 中英混排：两侧都是 CJK 时软换行不补空格 */
function hzDocsJoiner(prevText, nextText) {
	var a = prevText.slice(-1);
	var b = nextText.charAt(0);
	if (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(a) && /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(b)) {
		return "";
	}
	return " ";
}

/**
 * Markdown -> { html, title, headings }。
 * 只实现文档语料真正用到的语法：标题 / 围栏代码 / 表格 / 列表（含嵌套）/
 * 引用 / 分隔线 / 段落（软换行 + 硬换行）/ 行内代码 / 强调 / 链接 / 图片，
 * 以及 <details> <summary> <a id> <br> 这几个白名单原样 HTML。
 *
 * baseDir 是文档所在目录，用于解析行内相对链接；块级渲染时透传给行内渲染。
 */
function hzDocsRenderMarkdown(markdown, baseDir) {
	var lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
	var html = [];
	var headings = [];
	var usedSlugs = Object.create(null);
	var title = "";
	var i = 0;
	var n = lines.length;

	var emitHeading = (level, text) => {
		var plain = hzDocsPlainText(text);
		var slug = hzDocsSlug(plain);
		if (usedSlugs[slug]) {
			usedSlugs[slug] += 1;
			slug = slug + "-" + usedSlugs[slug];
		} else {
			usedSlugs[slug] = 1;
		}
		if (!title && level === 1) title = plain;
		if (level >= 2 && level <= 3) headings.push({ level: level, text: plain, slug: slug });
		html.push('<h' + level + ' id="' + hzDocsEscapeHtml(slug) + '">' + hzDocsInline(text, baseDir) + "</h" + level + ">");
	};

	while (i < n) {
		var line = lines[i];

		// 围栏代码 ``` / ~~~
		var fence = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(line);
		if (fence) {
			var tick = fence[2].charAt(0);
			var closeRe = new RegExp("^\\s*" + (tick === "`" ? "`" : "~") + "{" + fence[2].length + ",}\\s*$");
			var lang = fence[3] || "";
			i++;
			var buf = [];
			while (i < n && !closeRe.test(lines[i])) {
				buf.push(lines[i]);
				i++;
			}
			i++; // 跳过收尾围栏
			html.push(
				'<pre class="code"><code' +
				(lang ? ' class="language-' + hzDocsEscapeHtml(lang.toLowerCase()) + '"' : "") +
				">" + hzDocsEscapeHtml(buf.join("\n")) + "</code></pre>"
			);
			continue;
		}

		if (/^\s*$/.test(line)) {
			i++;
			continue;
		}

		// 分隔线
		if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
			html.push("<hr>");
			i++;
			continue;
		}

		// ATX 标题
		var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (h) {
			emitHeading(h[1].length, h[2]);
			i++;
			continue;
		}

		// 白名单原样 HTML 块（<details> / <summary> / <a id="...">）
		if (/^\s*<\/?(?:details|summary)\b/i.test(line)) {
			html.push(hzDocsInline(line.trim(), baseDir));
			i++;
			continue;
		}
		if (/^\s*<a\s+id\s*=/i.test(line)) {
			var anchor = hzDocsAnchorLine(line);
			if (anchor) {
				html.push(anchor);
			} else {
				html.push(hzDocsInline(line.trim(), baseDir));
			}
			i++;
			continue;
		}

		// 表格
		if (line.indexOf("|") !== -1 && hzDocsIsTableDelim(lines[i + 1])) {
			i = hzDocsRenderTable(lines, i, html, baseDir);
			continue;
		}

		// 引用
		if (/^\s*>/.test(line)) {
			var quote = [];
			while (i < n && /^\s*>/.test(lines[i])) {
				quote.push(lines[i].replace(/^\s*>\s?/, ""));
				i++;
			}
			html.push("<blockquote>" + hzDocsRenderMarkdown(quote.join("\n"), baseDir).html + "</blockquote>");
			continue;
		}

		// 列表
		if (/^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/.test(line)) {
			i = hzDocsRenderList(lines, i, html, baseDir);
			continue;
		}

		// 段落
		var para = [];
		while (
			i < n &&
			!/^\s*$/.test(lines[i]) &&
			!/^(\s*)(`{3,}|~{3,})/.test(lines[i]) &&
			!/^(#{1,6})\s+/.test(lines[i]) &&
			!/^\s*>/.test(lines[i]) &&
			!/^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/.test(lines[i]) &&
			!/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
			!/^\s*<\/?(?:details|summary)\b/i.test(lines[i]) &&
			!/^\s*<a\s+id\s*=/i.test(lines[i]) &&
			!(lines[i].indexOf("|") !== -1 && hzDocsIsTableDelim(lines[i + 1]))
		) {
			para.push(lines[i]);
			i++;
		}
		if (!para.length) {
			// 兜底：避免任何情况下死循环
			para.push(lines[i]);
			i++;
		}
		var pieces = para.map((raw) => {
			var hard = /(?: {2,}|\\)$/.test(raw);
			return { text: raw.replace(/(?: {2,}|\\)$/, ""), hard: hard };
		});
		var out = "";
		for (var p = 0; p < pieces.length; p++) {
			if (p > 0) out += pieces[p - 1].hard ? "<br>" : hzDocsJoiner(pieces[p - 1].text, pieces[p].text);
			out += hzDocsInline(pieces[p].text, baseDir);
		}
		html.push("<p>" + out + "</p>");
	}

	return { html: html.join("\n"), title: title, headings: headings };
}

// ---------------------------------------------------------------------------
// 5. 文档元数据缓存 + 导航模型
// ---------------------------------------------------------------------------

/** docKey -> { title, html, headings, baseDir } */
var hzDocsDocCache = new Map();

/** 文档所在目录（相对语料根），用于解析同目录相对链接 */
function hzDocsBaseDirOf(key) {
	var idx = key.lastIndexOf("/");
	return idx === -1 ? "" : key.slice(0, idx + 1);
}

function hzDocsGetDoc(key) {
	if (hzDocsDocCache.has(key)) return hzDocsDocCache.get(key);
	var corpus = hzDocsDecodeCorpus();
	var rendered = hzDocsRenderMarkdown(corpus[key] === void 0 ? "" : corpus[key], hzDocsBaseDirOf(key));
	var title = rendered.title || key;
	var doc = {
		key: key,
		title: title,
		html: rendered.html,
		headings: rendered.headings,
		baseDir: hzDocsBaseDirOf(key)
	};
	hzDocsDocCache.set(key, doc);
	return doc;
}

/** 分组顺序与中文标签 */
var hzDocsGroupOrder = ["", "guide", "protocol", "webui", "advanced", "dev", "internals"];
var hzDocsGroupLabels = {
	"": "总览",
	guide: "使用指南",
	protocol: "协议",
	webui: "WebUI",
	advanced: "进阶",
	dev: "开发",
	internals: "逆向分析（内部）"
};

function hzDocsGroupOf(key) {
	var slash = key.indexOf("/");
	if (slash === -1) return "";
	var top = key.slice(0, slash);
	// hasOwnProperty: "constructor" / "toString" 之类的原型键必须落到默认分组
	return Object.prototype.hasOwnProperty.call(hzDocsGroupLabels, top) ? top : "";
}

/** 导航树：按组归类，组内按路径排序；语料固定，只算一次 */
var hzDocsNavCache = null;

function hzDocsNavGroups() {
	if (hzDocsNavCache) return hzDocsNavCache;
	var corpus = hzDocsDecodeCorpus();
	var buckets = new Map();
	for (var key of Object.keys(corpus).sort()) {
		var group = hzDocsGroupOf(key);
		if (!buckets.has(group)) buckets.set(group, []);
		buckets.get(group).push(key);
	}
	var groups = [];
	for (var g = 0; g < hzDocsGroupOrder.length; g++) {
		var name = hzDocsGroupOrder[g];
		var keys = buckets.get(name);
		if (!keys || !keys.length) continue;
		groups.push({
			name: name,
			label: hzDocsGroupLabels[name] || name,
			docs: keys.map((k) => ({ key: k, title: hzDocsGetDoc(k).title }))
		});
	}
	hzDocsNavCache = groups;
	return groups;
}

// ---------------------------------------------------------------------------
// 6. HTML 外壳（零 JS，只有内联 CSS —— 不触碰 CSP，也不依赖外部资源）
// ---------------------------------------------------------------------------

function hzDocsNavHtml(activeKey) {
	var groups = hzDocsNavGroups();
	var out = ['<nav class="side">'];
	for (var g = 0; g < groups.length; g++) {
		var group = groups[g];
		out.push('<div class="grp">');
		out.push('<div class="grp-h">' + hzDocsEscapeHtml(group.label) + "</div>");
		out.push("<ul>");
		for (var d = 0; d < group.docs.length; d++) {
			var doc = group.docs[d];
			out.push(
				'<li><a href="/docs/' + hzDocsEscapeHtml(encodeURI(doc.key)) + '"' +
				(doc.key === activeKey ? ' class="on"' : "") +
				">" + hzDocsEscapeHtml(doc.title) + "</a></li>"
			);
		}
		out.push("</ul></div>");
	}
	out.push("</nav>");
	return out.join("");
}

function hzDocsStyle() {
	return [
		":root{--bg:#f7f7f8;--fg:#1c1c1e;--muted:#6b7280;--line:#e3e4e8;--card:#fff;--code-bg:#f2f3f5;--accent:#2563eb}",
		"@media (prefers-color-scheme:dark){:root{--bg:#16171a;--fg:#e6e6e8;--muted:#9aa0a6;--line:#2c2e33;--card:#1d1f23;--code-bg:#232529;--accent:#7aa2f7}}",
		"*{box-sizing:border-box}",
		"body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.75 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans CJK SC','Microsoft YaHei',sans-serif}",
		".top{position:sticky;top:0;z-index:5;display:flex;gap:16px;align-items:center;padding:10px 20px;background:var(--card);border-bottom:1px solid var(--line)}",
		".brand{font-weight:700;color:var(--fg);text-decoration:none}",
		".top .meta{color:var(--muted);font-size:12.5px}",
		".top .sp{margin-left:auto}",
		".top a.raw{font-size:12.5px;color:var(--accent);text-decoration:none;border:1px solid var(--line);padding:3px 10px;border-radius:999px}",
		".wrap{display:flex;align-items:flex-start;max-width:1500px;margin:0 auto}",
		".side{position:sticky;top:49px;flex:0 0 268px;max-height:calc(100vh - 49px);overflow:auto;padding:16px 10px 40px;border-right:1px solid var(--line)}",
		".grp{margin-bottom:14px}",
		".grp-h{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:4px 10px}",
		".side ul{list-style:none;margin:0;padding:0}",
		".side a{display:block;padding:5px 10px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:13.5px;overflow-wrap:anywhere}",
		".side a:hover{background:var(--code-bg)}",
		".side a.on{background:var(--accent);color:#fff}",
		".doc{flex:1 1 auto;min-width:0;padding:28px 34px 90px}",
		".doc h1{font-size:28px;line-height:1.35;margin:.2em 0 .7em;padding-bottom:.35em;border-bottom:1px solid var(--line)}",
		".doc h2{font-size:21px;margin:1.9em 0 .6em;padding-top:.3em;border-top:1px solid var(--line)}",
		".doc h3{font-size:17px;margin:1.5em 0 .5em}",
		".doc h4,.doc h5,.doc h6{font-size:15px;margin:1.3em 0 .4em}",
		".doc p{margin:.7em 0}",
		".doc a{color:var(--accent)}",
		".doc code{background:var(--code-bg);padding:.15em .38em;border-radius:4px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}",
		".doc pre.code{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;margin:1em 0}",
		".doc pre.code code{background:none;padding:0;font-size:12.5px;line-height:1.6;white-space:pre}",
		".doc blockquote{margin:1em 0;padding:.35em 0 .35em 14px;border-left:3px solid var(--line);color:var(--muted)}",
		".doc blockquote p{margin:.35em 0}",
		".doc hr{border:0;border-top:1px solid var(--line);margin:1.8em 0}",
		".doc ul,.doc ol{margin:.6em 0;padding-left:1.6em}",
		".doc li{margin:.25em 0}",
		".tw{overflow-x:auto;margin:1em 0}",
		".doc table{border-collapse:collapse;font-size:13.5px;min-width:100%}",
		".doc th,.doc td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}",
		".doc th{background:var(--code-bg);font-weight:600;white-space:nowrap}",
		".doc img{max-width:100%}",
		".doc details{margin:.8em 0;border:1px solid var(--line);border-radius:8px;padding:8px 12px;background:var(--card)}",
		".doc summary{cursor:pointer;color:var(--muted);font-size:13px}",
		".toc{margin:1.2em 0 2em}",
		".toc ol{margin:.5em 0 0;padding-left:1.4em;font-size:13.5px}",
		".hero{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:22px}",
		".hero h2{margin:0 0 6px;font-size:17px;border:0;padding:0}",
		".hero p{margin:.3em 0;color:var(--muted);font-size:13.5px}",
		".cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}",
		".card{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;text-decoration:none;color:var(--fg)}",
		".card:hover{border-color:var(--accent)}",
		".card b{display:block;font-size:14.5px;margin-bottom:4px}",
		".card span{color:var(--muted);font-size:12.5px}",
		".err{max-width:760px;margin:60px auto;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:24px 28px}",
		".err h1{margin-top:0;font-size:20px}",
		".err code{background:var(--code-bg);padding:.15em .4em;border-radius:4px}",
		"@media (max-width:900px){.wrap{display:block}.side{position:static;flex:none;max-height:none;border-right:0;border-bottom:1px solid var(--line)}.doc{padding:20px 16px 60px}}",
		""
	].join("\n");
}

function hzDocsShell(opts) {
	var title = opts.title ? opts.title + " · Haizakura 文档" : "Haizakura 文档";
	return (
		"<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n" +
		'<meta charset="utf-8">\n' +
		'<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
		'<meta name="robots" content="noindex,nofollow">\n' +
		"<title>" + hzDocsEscapeHtml(title) + "</title>\n" +
		"<style>\n" + hzDocsStyle() + "</style>\n" +
		"</head>\n<body>\n" +
		'<header class="top">\n' +
		'<a class="brand" href="/docs">Haizakura 文档</a>\n' +
		'<span class="meta">' + hzDocsEscapeHtml(opts.crumb || "内置离线文档") + "</span>\n" +
		(opts.raw ? '<span class="sp"></span><a class="raw" href="' + hzDocsEscapeHtml(opts.raw) + '">查看原始 Markdown</a>' : "") +
		"\n</header>\n" +
		'<div class="wrap">\n' + (opts.nav === false ? "" : hzDocsNavHtml(opts.activeKey)) + "\n" +
		'<main class="doc">\n' + opts.content + "\n</main>\n</div>\n" +
		"</body>\n</html>\n"
	);
}

// ---------------------------------------------------------------------------
// 7. 页面生成
// ---------------------------------------------------------------------------

function hzDocsIndexPage() {
	var groups = hzDocsNavGroups();
	var total = 0;
	for (var g = 0; g < groups.length; g++) total += groups[g].docs.length;
	var out = [];
	out.push(
		'<div class="hero"><h2>Haizakura 内置文档</h2>' +
		"<p>本页由 WebUI 直接提供，<strong>不依赖外网</strong>；文档随构建一起打进运行时，" +
		"断网也能查。</p>" +
		"<p>共 " + total + " 篇 · " + (hzDocsAuthRequired() ? "已启用访问口令" : "本实例未启用访问口令") + "</p></div>"
	);
	for (var i = 0; i < groups.length; i++) {
		var group = groups[i];
		out.push("<h2>" + hzDocsEscapeHtml(group.label) + "</h2>");
		out.push('<div class="cards">');
		for (var d = 0; d < group.docs.length; d++) {
			var doc = group.docs[d];
			var meta = hzDocsDecodeCorpus()[doc.key] || "";
			var lines = meta.split("\n").length;
			out.push(
				'<a class="card" href="/docs/' + hzDocsEscapeHtml(encodeURI(doc.key)) + '">' +
				"<b>" + hzDocsEscapeHtml(doc.title) + "</b>" +
				"<span>" + hzDocsEscapeHtml(doc.key) + " · " + lines + " 行</span></a>"
			);
		}
		out.push("</div>");
	}
	return hzDocsShell({ title: "文档索引", crumb: "索引", content: out.join("\n") });
}

function hzDocsDocPage(key) {
	var doc = hzDocsGetDoc(key);
	var content = "";
	if (doc.headings.length > 1) {
		var toc = ['<details class="toc"><summary>本页目录（' + doc.headings.length + " 节）</summary><ol>"];
		for (var h = 0; h < doc.headings.length; h++) {
			var item = doc.headings[h];
			toc.push(
				'<li><a href="#' + hzDocsEscapeHtml(item.slug) + '">' +
				hzDocsEscapeHtml(item.text) + "</a></li>"
			);
		}
		toc.push("</ol></details>");
		content += toc.join("\n") + "\n";
	}
	content += doc.html;
	return hzDocsShell({
		title: doc.title,
		crumb: key,
		activeKey: key,
		raw: "/docs/raw/" + encodeURI(key),
		content: content
	});
}

function hzDocsErrorPage(status, heading, detail) {
	return hzDocsShell({
		title: heading,
		crumb: "错误 " + status,
		content:
			'<div class="err"><h1>' + hzDocsEscapeHtml(heading) + "</h1>" +
			"<p>" + hzDocsEscapeHtml(detail) + "</p>" +
			'<p><a href="/docs">返回文档索引</a></p></div>'
	});
}

function hzDocsDirPage(key, docs) {
	var out = ['<h1>' + hzDocsEscapeHtml(key + "/") + "</h1>", '<div class="cards">'];
	for (var i = 0; i < docs.length; i++) {
		out.push(
			'<a class="card" href="/docs/' + hzDocsEscapeHtml(encodeURI(docs[i])) + '">' +
			"<b>" + hzDocsEscapeHtml(hzDocsGetDoc(docs[i]).title) + "</b>" +
			"<span>" + hzDocsEscapeHtml(docs[i]) + "</span></a>"
		);
	}
	out.push("</div>");
	return hzDocsShell({ title: key, crumb: key + "/", content: out.join("\n") });
}

// ---------------------------------------------------------------------------
// 8. 鉴权（默认开启；设 SNOWLUMA_DOCS_REQUIRE_AUTH=0 关闭）
// ---------------------------------------------------------------------------

function hzDocsAuthRequired() {
	var raw = process.env.SNOWLUMA_DOCS_REQUIRE_AUTH;
	if (typeof raw !== "string" || !raw.trim()) return true;
	var v = raw.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

function hzDocsTokenValid(token) {
	if (!token || typeof token !== "string") return false;
	if (typeof sessionTokens === "undefined" || !sessionTokens) return false;
	var info = sessionTokens.get(token);
	return Boolean(info) && Date.now() <= info.expiresAt;
}

function hzDocsRequestIsSecure(c) {
	try {
		return new URL(c.req.url).protocol === "https:";
	} catch {
		return false;
	}
}

function hzDocsUnauthorized(c) {
	var body = hzDocsShell({
		title: "需要登录",
		crumb: "401",
		nav: false,
		content:
			'<div class="err"><h1>需要登录后才能查看文档</h1>' +
			"<p>本实例通过 <code>SNOWLUMA_DOCS_REQUIRE_AUTH=1</code> 打开了文档鉴权。" +
			"正常情况下从 WebUI 侧栏点「文档」即可直接进入 —— 页面会自动读取同源的 WebUI 登录令牌。</p>" +
			"<p>若你是在无痕窗口或别的浏览器里直接打开本页，请改用带令牌的地址：</p>" +
			"<p><code>/docs?token=&lt;WebUI 会话令牌&gt;</code></p>" +
			'<p><button type="button" id="hz-docs-retry" ' +
			'style="cursor:pointer;padding:6px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)">' +
			"我已登录 WebUI，重试</button></p>" +
			"<p>成功后会写入一个仅限 <code>/docs</code> 路径的 HttpOnly Cookie，后续页面不再需要带令牌。</p></div>" +
			// 同源读取 WebUI 的 localStorage 令牌并跳转（内联脚本受 CSP 允许，见 request-security.ts）
			// 防循环：① URL 上已带 token 就绝不再跳；② 用 sessionStorage 记录已尝试，避免
			// localStorage 里是失效令牌时 401 -> 跳转 -> 401 无限打转。
			"<script>\n(function(){\n" +
			"  var K = 'hz_docs_token_bridge';\n" +
			"  function alreadyTried(){\n" +
			"    try{ return sessionStorage.getItem(K) === '1'; }catch(e){ return true; }\n" +
			"  }\n" +
			"  function markTried(){ try{ sessionStorage.setItem(K,'1'); }catch(e){} }\n" +
			"  function go(){\n" +
			"    if(/[?&]token=/.test(location.search)) return false;\n" +
			"    if(alreadyTried()) return false;\n" +
			"    try{\n" +
			"      var t = localStorage.getItem('snowluma_token');\n" +
			"      if(!t) return false;\n" +
			"      markTried();\n" +
			"      location.replace('/docs?token=' + encodeURIComponent(t));\n" +
			"      return true;\n" +
			"    }catch(e){ return false; }\n" +
			"  }\n" +
			"  go();\n" +
			"  var b = document.getElementById('hz-docs-retry');\n" +
			"  if(b) b.addEventListener('click', function(){\n" +
			"    try{ sessionStorage.removeItem(K); }catch(e){}\n" +
			"    if(!go()) alert('未在本机找到可用的 WebUI 登录令牌，请先在 WebUI 中登录。');\n" +
			"  });\n" +
			"})();\n</script>"
	});
	c.header("WWW-Authenticate", 'Bearer realm="haizakura-docs"');
	return c.html(body, 401, hzDocsNoStore);
}

/**
 * 鉴权闸门：返回 null 表示放行，否则返回一个 Response。
 * 接受三种凭证：x-snowluma-token 头 / Authorization: Bearer / ?token=
 * 用 ?token= 访问时会写 cookie 并 302 到不带令牌的干净地址。
 */
function hzDocsGate(c) {
	if (!hzDocsAuthRequired()) return null;
	var header = "";
	try {
		header = extractWebuiSessionToken(c.req.raw) || "";
	} catch {
		header = "";
	}
	if (hzDocsTokenValid(header)) return null;
	var cookie = "";
	try {
		cookie = getCookie(c, HZ_DOCS_COOKIE) || "";
	} catch {
		cookie = "";
	}
	if (hzDocsTokenValid(cookie)) return null;
	var query = c.req.query("token") || "";
	if (hzDocsTokenValid(query)) {
		setCookie(c, HZ_DOCS_COOKIE, query, {
			path: HZ_DOCS_BASE,
			httpOnly: true,
			sameSite: "Strict",
			secure: hzDocsRequestIsSecure(c),
			maxAge: 12 * 60 * 60
		});
		return c.redirect(c.req.path, 302);
	}
	return hzDocsUnauthorized(c);
}

// ---------------------------------------------------------------------------
// 9. 路由处理器
// ---------------------------------------------------------------------------

function hzDocsHandleIndex(c) {
	try {
		var gate = hzDocsGate(c);
		if (gate) return gate;
		return c.html(hzDocsIndexPage(), 200, hzDocsNoStore);
	} catch (error) {
		hzDocsLog.error("GET /docs failed: %s", error instanceof Error ? error.stack || error.message : String(error));
		return c.html(hzDocsErrorPage(500, "文档索引渲染失败", "请查看服务器日志。"), 500, hzDocsNoStore);
	}
}

function hzDocsHandleDoc(c) {
	try {
		var gate = hzDocsGate(c);
		if (gate) return gate;

		var rest = c.req.path.slice(HZ_DOCS_BASE.length);
		if (rest.charAt(0) === "/") rest = rest.slice(1);

		var corpus = hzDocsDecodeCorpus();
		if (!Object.keys(corpus).length) {
			return c.html(
				hzDocsErrorPage(500, "文档语料为空", "内嵌语料解码失败或被裁剪，请查看服务器日志。"),
				500,
				hzDocsNoStore
			);
		}

		// /docs/raw/<path> -> 原始 Markdown
		if (rest === "raw" || rest.indexOf("raw/") === 0) {
			var rawKey = rest.slice(3);
			if (rawKey.charAt(0) === "/") rawKey = rawKey.slice(1);
			if (!rawKey) {
				return c.html(hzDocsErrorPage(400, "缺少文档路径", "用法：/docs/raw/<文档路径>.md"), 400, hzDocsNoStore);
			}
			var rawResolved = hzDocsResolvePath(rawKey);
			if (rawResolved.kind === "traversal" || rawResolved.kind === "hidden" || rawResolved.kind === "invalid") {
				hzDocsLog.warn("rejected /docs/raw path %s (%s)", rawKey, rawResolved.kind);
				return c.html(hzDocsErrorPage(400, "非法路径", "路径包含不允许的片段。"), 400, hzDocsNoStore);
			}
			if (rawResolved.kind !== "doc") {
				return c.html(hzDocsErrorPage(404, "文档不存在", "没有找到 " + rawKey), 404, hzDocsNoStore);
			}
			var markdown = corpus[rawResolved.key];
			return c.text(markdown === void 0 ? "" : markdown, 200, {
				"Content-Type": "text/markdown; charset=utf-8",
				"Cache-Control": "no-store"
			});
		}

		var resolved = hzDocsResolvePath(rest);
		switch (resolved.kind) {
			case "index":
				return c.html(hzDocsIndexPage(), 200, hzDocsNoStore);
			case "doc":
				return c.html(hzDocsDocPage(resolved.key), 200, hzDocsNoStore);
			case "dir":
				return c.html(hzDocsDirPage(resolved.key, resolved.docs), 200, hzDocsNoStore);
			case "traversal":
			case "hidden":
			case "invalid":
				hzDocsLog.warn("rejected /docs path %s (%s)", rest, resolved.kind);
				return c.html(
					hzDocsErrorPage(400, "非法路径", "路径中包含 .. / 反斜杠 / 隐藏段，已拒绝。"),
					400,
					hzDocsNoStore
				);
			default:
				return c.html(
					hzDocsErrorPage(404, "文档不存在", "没有找到 " + (resolved.key || rest) + "，请从索引页进入。"),
					404,
					hzDocsNoStore
				);
		}
	} catch (error) {
		hzDocsLog.error("GET %s failed: %s", c.req.path, error instanceof Error ? error.stack || error.message : String(error));
		return c.html(hzDocsErrorPage(500, "文档渲染失败", "请查看服务器日志。"), 500, hzDocsNoStore);
	}
}

// ---------------------------------------------------------------------------
// 10. 挂载：把自己的路由插进同一个 Hono app
// ---------------------------------------------------------------------------

/** 幂等标记（同一 app 重复注册会是重复路由） */
var HZ_DOCS_ROUTE_FLAG = "__hzDocsRoutes";

function hzDocsRegisterRoutes(app) {
	if (!app || typeof app.get !== "function") {
		hzDocsLog.warn("registerDocsRoutes skipped: no Hono app instance");
		return false;
	}
	if (app[HZ_DOCS_ROUTE_FLAG]) return true;
	app[HZ_DOCS_ROUTE_FLAG] = true;
	app.get(HZ_DOCS_BASE, hzDocsHandleIndex);
	app.get(HZ_DOCS_BASE + "/", hzDocsHandleIndex);
	app.get(HZ_DOCS_BASE + "/*", hzDocsHandleDoc);
	app.get("/api/docs/nav", hzDocsJsonNav);
	app.get("/api/docs/doc", hzDocsJsonDoc);
	return true;
}

// 保存原始实现（函数声明可重新赋值；注意不能用 var 重新声明同名变量，
// 那会被构建工具的顶层重名检查拦下）。
/**
 * JSON API for the in-SPA documentation viewer.
 *
 * The SPA cannot use the server-rendered /docs pages, so these endpoints expose
 * the same corpus as data. Both live under /api/docs/* and reuse hzDocsGate, so
 * they obey the same auth policy as the HTML pages.
 */
function hzDocsJsonNav(c) {
	var gate = hzDocsGate(c);
	if (gate) return gate;
	var groups = hzDocsNavGroups();
	var payload = [];
	for (var i = 0; i < groups.length; i++) {
		var group = groups[i];
		var docs = [];
		for (var d = 0; d < group.docs.length; d++) {
			docs.push({ key: group.docs[d].key, title: group.docs[d].title });
		}
		payload.push({ label: group.label, docs: docs });
	}
	return c.json({ groups: payload }, 200, hzDocsNoStore);
}

function hzDocsJsonDoc(c) {
	var gate = hzDocsGate(c);
	if (gate) return gate;
	var key = c.req.query("key") || "";
	var corpus = hzDocsDecodeCorpus();
	if (corpus[key] === void 0) return c.json({ error: "not found" }, 404, hzDocsNoStore);
	var doc = hzDocsGetDoc(key);
	return c.json({ key: doc.key, title: doc.title, html: doc.html, headings: doc.headings }, 200, hzDocsNoStore);
}

var hzDocsOrigRegisterStaticFrontend = registerStaticFrontend;

/**
 * ⚠️ 必须先注册 /docs，再调用原函数。
 * registerStaticFrontend 末尾注册了 app.get("*")，Hono 按注册顺序匹配，
 * 先注册的 "*" 会把后注册的 /docs 全部吃掉（实测确认）。
 */
registerStaticFrontend = function hzDocsPatchedRegisterStaticFrontend(app, root, target) {
	try {
		hzDocsRegisterRoutes(app);
	} catch (error) {
		hzDocsLog.warn(
			"documentation routes failed to mount: %s",
			error instanceof Error ? error.message : String(error)
		);
	}
	return hzDocsOrigRegisterStaticFrontend(app, root, target);
};

try {
	var hzDocsCorpusSize = Object.keys(hzDocsDecodeCorpus()).length;
	hzDocsLog.info(
		"offline documentation mounted at %s (%d file(s), embedded gzip corpus, auth=%s)",
		HZ_DOCS_BASE,
		hzDocsCorpusSize,
		hzDocsAuthRequired() ? "on" : "off"
	);
} catch (error) {
	hzDocsLog.warn("documentation corpus check failed: %s", error instanceof Error ? error.message : String(error));
}

export {};
