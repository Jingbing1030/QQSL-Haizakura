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
* messages (e.g. `#sl` + image) never match.
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
/** Render the status reply. */
function buildStatusText(info) {
	return [
		"SnowLuma 状态",
		`版本: ${info.version}`,
		`平台: ${info.platform}-${info.arch}`,
		`运行时长: ${formatUptime(info.uptimeMs)}`
	].join("\n");
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
