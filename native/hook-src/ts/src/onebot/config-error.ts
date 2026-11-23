// The one `OneBotConfigValidationError` class, in its own module.
//
// Reference: ../onebot/src/config.ts L5186-L5191.
//
// It lives here rather than in `config.ts` for one reason: `manager.ts` needs the
// same class, and importing `config.ts` from `manager.ts` would drag the whole
// loader — and, through `isRealUin`, the entire bridge — into every module that
// only wants to recognise a config error. Two structurally identical classes would
// be worse: they both set `name = "OneBotConfigValidationError"`, so every
// `instanceof` check would silently depend on which module the thrower imported,
// and the WebUI's 4xx branch and the manager's non-retryable branch would disagree.
//
// So this file has zero imports, `config.ts` and `manager.ts` both import it, and
// both re-export it. `assertValidOneBotConfig` and the strict validator family live
// in `config.ts` because they need the merge helpers.

/**
 * A **deterministic** configuration error: the input is wrong, not the world.
 *
 * Callers branch on the type rather than the message. The reference uses it to
 * answer 4xx instead of 500 from the WebUI, and to mark a failed migration
 * permanently failed instead of retrying a config that cannot fix itself
 * ("请修正配置后重启").
 */
export class OneBotConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OneBotConfigValidationError";
  }
}

/** Throw the marker error, never return. `never` so callers can use it to narrow. */
export function invalid(message: string): never {
  throw new OneBotConfigValidationError(message);
}
