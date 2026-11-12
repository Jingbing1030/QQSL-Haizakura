// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/envelope.ts"
// original bundle lines 23018-23049  (30 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** notice envelope — `{ time, self_id, post_type: 'notice', ...fields }`. */
function notice(ctx, event, fields) {
	return {
		time: event.time,
		self_id: ctx.selfId,
		post_type: "notice",
		...fields
	};
}
/** request envelope — `{ time, self_id, post_type: 'request', ...fields }`. */
function request$1(ctx, event, fields) {
	return {
		time: event.time,
		self_id: ctx.selfId,
		post_type: "request",
		...fields
	};
}
/**
* message envelope — `{ time, self_id, post_type, ...fields }`. `postType` is
* 'message' or 'message_sent' (self-echo), decided per-message by the caller.
*/
function message(ctx, event, postType, fields) {
	return {
		time: event.time,
		self_id: ctx.selfId,
		post_type: postType,
		...fields
	};
}
export {};
