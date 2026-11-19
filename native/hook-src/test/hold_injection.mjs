// Injects the payload and holds the mapping until killed, so a separate process can talk to the
// sockets it creates.
//
// It exists because the payload only lives while the injector holds it: the instant this process
// exits, unload runs and the sockets go away.  A handshake test in another process therefore needs
// this one parked in the foreground.
//
// Args, all through the environment because `node file.mjs` plus env is unambiguous where
// `node -e` shifts argv:
//   HZ_ADDON   path to the addon .node
//   HZ_PID     target pid
//   HZ_PAYLOAD path to the payload .so
// Prints "READY base=0x..." once mapped, then waits for SIGTERM/SIGINT to unload cleanly.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HZ_ADDON, HZ_PID, HZ_PAYLOAD } = process.env;
if (!HZ_ADDON || !HZ_PID || !HZ_PAYLOAD) {
  console.error("set HZ_ADDON, HZ_PID and HZ_PAYLOAD");
  process.exit(2);
}

const addon = require(HZ_ADDON);
const pid = Number(HZ_PID);
const handle = await addon.loadModuleManualAsync(pid, HZ_PAYLOAD);
// stdout is what the caller parses for readiness; the addon's own messages do not go there.
console.log(`READY base=0x${handle.base.toString(16)}`);

const shutdown = async () => {
  await addon.unloadModuleManualAsync(pid, handle).catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// Stay alive.  Not `await new Promise(() => {})`: a promise that never settles makes Node report
// "Detected unsettled top-level await" and exit, which unloads the mapping it was supposed to
// hold.  An interval with no work keeps the event loop referenced without that warning.
setInterval(() => {}, 1 << 30);
