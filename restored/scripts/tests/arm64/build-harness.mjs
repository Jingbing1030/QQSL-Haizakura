// Truncate dist/index.mjs before the src/index.ts entry region, append the driver.
import { readFileSync, writeFileSync } from "node:fs";
const dist = readFileSync("/home/ubuntu/satori-transport-verify/dist/index.mjs", "utf8");
const marker = "//#region src/index.ts";
const at = dist.indexOf(marker);
if (at === -1) { console.error("entry region not found"); process.exit(1); }
const lineStart = dist.lastIndexOf("\n", at) + 1;
const head = dist.slice(0, lineStart);
const driver = readFileSync("/home/ubuntu/satori-transport-verify/arm64-driver-realws.mjs", "utf8");
writeFileSync("/home/ubuntu/satori-transport-verify/harness.mjs", head + "\n" + driver);
console.log("harness built: head lines =", head.split("\n").length - 1);
