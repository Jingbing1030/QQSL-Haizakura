// RTTI/vtable lookup tests.
//
// The valuable assertions here are the ones that compare against the C++ engine's answer for
// the same file: the addresses were independently derived (that implementation scans with
// mmap and its own demangler), so agreement is real evidence rather than a tautology.
//
// The real-wrapper test is skipped when the file is absent, because it is a 144 MB artifact
// that only exists on a machine that has a QQ client -- but when it is present this is the
// only test that proves the scan works on a binary with 13261 vtables rather than on a toy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { parseElf, listVtables, findVtablesByClass, primaryVtable, demangle, ElfError } from "../src/rtti.js";

const REAL_WRAPPER = process.env.HZ_WRAPPER ?? "/home/ubuntu/hzwork/wrapper-arm64.node";
const haveReal = existsSync(REAL_WRAPPER);

test("demangles a nested class name", () => {
  assert.equal(demangle("2nt5login22QRCodeLoginRequestImpl"), "nt::login::QRCodeLoginRequestImpl");
  assert.equal(demangle("2nt10MSFService"), "nt::MSFService");
  assert.equal(demangle("2nt14MSFCoreService"), "nt::MSFCoreService");
});

test("demangler refuses what it does not implement instead of guessing", () => {
  // A wrong demangle would silently match the wrong class, which is worse than a failure:
  // a partial read like "nt" would look like a valid class and match nothing, or worse,
  // match the wrong one.
  assert.throws(() => demangle("St6vectorIiSaIiEE"), ElfError);  // template, not implemented
  assert.throws(() => demangle("2nt"), ElfError);                // truncated component
  assert.throws(() => demangle(""), ElfError);
});

test("rejects a file that is not ELF", async () => {
  await assert.rejects(() => parseElf("/etc/hostname"), ElfError);
});

test("parses the real wrapper.node and finds the login class at the expected address", { skip: haveReal ? false : "no wrapper.node on this machine" }, async () => {
  const info = await parseElf(REAL_WRAPPER);
  assert.ok(info.machine === 183 || info.machine === 62, `unexpected machine ${info.machine}`);

  const all = await listVtables(REAL_WRAPPER, info);
  assert.ok(all.length > 10000, `expected thousands of vtables, got ${all.length}`);

  const hits = findVtablesByClass(all, "nt::login::QRCodeLoginRequestImpl");
  assert.equal(hits.length, 3, "the login class has three subobject vtables");

  const primary = primaryVtable(all, "nt::login::QRCodeLoginRequestImpl");
  assert.ok(primary, "primary vtable resolved");

  // These are the addresses the C++ engine reported for the same file. They are not
  // decorative: slot 11 of this table is selfInfoOnLoginSuccess, the function the payload
  // hooks, so if the scan picked a different table the hook would target the wrong code.
  assert.equal(primary.address, 0x8714228, "primary vtable address");
  assert.equal(primary.slots, 24, "primary vtable slot count");
  assert.equal(primary.typeinfo, 0x8714390, "type_info address");

  // The other two are base subobjects and are shorter; one of them cannot even hold slot 11,
  // which is why "longest" is the right discriminator rather than "first".
  const others = hits.filter((v) => v.address !== primary.address).map((v) => v.slots).sort((a, b) => a - b);
  assert.deepEqual(others, [6, 11], "base subobject slot counts");
  assert.ok(Math.max(...others) <= 11, "no base subobject can hold slot 11");
});

test("finds the MSF services the hook engine needs", { skip: haveReal ? false : "no wrapper.node on this machine" }, async () => {
  const info = await parseElf(REAL_WRAPPER);
  const all = await listVtables(REAL_WRAPPER, info);

  // Cross-checked against docs/vtable-slots.md, which was reverse-engineered by a different
  // route (call-graph analysis of the disassembly).
  const msf = findVtablesByClass(all, "nt::MSFService");
  assert.equal(msf.length, 5, "MSFService vtable count");
  assert.deepEqual(msf.map((v) => v.address).sort((a, b) => a - b),
    [0x87173e8, 0x8717558, 0x8717750, 0x87177a8, 0x87177c0].sort((a, b) => a - b));

  const core = findVtablesByClass(all, "nt::MSFCoreService");
  assert.equal(core.length, 6, "MSFCoreService vtable count");
});

test("a class that does not exist resolves to nothing rather than to a near match", { skip: haveReal ? false : "no wrapper.node on this machine" }, async () => {
  const info = await parseElf(REAL_WRAPPER);
  const all = await listVtables(REAL_WRAPPER, info);
  assert.equal(primaryVtable(all, "nt::DoesNotExist"), null);
  // A prefix of a real class name must match nothing: this class does exist
  // (nt::login::QRCodeLoginRequest, one slot), so the assertion is that a *near* name
  // does not resolve to it by substring accident.
  assert.deepEqual(findVtablesByClass(all, "nt::login::QRCodeLoginReques"), []);
});

test("scan is deterministic across two runs", { skip: haveReal ? false : "no wrapper.node on this machine" }, async () => {
  // A scan whose output depends on iteration order would make the install path flaky in a
  // way that only shows up on some machines.
  const info = await parseElf(REAL_WRAPPER);
  const a = await listVtables(REAL_WRAPPER, info);
  const b = await listVtables(REAL_WRAPPER, info);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i]!.address, b[i]!.address);
    assert.equal(a[i]!.className, b[i]!.className);
  }
});