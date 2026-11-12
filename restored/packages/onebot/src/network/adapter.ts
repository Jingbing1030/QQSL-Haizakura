// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/adapter.ts"
// original bundle lines 339350-339466  (115 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_errors();
init_logger();
var IOneBotNetworkAdapter = class {
	name;
	config;
	ctx;
	log;
	isEnabled = false;
	applyFailure = null;
	constructor(name, config, ctx, moduleLog) {
		this.name = name;
		this.config = structuredClone(config);
		this.ctx = ctx;
		const base = moduleLog ?? createLogger("OneBot.Network");
		const uinNum = Number.parseInt(ctx.uin, 10);
		this.log = Number.isFinite(uinNum) && uinNum > 0 ? base.child({ uin: uinNum }) : base;
	}
	get isActive() {
		return this.isEnabled;
	}
	get currentConfig() {
		return this.config;
	}
	get hasApplyFailure() {
		return this.applyFailure !== null;
	}
	/** Drop sockets and listeners without waiting for a peer handshake.
	*  Graceful `close()` can sit forever on a half-open connection; shutdown
	*  uses this so the next account session can bind the same ports. */
	forceClose() {}
	/** Status with the manager-owned desired/live mismatch overlaid. Concrete
	*  adapters continue to describe transport health; reconciliation failures
	*  are kept here so a successfully restored old binding is still visible. */
	describeManagedStatus() {
		const status = this.describeStatus();
		if (!this.applyFailure) return status;
		return {
			...status,
			status: "degraded",
			detail: `应用失败：${this.applyFailure.message}`,
			lastError: this.applyFailure.message,
			lastErrorAt: this.applyFailure.at
		};
	}
	/** NetworkManager lifecycle seam. A failure is cleared only after a later
	*  reconciliation reaches the desired state. */
	markApplyFailure(error, at = Date.now()) {
		this.applyFailure = {
			message: errorMessage(error),
			at
		};
	}
	clearApplyFailure() {
		this.applyFailure = null;
	}
	recordTransportFailure(error, at = Date.now()) {
		this.markApplyFailure(error, at);
	}
	/** Shape one meta event for `options` and serialize it to a wire frame, or
	*  `null` when the shaper drops it (e.g. a self-message under
	*  `reportSelfMessage:false`). */
	metaFrame(event, options) {
		const shaped = shapeEventForAdapter(event, options);
		return shaped === null ? null : JSON.stringify(shaped);
	}
	/** The bootstrap meta frames an event client receives on (re)connect:
	*  `connect`, `enable`, then a `heartbeat`, shaped for `options`. Frames the
	*  shaper drops are omitted. */
	bootstrapMetaFrames(options) {
		const events = [
			this.ctx.buildLifecycleEvent("connect"),
			this.ctx.buildLifecycleEvent("enable"),
			this.ctx.buildHeartbeatEvent()
		];
		const frames = [];
		for (const event of events) {
			const frame = this.metaFrame(event, options);
			if (frame !== null) frames.push(frame);
		}
		return frames;
	}
	/** Whether `config` should result in an enabled adapter. Defaults to the
	*  `enabled` flag; client adapters also require a target `url`. */
	willEnable(config) {
		return config.enabled !== false;
	}
	/** Refresh derived state after `this.config` has been replaced (report
	*  options, role, propagation to live connections). Default: nothing. */
	onConfigReplaced(_next) {}
	async reload(next) {
		const prevSig = this.bindingSignature(this.config);
		const wasEnabled = this.isEnabled;
		const willEnable = this.willEnable(next);
		const sigChanged = prevSig !== this.bindingSignature(next);
		if (wasEnabled && (sigChanged || !willEnable)) {
			await this.close();
			this.replaceConfig(next);
			if (willEnable) {
				await this.open();
				return 1;
			}
			return 2;
		}
		this.replaceConfig(next);
		if (!wasEnabled && willEnable) {
			await this.open();
			return 3;
		}
		return 0;
	}
	replaceConfig(next) {
		this.config = structuredClone(next);
		this.onConfigReplaced(next);
	}
};
export {};
