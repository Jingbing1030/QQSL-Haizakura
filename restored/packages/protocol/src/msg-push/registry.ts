// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/registry.ts"
// original bundle lines 153849-153903  (53 lines) of dist/index.mjs
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
var log$40 = createLogger("MsgPush");
var unknownLog = createLogger("MsgPush.Unknown");
var MsgPushRegistry = class {
	decoders_ = /* @__PURE__ */ new Map();
	register(pkgType, decoder) {
		const list = Array.isArray(pkgType) ? pkgType : [pkgType];
		for (const t of list) {
			if (this.decoders_.has(t)) throw new Error(`MsgPushRegistry: PkgType ${t} already registered`);
			this.decoders_.set(t, decoder);
		}
	}
	decode(ctx) {
		try {
			return this.runDecoder(ctx);
		} catch (e) {
			this.traceDecoderException(ctx, e);
			log$40.error("decoder error for PkgType=%d subType=%d: %s", ctx.head.msgType, ctx.head.subType, e instanceof Error ? e.stack ?? e.message : String(e));
			return [];
		}
	}
	decodeOrThrow(ctx) {
		try {
			return this.runDecoder(ctx);
		} catch (e) {
			this.traceDecoderException(ctx, e);
			throw e;
		}
	}
	runDecoder(ctx) {
		const decoder = this.decoders_.get(ctx.head.msgType);
		if (!decoder) {
			unknownLog.trace(() => [
				"packet_branch branch=decoder_unregistered msgType=%d subType=%d messageSeq=%d",
				ctx.head.msgType,
				ctx.head.subType,
				ctx.head.sequence
			]);
			unknownLog.debug("no decoder for PkgType=%d subType=%d", ctx.head.msgType, ctx.head.subType);
			return [];
		}
		return decoder(ctx);
	}
	traceDecoderException(ctx, error) {
		log$40.trace(() => [
			"packet_branch branch=decoder_exception msgType=%d subType=%d messageSeq=%d error=%j",
			ctx.head.msgType,
			ctx.head.subType,
			ctx.head.sequence,
			error instanceof Error ? error.message : String(error)
		]);
	}
};
export {};
