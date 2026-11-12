// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/bridge-oidb.ts"
// original bundle lines 18807-18828  (20 lines) of dist/index.mjs
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
* Build the OidbBase<T>-shaped TS value. Pure helper, no protobuf
* encoding happens here — pair with `encodeOidbEnv<T>` to produce the
* wire bytes.
*
* The `isUid` flag sets the envelope `reserved` field to 1; despite the
* name (kept for back-compat with the legacy API), `reserved = 1`
* empirically signals the UIN-form variant of an OIDB call. Omit
* (default false) for genuinely UID-keyed calls.
*/
function makeOidbEnvelope(oidbCmd, subCmd, body, isUid = false) {
	return {
		command: oidbCmd,
		subCommand: subCmd,
		errorCode: 0,
		body,
		errorMsg: "",
		reserved: isUid ? 1 : 0
	};
}
export {};
