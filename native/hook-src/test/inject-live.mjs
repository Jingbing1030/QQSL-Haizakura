// Injects the payload into the live QQ and reports what the hook engine found.
//
// Two things are worth separating here. `loadModuleManualAsync` maps and starts the payload
// inside the target -- that is address-space work and it either works or the process is in
// trouble. What the payload *does* after starting is the interesting part: it scans
// wrapper.node's RTTI for the login class, hooks slot 11, and reports how many vtables it saw.
//
// The count matters because it is the difference between "the engine works" and "the engine
// works on a file but not on a live process". A zero would mean the scan ran but found
// nothing, which is a different failure from not running at all.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const addon = require(process.env.HZ_ADDON);
const pid = Number(process.env.HZ_PID);
const payload = process.env.HZ_PAYLOAD;

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

// Snapshot what the payload prints; its own diagnostics are the only view into the target.
const realStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  const s = String(chunk);
  if (s.includes("[payload]") || s.includes("[loader]")) log("target", s.trimEnd());
  return realStdout(chunk, ...rest);
};

log("probe", `injecting ${payload} into pid ${pid}`);

const handle = await addon.loadModuleManualAsync(pid, payload);
log("probe", `handle = ${JSON.stringify(handle)}`);

// Give the payload's own threads a moment to run their install pass.
await new Promise((r) => setTimeout(r, 3000));

// Ask the target what actually got mapped: is our payload there, and did it create sockets?
const fs = await import("node:fs");
const maps = fs.readFileSync(`/proc/${pid}/maps`, "utf8");
const payloadLines = maps.split("\n").filter((l) => l.includes("payload.so") || l.includes("memfd"));
log("probe", `payload mappings in target: ${payloadLines.length}`);
for (const l of payloadLines.slice(0, 4)) log("probe", "  " + l.trim());

const sockets = fs.readdirSync("/tmp").filter((f) => f.startsWith("mojo."));
log("probe", `sockets created: ${JSON.stringify(sockets)}`);

if (process.env.HZ_KEEP !== "1") {
  await addon.unloadModuleManualAsync(pid, handle);
  log("probe", "unloaded");
}