// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/hash-file.ts"
// original bundle lines 37376-37471  (94 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var SHA1_STREAM_BLOCK_SIZE = 1024 * 1024;
/**
* Hash a file on disk in a single streaming pass. Equivalent to
* `computeHashes` + `computeVideoSha1Blocks` (+ `computeMd5(bytes[0:headLimit])`
* when `headLimit` is given) over the file's bytes, without buffering the file.
*/
async function hashFileStreaming(filePath, opts) {
	const { size } = await promises$1.stat(filePath);
	const src = await FileChunkSource.open(filePath, size);
	try {
		const md5 = createHash$1("md5");
		const sha1 = createHash$1("sha1");
		const headLimit = opts?.headLimit;
		const headMd5 = headLimit !== void 0 ? createHash$1("md5") : null;
		let headRemaining = headLimit ?? 0;
		const blockSha1 = new Sha1Stream();
		const sha1Blocks = [];
		let offset = 0;
		while (offset < size) {
			const len = Math.min(SHA1_STREAM_BLOCK_SIZE, size - offset);
			const chunk = await src.read(offset, len);
			md5.update(chunk);
			sha1.update(chunk);
			if (headMd5 && headRemaining > 0) {
				const take = Math.min(headRemaining, chunk.length);
				headMd5.update(chunk.subarray(0, take));
				headRemaining -= take;
			}
			if (len === SHA1_STREAM_BLOCK_SIZE) {
				blockSha1.update(chunk);
				sha1Blocks.push(blockSha1.hash(true));
			}
			offset += len;
		}
		const sha1Digest = sha1.digest();
		sha1Blocks.push(new Uint8Array(sha1Digest));
		const md5Digest = md5.digest();
		return {
			md5: new Uint8Array(md5Digest),
			sha1: new Uint8Array(sha1Digest),
			md5Hex: md5Digest.toString("hex"),
			sha1Hex: sha1Digest.toString("hex"),
			sha1Blocks,
			headMd5: headMd5 ? new Uint8Array(headMd5.digest()) : void 0
		};
	} finally {
		await src.close();
	}
}
/**
* Streaming hash for flash-transfer sliceupload. Equivalent to
* `computeHashes` + `computeSha1StateV(bytes, ceil(size/1MiB), 1MiB)`
* without buffering the file.
*
* Do not substitute `hashFileStreaming().sha1Blocks`: when
* `size % 1 MiB === 0` that list has an extra un-finalized last-slice
* state that flash's Sha1StateV must not carry.
*/
async function hashFlashFileStreaming(filePath) {
	const { size } = await promises$1.stat(filePath);
	const sliceCount = Math.ceil(size / SHA1_STREAM_BLOCK_SIZE);
	const src = await FileChunkSource.open(filePath, size);
	try {
		const md5 = createHash$1("md5");
		const sha1 = createHash$1("sha1");
		const blockSha1 = new Sha1Stream();
		const sha1StateV = [];
		let offset = 0;
		let sliceIndex = 0;
		while (offset < size) {
			const len = Math.min(SHA1_STREAM_BLOCK_SIZE, size - offset);
			const chunk = await src.read(offset, len);
			md5.update(chunk);
			sha1.update(chunk);
			blockSha1.update(chunk);
			if (sliceIndex !== sliceCount - 1) sha1StateV.push(blockSha1.hash(true));
			offset += len;
			sliceIndex += 1;
		}
		const sha1Digest = sha1.digest();
		if (sliceCount > 0) sha1StateV.push(new Uint8Array(sha1Digest));
		const md5Digest = md5.digest();
		return {
			md5: new Uint8Array(md5Digest),
			sha1: new Uint8Array(sha1Digest),
			md5Hex: md5Digest.toString("hex"),
			sha1Hex: sha1Digest.toString("hex"),
			sha1StateV,
			sliceCount
		};
	} finally {
		await src.close();
	}
}
export {};
