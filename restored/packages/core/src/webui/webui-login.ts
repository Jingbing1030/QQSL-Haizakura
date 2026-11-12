function readString(value) {
	return typeof value === "string" ? value : "";
}
function completeWebuiLogin(auth, body, atMs) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "bad-request" };
	const record = body;
	const password = readString(record.password);
	if (!auth.verify(password)) return { kind: "bad-password" };
	const decision = decideSecondFactorLogin({
		totpEnabled: auth.totpEnabled(),
		state: auth.totpState(),
		password,
		totp: readString(record.totp) || void 0,
		recoveryCode: readString(record.recoveryCode) || void 0,
		atMs
	});
	if (decision.kind === "needs-totp") return { kind: "needs-totp" };
	if (decision.kind === "bad-second-factor") return { kind: "bad-second-factor" };
	return {
		kind: "ok",
		mustChangePassword: auth.mustChangePassword(),
		...decision.state ? { totpState: decision.state } : {}
	};
}
function invalidateOtherSessions(sessions, keepToken) {
	for (const token of sessions.keys()) if (token !== keepToken) sessions.delete(token);
}
