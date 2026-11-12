// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/upload-settings.ts"
// original bundle lines 5110-5123  (12 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Deployment-wide policy. Each video snapshots it before preparing its bytes. */
var videoUploadConcurrency = 1;
function validateUploadConcurrency(value) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 4) throw new RangeError("videoUploadConcurrency must be an integer from 1 to 4");
	return value;
}
function setVideoUploadConcurrency(value) {
	videoUploadConcurrency = validateUploadConcurrency(value);
}
function getVideoUploadConcurrency() {
	return videoUploadConcurrency;
}
export {};
