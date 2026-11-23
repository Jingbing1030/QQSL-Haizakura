// The OneBot action kit: parameter coercion, cross-field rules, the action
// definition wrapper, and the two pre-seeded group variants.
//
// Reference region: ../onebot/src/action-kit.ts (reference/index.mjs:6997-7522).
// Every constant, every message string and every coercion rule below is a
// transcription of that region; where something is *not* transcribed it is called
// out in a comment.
//
// ---------------------------------------------------------------------------
// Why `MISSING` is a symbol and not `undefined`
// ---------------------------------------------------------------------------
// `FieldImpl.coerce` distinguishes three states, and the whole design hinges on the
// first: absent (→ required error, or the field's default), present-but-empty
// (`0`, `""`, `false`, `[]` — a real value), and present-and-null (only `raw()`
// accepts it). Using `undefined` for "absent" would collapse the first two, which
// is exactly the bug the reference avoids: `group_id: ""` must be a *present*
// empty string that `sendMsgOptionalGroupId` rewrites, while a missing
// `group_id` must be reported as `group_id: is required`.
//
// ---------------------------------------------------------------------------
// What is NOT ported here, on purpose
// ---------------------------------------------------------------------------
// `describe()` is ported because the registry validates its projection against the
// executable names (the reference throws when a canonical name and the documented
// name disagree). `returnsSchema` and `examples` are projected when supplied;
// they are documentation only, and this port does not invent metadata for actions
// that lack it.

import { NOOP_SINK, RETCODE, failedResponse, okResponse, type ApiResponse, type StreamSink } from "../types.js";

// ===========================================================================
// Result plumbing
// ===========================================================================

export interface Ok<T> {
  ok: true;
  value: T;
}
export interface Err {
  ok: false;
  field: string;
  reason: string;
}
export type Result<T> = Ok<T> | Err;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = (field: string, reason: string): Err => ({ ok: false, field, reason });

/**
 * Only an absent key produces MISSING — this is what lets a present `0` / `''` /
 * `false` be distinguished from "not provided" (reference:6997).
 */
export const MISSING: unique symbol = Symbol("missing");

// ===========================================================================
// Field DOC + the JSON-schema projection
// ===========================================================================

export type FieldRole =
  | "message_id"
  | "group_id"
  | "user_id"
  | "member_id"
  | "file_id"
  | "file"
  | "image"
  | "record"
  | "video"
  | "duration"
  | "timestamp"
  | "face_id";

/** The documentation half of a field. `default` is the only member dispatch reads. */
export interface FieldDoc {
  type: string;
  required: boolean;
  default?: unknown;
  desc?: string;
  role?: FieldRole;
  values?: readonly (string | number)[];
  schema?: Record<string, unknown>;
}

export class FieldImpl<T> {
  readonly core: (raw: unknown, field: string) => Result<T>;
  readonly doc: FieldDoc;

  constructor(core: (raw: unknown, field: string) => Result<T>, doc: FieldDoc) {
    this.core = core;
    this.doc = doc;
  }

  coerce(raw: unknown, field: string): Result<T> {
    if (raw === MISSING) {
      if (this.doc.required) return err(field, "is required");
      return ok(this.doc.default as T);
    }
    return this.core(raw, field);
  }

  optional(): FieldImpl<T | undefined> {
    const next: FieldDoc = { ...this.doc, required: false };
    // `default: undefined` is assigned rather than spread so the key exists:
    // exactOptionalPropertyTypes makes `{...doc, default: undefined}` fail on a
    // `default?: unknown` member, and the reference sets it explicitly too.
    next.default = undefined;
    return new FieldImpl<T | undefined>(this.core as (raw: unknown, field: string) => Result<T | undefined>, next);
  }

  default(value: T): FieldImpl<T> {
    return new FieldImpl<T>(this.core, { ...this.doc, required: false, default: value });
  }

  describe(text: string): FieldImpl<T> {
    return new FieldImpl<T>(this.core, { ...this.doc, desc: text });
  }

  role(role: FieldRole): FieldImpl<T> {
    return new FieldImpl<T>(this.core, { ...this.doc, role });
  }

  toJsonSchema(): Record<string, unknown> {
    const out: Record<string, unknown> = { ...(this.doc.schema ?? {}) };
    if (this.doc.desc) out["description"] = this.doc.desc;
    if (this.doc.default !== undefined) out["default"] = this.doc.default;
    if (this.doc.role) out["x-role"] = this.doc.role;
    return out;
  }
}

// ===========================================================================
// Scalar cores (reference:7042-7086)
// ===========================================================================

interface IntOpts {
  min?: number;
  max?: number;
  nonZero?: boolean;
}

/**
 * Accept a number or numeric string, truncate to integer, then apply bounds.
 *
 * Non-numeric / blank ⇒ Err. Note that `Math.trunc` is applied *before* the
 * bounds, so `2.9` is `2` and `-1.5` is `-1`; the reference does the same and it is
 * observable for a `min: 0` field receiving `-0.5`.
 */
function intCore(typeName: string, opts: IntOpts): (raw: unknown, field: string) => Result<number> {
  return (raw, field) => {
    let n: number;
    if (typeof raw === "number" && Number.isFinite(raw)) n = Math.trunc(raw);
    else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) n = Math.trunc(Number(raw));
    else return err(field, `expected ${typeName}`);
    if (opts.nonZero && n === 0) return err(field, "must not be 0");
    if (opts.min !== undefined && n < opts.min) return err(field, `must be >= ${opts.min}`);
    if (opts.max !== undefined && n > opts.max) return err(field, `must be <= ${opts.max}`);
    return ok(n);
  };
}

function intSchema(opts: IntOpts): Record<string, unknown> {
  const s: Record<string, unknown> = { type: "integer" };
  if (opts.min !== undefined) s["minimum"] = opts.min;
  if (opts.max !== undefined) s["maximum"] = opts.max;
  if (opts.nonZero) s["not"] = { const: 0 };
  return s;
}

interface StrOpts {
  allowEmpty?: boolean;
  maxLen?: number;
}

function strSchema(opts: StrOpts): Record<string, unknown> {
  const s: Record<string, unknown> = { type: "string" };
  if (opts.allowEmpty === false) s["minLength"] = 1;
  if (opts.maxLen !== undefined) s["maxLength"] = opts.maxLen;
  return s;
}

/** Coerce to string (numbers/booleans stringify), then apply bounds. */
function stringCore(opts: StrOpts): (raw: unknown, field: string) => Result<string> {
  return (raw, field) => {
    let s: string;
    if (typeof raw === "string") s = raw;
    else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
    else return err(field, "expected a string");
    if (opts.allowEmpty === false && s === "") return err(field, "must not be empty");
    if (opts.maxLen !== undefined && s.length > opts.maxLen) return err(field, `must be <= ${opts.maxLen} chars`);
    return ok(s);
  };
}

/**
 * `A[]` (reference:7087-7119). `.nonEmpty()` is attached to the same object with
 * `Object.assign`, so the returned value satisfies both `FieldImpl` and the extra
 * method — the reference relies on that too (`f$1.array(f$1.memberId()).nonEmpty()`).
 */
export interface ArrayField<T> extends FieldImpl<T[]> {
  nonEmpty(): ArrayField<T>;
}

function arrayField<T>(el: FieldImpl<T>, mustBeNonEmpty: boolean): ArrayField<T> {
  const core = (raw: unknown, field: string): Result<T[]> => {
    if (!Array.isArray(raw)) return err(field, "expected an array");
    const out: T[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const r = el.coerce(raw[i], `${field}[${i}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    if (mustBeNonEmpty && out.length === 0) return err(field, "must not be empty");
    return ok(out);
  };
  const schema: Record<string, unknown> = { type: "array", items: el.toJsonSchema() };
  if (mustBeNonEmpty) schema["minItems"] = 1;
  const base = new FieldImpl<T[]>(core, { type: `${el.doc.type}[]`, required: true, schema });
  return Object.assign(base, { nonEmpty: () => arrayField<T>(el, true) });
}

// ===========================================================================
// `f` — the field constructors (reference:7120-7400)
// ===========================================================================

export const f = {
  /** Positive integer (>0): group_id / user_id. */
  uint(): FieldImpl<number> {
    return new FieldImpl(intCore("a positive integer", { min: 1 }), {
      type: "uint",
      required: true,
      schema: intSchema({ min: 1 }),
    });
  },
  int(opts: IntOpts = {}): FieldImpl<number> {
    return new FieldImpl(intCore("an integer", opts), { type: "int", required: true, schema: intSchema(opts) });
  },
  /**
   * OneBot message id: a non-zero integer. NEGATIVES ARE VALID (ids are a signed
   * int32 hash) — do NOT use `uint()` for message_id.
   */
  messageId(): FieldImpl<number> {
    return new FieldImpl(intCore("a message id", { nonZero: true }), {
      type: "messageId",
      required: true,
      role: "message_id",
      schema: intSchema({ nonZero: true }),
    });
  },
  groupId(): FieldImpl<number> {
    return new FieldImpl(intCore("a positive integer", { min: 1 }), {
      type: "uint",
      required: true,
      role: "group_id",
      schema: intSchema({ min: 1 }),
    });
  },
  userId(): FieldImpl<number> {
    return new FieldImpl(intCore("a positive integer", { min: 1 }), {
      type: "uint",
      required: true,
      role: "user_id",
      schema: intSchema({ min: 1 }),
    });
  },
  memberId(): FieldImpl<number> {
    return new FieldImpl(intCore("a positive integer", { min: 1 }), {
      type: "uint",
      required: true,
      role: "member_id",
      schema: intSchema({ min: 1 }),
    });
  },
  fileId(): FieldImpl<string> {
    return new FieldImpl(stringCore({ allowEmpty: false }), {
      type: "string",
      required: true,
      role: "file_id",
      schema: strSchema({ allowEmpty: false }),
    });
  },
  file(): FieldImpl<string> {
    return new FieldImpl(stringCore({ allowEmpty: false }), {
      type: "string",
      required: true,
      role: "file",
      schema: strSchema({ allowEmpty: false }),
    });
  },
  image(): FieldImpl<string> {
    return new FieldImpl(stringCore({ allowEmpty: false }), {
      type: "string",
      required: true,
      role: "image",
      schema: strSchema({ allowEmpty: false }),
    });
  },
  record(): FieldImpl<string> {
    return new FieldImpl(stringCore({ allowEmpty: false }), {
      type: "string",
      required: true,
      role: "record",
      schema: strSchema({ allowEmpty: false }),
    });
  },
  video(): FieldImpl<string> {
    return new FieldImpl(stringCore({ allowEmpty: false }), {
      type: "string",
      required: true,
      role: "video",
      schema: strSchema({ allowEmpty: false }),
    });
  },
  duration(): FieldImpl<number> {
    return new FieldImpl(intCore("an integer", { min: 0 }), {
      type: "int",
      required: true,
      role: "duration",
      schema: intSchema({ min: 0 }),
    });
  },
  timestamp(): FieldImpl<number> {
    return new FieldImpl(intCore("an integer", { min: 0 }), {
      type: "int",
      required: true,
      role: "timestamp",
      schema: intSchema({ min: 0 }),
    });
  },
  faceId(): FieldImpl<number> {
    return new FieldImpl(intCore("a non-negative integer", { min: 0 }), {
      type: "int",
      required: true,
      role: "face_id",
      schema: intSchema({ min: 0 }),
    });
  },
  number(): FieldImpl<number> {
    return new FieldImpl(
      (raw, field) => {
        if (typeof raw === "number" && Number.isFinite(raw)) return ok(raw);
        if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return ok(Number(raw));
        return err(field, "expected a number");
      },
      { type: "number", required: true, schema: { type: "number" } },
    );
  },
  string(opts: StrOpts = {}): FieldImpl<string> {
    return new FieldImpl(stringCore(opts), { type: "string", required: true, schema: strSchema(opts) });
  },
  /** true/1/yes/on ⇒ true; false/0/no/off ⇒ false. */
  bool(): FieldImpl<boolean> {
    return new FieldImpl(
      (raw, field) => {
        if (typeof raw === "boolean") return ok(raw);
        if (typeof raw === "number") return ok(raw !== 0);
        if (typeof raw === "string") {
          const t = raw.trim().toLowerCase();
          if (t === "true" || t === "1" || t === "yes" || t === "on") return ok(true);
          if (t === "false" || t === "0" || t === "no" || t === "off") return ok(false);
        }
        return err(field, "expected a boolean");
      },
      { type: "bool", required: true, schema: { type: "boolean" } },
    );
  },
  /** JSON object, preserving unknown fields without coercing scalars or arrays. */
  object(): FieldImpl<Record<string, unknown>> {
    return new FieldImpl(
      (raw, field) =>
        typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? ok(raw as Record<string, unknown>)
          : err(field, "expected an object"),
      { type: "object", required: true, schema: { type: "object", additionalProperties: true } },
    );
  },
  /** Literal text or upstream rich items; strings must never be decoded as messages. */
  textOrObjectArray(): FieldImpl<string | Record<string, unknown>[]> {
    return new FieldImpl<string | Record<string, unknown>[]>(
      (raw, field) => {
        if (typeof raw === "string" && raw.length > 0) return ok(raw);
        if (
          Array.isArray(raw) &&
          raw.length > 0 &&
          raw.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
        ) {
          return ok(raw as Record<string, unknown>[]);
        }
        return err(field, "expected non-empty text or a non-empty array of objects");
      },
      {
        type: "string | object[]",
        required: true,
        schema: {
          anyOf: [
            { type: "string", minLength: 1 },
            { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
          ],
        },
      },
    );
  },
  /**
   * OneBot message union: string | segment[] | object.
   *
   * A string that looks like a JSON array is parsed; otherwise the value passes
   * through unchanged. The output stays untyped on purpose — the parser downstream
   * accepts all three shapes and re-validates them, so coercing here would move
   * validation to the wrong layer.
   */
  message(): FieldImpl<unknown> {
    return new FieldImpl(
      (raw) => {
        if (typeof raw === "string") {
          const t = raw.trim();
          if (t.startsWith("[") && t.endsWith("]")) {
            try {
              const parsed: unknown = JSON.parse(t);
              if (Array.isArray(parsed)) return ok(parsed);
            } catch {
              // Fall through: a string that merely looks like JSON stays a string,
              // which `parseMessage` then treats as CQ text.
            }
          }
        }
        return ok(raw);
      },
      {
        type: "message",
        required: true,
        schema: {
          description:
            'OneBot message: string | segment[] | object. In segment arrays, text segments whose text field is exactly "" are compatibility placeholders and do not count as sendable segments; missing, null, and whitespace-only text remain subject to normal validation.',
        },
      },
    );
  },
  array<T>(el: FieldImpl<T>): ArrayField<T> {
    return arrayField(el, false);
  },
  enum<T extends string | number>(...values: readonly T[]): FieldImpl<T> {
    return new FieldImpl(
      (raw, field) => {
        if ((typeof raw === "string" || typeof raw === "number") && (values as readonly (string | number)[]).includes(raw)) {
          return ok(raw as T);
        }
        return err(field, `expected one of: ${values.join(", ")}`);
      },
      { type: "enum", required: true, values, schema: { enum: [...values] } },
    );
  },
  /** Escape hatch — pass the raw value (or undefined) through, validate nothing. */
  raw(): FieldImpl<unknown> {
    return new FieldImpl((raw) => ok(raw), { type: "raw", required: false, default: undefined, schema: {} });
  },
};

// ===========================================================================
// Cross-field rules (reference:7405-7447)
// ===========================================================================

const present = (p: Record<string, unknown>, key: string): boolean => p[key] !== undefined;

const groupOk = (p: Record<string, unknown>, g: string | readonly string[]): boolean =>
  typeof g === "string" ? present(p, g) : g.every((k) => present(p, k));

const groupLabel = (g: string | readonly string[]): string => (typeof g === "string" ? g : `(${g.join("+")})`);

export interface Rule {
  doc: string;
  check(p: Record<string, unknown>): Err | null;
}

/**
 * The rule DSL.
 *
 * `exactlyOneOf` treats a *group* (array) as "all of these keys present", which is
 * how `send_custom_face`'s "group_id XOR user_id" is expressed without a special
 * case.
 */
export const RULES = {
  exactlyOneOf(...groups: (string | readonly string[])[]): Rule {
    const doc = `exactly one of: ${groups.map(groupLabel).join(" | ")}`;
    return { doc, check: (p) => (groups.filter((g) => groupOk(p, g)).length === 1 ? null : err("", doc)) };
  },
  atLeastOneOf(...keys: string[]): Rule {
    const doc = `at least one of: ${keys.join(", ")}`;
    return { doc, check: (p) => (keys.some((k) => present(p, k)) ? null : err("", doc)) };
  },
  requiredTogether(...keys: string[]): Rule {
    const doc = `all or none of: ${keys.join(", ")}`;
    return {
      doc,
      check: (p) => {
        const n = keys.filter((k) => present(p, k)).length;
        return n === 0 || n === keys.length ? null : err("", doc);
      },
    };
  },
  mutuallyExclusive(...keys: string[]): Rule {
    const doc = `at most one of: ${keys.join(", ")}`;
    return { doc, check: (p) => (keys.filter((k) => present(p, k)).length <= 1 ? null : err("", doc)) };
  },
  rule(doc: string, okFn: (p: Record<string, unknown>) => boolean): Rule {
    return { doc, check: (p) => (okFn(p) ? null : err("", doc)) };
  },
};

export const wording = (e: Err): string => (e.field ? `${e.field}: ${e.reason}` : e.reason);

// ===========================================================================
// defineAction (reference:7449-7520)
// ===========================================================================

/** A `params` map: field name → field spec. */
export type ParamMap<P> = { [K in keyof P]-?: FieldImpl<P[K]> };

export interface ActionDoc {
  name: string;
  aliases: string[];
  summary?: string | undefined;
  returns?: string | undefined;
  returnsSchema?: unknown;
  examples?: readonly unknown[];
  readOnly: boolean;
  params: Array<FieldDoc & { name: string }>;
  invariants: string[];
  inputSchema: Record<string, unknown>;
}

export interface ActionSpec<P extends object, C> {
  kind: "normal";
  /** Canonical name first. Every entry is an executable action name. */
  names: readonly string[];
  params: ParamMap<P>;
  /** Run against already-coerced params. */
  parse(raw: Record<string, unknown>): Result<P>;
  toHandler(ctx: C): (params: Record<string, unknown>) => Promise<ApiResponse>;
  describe(): ActionDoc;
}

export interface ActionDefinition<P extends object, C> {
  name: string | readonly string[];
  summary?: string | undefined;
  returns?: string | undefined;
  returnsSchema?: unknown;
  examples?: readonly unknown[];
  readOnly?: boolean;
  params: ParamMap<P>;
  rules?: (r: typeof RULES) => Rule[];
  run: (params: P, ctx: C) => ApiResponse | Promise<ApiResponse>;
}

export function defineAction<P extends object, C>(
  def: ActionDefinition<P, C>,
): ActionSpec<P, C> {
  const names = Object.freeze(typeof def.name === "string" ? [def.name] : [...def.name]);
  const rules = def.rules ? def.rules(RULES) : [];

  const parse = (raw: Record<string, unknown>): Result<P> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(def.params) as (keyof P & string)[]) {
      const field = def.params[key];
      const value = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : MISSING;
      const r = field.coerce(value, key);
      if (!r.ok) return r;
      out[key] = r.value;
    }
    for (const rule of rules) {
      const e = rule.check(out);
      if (e) return e;
    }
    return ok(out as P);
  };

  const toHandler = (ctx: C) => async (params: Record<string, unknown>): Promise<ApiResponse> => {
    const r = parse(params);
    if (!r.ok) return failedResponse(RETCODE.BAD_REQUEST, wording(r));
    return await def.run(r.value, ctx);
  };

  return {
    kind: "normal",
    names,
    params: def.params,
    parse,
    toHandler,
    describe: () => {
      const entries = Object.entries(def.params) as [string, FieldImpl<unknown>][];
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [name, field] of entries) {
        properties[name] = field.toJsonSchema();
        if (field.doc.required) required.push(name);
      }
      const inputSchema: Record<string, unknown> = { type: "object", properties };
      if (required.length) inputSchema["required"] = required;
      inputSchema["additionalProperties"] = true;
      return {
        name: names[0]!,
        aliases: names.slice(1),
        summary: def.summary,
        returns: def.returns,
        returnsSchema: def.returnsSchema,
        ...(def.examples ? { examples: def.examples } : {}),
        readOnly: def.readOnly ?? false,
        params: entries.map(([name, field]) => ({ name, ...field.doc })),
        invariants: rules.map((rule) => rule.doc),
        inputSchema,
      };
    },
  };
}

/** Pre-seeds `group_id` (uint, required) — reference:7488 `groupAction`. */
export function groupAction<P extends object, C>(
  def: Omit<ActionDefinition<P & { group_id: number }, C>, "params"> & { params: ParamMap<P> },
): ActionSpec<P & { group_id: number }, C> {
  const params = {
    group_id: f.groupId().describe("群号"),
    ...def.params,
  } as ParamMap<P & { group_id: number }>;
  return defineAction<P & { group_id: number }, C>({ ...def, params });
}

/** Pre-seeds `group_id` + `user_id` (both uint, required) — reference:7506. */
export function groupUserAction<P extends object, C>(
  def: Omit<ActionDefinition<P & { group_id: number; user_id: number }, C>, "params"> & { params: ParamMap<P> },
): ActionSpec<P & { group_id: number; user_id: number }, C> {
  const params = {
    group_id: f.groupId().describe("群号"),
    user_id: f.memberId().describe("QQ 号"),
    ...def.params,
  } as ParamMap<P & { group_id: number; user_id: number }>;
  return defineAction<P & { group_id: number; user_id: number }, C>({ ...def, params });
}

// ===========================================================================
// defineStreamAction (reference:7469)
// ===========================================================================

/** A stream-sink handler. `sink` is never undefined — `NOOP_SINK` fills in. */
export type StreamRun<P, C> = (params: P, ctx: C, sink: StreamSink) => ApiResponse | Promise<ApiResponse>;

/**
 * A stream action's spec. Four differences from `ActionSpec`, every one observable:
 *
 *   * `kind` is `"stream"`, so the transports switch to multi-frame framing;
 *   * `toHandler` takes a SECOND argument — the sink;
 *   * `describe()` carries `stream: true`, and `validateSpecProjection` compares
 *     that against `kind`, so a spec that says "stream" while describing as normal
 *     is a startup error rather than a mislabelled runtime surprise;
 *   * `describe()`'s return type is narrowed so the `stream: true` literal survives
 *     the registry's `doc` copy.
 */
export interface StreamActionSpec<P extends object, C> {
  kind: "stream";
  names: readonly string[];
  params: ParamMap<P>;
  parse(raw: Record<string, unknown>): Result<P>;
  toHandler(ctx: C): (params: Record<string, unknown>, sink?: StreamSink) => Promise<ApiResponse>;
  describe(): ActionDoc & { stream: true };
}

export interface StreamActionDefinition<P extends object, C> {
  name: string | readonly string[];
  summary?: string | undefined;
  returns?: string | undefined;
  returnsSchema?: unknown;
  examples?: readonly unknown[];
  readOnly?: boolean;
  params: ParamMap<P>;
  rules?: (r: typeof RULES) => Rule[];
  run: StreamRun<P, C>;
}

/**
 * `defineStreamAction` — reference:7469.
 *
 * The reference builds a NORMAL action first and wraps its `toHandler`. That is not
 * indirection for its own sake: the parameter schema, the rules and `describe()`
 * come from the same code as a normal action's, so a stream action cannot skip
 * validation or drift from its documented params. The wrapped `base.run` — which
 * answers `1200 "stream action dispatched without a sink"` — is unreachable through
 * `toHandler`; it exists so the base action is a valid, total definition.
 *
 * `sink ?? NOOP_SINK`: a caller that invokes a stream action without streaming (a
 * plain HTTP client that did not ask for frames) must still get the terminal
 * response. Dropping the intermediate frames is the documented behaviour and is why
 * `NOOP_SINK` exists.
 */
export function defineStreamAction<P extends object, C>(
  def: StreamActionDefinition<P, C>,
): StreamActionSpec<P, C> {
  const base = defineAction<P, C>({
    name: def.name,
    summary: def.summary,
    returns: def.returns,
    returnsSchema: def.returnsSchema,
    ...(def.examples !== undefined ? { examples: def.examples } : {}),
    readOnly: def.readOnly ?? false,
    params: def.params,
    ...(def.rules !== undefined ? { rules: def.rules } : {}),
    run: () => failedResponse(RETCODE.INTERNAL_ERROR, "stream action dispatched without a sink"),
  });

  const toHandler =
    (ctx: C) =>
    async (params: Record<string, unknown>, sink?: StreamSink): Promise<ApiResponse> => {
      const r = base.parse(params);
      if (!r.ok) return failedResponse(RETCODE.BAD_REQUEST, wording(r));
      return await def.run(r.value, ctx, sink ?? NOOP_SINK);
    };

  return {
    kind: "stream",
    names: base.names,
    params: def.params,
    parse: base.parse,
    toHandler,
    describe: () => ({ ...base.describe(), stream: true as const }),
  };
}

/**
 * `send_msg`'s `group_id`, which accepts the exact empty string as "absent".
 *
 * Reference:7874. Some clients send `group_id: ""` on a private chat, and the note
 * in the reference is emphatic that this must not change `f.groupId()` itself —
 * other actions rely on `""` being an error there.
 */
export function sendMsgOptionalGroupId(): FieldImpl<number | undefined> {
  const inner = f.groupId().optional();
  // `Object.create(inner)` + an own `coerce`, exactly as the reference does it: the
  // wrapper inherits `doc` (so `describe()` still reports the group_id role) and only
  // the coercion entry point changes.
  const wrapper = Object.create(inner) as FieldImpl<number | undefined>;
  Object.assign(wrapper, {
    coerce: (raw: unknown, field: string): Result<number | undefined> =>
      raw === "" ? ok(undefined) : inner.coerce(raw, field),
  });
  return wrapper;
}

export { okResponse, failedResponse, RETCODE };