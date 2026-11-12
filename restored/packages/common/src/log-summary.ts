// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/log-summary.ts"
// original bundle lines 1175-1389  (213 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function isSensitiveKey(key) {
	const segments = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_.\s]+/).filter(Boolean).map((segment) => segment.toLowerCase());
	return segments.some((segment, index) => {
		if (SENSITIVE_SEGMENTS.has(segment)) return true;
		return segments[index + 1] === "key" && (segment === "api" || segment === "private" || segment === "session");
	});
}
function valueRepr(v, key) {
	if (key !== void 0 && isSensitiveKey(key)) return "\"***\"";
	if (v === null) return "null";
	if (v === void 0) return "undefined";
	switch (typeof v) {
		case "string": return v.length > MAX_FIELD ? `"${v.slice(0, MAX_FIELD)}..."` : `"${v}"`;
		case "number":
		case "boolean":
		case "bigint": return String(v);
		case "object":
			if (Array.isArray(v)) return `[len=${v.length}]`;
			return "{...}";
		default: return typeof v;
	}
}
/**
* Render a params object as a single line for logging. Skips deep
* traversal: nested objects collapse to `{...}`, arrays to `[len=N]`.
* Strings are quoted; long ones are truncated with an ellipsis.
*
* Output is capped at MAX_TOTAL chars; on overflow the tail is
* replaced with `...` so the next field doesn't get half-rendered.
*/
function summarizeParams(params) {
	if (params === null || params === void 0) return "{}";
	if (typeof params !== "object") {
		const s = String(params);
		return s.length > MAX_TOTAL ? `${s.slice(0, MAX_TOTAL - 3)}...` : s;
	}
	if (Array.isArray(params)) return `[len=${params.length}]`;
	const out = [];
	let total = 0;
	for (const [k, v] of Object.entries(params)) {
		const entry = `${k}=${valueRepr(v, k)}`;
		const separatorLength = out.length > 0 ? 1 : 0;
		if (total + separatorLength + entry.length > MAX_TOTAL) {
			if (out.length === 0) return `${entry.slice(0, MAX_TOTAL - 3)}...`;
			const rendered = out.join(" ");
			return rendered.length + 4 <= MAX_TOTAL ? `${rendered} ...` : `${rendered.slice(0, MAX_TOTAL - 3)}...`;
		}
		out.push(entry);
		total += separatorLength + entry.length;
	}
	return out.join(" ");
}
function keySegments(key) {
	return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_.\s]+/).filter(Boolean).map((segment) => segment.toLowerCase());
}
function isKeyKind(key, kind) {
	return keySegments(key).includes(kind);
}
function isAuthorizationBoundaryKey(key) {
	const segments = keySegments(key);
	return segments.some((segment, index) => {
		if (AUTHORIZATION_BOUNDARY_SEGMENTS.has(segment)) return true;
		return segments[index + 1] === "key" && (segment === "api" || segment === "private" || segment === "session");
	});
}
function quotedValueEnd(message, start) {
	const quote = message[start];
	if (quote !== "\"" && quote !== "'") return;
	for (let index = start + 1; index < message.length; index += 1) if (message[index] === "\\") index += 1;
	else if (message[index] === quote) return index + 1;
	return message.length;
}
function cookieValueEnd(message, start) {
	const initialQuotedEnd = quotedValueEnd(message, start);
	let end;
	if (initialQuotedEnd !== void 0) end = initialQuotedEnd;
	else {
		end = start;
		while (end < message.length && !/[;\s,}\]&\r\n]/.test(message[end])) end += 1;
	}
	while (end < message.length) {
		let semicolon = end;
		while (message[semicolon] === " " || message[semicolon] === "	") semicolon += 1;
		if (message[semicolon] !== ";") break;
		let nameStart = semicolon + 1;
		while (message[nameStart] === " " || message[nameStart] === "	") nameStart += 1;
		let nameEnd = nameStart;
		while (/[A-Za-z0-9_-]/.test(message[nameEnd] ?? "")) nameEnd += 1;
		if (nameEnd === nameStart) break;
		end = nameEnd;
		if (message[end] !== "=") continue;
		const attribute = message.slice(nameStart, nameEnd).toLowerCase();
		const valueStart = end + 1;
		const quotedEnd = quotedValueEnd(message, valueStart);
		if (quotedEnd !== void 0) {
			end = quotedEnd;
			continue;
		}
		if (attribute !== "expires") {
			end = valueStart;
			while (end < message.length && !/[;\s,}\]&\r\n]/.test(message[end])) end += 1;
			continue;
		}
		end = valueStart;
		while (end < message.length && !/[;}\]&\r\n]/.test(message[end])) end += 1;
		const assignments = new RegExp(ASSIGNMENT_START.source, "gi");
		assignments.lastIndex = valueStart;
		const nextField = assignments.exec(message);
		if (nextField && nextField.index < end) end = nextField.index;
	}
	return end;
}
function genericValueEnd(message, start) {
	const quotedEnd = quotedValueEnd(message, start);
	if (quotedEnd !== void 0) return quotedEnd;
	let end = start;
	while (end < message.length && !/[\s,}\]&\r\n]/.test(message[end])) end += 1;
	return end;
}
function authorizationValueEnd(message, start, query) {
	const quotedEnd = quotedValueEnd(message, start);
	if (quotedEnd !== void 0) return quotedEnd;
	if (query) {
		const queryEnd = message.indexOf("&", start);
		return queryEnd >= 0 ? queryEnd : message.length;
	}
	let end = message.length;
	const structural = message.slice(start).search(/[\r\n}\]]/);
	if (structural >= 0) end = start + structural;
	const assignments = new RegExp(ASSIGNMENT_START.source, "gi");
	const remaining = message.slice(start, end);
	for (let match = assignments.exec(remaining); match; match = assignments.exec(remaining)) if (isAuthorizationBoundaryKey(match[3])) {
		end = start + match.index;
		break;
	}
	return end;
}
/** Redact explicit authentication assignments in ordinary formatted logs. */
function redactLogMessage(message) {
	let out = "";
	let cursor = 0;
	ASSIGNMENT_START.lastIndex = 0;
	for (let match = ASSIGNMENT_START.exec(message); match; match = ASSIGNMENT_START.exec(message)) {
		const key = match[3];
		if (!isSensitiveKey(key)) {
			ASSIGNMENT_START.lastIndex = Math.max(match.index + 1, ASSIGNMENT_START.lastIndex - 1);
			continue;
		}
		const valueStart = ASSIGNMENT_START.lastIndex;
		const valueEnd = isKeyKind(key, "authorization") ? authorizationValueEnd(message, valueStart, match[1] === "?" || match[1] === "&") : isKeyKind(key, "cookie") ? cookieValueEnd(message, valueStart) : genericValueEnd(message, valueStart);
		out += message.slice(cursor, valueStart) + "***";
		cursor = valueEnd;
		ASSIGNMENT_START.lastIndex = valueEnd;
	}
	return out + message.slice(cursor);
}
/**
* Lossless nested renderer for explicit TRACE diagnostics. TRACE is an
* operator-enabled, memory-only mode and intentionally leaves values
* unredacted so a reproduction contains the complete business input.
*/
function renderParamsVerbose(params) {
	const seen = /* @__PURE__ */ new WeakSet();
	const walk = (value) => {
		if (value === null) return "null";
		if (value === void 0) return "undefined";
		switch (typeof value) {
			case "string": return JSON.stringify(value);
			case "number":
			case "boolean":
			case "bigint": return String(value);
			case "object": {
				if (seen.has(value)) return "\"[circular]\"";
				seen.add(value);
				const out = Array.isArray(value) ? `[${value.map((item) => walk(item)).join(",")}]` : `{${Object.entries(value).map(([key, item]) => `${key}:${walk(item)}`).join(",")}}`;
				seen.delete(value);
				return out;
			}
			default: return typeof value;
		}
	};
	return walk(params);
}
var MAX_FIELD, MAX_TOTAL, SENSITIVE_SEGMENTS, ASSIGNMENT_START, AUTHORIZATION_BOUNDARY_SEGMENTS;
var init_log_summary = __esmMin((() => {
	MAX_FIELD = 40;
	MAX_TOTAL = 200;
	SENSITIVE_SEGMENTS = /* @__PURE__ */ new Set([
		"authorization",
		"cookie",
		"credential",
		"credentials",
		"password",
		"passwd",
		"secret",
		"token",
		"apikey",
		"privatekey",
		"sessionkey"
	]);
	ASSIGNMENT_START = /(^|[^A-Za-z0-9_-])(["']?)([-_]*(?=[A-Za-z0-9_.-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_.-]*)\2(\s*[:=]\s*)/gi;
	AUTHORIZATION_BOUNDARY_SEGMENTS = /* @__PURE__ */ new Set([
		"authorization",
		"cookie",
		"password",
		"passwd",
		"secret",
		"token",
		"apikey",
		"privatekey",
		"sessionkey"
	]);
}));
export {};
