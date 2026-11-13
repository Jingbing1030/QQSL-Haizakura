import{a as e}from"./rolldown-runtime-CNC7AqOf.js";import{dt as a,lt as o}from"./api-CBg-YqKK.js";

/* ---------------------------------------------------------------------------
 * 内置文档浏览器（SPA 页面）
 *
 * 数据来源：/api/docs/nav 与 /api/docs/doc（由 docs-mount.ts 提供，
 * 与服务端 /docs 页面共用同一份内嵌语料和同一套鉴权）。
 *
 * 依赖约定与其它页面 chunk 一致：
 *   e(a(), 1)  → React 命名空间
 *   o()        → jsx runtime
 *
 * ⚠️ 自动 JSX runtime 的签名是 jsx(type, props, key) / jsxs(type, props, key)，
 *    children 必须放在 props.children 里，第三个参数是 key 而不是 children。
 * ------------------------------------------------------------------------- */

var E = e(a(), 1);
var D = o();

function hzDocsToken() {
	try { return localStorage.getItem("snowluma_token") || ""; } catch (err) { return ""; }
}

function hzDocsFetch(url) {
	var headers = {};
	var t = hzDocsToken();
	if (t) headers.Authorization = "Bearer " + t;
	return fetch(url, { headers: headers }).then(function (r) {
		return r.ok ? r.json() : null;
	}).catch(function () { return null; });
}

export function DocsPage() {
	var navState = E.useState(null);
	var nav = navState[0], setNav = navState[1];
	var docState = E.useState(null);
	var doc = docState[0], setDoc = docState[1];
	var selState = E.useState("");
	var sel = selState[0], setSel = selState[1];
	var errState = E.useState("");
	var err = errState[0], setErr = errState[1];
	var openState = E.useState(false);
	var open = openState[0], setOpen = openState[1];

	E.useEffect(function () {
		hzDocsFetch("/api/docs/nav").then(function (data) {
			if (!data) { setErr("无法加载文档索引，请确认已在 WebUI 登录。"); return; }
			var groups = data.groups || [];
			setNav(groups);
			var first = groups[0] && groups[0].docs[0] ? groups[0].docs[0].key : "";
			if (first) setSel(first);
		});
	}, []);

	E.useEffect(function () {
		if (!sel) return;
		setDoc(null);
		setErr("");
		hzDocsFetch("/api/docs/doc?key=" + encodeURIComponent(sel)).then(function (data) {
			if (!data) { setErr("无法加载该文档。"); return; }
			setDoc(data);
		});
	}, [sel]);

	var groups = nav || [];

	var sidebar = groups.map(function (group) {
		return D.jsxs("div", {
			key: group.label,
			className: "mb-3",
			children: [
				D.jsx("div", {
					key: "label",
					className: "px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
					children: group.label
				}),
				D.jsx("div", {
					key: "docs",
					className: "flex flex-col",
					children: group.docs.map(function (item) {
						var active = item.key === sel;
						return D.jsx("button", {
							key: item.key,
							type: "button",
							onClick: function () { setSel(item.key); setOpen(false); },
							className: "truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors " +
								(active
									? "bg-sidebar-accent text-sidebar-accent-foreground"
									: "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground"),
							children: item.title
						});
					})
				})
			]
		});
	});

	var body;
	if (err) {
		body = D.jsx("p", { className: "text-sm text-destructive", children: err });
	} else if (!doc) {
		body = D.jsx("p", { className: "text-sm text-muted-foreground", children: "加载中…" });
	} else {
		body = D.jsx("article", {
			className: "hz-docs-article",
			dangerouslySetInnerHTML: { __html: doc.html }
		});
	}

	return D.jsxs("div", {
		className: "flex flex-col gap-4 lg:flex-row lg:items-start",
		children: [
			D.jsx("div", {
				key: "toggle",
				className: "lg:hidden",
				children: D.jsx("button", {
					type: "button",
					onClick: function () { setOpen(!open); },
					className: "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm",
					children: open ? "隐藏目录" : "显示目录"
				})
			}),
			D.jsx("aside", {
				key: "nav",
				className: (open ? "block" : "hidden") +
					" w-full shrink-0 rounded-xl border bg-card/50 p-2 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-8rem)] lg:w-72 lg:overflow-y-auto",
				children: sidebar
			}),
			D.jsxs("section", {
				key: "content",
				className: "min-w-0 flex-1 rounded-xl border bg-card/50 p-4 sm:p-6",
				children: [
					doc ? D.jsx("h1", {
						key: "title",
						className: "mb-4 text-xl font-semibold tracking-tight",
						children: doc.title
					}) : null,
					D.jsx("div", { key: "body", children: body })
				]
			})
		]
	});
}
