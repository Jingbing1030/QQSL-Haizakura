// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/action-kit.ts"
// original bundle lines 6997-7521  (523 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var ok = (value) => ({
	ok: true,
	value
});
var err$1 = (field, reason) => ({
	ok: false,
	field,
	reason
});
/** Only an absent key produces MISSING — this is what lets a present `0` /
*  `''` / `false` be distinguished from "not provided". */
var MISSING = Symbol("missing");
var FieldImpl = class FieldImpl {
	core;
	doc;
	constructor(core, doc) {
		this.core = core;
		this.doc = doc;
	}
	coerce(raw, field) {
		if (raw === MISSING) {
			if (this.doc.required) return err$1(field, "is required");
			return ok(this.doc.default);
		}
		return this.core(raw, field);
	}
	optional() {
		return new FieldImpl(this.core, {
			...this.doc,
			required: false,
			default: void 0
		});
	}
	default(value) {
		return new FieldImpl(this.core, {
			...this.doc,
			required: false,
			default: value
		});
	}
	describe(text) {
		return new FieldImpl(this.core, {
			...this.doc,
			desc: text
		});
	}
	role(role) {
		return new FieldImpl(this.core, {
			...this.doc,
			role
		});
	}
	toJsonSchema() {
		const out = { ...this.doc.schema ?? {} };
		if (this.doc.desc) out.description = this.doc.desc;
		if (this.doc.default !== void 0) out.default = this.doc.default;
		if (this.doc.role) out["x-role"] = this.doc.role;
		return out;
	}
};
/** Accept a number or numeric string, truncate to integer (matches the legacy
*  `asNumber`), then apply bounds. Non-numeric / blank ⇒ Err. */
function intCore(typeName, opts) {
	return (raw, field) => {
		let n;
		if (typeof raw === "number" && Number.isFinite(raw)) n = Math.trunc(raw);
		else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) n = Math.trunc(Number(raw));
		else return err$1(field, `expected ${typeName}`);
		if (opts.nonZero && n === 0) return err$1(field, "must not be 0");
		if (opts.min !== void 0 && n < opts.min) return err$1(field, `must be >= ${opts.min}`);
		if (opts.max !== void 0 && n > opts.max) return err$1(field, `must be <= ${opts.max}`);
		return ok(n);
	};
}
function intSchema(opts) {
	const s = { type: "integer" };
	if (opts.min !== void 0) s.minimum = opts.min;
	if (opts.max !== void 0) s.maximum = opts.max;
	if (opts.nonZero) s.not = { const: 0 };
	return s;
}
function strSchema(opts) {
	const s = { type: "string" };
	if (opts.allowEmpty === false) s.minLength = 1;
	if (opts.maxLen !== void 0) s.maxLength = opts.maxLen;
	return s;
}
/** Coerce to string (numbers/booleans stringify; matches legacy `asString`),
*  then apply emptiness / length bounds. Shared by `f.string()` and the
*  string-valued semantic constructors. */
function stringCore(opts) {
	return (raw, field) => {
		let s;
		if (typeof raw === "string") s = raw;
		else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
		else return err$1(field, "expected a string");
		if (opts.allowEmpty === false && s === "") return err$1(field, "must not be empty");
		if (opts.maxLen !== void 0 && s.length > opts.maxLen) return err$1(field, `must be <= ${opts.maxLen} chars`);
		return ok(s);
	};
}
function arrayField(el, mustBeNonEmpty) {
	const core = (raw, field) => {
		if (!Array.isArray(raw)) return err$1(field, "expected an array");
		const out = [];
		for (let i = 0; i < raw.length; i++) {
			const r = el.coerce(raw[i], `${field}[${i}]`);
			if (!r.ok) return r;
			out.push(r.value);
		}
		if (mustBeNonEmpty && out.length === 0) return err$1(field, "must not be empty");
		return ok(out);
	};
	const base = new FieldImpl(core, {
		type: `${el.doc.type}[]`,
		required: true,
		schema: {
			type: "array",
			items: el.toJsonSchema(),
			...mustBeNonEmpty ? { minItems: 1 } : {}
		}
	});
	return Object.assign(base, { nonEmpty: () => arrayField(el, true) });
}
var f$1 = {
	/** Positive integer (>0): group_id / user_id. */
	uint() {
		return new FieldImpl(intCore("a positive integer", { min: 1 }), {
			type: "uint",
			required: true,
			schema: intSchema({ min: 1 })
		});
	},
	/** Integer with optional bounds; allows 0 / negatives unless bounded.
	*  e.g. a duration where 0 is meaningful: `f.int({ min: 0 })`. */
	int(opts = {}) {
		return new FieldImpl(intCore("an integer", opts), {
			type: "int",
			required: true,
			schema: intSchema(opts)
		});
	},
	/** OneBot message id: a non-zero integer. NEGATIVES ARE VALID (ids are a
	*  signed int32 hash) — do NOT use `uint()` for message_id. */
	messageId() {
		return new FieldImpl(intCore("a message id", { nonZero: true }), {
			type: "messageId",
			required: true,
			role: "message_id",
			schema: intSchema({ nonZero: true })
		});
	},
	/** Group number (uint) → group picker. */
	groupId() {
		return new FieldImpl(intCore("a positive integer", { min: 1 }), {
			type: "uint",
			required: true,
			role: "group_id",
			schema: intSchema({ min: 1 })
		});
	},
	/** Friend / stranger uin (uint) → friend picker. */
	userId() {
		return new FieldImpl(intCore("a positive integer", { min: 1 }), {
			type: "uint",
			required: true,
			role: "user_id",
			schema: intSchema({ min: 1 })
		});
	},
	/** Group member's uin (uint) → member picker, linked to a sibling group_id. */
	memberId() {
		return new FieldImpl(intCore("a positive integer", { min: 1 }), {
			type: "uint",
			required: true,
			role: "member_id",
			schema: intSchema({ min: 1 })
		});
	},
	/** Opaque file id (string) → file picker / history. */
	fileId() {
		return new FieldImpl(stringCore({ allowEmpty: false }), {
			type: "string",
			required: true,
			role: "file_id",
			schema: strSchema({ allowEmpty: false })
		});
	},
	/** Local path / URL / base64 of a generic file → FileSource control. */
	file() {
		return new FieldImpl(stringCore({ allowEmpty: false }), {
			type: "string",
			required: true,
			role: "file",
			schema: strSchema({ allowEmpty: false })
		});
	},
	/** Image source (path / URL / base64) → FileSource control. */
	image() {
		return new FieldImpl(stringCore({ allowEmpty: false }), {
			type: "string",
			required: true,
			role: "image",
			schema: strSchema({ allowEmpty: false })
		});
	},
	/** Voice/record source → FileSource control. */
	record() {
		return new FieldImpl(stringCore({ allowEmpty: false }), {
			type: "string",
			required: true,
			role: "record",
			schema: strSchema({ allowEmpty: false })
		});
	},
	/** Video source → FileSource control. */
	video() {
		return new FieldImpl(stringCore({ allowEmpty: false }), {
			type: "string",
			required: true,
			role: "video",
			schema: strSchema({ allowEmpty: false })
		});
	},
	/** Seconds (int ≥ 0) → duration control. */
	duration() {
		return new FieldImpl(intCore("an integer", { min: 0 }), {
			type: "int",
			required: true,
			role: "duration",
			schema: intSchema({ min: 0 })
		});
	},
	/** Unix timestamp (int ≥ 0) → datetime control. */
	timestamp() {
		return new FieldImpl(intCore("an integer", { min: 0 }), {
			type: "int",
			required: true,
			role: "timestamp",
			schema: intSchema({ min: 0 })
		});
	},
	/** QQ face id (non-negative int; face 0 is valid) → face grid. */
	faceId() {
		return new FieldImpl(intCore("a non-negative integer", { min: 0 }), {
			type: "int",
			required: true,
			role: "face_id",
			schema: intSchema({ min: 0 })
		});
	},
	/** Finite number (fractions allowed). */
	number() {
		return new FieldImpl((raw, field) => {
			if (typeof raw === "number" && Number.isFinite(raw)) return ok(raw);
			if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return ok(Number(raw));
			return err$1(field, "expected a number");
		}, {
			type: "number",
			required: true,
			schema: { type: "number" }
		});
	},
	/** String. Numbers/booleans stringify (matches legacy `asString`). Empty
	*  allowed by default; `{ allowEmpty: false }` rejects ''. */
	string(opts = {}) {
		return new FieldImpl(stringCore(opts), {
			type: "string",
			required: true,
			schema: strSchema(opts)
		});
	},
	/** true/1/yes/on ⇒ true; false/0/no/off ⇒ false (matches legacy `asBoolean`). */
	bool() {
		return new FieldImpl((raw, field) => {
			if (typeof raw === "boolean") return ok(raw);
			if (typeof raw === "number") return ok(raw !== 0);
			if (typeof raw === "string") {
				const t = raw.trim().toLowerCase();
				if (t === "true" || t === "1" || t === "yes" || t === "on") return ok(true);
				if (t === "false" || t === "0" || t === "no" || t === "off") return ok(false);
			}
			return err$1(field, "expected a boolean");
		}, {
			type: "bool",
			required: true,
			schema: { type: "boolean" }
		});
	},
	/** JSON object, preserving unknown fields without coercing scalars or arrays. */
	object() {
		return new FieldImpl((raw, field) => typeof raw === "object" && raw !== null && !Array.isArray(raw) ? ok(raw) : err$1(field, "expected an object"), {
			type: "object",
			required: true,
			schema: {
				type: "object",
				additionalProperties: true
			}
		});
	},
	/** Literal text or upstream rich items; strings must never be decoded as messages. */
	textOrObjectArray() {
		return new FieldImpl((raw, field) => {
			if (typeof raw === "string" && raw.length > 0) return ok(raw);
			if (Array.isArray(raw) && raw.length > 0 && raw.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))) return ok(raw);
			return err$1(field, "expected non-empty text or a non-empty array of objects");
		}, {
			type: "string | object[]",
			required: true,
			schema: { anyOf: [{
				type: "string",
				minLength: 1
			}, {
				type: "array",
				minItems: 1,
				items: {
					type: "object",
					additionalProperties: true
				}
			}] }
		});
	},
	/** OneBot message union: string | segment[] | object. A string that looks
	*  like a JSON array is parsed (matches legacy `asMessage`); otherwise the
	*  value passes through. Output stays `JsonValue` — downstream ctx.* accept it. */
	message() {
		return new FieldImpl((raw, _field) => {
			if (typeof raw === "string") {
				const t = raw.trim();
				if (t.startsWith("[") && t.endsWith("]")) try {
					const parsed = JSON.parse(t);
					if (Array.isArray(parsed)) return ok(parsed);
				} catch {}
			}
			return ok(raw);
		}, {
			type: "message",
			required: true,
			schema: { description: "OneBot message: string | segment[] | object. In segment arrays, text segments whose text field is exactly \"\" are compatibility placeholders and do not count as sendable segments; missing, null, and whitespace-only text remain subject to normal validation." }
		});
	},
	/** Homogeneous array; `.nonEmpty()` rejects []. */
	array(el) {
		return arrayField(el, false);
	},
	/** Constrained literal set. */
	enum(...values) {
		return new FieldImpl((raw, field) => {
			if ((typeof raw === "string" || typeof raw === "number") && values.includes(raw)) return ok(raw);
			return err$1(field, `expected one of: ${values.join(", ")}`);
		}, {
			type: "enum",
			required: true,
			values,
			schema: { enum: [...values] }
		});
	},
	/** Escape hatch — pass the raw value (or undefined) through, validate nothing. */
	raw() {
		return new FieldImpl((raw) => ok(raw), {
			type: "raw",
			required: false,
			default: void 0,
			schema: {}
		});
	}
};
var present = (p, key) => p[key] !== void 0;
var groupOk = (p, g) => Array.isArray(g) ? g.every((k) => present(p, k)) : present(p, g);
var groupLabel = (g) => Array.isArray(g) ? `(${g.join("+")})` : g;
var RULES = {
	exactlyOneOf(...groups) {
		const doc = `exactly one of: ${groups.map(groupLabel).join(" | ")}`;
		return {
			doc,
			check: (p) => groups.filter((g) => groupOk(p, g)).length === 1 ? null : err$1("", doc)
		};
	},
	atLeastOneOf(...keys) {
		const doc = `at least one of: ${keys.join(", ")}`;
		return {
			doc,
			check: (p) => keys.some((k) => present(p, k)) ? null : err$1("", doc)
		};
	},
	requiredTogether(...keys) {
		const doc = `all or none of: ${keys.join(", ")}`;
		return {
			doc,
			check: (p) => {
				const n = keys.filter((k) => present(p, k)).length;
				return n === 0 || n === keys.length ? null : err$1("", doc);
			}
		};
	},
	mutuallyExclusive(...keys) {
		const doc = `at most one of: ${keys.join(", ")}`;
		return {
			doc,
			check: (p) => keys.filter((k) => present(p, k)).length <= 1 ? null : err$1("", doc)
		};
	},
	rule(doc, okFn) {
		return {
			doc,
			check: (p) => okFn(p) ? null : err$1("", doc)
		};
	}
};
var wording = (e) => e.field ? `${e.field}: ${e.reason}` : e.reason;
function defineAction(def) {
	const names = Object.freeze(typeof def.name === "string" ? [def.name] : [...def.name]);
	const rules = def.rules ? def.rules(RULES) : [];
	const parse = (raw) => {
		const out = {};
		for (const key of Object.keys(def.params)) {
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
		return ok(out);
	};
	const toHandler = (ctx) => async (params) => {
		const r = parse(params);
		if (!r.ok) return failedResponse(RETCODE.BAD_REQUEST, wording(r));
		return def.run(r.value, ctx);
	};
	return {
		kind: "normal",
		names,
		params: def.params,
		parse,
		toHandler,
		describe: () => {
			const entries = Object.entries(def.params);
			const properties = {};
			const required = [];
			for (const [name, field] of entries) {
				properties[name] = field.toJsonSchema();
				if (field.doc.required) required.push(name);
			}
			const inputSchema = {
				type: "object",
				properties,
				...required.length ? { required } : {},
				additionalProperties: true
			};
			return {
				name: names[0],
				aliases: names.slice(1),
				summary: def.summary,
				returns: def.returns,
				returnsSchema: def.returnsSchema,
				...def.examples ? { examples: def.examples } : {},
				readOnly: def.readOnly ?? false,
				params: entries.map(([name, field]) => ({
					name,
					...field.doc
				})),
				invariants: rules.map((rule) => rule.doc),
				inputSchema
			};
		}
	};
}
function defineStreamAction(def) {
	const base = defineAction({
		name: def.name,
		summary: def.summary,
		returns: def.returns,
		returnsSchema: def.returnsSchema,
		examples: def.examples,
		readOnly: def.readOnly,
		params: def.params,
		rules: def.rules,
		run: () => failedResponse(RETCODE.INTERNAL_ERROR, "stream action dispatched without a sink")
	});
	const toHandler = (ctx) => async (params, sink) => {
		const r = base.parse(params);
		if (!r.ok) return failedResponse(RETCODE.BAD_REQUEST, wording(r));
		return def.run(r.value, ctx, sink ?? NOOP_SINK);
	};
	return {
		kind: "stream",
		names: base.names,
		params: def.params,
		parse: base.parse,
		toHandler,
		describe: () => ({
			...base.describe(),
			stream: true
		})
	};
}
/** Pre-seeds `group_id` (uint, required). */
function groupAction(def) {
	const params = {
		group_id: f$1.groupId().describe("群号"),
		...def.params ?? {}
	};
	return defineAction({
		...def,
		params
	});
}
/** Pre-seeds `group_id` + `user_id` (both uint, required). */
function groupUserAction(def) {
	const params = {
		group_id: f$1.groupId().describe("群号"),
		user_id: f$1.memberId().describe("QQ 号"),
		...def.params ?? {}
	};
	return defineAction({
		...def,
		params
	});
}
export {};
