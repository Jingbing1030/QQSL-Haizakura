init_log_summary();
init_logger();
var log$9 = createLogger("WebUI.Mutation");
var READ_ONLY_METHODS = /* @__PURE__ */ new Set([
	"GET",
	"HEAD",
	"OPTIONS"
]);
var STREAMED_REQUEST_PATHS = /* @__PURE__ */ new Set(["/api/debug/upload"]);
var STREAMED_RESPONSE_PATHS = /* @__PURE__ */ new Set(["/api/debug/invoke-stream"]);
var TRACE_EXCLUDED_PATHS = /* @__PURE__ */ new Set(["/api/auth/check-strength", "/api/logs/level"]);
function shouldTraceMutation(request) {
	if (getLogLevel() !== "trace") return false;
	if (READ_ONLY_METHODS.has(request.method.toUpperCase())) return false;
	return !TRACE_EXCLUDED_PATHS.has(new URL(request.url).pathname);
}
async function captureBody(message) {
	const bytes = new Uint8Array(await message.arrayBuffer());
	return {
		bytes,
		text: new TextDecoder().decode(bytes)
	};
}
function traceBody(branch, body, response) {
	log$9.trace(() => [
		"webui_mutation_branch branch=%s%s length=%d text=%j body=%s",
		branch,
		response ? ` status=${response.status} statusText=${JSON.stringify(response.statusText)} headers=${renderParamsVerbose([...response.headers.entries()])}` : "",
		body.bytes.byteLength,
		body.text,
		renderTraceBytes(body.bytes)
	]);
}
function traceStreamChunk(branch, chunk, offset) {
	log$9.trace(() => [
		"webui_mutation_branch branch=%s offset=%d length=%d body=%s",
		branch,
		offset,
		chunk.byteLength,
		renderTraceBytes(chunk)
	]);
}
function traceWebuiMutationRequestChunk(chunk, offset) {
	traceStreamChunk("request_body_chunk", chunk, offset);
}
function traceStreamedResponse(response, requestBody, startedAt) {
	if (!response.body) {
		settleMutation(requestBody, Promise.resolve({
			bytes: /* @__PURE__ */ new Uint8Array(),
			text: ""
		}), response, startedAt, false);
		return response;
	}
	const reader = response.body.getReader();
	const requestId = currentRequestId();
	const inContext = (fn) => requestId === void 0 ? fn() : runWithRequestId(requestId, fn);
	let offset = 0;
	let settled = false;
	const terminal = (outcome, reason, error) => {
		if (settled) return;
		settled = true;
		inContext(() => traceRequestBody(requestBody)).then(() => {
			inContext(() => log$9.trace("webui_mutation_terminal outcome=%s reason=%s status=%d%s elapsedMs=%d", outcome, reason, response.status, error === void 0 ? "" : ` error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`, Date.now() - startedAt));
		});
	};
	const body = new ReadableStream({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					terminal(response.ok ? "completed" : "failed", response.ok ? "response_completed" : "http_status");
					controller.close();
					return;
				}
				const chunk = result.value;
				inContext(() => traceStreamChunk("response_chunk", chunk, offset));
				offset += chunk.byteLength;
				controller.enqueue(chunk);
			} catch (error) {
				terminal(error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed", error instanceof Error && error.name === "AbortError" ? "body_cancelled" : "body_read_failed", error);
				controller.error(error);
			}
		},
		async cancel(reason) {
			terminal("cancelled", "body_cancelled", reason);
			await reader.cancel(reason);
		}
	}, { highWaterMark: 0 });
	return new Response(body, response);
}
async function traceRequestBody(requestBody) {
	if (!requestBody) return;
	try {
		traceBody("request_body", await requestBody);
	} catch (error) {
		log$9.trace("webui_mutation_branch branch=request_body_failed error=%j", error instanceof Error ? error.message : String(error));
	}
}
async function settleMutation(requestBody, responseBody, response, startedAt, requestCancelled) {
	const [requestResult, responseResult] = await Promise.allSettled([requestBody ?? Promise.resolve({
		bytes: /* @__PURE__ */ new Uint8Array(),
		text: ""
	}), responseBody]);
	if (requestBody && requestResult.status === "fulfilled") traceBody("request_body", requestResult.value);
	if (requestBody && requestResult.status === "rejected") log$9.trace("webui_mutation_branch branch=request_body_failed error=%j", requestResult.reason instanceof Error ? requestResult.reason.message : String(requestResult.reason));
	if (responseResult.status === "fulfilled") traceBody("response", responseResult.value, response);
	else log$9.trace(() => [
		"webui_mutation_branch branch=response_body_failed status=%d statusText=%j headers=%s error=%j",
		response.status,
		response.statusText,
		renderParamsVerbose([...response.headers.entries()]),
		responseResult.reason instanceof Error ? responseResult.reason.message : String(responseResult.reason)
	]);
	const error = responseResult.status === "rejected" ? responseResult.reason : requestResult.status === "rejected" ? requestResult.reason : void 0;
	if (error === void 0) {
		if (requestCancelled) {
			log$9.trace("webui_mutation_terminal outcome=cancelled reason=request_cancelled status=%d elapsedMs=%d", response.status, Date.now() - startedAt);
			return;
		}
		log$9.trace("webui_mutation_terminal outcome=%s reason=%s status=%d elapsedMs=%d", response.ok ? "completed" : "failed", response.ok ? "response_completed" : "http_status", response.status, Date.now() - startedAt);
		return;
	}
	log$9.trace("webui_mutation_terminal outcome=%s reason=%s error=%j elapsedMs=%d", error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed", error instanceof Error && error.name === "AbortError" ? "body_cancelled" : "body_read_failed", error instanceof Error ? error.message : String(error), Date.now() - startedAt);
}
function failureOutcome(error) {
	if (error instanceof Error && error.name === "TimeoutError") return {
		outcome: "timeout",
		reason: "handler_timeout"
	};
	if (error instanceof Error && error.name === "AbortError") return {
		outcome: "cancelled",
		reason: "handler_cancelled"
	};
	return {
		outcome: "failed",
		reason: "handler_threw"
	};
}
/** Trace one authenticated WebUI write without consuming its live streams. */
function traceAuthenticatedWebuiMutation(request, next) {
	if (!shouldTraceMutation(request)) return next();
	return runWithTraceRequest(async () => {
		const startedAt = Date.now();
		const requestHeaders = [...request.headers.entries()];
		const pathname = new URL(request.url).pathname;
		let requestBody = null;
		log$9.trace(() => [
			"webui_mutation_start method=%j url=%j headers=%s",
			request.method,
			request.url,
			renderParamsVerbose(requestHeaders)
		]);
		if (!STREAMED_REQUEST_PATHS.has(pathname)) try {
			requestBody = captureBody(request.clone());
		} catch (error) {
			log$9.trace("webui_mutation_terminal outcome=failed reason=request_clone_failed error=%j elapsedMs=%d", error instanceof Error ? error.message : String(error), Date.now() - startedAt);
			return next();
		}
		try {
			const response = await next();
			if (STREAMED_RESPONSE_PATHS.has(pathname)) return traceStreamedResponse(response, requestBody, startedAt);
			let responseBody;
			try {
				responseBody = captureBody(response.clone());
			} catch (error) {
				traceRequestBody(requestBody).then(() => {
					log$9.trace("webui_mutation_terminal outcome=failed reason=response_clone_failed error=%j elapsedMs=%d", error instanceof Error ? error.message : String(error), Date.now() - startedAt);
				});
				return response;
			}
			settleMutation(requestBody, responseBody, response, startedAt, STREAMED_REQUEST_PATHS.has(pathname) && request.signal.aborted);
			return response;
		} catch (error) {
			await traceRequestBody(requestBody);
			const failure = failureOutcome(error);
			log$9.trace("webui_mutation_terminal outcome=%s reason=%s error=%j elapsedMs=%d", failure.outcome, failure.reason, error instanceof Error ? error.message : String(error), Date.now() - startedAt);
			throw error;
		}
	});
}
