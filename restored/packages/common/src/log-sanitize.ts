// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/log-sanitize.ts"
// original bundle lines 93-173  (79 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function skipCsi(line, start) {
	for (let i = start; i < line.length; i += 1) {
		const code = line.charCodeAt(i);
		if (code >= 64 && code <= 126) return i + 1;
	}
	return line.length;
}
function skipControlString(line, start, allowBell) {
	for (let i = start; i < line.length; i += 1) {
		const code = line.charCodeAt(i);
		if (allowBell && code === BEL) return i + 1;
		if (code === C1_ST) return i + 1;
		if (code === ESC && line.charCodeAt(i + 1) === 92) return i + 2;
	}
	return line.length;
}
function skipEscSequence(line, start) {
	if (start >= line.length) return line.length;
	const first = line.charCodeAt(start);
	if (first === 91) return skipCsi(line, start + 1);
	if (first === 93) return skipControlString(line, start + 1, true);
	if (first === 80 || first === 88 || first === 94 || first === 95) return skipControlString(line, start + 1, false);
	let i = start;
	while (i < line.length) {
		const code = line.charCodeAt(i);
		if (code < 32 || code > 47) break;
		i += 1;
	}
	const final = line.charCodeAt(i);
	return final >= 48 && final <= 126 ? i + 1 : start;
}
/**
* Remove terminal presentation and control sequences from a log line.
*
* The parser handles both seven-bit ESC forms and eight-bit C1 forms,
* including CSI styling, OSC hyperlinks, and DCS/SOS/PM/APC control strings.
* TAB and LF remain available for formatted records such as stack traces.
* Unterminated terminal strings consume the remainder instead of leaking their
* invisible payload into persisted or downloaded logs.
*/
function sanitizeLogLine(line) {
	let plain = "";
	for (let i = 0; i < line.length;) {
		const code = line.charCodeAt(i);
		if (code === ESC) {
			i = skipEscSequence(line, i + 1);
			continue;
		}
		if (code === C1_CSI) {
			i = skipCsi(line, i + 1);
			continue;
		}
		if (code === C1_OSC || C1_STRING_STARTERS.has(code)) {
			i = skipControlString(line, i + 1, code === C1_OSC);
			continue;
		}
		if (code < 32 && code !== 9 && code !== 10 || code >= 127 && code <= 159) {
			i += 1;
			continue;
		}
		plain += line[i];
		i += 1;
	}
	return plain;
}
var ESC, BEL, C1_CSI, C1_ST, C1_OSC, C1_STRING_STARTERS;
var init_log_sanitize = __esmMin((() => {
	ESC = 27;
	BEL = 7;
	C1_CSI = 155;
	C1_ST = 156;
	C1_OSC = 157;
	C1_STRING_STARTERS = /* @__PURE__ */ new Set([
		144,
		152,
		158,
		159
	]);
}));
export {};
