// ---------------------------------------------------------------------------
// Satori 适配器挂载层（integration shim）—— v2
//
// 设计要点（v1 的错误已修正）：
//
// ❌ v1 曾尝试 RESTORE_NETWORK_KEYS.add("satoriServers") + 猴补 makeDefaultOneBotConfig。
//    实测证明这【会炸 restore 路径】：
//      config.ts:222  for (const key of RESTORE_NETWORK_KEYS)
//                       parsed.networks[key].length   ← fromJson 输出不含 satoriServers
//                     → undefined.length → TypeError，整个配置保存/恢复不可用
//    而且 fromJson(572) / toJsonObject(498) 都【硬编码 4 个 kind】，
//    validateRestoreAdapterArray 对未知 kind 会要求 url 字段。
//    → 结论：新增 kind 必须改 config.ts 本体，而那是现有 region（改它要重编号 432 个 region）。
//
// ✅ v2 方案：复用【现有的 wsServers[]】，靠 Sentinel path 识别。
//    - 配置管线 100% 复用（解析/校验/序列化/热重载/端口冲突检测）
//    - 只 patch 1 个原型方法（createNetworkAdapter）
//    - 代价：WebUI 状态列表里归在「WS 服务器」分组（状态标签仍是 Satori）
//
// Sentinel 约定：wsServers[] 中 path === "/v1/events" 的条目 = Satori 服务器。
//   （/v1/events 本来就是 Satori 协议的 WS 端点路径，不会与 OneBot WS 冲突）
// ---------------------------------------------------------------------------
// @ts-nocheck

var satoriMountLog = createLogger("OneBot.Satori.Mount");

/** Satori WS 端点路径 —— 以此识别 wsServers[] 里的 Satori 条目 */
var SATORI_MOUNT_EVENT_PATH = "/v1/events";

/** 幂等标记（bundle 可能因热更新重复执行） */
var SATORI_MOUNT_FLAG = "__haizakuraSatoriMounted";

/** 判断一个 wsServers 条目是否是 Satori 服务器 */
function satoriMountIsSatoriServer(config) {
	if (!config || typeof config !== "object") return false;
	// Explicit declaration wins: `protocol: "satori"` is the documented way.
	if (config.protocol === "satori") return true;
	var p = typeof config.path === "string" ? config.path : "/";
	// Tolerate trailing slashes and query strings (legacy sentinel form).
	var normalized = p.split("?")[0].replace(/\/+$/, "") || "/";
	return normalized === SATORI_MOUNT_EVENT_PATH;
}

/**
 * 让 createNetworkAdapter 把「path=/v1/events 的 wsServer」实例化为 SatoriServerAdapter。
 *
 * 原实现（instance.ts:353）是个 switch，只认 4 个 kind。这里包一层：
 * 先看是不是 Satori 的 wsServer，否则交回原实现。
 */
function satoriMountPatchAdapterFactory() {
	if (typeof OneBotInstance !== "function") {
		satoriMountLog.warn("OneBotInstance not found - Satori adapter cannot mount");
		return false;
	}
	var proto = OneBotInstance.prototype;
	if (proto[SATORI_MOUNT_FLAG]) return true;

	var original = proto.createNetworkAdapter;
	if (typeof original !== "function") {
		satoriMountLog.warn("createNetworkAdapter not found - Satori adapter cannot mount");
		return false;
	}

	proto.createNetworkAdapter = function satoriCreateNetworkAdapter(desired, ctx) {
		try {
			if (desired && desired.kind === "wsServer" && satoriMountIsSatoriServer(desired.config)) {
				return new SatoriServerAdapter(desired.name, desired.config, ctx);
			}
		} catch (error) {
			// 兜底：任何判断异常都退回原生实现，绝不阻断 OneBot WS
			satoriMountLog.warn("Satori detection failed, falling back to wsServer: %s", String(error));
		}
		return original.call(this, desired, ctx);
	};
	proto[SATORI_MOUNT_FLAG] = true;
	return true;
}

/** 执行挂载，返回报告（便于日志诊断）。 */
function satoriMountAll() {
	var report = { adapterFactory: satoriMountPatchAdapterFactory() };
	var ok = report.adapterFactory;
	if (ok) {
		satoriMountLog.info(
			"Satori adapter mounted (sentinel path=%s, self-contained adapter, no config.ts changes)",
			SATORI_MOUNT_EVENT_PATH
		);
	} else {
		satoriMountLog.warn("Satori mount FAILED: adapterFactory=%s", String(report.adapterFactory));
	}
	return report;
}

// 立即挂载（本 region 的 mode 为 inline）
satoriMountAll();

export {};
