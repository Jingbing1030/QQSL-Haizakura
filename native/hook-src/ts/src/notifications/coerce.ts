// The three coercion primitives the notification config normalizer is built on.
//
// Reference region: ../common/src/coerce.ts L174-L196 (23 lines, ported verbatim).
//
// Why this is a file in `notifications/` and not `../common/coerce.ts`: the
// rewrite has no `common/` tree and `grep -rn 'clampInt\|boolOr' ts/src/` finds
// nothing, so there is no existing home to add to — and the porting order in
// `docs/notifications-update-network-gap.md` §5 explicitly allows inlining them.
// Only `config.ts` imports this module, so the cost of the extra file is one
// import; the benefit is that the *semantics* below are stated once instead of
// being re-derived at nine call sites.
//
// The semantics are the interesting part, because each one is deliberately NOT
// what a naive implementation would give you:
//
//   * `isObject` excludes arrays. `Array.isArray` is false for `{}` and true for
//     `[]`, and the config normalizer must treat a top-level array as "not an
//     object" so a hand-edited `[]` file falls back to defaults instead of being
//     spread into a channel map.
//   * `boolOr` does NOT coerce. `"true"` and `1` both yield the fallback, because
//     the file is hand-edited and a string `"false"` is the single most common way
//     to silently enable something the operator meant to disable. A JSON file has
//     real booleans; anything else is a typo.
//   * `clampInt` clamps *then* truncates, so an out-of-range value lands on the
//     bound rather than wrapping, and `clampInt(1.9, 1, 10, 0)` is `1` — truncation
//     toward zero, not `Math.round`. A port that rounded would accept port 587.6 as
//     588 and connect nowhere.

/**
 * True only for a plain, non-null, non-array object.
 *
 * `typeof fn === "function"` is excluded too, which matters for `normalizeChannel`
 * when a JSON file cannot contain functions but an in-process caller (a test, or the
 * WebUI passing a parsed body it already validated) can.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The value when it is a real boolean, else the fallback.
 *
 * Strings and numbers are NOT coerced — `'true'` and `1` both yield the fallback.
 */
export function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * A finite number (numeric strings coerced) clamped to `[min, max]`, else the
 * fallback. Fractional precision is preserved — use `clampInt` to floor.
 *
 * An unbounded `Math.min(max, Math.max(min, n))` would turn `NaN` into `NaN`; the
 * explicit `Number.isFinite` check is what makes a garbage value fall back instead
 * of poisoning every downstream comparison.
 */
export function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** `clampNum` truncated toward zero — clamp first, then drop the fraction. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.trunc(clampNum(value, min, max, fallback));
}
