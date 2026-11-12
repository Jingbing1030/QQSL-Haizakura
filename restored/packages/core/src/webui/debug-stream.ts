/** Returns a `push(payload)` that frames + delivers with backpressure dropping. */
function createFramePusher(opts) {
	const encode = opts.encode ?? ((s) => new TextEncoder().encode(s));
	let dropped = 0;
	return (payload) => {
		const d = opts.desiredSize();
		if (d !== null && d <= 0) {
			dropped += 1;
			return;
		}
		if (dropped > 0) {
			opts.enqueue(encode(`data: ${JSON.stringify({
				kind: "dropped",
				count: dropped
			})}\n\n`));
			dropped = 0;
		}
		opts.enqueue(encode(`data: ${JSON.stringify(payload)}\n\n`));
	};
}
