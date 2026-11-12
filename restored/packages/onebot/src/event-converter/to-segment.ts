// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/to-segment.ts"
// original bundle lines 22964-23017  (52 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
var log$57 = createLogger("OneBot");
async function elementsToOneBotSegments(ctx, elements, isGroup, sessionId, options = {}) {
	const segmentCtx = {
		...ctx,
		isGroup,
		sessionId,
		mediaSegmentSink: null,
		currentMessage: options.currentMessage
	};
	const result = [];
	for (const element of elements) {
		let segment;
		try {
			segment = await elementToSegment(element, segmentCtx);
		} catch (err) {
			log$57.warn("segment convert skipped type=%s (%s)", element.type, err instanceof Error ? err.message : String(err));
			continue;
		}
		if (element.type === "reply" && segment.data.id === "0" && !options.includeReplyContent) {
			log$57.warn("quote target unresolved: group=%s session=%d seq=%d time=%s; omitting reply id", isGroup, sessionId, element.replySeq, element.replyTime);
			continue;
		}
		if (options.includeReplyContent && element.type === "reply" && element.replyElements?.length) {
			const message = await elementsToOneBotSegments(ctx, element.replyElements.filter((quoted) => quoted.type !== "reply"), isGroup, sessionId);
			if (message.length > 0) {
				const data = segment.data;
				data.message = message;
				if (element.replySenderUin) data.qq = String(element.replySenderUin);
				if (element.replyTime !== void 0) data.time = String(element.replyTime);
				if (element.replySeq) data.seq = String(element.replySeq);
			}
		}
		attachMessageMedia(segment, element);
		if (element.type === "image" || element.type === "record" || element.type === "video") await ctx.mediaSegmentSink?.(element.type, element, segment.data, isGroup, sessionId);
		result.push(segment);
		if (element.type === "markdown" && element.text) result.push({
			type: "text",
			data: { text: element.text }
		});
	}
	return result;
}
async function elementToSegment(element, ctx) {
	const codec = getElementCodec(element.type);
	if (codec?.toSegment) return codec.toSegment(element, ctx);
	log$57.warn("segment convert fallback type=%s reason=no receive-side codec", element.type);
	return {
		type: element.type,
		data: {}
	};
}
export {};
