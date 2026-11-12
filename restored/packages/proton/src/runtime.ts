// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../proton/src/runtime.ts"
// original bundle lines 18779-18806  (26 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var PROTOBUF_UNKNOWN_FIELDS = Symbol.for("snowluma.proton.unknownFields");
var EMPTY_UNKNOWN_FIELD_METADATA = Object.freeze({
	fields: Object.freeze([]),
	totalOccurrences: 0,
	omittedOccurrences: 0,
	omittedByteLength: 0
});
/** Unknown wire tags retained by generated decoders. The symbol-backed
* metadata is non-enumerable, so decoded object shapes and re-encoding remain
* unchanged while protocol boundaries can make schema drift observable. */
function protobuf_getUnknownFields(value) {
	return protobuf_getUnknownFieldMetadata(value).fields;
}
function protobuf_getUnknownFieldMetadata(value) {
	if (typeof value !== "object" || value === null) return EMPTY_UNKNOWN_FIELD_METADATA;
	const metadata = value[PROTOBUF_UNKNOWN_FIELDS];
	if (typeof metadata !== "object" || metadata === null) return EMPTY_UNKNOWN_FIELD_METADATA;
	const candidate = metadata;
	if (!Array.isArray(candidate.fields)) return EMPTY_UNKNOWN_FIELD_METADATA;
	return {
		fields: candidate.fields,
		totalOccurrences: candidate.totalOccurrences ?? candidate.fields.length,
		omittedOccurrences: candidate.omittedOccurrences ?? 0,
		omittedByteLength: candidate.omittedByteLength ?? 0
	};
}
export {};
