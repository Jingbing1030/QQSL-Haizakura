var PRIVACY_WARNING = "WARNING: This export may contain unredacted private data and credentials. Sanitize it before submission.";
function buildFullTraceDownload(entries, metadata) {
	const timestamp = metadata.exportedAt.slice(0, 19).replace(/[:.]/g, "-");
	return {
		body: formatFullTraceExport(entries, metadata),
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Content-Disposition": `attachment; filename="snowluma-trace-${timestamp}.log"`,
			"Cache-Control": "no-store"
		}
	};
}
function formatFullTraceExport(entries, metadata) {
	const lines = [
		"SnowLuma full TRACE export",
		"==========================",
		`SnowLuma version: ${metadata.version}`,
		`Operating system: ${metadata.operatingSystem}`,
		`Architecture: ${metadata.architecture}`,
		`Node.js version: ${metadata.nodeVersion}`,
		`Current log level: ${metadata.logLevel.toUpperCase()}`,
		`Export time: ${metadata.exportedAt}`,
		`Retained records: ${entries.length}`,
		"",
		PRIVACY_WARNING,
		"This is a snapshot of the normal and TRACE records still retained in memory; records already evicted cannot be recovered.",
		"",
		"Logs",
		"----"
	];
	if (entries.length === 0) lines.push("(No log records are currently retained.)");
	else lines.push(...entries.map((entry) => entry.line));
	return `${lines.join("\n")}\n`;
}
