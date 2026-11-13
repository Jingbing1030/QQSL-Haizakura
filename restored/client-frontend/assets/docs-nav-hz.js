import{a as e}from"./rolldown-runtime-CNC7AqOf.js";import{dt as a,lt as o}from"./api-CBg-YqKK.js";
var E=e(a(),1),D=o();

/* ===========================================================================
 * 文档共享状态 + 侧栏目录树
 *
 * 侧栏（router chunk）与文档页（docs-page-hz.js）都引用本模块，因此模块级
 * 的选中状态与缓存是同一个实例 —— 侧栏点一下，正文立刻跟着换。
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

function hzCount(groups){
	var n=0;
	for(var i=0;i<(groups||[]).length;i++)n+=(groups[i].docs||[]).length;
	return n;
}

var CARET=D.jsx("span",{className:"hz-nav-caret",children:"\u25B8"});

/**
 * 侧栏目录树：三级折叠
 *   ① 整棵树可收起
 *   ② 每个分组可收起
 *   ③ 每篇文档的章节可收起
 * props.LinkComp 由 router 传入（用于从别的页面跳转到 /docs）；
 * 未传时退化为按钮（在 /docs 页内直接用即可）。
 */
export function DocsNavTree(props){
	var groups=hzUseNav(),cur=hzUseSel();
	var treeOpen=E.useState(true),open=treeOpen[0],setOpen=treeOpen[1];
	var gs=E.useState(null),openGroups=gs[0],setOpenGroups=gs[1];
	var ds=E.useState({}),openDocs=ds[0],setOpenDocs=ds[1];

	// 自动展开当前文档所在的分组
	E.useEffect(function(){
		if(!groups||!cur.key)return;
		for(var i=0;i<groups.length;i++){
			var list=groups[i].docs||[];
			for(var j=0;j<list.length;j++){
				if(list[j].key===cur.key){
					var label=groups[i].label;
					setOpenGroups(function(prev){
						if(!prev||prev[label])return prev;
						var next=Object.assign({},prev);
						next[label]=true;
						return next;
					});
					return;
				}
			}
		}
	},[groups,cur.key]);

	if(!groups)return null;
	var total=hzCount(groups);
	var LinkComp=props&&props.LinkComp;
	var after=props&&props.onItemClick;
	var rows=[];

	if(open){
		groups.forEach(function(g){
			var label=g.label,gOpen=openGroups?!!openGroups[label]:true,list=g.docs||[];
			rows.push(D.jsxs("div",{className:"hz-nav-group",children:[
				D.jsxs("button",{
					type:"button",
					className:"hz-nav-group-btn",
					onClick:function(){
						setOpenGroups(function(prev){
							var base=prev;
							if(!base){
								base={};
								for(var q=0;q<groups.length;q++)base[groups[q].label]=true;
							}
							var next=Object.assign({},base);
							next[label]=!base[label];
							return next;
						});
					},
					children:[
						D.jsx("span",{className:"hz-nav-caret"+(gOpen?" open":""),children:"\u25B8"}),
						D.jsx("span",{className:"truncate",children:label}),
						D.jsx("span",{className:"ml-auto tabular-nums opacity-60",children:list.length})
					]
				}),
				gOpen?D.jsx("div",{className:"hz-nav-docs",children:list.map(function(doc){
					var active=doc.key===cur.key;
					var heads=doc.headings||[];
					var dOpen=!!openDocs[doc.key];
					var pick=function(){
						hzSetSel({key:doc.key,hash:""});
						if(after)after();
					};
					var titleEl=LinkComp
						?D.jsx(LinkComp,{to:"/docs",className:"hz-nav-doc"+(active?" active":""),title:doc.title,onClick:pick,children:doc.title},doc.key)
						:D.jsx("button",{type:"button",className:"hz-nav-doc"+(active?" active":""),title:doc.title,onClick:pick,children:doc.title},doc.key);
					return D.jsxs("div",{className:"hz-nav-doc-row",children:[
						titleEl,
						heads.length?D.jsx("button",{
							type:"button",
							className:"hz-nav-headtoggle",
							"aria-label":dOpen?"收起章节":"展开章节",
							onClick:function(){
								setOpenDocs(function(prev){
									var next=Object.assign({},prev);
									next[doc.key]=!prev[doc.key];
									return next;
								});
							},
							children:D.jsx("span",{className:"hz-nav-caret"+(dOpen?" open":""),children:"\u25B8"})
						}):null,
						dOpen&&heads.length?D.jsx("div",{className:"hz-nav-heads",children:heads.map(function(h){
							var go=function(){
								hzSetSel({key:doc.key,hash:h.slug});
								hzScrollTo(h.slug);
								if(after)after();
							};
							var cls="hz-nav-head"+(h.level===3?" lv3":"");
							return LinkComp
								?D.jsx(LinkComp,{to:"/docs",className:cls,title:h.text,onClick:go,children:h.text},doc.key+":"+h.slug)
								:D.jsx("button",{type:"button",className:cls,title:h.text,onClick:go,children:h.text},doc.key+":"+h.slug);
						})}):null
					]},doc.key);
				})}):null
			]},label));
		});
	}

	return D.jsxs("div",{className:"hz-nav-tree",children:[
		D.jsxs("button",{
			type:"button",
			className:"hz-nav-tree-btn",
			"aria-expanded":open,
			onClick:function(){setOpen(!open)},
			children:[
				D.jsx("span",{className:"hz-nav-caret"+(open?" open":""),children:"\u25B8"}),
				D.jsx("span",{children:"\u6587\u6863\u76EE\u5F55"}),
				D.jsx("span",{className:"ml-auto tabular-nums opacity-60",children:total})
			]
		}),
		open?D.jsx("div",{className:"hz-nav-groups",children:rows}):null
	]});
}
