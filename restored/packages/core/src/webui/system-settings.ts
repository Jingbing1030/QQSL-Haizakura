init_coerce();
function coerceSettingsPatch(body) {
	if (!isObject$5(body)) return {
		ok: false,
		error: "body must be an object"
	};
	const patch = {};
	if ("webuiPort" in body) {
		const p = body.webuiPort;
		if (typeof p !== "number" || !Number.isInteger(p) || p <= 0 || p > 65535) return {
			ok: false,
			error: "webuiPort must be an integer in 1..65535"
		};
		patch.webuiPort = p;
	}
	if ("webuiHost" in body) {
		if (typeof body.webuiHost !== "string" || !body.webuiHost.trim()) return {
			ok: false,
			error: "webuiHost must be a non-empty string"
		};
		patch.webuiHost = body.webuiHost.trim();
	}
	if ("tlsEnabled" in body) {
		if (typeof body.tlsEnabled !== "boolean") return {
			ok: false,
			error: "tlsEnabled must be a boolean"
		};
		patch.webuiTls = { enabled: body.tlsEnabled };
	}
	if ("trustProxy" in body) {
		if (typeof body.trustProxy !== "string") return {
			ok: false,
			error: "trustProxy must be a string"
		};
		patch.trustProxy = body.trustProxy;
	}
	return {
		ok: true,
		patch
	};
}
var SETTINGS_ERRORS = {
	"invalid-bind-host": "绑定地址不是有效的 TCP 地址",
	"tls-pair-required": "启用 TLS 前请先上传有效的证书与私钥"
};
/** Validate the listener that would be persisted after applying `patch` to `current`. */
function evaluateSettingsSave(current, patch, pairOk) {
	const check = checkListenerExposure({
		webuiHost: patch.webuiHost ?? current.webuiHost ?? "127.0.0.1",
		tlsEnabled: patch.webuiTls?.enabled ?? current.webuiTls?.enabled ?? false,
		pairOk
	});
	if (!check.ok) return {
		ok: false,
		error: SETTINGS_ERRORS[check.code]
	};
	return {
		ok: true,
		patch
	};
}
function tlsCertDeletionBlocked(tlsEnabled) {
	return tlsEnabled;
}
