// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/to-request.ts"
// original bundle lines 23321-23342  (20 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function convertFriendRequest(ctx, event) {
	return request$1(ctx, event, {
		request_type: "friend",
		user_id: event.fromUin,
		comment: event.message,
		flag: event.flag
	});
}
function convertGroupInvite(ctx, event) {
	const invitedId = event.invitedUin ?? 0;
	return request$1(ctx, event, {
		request_type: "group",
		sub_type: event.subType || "invite",
		group_id: event.groupId,
		user_id: event.fromUin,
		...invitedId > 0 ? { invited_id: invitedId } : {},
		comment: event.message,
		flag: event.flag
	});
}
export {};
