import{a as e}from"./rolldown-runtime-CNC7AqOf.js";import{dt as a,lt as o}from"./api-CBg-YqKK.js";
import{hzUseSel,hzUseNav,hzDoc,hzSetSel,hzScrollTo,DocsNavTree}from"./docs-nav-hz.js";
var E=e(a(),1),D=o();

/* ===========================================================================
 * 文档正文页
 *
 * 目录树在侧栏（docs-nav-hz.js 的 DocsNavTree），本页只负责正文：
 *   · 面包屑 + 标题
 *   · 服务端渲染好的 HTML（dangerouslySetInnerHTML）
 *   · 移动端目录折叠面板
 *   · 宽屏右侧「本页目录」
 *
 * 排版全部来自 docs-hz.css（.hz-doc-* 前缀），删除该文件即可回退。
 * =========================================================================== */

/** 渲染后处理：
 *  ① AI 警告块加醒目样式
 *  ② 宽表格包一层容器以支持横向滚动（服务端已对部分表格加了 .tw）
 */
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
	var content=open?D.jsx("div",{className:"hz-doc-mobile-panel",children:D.jsx(DocsNavTree,{onItemClick:function(){setOpen(false)}})}):null;
	return D.jsxs("div",{className:"hz-doc-mobile",children:[
		D.jsxs("button",{
			type:"button",
			className:"hz-doc-mobile-btn",
			onClick:function(){setOpen(!open)},
			children:[D.jsx("span",{className:"hz-nav-caret"+(open?" open":""),children:"\u25B8"}),open?"\u9690\u85CF\u76EE\u5F55":"\u6253\u5F00\u76EE\u5F55"]
		}),
		content
	]});
}

function hzToc(headings,curHash){
	if(!headings||!headings.length)return null;
	return D.jsxs("nav",{className:"hz-toc",children:[
		D.jsx("p",{className:"hz-toc-title",children:"\u672C\u9875\u76EE\u5F55"}),
		headings.map(function(h){
			return D.jsx("a",{
				href:"#"+h.slug,
				className:"hz-toc-link"+(h.level===3?" lv3":""),
				title:h.text,
				onClick:function(ev){
					ev.preventDefault();
					hzSetSel({hash:h.slug});
					hzScrollTo(h.slug);
				},
				children:h.text
			},h.slug);
		})
	]});
}

export function DocsPage(){
	var sel=hzUseSel();
	var nav=hzUseNav();
	var st=E.useState(null),doc=st[0],setDoc=st[1];
	var es=E.useState(""),err=es[0],setErr=es[1];

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
			setDoc(d);
			hzScrollTo(sel.hash);
		});
		return function(){alive=false};
	},[sel.key]);

	// 锚点变化时滚动
	E.useEffect(function(){
		if(sel.hash&&doc)hzScrollTo(sel.hash);
	},[sel.hash,doc]);

	var groupLabel="";
	if(nav&&sel.key){
		for(var i=0;i<nav.length;i++){
			var list=nav[i].docs||[];
			for(var j=0;j<list.length;j++){
				if(list[j].key===sel.key){groupLabel=nav[i].label;break}
			}
			if(groupLabel)break;
		}
	}

	var body;
	if(err)body=D.jsx("p",{className:"hz-doc-err",children:err});
	else if(!doc)body=D.jsx("p",{className:"hz-doc-loading",children:"\u52A0\u8F7D\u4E2D\u2026"});
	else body=D.jsx("div",{className:"hz-doc-article",dangerouslySetInnerHTML:{__html:hzDecorate(doc.html)}});

	return D.jsxs("div",{className:"hz-doc-page",children:[
		hzMobileNav(),
		D.jsxs("div",{className:"hz-doc-head",children:[
			groupLabel?D.jsx("span",{className:"hz-doc-crumb",children:groupLabel}):null,
			D.jsx("h1",{className:"hz-doc-title",children:doc?doc.title:sel.key||"\u6587\u6863"})
		]}),
		D.jsxs("div",{className:"hz-doc-cols",children:[
			D.jsx("div",{className:"hz-doc-main",children:body}),
			doc&&doc.headings&&doc.headings.length
				?D.jsx("aside",{className:"hz-doc-aside",children:hzToc(doc.headings,sel.hash)})
				:null
		]})
	]});
}
