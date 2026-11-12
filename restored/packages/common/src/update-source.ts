// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/update-source.ts"
// original bundle lines 197-222  (24 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function normalizeMirrorUrl(value) {
	if (typeof value !== "string" || value.length > 2048) throw new Error("镜像地址必须是 HTTP(S) URL");
	let url;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("镜像地址必须是 HTTP(S) URL");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("镜像地址仅支持 HTTP(S)，不能包含账号、密码、查询参数或片段");
	return url.href.replace(/\/+$/, "");
}
function normalizeUpdateSourceConfig(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("更新来源必须是对象");
	if (!("mode" in value) || value.mode !== "auto" && value.mode !== "direct" && value.mode !== "mirror") throw new Error("更新来源模式无效");
	if (!("mirrors" in value) || !Array.isArray(value.mirrors) || value.mirrors.length > 16) throw new Error("自动筛选最多支持 16 个镜像");
	const mirror = "mirror" in value && value.mirror !== "" ? normalizeMirrorUrl(value.mirror) : "";
	if (value.mode === "mirror" && !mirror) throw new Error("请指定镜像地址");
	return {
		mode: value.mode,
		mirror,
		mirrors: [...new Set(value.mirrors.map(normalizeMirrorUrl))]
	};
}
var init_update_source = __esmMin((() => {}));
export {};
