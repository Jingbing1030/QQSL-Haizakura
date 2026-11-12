var LOGIN_BODY_LIMIT_BYTES = 16 * 1024;
var AVATAR_SESSION_COOKIE = "snowluma_avatar_session";
var AVATAR_SESSION_MAX_AGE_SECONDS = 1440 * 60;
function isJsonMediaType(value) {
	const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return mediaType === "application/json" || mediaType.endsWith("+json");
}
/** Install guards before the login route is registered. */
function registerLoginRequestSecurity(app) {
	app.use("/api/login", bodyLimit({
		maxSize: LOGIN_BODY_LIMIT_BYTES,
		onError: (c) => c.json({
			success: false,
			message: "请求体过大"
		}, 413)
	}));
	app.use("/api/login", async (c, next) => {
		if (!isJsonMediaType(c.req.header("content-type"))) return c.json({
			success: false,
			message: "Content-Type 必须为 application/json"
		}, 415);
		return next();
	});
}
/** Minimal response policy that does not restrict the current script/style bundle. */
var webuiSecurityHeaders = async (c, next) => {
	await next();
	c.res.headers.set("X-Frame-Options", "DENY");
	c.res.headers.set("X-Content-Type-Options", "nosniff");
	c.res.headers.set("Referrer-Policy", "no-referrer");
	c.res.headers.set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
};
function extractWebuiSessionToken(request) {
	const sessionToken = request.headers.get("x-snowluma-token");
	if (sessionToken !== null) return sessionToken;
	const authorization = request.headers.get("authorization");
	return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}
var avatarCookieOptions = (secure) => ({
	httpOnly: true,
	sameSite: "Strict",
	secure,
	path: "/avatar"
});
function setAvatarSessionCookie(c, token, secure) {
	setCookie(c, AVATAR_SESSION_COOKIE, token, {
		...avatarCookieOptions(secure),
		maxAge: AVATAR_SESSION_MAX_AGE_SECONDS
	});
}
function clearAvatarSessionCookie(c, secure) {
	deleteCookie(c, AVATAR_SESSION_COOKIE, avatarCookieOptions(secure));
}
function readAvatarSessionToken(c) {
	return getCookie(c, AVATAR_SESSION_COOKIE) ?? "";
}
