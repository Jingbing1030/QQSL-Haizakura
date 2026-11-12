// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/request-util.ts"
// original bundle lines 8422-8876  (453 lines) of dist/index.mjs
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
init_log_summary();
var log$64 = createLogger("Protocol.Http");
function validateLimit(name, value) {
	const exceedsTimerRange = name === "timeoutMs" && value !== void 0 && value > 2147483647;
	if (value !== void 0 && (!Number.isSafeInteger(value) || value <= 0 || exceedsTimerRange)) throw new Error(`${name} must be a positive safe integer`);
}
var httpFailures = /* @__PURE__ */ new WeakMap();
function errorObject(error) {
	return error instanceof Error ? error : new Error(String(error));
}
function errorText$1(error) {
	return errorObject(error).message;
}
function fail(outcome, reason, error) {
	const result = errorObject(error);
	if (!httpFailures.has(result)) httpFailures.set(result, {
		outcome,
		reason
	});
	return result;
}
function traceTerminal(trace, outcome, reason, error) {
	if (trace.terminal) return;
	trace.terminal = true;
	log$64.trace(() => [
		"http_terminal method=%j url=%j outcome=%s reason=%s%s elapsedMs=%d",
		trace.method,
		trace.url,
		outcome,
		reason,
		error === void 0 ? "" : ` error=${JSON.stringify(errorText$1(error))}`,
		Date.now() - trace.startedAt
	]);
}
var SENSITIVE_REDIRECT_HEADERS = /* @__PURE__ */ new Set([
	"authorization",
	"cookie",
	"cookie2",
	"host",
	"proxy-authorization"
]);
function headersForRedirect(headers, source, target) {
	if (source.origin === target.origin) return headers;
	return Object.fromEntries(Object.entries(headers).filter(([name]) => !SENSITIVE_REDIRECT_HEADERS.has(name.toLowerCase())));
}
var RequestUtil = class {
	static async HttpsGetCookies(url, depth = 0) {
		const startedAt = Date.now();
		return runWithTraceRequest(async () => {
			const cookies = {};
			log$64.trace("http_cookie_start url=%j depth=%d", url, depth);
			let result;
			try {
				result = await this.collectCookies(url, depth, cookies);
			} catch (error) {
				result = {
					reason: "transport_failure",
					error: errorObject(error)
				};
			}
			log$64.trace(() => [
				"http_cookie_terminal url=%j outcome=completed reason=%s failOpen=%s cookies=%s%s elapsedMs=%d",
				url,
				result.reason,
				result.reason !== "response_complete",
				renderParamsVerbose(cookies),
				result.error === void 0 ? "" : ` error=${JSON.stringify(errorText$1(result.error))}`,
				Date.now() - startedAt
			]);
			return cookies;
		});
	}
	static collectCookies(url, depth, cookies) {
		const client = url.startsWith("https") ? https : http;
		return new Promise((resolve) => {
			let settled = false;
			let traceResponseDeadline;
			const done = (reason, error) => {
				if (settled) return;
				settled = true;
				resolve({
					reason,
					...error === void 0 ? {} : { error: errorObject(error) }
				});
			};
			const req = client.get(url, (res) => {
				if (res.headers["set-cookie"]) this.extractCookies(res.headers["set-cookie"], cookies);
				log$64.trace(() => [
					"http_cookie_response url=%j status=%s headers=%s cookies=%s",
					url,
					res.statusCode ?? "unknown",
					renderParamsVerbose(res.headers),
					renderParamsVerbose(cookies)
				]);
				const traceChunks = getLogLevel() === "trace" ? [] : null;
				let traceResponseBytes = 0;
				let bodyTraced = false;
				const traceBody = (state) => {
					if (bodyTraced) return;
					bodyTraced = true;
					if (traceChunks === null) return;
					const body = Buffer.concat(traceChunks, traceResponseBytes);
					log$64.trace(() => [
						"http_cookie_body url=%j state=%s bodyBytes=%d bodyHex=%s body=%j",
						url,
						state,
						traceResponseBytes,
						renderTraceBytes(body),
						body.toString()
					]);
				};
				traceResponseDeadline = () => traceBody("deadline");
				res.on("data", (chunk) => {
					if (traceChunks === null) return;
					const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					traceResponseBytes += bytes.length;
					traceChunks.push(bytes);
				});
				res.once("aborted", () => {
					traceBody("aborted");
					done("transport_failure", /* @__PURE__ */ new Error("cookie response aborted before completion"));
				});
				res.once("error", (error) => {
					traceBody("error");
					done("transport_failure", error);
				});
				res.on("end", () => {
					traceBody("complete");
					const location = res.headers.location;
					if ((res.statusCode === 301 || res.statusCode === 302) && location) {
						if (depth >= 5) {
							done("redirect_limit");
							return;
						}
						let redirectUrl;
						try {
							redirectUrl = new URL(location, url).href;
						} catch {
							done("redirect_failure");
							return;
						}
						log$64.trace(() => [
							"http_cookie_branch branch=redirect status=%d from=%j to=%j cookies=%s remainingRedirects=%d",
							res.statusCode,
							url,
							redirectUrl,
							renderParamsVerbose(cookies),
							5 - depth
						]);
						this.collectCookies(redirectUrl, depth + 1, cookies).then((result) => {
							if (settled) return;
							settled = true;
							resolve(result);
						}).catch((error) => done("transport_failure", error));
						return;
					}
					done("response_complete");
				});
			});
			req.setTimeout(8e3, () => {
				traceResponseDeadline?.();
				req.destroy();
				done("deadline");
			});
			req.on("error", (error) => done("transport_failure", error));
		});
	}
	static extractCookies(setCookieHeaders, cookies) {
		setCookieHeaders.forEach((cookie) => {
			const parts = cookie.split(";")[0]?.split("=");
			if (parts) {
				const key = parts[0];
				const value = parts[1];
				if (key && value && key.length > 0 && value.length > 0) cookies[key] = value;
			}
		});
	}
	static async HttpGetJson(url, method = "GET", data, headers = {}, isJsonRet = true, isArgJson = true, maxRedirects = 5, responseLimits = {}) {
		const methodName = method.toUpperCase();
		const trace = {
			startedAt: Date.now(),
			method: methodName,
			url,
			terminal: false
		};
		return runWithTraceRequest(async () => {
			log$64.trace(() => [
				"http_start method=%j url=%j headers=%s data=%s responseType=%s timeoutMs=%s maxResponseBytes=%s",
				methodName,
				url,
				renderParamsVerbose(headers),
				renderParamsVerbose(data),
				isJsonRet ? "json" : "text",
				responseLimits.timeoutMs ?? "none",
				responseLimits.maxResponseBytes ?? "none"
			]);
			try {
				try {
					validateLimit("timeoutMs", responseLimits.timeoutMs);
					validateLimit("maxResponseBytes", responseLimits.maxResponseBytes);
				} catch (error) {
					throw fail("failed", "request_invalid", error);
				}
				const value = await this.request({
					url,
					method: methodName,
					data,
					headers,
					isJsonRet,
					isArgJson,
					maxRedirects,
					responseLimits,
					deadlineAt: responseLimits.timeoutMs === void 0 ? void 0 : Date.now() + responseLimits.timeoutMs
				});
				traceTerminal(trace, "completed", "response_complete");
				return value;
			} catch (error) {
				const result = errorObject(error);
				const classification = httpFailures.get(result) ?? {
					outcome: "failed",
					reason: "transport_failure"
				};
				traceTerminal(trace, classification.outcome, classification.reason, result);
				throw result;
			}
		});
	}
	static async request(context) {
		let option;
		try {
			option = new URL(context.url);
		} catch (error) {
			throw fail("failed", "request_invalid", error);
		}
		const protocol = option.protocol === "https:" ? https : option.protocol === "http:" ? http : void 0;
		if (!protocol) throw fail("failed", "request_invalid", /* @__PURE__ */ new Error(`unsupported request protocol: ${option.protocol}`));
		const remainingTimeoutMs = context.deadlineAt === void 0 ? void 0 : context.deadlineAt - Date.now();
		if (remainingTimeoutMs !== void 0 && remainingTimeoutMs <= 0) throw fail("timeout", "deadline", /* @__PURE__ */ new Error(`request timed out after ${context.responseLimits.timeoutMs} ms`));
		const options = {
			hostname: option.hostname,
			port: option.port,
			path: option.pathname + option.search,
			method: context.method,
			headers: context.headers
		};
		return new Promise((resolve, reject) => {
			let settled = false;
			let timeout;
			let traceResponseFailure;
			const clearDeadline = () => {
				if (timeout !== void 0) clearTimeout(timeout);
			};
			const resolveOnce = (value) => {
				if (settled) return;
				settled = true;
				clearDeadline();
				resolve(value);
			};
			const rejectOnce = (error) => {
				if (settled) return;
				settled = true;
				clearDeadline();
				reject(error);
			};
			const handOff = (next) => {
				if (settled) return;
				settled = true;
				clearDeadline();
				next.then(resolve).catch(reject);
			};
			let req;
			try {
				req = protocol.request(options, (res) => {
					const statusCode = res.statusCode ?? 0;
					const closeCurrent = () => {
						res.destroy();
						req.destroy();
					};
					res.once("error", (error) => {
						traceResponseFailure?.("error");
						rejectOnce(fail("failed", "transport_failure", error));
					});
					res.once("aborted", () => {
						traceResponseFailure?.("aborted");
						rejectOnce(fail("cancelled", "response_aborted", /* @__PURE__ */ new Error("response aborted before completion")));
					});
					if ((statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) && res.headers.location) {
						log$64.trace(() => [
							"http_response status=%d url=%j headers=%s bodyState=not_read",
							statusCode,
							context.url,
							renderParamsVerbose(res.headers)
						]);
						if (context.maxRedirects <= 0) {
							rejectOnce(fail("failed", "redirect_failure", /* @__PURE__ */ new Error("Too many redirects")));
							closeCurrent();
							return;
						}
						let redirectUrl;
						try {
							redirectUrl = new URL(res.headers.location, option);
						} catch (error) {
							rejectOnce(fail("failed", "redirect_failure", new Error("invalid redirect location", { cause: error })));
							closeCurrent();
							return;
						}
						if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
							rejectOnce(fail("failed", "redirect_failure", /* @__PURE__ */ new Error(`unsupported redirect protocol: ${redirectUrl.protocol}`)));
							closeCurrent();
							return;
						}
						if (option.origin !== redirectUrl.origin && context.method.toUpperCase() !== "GET" && context.method.toUpperCase() !== "HEAD") {
							rejectOnce(fail("failed", "redirect_failure", /* @__PURE__ */ new Error(`cross-origin redirect cannot forward method ${context.method.toUpperCase()}`)));
							closeCurrent();
							return;
						}
						const redirectHeaders = headersForRedirect(context.headers, option, redirectUrl);
						log$64.trace(() => [
							"http_branch branch=redirect status=%d from=%j to=%j nextHeaders=%s remainingRedirects=%d",
							statusCode,
							context.url,
							redirectUrl.href,
							renderParamsVerbose(redirectHeaders),
							context.maxRedirects - 1
						]);
						handOff(this.request({
							...context,
							url: redirectUrl.href,
							headers: redirectHeaders,
							maxRedirects: context.maxRedirects - 1
						}));
						closeCurrent();
						return;
					}
					if (statusCode < 200 || statusCode >= 300) {
						log$64.trace(() => [
							"http_response status=%d url=%j headers=%s bodyState=not_read",
							statusCode,
							context.url,
							renderParamsVerbose(res.headers)
						]);
						rejectOnce(fail("failed", "non_2xx", /* @__PURE__ */ new Error(`Unexpected status code: ${res.statusCode}`)));
						closeCurrent();
						return;
					}
					const chunks = [];
					let responseBytes = 0;
					let failureBodyTraced = false;
					traceResponseFailure = (state) => {
						if (failureBodyTraced) return;
						failureBodyTraced = true;
						log$64.trace(() => {
							const observedBody = Buffer.concat(chunks, responseBytes);
							return [
								"http_response status=%d url=%j headers=%s bodyState=%s bodyBytes=%d bodyHex=%s body=%j",
								statusCode,
								context.url,
								renderParamsVerbose(res.headers),
								state,
								responseBytes,
								renderTraceBytes(observedBody),
								observedBody.toString()
							];
						});
					};
					res.on("data", (chunk) => {
						if (settled) return;
						const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
						responseBytes += bytes.length;
						chunks.push(bytes);
						if (context.responseLimits.maxResponseBytes !== void 0 && responseBytes > context.responseLimits.maxResponseBytes) {
							traceResponseFailure?.("too_large");
							const error = fail("failed", "response_too_large", /* @__PURE__ */ new Error(`response body exceeds ${context.responseLimits.maxResponseBytes} bytes`));
							rejectOnce(error);
							closeCurrent();
							return;
						}
					});
					res.on("end", () => {
						if (settled) return;
						failureBodyTraced = true;
						const responseBuffer = Buffer.concat(chunks, responseBytes);
						const responseBody = responseBuffer.toString();
						log$64.trace(() => [
							"http_response status=%d url=%j headers=%s bodyBytes=%d bodyHex=%s body=%j",
							statusCode,
							context.url,
							renderParamsVerbose(res.headers),
							responseBytes,
							renderTraceBytes(responseBuffer),
							responseBody
						]);
						try {
							if (context.isJsonRet) {
								const parsed = JSON.parse(responseBody);
								log$64.trace(() => ["http_branch branch=parse_completed responseType=json result=%s", renderParamsVerbose(parsed)]);
								resolveOnce(parsed);
							} else {
								log$64.trace("http_branch branch=parse_completed responseType=text");
								resolveOnce(responseBody);
							}
						} catch (parseError) {
							log$64.trace(() => ["http_branch branch=parse_failed responseType=json error=%j", errorText$1(parseError)]);
							rejectOnce(fail("failed", "parse_failure", parseError));
						}
					});
				});
			} catch (error) {
				rejectOnce(fail("failed", "request_invalid", error));
				return;
			}
			if (remainingTimeoutMs !== void 0) timeout = setTimeout(() => {
				traceResponseFailure?.("deadline");
				const error = /* @__PURE__ */ new Error(`request timed out after ${context.responseLimits.timeoutMs} ms`);
				rejectOnce(fail("timeout", "deadline", error));
				req.destroy();
			}, remainingTimeoutMs);
			req.on("error", (error) => rejectOnce(fail("failed", "transport_failure", error)));
			try {
				if (context.method === "POST" || context.method === "PUT" || context.method === "PATCH") {
					const requestBody = context.isArgJson ? JSON.stringify(context.data) : context.data;
					if (typeof requestBody === "string" || Buffer.isBuffer(requestBody) || requestBody instanceof Uint8Array) log$64.trace(() => {
						const requestBytes = typeof requestBody === "string" ? Buffer.from(requestBody) : requestBody;
						return [
							"http_branch branch=request_body url=%j requestBytes=%d requestHex=%s",
							context.url,
							requestBytes.byteLength,
							renderTraceBytes(requestBytes)
						];
					});
					req.write(requestBody);
				}
				req.end();
			} catch (error) {
				rejectOnce(fail("failed", "request_invalid", error));
				req.destroy();
			}
		});
	}
	static async HttpGetText(url, method = "GET", data, headers = {}, responseLimits = {}) {
		return this.HttpGetJson(url, method, data, headers, false, false, 5, responseLimits);
	}
};
function cookieToString(cookieObject) {
	return Object.entries(cookieObject).map(([key, value]) => `${key}=${value}`).join("; ");
}
function getBknFromCookie(cookieObject) {
	const skey = cookieObject["p_skey"] || cookieObject["skey"] || "";
	let hash = 5381;
	for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
	return (hash & 2147483647).toString();
}
export {};
