// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/qq-account/sqlcipher.ts"
// original bundle lines 3164-3471  (306 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/**
* SQLCipher v4 page decryption for QQ NT's local databases.
*
* QQ NT stores every database under `nt_db/` as a SQLCipher v4 stream behind a
* 1024-byte client header:
*
*   [ 1024-byte client header ][ page 1 ][ page 2 ] ...
*                               ^ KDF salt = first 16 bytes of page 1
*
* Each page ends with `IV (16 bytes) || page HMAC`, rounded up to the AES block
* size; the page size is 4096 on every database QQ writes. Page 1's ciphertext
* starts after its 16-byte salt, which replaces the plaintext "SQLite format 3"
* magic — so the decrypted body of page 1 starts at page offset 16 and can never
* contain that magic. A candidate key is therefore confirmed by recomputing the
* page HMAC over the *ciphertext*, which is independent of the AES pass.
*
* The page-HMAC and KDF-HMAC algorithms are not fixed across client builds, so
* they are probed per database (12 combinations) instead of assumed.
*/
/** QQ NT prepends this many bytes before the SQLCipher stream. */
var DATABASE_HEADER_SIZE = 1024;
var PAGE_SIZE = 4096;
var SALT_SIZE = 16;
var IV_SIZE = 16;
var KEY_SIZE = 32;
/** SQLCipher v4 derives the AES key with this many PBKDF2 iterations. */
var KDF_ITERATIONS = 4e3;
/** The per-page HMAC key uses a fast derivation over the page salt. */
var HMAC_KEY_ITERATIONS = 2;
/** SQLCipher's HMAC salt is the page salt XOR this mask. */
var HMAC_SALT_MASK = 58;
var WAL_HEADER_SIZE = 32;
var WAL_FRAME_HEADER_SIZE = 24;
var SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
/** Every pair to probe, in order: `cipher_use_hmac = OFF` first, then each digest. */
var PAGE_HMAC_ALGORITHMS = [
	"none",
	"sha1",
	"sha256",
	"sha512"
];
var KDF_HMAC_ALGORITHMS = [
	"sha1",
	"sha256",
	"sha512"
];
var PAGE_HMAC_DIGEST_BYTES = {
	none: 0,
	sha1: 20,
	sha256: 32,
	sha512: 64
};
/**
* Probe the algorithm pair of an encrypted database.
*
* Returns null when the page-1 HMAC matches no combination under `passphrase`,
* which means either the passphrase or the file layout is not what we expect.
*/
function detectAlgorithm(image, passphrase) {
	const pageOne = readPageOne(image);
	if (!pageOne) return null;
	const salt = pageOne.subarray(0, SALT_SIZE);
	for (const pageHmac of PAGE_HMAC_ALGORITHMS) for (const kdfHmac of KDF_HMAC_ALGORITHMS) {
		const algorithm = {
			pageHmac,
			kdfHmac
		};
		if (verifyPageOne(pageOne, deriveKey(passphrase, salt, kdfHmac), algorithm)) return algorithm;
	}
	return null;
}
/**
* Decrypt a whole database and fold in the `-wal` sidecar when there is one.
*
* QQ keeps a long-lived WAL, so everything committed since the last checkpoint
* — including an account that just signed in — lives only in the sidecar.
* Returns null when the image cannot be decrypted.
*/
function decryptDatabase(image, wal, passphrase, algorithm) {
	const pageOne = readPageOne(image);
	if (!pageOne) return null;
	const key = deriveKey(passphrase, pageOne.subarray(0, SALT_SIZE), algorithm.kdfHmac);
	const base = decryptPages(image, key, algorithm);
	if (!base) return null;
	const merged = applyWal(base, wal, key, algorithm);
	normalizeImage(merged.image);
	return merged;
}
/** Page 1 as stored, or null when the file is too short to hold a header + page 1. */
function readPageOne(image) {
	if (image.length < 5120) return null;
	return image.subarray(DATABASE_HEADER_SIZE, 5120);
}
/** Per-page reserve = IV + page HMAC digest, rounded up to the AES block size. */
function reserveBytes(algorithm) {
	const digestBytes = PAGE_HMAC_DIGEST_BYTES[algorithm.pageHmac];
	return Math.ceil((IV_SIZE + digestBytes) / 16) * 16;
}
function deriveKey(passphrase, salt, kdfHmac) {
	return pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, KEY_SIZE, kdfHmac);
}
/**
* Confirm a candidate key against page 1.
*
* With the page HMAC enabled the check runs over the stored ciphertext, exactly
* like SQLCipher's own verification. With HMAC off there is nothing to verify on
* the ciphertext, so page 1 is decrypted and the SQLite header fields that live
* past the salt-occupied first 16 bytes are checked instead.
*/
function verifyPageOne(pageOne, key, algorithm) {
	const reserve = reserveBytes(algorithm);
	const digestBytes = PAGE_HMAC_DIGEST_BYTES[algorithm.pageHmac];
	if (digestBytes === 0) {
		const body = decryptPageBody(pageOne, key, SALT_SIZE, reserve);
		return body !== null && hasSqliteHeaderFields(body);
	}
	const hmacSalt = Buffer.alloc(SALT_SIZE);
	for (let index = 0; index < SALT_SIZE; index++) hmacSalt[index] = pageOne[index] ^ HMAC_SALT_MASK;
	const hmacKey = pbkdf2Sync(key, hmacSalt, HMAC_KEY_ITERATIONS, KEY_SIZE, algorithm.kdfHmac);
	const bodyEnd = PAGE_SIZE - reserve;
	const pageNumber = Buffer.alloc(4);
	pageNumber.writeUInt32LE(1);
	const input = Buffer.concat([
		pageOne.subarray(SALT_SIZE, bodyEnd),
		pageOne.subarray(bodyEnd, bodyEnd + IV_SIZE),
		pageNumber
	]);
	return equalsBytes(createHmac(algorithm.pageHmac, hmacKey).update(input).digest(), pageOne.subarray(bodyEnd + IV_SIZE, bodyEnd + IV_SIZE + digestBytes));
}
/** The decrypted page-1 body starts at file offset 16 (the salt replaces 0..16). */
function hasSqliteHeaderFields(body) {
	if (body.length < 8) return false;
	const pageSize = body.readUInt16BE(0);
	return (pageSize === 1 || pageSize >= 512 && (pageSize & pageSize - 1) === 0) && body[5] === 64 && body[6] === 32 && body[7] === 32;
}
function equalsBytes(left, right) {
	if (left.length !== right.length) return false;
	let diff = 0;
	for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
	return diff === 0;
}
/**
* Decrypt every page of the main file, in place on a fresh buffer.
*
* `skip` drops the salt prefix of page 1; the reserve region of each page is
* left zeroed, which is how SQLCipher lays the plaintext out.
*/
function decryptPages(image, key, algorithm) {
	const stream = image.subarray(DATABASE_HEADER_SIZE);
	const pageCount = Math.floor(stream.length / PAGE_SIZE);
	if (pageCount === 0) return null;
	const reserve = reserveBytes(algorithm);
	const plain = Buffer.alloc(pageCount * PAGE_SIZE);
	for (let index = 0; index < pageCount; index++) {
		const pageNumber = index + 1;
		const body = decryptPageBody(stream.subarray(index * PAGE_SIZE, (index + 1) * PAGE_SIZE), key, pageNumber === 1 ? SALT_SIZE : 0, reserve);
		if (body === null) return null;
		writePlaintextPage(plain, index * PAGE_SIZE, pageNumber, body);
	}
	return plain;
}
/** Decrypt one page body, or null when the page cannot hold an IV + digest. */
function decryptPageBody(page, key, skip, reserve) {
	const cipherLength = PAGE_SIZE - skip - reserve;
	if (cipherLength <= 0) return null;
	const ciphertext = page.subarray(skip, skip + cipherLength);
	const decipher = createDecipheriv("aes-256-cbc", key, page.subarray(skip + cipherLength, skip + cipherLength + IV_SIZE));
	decipher.setAutoPadding(false);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
/**
* Write one decrypted page into the plaintext image.
*
* Page 1 is special in both the main file and the WAL: its first 16 on-disk
* bytes hold the KDF salt in place of SQLite's magic, so the magic and the
* page-size field have to be restored. Every other page's body starts at offset
* 0 of the page.
*/
function writePlaintextPage(image, offset, pageNumber, body) {
	if (pageNumber !== 1) {
		body.copy(image, offset, 0, Math.min(body.length, PAGE_SIZE));
		return;
	}
	SQLITE_MAGIC.copy(image, offset);
	body.copy(image, offset + SALT_SIZE, 0, Math.min(body.length, PAGE_SIZE - SALT_SIZE));
	image.writeUInt16BE(PAGE_SIZE, offset + 16);
}
/**
* Fold the `-wal` sidecar into a decrypted image and return the frame count.
*
* A WAL is not wrapped in SQLCipher's envelope the way the main file is: its
* 32-byte header and every 24-byte frame header stay plaintext, and each frame
* carries one encrypted page (page 1 keeping its salt prefix). SQLite's frame
* checksums are computed over the frames *as stored*, i.e. over the ciphertext,
* which is why the intact prefix is established before any decryption.
*
* Only frames up to the last commit are applied, and the database size recorded
* by that commit decides how many pages the merged image has — a torn tail from
* a running QQ therefore contributes nothing.
*/
function applyWal(base, wal, key, algorithm) {
	const log = wal === null ? null : parseWal(wal);
	if (!log || log.frames.length === 0) return {
		image: base,
		walFrames: 0
	};
	let lastCommit = -1;
	for (let index = 0; index < log.frames.length; index++) if (log.frames[index].commitSize !== 0) lastCommit = index;
	if (lastCommit < 0) return {
		image: base,
		walFrames: 0
	};
	const pageCount = log.frames[lastCommit].commitSize;
	const basePageCount = base.length / PAGE_SIZE;
	if (pageCount < 1 || pageCount > basePageCount + log.frames.length) return {
		image: base,
		walFrames: 0
	};
	const merged = Buffer.alloc(pageCount * PAGE_SIZE);
	base.copy(merged, 0, 0, Math.min(base.length, merged.length));
	const reserve = reserveBytes(algorithm);
	for (let index = 0; index <= lastCommit; index++) {
		const frame = log.frames[index];
		if (frame.pageNumber === 0 || frame.pageNumber > pageCount) continue;
		const body = decryptPageBody(wal.subarray(frame.offset, frame.offset + PAGE_SIZE), key, frame.pageNumber === 1 ? SALT_SIZE : 0, reserve);
		if (body === null) return {
			image: base,
			walFrames: 0
		};
		writePlaintextPage(merged, (frame.pageNumber - 1) * PAGE_SIZE, frame.pageNumber, body);
	}
	return {
		image: merged,
		walFrames: lastCommit + 1
	};
}
/**
* Validate a `-wal` buffer and collect its intact frames.
*
* Validation stops at the first frame whose checksum does not continue the
* chain, mirroring SQLite's own recovery: everything after that frame is either
* half-written or belongs to an aborted transaction.
*/
function parseWal(wal) {
	if (wal.length < 4152) return null;
	const magic = wal.readUInt32BE(0);
	const littleEndian = magic === 931071618 ? true : magic === 931071619 ? false : null;
	if (littleEndian === null || wal.readUInt32BE(8) !== PAGE_SIZE) return null;
	const header = walChecksum([0, 0], [wal.subarray(0, WAL_HEADER_SIZE - 8)], littleEndian);
	if (header[0] !== wal.readUInt32BE(24) || header[1] !== wal.readUInt32BE(28)) return null;
	const frameSize = 4120;
	const frames = [];
	let running = header;
	for (let offset = WAL_HEADER_SIZE; offset + frameSize <= wal.length; offset += frameSize) {
		const frameHeader = wal.subarray(offset, offset + WAL_FRAME_HEADER_SIZE);
		const page = wal.subarray(offset + WAL_FRAME_HEADER_SIZE, offset + frameSize);
		running = walChecksum(running, [frameHeader.subarray(0, 8), page], littleEndian);
		if (running[0] !== frameHeader.readUInt32BE(16) || running[1] !== frameHeader.readUInt32BE(20)) break;
		frames.push({
			pageNumber: frameHeader.readUInt32BE(0),
			commitSize: frameHeader.readUInt32BE(4),
			offset: offset + WAL_FRAME_HEADER_SIZE
		});
	}
	return {
		frames,
		littleEndian
	};
}
/**
* SQLite's rolling WAL checksum: two 32-bit accumulators advanced over 8-byte
* word pairs. The byte order is fixed by the WAL magic (`0x377f0682` =
* little-endian words, `0x377f0683` = big-endian) and is unrelated to the
* host's byte order.
*
* Every chunk fed in here is a multiple of 8 bytes: the header contributes 24
* bytes, a frame its first 8 header bytes plus a whole page.
*/
function walChecksum(seed, chunks, littleEndian) {
	let first = seed[0];
	let second = seed[1];
	for (const chunk of chunks) for (let offset = 0; offset + 8 <= chunk.length; offset += 8) {
		const high = littleEndian ? chunk.readUInt32LE(offset) : chunk.readUInt32BE(offset);
		const low = littleEndian ? chunk.readUInt32LE(offset + 4) : chunk.readUInt32BE(offset + 4);
		first = first + high + second >>> 0;
		second = second + low + first >>> 0;
	}
	return [first, second];
}
/**
* Make the assembled image self-consistent before it is handed to SQLite.
*
* The merge can add or remove pages relative to the base image, and the header
* fields that describe the database are only trusted while page 1's change
* counter and version-valid-for agree. The write/read version bytes are reset
* to the legacy journal so the image can be opened read-only without needing a
* `-wal`/`-shm` pair next to it.
*/
function normalizeImage(image) {
	const pageCount = image.length / PAGE_SIZE;
	const changeCounter = image.readUInt32BE(24);
	image[18] = 1;
	image[19] = 1;
	image.writeUInt32BE(pageCount, 28);
	image.writeUInt32BE(changeCounter, 92);
}
export {};
