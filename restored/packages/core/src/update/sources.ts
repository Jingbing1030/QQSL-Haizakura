init_runtime();
init_update_source();
var RELEASE_ROOT = "https://github.com/SnowLuma/SnowLuma/releases";
var DEFAULT_UPDATE_SOURCE = {
	mode: "auto",
	mirror: "",
	mirrors: [
		"https://ghfast.top",
		"https://ghproxy.net",
		"https://gh-proxy.com",
		"https://github.chenc.dev",
		"https://fastgit.cc",
		"https://gh.noki.icu",
		"https://cors.isteed.cc",
		"https://gh-proxy.org",
		"https://githubproxy.gohj99.site",
		"https://github.xxlab.tech"
	]
};
function readUpdateSource() {
	return normalizeUpdateSourceConfig(readRuntimeConfig().updateSource ?? DEFAULT_UPDATE_SOURCE);
}
function saveUpdateSource(value) {
	const config = normalizeUpdateSourceConfig(value);
	updateRuntimeConfig({ updateSource: config });
	return config;
}
function sourceUrls(url, config) {
	if (config.mode === "direct") return [url];
	if (config.mode === "mirror") return [`${config.mirror}/${url}`];
	return [url, ...config.mirrors.map((mirror) => `${mirror}/${url}`)];
}
async function testUpdateSources(value) {
	const config = normalizeUpdateSourceConfig(value);
	const mirrors = [.../* @__PURE__ */ new Set([
		"",
		...config.mirrors,
		...config.mirror ? [config.mirror] : []
	])];
	const target = process.platform === "win32" ? "win-x64" : `linux-${process.arch}`;
	const extension = process.platform === "win32" ? "zip" : "tar.gz";
	const probeUrl = `${RELEASE_ROOT}/download/v${APP_VERSION}/SnowLuma-v${APP_VERSION}-${target}-lite.${extension}`;
	return (await Promise.all(mirrors.map(async (mirror) => {
		const start = performance.now();
		try {
			const response = await fetch(mirror ? `${mirror}/${probeUrl}` : probeUrl, {
				headers: { Range: "bytes=0-3" },
				signal: AbortSignal.timeout(5e3)
			});
			if (!response.ok || !response.body) {
				await response.body?.cancel();
				throw new Error(`HTTP ${response.status}`);
			}
			if (/text\/html/i.test(response.headers.get("content-type") ?? "")) {
				await response.body.cancel();
				throw new Error("返回了 HTML 页面，而不是更新包");
			}
			const reader = response.body.getReader();
			const prefix = [];
			try {
				while (prefix.length < 4) {
					const { value, done } = await reader.read();
					if (done) break;
					prefix.push(...value.subarray(0, 4 - prefix.length));
				}
			} finally {
				await reader.cancel();
				reader.releaseLock();
			}
			if (!(extension === "zip" ? [
				80,
				75,
				3,
				4
			] : [31, 139]).every((byte, index) => prefix[index] === byte)) throw new Error("返回内容不是有效的更新包");
			return {
				mirror,
				available: true,
				latencyMs: Math.round(performance.now() - start)
			};
		} catch (error) {
			return {
				mirror,
				available: false,
				latencyMs: Math.round(performance.now() - start),
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}))).sort((a, b) => Number(b.available) - Number(a.available) || a.latencyMs - b.latencyMs);
}
