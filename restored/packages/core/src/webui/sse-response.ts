init_logger();
var log$8 = createLogger("WebUI.SSE");
/** Owns stream cancellation, subscriptions and the keep-alive timer. */
function sseResponse(request, start, shutdown) {
	const signal = shutdown ? AbortSignal.any([request, shutdown]) : request;
	let cancel;
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			let heartbeat;
			const cleanups = [];
			const cleanup = (fn) => {
				try {
					fn();
				} catch (error) {
					log$8.warn("stream cleanup failed: %s", error);
				}
			};
			const teardown = (closeStream = true) => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				signal.removeEventListener("abort", onAbort);
				if (closeStream) controller.close();
				cleanups.splice(0).forEach(cleanup);
			};
			const onAbort = () => teardown();
			cancel = () => teardown(false);
			signal.addEventListener("abort", onAbort, { once: true });
			if (signal.aborted) {
				teardown();
				return;
			}
			const raw = (chunk) => {
				if (!closed) controller.enqueue(chunk);
			};
			const channel = {
				raw,
				encode: (text) => encoder.encode(text),
				send: (payload) => {
					if (!closed) raw(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
				},
				onClose: (fn) => {
					if (closed) cleanup(fn);
					else cleanups.push(fn);
				},
				close: () => teardown(),
				isClosed: () => closed,
				desiredSize: () => controller.desiredSize
			};
			try {
				start(channel);
				if (!closed) heartbeat = setInterval(() => raw(encoder.encode(": heartbeat\n\n")), 15e3);
			} catch (error) {
				teardown();
				throw error;
			}
		},
		cancel() {
			cancel();
		}
	});
	return new Response(stream, { headers: {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive"
	} });
}
