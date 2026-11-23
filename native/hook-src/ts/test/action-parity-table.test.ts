// Per-action differential table: this port's registry vs. the reference bundle's own.
//
// ---------------------------------------------------------------------------
// What this file measures, and against what
// ---------------------------------------------------------------------------
// The claim under audit is: 222 reference definitions / 228 executable names /
// 12 categories, and the port's registry covers all of them.
//
// Both sides are walked as DATA, not as a list somebody retyped:
//
//   reference — `helpers/actions-oracle.ts` evaluates the action regions of
//               `reference/index.mjs`, and the 12 category labels are parsed out
//               of the bundle's own `var ACTION_GROUPS = [...]` block
//               (reference:21316-21365). Nothing on the reference side is typed here
//               except the mapping from the bundle's local variable names
//               (`actions$13`, `actions$4`, ...) to the oracle's exported arrays —
//               that mapping is exactly what the oracle's own `return {...}` object
//               states at its end, and it is asserted implicitly by the 222/228
//               totals below.
//
//   port      — `actionRegistry.executableNames` / `.actions` / `.categories`,
//               which are the compiled registry itself.
//
// ---------------------------------------------------------------------------
// Why the category labels are PARSED and not compared to a constant
// ---------------------------------------------------------------------------
// Comparing the port's labels to a hand-written copy of the reference's labels
// would pass by construction. Parsing the bundle is what lets this file report the
// one divergence it actually found: the bundle spells the extended family's
// category 扩展 (simplified), the port spells it 擴展 (traditional). That is a doc
// field, not a routing field (see the header of `src/onebot/actions/index.ts`), so it
// is REPORTED below rather than asserted away — the audited claim is about counts and
// name coverage, and weakening any of the five required assertions to hide a label
// difference would be exactly the failure mode the brief warns about.
//
// ---------------------------------------------------------------------------
// Regenerating `docs/action-parity-table.md`
// ---------------------------------------------------------------------------
// This file is also the generator, so there is no third file to drift. With
// ACTION_PARITY_EMIT=1 it prints ONLY the markdown and registers no tests:
//
//   cd ts && npx tsc -p tsconfig.json
//   cd ts && ACTION_PARITY_EMIT=1 node build/test/action-parity-table.test.js \
//     > ../docs/action-parity-table.md
//
// Without the variable it runs as a normal test (and prints the same table).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadActionOracle, type OracleActions, type ReferenceAction } from "./helpers/actions-oracle.js";
import { actionRegistry, ACTION_GROUPS } from "../src/onebot/actions/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The oracle resolves the bundle by trying two depths because the source
 * (`ts/test/`) and compiled (`ts/build/test/`) layouts differ by one. This file needs
 * the same file for a DIFFERENT reason — to read the `ACTION_GROUPS` block — and it
 * cannot borrow the oracle's private constant without editing a file the brief says
 * not to touch. So the same two candidates are tried here, in the same order, and a
 * miss is a hard error: an unreadable bundle must fail, never silently skip.
 */
function findReferenceBundle(): string {
  const candidates = [
    join(HERE, "..", "..", "reference", "index.mjs"), // ts/test → repo
    join(HERE, "..", "..", "..", "reference", "index.mjs"), // ts/build/test → repo
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    `reference bundle not found; tried:\n  ${candidates.join("\n  ")}\n` +
      "The parity table is measured against reference/index.mjs and must not skip when it is absent.",
  );
}

const REFERENCE_PATH = findReferenceBundle();

/**
 * The six aliases the port documents. The set is asserted for equality in BOTH
 * directions: an extra alias in the registry fails, and a documented alias with no
 * implementation fails. Which definition each one aliases is NOT typed here — it is
 * read from the oracle (`names[0]`), so a wrong target is caught too.
 */
const DOCUMENTED_ALIASES = [
  "get_ptt_text",
  "get_record_text",
  "nc_get_rkey",
  ".ocr_image",
  "send_group_sign",
  ".send_packet",
] as const;

const DOCUMENTED_ALIAS_SET: ReadonlySet<string> = new Set(DOCUMENTED_ALIASES);

/**
 * `var ACTION_GROUPS = [ { category: "信息", actions: actions$13 }, ... ]`
 *
 * Sliced out of the bundle's `../onebot/src/actions/index.ts` region. The object
 * literals in that block are flat (`category` and `actions` only) and the `actions`
 * expression never contains a `}`, so a non-greedy match up to the first `}` is safe —
 * the 12/222/228 cross-check below is what proves the parse did not silently miss a
 * group.
 */
function referenceCategoryGroups(): Array<{ label: string; expression: string }> {
  const source = readFileSync(REFERENCE_PATH, "utf8");
  const start = source.indexOf("var ACTION_GROUPS = [");
  if (start < 0) throw new Error("reference bundle has no `var ACTION_GROUPS = [` block");
  const end = source.indexOf("\n];", start);
  if (end < 0) throw new Error("reference bundle's ACTION_GROUPS block is unterminated");
  const block = source.slice(start, end);

  const groups: Array<{ label: string; expression: string }> = [];
  // The `actions` value is OPTIONAL: the 系统表情 group uses ES object shorthand
  // (`{ category: "系统表情", actions }`), because the family's array is literally
  // named `actions`. A regex requiring `actions:` would silently drop that group and
  // report 11 categories instead of 12 — which is exactly what the count assertion
  // below caught on the first run.
  const pattern = /\{\s*category:\s*"([^"]+)",\s*actions(?::\s*([\s\S]*?))?\s*\}/g;
  for (const match of block.matchAll(pattern)) {
    // Shorthand form: the expression is the identifier itself.
    const expression = (match[2] ?? "actions").replace(/\s+/g, " ").trim();
    groups.push({ label: match[1]!, expression });
  }
  if (groups.length === 0) throw new Error("parsed zero category groups out of the reference bundle");
  return groups;
}

/**
 * The bundle's local action-array names → the oracle's exported arrays.
 *
 * Read off the oracle's own `return { info: actions$13, ... }`, so this is a
 * transcription of a mapping that already exists, not a claim about the bundle.
 */
function oracleBindings(oracle: OracleActions): Record<string, readonly ReferenceAction[]> {
  return {
    "actions$13": oracle.info,
    "actions$12": oracle.message,
    "actions$11": oracle.friend,
    "actions$10": oracle.groupInfo,
    "actions$9": oracle.groupAdmin,
    "actions$8": oracle.groupFile,
    "actions$7": oracle.request,
    "actions$6": oracle.extended,
    "actions$5": oracle.groupAlbum,
    "actions$4": oracle.qzone,
    "actions$3": oracle.qzonePublic,
    "actions$2": oracle.streamFile,
    "actions$1": oracle.streamDownload,
    actions: oracle.systemFace,
  };
}

/** Resolve one `actions` expression (`actions$13` or `[...actions$4, ...actions$3]`). */
function resolveExpression(
  expression: string,
  bindings: Record<string, readonly ReferenceAction[]>,
  label: string,
): ReferenceAction[] {
  const out: ReferenceAction[] = [];
  for (const rawToken of expression.split(",")) {
    // Trim BEFORE stripping the spread: the second token of `[...a, ...b]` is
    // ` ...b]`, and a leading space would defeat an anchored `^\.\.\.`.
    const token = rawToken.trim().replace(/[\[\]]/g, "").replace(/^\.\.\./, "").trim();
    const bound = bindings[token];
    if (!bound) throw new Error(`category "${label}": reference expression references unknown array ${token}`);
    out.push(...bound);
  }
  return out;
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const listOrNone = (values: readonly string[]): string => (values.length === 0 ? "(none)" : values.join(", "));

interface CategoryRow {
  readonly index: number;
  readonly refLabel: string;
  readonly portLabel: string;
  readonly refActions: readonly ReferenceAction[];
  readonly portNames: readonly string[];
}

interface Measurement {
  readonly oracle: OracleActions;
  readonly rows: readonly CategoryRow[];
  readonly refDefinitions: number;
  readonly refNames: number;
  readonly portDefinitions: number;
  readonly portNames: number;
  readonly missingDefinitions: string[];
  readonly kindMismatches: string[];
  readonly missingNames: string[];
  readonly extraNames: string[];
  readonly refAliases: string[];
  readonly portAliases: string[];
  readonly undeclaredAliases: string[];
  readonly aliasRoleMismatches: string[];
  readonly aliasTargetMismatches: string[];
  readonly unimplementedAliases: string[];
  readonly categoryCountMismatches: string[];
  readonly categoryLabelMismatches: string[];
  readonly emptyCategories: string[];
}

/** Walk BOTH sides once; every assertion and the markdown renderer read this. */
function measure(): Measurement {
  const oracle = loadActionOracle();
  const bindings = oracleBindings(oracle);
  const refGroups = referenceCategoryGroups();
  const refRows = refGroups.map(({ label, expression }, index) => ({
    index,
    label,
    actions: resolveExpression(expression, bindings, label),
  }));

  const portRows = ACTION_GROUPS.map(({ category, actions }, index) => ({
    index,
    label: category,
    actions,
    names: actions.flatMap((spec) => spec.names),
  }));

  const rows: CategoryRow[] = refRows.map((ref, index) => {
    const port = portRows[index];
    return {
      index,
      refLabel: ref.label,
      portLabel: port?.label ?? "(missing)",
      refActions: ref.actions,
      portNames: port?.names ?? [],
    };
  });

  const refDefinitions = refRows.reduce((n, row) => n + row.actions.length, 0);
  const refNames = refRows.reduce((n, row) => n + row.actions.reduce((m, a) => m + a.names.length, 0), 0);

  const refCanonical = sorted(refRows.flatMap((row) => row.actions.map((a) => a.names[0]!)));
  const refAllNames = sorted(refRows.flatMap((row) => row.actions.flatMap((a) => a.names)));
  const portAllNames = sorted(actionRegistry.executableNames.map((claim) => claim.name));

  const portNameSet = new Set(portAllNames);
  const refNameSet = new Set(refAllNames);

  // Definition coverage: every reference definition's CANONICAL name must resolve to
  // an implementation whose canonical and kind agree. A missing entry is collected,
  // never skipped, so the failure prints the whole missing set.
  const missingDefinitions: string[] = [];
  const kindMismatches: string[] = [];
  for (const row of refRows) {
    for (const action of row.actions) {
      const canonical = action.names[0]!;
      const claim = actionRegistry.resolve(canonical);
      if (!claim?.action) {
        missingDefinitions.push(canonical);
        continue;
      }
      if (claim.canonical !== canonical) kindMismatches.push(`${canonical}: ports to canonical "${claim.canonical}"`);
      if (claim.kind !== action.kind) kindMismatches.push(`${canonical}: port kind ${claim.kind}, reference kind ${action.kind}`);
      if (claim.action.kind !== action.kind) {
        kindMismatches.push(`${canonical}: port spec kind ${claim.action.kind}, reference spec kind ${action.kind}`);
      }
    }
  }

  // Raw reservations are NOT definition names and the reference oracle does not
  // enumerate them, so they must be excluded from the name diff on both sides —
  // otherwise the two correct raw reservations show up as spurious "extra" names.
  // They are asserted separately (count + exact names) in the registry test.
  const rawNameSet = new Set(actionRegistry.rawActions.map((reservation) => String(reservation.name)));
  const missingNames = refAllNames.filter((name) => !portNameSet.has(name));
  const extraNames = portAllNames.filter((name) => !refNameSet.has(name) && !rawNameSet.has(name));

  const refAliases = refAllNames.filter((name) => oracle.byName.get(name)!.names[0] !== name);
  const portAliases = sorted(
    actionRegistry.executableNames.filter((claim) => claim.role === "alias").map((claim) => claim.name),
  );

  // Declared-but-absent, absent-but-declared: the alias set is held to equality.
  const undeclaredAliases = portAliases.filter((name) => !DOCUMENTED_ALIAS_SET.has(name));
  const aliasRoleMismatches: string[] = [];
  for (const name of refAllNames) {
    const refIsAlias = oracle.byName.get(name)!.names[0] !== name;
    const claim = actionRegistry.resolve(name);
    if (!claim) continue; // reported through missingNames
    const portIsAlias = claim.role === "alias";
    if (refIsAlias !== portIsAlias) {
      aliasRoleMismatches.push(`${name}: reference ${refIsAlias ? "alias" : "canonical"}, port ${claim.role}`);
    }
  }

  const aliasTargetMismatches: string[] = [];
  const unimplementedAliases: string[] = [];
  const handlers = actionRegistry.bind({} as never);
  for (const name of DOCUMENTED_ALIASES) {
    const ref = oracle.byName.get(name);
    assert.ok(ref, `the documented alias "${name}" does not exist in the reference bundle`);
    const canonical = ref.names[0]!;
    const claim = actionRegistry.resolve(name);
    if (!claim?.action) {
      unimplementedAliases.push(name);
      continue;
    }
    if (claim.canonical !== canonical) aliasTargetMismatches.push(`${name}: port → "${claim.canonical}", reference → "${canonical}"`);
    const bound = handlers.get(name);
    if (!bound || typeof bound.handler !== "function") unimplementedAliases.push(`${name} (bound map has no handler)`);
  }

  const categoryCountMismatches: string[] = [];
  for (const row of rows) {
    const refCount = row.refActions.length;
    const portCount = ACTION_GROUPS[row.index]?.actions.length;
    if (portCount === undefined) categoryCountMismatches.push(`${row.refLabel}: port has no category at index ${row.index}`);
    else if (portCount !== refCount) {
      categoryCountMismatches.push(`${row.refLabel}/${row.portLabel}: reference ${refCount}, port ${portCount}`);
    }
  }

  const categoryLabelMismatches = rows
    .filter((row) => row.refLabel !== row.portLabel)
    .map((row) => `index ${row.index}: reference "${row.refLabel}", port "${row.portLabel}"`);

  const emptyCategories = rows
    .filter((row) => row.refActions.length === 0 || (ACTION_GROUPS[row.index]?.actions.length ?? 0) === 0)
    .map((row) => `${row.refLabel}/${row.portLabel}`);

  return {
    oracle,
    rows,
    refDefinitions,
    refNames,
    portDefinitions: actionRegistry.actions.length,
    portNames: actionRegistry.executableNames.length,
    missingDefinitions: sorted(missingDefinitions),
    kindMismatches: sorted(kindMismatches),
    missingNames,
    extraNames,
    refAliases,
    portAliases,
    undeclaredAliases,
    aliasRoleMismatches: sorted(aliasRoleMismatches),
    aliasTargetMismatches: sorted(aliasTargetMismatches),
    unimplementedAliases: sorted(unimplementedAliases),
    categoryCountMismatches,
    categoryLabelMismatches,
    emptyCategories,
  };
}

/** The per-category table, as plain text. Printed by the tests, and by the doc renderer. */
function categoryTable(m: Measurement): string[] {
  const head = "| # | category (reference) | port label | ref definitions | port definitions | ref names | port names | parity |";
  const rule = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const lines = [head, rule];
  for (const row of m.rows) {
    const refDefs = row.refActions.length;
    const refNames = row.refActions.reduce((n, a) => n + a.names.length, 0);
    const portDefs = ACTION_GROUPS[row.index]?.actions.length ?? 0;
    const portNames = row.portNames.length;
    const same =
      refDefs === portDefs && refNames === portNames && row.refLabel === row.portLabel;
    const parity = same ? "✅ equal" : `⚠️ ${refDefs === portDefs && refNames === portNames ? "counts equal, label differs" : "counts differ"}`;
    lines.push(
      `| ${row.index + 1} | ${row.refLabel} | ${row.portLabel} | ${refDefs} | ${portDefs} | ${refNames} | ${portNames} | ${parity} |`,
    );
  }
  lines.push(
    `| — | **total** | — | **${m.refDefinitions}** | **${m.portDefinitions}** | **${m.refNames}** | **${m.portNames}** | ${m.refDefinitions === m.portDefinitions && m.refNames === m.portNames ? "✅ equal" : "⚠️ differ"} |`,
  );
  return lines;
}

/** Section 2: every action name, grouped by category. Aliases shown against their definition. */
function namesByCategory(m: Measurement): string[] {
  const lines: string[] = [];
  for (const row of m.rows) {
    lines.push("", `### ${row.refLabel} (${row.refActions.length} definitions, ${row.refActions.reduce((n, a) => n + a.names.length, 0)} executable names)`, "");
    lines.push("| canonical | aliases | kind |", "| --- | --- | --- |");
    const actions = [...row.refActions].sort((a, b) => a.names[0]!.localeCompare(b.names[0]!, "en"));
    for (const action of actions) {
      const aliases = action.names.slice(1);
      lines.push(`| \`${action.names[0]}\` | ${aliases.length ? aliases.map((a) => `\`${a}\``).join(", ") : "—"} | ${action.kind} |`);
    }
  }
  return lines;
}

/** Section 3: the six aliases and the definition each one resolves to. */
function aliasTable(m: Measurement): string[] {
  const lines = ["| alias | aliases definition | executable names of that definition |", "| --- | --- | --- |"];
  for (const name of DOCUMENTED_ALIASES) {
    const ref = m.oracle.byName.get(name)!;
    const canonical = ref.names[0]!;
    const claim = actionRegistry.resolve(name);
    const ok = claim?.canonical === canonical && claim.action !== undefined;
    lines.push(
      `| \`${name}\` | \`${canonical}\` ${ok ? "" : "⚠️ (port disagrees)"} | ${ref.names.map((n) => `\`${n}\``).join(", ")} |`,
    );
  }
  return lines;
}

/** The full markdown document, including the measured verdict and known divergences. */
function renderMarkdown(): string {
  const m = measure();
  const verdict =
    m.refDefinitions === 222 &&
    m.refNames === 228 &&
    m.rows.length === 12 &&
    m.missingDefinitions.length === 0 &&
    m.missingNames.length === 0 &&
    m.extraNames.length === 0 &&
    m.undeclaredAliases.length === 0 &&
    m.unimplementedAliases.length === 0 &&
    m.categoryCountMismatches.length === 0;

  const lines: string[] = [];
  lines.push("# OneBot action parity table: Haizakura vs. the SnowLuma reference oracle");
  lines.push("");
  lines.push(
    "Generated from two live sources, not from a hand-written list. The reference side is",
    "`reference/index.mjs` evaluated by `ts/test/helpers/actions-oracle.ts`; the category",
    "labels and grouping are parsed out of the bundle's own `var ACTION_GROUPS = [...]`",
    "block (reference:21316-21365). The port side is the compiled `actionRegistry` in",
    "`ts/src/onebot/actions/index.ts`.",
  );
  lines.push("");
  lines.push(`**Measured:** reference ${m.refDefinitions} definitions / ${m.refNames} executable names / ${m.rows.length} categories; port ${m.portDefinitions} definitions / ${m.portNames} executable names / ${m.rows.length} categories.`);
  lines.push("");
  lines.push(
    `**Verdict:** ${verdict ? "every action name in the reference has a registry implementation and every registry name is a reference name — the 222/228/12 claim holds" : "the claim does NOT hold; see the divergence list at the end"}.`,
  );
  lines.push("");
  lines.push(
    "The audited claim is 222 reference definitions / 228 executable names / 12 categories.",
    `All three measured exactly: ${m.refDefinitions}, ${m.refNames}, ${m.rows.length}.`,
  );
  lines.push("");
  lines.push("## 1. Definitions and executable names per category");
  lines.push("");
  lines.push(...categoryTable(m));
  lines.push("");
  lines.push("`definitions` counts actions (one per `defineAction`/`defineStreamAction`);");
  lines.push("`names` counts every executable name, i.e. canonical plus alias.");
  lines.push("");
  lines.push("## 2. Every action name, grouped by category");
  lines.push(...namesByCategory(m));
  lines.push("");
  lines.push("## 3. The six aliases");
  lines.push("");
  lines.push("Each is a second executable name for an existing definition; the registry binds");
  lines.push("both names to the same handler.");
  lines.push("");
  lines.push(...aliasTable(m));
  lines.push("");
  lines.push("## 4. Regenerating this table");
  lines.push("");
  lines.push("This table is emitted by the test file itself, so there is no separate generator");
  lines.push("script to drift out of date. From the repository root:");
  lines.push("");
  lines.push("```sh");
  lines.push("cd ts && npx tsc -p tsconfig.json");
  lines.push("cd ts && ACTION_PARITY_EMIT=1 node build/test/action-parity-table.test.js \\");
  lines.push("  > ../docs/action-parity-table.md");
  lines.push("```");
  lines.push("");
  lines.push("Verifying the same measurements as assertions:");
  lines.push("");
  lines.push("```sh");
  lines.push("cd ts && npx tsc -p tsconfig.json");
  lines.push("cd ts && node --test build/test/action-parity-table.test.js");
  lines.push("```");
  lines.push("");
  lines.push("## 5. Measured divergences and scope notes");
  lines.push("");
  if (m.categoryLabelMismatches.length === 0) {
    lines.push("- Category labels: identical to the reference on all 12 groups.");
  } else {
    lines.push("### 5.1 One category label differs (counts unaffected)");
    lines.push("");
    lines.push("The bundle's `ACTION_GROUPS` spells the extended family's category **扩展**");
    lines.push("(simplified); the port spells it **擴展** (traditional). `category` is copied onto");
    lines.push("every action's `doc` and into the `categories` summary, but dispatch never reads");
    lines.push("it, so this changes documented metadata only, not routing. Measured mismatches:");
    lines.push("");
    for (const mismatch of m.categoryLabelMismatches) lines.push(`- ${mismatch}`);
    lines.push("");
    lines.push("The per-category counts, the definition total and the name set all still match,");
    lines.push("which is why the audited 222/228/12 claim holds despite this.");
  }
  lines.push("");
  lines.push("### 5.2 What the 228 does and does not include");
  lines.push("");
  lines.push(
    "228 is the executable-name count of the bundle's **action definitions** (the 14 action",
    "arrays / 12 categories). The bundle's `compileActionRegistry` is also called with two",
    "**raw reservations** — `.handle_quick_operation` and `.handle_quick_operation_async`",
    "(reference:21369-21375) — which live outside `ACTION_GROUPS` and outside the oracle. So",
    "the full reference registry's `executableNames` is 230, not 228.",
  );
  lines.push("");
  lines.push(
    "The port now mirrors that: `rawActions` holds the same two reservations, so",
    "`actionRegistry.executableNames.length` is **230** (228 definition names + 2 raw) while",
    "`actionRegistry.actions.length` stays 222 and `categories` stays 12. The raw names are",
    "excluded from this file's `extraNames` measurement by name, because they are neither a",
    "missing nor a spurious definition — they are a reservation, and a name the reference",
    "registers but that no `ACTION_GROUPS` array contains. The 222/228/12 claim in §1-§4 is a",
    "claim about `ACTION_GROUPS` and is unaffected.",
  );
  lines.push("");
  lines.push(
    "Until this landed the port had no raw reservations at all (`kind === \"raw\"` count: 0),",
    "so `ts/src/onebot/http.ts`'s `api.handle(\".handle_quick_operation\", ...)` — the v11",
    "quick-operation reply path — answered 1404 unknown action. That behavioural gap is now",
    "closed; see `ts/test/quick-operation.test.ts`.",
  );
  lines.push("");
  lines.push("### 5.3 How to read this document");
  lines.push("");
  lines.push("- A name is either a **definition** (`canonical`, `names[0]`) or an **alias**");
  lines.push("  (`names[1..]`). The registry must contain every reference name exactly once and");
  lines.push("  nothing else.");
  lines.push("- The parity column compares definition count, name count AND label per group.");
  lines.push("  A group with equal counts but a different label is marked as such, not as equal.");
  return lines.join("\n") + "\n";
}

// ===========================================================================
// Emission mode — the doc generator. No tests are registered in this mode.
// ===========================================================================

if (process.env["ACTION_PARITY_EMIT"] === "1") {
  process.stdout.write(renderMarkdown());
} else {
  // =========================================================================
  // The five required assertions. None of them is relaxed: an unexpected count
  // fails with the real number and the actual set.
  // =========================================================================

  test("parity: the reference oracle reports exactly 222 definitions in 12 categories", () => {
    const m = measure();
    assert.equal(
      m.refDefinitions,
      222,
      `reference ACTION_GROUPS definition total; measured ${m.refDefinitions}\n` +
        `per category: ${m.rows.map((r) => `${r.refLabel}=${r.refActions.length}`).join(" ")}`,
    );
    assert.equal(m.rows.length, 12, `reference category count; measured ${m.rows.length}`);
    // The 14 family arrays are grouped into 12 categories, so this cross-checks that the
    // parse above saw every group rather than a prefix of them.
    assert.equal(
      m.refNames,
      228,
      `reference executable-name total (sum over the same 12 groups); measured ${m.refNames}`,
    );
    assert.equal(m.oracle.byName.size, m.refNames, "oracle byName size must equal the parsed name total");
  });

  test("parity: the registry exposes 228 definition names over 222 definitions, plus 2 raw reservations", () => {
    const m = measure();
    // `executableNames` deliberately includes the two RAW reservations
    // (`.handle_quick_operation`, `.handle_quick_operation_async`), because a raw
    // name IS dispatchable and leaving it out made `api.handle(...)` answer 1404.
    // So: 230 total = 228 definition names (222 defs + 6 aliases) + 2 raw.
    //
    // Asserted as a decomposition rather than a bare 230, so that a lost alias or
    // a lost raw reservation cannot cancel out and pass.
    assert.equal(
      m.portNames,
      230,
      `registry executable-name total; measured ${m.portNames}\n` +
        `registry definition count: ${m.portDefinitions}\n` +
        `per category: ${ACTION_GROUPS.map((g) => `${g.category}=${g.actions.flatMap((s) => s.names).length}`).join(" ")}`,
    );
    assert.equal(m.portDefinitions, 222, `registry definition count; measured ${m.portDefinitions}`);
    assert.equal(
      actionRegistry.rawActions.length,
      2,
      `raw reservations; measured ${actionRegistry.rawActions.length}`,
    );
    assert.deepStrictEqual(
      actionRegistry.rawActions.map((r) => String(r.name)).sort(),
      [".handle_quick_operation", ".handle_quick_operation_async"],
      "the two raw reservations must be exactly the reference's",
    );
    // 230 = 222 definitions + 6 aliases + 2 raw.
    assert.equal(
      m.portNames - m.portDefinitions,
      8,
      `aliases + raw reservations implied by the two totals; measured ${m.portNames - m.portDefinitions}`,
    );
  });

  test("parity: every reference definition has a registry implementation (missing set is empty)", () => {
    const m = measure();
    assert.deepStrictEqual(
      m.missingDefinitions,
      [],
      `reference definitions with no registry implementation: ${m.missingDefinitions.length} (expected the empty set)\n` +
        `  ${listOrNone(m.missingDefinitions)}\n` +
        `symmetric difference for definition names: missing=[${listOrNone(m.missingDefinitions)}] extra=[${listOrNone(m.extraNames)}]`,
    );
    assert.deepStrictEqual(
      m.kindMismatches,
      [],
      `implementations whose canonical or kind disagrees with the reference: ${m.kindMismatches.length}\n  ${listOrNone(m.kindMismatches)}`,
    );
  });

  test("parity: every registry name is a reference name or a declared alias, and the alias set is exactly the 6 documented ones", () => {
    const m = measure();

    assert.deepStrictEqual(
      m.missingNames,
      [],
      `reference names with no registry entry: ${m.missingNames.length} (expected the empty set)\n  ${listOrNone(m.missingNames)}`,
    );
    assert.deepStrictEqual(
      m.extraNames,
      [],
      `registry names that are neither a reference definition nor a reference alias: ${m.extraNames.length} (expected the empty set)\n  ${listOrNone(m.extraNames)}`,
    );

    // Both directions of the alias set, plus the documented list itself.
    assert.deepStrictEqual(
      m.portAliases,
      sorted(DOCUMENTED_ALIASES),
      `the registry's alias set must be exactly the 6 documented aliases\n` +
        `  measured:   [${listOrNone(m.portAliases)}]\n` +
        `  documented: [${listOrNone(sorted(DOCUMENTED_ALIASES))}]\n` +
        `  symmetric difference: [${listOrNone([
          ...m.portAliases.filter((n) => !DOCUMENTED_ALIAS_SET.has(n)),
          ...DOCUMENTED_ALIASES.filter((n) => !m.portAliases.includes(n)),
        ])}]`,
    );
    assert.deepStrictEqual(
      m.undeclaredAliases,
      [],
      `aliases present in the registry but not declared: ${m.undeclaredAliases.length}\n  ${listOrNone(m.undeclaredAliases)}`,
    );
    assert.deepStrictEqual(
      m.unimplementedAliases,
      [],
      `declared aliases with no implementation: ${m.unimplementedAliases.length}\n  ${listOrNone(m.unimplementedAliases)}`,
    );
    assert.deepStrictEqual(
      m.aliasTargetMismatches,
      [],
      `aliases pointing at the wrong definition: ${m.aliasTargetMismatches.length}\n  ${listOrNone(m.aliasTargetMismatches)}`,
    );
    assert.deepStrictEqual(
      m.aliasRoleMismatches,
      [],
      `names whose canonical/alias role differs from the reference: ${m.aliasRoleMismatches.length}\n  ${listOrNone(m.aliasRoleMismatches)}`,
    );

    // And the reference really does declare exactly those six aliases — otherwise the
    // "6 documented ones" could be a subset of a larger reference set.
    assert.deepStrictEqual(
      m.refAliases,
      sorted(DOCUMENTED_ALIASES),
      `the reference's own alias set\n  measured: [${listOrNone(m.refAliases)}]`,
    );
  });

  test("parity: all 12 categories are non-empty and their counts sum to 222", () => {
    const m = measure();

    assert.equal(m.rows.length, 12, `category count; measured ${m.rows.length}`);
    assert.equal(actionRegistry.categories.length, 12, `registry category count; measured ${actionRegistry.categories.length}`);
    assert.deepStrictEqual(
      m.emptyCategories,
      [],
      `categories with zero definitions: ${m.emptyCategories.length}\n  ${listOrNone(m.emptyCategories)}`,
    );
    assert.deepStrictEqual(
      m.categoryCountMismatches,
      [],
      `per-category definition counts that differ from the reference: ${m.categoryCountMismatches.length}\n  ${listOrNone(m.categoryCountMismatches)}`,
    );

    const refSum = m.rows.reduce((n, row) => n + row.refActions.length, 0);
    const portSum = m.rows.reduce((n, row) => n + (ACTION_GROUPS[row.index]?.actions.length ?? 0), 0);
    assert.equal(refSum, 222, `reference per-category counts must sum to 222; measured ${refSum}`);
    assert.equal(portSum, 222, `registry per-category counts must sum to 222; measured ${portSum}`);
    assert.equal(
      actionRegistry.categories.reduce((n, category) => n + category.count, 0),
      222,
      "registry's own `categories` summary must sum to 222",
    );

    // The table is printed even on success: the brief asks for it, and a passing run
    // that does not show the numbers is a run nobody can audit.
    console.log("\n" + categoryTable(m).join("\n") + "\n");
    if (m.categoryLabelMismatches.length > 0) {
      console.log(`note: ${m.categoryLabelMismatches.length} category label(s) differ from the reference:`);
      for (const mismatch of m.categoryLabelMismatches) console.log(`  - ${mismatch}`);
    }
  });
}