/** TCP bind-host accepted by WebUI Listener Exposure (settings, restore, boot). */
function isValidBindHost(value) {
	const host = value.trim();
	if (!host || host !== value || host.length > 253 || /[\s/?#@]/u.test(host)) return false;
	if (host.includes(":")) return isIP(host) === 6;
	if (/^[\d.]+$/.test(host)) return isIP(host) === 4;
	return (host.endsWith(".") ? host.slice(0, -1) : host).split(".").every((label) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(label));
}
function checkListenerExposure(input) {
	if (!isValidBindHost(input.webuiHost)) return {
		ok: false,
		code: "invalid-bind-host"
	};
	if (input.tlsEnabled && !input.pairOk) return {
		ok: false,
		code: "tls-pair-required"
	};
	return { ok: true };
}
