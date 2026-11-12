init_errors();
init_logger();
var log$7 = createLogger("WebUI.StateStream");
var ALL_RESOURCES = [
	"processes",
	"qq-list",
	"connections"
];
function bindStateStream(opts) {
	const debounceMs = opts.debounceMs ?? 50;
	let disposed = false;
	function resourceStream(resource) {
		let timer = null;
		let task = null;
		let pending = false;
		function clearTimer() {
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
		}
		function flush() {
			if (disposed) return Promise.resolve();
			if (task) return task;
			clearTimer();
			task = Promise.resolve().then(async () => {
				if (disposed) return;
				const data = await opts.snapshot(resource);
				if (!disposed) opts.send({
					resource,
					data
				});
			}).catch((error) => {
				log$7.warn("state stream %s failed: %s", resource, errorMessage(error));
			}).finally(() => {
				task = null;
				if (pending) {
					pending = false;
					schedule();
				}
			});
			return task;
		}
		function schedule() {
			if (disposed) return;
			if (task) {
				pending = true;
				return;
			}
			clearTimer();
			timer = setTimeout(() => void flush(), debounceMs);
		}
		return {
			flush,
			schedule,
			clearTimer
		};
	}
	const streams = {
		processes: resourceStream("processes"),
		"qq-list": resourceStream("qq-list"),
		connections: resourceStream("connections")
	};
	const unsubscribe = opts.bus.subscribe((resource) => streams[resource].schedule());
	return {
		async sendAllInitial() {
			await Promise.all(ALL_RESOURCES.map((resource) => streams[resource].flush()));
		},
		dispose() {
			disposed = true;
			unsubscribe();
			ALL_RESOURCES.forEach((resource) => streams[resource].clearTimer());
		}
	};
}
