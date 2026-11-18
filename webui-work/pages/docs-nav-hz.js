import{a as e}from"./rolldown-runtime-CNC7AqOf.js";
import{dt as a}from"./api-CBg-YqKK.js";
var E=e(a(),1);

/* ===========================================================================
 * 文档数据与选中状态
 *
 * 只负责三件事：取数据、缓存、广播「当前是哪一篇」。
 * 目录树已从侧栏移除，浏览改为正文底部的「上一篇 / 下一篇」。
 * =========================================================================== */

function hzToken(){try{return localStorage.getItem("snowluma_token")||""}catch(err){return ""}}

export function hzFetchJson(url){
	var headers={},t=hzToken();
	if(t)headers.Authorization="Bearer "+t;
	return fetch(url,{headers:headers}).then(function(r){return r.ok?r.json():null}).catch(function(){return null});
}

var navPromise=null;
export function hzNav(){
	if(!navPromise)navPromise=hzFetchJson("/api/docs/nav");
	return navPromise;
}

var docCache={};
export function hzDoc(key){
	if(!key)return Promise.resolve(null);
	if(!docCache[key])docCache[key]=hzFetchJson("/api/docs/doc?key="+encodeURIComponent(key));
	return docCache[key];
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
export function hzUseNav(){
	var st=E.useState(null),v=st[0],set=st[1];
	E.useEffect(function(){
		var alive=true;
		hzNav().then(function(d){if(alive)set(d&&d.groups?d.groups:[])});
		return function(){alive=false};
	},[]);
	return v;
}
export function hzScrollTo(slug){
	if(!slug)return;
	setTimeout(function(){
		var el=document.getElementById(slug);
		if(el&&el.scrollIntoView)el.scrollIntoView({behavior:"smooth",block:"start"});
	},90);
}
