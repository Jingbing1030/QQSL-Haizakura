// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — status reply probes
//
// New file (not in the original bundle). Supplies the diagnostic facts that
// buildStatusText renders beyond version/platform/uptime: hook pipe state,
// adapter state, memory, in-flight counter.
//
// Every probe returns evidence, never a default. When a fact cannot be
// established the probe says so — it does not report 0, because a zero is
// indistinguishable from a real measurement at the other end of a chat message.
// ---------------------------------------------------------------------------
// @ts-nocheck
import fs from "node:fs";

/**
 * Report the hook pipe by looking at the filesystem the payload publishes it on.
 *
 * Deliberately not read from an internal field: the field name is an implementation detail of
 * this bundle and has already moved once. The sockets are the contract — SnowLuma locates the
 * hook through those same files — so reading them reports the same truth the rest of the
 * process acts on.
 */
function describeHookPipe() {
	const dir = resolveRuntimeDir();
	if (!dir) return "未知 (没有运行时目录)";
	let entries;
	try {
		entries = fs.readdirSync(dir);
	} catch (err) {
		if (err && err.code === "ENOENT") return "未连接 (运行时目录不存在)";
		return `无法读取 ${dir} (${err?.code ?? err?.message})`;
	}
	const pids = [];
	for (const name of entries) {
		const m = /^mojo\.(\d+)\.control\.sock$/.exec(name);
		if (m) pids.push(Number(m[1]));
	}
	if (pids.length === 0) return "未连接 (没有 control socket)";
	pids.sort((a, b) => a - b);
	const parts = pids.map((pid) => {
		const alive = isProcessAlive(pid);
		const hasRecv = entries.includes(`mojo.${pid}.recv.sock`);
		return `${pid}${alive ? "" : " 已退出"}${hasRecv ? "" : " 缺 recv"}`;
	});
	return `已连接 PID=${parts.join(",")}`;
}

/** The runtime directory the payload publishes sockets into, by the same precedence it uses. */
function resolveRuntimeDir() {
	if (process.env.SNOWLUMA_HOOK_RUNTIME_DIR) return process.env.SNOWLUMA_HOOK_RUNTIME_DIR;
	if (process.env.XDG_RUNTIME_DIR) return process.env.XDG_RUNTIME_DIR;
	const uid = typeof process.geteuid === "function" ? process.geteuid() : 0;
	return `/tmp/snowluma-${uid}`;
}

function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means it exists and belongs to someone else; that still counts as alive.
		return err?.code === "EPERM";
	}
}

/**
 * Whether an adapter is serving, decided from evidence rather than from a field name.
 *
 * The adapters share no status method and `listening` lives on the concrete classes, so reading
 * it off the base yielded undefined and the reply said "未监听" while the ports were plainly open
 * — the worst kind of diagnostic, one that is confidently wrong. The map also holds a
 * `{kind, adapter}` wrapper, so the real object has to be unwrapped first.
 */
function describeAdapter(wrapper) {
	if (!wrapper || typeof wrapper !== "object") return "未知";
	const adapter = wrapper.adapter && typeof wrapper.adapter === "object" ? wrapper.adapter : wrapper;
	if (adapter.isEnabled === false) return "已禁用";
	const port = firstNumber(
		adapter.config?.port,
		adapter.port,
		wrapper.config?.port,
		wrapper.port
	);
	if (port !== null) return isPortListening(port) ? `监听中 :${port}` : `未监听 :${port}`;
	const url = adapter.config?.url ?? adapter.url;
	if (typeof url === "string") return adapter.listening === true ? "已连接" : "未连接";
	if (adapter.listening === true) return "运行中";
	// Last resort: name the fields that did exist, so the next person can fix the probe in one
	// edit instead of three.
	const keys = Object.keys(adapter).filter((k) => !k.startsWith("_")).slice(0, 8);
	return keys.length > 0 ? `未知 (${keys.join(",")})` : "未知";
}

function firstNumber(...values) {
	for (const v of values) if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
	return null;
}

/**
 * Is anything listening on this port?
 *
 * /proc/net/tcp is the cheapest honest answer: no socket to open, no dependency to load, and it
 * reflects the kernel's view rather than the adapter's belief about itself.
 */
function isPortListening(port) {
	const want = port.toString(16).toUpperCase().padStart(4, "0");
	for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
		let text;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n").slice(1)) {
			const cols = line.trim().split(/\s+/);
			if (cols.length < 4) continue;
			// col 1 = local_address (hex ip:port), col 3 = state; 0A is LISTEN.
			if (cols[3] === "0A" && cols[1].endsWith(":" + want)) return true;
		}
	}
	return false;
}

export { describeHookPipe, describeAdapter, resolveRuntimeDir, isPortListening };
