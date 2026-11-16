# Changelog


## 2.0.0

### Upgrading

- The minimum runtime is now Node.js 24. The full build bundles Node.js; Lite, SDK and MCP users must upgrade their runtime first.
- Native interfaces are now fully asynchronous, so the application and the native artifacts must be updated as a matched set; use the full release package for your platform.

### Changes

- Added local QQ account detection, process-state diagnostics and ordered account notifications.
- The WebUI can now stage updates and install them on restart while preserving configuration, logs and message data.
- Added group share links, Qzone post details and paginated comments, with matching SDK types and MCP action catalog entries.
- Improved merged-forward quote previews, group album comments, SILK duration and Highway node rotation.
- Tidied the ordering of native calls, SQLite access, account shutdown and reconnection, and fixed request cancellation, subscription and timer release.
- Reduced idle polling in the WebUI and fixed reverse-proxy authentication and version comparison.

[View the full diff since v1.14.22](https://github.com/Haizakura/Haizakura/compare/v1.14.22...dev)
