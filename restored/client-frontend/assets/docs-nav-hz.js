import{a as e}from"./rolldown-runtime-CNC7AqOf.js";
import{dt as a,lt as o,d as fm,p as AP,u as useRM}from"./api-CBg-YqKK.js";
var E=e(a(),1),D=o();

/* ===========================================================================
 * 文档共享状态 + 侧栏目录树
 *
 * 侧栏（router chunk）与文档页（docs-page-hz.js）都引用本模块，因此模块级的
 * 选中状态与缓存是同一个实例 —— 侧栏点一下，正文立刻跟着换。
 *
 * 动画沿用前端既有语言（见 router / config-page / index chunk）：
 *   · 折叠展开：AnimatePresence + height:0 ↔ "auto" + opacity，overflow-hidden
 *   · 箭头旋转：spring {stiffness:380, damping:32}
 *   · 缓动：cubic-bezier(.16,1,.3,1)（原代码里展开动画用的同一条）
 *   · 尊重系统「减少动效」设置（useReducedMotion）
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

function hzGroupOf(groups,key){
	for(var i=0;i<(groups||[]).length;i++){
		var list=groups[i].docs||[];
		for(var j=0;j<list.length;j++)if(list[j].key===key)return groups[i].label;
	}
	return "";
}
function hzCount(groups){
	var n=0;
	for(var i=0;i<(groups||[]).length;i++)n+=(groups[i].docs||[]).length;
	return n;
}

/**
 * 章节列表：h2 直接列出；h3 收在所属 h2 之下，逐个可展开。
 * 这样 actions.md 这种 251 个标题的文档也不会一次撑满侧栏。
 */
function hzBuildHeads(doc,heads,ctx){
	var out=[],i=0;
	var go=function(h){
		return function(ev){
			if(ev){ev.preventDefault()}
			hzSetSel({key:doc.key,hash:h.slug});
			hzScrollTo(h.slug);
			if(ctx.after)ctx.after();
		};
	};
	var mkRow=function(h,cls,key){
		var props={to:"/docs",className:cls,title:h.text,onClick:go(h),children:h.text};
		return ctx.LinkComp
			?D.jsx(ctx.LinkComp,props,key)
			:D.jsx("button",Object.assign({type:"button"},props),key);
	};
	while(i<heads.length){
		var h=heads[i];
		if(h.level===2){
			// 收集紧随其后的 h3
			let subs=[],j=i+1;
			while(j<heads.length&&heads[j].level===3){subs.push(heads[j]);j++}
			let sk=doc.key+":"+h.slug,sOpen=ctx.openSub[sk]===true;
			if(!subs.length){
				out.push(mkRow(h,"hz-nav-row hz-nav-head lv2",sk));
			}else{
				out.push(D.jsxs("div",{className:"hz-nav-sub",children:[
					D.jsxs("div",{className:"hz-nav-row hz-nav-head lv2 hz-nav-subhead"+(sOpen?" open":""),children:[
						mkRow(h,"hz-nav-head-link",sk+":a"),
						D.jsx("span",{
							role:"button",tabIndex:0,className:"hz-nav-headtoggle",
							"aria-label":sOpen?"收起子章节":"展开子章节",
							onClick:function(ev){
								ev.stopPropagation();ev.preventDefault();
								ctx.setOpenSub(function(prev){
									var next=Object.assign({},prev);
									next[sk]=!sOpen;
									return next;
								});
							},
							children:ctx.caret(sOpen)
						})
					]}),
					ctx.panel(sOpen,"hz-nav-sublist",subs.map(function(h3){
						return mkRow(h3,"hz-nav-row hz-nav-head lv3",doc.key+":"+h3.slug);
					}))
				]},sk));
			}
			i=j;
		}else{
			out.push(mkRow(h,"hz-nav-row hz-nav-head lv2",doc.key+":"+h.slug));
			i++;
		}
	}
	return out;
}

/**
 * 侧栏目录树 —— 折叠语义：
 *   ① 整棵树：在 /docs 页时默认展开；离开后自动折叠（除非用户手动开过）
 *   ② 分组：在 /docs 页且包含当前文档时默认展开（除非用户手动动过）
 *   ③ 章节：默认一律折叠，必须用户手动展开；切换文档即自动折叠
 */
export function DocsNavTree(props){
	var groups=hzUseNav(),cur=hzUseSel();
	var active=props&&props.active!==void 0?props.active:true;
	var reduce=useRM();

	// null = 用户未干预 → 用默认值；非 null = 用户手动设定
	var tSt=E.useState(null),manualTree=tSt[0],setManualTree=tSt[1];
	var gSt=E.useState({}),manualGroups=gSt[0],setManualGroups=gSt[1];
	var dSt=E.useState({}),manualDocs=dSt[0],setManualDocs=dSt[1];
	var sSt=E.useState({}),manualSub=sSt[0],setManualSub=sSt[1];

	var curGroup=hzGroupOf(groups,cur.key);

	// 切换文档 → 折叠上一篇的章节（它已「不在文档」）。保留当前篇的手动状态。
	E.useEffect(function(){
		setManualDocs(function(prev){
			// 切走的文档：如果它是被手动展开的，收起它（即「不在文档时折叠」）；
			// 没开过的直接丢弃。
			var next={},changed=false;
			for(var k in prev){
				if(k===cur.key||prev[k]!==true)next[k]=prev[k];
				else changed=true;
			}
			return changed?next:prev;
		});
	},[cur.key]);

	// 离开 /docs → 整棵树回到折叠（章节一并收起）
	E.useEffect(function(){
		if(!active){
			setManualTree(null);
			setManualDocs({});
			setManualSub({});
		}
	},[active]);

	var treeOpen=manualTree===null?active:manualTree;
	var groupOpen=function(label){
		var m=manualGroups[label];
		if(m!==void 0)return m;
		return active&&label===curGroup;
	};
	// 章节：只有用户手动开过才展开（默认一律折叠）
	var docOpen=function(key){return manualDocs[key]===true};

	var mkAnim=function(){
		return reduce
			?{duration:0}
			:{height:{duration:.22,ease:[.16,1,.3,1]},opacity:{duration:.16,ease:[.16,1,.3,1]}};
	};
	var caretSpr=reduce?{duration:0}:{type:"spring",stiffness:380,damping:32};

	var caret=function(open,extra){
		return D.jsx(fm.span,{
			className:"hz-nav-caret"+(extra?" "+extra:""),
			animate:{rotate:open?90:0},
			transition:caretSpr,
			children:"\u25B8"
		});
	};
	// 折叠面板：沿用现有 height 动画写法
	var panel=function(open,cls,children){
		return D.jsx(AP,{initial:!1,children:open
			?D.jsx(fm.div,{
				initial:{height:0,opacity:0},
				animate:{height:"auto",opacity:1},
				exit:{height:0,opacity:0},
				transition:mkAnim(),
				className:"overflow-hidden",
				children:D.jsx("div",{className:cls,children:children})
			})
			:null});
	};

	if(!groups)return null;
	var total=hzCount(groups);
	var LinkComp=props&&props.LinkComp;
	var after=props&&props.onItemClick;

	var rows=groups.map(function(g){
		var label=g.label,list=g.docs||[],gOpen=groupOpen(label);
		return D.jsxs("div",{className:"hz-nav-group",children:[
			D.jsxs("button",{
				type:"button",
				className:"hz-nav-row hz-nav-group-btn"+(gOpen?" open":""),
				"aria-expanded":gOpen,
				onClick:function(){
					setManualGroups(function(prev){
						var next=Object.assign({},prev);
						next[label]=!gOpen;
						return next;
					});
				},
				children:[
					caret(gOpen),
					D.jsx("span",{className:"hz-nav-label",children:label}),
					D.jsx("span",{className:"hz-nav-count",children:list.length})
				]
			}),
			panel(gOpen,"hz-nav-docs",list.map(function(doc){
				var isCur=doc.key===cur.key,isOpen=docOpen(doc.key),heads=doc.headings||[];
				var pick=function(){hzSetSel({key:doc.key,hash:""});if(after)after()};
				var body=[
					D.jsx("span",{className:"hz-nav-bullet","aria-hidden":"true"}),
					D.jsx("span",{className:"hz-nav-label",children:doc.title}),
					heads.length?D.jsx("span",{
						role:"button",
						tabIndex:0,
						className:"hz-nav-headtoggle",
						"aria-label":isOpen?"收起章节":"展开章节",
						onClick:function(ev){
							ev.stopPropagation();ev.preventDefault();
							setManualDocs(function(prev){
								var next=Object.assign({},prev);
								next[doc.key]=!isOpen;
								return next;
							});
							// 展开非当前文档的章节时，顺带把该文档设为当前
							// （否则「切换文档即折叠」的清理逻辑会立刻收掉它）
							if(!isCur)hzSetSel({key:doc.key,hash:""});
						},
						onKeyDown:function(ev){
							if(ev.key==="Enter"||ev.key===" "){
								ev.preventDefault();ev.stopPropagation();
								setManualDocs(function(prev){
									var next=Object.assign({},prev);
									next[doc.key]=!isOpen;
									return next;
								});
								if(!isCur)hzSetSel({key:doc.key,hash:""});
							}
						},
						children:caret(isOpen)
					}):null
				];
				var rowCls="hz-nav-row hz-nav-doc"+(isCur?" active":"")+(isOpen?" open":"");
				var node=LinkComp
					?D.jsx(LinkComp,{to:"/docs",className:rowCls,title:doc.title,onClick:pick,children:body},doc.key)
					:D.jsx("button",{type:"button",className:rowCls,title:doc.title,onClick:pick,children:body},doc.key);
				return D.jsxs("div",{className:"hz-nav-doc-row",children:[
					node,
					panel(isOpen,"hz-nav-heads",hzBuildHeads(doc,heads,{
						LinkComp:LinkComp,after:after,caret:caret,panel:panel,
						openSub:manualSub,setOpenSub:setManualSub
					}))
				]},doc.key);
			}))
		]},label);
	});

	return D.jsxs("div",{className:"hz-nav-tree","data-open":treeOpen,children:[
		D.jsxs("button",{
			type:"button",
			className:"hz-nav-row hz-nav-tree-btn"+(treeOpen?" open":""),
			"aria-expanded":treeOpen,
			onClick:function(){setManualTree(!treeOpen)},
			children:[
				caret(treeOpen),
				D.jsx("span",{className:"hz-nav-label","data-title":"","children":"\u6587\u6863\u76EE\u5F55"}),
				D.jsx("span",{className:"hz-nav-count",children:total})
			]
		}),
		panel(treeOpen,"hz-nav-groups",rows)
	]});
}
