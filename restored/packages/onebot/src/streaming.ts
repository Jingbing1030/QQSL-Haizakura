// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/streaming.ts"
// original bundle lines 6932-6996  (63 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Marks an OB11 envelope as one frame of a streaming response. */
var STREAM_MARK = "stream-action";
/** Frame `type` discriminator carried inside each frame's `data`. */
var StreamStatus = /* @__PURE__ */ function(StreamStatus) {
	/** An intermediate chunk frame (transfer in progress). */
	StreamStatus["Stream"] = "stream";
	/** The terminal frame — the stream finished successfully. */
	StreamStatus["Response"] = "response";
	/** A stream was reset / aborted by the caller. */
	StreamStatus["Reset"] = "reset";
	/** The terminal frame — the stream failed. */
	StreamStatus["Error"] = "error";
	return StreamStatus;
}({});
var StreamTransportClosedError = class extends Error {
	constructor(message = "stream transport closed") {
		super(message);
		this.name = "StreamTransportClosedError";
	}
};
/** Fallback sink for when a stream action is invoked over a transport that
*  can't stream (or by a plain client): intermediate frames are dropped, the
*  terminal response is still returned normally. */
var NOOP_SINK = { send: async () => {} };
/** Wrap a raw stream-frame `data` payload into an OB11 envelope carrying the
*  stream marker (mirrors NapCat's `OB11Response.ok(data, echo, true)`). The
*  empty `message`/`wording` pair matches NapCat — clients reading either key
*  on an intermediate frame get `''`, never `undefined`. */
function wrapStreamFrame(data, echo) {
	const frame = {
		status: "ok",
		retcode: 0,
		data,
		message: "",
		wording: "",
		stream: STREAM_MARK
	};
	if (echo !== void 0) frame.echo = echo;
	return frame;
}
/** Turn an action's terminal `ApiResponse` into the final streaming frame:
*  attach the stream marker + echo, mirror `wording` into `message` (NapCat
*  sets both), and — on failure — normalise `data` to an error packet
*  (`{ type:'error' }`) so NapCat clients see the error `type` while the
*  human-readable reason stays in `message`/`wording`.
*
*  Contract: on success the action's `data` MUST carry `type:'response'` (the
*  client treats that frame as the stream terminator). Stream actions are
*  responsible for that, mirroring NapCat's `BaseDownloadStream`. */
function wrapStreamTerminal(response, echo) {
	const frame = {
		...response,
		stream: STREAM_MARK
	};
	if (echo !== void 0) frame.echo = echo;
	if (response.status === "failed") frame.data = {
		type: "error",
		data_type: "error"
	};
	frame.message = frame.wording ?? "";
	if (frame.wording === void 0) frame.wording = "";
	return frame;
}
export {};
