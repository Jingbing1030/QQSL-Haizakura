// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/download-settings.ts"
// original bundle lines 17924-17967  (42 lines) of dist/index.mjs
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
* Timeout for one HTTP media download attempt.
*
* Deployment-wide rather than per-adapter because every caller reaches this
* through the same download engine (`loadBinarySource` / `stageSourceToDisk`),
* and it is configured the same way as the other transport timeouts
* (`SNOWLUMA_PACKET_TIMEOUT_MS`, `SNOWLUMA_HOOK_ACK_TIMEOUT_MS`) instead of
* growing the per-account OneBot config surface.
*
* The 60 s default is generous for images but tight for a large media file over
* a slow link, where the abort is reported as a generic fetch failure.
*
* Not to be confused with `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS`, which bounds the
* `download_file` OneBot action's own staging.
*/
function httpDownloadTimeoutMs(env = process.env) {
	return positiveIntEnv("SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS", DEFAULT_HTTP_DOWNLOAD_TIMEOUT_MS, {
		env,
		max: MAX_TIMER_MS
	});
}
/**
* Cap on one binary source loaded fully into memory.
*
* Applies to the helpers whose size bound is implicit (image, voice, avatar,
* custom face, group-notice image). Callers that pass their own ceiling — group
* files, flash transfer, video — keep it, so raising this never lifts those.
*/
function maxBinaryDownloadBytes(env = process.env) {
	return positiveIntEnv("SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES", DEFAULT_MAX_BINARY_DOWNLOAD_BYTES, {
		env,
		max: MAX_BINARY_DOWNLOAD_BYTES
	});
}
var DEFAULT_HTTP_DOWNLOAD_TIMEOUT_MS, DEFAULT_MAX_BINARY_DOWNLOAD_BYTES, MAX_TIMER_MS, MAX_BINARY_DOWNLOAD_BYTES;
var init_download_settings = __esmMin((() => {
	init_env();
	DEFAULT_HTTP_DOWNLOAD_TIMEOUT_MS = 6e4;
	DEFAULT_MAX_BINARY_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
	MAX_TIMER_MS = 2147483647;
	MAX_BINARY_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;
}));
export {};
