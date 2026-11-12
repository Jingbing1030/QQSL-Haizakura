// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/packet-timeout.ts"
// original bundle lines 1682-1689  (6 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_env();
/** Default wait for a QQ reply when the caller does not pass one. */
var DEFAULT_PACKET_TIMEOUT_MS = 15e3;
function packetTimeoutMs(env) {
	return positiveIntEnv("SNOWLUMA_PACKET_TIMEOUT_MS", DEFAULT_PACKET_TIMEOUT_MS, { env });
}
export {};
