// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-filter.ts"
// original bundle lines 339310-339349  (38 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function resolveReportOptions(network) {
	return {
		messageFormat: network.messageFormat ?? "array",
		reportSelfMessage: network.reportSelfMessage ?? false
	};
}
function buildDispatchPayload(event) {
	const isSelfMessage = event.post_type === "message_sent";
	const arrayJson = JSON.stringify(event);
	let stringJson = arrayJson;
	if ((event.post_type === "message" || event.post_type === "message_sent") && Array.isArray(event.message)) {
		const raw = typeof event.raw_message === "string" ? event.raw_message : "";
		stringJson = JSON.stringify({
			...event,
			message: raw
		});
	}
	return {
		isSelfMessage,
		arrayJson,
		stringJson
	};
}
function pickDispatchJson(payload, options) {
	if (payload.isSelfMessage && !options.reportSelfMessage) return null;
	return options.messageFormat === "string" ? payload.stringJson : payload.arrayJson;
}
function shapeEventForAdapter(event, options) {
	if (event.post_type === "message_sent" && !options.reportSelfMessage) return null;
	if (options.messageFormat === "string" && (event.post_type === "message" || event.post_type === "message_sent") && Array.isArray(event.message)) {
		const raw = typeof event.raw_message === "string" ? event.raw_message : "";
		return {
			...event,
			message: raw
		};
	}
	return event;
}
export {};
