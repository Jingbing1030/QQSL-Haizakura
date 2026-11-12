init_logger();
var log$1 = createLogger("App");
var LEVEL_NAMES = {
	0: "Untrusted",
	4096: "Low",
	8192: "Medium",
	8448: "Medium Plus",
	12288: "High",
	16384: "System",
	20480: "Protected Process"
};
function level(rid) {
	return `${LEVEL_NAMES[rid] ?? "Unknown"} (RID=${rid})`;
}
/** Called once by main(), never by WebUI polling or warning dismissal. */
function logRuntimeIntegrity(integrity) {
	if (integrity.status === "unsupported") return;
	if (integrity.status === "unavailable") {
		log$1.warn("Node integrity: unknown (%s)", integrity.error);
		return;
	}
	const token = integrity.process;
	const file = integrity.file;
	const tokenText = token.status === "ok" ? level(token.rid) : `unknown (${token.operation}, Win32=${token.code})`;
	const fileText = file.status === "error" ? `unknown (${file.operation}, Win32=${file.code})` : file.label ? `${level(file.label.rid)}, inherited=${file.label.inherited}, policy=${file.label.policy}` : "unlabeled";
	const report = `Node integrity: pid=${integrity.pid}, process=${tokenText}; EXE=${fileText}`;
	if (token.status === "error" || file.status === "error" || hasLowProcessIntegrity(integrity) || file.label && file.label.rid < 8192) log$1.warn(report);
	else log$1.info(report);
}
async function runApplication(root) {
	let stopping = false;
	let child;
	const requestShutdown = () => {
		if (child?.connected) child.send("shutdown", (error) => {
			if (error) console.error("[App] 发送退出请求失败:", error);
		});
	};
	for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
		stopping = true;
		if (process.platform === "win32") requestShutdown();
		else child?.kill(signal);
	});
	try {
		do {
			const version = await applyPendingUpdate(root);
			if (version) console.info(`[Update] 已更新至 v${version}`);
			if (stopping) break;
			const code = await new Promise((resolve, reject) => {
				child = spawn(process.execPath, [
					...process.execArgv,
					path.join(root, "index.mjs"),
					...process.argv.slice(2)
				], {
					stdio: [
						"inherit",
						"inherit",
						"inherit",
						"ipc"
					],
					env: {
						...process.env,
						SNOWLUMA_UPDATE_ROOT: root
					}
				});
				child.once("error", reject);
				child.on("message", (message) => {
					if (message === "ready" && stopping) requestShutdown();
				});
				child.once("exit", (exitCode, signal) => resolve(exitCode ?? (signal === "SIGINT" ? 130 : 143)));
			});
			child = void 0;
			if (code !== 75 || stopping) {
				process.exitCode = code === 75 ? 0 : code;
				break;
			}
		} while (!stopping);
	} catch (error) {
		console.error("[Update] 启动失败:", error);
		process.exitCode = 1;
	}
}
