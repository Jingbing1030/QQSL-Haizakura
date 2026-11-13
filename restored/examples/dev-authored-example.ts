// ---------------------------------------------------------------------------
// Example NEW module ("runner" style): declared with
//   { "insert": "before:src/index.ts", "mode": "run", "deps": ["dev-lib"] }
// It runs during startup, after the entry region's dependencies exist.
//
// It may call ANY top-level name from the bundle, because all 467 regions share
// one flat scope. It must not declare a name that already exists (8392 do).
// ---------------------------------------------------------------------------

function devRunnerReport(regionCount: number): string {
  return `spliced module ok: ${regionCount} base regions + 1 new`;
}

var devRunnerLine = devRunnerReport(467);
process.stdout.write(`[dev-example] ${devRunnerLine} (pid ${process.pid}, node ${process.version})\n`);
export { };
