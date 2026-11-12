// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/api-handler.ts"
// original bundle lines 21445-21673  (227 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_log_summary();
init_logger();
var moduleLog$11 = createLogger("Bridge.Action");
function summarizeActionParams(action, params) {
	if (action !== "fetch_emoji_like") return summarizeParams(params);
	const safeParams = { ...params };
	const cursor = params.cookie;
	if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) return summarizeParams(safeParams);
	const offset = Number(cursor);
	if (!Number.isSafeInteger(offset)) return summarizeParams(safeParams);
	delete safeParams.cookie;
	safeParams.emoji_like_offset = offset;
	return summarizeParams(safeParams);
}
var ApiHandler = class {
	/** Handler + dispatch kind live in one record so stream classification can
	*  never outlive or drift from the handler it describes. */
	handlers;
	/** Sticky instance-lifecycle gate. A failed transport close may restore its
	*  own listener for retry, but it must never reopen execution against a
	*  retiring Bridge/store generation. */
	acceptingActions = true;
	log;
	/** Debug-stream taps — notified after every handled action. Attached
	*  on-demand (ref-counted) by the WebUI debug stream. */
	observers = /* @__PURE__ */ new Set();
	/** Observe handled actions (debug). Returns an unsubscribe. */
	setObserver(cb) {
		this.observers.add(cb);
		return () => {
			this.observers.delete(cb);
		};
	}
	constructor(context, uin, registry = ACTION_REGISTRY) {
		this.log = typeof uin === "number" && uin > 0 ? moduleLog$11.child({ uin }) : moduleLog$11;
		const rawFactories = {};
		for (const raw of registry.rawActions) {
			if (raw.canonical !== ".handle_quick_operation") throw new Error(`Action registry has no factory for raw action canonical "${raw.canonical}" (name "${raw.name}", kind raw)`);
			rawFactories[raw.canonical] = (api) => async (params) => {
				const opContext = params.context;
				const operation = params.operation;
				if (!opContext || !operation) return failedResponse(RETCODE.BAD_REQUEST, "context and operation are required");
				const { executeQuickOperation } = await Promise.resolve().then(() => (init_quick_operation(), quick_operation_exports));
				await executeQuickOperation(opContext, operation, api);
				return okResponse();
			};
		}
		this.handlers = registry.bind(context, this, rawFactories);
	}
	/** Whether `action` answers with a multi-frame Stream API response. */
	isStreamAction(action) {
		return this.handlers.get(action)?.kind === "stream";
	}
	/** Whether the owning OneBot instance still accepts new Action execution. */
	get isAcceptingActions() {
		return this.acceptingActions;
	}
	/** Permanently reject new Actions for this handler generation.
	*
	* Existing calls have already been admitted and are drained by their owning
	* transport/instance. There is intentionally no resume operation: hot reload
	* keeps the same live generation open, while teardown creates a new handler
	* only after the previous generation has fully retired. */
	quiesce() {
		if (!this.acceptingActions) return;
		this.acceptingActions = false;
		this.log.info("Action ingress quiesced");
	}
	async handle(action, params, sink) {
		return runWithTraceRequest(() => this.handleInContext(action, params, sink));
	}
	traceQuiescedAction(action, params, response) {
		if (this.acceptingActions) return;
		runWithTraceRequest(() => {
			const startedAt = Date.now();
			this.traceActionInput(action, params);
			this.traceActionTerminal(action, response, startedAt, "failed", "quiesced");
		});
	}
	traceQuiescedStreamRequest(rawRequest) {
		const request = parseStreamRequest(rawRequest);
		if (!request) return;
		this.traceQuiescedAction(request.action, request.params, failedResponse(RETCODE.ACTION_FAILED, "OneBot instance is shutting down"));
	}
	async handleInContext(action, params, sink) {
		const startedAt = Date.now();
		this.traceActionInput(action, params);
		if (!this.acceptingActions) {
			const response = failedResponse(RETCODE.ACTION_FAILED, "OneBot instance is shutting down");
			this.log.warn("rejected Action %s after instance quiesce", action);
			this.traceActionTerminal(action, response, startedAt, "failed", "quiesced");
			this.notifyObservers(action, params, response, 0);
			return response;
		}
		const registered = this.handlers.get(action);
		if (!registered) {
			const response = failedResponse(RETCODE.UNKNOWN_ACTION, "unknown action");
			this.log.debug("unknown action %s", action);
			this.traceActionTerminal(action, response, startedAt, "failed", "unknown_action");
			return response;
		}
		return this.runAction(action, registered.handler, params, sink, startedAt);
	}
	async runAction(action, handler, params, sink, startedAt) {
		this.log.debug("%s params=%s", action, summarizeActionParams(action, params));
		let response;
		let outcome;
		let reason;
		try {
			response = await handler(params, sink ? { send: async (frame) => {
				this.log.trace(() => [
					"action_stream_frame action=%s frame=%s",
					action,
					renderParamsVerbose(frame)
				]);
				await sink.send(frame);
			} } : void 0);
			outcome = response.status === "ok" ? "ok" : "failed";
			reason = "response_returned";
		} catch (error) {
			this.log.warn("%s failed: %s\n%s", action, error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack ?? "" : "");
			const message = error instanceof Error ? error.message : String(error);
			response = failedResponse(error instanceof MessageElementValidationError ? RETCODE.BAD_REQUEST : RETCODE.ACTION_FAILED, message);
			outcome = error instanceof StreamTransportClosedError ? "cancelled" : "failed";
			reason = error instanceof StreamTransportClosedError ? "transport_closed" : "handler_threw";
		}
		this.traceActionTerminal(action, response, startedAt, outcome, reason);
		this.notifyObservers(action, params, response, Date.now() - startedAt);
		return response;
	}
	traceActionInput(action, params) {
		this.log.trace(() => [
			"action_input action=%s params=%s",
			action,
			renderParamsVerbose(params)
		]);
	}
	traceActionTerminal(action, response, startedAt, outcome, reason) {
		this.log.trace(() => [
			"action_terminal action=%s outcome=%s reason=%s ms=%d response=%s",
			action,
			outcome,
			reason,
			Date.now() - startedAt,
			renderParamsVerbose(response)
		]);
	}
	notifyObservers(action, params, response, ms) {
		if (!this.observers.size) return;
		for (const cb of this.observers) try {
			cb({
				action,
				params,
				response,
				ms
			});
		} catch (err) {
			this.log.warn("action observer error: %s", err instanceof Error ? err.message : String(err));
		}
	}
	/** WS dispatch supporting Stream API multi-frame responses. A normal action
	*  emits exactly one frame; a stream action emits each intermediate frame
	*  then the terminal frame — every frame carries the request's echo. `emit`
	*  writes one JSON string per frame; awaiting it lets the transport apply
	*  backpressure. `isAlive`, when supplied, is checked before each stream
	*  frame — returning false aborts the action (e.g. the client disconnected),
	*  so a dead client can't make a download keep pumping frames into the void. */
	async processStreamRequest(rawRequest, emit, isAlive) {
		const bad = () => Promise.resolve(emit(JSON.stringify(failedResponse(RETCODE.BAD_REQUEST, "bad request"))));
		if (!rawRequest.trim()) {
			await bad();
			return;
		}
		const request = parseStreamRequest(rawRequest);
		if (!request) {
			await bad();
			return;
		}
		const { action, params, echo } = request;
		if (!this.isStreamAction(action)) {
			const response = await this.handle(action, params);
			if (echo !== void 0) response.echo = echo;
			await emit(JSON.stringify(response));
			return;
		}
		const response = await this.handle(action, params, { send: async (frame) => {
			if (isAlive && !isAlive()) throw new StreamTransportClosedError();
			await emit(JSON.stringify(wrapStreamFrame(frame, echo)));
		} });
		await emit(JSON.stringify(wrapStreamTerminal(response, echo)));
	}
};
function parseStreamRequest(rawRequest) {
	if (!rawRequest.trim()) return null;
	try {
		const parsed = JSON.parse(rawRequest);
		if (!isJsonObject(parsed)) return null;
		const action = asString(parsed.action);
		if (!action) return null;
		return {
			action,
			params: isJsonObject(parsed.params) ? parsed.params : {},
			echo: parsed.echo !== void 0 ? toJsonValue(parsed.echo) : void 0
		};
	} catch {
		return null;
	}
}
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value, fallback = "") {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return fallback;
}
function toJsonValue(value) {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.map(toJsonValue);
	if (isJsonObject(value)) {
		const obj = {};
		for (const [key, item] of Object.entries(value)) obj[key] = toJsonValue(item);
		return obj;
	}
	return String(value);
}
export {};
