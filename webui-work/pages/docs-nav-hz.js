import{a as e}from"./rolldown-runtime-CNC7AqOf.js";
import{dt as a}from"./api-CBg-YqKK.js";
var E=e(a(),1);

/* ===========================================================================
 * 文档数据与选中状态
 *
 * 只负责三件事：取数据、缓存、广播「当前是哪一篇」。
 * 目录树已从侧栏移除，浏览改为正文底部的「上一篇 / 下一篇」。
 *
 * ⚠️ 缓存**只缓存成功结果**。早期版本把失败的 Promise 也存进 navPromise，
 * 于是一次网络抖动之后，页面上永远显示「加载中…」：不报错、不重试、不自愈。
 * 现在失败一律不缓存，下次调用会重新请求。
 * =========================================================================== */

/** 当前界面语言（与 i18n 内核共用同一个 localStorage 键）。 */
function hzCurLang(){
	try{return localStorage.getItem("haizakura_lang")||"zh-cn"}catch(err){return "zh-cn"}
}

function hzToken(){try{return localStorage.getItem("snowluma_token")||""}catch(err){return ""}}

/** 取 JSON；失败返回 null（调用方据此显示错误并允许重试）。 */
export function hzFetchJson(url){
	var headers={},t=hzToken();
	if(t)headers.Authorization="Bearer "+t;
	return fetch(url,{headers:headers}).then(function(r){return r.ok?r.json():null}).catch(function(){return null});
}

var docCache={};
var navPromise=null;
var navLang=null;
var navRetryAt=0;

/** 清掉失败留下的痕迹，让下一次调用重新发请求。 */
function hzResetNav(){
	navPromise=null;
	navRetryAt=0;
}

/**
 * 文档树。
 *
 * 失败时返回的 Promise 会 resolve 成 null，但**不写入缓存**，
 * 并且 1.5 秒内不再重复打服务器（避免观察器高频触发时的请求风暴）。
 */
export function hzNav(){
	var want=hzCurLang();
	// 语言变了要重新取 —— 不同语言返回不同的文档树
	if(navLang!==want){navLang=want;docCache={};hzResetNav();}
	if(navPromise)return navPromise;
	if(navRetryAt&&Date.now()<navRetryAt)return Promise.resolve(null);
	navPromise=hzFetchJson("/api/docs/nav?lang="+encodeURIComponent(want)).then(function(d){
		if(d&&d.groups){return d}
		// 失败：不缓存，标记重试时间
		navPromise=null;
		navRetryAt=Date.now()+1500;
		return null;
	});
	return navPromise;
}

/** 重新拉取文档树（错误提示里的「重试」按钮用）。 */
export function hzRetryNav(){
	navLang=null;
	docCache={};
	hzResetNav();
	var p=hzNav();
	// 通知所有在看文档的组件重新取
	if(typeof navSubs!=="undefined")navSubs.forEach(function(f){try{f()}catch(err){}});
	return p;
}

export function hzDoc(key){
	if(!key)return Promise.resolve(null);
	var lang=hzCurLang();
	var ck=lang+"|"+key;
	if(docCache[ck])return docCache[ck];
	var p=hzFetchJson("/api/docs/doc?key="+encodeURIComponent(key)+"&lang="+encodeURIComponent(lang)).then(function(d){
		if(d&&d.html){return d}
		// 失败不缓存，允许再次点击时重试
		if(docCache[ck]===p)delete docCache[ck];
		return null;
	});
	docCache[ck]=p;
	return p;
}

/** 把分组结构摊平成一条阅读顺序的线性列表（上一篇/下一篇按此顺序走）。 */
export function hzFlat(groups){
	var out=[];
	for(var i=0;i<(groups||[]).length;i++){
		var g=groups[i],list=g.docs||[];
		for(var j=0;j<list.length;j++){
			out.push({key:list[j].key,title:list[j].title,group:g.label,headings:list[j].headings||[]});
		}
	}
	return out;
}

var subs=new Set(),sel={key:"",hash:""};
export function hzSel(){return sel}
export function hzSetSel(patch){
	var next={
		key:patch&&patch.key!==void 0?patch.key:sel.key,
		hash:patch&&patch.hash!==void 0?patch.hash:sel.hash
	};
	if(next.key===sel.key&&next.hash===sel.hash)return;
	sel=next;
	subs.forEach(function(f){try{f(sel)}catch(err){}});
}
export function hzUseSel(){
	var st=E.useState(sel),v=st[0],set=st[1];
	E.useEffect(function(){
		var f=function(x){set(x)};
		subs.add(f);set(sel);
		return function(){subs.delete(f)};
	},[]);
	return v;
}
var navGen=0;
var navSubs=new Set();

/**
 * 订阅文档树。
 *
 * ⚠️ 不能只在挂载时取一次：失败后点「重试」需要重新发请求，
 * 而 effect 依赖是空数组就永远不会再跑。这里用一个全局代数（navGen）
 * 当作订阅源：重试时把它加一，所有正在看文档的组件都会重新取。
 */
export function hzUseNav(){
	var st=E.useState(null),v=st[0],set=st[1];
	E.useEffect(function(){
		var alive=true;
		function load(){
			hzNav().then(function(d){
				if(!alive)return;
				if(d&&d.groups){set(d.groups);return}
				set([]);          // 失败也要置位，否则页面分不清「还在取」和「取不到」
			});
		}
		load();
		navSubs.add(load);
		return function(){alive=false;navSubs.delete(load)};
	},[]);
	return v;
}

/** 让所有订阅者重新拉取文档树。 */
export function hzReloadNav(){
	navSubs.forEach(function(f){try{f()}catch(err){}});
}
export function hzScrollTo(slug){
	if(!slug)return;
	setTimeout(function(){
		var el=document.getElementById(slug);
		if(el&&el.scrollIntoView)el.scrollIntoView({behavior:"smooth",block:"start"});
	},90);
}
