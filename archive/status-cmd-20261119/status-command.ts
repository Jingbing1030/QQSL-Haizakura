// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/modules/status-command.ts"
// original bundle lines 41262-41313  (50 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/**
* True iff `message` matches the given trigger using exact match.
*
* Only a single text segment (or a bare string) is accepted — mixed-segment
* messages (e.g. `#Haizakura` + image) never match.
*/
function matchesStatusCommand(message, trigger) {
	if (typeof message === "string") return normalize(message) === normalize(trigger);
	if (!Array.isArray(message) || message.length !== 1) return false;
	const seg = message[0];
	if (!isObject$2(seg) || seg.type !== "text") return false;
	const data = isObject$2(seg.data) ? seg.data : null;
	return normalize(data && typeof data.text === "string" ? data.text : "") === normalize(trigger);
}
function normalize(s) {
	return s.trim().toLowerCase();
}
function isObject$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Whether a reply is allowed now given the last reply time + cooldown.
* `cooldownSeconds <= 0` disables the cooldown entirely.
*/
function statusCooldownElapsed(lastRepliedAtMs, nowMs, cooldownSeconds) {
	if (lastRepliedAtMs === void 0) return true;
	if (cooldownSeconds <= 0) return true;
	return nowMs - lastRepliedAtMs >= cooldownSeconds * 1e3;
}
/**
* Render the status reply.
*
* The first four lines are the original minimum: version, platform, uptime. Everything after them
* is diagnostic, and only appears when the caller supplied it. The point of the command is to
* answer "is this still healthy after N days", which the bare uptime cannot do -- so start time,
* memory, hook pipe state, adapter state and in-flight work are added, each guarded by a call
* site that omits the line rather than inventing a default. A fabricated zero (an absent counter
* reported as 0) is worse than a missing line, because it is indistinguishable from a real and
* alarming measurement.
*/
function buildStatusText(info) {
	const lines = [
		"Haizakura 状态",
		`版本: ${info.version}`,
		`平台: ${info.platform}-${info.arch}`,
		`运行时长: ${formatUptime(info.uptimeMs)}`
	];
	if (info.startedAt) lines.push(`启动于: ${formatWhen(info.startedAt)}`);
	if (info.uin) lines.push(`账号: ${info.uin}`);
	if (info.rssMb !== void 0) {
		lines.push(`内存: ${info.rssMb} MB${info.heapMb !== void 0 ? ` (堆 ${info.heapMb} MB)` : ""}`);
	}
	if (info.hook) lines.push(`Hook: ${info.hook}`);
	if (info.networks && info.networks.length > 0) lines.push(`连接: ${info.networks.join(" ")}`);
	if (info.counters && info.counters.length > 0) lines.push(...info.counters);
	if (info.uptimeMs !== void 0) lines.push(`运行毫秒: ${info.uptimeMs}`);
	return lines.join("\n");
}

/**
* Absolute timestamp for the start time, local time.
*
* Paired with the relative uptime because they answer different questions: uptime tells you how
* long, the timestamp tells you when -- and after several days of running, "when" is the one that
* lets you correlate a restart with something else that happened.
*/
function formatWhen(ts) {
	const d = new Date(ts);
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** Bytes to a short human figure; the status line is read on a phone. */
function formatMb(bytes) {
	return Math.round(bytes / 1048576);
}
/** Human-readable uptime (zh-CN), dropping leading zero units. */
function formatUptime(ms) {
	const totalSec = Math.max(0, Math.floor(ms / 1e3));
	const days = Math.floor(totalSec / 86400);
	const hours = Math.floor(totalSec % 86400 / 3600);
	const minutes = Math.floor(totalSec % 3600 / 60);
	const seconds = totalSec % 60;
	if (days > 0) return `${days}天 ${hours}小时 ${minutes}分钟`;
	if (hours > 0) return `${hours}小时 ${minutes}分钟`;
	if (minutes > 0) return `${minutes}分钟 ${seconds}秒`;
	return `${seconds}秒`;
}
export {};
