// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/hex.ts"
// original bundle lines 10978-10996  (17 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function toHex(data) {
	return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("hex");
}
function toHexUpper(data) {
	return toHex(data).toUpperCase();
}
function hexPreview(data, maxBytes = 64) {
	const limit = Math.max(0, Math.min(maxBytes, data.length));
	const head = toHex(data.subarray(0, limit));
	return data.length > limit ? `${head}...` : head;
}
function fromHex(hex) {
	if (hex.length % 2 !== 0) throw new Error("Invalid hex string length");
	const buf = Buffer.alloc(hex.length / 2);
	for (let i = 0; i < buf.length; i++) buf[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
	return buf;
}
export {};
