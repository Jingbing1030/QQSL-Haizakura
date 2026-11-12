// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/qzone-feed-cursor.ts"
// original bundle lines 335500-335587  (86 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var numericFields = [
	"begintime",
	"dayspac",
	"pagenum",
	"aisortEndTime",
	"aisortOffset",
	"aisortBeginTime",
	"aisortNextTime",
	"icServerTime"
];
var stringFields = [
	"externparam",
	"daylist",
	"uinlist"
];
var fields = [...numericFields, ...stringFields];
function initialQzoneFeedState() {
	return {
		begintime: "0",
		dayspac: "0",
		pagenum: "1",
		aisortEndTime: "0",
		aisortOffset: "0",
		aisortBeginTime: "0",
		aisortNextTime: "0",
		icServerTime: "0",
		externparam: "",
		daylist: "",
		uinlist: ""
	};
}
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Carry forward the fields used by the web client, including opaque server state. */
function nextQzoneFeedState(main, previous) {
	const next = { ...previous };
	for (const field of numericFields) {
		const value = main[field];
		if (value === void 0 || value === "") continue;
		if (typeof value !== "number" && typeof value !== "string" || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || field === "pagenum" && Number(value) < 1) throw new Error(`空间好友动态分页字段异常: ${field}`);
		next[field] = String(Number(value));
	}
	for (const field of stringFields) {
		const value = main[field];
		if (value === void 0 || value === "" && field !== "uinlist") continue;
		if (typeof value !== "string" || value.length > 32768) throw new Error(`空间好友动态分页字段异常: ${field}`);
		next[field] = value;
	}
	return next;
}
/** The server clock alone does not constitute pagination progress. */
function qzoneFeedPosition(state) {
	return JSON.stringify(fields.filter((field) => field !== "icServerTime").map((field) => state[field]));
}
function encodeQzoneFeedCursor(uin, page, state) {
	if (!Number.isSafeInteger(page) || page < 2) throw new Error("空间好友动态分页页码超出范围");
	const cursor = Buffer.from(JSON.stringify({
		version: 1,
		uin,
		page,
		state
	})).toString("base64url");
	if (cursor.length > 65536) throw new Error("空间好友动态分页游标过大");
	return cursor;
}
function decodeQzoneFeedCursor(cursor, uin) {
	if (!cursor || cursor.length > 65536 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("无效的空间好友动态 cursor");
	let value;
	try {
		const bytes = Buffer.from(cursor, "base64url");
		if (bytes.toString("base64url") !== cursor) throw new Error("non-canonical encoding");
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("无效的空间好友动态 cursor");
	}
	if (!record(value) || value.version !== 1 || value.uin !== uin || typeof value.page !== "number" || !Number.isSafeInteger(value.page) || value.page < 2 || !record(value.state)) throw new Error("空间好友动态 cursor 无效或不属于当前账号");
	const rawState = value.state;
	if (Object.keys(rawState).length !== fields.length || !fields.every((field) => typeof rawState[field] === "string")) throw new Error("无效的空间好友动态 cursor 状态");
	const state = nextQzoneFeedState(rawState, initialQzoneFeedState());
	if (fields.some((field) => state[field] !== rawState[field])) throw new Error("无效的空间好友动态 cursor 状态");
	return {
		page: value.page,
		state
	};
}
export {};
