init_logger();
init_utils();
var __te$29 = new TextEncoder();
var __nonAscii$29 = /[^\x00-\x7f]/;
var __utf8Scratch$29;
function __utf8LenLong$29(value) {
	const buffer = __utf8Scratch$29 ??= /* @__PURE__ */ new Uint8Array(4096);
	let length = 0;
	for (;;) {
		const result = __te$29.encodeInto(value, buffer);
		length += result.written;
		if (result.read === value.length) return length;
		value = value.slice(result.read);
	}
}
function __utf8Len$29(value) {
	if (value.length >= 32) return __utf8LenLong$29(value);
	if (value.length >= 8 && value.charCodeAt(0) < 128 && !__nonAscii$29.test(value)) return value.length;
	let length = 0;
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 128) {
			length++;
			continue;
		}
		if (code < 2048) {
			length += 2;
			continue;
		}
		if ((code & 64512) === 55296) {
			if (i + 1 < value.length) {
				if ((value.charCodeAt(i + 1) & 64512) === 56320) {
					length += 4;
					i++;
					continue;
				}
			}
			length += 3;
			continue;
		}
		if ((code & 64512) === 56320) {
			length += 3;
			continue;
		}
		length += 3;
	}
	return length;
}
function __utf8Write$29(buf, offset, value) {
	for (let i = 0; i < value.length; i++) {
		let code = value.charCodeAt(i);
		if (code < 128) {
			buf[offset++] = code;
			continue;
		}
		if (code < 2048) {
			buf[offset++] = 192 | code >> 6;
			buf[offset++] = 128 | code & 63;
			continue;
		}
		if ((code & 64512) === 55296) {
			if (i + 1 < value.length) {
				const next = value.charCodeAt(i + 1);
				if ((next & 64512) === 56320) {
					const point = (code - 55296 << 10) + (next - 56320) + 65536;
					buf[offset++] = 240 | point >> 18;
					buf[offset++] = 128 | point >> 12 & 63;
					buf[offset++] = 128 | point >> 6 & 63;
					buf[offset++] = 128 | point & 63;
					i++;
					continue;
				}
			}
			code = 65533;
		} else if ((code & 64512) === 56320) code = 65533;
		buf[offset++] = 224 | code >> 12;
		buf[offset++] = 128 | code >> 6 & 63;
		buf[offset++] = 128 | code & 63;
	}
	return offset;
}
function __utf8WriteLong$29(buf, offset, value) {
	return offset + __te$29.encodeInto(value, buf.subarray(offset)).written;
}
function __asciiWrite$29(buf, offset, value) {
	let i = 0;
	for (; i + 7 < value.length; i += 8) {
		buf[offset++] = value.charCodeAt(i);
		buf[offset++] = value.charCodeAt(i + 1);
		buf[offset++] = value.charCodeAt(i + 2);
		buf[offset++] = value.charCodeAt(i + 3);
		buf[offset++] = value.charCodeAt(i + 4);
		buf[offset++] = value.charCodeAt(i + 5);
		buf[offset++] = value.charCodeAt(i + 6);
		buf[offset++] = value.charCodeAt(i + 7);
	}
	for (; i < value.length; i++) buf[offset++] = value.charCodeAt(i);
	return offset;
}
var __pool$29;
var __poolOffset$29 = 0;
function __allocate$29(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$29;
	if (!buffer || __poolOffset$29 + size > buffer.length) {
		buffer = __pool$29 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$29 = 0;
	}
	const start = __poolOffset$29;
	__poolOffset$29 += size;
	return buffer.subarray(start, start + size);
}
function __varint64Size$10(value) {
	if (value < 128n) return 1;
	const hi = Number(value >> 32n);
	return ((hi ? 64 - Math.clz32(hi) : 32 - Math.clz32(Number(value))) + 6) / 7 | 0;
}
function __writeVarint64$10(buf, offset, value) {
	let lo = Number(value & 4294967295n) >>> 0;
	let hi = Number(value >> 32n) >>> 0;
	while (hi || lo > 127) {
		buf[offset++] = lo & 127 | 128;
		lo = (lo >>> 7 | hi << 25) >>> 0;
		hi >>>= 7;
	}
	buf[offset++] = lo;
	return offset;
}
function protobuf_encode_FileUploadExt(obj) {
	const sizes = [1];
	const size = __size_FileUploadExt(obj, sizes);
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$29(size);
	__write_FileUploadExt(obj, buf, 0, sizes);
	return buf;
}
function __size_FileUploadExt(obj, sizes) {
	let size = 0;
	const _f0 = obj["unknown1"];
	const _f1 = obj["unknown2"];
	const _f2 = obj["unknown3"];
	const _f3 = obj["entry"];
	const _f4 = obj["unknown200"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0) {
		const _val = _f1 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadEntry(_f3, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadExt(obj, buf, offset, sizes) {
	const _f0 = obj["unknown1"];
	const _f1 = obj["unknown2"];
	const _f2 = obj["unknown3"];
	const _f3 = obj["entry"];
	const _f4 = obj["unknown200"];
	if (_f0 != null && _f0 !== 0) {
		buf[offset++] = 8;
		let _v = _f0 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f1 != null && _f1 !== 0) {
		buf[offset++] = 16;
		let _v = _f1 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f2 != null && _f2 !== 0) {
		buf[offset++] = 24;
		let _v = _f2 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f3 != null) {
		buf[offset++] = 162;
		buf[offset++] = 6;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadEntry(_f3, buf, offset, sizes);
	}
	if (_f4 != null && _f4 !== 0) {
		buf[offset++] = 192;
		buf[offset++] = 12;
		let _v = _f4 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	return offset;
}
function __size_FileUploadEntry(obj, sizes) {
	let size = 0;
	const _f0 = obj["busiBuff"];
	const _f1 = obj["fileEntry"];
	const _f2 = obj["clientInfo"];
	const _f3 = obj["fileNameInfo"];
	const _f4 = obj["host"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadBusiInfo(_f0, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadFileEntry(_f1, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadClientInfo(_f2, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadNameInfo(_f3, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadHostConfig(_f4, sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadEntry(obj, buf, offset, sizes) {
	const _f0 = obj["busiBuff"];
	const _f1 = obj["fileEntry"];
	const _f2 = obj["clientInfo"];
	const _f3 = obj["fileNameInfo"];
	const _f4 = obj["host"];
	if (_f0 != null) {
		buf[offset++] = 162;
		buf[offset++] = 6;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadBusiInfo(_f0, buf, offset, sizes);
	}
	if (_f1 != null) {
		buf[offset++] = 194;
		buf[offset++] = 12;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadFileEntry(_f1, buf, offset, sizes);
	}
	if (_f2 != null) {
		buf[offset++] = 226;
		buf[offset++] = 18;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadClientInfo(_f2, buf, offset, sizes);
	}
	if (_f3 != null) {
		buf[offset++] = 130;
		buf[offset++] = 25;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadNameInfo(_f3, buf, offset, sizes);
	}
	if (_f4 != null) {
		buf[offset++] = 162;
		buf[offset++] = 31;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadHostConfig(_f4, buf, offset, sizes);
	}
	return offset;
}
function __size_FileUploadBusiInfo(obj, sizes) {
	let size = 0;
	const _f0 = obj["busId"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["receiverUin"];
	const _f3 = obj["groupCode"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0n) size += 2 + __varint64Size$10(BigInt.asUintN(64, _f1));
	if (_f2 != null && _f2 !== 0n) size += 2 + __varint64Size$10(BigInt.asUintN(64, _f2));
	if (_f3 != null && _f3 !== 0n) size += 2 + __varint64Size$10(BigInt.asUintN(64, _f3));
	return size;
}
function __write_FileUploadBusiInfo(obj, buf, offset, sizes) {
	const _f0 = obj["busId"];
	const _f1 = obj["senderUin"];
	const _f2 = obj["receiverUin"];
	const _f3 = obj["groupCode"];
	if (_f0 != null && _f0 !== 0) {
		buf[offset++] = 8;
		let _v = _f0 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 160;
		buf[offset++] = 6;
		offset = __writeVarint64$10(buf, offset, BigInt.asUintN(64, _f1));
	}
	if (_f2 != null && _f2 !== 0n) {
		buf[offset++] = 192;
		buf[offset++] = 12;
		offset = __writeVarint64$10(buf, offset, BigInt.asUintN(64, _f2));
	}
	if (_f3 != null && _f3 !== 0n) {
		buf[offset++] = 128;
		buf[offset++] = 25;
		offset = __writeVarint64$10(buf, offset, BigInt.asUintN(64, _f3));
	}
	return offset;
}
function __size_FileUploadFileEntry(obj, sizes) {
	let size = 0;
	const _f0 = obj["fileSize"];
	const _f1 = obj["md5"];
	const _f2 = obj["checkKey"];
	const _f3 = obj["md5S2"];
	const _f4 = obj["fileId"];
	const _f5 = obj["uploadKey"];
	if (_f0 != null && _f0 !== 0n) size += 2 + __varint64Size$10(BigInt.asUintN(64, _f0));
	if (_f1 != null && _f1.length > 0) {
		const _len = _f1.length;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2.length > 0) {
		const _len = _f2.length;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3.length > 0) {
		const _len = _f3.length;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== "") {
		const _len = __utf8Len$29(_f4);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5.length > 0) {
		const _len = _f5.length;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadFileEntry(obj, buf, offset, sizes) {
	const _f0 = obj["fileSize"];
	const _f1 = obj["md5"];
	const _f2 = obj["checkKey"];
	const _f3 = obj["md5S2"];
	const _f4 = obj["fileId"];
	const _f5 = obj["uploadKey"];
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 160;
		buf[offset++] = 6;
		offset = __writeVarint64$10(buf, offset, BigInt.asUintN(64, _f0));
	}
	if (_f1 != null && _f1.length > 0) {
		buf[offset++] = 194;
		buf[offset++] = 12;
		const _len = _f1.length;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		buf.set(_f1, offset);
		offset += _len;
	}
	if (_f2 != null && _f2.length > 0) {
		buf[offset++] = 226;
		buf[offset++] = 18;
		const _len = _f2.length;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		buf.set(_f2, offset);
		offset += _len;
	}
	if (_f3 != null && _f3.length > 0) {
		buf[offset++] = 130;
		buf[offset++] = 25;
		const _len = _f3.length;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		buf.set(_f3, offset);
		offset += _len;
	}
	if (_f4 != null && _f4 !== "") {
		buf[offset++] = 194;
		buf[offset++] = 37;
		const _len = sizes[sizes[0]++];
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$29(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$29(buf, offset, _f4) : __utf8Write$29(buf, offset, _f4);
	}
	if (_f5 != null && _f5.length > 0) {
		buf[offset++] = 226;
		buf[offset++] = 43;
		const _len = _f5.length;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		buf.set(_f5, offset);
		offset += _len;
	}
	return offset;
}
function __size_FileUploadClientInfo(obj, sizes) {
	let size = 0;
	const _f0 = obj["clientType"];
	const _f1 = obj["appId"];
	const _f2 = obj["terminalType"];
	const _f3 = obj["clientVer"];
	const _f4 = obj["unknown"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$29(_f1);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f2 != null && _f2 !== 0) {
		const _val = _f2 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f3 != null && _f3 !== "") {
		const _len = __utf8Len$29(_f3);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null && _f4 !== 0) {
		const _val = _f4 >>> 0;
		size += 2;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadClientInfo(obj, buf, offset, sizes) {
	const _f0 = obj["clientType"];
	const _f1 = obj["appId"];
	const _f2 = obj["terminalType"];
	const _f3 = obj["clientVer"];
	const _f4 = obj["unknown"];
	if (_f0 != null && _f0 !== 0) {
		buf[offset++] = 160;
		buf[offset++] = 6;
		let _v = _f0 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f1 != null && _f1 !== "") {
		buf[offset++] = 194;
		buf[offset++] = 12;
		const _len = sizes[sizes[0]++];
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$29(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$29(buf, offset, _f1) : __utf8Write$29(buf, offset, _f1);
	}
	if (_f2 != null && _f2 !== 0) {
		buf[offset++] = 224;
		buf[offset++] = 18;
		let _v = _f2 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f3 != null && _f3 !== "") {
		buf[offset++] = 130;
		buf[offset++] = 25;
		const _len = sizes[sizes[0]++];
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$29(buf, offset, _f3) : _len === _f3.length ? __asciiWrite$29(buf, offset, _f3) : __utf8Write$29(buf, offset, _f3);
	}
	if (_f4 != null && _f4 !== 0) {
		buf[offset++] = 192;
		buf[offset++] = 37;
		let _v = _f4 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	return offset;
}
function __size_FileUploadNameInfo(obj, sizes) {
	let size = 0;
	const _f0 = obj["fileName"];
	if (_f0 != null && _f0 !== "") {
		const _len = __utf8Len$29(_f0);
		sizes.push(_len);
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadNameInfo(obj, buf, offset, sizes) {
	const _f0 = obj["fileName"];
	if (_f0 != null && _f0 !== "") {
		buf[offset++] = 162;
		buf[offset++] = 6;
		const _len = sizes[sizes[0]++];
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$29(buf, offset, _f0) : _len === _f0.length ? __asciiWrite$29(buf, offset, _f0) : __utf8Write$29(buf, offset, _f0);
	}
	return offset;
}
function __size_FileUploadHostConfig(obj, sizes) {
	let size = 0;
	const _f0 = obj["hosts"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadHost(_f0[_i], sizes);
		sizes[_slot] = _len;
		size += 2 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadHostConfig(obj, buf, offset, sizes) {
	const _f0 = obj["hosts"];
	if (_f0 != null && _f0.length > 0) for (let _i = 0; _i < _f0.length; _i++) {
		buf[offset++] = 194;
		buf[offset++] = 12;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadHost(_f0[_i], buf, offset, sizes);
	}
	return offset;
}
function __size_FileUploadHost(obj, sizes) {
	let size = 0;
	const _f0 = obj["url"];
	const _f1 = obj["port"];
	if (_f0 != null) {
		const _slot = sizes.length;
		sizes.push(0);
		const _len = __size_FileUploadUrl(_f0, sizes);
		sizes[_slot] = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== 0) {
		const _val = _f1 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadHost(obj, buf, offset, sizes) {
	const _f0 = obj["url"];
	const _f1 = obj["port"];
	if (_f0 != null) {
		buf[offset++] = 10;
		let _v = sizes[sizes[0]++];
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = __write_FileUploadUrl(_f0, buf, offset, sizes);
	}
	if (_f1 != null && _f1 !== 0) {
		buf[offset++] = 16;
		let _v = _f1 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	return offset;
}
function __size_FileUploadUrl(obj, sizes) {
	let size = 0;
	const _f0 = obj["unknown"];
	const _f1 = obj["host"];
	if (_f0 != null && _f0 !== 0) {
		const _val = _f0 >>> 0;
		size += 1;
		size += _val < 128 ? 1 : _val < 16384 ? 2 : _val < 2097152 ? 3 : _val < 268435456 ? 4 : 5;
	}
	if (_f1 != null && _f1 !== "") {
		const _len = __utf8Len$29(_f1);
		sizes.push(_len);
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	return size;
}
function __write_FileUploadUrl(obj, buf, offset, sizes) {
	const _f0 = obj["unknown"];
	const _f1 = obj["host"];
	if (_f0 != null && _f0 !== 0) {
		buf[offset++] = 8;
		let _v = _f0 >>> 0;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
	}
	if (_f1 != null && _f1 !== "") {
		buf[offset++] = 18;
		const _len = sizes[sizes[0]++];
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$29(buf, offset, _f1) : _len === _f1.length ? __asciiWrite$29(buf, offset, _f1) : __utf8Write$29(buf, offset, _f1);
	}
	return offset;
}
var log$28 = createLogger("GroupFile");
function normalizeDirectory(dir) {
	if (!dir || !dir.trim()) return "/";
	return dir;
}
function int32ToIpv4Dotted(value) {
	return `${value & 255}.${value >>> 8 & 255}.${value >>> 16 & 255}.${value >>> 24 & 255}`;
}
function normalizeUploadFileName(name, fallback) {
	const trimmed = name.trim();
	if (trimmed) return trimmed;
	return fallback.trim() || "file.bin";
}
var MD5_HEAD_LIMIT = 10002432;
/** Fail cleanly if the staged file changed since the streaming hash pass (a
*  local source mutated mid-send). The server's per-chunk md5 during the PUT is
*  the backstop; this is the cheap early check. */
async function assertUnchanged(filePath, baseline) {
	const now = await promises$1.stat(filePath);
	if (now.size !== baseline.size || now.mtimeMs !== baseline.mtimeMs) throw new Error("file source changed during send (mutated between hashing and upload)");
}
function buildGroupFileUploadExt(senderUin, groupId, fileName, fileSize, md5, fileId, uploadKey, checkKey, uploadHost, uploadPort) {
	return protobuf_encode_FileUploadExt({
		unknown1: 100,
		unknown2: 1,
		entry: {
			busiBuff: {
				busId: 102,
				senderUin: BigInt(senderUin),
				receiverUin: BigInt(groupId),
				groupCode: BigInt(groupId)
			},
			fileEntry: {
				fileSize: BigInt(Math.max(0, fileSize)),
				md5,
				md5S2: md5,
				checkKey,
				fileId,
				uploadKey
			},
			clientInfo: {
				clientType: 3,
				appId: "100",
				terminalType: 3,
				clientVer: "1.1.1",
				unknown: 4
			},
			fileNameInfo: { fileName },
			host: { hosts: [{
				url: {
					host: uploadHost,
					unknown: 1
				},
				port: uploadPort
			}] }
		},
		unknown200: 0
	});
}
function buildPrivateFileUploadExt(senderUin, fileName, fileSize, md5, sha1, fileId, uploadKey, uploadHost, uploadPort) {
	return protobuf_encode_FileUploadExt({
		unknown1: 100,
		unknown2: 1,
		entry: {
			busiBuff: {
				senderUin: BigInt(senderUin),
				receiverUin: 0n,
				groupCode: 0n
			},
			fileEntry: {
				fileSize: BigInt(Math.max(0, fileSize)),
				md5,
				md5S2: md5,
				checkKey: sha1,
				fileId,
				uploadKey
			},
			clientInfo: {
				clientType: 3,
				appId: "100",
				terminalType: 3,
				clientVer: "1.1.1",
				unknown: 4
			},
			fileNameInfo: { fileName },
			host: { hosts: [{
				url: {
					host: uploadHost,
					unknown: 1
				},
				port: uploadPort
			}] }
		},
		unknown3: 0,
		unknown200: 1
	});
}
var GroupFileApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	publish(groupId, fileId) {
		if (!fileId) throw new Error("publish requires fileId");
		return PublishGroupFile.invoke(this.ctx, {
			groupId,
			fileId
		});
	}
	trans(groupId, fileId) {
		if (!fileId) throw new Error("trans requires fileId");
		return TransGroupFile.invoke(this.ctx, {
			groupId,
			fileId
		});
	}
	getCount(groupId) {
		return GetGroupFileCount.invoke(this.ctx, { groupId });
	}
	getSpace(groupId) {
		return GetGroupFileSpace.invoke(this.ctx, { groupId });
	}
	async upload(groupId, source, name = "", folderId = "/", uploadFile = true, publishFile = uploadFile) {
		const bridge = this.ctx;
		const staged = await stageSourceToDisk(source, FILE_UPLOAD_MAX_BYTES);
		try {
			if (staged.fileSize === 0) throw new Error("group file is empty");
			const fileName = normalizeUploadFileName(name, staged.fileName);
			const guardStat = await promises$1.stat(staged.filePath);
			const hashes = await hashFileStreaming(staged.filePath);
			const upload = await UploadGroupFileRequest.invoke(this.ctx, {
				groupId,
				fileName,
				folderId: normalizeDirectory(folderId),
				fileSize: staged.fileSize,
				fileSha1: hashes.sha1,
				fileMd5: hashes.md5
			});
			ensureRetCodeZero("group file upload", upload.retCode, upload.retMsg, upload.clientWording);
			const fileId = typeof upload.fileId === "string" && upload.fileId ? upload.fileId : null;
			if (!fileId) throw new Error("group file upload response missing file_id");
			this.ctx.rememberUploadedFile({
				fileId,
				scope: "group",
				groupId,
				fileName,
				fileSize: staged.fileSize,
				fileMd5: hashes.md5,
				fileSha1: hashes.sha1,
				rememberedAt: Date.now()
			});
			if (!upload.boolFileExist && uploadFile) {
				const senderUin = toInt$1(this.ctx.identity.uin);
				if (senderUin <= 0) throw new Error("invalid self uin for group file upload");
				const uploadHost = typeof upload.uploadIp === "string" && upload.uploadIp || typeof upload.serverDns === "string" && upload.serverDns || "";
				const uploadPort = toInt$1(upload.uploadPort);
				if (!uploadHost || uploadPort <= 0) throw new Error("group file upload host is invalid");
				const ext = buildGroupFileUploadExt(senderUin, groupId, fileName, staged.fileSize, hashes.md5, fileId, upload.fileKey instanceof Uint8Array ? upload.fileKey : /* @__PURE__ */ new Uint8Array(0), upload.checkKey instanceof Uint8Array ? upload.checkKey : /* @__PURE__ */ new Uint8Array(0), uploadHost, uploadPort);
				await assertUnchanged(staged.filePath, guardStat);
				await uploadHighwayHttp(bridge, await fetchHighwaySession(bridge), 71, await FileChunkSource.open(staged.filePath, staged.fileSize), hashes.md5, ext);
			}
			if (publishFile) try {
				await this.publish(groupId, fileId);
			} catch (err) {
				throw new Error(`group file uploaded (fileId=${fileId}) but chat post failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
			}
			return { fileId };
		} finally {
			await staged.cleanup();
		}
	}
	async uploadPrivate(userId, source, name = "", uploadFile = true, publishFile = uploadFile) {
		const bridge = this.ctx;
		const staged = await stageSourceToDisk(source, FILE_UPLOAD_MAX_BYTES);
		try {
			if (staged.fileSize === 0) throw new Error("private file is empty");
			const targetUid = await this.ctx.resolveUserUid(userId);
			const selfUid = await resolveSelfUid(this.ctx);
			const senderUin = toInt$1(this.ctx.identity.uin);
			if (senderUin <= 0) throw new Error("invalid self uin for private file upload");
			const fileName = normalizeUploadFileName(name, staged.fileName);
			const guardStat = await promises$1.stat(staged.filePath);
			const hashes = await hashFileStreaming(staged.filePath, { headLimit: MD5_HEAD_LIMIT });
			const upload = await UploadPrivateFileRequest.invoke(this.ctx, {
				senderUid: selfUid,
				receiverUid: targetUid,
				fileName,
				fileSize: staged.fileSize,
				fileSha1: hashes.sha1,
				fileMd5: hashes.md5,
				md510MCheckSum: hashes.headMd5
			});
			ensureRetCodeZero("private file upload", upload.retCode, upload.retMsg, void 0);
			const fileId = typeof upload.uuid === "string" && upload.uuid ? upload.uuid : null;
			const fileHash = typeof upload.fileAddon === "string" && upload.fileAddon ? upload.fileAddon : null;
			if (!fileId) throw new Error("private file upload response missing file_id");
			this.ctx.rememberUploadedFile({
				fileId,
				scope: "private",
				userId,
				fileName,
				fileSize: staged.fileSize,
				fileMd5: hashes.md5,
				fileSha1: hashes.sha1,
				fileHash: fileHash ?? "",
				rememberedAt: Date.now()
			});
			if (!upload.boolFileExist && uploadFile) {
				const rtpFirst = Array.isArray(upload.rtpMediaPlatformUploadAddress) && upload.rtpMediaPlatformUploadAddress[0] ? upload.rtpMediaPlatformUploadAddress[0] : null;
				const rtpInIP = rtpFirst && typeof rtpFirst.inIP === "number" && rtpFirst.inIP !== 0 ? int32ToIpv4Dotted(rtpFirst.inIP) : "";
				const rtpInPort = rtpFirst && typeof rtpFirst.inPort === "number" ? rtpFirst.inPort : 0;
				const ipListFirst = Array.isArray(upload.uploadIpList) && upload.uploadIpList[0] ? upload.uploadIpList[0] : "";
				const uploadHost = rtpInIP || typeof upload.uploadIp === "string" && upload.uploadIp || typeof upload.uploadDomain === "string" && upload.uploadDomain || ipListFirst || typeof upload.uploadHttpsDomain === "string" && upload.uploadHttpsDomain || typeof upload.uploadDns === "string" && upload.uploadDns || "";
				const httpsHostUsed = !rtpInIP && !upload.uploadIp && !upload.uploadDomain && !ipListFirst && typeof upload.uploadHttpsDomain === "string" && !!upload.uploadHttpsDomain;
				const uploadPort = rtpInIP && rtpInPort > 0 ? rtpInPort : httpsHostUsed && toInt$1(upload.uploadHttpsPort) > 0 ? toInt$1(upload.uploadHttpsPort) : toInt$1(upload.uploadPort);
				if (!uploadHost || uploadPort <= 0) {
					const rtpDump = Array.isArray(upload.rtpMediaPlatformUploadAddress) ? JSON.stringify(upload.rtpMediaPlatformUploadAddress.map((e) => ({
						outIP: e.outIP,
						outPort: e.outPort,
						inIP: e.inIP,
						inPort: e.inPort,
						iPType: e.iPType
					}))) : "[]";
					log$28.warn("private file upload host missing — rtp=%s ip=%s domain=%s ipList=%s httpsDomain=%s dns=%s lanip=%s port=%s httpsPort=%s", rtpDump, upload.uploadIp ?? "", upload.uploadDomain ?? "", JSON.stringify(upload.uploadIpList ?? []), upload.uploadHttpsDomain ?? "", upload.uploadDns ?? "", upload.uploadLanip ?? "", upload.uploadPort ?? 0, upload.uploadHttpsPort ?? 0);
					throw new Error("private file upload host is invalid");
				}
				const ext = buildPrivateFileUploadExt(senderUin, fileName, staged.fileSize, hashes.md5, hashes.sha1, fileId, upload.mediaPlatformUploadKey instanceof Uint8Array ? upload.mediaPlatformUploadKey : upload.uploadKey instanceof Uint8Array ? upload.uploadKey : /* @__PURE__ */ new Uint8Array(0), uploadHost, uploadPort);
				await assertUnchanged(staged.filePath, guardStat);
				await uploadHighwayHttp(bridge, await fetchHighwaySession(bridge), 95, await FileChunkSource.open(staged.filePath, staged.fileSize), hashes.md5, ext);
			}
			if (publishFile) try {
				await this.ctx.apis.message.sendC2cFile(userId, targetUid, {
					fileId,
					fileName,
					fileSize: staged.fileSize,
					fileMd5: hashes.md5,
					fileHash: fileHash ?? ""
				});
			} catch (err) {
				log$28.warn("private file uploaded (fileId=%s) but chat post failed: %s", fileId, err instanceof Error ? err.message : String(err));
			}
			return {
				fileId,
				fileHash
			};
		} finally {
			await staged.cleanup();
		}
	}
	async list(groupId, folderId = "/") {
		const targetDirectory = normalizeDirectory(folderId);
		const files = [];
		const folders = [];
		const pageSize = 20;
		let startIndex = 0;
		for (let page = 0; page < 200; page++) {
			const list = await ListGroupFilesPage.invoke(this.ctx, {
				groupId,
				targetDirectory,
				startIndex,
				pageSize
			});
			if (!list) break;
			for (const item of list.items) {
				const type = toInt$1(item?.type);
				if (type === 1 && item?.fileInfo) {
					const file = item.fileInfo;
					const uploader = toInt$1(file.uploaderUin);
					const cached = this.ctx.identity.findGroupMember(groupId, uploader);
					files.push({
						fileId: typeof file.fileId === "string" ? file.fileId : "",
						fileName: typeof file.fileName === "string" ? file.fileName : "",
						busId: toInt$1(file.busId),
						fileSize: toInt$1(file.fileSize),
						uploadTime: toInt$1(file.uploadedTime),
						deadTime: toInt$1(file.expireTime),
						modifyTime: toInt$1(file.modifiedTime),
						downloadTimes: toInt$1(file.downloadedTimes),
						uploader,
						uploaderName: typeof file.uploaderName === "string" && file.uploaderName || cached?.card || cached?.nickname || ""
					});
				} else if (type === 2 && item?.folderInfo) {
					const folder = item.folderInfo;
					const creator = toInt$1(folder.creatorUin);
					const cached = this.ctx.identity.findGroupMember(groupId, creator);
					const lastUploader = toInt$1(folder.modifierUin);
					const lastUploaderCached = this.ctx.identity.findGroupMember(groupId, lastUploader);
					folders.push({
						folderId: typeof folder.folderId === "string" ? folder.folderId : "",
						folderName: typeof folder.folderName === "string" ? folder.folderName : "",
						createTime: toInt$1(folder.createTime),
						creator,
						creatorName: typeof folder.creatorName === "string" && folder.creatorName || cached?.card || cached?.nickname || "",
						totalFileCount: toInt$1(folder.totalFileCount),
						lastUploadTime: toInt$1(folder.modifiedTime),
						lastUploader,
						lastUploaderName: typeof folder.modifierName === "string" && folder.modifierName || lastUploaderCached?.card || lastUploaderCached?.nickname || ""
					});
				}
			}
			if (list.isEnd) break;
			startIndex += pageSize;
		}
		return {
			files,
			folders
		};
	}
	async getUrl(groupId, fileId, busId = 102) {
		return GetGroupFileUrl.invoke(this.ctx, {
			groupId,
			fileId,
			busId
		});
	}
	async getPrivateUrl(userId, fileId, fileHash) {
		const selfUid = await resolveSelfUid(this.ctx);
		return GetPrivateFileUrl.invoke(this.ctx, {
			selfUid,
			fileId,
			fileHash
		});
	}
	delete(groupId, fileId) {
		return DeleteGroupFile.invoke(this.ctx, {
			groupId,
			fileId
		});
	}
	move(groupId, fileId, parentDirectory, targetDirectory) {
		return MoveGroupFile.invoke(this.ctx, {
			groupId,
			fileId,
			parentDirectory,
			targetDirectory
		});
	}
	rename(groupId, fileId, parentDirectory, newFileName) {
		return RenameGroupFile.invoke(this.ctx, {
			groupId,
			fileId,
			parentDirectory,
			newFileName
		});
	}
	createFolder(groupId, name, parentId = "/") {
		return CreateGroupFolder.invoke(this.ctx, {
			groupId,
			parentId: normalizeDirectory(parentId),
			folderName: name
		});
	}
	deleteFolder(groupId, folderId) {
		return DeleteGroupFolder.invoke(this.ctx, {
			groupId,
			folderId
		});
	}
	renameFolder(groupId, folderId, newFolderName) {
		return RenameGroupFolder.invoke(this.ctx, {
			groupId,
			folderId,
			newFolderName
		});
	}
	getPttUrl(groupId, node) {
		return GetGroupPttUrl.invoke(this.ctx, {
			groupId,
			node
		});
	}
	async getPrivatePttUrl(node) {
		const selfUid = await resolveSelfUid(this.ctx);
		return GetPrivatePttUrl.invoke(this.ctx, {
			selfUid,
			node
		});
	}
	getVideoUrl(groupId, node) {
		return GetGroupVideoUrl.invoke(this.ctx, {
			groupId,
			node
		});
	}
	async getPrivateVideoUrl(node) {
		const selfUid = await resolveSelfUid(this.ctx);
		return GetPrivateVideoUrl.invoke(this.ctx, {
			selfUid,
			node
		});
	}
};
