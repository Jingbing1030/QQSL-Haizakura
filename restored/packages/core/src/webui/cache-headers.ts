// @ts-nocheck
/* eslint-disable */
// ---------------------------------------------------------------------------
// 静态资源缓存头修正
//
// 问题：serveStatic 只发 Last-Modified，不发 Cache-Control，也不发 ETag。
//   ① 无 Cache-Control → 浏览器启用【启发式缓存】，按 Last-Modified 推断
//      一个新鲜期（Chrome 通常取 (now - lastModified) * 0.1），期间直接
//      用本地副本、不发请求。
//   ② 带 If-Modified-Since 的条件请求返回 400，所以连 304 协商也走不通。
//   结果：改完前端文件后，用户看到的仍是旧副本，必须 Ctrl+Shift+R。
//
// 修法：包一层响应头改写。
//   - 带内容哈希的文件名（`xxx-ABC123.js`）→ 不可变，长缓存（1 年）
//   - 不带哈希的（index.html、favicon、docs-page-hz.js 等）→ no-cache
//     （允许缓存，但每次必须回源校验；配合弱 ETag 就能拿到 304）
//   - 同时补上 ETag（基于 Last-Modified + 大小，够用且不必读文件内容）
//
// 为什么选 no-cache 而不是 no-store：
//   no-store 完全不缓存，每次全量下载（前端资源合计约 1.6 MB）；
//   no-cache 允许本地留存，靠 ETag/304 只传几百字节的头部。
// ---------------------------------------------------------------------------

var hzCacheLog = {
	warn: function () {
		try {
			(console.warn || console.log).apply(console, arguments);
		} catch {}
	}
};

/**
 * 判断是否为带内容哈希的构建产物。
 *
 * 打包器命名形如 `index-CbgqmStD.js` / `overview-page-Bm3ks5zC.css` —
 * 尾部有 8 位 base64 风格哈希。这类文件内容变化必换名，可安全长缓存。
 */
function hzCacheIsHashed(pathname) {
	var base = pathname.slice(pathname.lastIndexOf("/") + 1);
	// 去掉扩展名后看最后一段
	var stem = base.replace(/\.[a-z0-9]+$/i, "");
	var m = /-([A-Za-z0-9_-]{8})$/.exec(stem);
	if (!m) return false;
	// 纯数字结尾的多半是语义版本号，不是哈希（如 `v1.2.3`）
	return !/^\d{8}$/.test(m[1]);
}

/** 依据扩展名给一个合理的 Content-Type 兜底（serveStatic 通常已设好）。 */
function hzCacheShouldFlushCacheControl(pathname) {
	// index.html 与不带哈希的入口必须每次校验
	if (pathname === "/" || /\/index\.html?$/.test(pathname)) return true;
	return !hzCacheIsHashed(pathname);
}

var hzCacheOrigRegisterStaticFrontend = registerStaticFrontend;

/**
 * 包裹注册函数：在 serveStatic 之前插入一个响应头中间件。
 *
 * ⚠️ Hono 的中间件按注册顺序执行，且 app.use("/*") 会捕获后续路径。
 * 所以这里必须【先】注册头部中间件，再调用原函数注册静态服务。
 */
registerStaticFrontend = function hzCachePatchedRegisterStaticFrontend(app, root, target) {
	// index.html 是动态渲染的（每次读盘 + 注入 runtime target），没有 Last-Modified，
	// 所以它的 ETag 只能从磁盘文件的 mtime/size 推。
	var hzCacheIndexStamp = null;
	try {
		var idxPath = path.join(root, "index.html");
		if (existsSync(idxPath)) {
			var st = statSync(idxPath);
			hzCacheIndexStamp = { size: st.size, mtime: st.mtimeMs };
		}
	} catch (error) {
		hzCacheIndexStamp = null;
	}

	try {
		app.use("/*", async function hzCacheHeaderMiddleware(c, next) {
			await next();

			try {
				var res = c.res;
				if (!res || !res.headers) return;

				var p = c.req.path || "/";

				// 只处理静态资源；API 与文档路由自己管头（docs-mount 已设 no-store）
				if (p.indexOf("/api/") === 0) return;

				var headers = res.headers;
				var existing = headers.get("cache-control");

				// 尊重上游已显式设置过的 Cache-Control（例如 index 的 no-store、
				// 文档页的 no-store），只在缺失时补默认值。
				// 但 index.html 例外：no-store 会让每次刷新都重下 HTML，
				// 换成 no-cache + ETag 更省流量，且语义同样安全。
				if (existing && !/\/index\.html?$/.test(p) && p !== "/") return;

				if (existing === "no-store" && (p === "/" || /\/index\.html?$/.test(p))) {
					headers.set("Cache-Control", "no-cache");
				} else if (!existing) {
					if (hzCacheShouldFlushCacheControl(p)) {
						headers.set("Cache-Control", "no-cache");
					} else {
						// 带哈希 → 指纹变了才会换名，可长期缓存
						headers.set("Cache-Control", "public, max-age=31536000, immutable");
					}
				}

				// 补 ETag：用 Last-Modified + Content-Length 合成，
				// 稳定、无需读文件，且文件一变就变。
				//
				// ⚠️ 为什么不用 hono/etag 中间件：serveStatic 自己发响应，
				// 外层的 etag() 拿不到 body 流，实测不会产生 ETag。
				// 所以这里手工算一个弱 ETag，并自己处理条件请求。
				var etagValue = headers.get("ETag");
				var isIndex = p === "/" || /\/index\.html?$/.test(p);

				// index.html：动态渲染无 Last-Modified，用磁盘戳补
				if (!etagValue && isIndex && hzCacheIndexStamp) {
					var ist = hzCacheIndexStamp;
					var iseed = "index|" + ist.size + "|" + ist.mtime;
					var ih = 5381;
					for (var ii = 0; ii < iseed.length; ii++) {
						ih = ((ih << 5) + ih + iseed.charCodeAt(ii)) >>> 0;
					}
					etagValue = 'W/"' + ih.toString(16) + "-" + ist.size + '"';
					headers.set("ETag", etagValue);
				}

				if (!etagValue) {
					var lm = headers.get("Last-Modified");
					var len = headers.get("Content-Length");
					if (lm) {
						var seed = p + "|" + lm + "|" + (len || "");
						var h = 5381;
						for (var i = 0; i < seed.length; i++) {
							h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
						}
						etagValue = 'W/"' + h.toString(16) + "-" + (len || "0") + '"';
						headers.set("ETag", etagValue);
					}
				}

				// ── 条件请求：命中就回 304，省掉整个响应体 ──
				//
				// serveStatic 不做协商（实测 If-None-Match 仍返回 200 全量），
				// 所以在这里自己判。
				//
				// 弱比较：W/"x" 与 "x" 视为等价（RFC 9110 §8.8.3.2），
				// 因为我们用的是「同一性」而非「逐字节相同」的语义。
				if (etagValue && res.status === 200) {
					var inm = c.req.header("if-none-match") || "";
					var ims = c.req.header("if-modified-since") || "";
					var lmRaw = headers.get("Last-Modified") || "";

					var stripWeak = function (t) {
						return String(t).trim().replace(/^W\//, "");
					};
					var wanted = stripWeak(etagValue);
					var hit = false;

					if (inm) {
						if (inm.trim() === "*") {
							hit = true;
						} else {
							var parts = inm.split(",");
							for (var pi = 0; pi < parts.length; pi++) {
								if (stripWeak(parts[pi]) === wanted) { hit = true; break; }
							}
						}
					} else if (ims && lmRaw) {
						// If-None-Match 优先于 If-Modified-Since（RFC 9110 §13.1.3）
						var tReq = Date.parse(ims);
						var tRes = Date.parse(lmRaw);
						if (!isNaN(tReq) && !isNaN(tRes) && tRes <= tReq) hit = true;
					}

					if (hit) {
						// 304 必须不带 body，但保留校验器与缓存指令
						var notMod = new Response(null, { status: 304 });
						notMod.headers.set("ETag", etagValue);
						if (lmRaw) notMod.headers.set("Last-Modified", lmRaw);
						var cc = headers.get("Cache-Control");
						if (cc) notMod.headers.set("Cache-Control", cc);
						var vary = headers.get("Vary");
						if (vary) notMod.headers.set("Vary", vary);
						c.res = notMod;
					}
				}
			} catch (error) {
				// 头部改写失败绝不能影响响应本身
				hzCacheLog.warn(
					"cache header middleware skipped: %s",
					error instanceof Error ? error.message : String(error)
				);
			}
		});
	} catch (error) {
		hzCacheLog.warn(
			"cache header middleware failed to register: %s",
			error instanceof Error ? error.message : String(error)
		);
	}

	return hzCacheOrigRegisterStaticFrontend(app, root, target);
};
