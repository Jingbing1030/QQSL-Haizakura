// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/hook-packet-client.ts"
// original bundle lines 2649-2696  (46 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var HookPacketClient = class {
	client;
	onOutboundHealthChanged;
	outboundHealthy = true;
	constructor(client, onOutboundHealthChanged) {
		this.client = client;
		this.onOutboundHealthChanged = onOutboundHealthChanged;
	}
	async sendPacket(serviceCmd, body, timeoutMs = packetTimeoutMs()) {
		if (!this.client.isLoggedIn) return {
			success: false,
			gotResponse: false,
			errorCode: -1,
			errorMessage: "qq_hook client is not logged in",
			responseData: null
		};
		try {
			const reply = await this.client.send(serviceCmd, body, {
				wantReply: true,
				replyTimeoutMs: timeoutMs
			});
			this.setOutboundHealthy(true);
			return {
				success: reply.error === 0,
				gotResponse: true,
				errorCode: reply.error,
				errorMessage: reply.message,
				responseData: reply.body
			};
		} catch (error) {
			if (error instanceof HookPipeRequestError && error.status === -39) this.setOutboundHealthy(false);
			return {
				success: false,
				gotResponse: false,
				errorCode: -1,
				errorMessage: error instanceof Error ? error.message : String(error),
				responseData: null
			};
		}
	}
	setOutboundHealthy(healthy) {
		if (this.outboundHealthy === healthy) return;
		this.outboundHealthy = healthy;
		this.onOutboundHealthChanged?.(healthy);
	}
};
export {};
