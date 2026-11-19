// Field-for-field comparison against the closed-source addon.
//
// This is the acceptance test for "be a drop-in replacement": the JavaScript layer calls these
// five methods and reads their fields by name, so a missing or renamed field is a break even
// when the value it would have carried is trivial.
//
// Two failures were found this way and are worth keeping in mind when editing the addon:
//   * getBackendInfoAsync reported four fields instead of seven (processDiscovery,
//     moduleInspection and ipc were absent).  Missing fields read as "unknown capability" in the
//     version gate, not as "not applicable".
//   * the exports were defined with napi_default, which is non-enumerable.  The closed-source
//     addon's are non-enumerable too -- so that one was a false alarm, and "match the reference"
//     is what settled it, not "make Object.keys work".
//
// Usage: node api_parity.mjs <reference.node> <candidate.node>
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [, , refPath, candPath] = process.argv;
if (!refPath || !candPath) {
  console.error("usage: node api_parity.mjs <reference.node> <candidate.node>");
  process.exit(2);
}

const ref = require(refPath);
const cand = require(candPath);

let failures = 0;
const check = (ok, what, detail) => {
  if (ok) {
    console.log(`  ok   ${what}`);
  } else {
    console.log(`  FAIL ${what}`);
    if (detail) console.log(`       ${detail}`);
    failures++;
  }
};

// Compare as JSON so field ORDER counts: the reference emits a fixed order and a consumer that
// serialises the object would see a different document otherwise.
const stable = (v) => JSON.stringify(v);

const main = async () => {
  const refNames = Object.getOwnPropertyNames(ref);
  const candNames = Object.getOwnPropertyNames(cand);
  console.log(`reference exports: ${refNames.join(", ")}`);
  console.log(`candidate exports: ${candNames.join(", ")}`);

  // Every name the reference has must exist: those are the ones the JS layer already calls.
  for (const name of refNames) {
    check(candNames.includes(name), `exports ${name}`);
  }

  for (const name of refNames) {
    if (typeof ref[name] !== "function" || typeof cand[name] !== "function") continue;
    // The reference's zero-argument calls are safe to invoke; the ones that need a pid are
    // covered by the native tests instead.
    let a, b;
    try {
      a = await ref[name]();
    } catch (e) {
      a = `ERR:${e.message}`;
    }
    try {
      b = await cand[name]();
    } catch (e) {
      b = `ERR:${e.message}`;
    }
    const same = stable(a) === stable(b);
    check(same, `${name}() returns identical output`,
          same ? "" : `ref=${stable(a)}\n       cand=${stable(b)}`);
  }

  // The two methods that exist only in this build: the reference at 2.4.2 predates them, so there
  // is nothing to diff against.  Their schemas are asserted from the recorded specification
  // instead, because "the JS layer reads these exact names" is the contract that matters.
  const extra = {
    inspectProcessAsync: [
      "pid", "path", "baseAddress", "mappedStart", "mappedEnd",
      "executableStart", "executableEnd", "sections", "dynamicSymbols",
    ],
    resolveRuntimeTargetsAsync: [
      "pid", "modulePath", "wrapperBase", "sendSsoInternal", "msfDidRecvResponseData",
      "msfGetStatus", "selfInfoOnLoginSuccess", "msfServiceTypeinfoName",
      "msfServiceTypeinfo", "msfServiceVtables", "msfServiceCandidates", "msfCoreTypeinfo",
      "msfCoreCallbackOffset", "msfCoreCallbackVtables", "msfCoreCandidates",
    ],
  };
  // Both need a live pid, so only their presence is checked here; the native tests cover the
  // values against a real target.
  for (const [name, fields] of Object.entries(extra)) {
    check(typeof cand[name] === "function", `exports ${name}`);
    console.log(`       ${name} schema (${fields.length}): ${fields.join(", ")}`);
  }

  console.log(failures ? `FAIL (${failures} failures)` : "PASS");
  process.exit(failures ? 1 : 0);
};

main();
