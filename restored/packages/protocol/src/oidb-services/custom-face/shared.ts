// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/oidb-services/custom-face/shared.ts"
// original bundle lines 319192-319211  (18 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** trpc service 名，sendRawPacket 的第一个参数。 */
var FACEROAM_SERVICE = "Faceroam.OpReq";
/** osVersion 字符串，Faceroam inner 与 0x902e 业务体 f2 共用。 */
var CLIENT_VERSION = "10.0.26200";
/** qqVersion on the Faceroam list inner. Keep the value list already sends. Delete omits this field. */
var LIST_QQ_VERSION = "9.9.28-46928";
/**
* 构造请求 inner（field1 客户端环境）。fetch 带 qqVersion，delete 不带——
* 这不是随手写的，是 wire dump 里两者 inner 长度差 14 字节的直接来源。
*/
function makeInner(withQqVersion) {
	const inner = {
		field1: 1,
		osVersion: CLIENT_VERSION
	};
	if (withQqVersion) inner.qqVersion = LIST_QQ_VERSION;
	return inner;
}
export {};
