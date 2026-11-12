init_log_file_transport();
init_logger();
init_runtime();
var log = createLogger("App");
var updateRoot = path.dirname(fileURLToPath$1(import.meta.url));
function installProcessGuards() {
	process.on("unhandledRejection", (reason) => {
		log.error("unhandledRejection (kept alive): %s", reason instanceof Error ? reason.stack ?? reason.message : String(reason));
	});
	process.on("uncaughtException", (error) => {
		log.error("uncaughtException (kept alive): %s", error.stack ?? error.message);
	});
}
async function main() {
	const runtimeConfig = loadRuntimeConfig();
	await configureFileTransport({
		maxTotalMb: runtimeConfig.logMaxTotalMb ?? 1024,
		retainDays: runtimeConfig.logRetainDays ?? 7,
		perUinEnabled: runtimeConfig.logPerUin ?? false
	});
	log.info("SnowLuma starting");
	logRuntimeIntegrity(await getRuntimeIntegrity());
	migrateGlobalSettings();
	cleanupInvalidPerUinConfigs();
	const bridgeManager = new BridgeManager();
	bindSystemFaceCatalog(bridgeManager);
	const oneBotManager = new OneBotManager();
	oneBotManager.bind(bridgeManager);
	const autoLoadOnDiscovery = resolveAutoLoad(runtimeConfig.hookAutoLoad);
	const stateWiring = createStateWiring(bridgeManager);
	const hookManager = new HookManager({
		bridgeManager,
		autoLoadOnDiscovery,
		onSessionsChanged: stateWiring.onSessionsChanged
	});
	if (autoLoadOnDiscovery) log.info("hook auto-load enabled: every discovered QQ process will be injected");
	const notificationManager = createNotificationManager(async (uin, pid) => {
		const found = (await hookManager.listProcesses()).find((p) => p.pid === pid && p.uin === uin);
		return found ? {
			status: found.status,
			pid: found.pid,
			error: found.error
		} : void 0;
	});
	notificationManager.bind(bridgeManager);
	let stopWebUI;
	try {
		stopWebUI = (await initWebUI(runtimeConfig.webuiPort || 5099, oneBotManager, hookManager, notificationManager, {
			host: runtimeConfig.webuiHost,
			tlsEnabled: runtimeConfig.webuiTls?.enabled,
			trustProxy: runtimeConfig.trustProxy,
			stateBus: stateWiring.bus,
			updateRoot,
			restart: () => {
				shutdown("update", 75);
			}
		})).stop;
	} catch (err) {
		log.error("Failed to start WebUI: ", err);
	}
	let shutdownStarted = false;
	const shutdown = async (signal, requestedExitCode = 0) => {
		if (shutdownStarted) return;
		shutdownStarted = true;
		log.warn(`Shutting down (${signal})...`);
		let exitCode = requestedExitCode;
		try {
			await oneBotManager.dispose();
		} catch (error) {
			exitCode = 1;
			log.error("OneBot shutdown failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		}
		try {
			notificationManager.dispose();
		} catch (error) {
			exitCode = 1;
			log.error("notification shutdown failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		}
		try {
			if (stopWebUI) await stopWebUI();
		} catch (error) {
			exitCode = 1;
			log.error("WebUI shutdown failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		}
		try {
			stateWiring.dispose();
		} catch (error) {
			exitCode = 1;
			log.error("state wiring shutdown failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		}
		try {
			hookManager.dispose();
		} catch (error) {
			exitCode = 1;
			log.error("hook shutdown failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		}
		try {
			await bridgeManager.dispose();
		} catch (error) {
			exitCode = 1;
			log.error("bridge shutdown failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		}
		await closeLogger();
		process.exit(exitCode);
	};
	process.on("SIGINT", () => {
		shutdown("SIGINT");
	});
	process.on("SIGTERM", () => {
		shutdown("SIGTERM");
	});
	if (process.send) {
		process.on("message", (message) => {
			if (message === "shutdown") shutdown("launcher");
		});
		process.on("disconnect", () => {
			shutdown("launcher disconnected");
		});
		process.send("ready");
	}
}
function resolveAutoLoad(fromConfig) {
	const envRaw = process.env.SNOWLUMA_HOOK_AUTOLOAD;
	if (typeof envRaw === "string" && envRaw.trim()) {
		const v = envRaw.trim().toLowerCase();
		if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
		if (v === "0" || v === "false" || v === "no" || v === "off") return false;
	}
	return fromConfig === true;
}
if (isMessageStoreMigrationWorkerData(workerData)) runMessageStoreMigrationWorker(workerData).catch(() => {
	process.exitCode = 1;
});
else if (updateRoot && !process.env.SNOWLUMA_UPDATE_ROOT) runApplication(updateRoot);
else {
	installProcessGuards();
	main().catch(async (error) => {
		log.error(error instanceof Error ? error.stack ?? error.message : String(error));
		await closeLogger();
		process.exit(1);
	});
}
