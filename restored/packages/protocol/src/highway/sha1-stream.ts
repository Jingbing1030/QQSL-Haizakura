// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/sha1-stream.ts"
// original bundle lines 37279-37375  (95 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var SHA1_BLOCK_SIZE = 64;
var SHA1_DIGEST_SIZE = 20;
function rotl(x, n) {
	return (x << n | x >>> 32 - n) >>> 0;
}
var Sha1Stream = class {
	state = /* @__PURE__ */ new Uint32Array(5);
	count = /* @__PURE__ */ new Uint32Array(2);
	buffer = new Uint8Array(SHA1_BLOCK_SIZE);
	constructor() {
		this.reset();
	}
	reset() {
		this.state[0] = 1732584193;
		this.state[1] = 4023233417;
		this.state[2] = 2562383102;
		this.state[3] = 271733878;
		this.state[4] = 3285377520;
		this.count[0] = 0;
		this.count[1] = 0;
	}
	transform(data, offset) {
		const w = /* @__PURE__ */ new Uint32Array(80);
		const dv = new DataView(data.buffer, data.byteOffset + offset, 64);
		for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4, false);
		for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
		let a = this.state[0], b = this.state[1], c = this.state[2], d = this.state[3], e = this.state[4];
		for (let i = 0; i < 80; i++) {
			let temp;
			if (i < 20) temp = (b & c | ~b & d) + 1518500249;
			else if (i < 40) temp = (b ^ c ^ d) + 1859775393;
			else if (i < 60) temp = (b & c | b & d | c & d) + 2400959708;
			else temp = (b ^ c ^ d) + 3395469782;
			temp = temp + rotl(a, 5) + e + w[i] >>> 0;
			e = d;
			d = c;
			c = rotl(b, 30);
			b = a;
			a = temp;
		}
		this.state[0] = this.state[0] + a >>> 0;
		this.state[1] = this.state[1] + b >>> 0;
		this.state[2] = this.state[2] + c >>> 0;
		this.state[3] = this.state[3] + d >>> 0;
		this.state[4] = this.state[4] + e >>> 0;
	}
	update(data) {
		const len = data.length;
		let index = this.count[0] >>> 3 & 63;
		this.count[0] = this.count[0] + (len << 3) >>> 0;
		if (this.count[0] < len << 3) this.count[1] = this.count[1] + 1 >>> 0;
		this.count[1] = this.count[1] + (len >>> 29) >>> 0;
		let partLen = SHA1_BLOCK_SIZE - index;
		let i = 0;
		if (len >= partLen) {
			this.buffer.set(data.subarray(0, partLen), index);
			this.transform(this.buffer, 0);
			i = partLen;
			while (i + SHA1_BLOCK_SIZE <= len) {
				this.transform(data, i);
				i += SHA1_BLOCK_SIZE;
			}
			index = 0;
		}
		this.buffer.set(data.subarray(i), index);
	}
	/** 输出当前 state（20B）。littleEndian=true 小端，false 大端。不 finalize。 */
	hash(littleEndian) {
		const digest = new Uint8Array(SHA1_DIGEST_SIZE);
		const dv = new DataView(digest.buffer);
		for (let i = 0; i < 5; i++) if (littleEndian) dv.setUint32(i * 4, this.state[i], true);
		else dv.setUint32(i * 4, this.state[i], false);
		return digest;
	}
};
/**
* 计算闪传 sliceupload 的 Sha1StateV（累积 SHA1 state list）。
* states[i] = SHA1 中间 state（从初始 state 处理 file[0:(i+1)*sliceSize] 后，无 finalize，小端 20B）。
* 最后一片 states[last] = 标准整文件 SHA1（有 finalize）。
*
* 用单个 Sha1Stream 增量 update：每片只喂新增的 sliceSize 字节再快照，O(n)。
* （sliceSize=1MB 是 SHA1 块大小 64B 的整数倍，增量 update 不会残留半块。）
*/
function computeSha1StateV(bytes, sliceCount, sliceSize) {
	const states = [];
	const sha1 = new Sha1Stream();
	for (let i = 0; i < sliceCount; i++) {
		const start = i * sliceSize;
		const end = Math.min(start + sliceSize, bytes.length);
		sha1.update(bytes.subarray(start, end));
		if (i !== sliceCount - 1) states.push(sha1.hash(true));
		else states.push(new Uint8Array(createHash("sha1").update(Buffer.from(bytes)).digest()));
	}
	return states;
}
export {};
