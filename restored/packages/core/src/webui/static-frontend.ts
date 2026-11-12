/** All document entry paths share runtime injection, including direct index.html requests. */
function registerStaticFrontend(app, root, target) {
	const indexPath = path.join(root, "index.html");
	const document = (c) => {
		if (!existsSync(indexPath)) return c.text("WebUI client bundle not found. Run `pnpm --filter webui build` (or use the dev server on :5178).", 404);
		c.header("Cache-Control", "no-store");
		return c.html(injectWebuiTarget(readFileSync(indexPath, "utf8"), target));
	};
	app.get("/", document);
	app.get("/index.html", document);
	app.use("/*", serveStatic({ root }));
	app.get("*", (c) => {
		if ([
			"/api/",
			"/avatar/",
			"/ui-asset/"
		].some((prefix) => c.req.path.startsWith(prefix))) return c.text("not found", 404);
		return document(c);
	});
}
