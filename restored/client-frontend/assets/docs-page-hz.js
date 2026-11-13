import{a as e}from"./rolldown-runtime-CNC7AqOf.js";
import{dt as a,lt as o,d as fm,p as AP,u as useRM}from"./api-CBg-YqKK.js";
import{hzUseSel,hzUseNav,hzDoc,hzSetSel,hzScrollTo,DocsNavTree}from"./docs-nav-hz.js";
var E=e(a(),1),D=o();

/* ===========================================================================
 * 文档正文页
 *
 * 目录树在侧栏（docs-nav-hz.js），本页只负责正文：
 *   · 面包屑 + 标题
 *   · 服务端渲染好的 HTML（dangerouslySetInnerHTML）
 *   · 窄屏可折叠目录面板（带高度动画）
 *   · 宽屏右侧「本页目录」
 *
 * 动画沿用前端既有语言：AnimatePresence + height:0↔auto、淡入位移、spring。
 * =========================================================================== */

var HZ_EASE=[.16,1,.3,1];

/** 渲染后处理：AI 警告加醒目样式；宽表格包一层容器以支持横向滚动。 */
function hzDecorate(html){
	var out=html;
	out=out.replace(
		/<blockquote><p>\[!WARNING\]([\s\S]*?)<\/p><\/blockquote>/g,
		'<blockquote class="hz-warn"><p><strong>\u26A0 \u63D0\u9192</strong>$1</p></blockquote>'
	);
	out=out.replace(
		/<blockquote><p>\[!NOTE\]([\s\S]*?)<\/p><\/blockquote>/g,
		'<blockquote><p><strong>\u2139 \u8BF4\u660E</strong>$1</p></blockquote>'
	);
	out=out.replace(/<table>/g,'<div class="hz-table-wrap"><table>');
	out=out.replace(/<\/table>/g,'</table></div>');
	return out;
}

function hzMobileNav(){
	var st=E.useState(false),open=st[0],setOpen=st[1];
	var rm=useRM();
	var tr=rm?{duration:0}:{height:{duration:.24,ease:HZ_EASE},opacity:{duration:.18,ease:HZ_EASE}};
	var caretTr=rm?{duration:0}:{type:"spring",stiffness:380,damping:32};
	return D.jsxs("div",{className:"hz-doc-mobile",children:[
		D.jsxs("button",{
			type:"button",
			className:"hz-doc-mobile-btn",
			"aria-expanded":open,
			onClick:function(){setOpen(!open)},
			children:[
				D.jsx(fm.span,{className:"hz-nav-caret",animate:{rotate:open?90:0},transition:caretTr,children:"\u25B8"}),
				D.jsx("span",{children:open?"\u9690\u85CF\u76EE\u5F55":"\u6253\u5F00\u76EE\u5F55"})
			]
		}),
		D.jsx(AP,{initial:!1,children:open
			?D.jsx(fm.div,{
				initial:{height:0,opacity:0},
				animate:{height:"auto",opacity:1},
				exit:{height:0,opacity:0},
				transition:tr,
				className:"overflow-hidden",
				children:D.jsx("div",{className:"hz-doc-mobile-panel",children:D.jsx(DocsNavTree,{active:true,onItemClick:function(){setOpen(false)}})})
			})
			:null})
	]});
}

function hzToc(headings,curHash){
	if(!headings||!headings.length)return null;
	var rm=useRM();
	var st=E.useState(""),act=st[0],setAct=st[1];
	// 用滚动位置高亮当前章节（简单实现：按已滚过的标题推算）
	E.useEffect(function(){
		var onScroll=function(){
			var best="";
			for(var i=0;i<headings.length;i++){
				var el=document.getElementById(headings[i].slug);
				if(!el)continue;
				var top=el.getBoundingClientRect().top;
				if(top<=110)best=headings[i].slug;else break;
			}
			setAct(best||(headings[0]?headings[0].slug:""));
		};
		onScroll();
		window.addEventListener("scroll",onScroll,{passive:true});
		return function(){window.removeEventListener("scroll",onScroll)};
	},[headings]);
	return D.jsxs("nav",{className:"hz-toc",children:[
		D.jsx("p",{className:"hz-toc-title",children:"\u672C\u9875\u76EE\u5F55"}),
		headings.map(function(h){
			var on=h.slug===act;
			return D.jsxs("a",{
				href:"#"+h.slug,
				className:"hz-toc-link"+(h.level===3?" lv3":"")+(on?" active":""),
				title:h.text,
				onClick:function(ev){
					ev.preventDefault();
					hzSetSel({hash:h.slug});
					hzScrollTo(h.slug);
				},
				children:[
					D.jsx(fm.span,{
						className:"hz-toc-dot",
						animate:{scale:on?1:.55,opacity:on?1:.4},
						transition:rm?{duration:0}:{type:"spring",stiffness:400,damping:30}
					}),
					D.jsx("span",{className:"hz-toc-text",children:h.text})
				]
			},h.slug);
		})
	]});
}

export function DocsPage(){
	var sel=hzUseSel();
	var nav=hzUseNav();
	var st=E.useState(null),doc=st[0],setDoc=st[1];
	var es=E.useState(""),err=es[0],setErr=es[1];
	var rm=useRM();

	// 首次进入若没有选中项，取第一篇
	E.useEffect(function(){
		if(sel.key||!nav||!nav.length)return;
		for(var i=0;i<nav.length;i++){
			var list=nav[i].docs||[];
			if(list.length){hzSetSel({key:list[0].key,hash:""});return}
		}
	},[nav,sel.key]);

	E.useEffect(function(){
		if(!sel.key){setDoc(null);return}
		var alive=true;
		setErr("");
		hzDoc(sel.key).then(function(d){
			if(!alive)return;
			if(!d){setErr("\u65E0\u6CD5\u52A0\u8F7D\u8BE5\u6587\u6863\u3002");setDoc(null);return}
			setDoc(d);hzScrollTo(sel.hash);
		});
		return function(){alive=false};
	},[sel.key]);

	E.useEffect(function(){if(sel.hash&&doc)hzScrollTo(sel.hash)},[sel.hash,doc]);

	var groupLabel="";
	if(nav&&sel.key){
		for(var i=0;i<nav.length;i++){
			var list=nav[i].docs||[];
			for(var j=0;j<list.length;j++)if(list[j].key===sel.key){groupLabel=nav[i].label;break}
			if(groupLabel)break;
		}
	}

	// 骨架 / 错误 / 正文（切换时淡入，避免闪白）
	var bodyKey=err?"err":(doc?doc.key:"load");
	var body=err
		?D.jsx("p",{className:"hz-doc-err",children:err})
		:(doc
			?D.jsx("div",{className:"hz-doc-article",dangerouslySetInnerHTML:{__html:hzDecorate(doc.html)}})
			:D.jsx("p",{className:"hz-doc-loading",children:"\u52A0\u8F7D\u4E2D\u2026"}));

	return D.jsxs("div",{className:"hz-doc-page",children:[
		hzMobileNav(),
		D.jsxs("div",{className:"hz-doc-head",children:[
			groupLabel?D.jsx("span",{className:"hz-doc-crumb",children:groupLabel}):null,
			D.jsx("h1",{className:"hz-doc-title",children:doc?doc.title:sel.key||"\u6587\u6863"})
		]}),
		D.jsxs("div",{className:"hz-doc-cols",children:[
			D.jsx("div",{className:"hz-doc-main",children:
				D.jsx(AP,{mode:"wait",initial:!1,children:
					D.jsx(fm.div,{
						key:bodyKey,
						initial:rm?false:{opacity:0,y:6},
						animate:{opacity:1,y:0},
						exit:rm?{opacity:1}:{opacity:0,y:-4},
						transition:rm?{duration:0}:{duration:.22,ease:HZ_EASE},
						children:body
					},bodyKey)
				})
			}),
			doc&&doc.headings&&doc.headings.length
				?D.jsx("aside",{className:"hz-doc-aside",children:hzToc(doc.headings,sel.hash)})
				:null
		]})
	]});
}
