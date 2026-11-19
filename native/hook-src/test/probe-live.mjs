// Read-only probe against a live QQ.
//
// Deliberately does not inject. The addon's own target-resolution path is a read: it parses
// wrapper.node out of the file and reports which vtables it found and where. Running that
// against the real client answers the question the static analysis could not -- whether the
// class names survive into the shipped binary in the shape the scanner expects -- without
// touching the address space of a process somebody is using.
//
// Only if this agrees with the file-based result is injection worth doing.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const addonPath = process.env.HZ_ADDON;
const pid = Number(process.env.HZ_PID);
const wrapperPath = process.env.HZ_WRAPPER ?? "/opt/QQ/resources/app/wrapper.node";

if (!addonPath || !pid) {
  console.error("usage: HZ_ADDON=<addon.node> HZ_PID=<qq pid> node probe-live.mjs");
  process.exit(2);
}

const addon = require(addonPath);

console.log("exports:", Object.keys(addon).sort().join(", "));

// The addon exposes a read-only target resolution entry point. It is the same one the
// payload uses at load, minus the write.
const resolve = addon.resolveRuntimeTargetsAsync;
if (typeof resolve !== "function") {
  console.error("addon has no resolveRuntimeTargetsAsync; cannot probe without injecting");
  process.exit(3);
}

const targets = await resolve(pid);
console.log("resolved:", JSON.stringify(targets, null, 2));

// Cross-check: is the module the addon found the same file the scanner reads?
const fs = await import("node:fs");
const stat = fs.statSync(wrapperPath);
console.log(`wrapper.node on disk: ${stat.size} bytes`);