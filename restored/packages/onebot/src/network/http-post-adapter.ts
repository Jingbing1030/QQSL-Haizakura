// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/http-post-adapter.ts"
// original bundle lines 339467-339597  (129 lines) of dist/index.mjs
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
init_quick_operation();
var moduleLog$5 = createLogger("OneBot.POST");
var DEFAULT_TIMEOUT_MS$1 = 5e3;
var HttpPostAdapter = class extends IOneBotNetworkAdapter {
	options;
	lastDelivery = null;
	constructor(name, config, ctx) {
		super(name, config, ctx, moduleLog$5);
		this.options = resolveReportOptions(config);
	}
	open() {
		if (this.config.enabled === false) return;
		if (!this.config.url) return;
		this.isEnabled = true;
	}
	close() {
		this.isEnabled = false;
	}
	describeStatus() {
		if (!this.isEnabled) return {
			name: this.name,
			kind: "httpClient",
			status: "disabled",
			detail: "未启用"
		};
		if (!this.lastDelivery) return {
			name: this.name,
			kind: "httpClient",
			status: "ok",
			detail: "已启用"
		};
		const at = new Date(this.lastDelivery.at).toTimeString().slice(0, 8);
		return this.lastDelivery.ok ? {
			name: this.name,
			kind: "httpClient",
			status: "ok",
			detail: `上次推送成功 ${at}`
		} : {
			name: this.name,
			kind: "httpClient",
			status: "warn",
			detail: `上次推送失败 ${at}`
		};
	}
	bindingSignature(config) {
		return `${config.url}#${config.accessToken ?? ""}#${config.timeoutMs ?? DEFAULT_TIMEOUT_MS$1}`;
	}
	willEnable(config) {
		return config.enabled !== false && !!config.url;
	}
	onConfigReplaced(next) {
		this.options = resolveReportOptions(next);
	}
	async onEvent(event, payload) {
		if (!this.isEnabled) return;
		const json = pickDispatchJson(payload, this.options);
		if (json === null) return;
		const config = structuredClone(this.config);
		await this.postEvent(json, event, config);
	}
	async postEvent(payload, event, config) {
		if (!this.isEnabled) return;
		const headers = {
			"Content-Type": "application/json",
			"User-Agent": "OneBot",
			"X-Self-ID": this.ctx.uin
		};
		if (config.accessToken) headers["X-Signature"] = await computeHmacSha1(config.accessToken, payload);
		const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS$1;
		const startedAt = Date.now();
		let response;
		try {
			response = await fetch(config.url, {
				method: "POST",
				headers,
				body: payload,
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (error) {
			this.lastDelivery = {
				at: Date.now(),
				ok: false
			};
			this.log.warn("[%s] POST %s failed: %s", this.name, config.url, error instanceof Error ? error.message : String(error));
			this.log.trace(() => [
				"http_report_terminal target=%s outcome=transport_failed ms=%d error=%s",
				this.name,
				Date.now() - startedAt,
				error instanceof Error ? error.stack ?? error.message : String(error)
			]);
			return;
		}
		if (!response.ok) {
			this.lastDelivery = {
				at: Date.now(),
				ok: false
			};
			this.log.warn("[%s] POST %s returned %d", this.name, config.url, response.status);
			this.log.trace("http_report_terminal target=%s outcome=rejected status=%d ms=%d", this.name, response.status, Date.now() - startedAt);
			return;
		}
		this.lastDelivery = {
			at: Date.now(),
			ok: true
		};
		this.log.trace("http_report_terminal target=%s outcome=accepted status=%d ms=%d", this.name, response.status, Date.now() - startedAt);
		if (!(response.headers.get("content-type") ?? "").includes("application/json")) return;
		try {
			const body = await response.text();
			if (body.trim()) await this.handleQuickOperation(event, body);
		} catch (error) {
			this.log.warn("[%s] quick operation response read failed: %s", this.name, error instanceof Error ? error.message : String(error));
		}
	}
	async handleQuickOperation(event, responseBody) {
		try {
			const operation = JSON.parse(responseBody);
			if (!operation || typeof operation !== "object") return;
			await executeQuickOperation(event, operation, this.ctx.api);
		} catch (error) {
			this.log.warn("[%s] quick operation failed: %s", this.name, error instanceof Error ? error.message : String(error));
		}
	}
};
async function computeHmacSha1(secret, payload) {
	const { createHmac } = await import("crypto");
	return "sha1=" + createHmac("sha1", secret).update(payload).digest("hex");
}
export {};
