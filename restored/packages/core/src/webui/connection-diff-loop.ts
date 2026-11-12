init_logger();
init_log_summary();
var log$6 = createLogger("WebUI.Connections");
/** One shared loop while clients subscribe; each subscription returns its release handle. */
function createConnectionPoller(opts) {
	const intervalMs = opts.intervalMs ?? 500;
	let lastSerialized = null;
	let subscribers = 0;
	let timer = null;
	let warnedSnapshotThrew = false;
	let warnedProjectorThrew = false;
	const tick = () => {
		if (subscribers === 0) return;
		let snap;
		try {
			snap = opts.getSnapshot();
		} catch (err) {
			if (!warnedSnapshotThrew) {
				warnedSnapshotThrew = true;
				runWithTraceRequest(() => {
					const startedAt = Date.now();
					log$6.trace("connection_diff_start phase=snapshot_read");
					log$6.trace("connection_diff_terminal outcome=failed reason=snapshot_failed error=%j elapsedMs=%d", err instanceof Error ? err.message : String(err), Date.now() - startedAt);
				});
			}
			return;
		}
		let comparable;
		try {
			comparable = opts.pickComparable ? opts.pickComparable(snap) : snap;
		} catch (err) {
			if (!warnedProjectorThrew) {
				warnedProjectorThrew = true;
				log$6.error("connection snapshot projector failed; updates may be stale: %s", err instanceof Error ? err.message : String(err));
				runWithTraceRequest(() => {
					const startedAt = Date.now();
					log$6.trace(() => ["connection_diff_start phase=project snapshot=%s", renderParamsVerbose(snap)]);
					log$6.trace("connection_diff_terminal outcome=failed reason=projector_failed error=%j elapsedMs=%d", err instanceof Error ? err.message : String(err), Date.now() - startedAt);
				});
			}
			return;
		}
		const serialized = JSON.stringify(comparable);
		if (lastSerialized === null) {
			lastSerialized = serialized;
			return;
		}
		if (serialized === lastSerialized) return;
		lastSerialized = serialized;
		runWithTraceRequest(() => {
			const startedAt = Date.now();
			log$6.trace(() => ["connection_diff_start snapshot=%s", renderParamsVerbose(snap)]);
			log$6.trace("connection_diff_branch branch=publish resource=connections");
			opts.bus.publish("connections");
			log$6.trace("connection_diff_terminal outcome=completed reason=published elapsedMs=%d", Date.now() - startedAt);
		});
	};
	return () => {
		if (subscribers++ === 0) {
			lastSerialized = null;
			tick();
			timer = setInterval(tick, intervalMs);
			timer.unref();
		}
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			if (--subscribers === 0 && timer !== null) {
				clearInterval(timer);
				timer = null;
				lastSerialized = null;
			}
		};
	};
}
