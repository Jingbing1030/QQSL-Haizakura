// ---------------------------------------------------------------------------
// Example NEW module ("library" style): declared in manifest-extra.json with
//   { "insert": "after:../common/src/logger.ts", "mode": "lazy" }
// so it is DEFINED early but only RUN when something calls init_<id>().
//
// Type annotations are fine: build.mjs strips them with
// module.stripTypeScriptTypes(). The 467 original slices are already plain JS.
// ---------------------------------------------------------------------------

function devLibDescribe(what: string): string {
  return `dev-lib ready for ${what}`;
}

// `export {}` makes editors treat this as a module; build.mjs strips it because
// the bundle is ONE flat scope with zero export statements.
export { };
