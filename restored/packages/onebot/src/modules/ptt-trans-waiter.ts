// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/modules/ptt-trans-waiter.ts"
// original bundle lines 39060-39097  (36 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var pending = /* @__PURE__ */ new Map();
function pttTransKey(selfUin, msgId) {
	if (typeof msgId === "number" && !Number.isSafeInteger(msgId)) throw new RangeError("PTT message id must be a safe integer or bigint");
	return selfUin + ":" + BigInt.asIntN(64, BigInt(msgId));
}
/** Register before triggering; only this request may settle its own response or timeout. */
function requestPttTransText(key, timeoutMs, trigger) {
	pending.get(key)?.reject(/* @__PURE__ */ new Error("语音转文字请求被新的请求取代"));
	return new Promise((resolve, reject) => {
		const settle = (finish) => {
			if (pending.get(key) !== waiter) return;
			clearTimeout(timer);
			pending.delete(key);
			finish();
		};
		const waiter = {
			resolve: (text) => settle(() => resolve(text)),
			reject: (error) => settle(() => reject(error))
		};
		const timer = setTimeout(() => {
			waiter.reject(/* @__PURE__ */ new Error("语音转文字超时（未收到结果推送）"));
		}, timeoutMs);
		timer.unref();
		pending.set(key, waiter);
		Promise.resolve().then(trigger).then((text) => {
			if (text) waiter.resolve(text);
		}, (error) => waiter.reject(error instanceof Error ? error : new Error(String(error))));
	});
}
/** QQ push results identify the account and message, not an individual trigger request. */
function deliverPttTransText(key, text) {
	const waiter = pending.get(key);
	if (!waiter) return false;
	waiter.resolve(text);
	return true;
}
export {};
