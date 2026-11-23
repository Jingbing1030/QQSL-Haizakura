// `SingleFlightCache` — the TTL + in-flight-dedupe cache `ContactsApi` is built on.
//
// Reference region: `../common/src/single-flight-cache.ts`
// (reference/index.mjs:74285-74344, 60 lines). Ported whole: the reference's own
// class is already tiny and every branch of it is load-bearing for
// `fetchGroupMemberList`.  The one member not reproduced is the constructor's
// `shouldCache` default assignment, which is kept — it *is* reproduced, I mean to
// say nothing is dropped.
//
// ---------------------------------------------------------------------------
// Why this is not just "a Map with a timestamp"
// ---------------------------------------------------------------------------
// Two behaviours matter and both are the reference's:
//
//   1. **In-flight de-dupe.** `force` bypasses the *freshness* check but still
//      JOINS an in-flight load instead of starting a second one. That is the whole
//      reason this class exists: `get_group_member_info` is called once per inbound
//      chat message by clients like MaiBot, and without the join, two concurrent
//      calls issue two 0xfe7_3 requests. Sustained >1k/h trips Tencent risk control
//      and the account is banned for 7 days. So the `existing` early-return must not
//      be moved below the load start.
//
//   2. **A rejected load is not cached.** `load()` throws -> the rejection reaches
//      every joined caller, `finally` clears the in-flight slot, and nothing lands
//      in `fresh`. The next caller retries. Caching a failure here would pin a
//      transient network error for the whole TTL.
//
// The `if (this.inflight.get(key) === task)` guards in both the success path and
// the `finally` are what makes `invalidate()` safe: after an invalidate, the
// finishing load no longer owns the slot and must NOT write to `fresh`. Dropping
// either guard makes a stale value reappear after an explicit invalidation.

/**
 * One cache entry's freshness stamp.
 *
 * `now` is injected so a test can drive the clock instead of sleeping; the
 * reference takes the same injection (`opts.now ?? Date.now`).
 */
export interface SingleFlightCacheOptions<K, V> {
  ttlMs: number;
  load: (key: K) => Promise<V>;
  /** Return false to serve without caching (e.g. an empty page). Default: cache all. */
  shouldCache?: (value: V) => boolean;
  /** Clock. Default `Date.now`. */
  now?: () => number;
}

export class SingleFlightCache<K, V> {
  readonly #ttlMs: number;
  readonly #load: (key: K) => Promise<V>;
  readonly #shouldCache: (value: V) => boolean;
  readonly #now: () => number;
  readonly #fresh = new Map<K, { at: number; value: V }>();
  readonly #inflight = new Map<K, Promise<V>>();

  constructor(options: SingleFlightCacheOptions<K, V>) {
    this.#ttlMs = options.ttlMs;
    this.#load = options.load;
    this.#shouldCache = options.shouldCache ?? (() => true);
    this.#now = options.now ?? Date.now;
  }

  /**
   * Get the value for `key`.
   *
   *   * a load within `ttlMs` is a hit;
   *   * otherwise concurrent callers join ONE `load()`;
   *   * a rejected load reaches every joined caller and is not cached;
   *   * `force` skips the freshness check but still joins an in-flight load.
   */
  get(key: K, options: { force?: boolean | undefined } = {}): Promise<V> {
    if (!options.force) {
      const hit = this.#fresh.get(key);
      if (hit && this.#now() - hit.at < this.#ttlMs) return Promise.resolve(hit.value);
    }
    const existing = this.#inflight.get(key);
    if (existing) return existing;

    const load = async (): Promise<V> => {
      const value = await this.#load(key);
      if (this.#inflight.get(key) === task && this.#shouldCache(value)) {
        this.#fresh.set(key, { at: this.#now(), value });
      }
      return value;
    };
    const task: Promise<V> = load().finally(() => {
      if (this.#inflight.get(key) === task) this.#inflight.delete(key);
    });
    this.#inflight.set(key, task);
    return task;
  }

  /** Detach the entry and its pending load; existing callers still settle. */
  invalidate(key: K): void {
    this.#fresh.delete(key);
    this.#inflight.delete(key);
  }

  /** Detach all entries and pending loads without aborting existing callers. */
  clear(): void {
    this.#fresh.clear();
    this.#inflight.clear();
  }
}

/** The reference's factory (`createSingleFlightCache`, :74341). */
export function createSingleFlightCache<K, V>(options: SingleFlightCacheOptions<K, V>): SingleFlightCache<K, V> {
  return new SingleFlightCache(options);
}