// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/actions/index.ts"
// original bundle lines 21209-21376  (166 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function validateSpecProjection(spec, doc) {
	const canonical = spec.names[0];
	if (!canonical || canonical.trim() === "") throw new Error(`Action registry invalid ${spec.kind} action: canonical name must not be empty`);
	for (const name of spec.names) if (name.trim() === "") throw new Error(`Action registry invalid ${spec.kind} action canonical "${canonical}": executable name must not be empty`);
	const aliases = spec.names.slice(1);
	if (doc.name !== canonical || doc.aliases.length !== aliases.length || doc.aliases.some((name, i) => name !== aliases[i])) throw new Error(`Action registry invalid ${spec.kind} action canonical "${canonical}": describe() names do not match executable names`);
	const documentedKind = doc.stream === true ? "stream" : "normal";
	if (documentedKind !== spec.kind) throw new Error(`Action registry invalid ${spec.kind} action canonical "${canonical}": describe() reports kind ${documentedKind}`);
}
function conflictMessage(name, first, second) {
	return [
		`Action registry conflict for executable name "${name}"`,
		`canonical "${first.canonical}" (name "${first.name}", kind ${first.kind}, role ${first.role})`,
		`canonical "${second.canonical}" (name "${second.name}", kind ${second.kind}, role ${second.role})`
	].join(": ");
}
/** Compile and validate a complete executable namespace. Exported so the
*  conflict matrix can be tested without constructing an ApiHandler. */
function compileActionRegistry(groups, rawReservations = []) {
	const actions = [];
	const executableNames = [];
	const rawActions = [];
	const byName = /* @__PURE__ */ new Map();
	const claim = (next) => {
		const previous = byName.get(next.name);
		if (previous) throw new Error(conflictMessage(next.name, previous, next));
		byName.set(next.name, next);
		executableNames.push(next);
	};
	for (const group of groups) for (const spec of group.actions) {
		const described = spec.describe();
		validateSpecProjection(spec, described);
		const canonical = spec.names[0];
		const action = Object.freeze({
			canonical,
			names: Object.freeze([...spec.names]),
			kind: spec.kind,
			category: group.category,
			doc: Object.freeze({
				...described,
				category: group.category
			}),
			spec
		});
		actions.push(action);
		action.names.forEach((name, index) => claim(Object.freeze({
			name,
			canonical,
			kind: action.kind,
			role: index === 0 ? "canonical" : "alias",
			action
		})));
	}
	for (const reservation of rawReservations) {
		if (reservation.name.trim() === "" || reservation.canonical.trim() === "") throw new Error("Action registry invalid raw action: canonical and executable name must not be empty");
		const raw = Object.freeze({
			name: reservation.name,
			canonical: reservation.canonical,
			kind: "raw",
			role: "raw"
		});
		claim(raw);
		rawActions.push(raw);
	}
	const categories = groups.map(({ category, actions: groupActions }) => Object.freeze({
		category,
		count: groupActions.length
	}));
	return Object.freeze({
		actions: Object.freeze(actions),
		executableNames: Object.freeze(executableNames),
		categories: Object.freeze(categories),
		rawActions: Object.freeze(rawActions),
		resolve: (name) => byName.get(name),
		bind: (ctx, api, rawFactories) => bindActionRegistry(executableNames, ctx, api, rawFactories)
	});
}
function bindActionRegistry(executableNames, ctx, api, rawFactories) {
	const factoryNames = new Set(Object.keys(rawFactories));
	const handlers = /* @__PURE__ */ new Map();
	for (const claim of executableNames) {
		if (claim.kind === "raw") {
			const factory = rawFactories[claim.canonical];
			if (!factory) throw new Error(`Action registry raw factory missing: canonical "${claim.canonical}" (name "${claim.name}", kind raw)`);
			factoryNames.delete(claim.canonical);
			handlers.set(claim.name, Object.freeze({
				handler: factory(api),
				canonical: claim.canonical,
				kind: "raw"
			}));
			continue;
		}
		const handler = claim.action.spec.toHandler(ctx);
		handlers.set(claim.name, Object.freeze({
			handler,
			canonical: claim.canonical,
			kind: claim.kind
		}));
	}
	if (factoryNames.size > 0) {
		const extra = [...factoryNames][0];
		throw new Error(`Action registry unexpected raw factory: canonical "${extra}" (name "${extra}", kind raw)`);
	}
	return handlers;
}
/** Every declarative action, grouped by domain category. Authored input. */
var ACTION_GROUPS = [
	{
		category: "信息",
		actions: actions$13
	},
	{
		category: "消息",
		actions: actions$12
	},
	{
		category: "好友",
		actions: actions$11
	},
	{
		category: "群信息",
		actions: actions$10
	},
	{
		category: "群管理",
		actions: actions$9
	},
	{
		category: "群文件",
		actions: actions$8
	},
	{
		category: "请求",
		actions: actions$7
	},
	{
		category: "扩展",
		actions: actions$6
	},
	{
		category: "群相册",
		actions: actions$5
	},
	{
		category: "空间",
		actions: [...actions$4, ...actions$3]
	},
	{
		category: "系统表情",
		actions
	},
	{
		category: "流式接口",
		actions: [...actions$2, ...actions$1]
	}
];
/** Hidden OneBot v11 quick-operation handler; `_async` is the NoneBot 1 alias. */
var HANDLE_QUICK_OPERATION_ACTION = ".handle_quick_operation";
/** Complete, validated runtime/docs registry. Compilation happens on import. */
var ACTION_REGISTRY = compileActionRegistry(ACTION_GROUPS, [{
	name: HANDLE_QUICK_OPERATION_ACTION,
	canonical: HANDLE_QUICK_OPERATION_ACTION
}, {
	name: ".handle_quick_operation_async",
	canonical: HANDLE_QUICK_OPERATION_ACTION
}]);
export {};
