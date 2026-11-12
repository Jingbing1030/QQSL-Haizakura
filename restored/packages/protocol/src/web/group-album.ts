// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/group-album.ts"
// original bundle lines 234203-234614  (410 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Same ceiling as highway video upload (`MAX_VIDEO_SIZE`). */
var ALBUM_VIDEO_MAX_BYTES = 1536 * 1024 * 1024;
var DEFAULT_ALBUM_SLICE_SIZE = 16384;
/**
* 创建群相册上传会话
*/
async function createAlbumUploadSession(groupId, albumId, albumName, filePath, skey, pskey, imgMd5, uin) {
	const imgSize = statSync$1(filePath).size;
	const imgName = basename$1(filePath);
	const bkn = getBknFromCookie({ skey });
	const timestamp = Math.floor(Date.now() / 1e3);
	const body = { control_req: [{
		uin,
		token: {
			type: 4,
			data: pskey,
			appid: 5
		},
		appid: "qun",
		checksum: imgMd5,
		check_type: 0,
		file_len: imgSize,
		env: {
			refer: "qzone",
			deviceInfo: "h5"
		},
		model: 0,
		biz_req: {
			sPicTitle: imgName,
			sPicDesc: "",
			sAlbumName: albumName,
			sAlbumID: albumId,
			iAlbumTypeID: 0,
			iBitmap: 0,
			iUploadType: 0,
			iUpPicType: 0,
			iBatchID: timestamp,
			sPicPath: "",
			iPicWidth: 0,
			iPicHight: 0,
			iWaterType: 0,
			iDistinctUse: 0,
			iNeedFeeds: 1,
			iUploadTime: timestamp,
			mapExt: {
				appid: "qun",
				userid: groupId
			},
			stExtendInfo: { mapParams: {
				photo_num: "1",
				video_num: "0",
				batch_num: "1"
			} }
		},
		session: "",
		asy_upload: 0,
		cmd: "FileUpload"
	}] };
	const api = `https://h5.qzone.qq.com/webapp/json/sliceUpload/FileBatchControl/${imgMd5}?g_tk=${bkn}`;
	const cookie = `p_uin=o${uin}; p_skey=${pskey}; skey=${skey}; uin=o${uin}`;
	const response = await RequestUtil.HttpGetJson(api, "POST", body, {
		Cookie: cookie,
		"Content-Type": "application/json"
	});
	if (response.ret !== 0 || !response.data?.session) throw new Error(`创建上传会话失败: ${response.msg}`);
	return response.data.session;
}
/**
* 修复后的上传图片分片方法
*/
async function uploadAlbumSlice(session, filePath, _imgMd5, skey, pskey, uin) {
	const img_size = statSync$1(filePath).size;
	const slice_size = 16384;
	const bkn = getBknFromCookie({ skey });
	const cookie = `p_uin=o${uin}; p_skey=${pskey}; skey=${skey}; uin=o${uin}`;
	const stream = createReadStream$1(filePath, { highWaterMark: slice_size });
	let seq = 0;
	let offset = 0;
	for await (const chunk of stream) {
		const end = Math.min(offset + chunk.length, img_size);
		const form = new FormData();
		form.append("uin", uin);
		form.append("appid", "qun");
		form.append("session", session);
		form.append("offset", offset.toString());
		form.append("data", new Blob([chunk], { type: "application/octet-stream" }), "blob");
		form.append("checksum", "");
		form.append("check_type", "0");
		form.append("retry", "0");
		form.append("seq", seq.toString());
		form.append("end", end.toString());
		form.append("cmd", "FileUpload");
		form.append("slice_size", slice_size.toString());
		form.append("biz_req.iUploadType", "0");
		const api = `https://h5.qzone.qq.com/webapp/json/sliceUpload/FileUpload?seq=${seq}&retry=0&offset=${offset}&end=${end}&total=${img_size}&type=form&g_tk=${bkn}`;
		const response = await fetch(api, {
			method: "POST",
			headers: { Cookie: cookie },
			body: form
		});
		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
		const post = await response.json();
		if (post.ret !== 0) throw new Error(`分片 ${seq} 上传失败: ${post.msg}`);
		offset += chunk.length;
		seq++;
	}
}
/**
* 上传图片到群相册
*/
async function uploadImageToGroupAlbum(cookieObject, groupId, albumId, albumName, filePath, uin) {
	const { detectImageFormat, loadBinarySource } = await Promise.resolve().then(() => (init_utils(), utils_exports));
	const loaded = await loadBinarySource(filePath, "album image");
	const format = detectImageFormat(loaded.bytes);
	const isJpeg = loaded.bytes.length >= 2 && loaded.bytes[0] === 255 && loaded.bytes[1] === 216;
	if (format.format === 1e3 && !isJpeg) throw new Error("群相册上传仅支持 JPEG、PNG、GIF、WebP 或 BMP 图片");
	let tempFile = null;
	let actualPath = filePath;
	if (/^(https?:\/\/|base64:\/\/)/i.test(filePath)) {
		tempFile = join$1(tmpdir(), `album_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);
		writeFileSync(tempFile, loaded.bytes);
		actualPath = tempFile;
	}
	try {
		const imgMd5 = createHash$1("md5").update(loaded.bytes).digest("hex");
		const skey = cookieObject.skey || "";
		const pskey = cookieObject.p_skey || "";
		await uploadAlbumSlice(await createAlbumUploadSession(groupId, albumId, albumName, actualPath, skey, pskey, imgMd5, uin), actualPath, imgMd5, skey, pskey, uin);
	} finally {
		if (tempFile) try {
			unlinkSync(tempFile);
		} catch {}
	}
}
function albumUploadCookie(uin, skey, pskey) {
	return `p_uin=o${uin}; p_skey=${pskey}; skey=${skey}; uin=o${uin}`;
}
function albumUploadGtk(skey, pskey) {
	return getBknFromCookie({
		p_skey: pskey,
		skey
	});
}
function readFileHead(filePath, size) {
	const fd = openSync(filePath, "r");
	try {
		const buf = Buffer.alloc(size);
		const got = readSync(fd, buf, 0, size, 0);
		return buf.subarray(0, got);
	} finally {
		closeSync(fd);
	}
}
function isKnownImageHead(bytes) {
	if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 216) return true;
	if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return true;
	if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) return true;
	if (bytes.length >= 2 && bytes[0] === 66 && bytes[1] === 77) return true;
	return bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}
function isIsoBmffHead(bytes) {
	return bytes.length >= 8 && bytes[4] === 102 && bytes[5] === 116 && bytes[6] === 121 && bytes[7] === 112;
}
function unlinkQuiet(filePath) {
	try {
		unlinkSync(filePath);
	} catch {}
}
function normalizeAlbumSliceSize(sliceSize) {
	return sliceSize && sliceSize > 0 ? sliceSize : DEFAULT_ALBUM_SLICE_SIZE;
}
async function defaultAlbumVideoProbe(videoPath) {
	const { getFFmpegAddon } = await Promise.resolve().then(() => (init_ffmpeg_addon(), ffmpeg_addon_exports));
	const info = await getFFmpegAddon().getVideoInfo(videoPath);
	const cover = info.image && info.image.length > 0 ? new Uint8Array(info.image) : /* @__PURE__ */ new Uint8Array();
	if (cover.length === 0) throw new Error("无法从视频提取封面");
	return {
		duration: info.duration || 0,
		cover
	};
}
async function createAlbumMediaSession(checksum, skey, pskey, uin, timestamp, controlReq) {
	const api = `https://h5.qzone.qq.com/webapp/json/sliceUpload/FileBatchControl/${checksum}?g_tk=${albumUploadGtk(skey, pskey)}`;
	const response = await RequestUtil.HttpGetJson(api, "POST", { control_req: [controlReq] }, {
		Cookie: albumUploadCookie(uin, skey, pskey),
		"Content-Type": "application/json"
	});
	if (response.ret !== 0 || !response.data?.session) throw new Error(`创建上传会话失败: ${response.msg ?? ""}`);
	return {
		session: response.data.session,
		sliceSize: normalizeAlbumSliceSize(response.data.slice_size),
		timestamp
	};
}
async function uploadAlbumFileSlices(opts) {
	const { session, filePath, fileSize, sliceSize, appid, checkType, uploadCmd, skey, pskey, uin } = opts;
	const bkn = albumUploadGtk(skey, pskey);
	const cookie = albumUploadCookie(uin, skey, pskey);
	const stream = createReadStream$1(filePath, { highWaterMark: sliceSize });
	let seq = 0;
	let offset = 0;
	let lastBiz = {};
	for await (const chunk of stream) {
		const chunkBytes = chunk;
		const end = offset + chunkBytes.length;
		const form = new FormData();
		form.append("uin", uin);
		form.append("appid", appid);
		form.append("session", session);
		form.append("offset", offset.toString());
		form.append("data", new Blob([chunkBytes], { type: "application/octet-stream" }), "blob");
		form.append("checksum", "");
		form.append("check_type", String(checkType));
		form.append("retry", "0");
		form.append("seq", seq.toString());
		form.append("end", end.toString());
		form.append("cmd", "FileUpload");
		form.append("slice_size", String(chunkBytes.length));
		const api = `https://h5.qzone.qq.com/webapp/json/sliceUpload/${uploadCmd}?seq=${seq}&retry=0&offset=${offset}&end=${end}&total=${fileSize}&type=form&g_tk=${bkn}`;
		const response = await fetch(api, {
			method: "POST",
			headers: { Cookie: cookie },
			body: form
		});
		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
		const post = await response.json();
		if (post.ret !== 0) throw new Error(`分片 ${seq} 上传失败: ${post.msg ?? ""}`);
		lastBiz = {
			vid: post.data?.biz?.sVid || lastBiz.vid,
			photoId: post.data?.biz?.sPhotoID || lastBiz.photoId,
			photoUrl: post.data?.biz?.sBURL || lastBiz.photoUrl
		};
		offset = end;
		seq++;
	}
	if (fileSize === 0 || offset !== fileSize) throw new Error("视频分片上传不完整");
	return lastBiz;
}
/**
* 上传视频到群相册：先传视频拿到 vid，再传客户端封面。
*/
async function uploadVideoToGroupAlbum(cookieObject, groupId, albumId, albumName, filePath, uin, deps = {}) {
	const skey = cookieObject.skey || "";
	const pskey = cookieObject.p_skey || "";
	const now = deps.now ?? (() => Math.floor(Date.now() / 1e3));
	const probe = deps.probe ?? defaultAlbumVideoProbe;
	const staged = await stageSourceToDisk(filePath, ALBUM_VIDEO_MAX_BYTES);
	let coverPath = null;
	try {
		const head = readFileHead(staged.filePath, 16);
		if (isKnownImageHead(head) || !isIsoBmffHead(head)) throw new Error("群相册视频上传仅支持 MP4 等 ISO BMFF 视频");
		const hashes = await hashFileStreaming(staged.filePath);
		const fileName = staged.fileName || "video.mp4";
		const info = await probe(staged.filePath);
		if (info.cover.length === 0) throw new Error("无法从视频提取封面");
		coverPath = join$1(tmpdir(), `album_video_cover_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);
		writeFileSync(coverPath, Buffer.from(info.cover));
		const coverMd5 = createHash$1("md5").update(Buffer.from(info.cover)).digest("hex");
		const coverSize = info.cover.length;
		const videoTimestamp = now();
		const playTime = info.duration * 1e3;
		const videoSession = await createAlbumMediaSession(hashes.sha1Hex, skey, pskey, uin, videoTimestamp, {
			uin,
			token: {
				type: 4,
				data: pskey,
				appid: 5
			},
			appid: "video_qun",
			checksum: hashes.sha1Hex,
			check_type: 1,
			file_len: staged.fileSize,
			env: {
				refer: "qzone",
				deviceInfo: "h5"
			},
			model: 0,
			biz_req: {
				sPicTitle: fileName,
				sPicDesc: "",
				sAlbumName: "",
				sAlbumID: "",
				iAlbumTypeID: 0,
				iBitmap: 0,
				iUploadType: 3,
				iUpPicType: 0,
				iBatchID: 0,
				sPicPath: "",
				iPicWidth: 0,
				iPicHight: 0,
				iWaterType: 0,
				iDistinctUse: 0,
				sTitle: fileName,
				sDesc: "",
				iFlag: 0,
				iUploadTime: videoTimestamp,
				iPlayTime: playTime,
				sCoverUrl: "",
				iIsNew: 111,
				iIsOriginalVideo: 0,
				iIsFormatF20: 0,
				extend_info: {
					video_type: "3",
					domainid: "5",
					photo_num: "0",
					video_num: "1",
					qun_id: groupId
				}
			},
			session: "",
			asy_upload: 0,
			cmd: "FileUploadVideo"
		});
		const videoBiz = await uploadAlbumFileSlices({
			session: videoSession.session,
			filePath: staged.filePath,
			fileSize: staged.fileSize,
			sliceSize: videoSession.sliceSize,
			appid: "video_qun",
			checkType: 1,
			uploadCmd: "FileUploadVideo",
			skey,
			pskey,
			uin
		});
		if (!videoBiz.vid) throw new Error("视频上传未返回视频 id");
		const coverTimestamp = now();
		const coverSession = await createAlbumMediaSession(coverMd5, skey, pskey, uin, coverTimestamp, {
			uin,
			token: {
				type: 4,
				data: pskey,
				appid: 5
			},
			appid: "qun",
			checksum: coverMd5,
			check_type: 0,
			file_len: coverSize,
			env: {
				refer: "huodong",
				deviceInfo: "h5"
			},
			model: 0,
			biz_req: {
				sPicTitle: fileName,
				sPicDesc: "",
				sAlbumName: albumName,
				sAlbumID: albumId,
				iAlbumTypeID: 0,
				iBitmap: 0,
				iUploadType: 2,
				iUpPicType: 0,
				iBatchID: videoTimestamp,
				sPicPath: "",
				iPicWidth: 0,
				iPicHight: 0,
				iWaterType: 0,
				iDistinctUse: 0,
				iNeedFeeds: 1,
				iUploadTime: coverTimestamp,
				mapExt: {
					appid: "qun",
					userid: groupId
				},
				mutliPicInfo: {
					iBatUploadNum: 1,
					iCurUpload: 0,
					iSuccNum: 0,
					iFailNum: 0
				},
				stExtendInfo: { mapParams: {
					vid: videoBiz.vid,
					photo_num: "0",
					video_num: "1"
				} },
				stExternalMapExt: {
					is_client_upload_cover: "1",
					is_pic_video_mix_feeds: "1"
				},
				sExif_CameraMaker: "",
				sExif_CameraModel: "",
				sExif_Time: "",
				sExif_LatitudeRef: "",
				sExif_Latitude: "",
				sExif_LongitudeRef: "",
				sExif_Longitude: ""
			},
			session: "",
			asy_upload: 0,
			cmd: ""
		});
		const coverBiz = await uploadAlbumFileSlices({
			session: coverSession.session,
			filePath: coverPath,
			fileSize: coverSize,
			sliceSize: coverSession.sliceSize,
			appid: "qun",
			checkType: 0,
			uploadCmd: "FileUpload",
			skey,
			pskey,
			uin
		});
		if (!coverBiz.photoId || !coverBiz.photoUrl) throw new Error("视频封面上传未返回图片 id");
		return { id: videoBiz.vid };
	} finally {
		if (coverPath) unlinkQuiet(coverPath);
		await staged.cleanup();
	}
}
export {};
