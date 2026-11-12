function isLoopbackBindHost(host) {
	const value = host?.trim().toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "") ?? "";
	if (!value) return false;
	if (value === "localhost" || value.endsWith(".localhost")) return true;
	return isLoopbackClientIp(value);
}
var OneBotAccessTokenPolicyError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "OneBotAccessTokenPolicyError";
	}
};
var INBOUND_KINDS = ["httpServers", "wsServers"];
function sameTokenAtPreviousIdentity(previous, next, nextName, nextToken, index) {
	const named = previous.find((adapter) => adapter.name === nextName);
	if (named && (named.accessToken ?? "") === nextToken) return true;
	const sameIndex = previous[index];
	return sameIndex !== void 0 && !next.some((adapter) => adapter.name === sameIndex.name) && (sameIndex.accessToken ?? "") === nextToken;
}
function validateOneBotAccessTokenChanges(previous, next, options) {
	const allowEmptyFromClient = isLoopbackClientIp(options.clientIp);
	for (const kind of INBOUND_KINDS) {
		const previousList = previous?.networks[kind] ?? [];
		const nextList = next.networks[kind];
		for (let index = 0; index < nextList.length; index += 1) {
			const adapter = nextList[index];
			const token = adapter.accessToken ?? "";
			if (sameTokenAtPreviousIdentity(previousList, nextList, adapter.name, token, index)) continue;
			if (!token) {
				if (!allowEmptyFromClient && !isLoopbackBindHost(adapter.host)) throw new OneBotAccessTokenPolicyError(`节点“${adapter.name}”未绑定本机地址，远程保存必须填写令牌；请生成令牌或将主机改为 127.0.0.1。`);
				continue;
			}
			const host = adapter.host ?? "0.0.0.0";
			const assessment = assessAccessToken(token, [
				options.uin,
				adapter.name,
				kind,
				host,
				adapter.port
			]);
			if (assessment.reason === "too-short") throw new OneBotAccessTokenPolicyError(`节点“${adapter.name}”的令牌至少需要 16 个字符；请重新生成或继续补充。`);
			if (!assessment.acceptable) throw new OneBotAccessTokenPolicyError(`节点“${adapter.name}”的令牌容易被猜中；请重新生成随机令牌。`);
		}
	}
}
