init_errors();
/** Parse-validate a cert/key pair (used by the save endpoint before writing). */
function validateTlsPair(cert, key) {
	if (!cert || !cert.toString().trim()) return {
		ok: false,
		reason: "certificate is empty"
	};
	if (!key || !key.toString().trim()) return {
		ok: false,
		reason: "private key is empty"
	};
	try {
		tls$1.createSecureContext({
			cert,
			key
		});
		return { ok: true };
	} catch (e) {
		return {
			ok: false,
			reason: `invalid cert/key: ${errorMessage(e)}`
		};
	}
}
/** Load + validate config/cert.pem + config/key.pem from `configDir`. */
function resolveTlsContext(configDir) {
	const certPath = path$1.join(configDir, "cert.pem");
	const keyPath = path$1.join(configDir, "key.pem");
	if (!fs$1.existsSync(certPath) || !fs$1.existsSync(keyPath)) return {
		ok: false,
		reason: "cert.pem or key.pem missing in config dir"
	};
	let cert;
	let key;
	try {
		cert = fs$1.readFileSync(certPath);
		key = fs$1.readFileSync(keyPath);
	} catch (e) {
		return {
			ok: false,
			reason: `failed to read cert/key: ${errorMessage(e)}`
		};
	}
	const valid = validateTlsPair(cert, key);
	if (!valid.ok) return {
		ok: false,
		reason: valid.reason
	};
	return {
		ok: true,
		cert,
		key
	};
}
/** Resolve the configured pair for an enabled listener or abort startup. */
function requireTlsContext(configDir) {
	const resolved = resolveTlsContext(configDir);
	if (!resolved.ok || !resolved.cert || !resolved.key) throw new Error(`TLS listener cannot start: ${resolved.reason ?? "certificate pair is unusable"}`);
	return {
		cert: resolved.cert,
		key: resolved.key
	};
}
