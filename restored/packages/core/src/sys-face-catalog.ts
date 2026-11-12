init_logger();
var log$2 = createLogger("SysFace");
/** Attach the shared system-face catalog to Bridge login edges. The first
* account restores + refreshes it; later accounts reuse the same result. */
function bindSystemFaceCatalog(manager, options = {}) {
	const store = options.store ?? sysFaceStore;
	const storage = options.storage ?? new JsonSysFaceCatalogStorage(path.join(options.dataRoot ?? "data", "sys-face-catalog.json"));
	store.configureStorage(storage);
	manager.subscribeSessions({ started: (uin, bridge) => {
		store.prewarm(bridge).catch((error) => {
			log$2.error("system face catalog login prewarm failed: uin=%s error=%s", uin, error instanceof Error ? error.stack ?? error.message : String(error));
		});
	} });
}
