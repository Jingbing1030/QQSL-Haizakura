// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/self-uid.ts"
// original bundle lines 82500-82524  (23 lines) of dist/index.mjs
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
* Resolve the bot's own UID — the single source of truth for "what is my uid".
*
* Fast path: once warmup populates `selfProfile`, `identity.selfUid` is set and
* returns immediately. Before that, resolve via `resolveUserUid(selfUin)`.
* Throws when there is no self identity at all (uin missing / <= 0).
*
* Callers that put the uid on an outbound packet must route here rather than
* fall back to an empty string: an empty uid ships a broken packet. This used
* to be re-inlined in ContactsApi shared helpers, group-file, message, and
* get-like — the copies had drifted into three error messages and two silent
* `?? ''` empty-uid bugs before being converged here.
*
* Takes just the `BridgeContext` slice it needs, so both a full `Bridge` and a
* bare context (e.g. an OIDB service's Deps) satisfy it.
*/
async function resolveSelfUid(ctx) {
	const cached = ctx.identity.selfUid;
	if (cached) return cached;
	const selfUin = Number(ctx.identity.uin);
	if (!Number.isFinite(selfUin) || selfUin <= 0) throw new Error("self uid is unavailable");
	return ctx.resolveUserUid(selfUin);
}
export {};
