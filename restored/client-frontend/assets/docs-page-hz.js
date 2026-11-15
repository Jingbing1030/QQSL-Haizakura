import{a as e}from"./rolldown-runtime-CNC7AqOf.js";
import{dt as a,lt as o,d as fm,p as AP,u as useRM}from"./api-CBg-YqKK.js";
import{hzUseSel,hzUseNav,hzDoc,hzSetSel,hzScrollTo,hzFlat}from"./docs-nav-hz.js";
var E=e(a(),1),D=o();

/* ===========================================================================
 * 文档正文页
 *
 *   · 面包屑 + 标题（正文里的 h1 会被去掉，避免与页面标题重复）
 *   · AI 警告以 > [!WARNING] 单独成块
 *   · 底部「上一篇 / 下一篇」；到头时按钮不可用，点了提示 (,,o-o,,)
 *   · 窄屏可折叠目录、宽屏右侧「本页目录」
 *
 * 动画沿用前端既有语言：AnimatePresence + height:0↔auto、spring、cubic-bezier。
 * =========================================================================== */

var HZ_EASE=[.16,1,.3,1];
var HZ_NOPE="(,,o-o,,)";        // 到头时的提示语

/** 正文后处理：去重标题、警告单独成块、宽表格加滚动容器 */
function hzDecorate(html){
	var out=html;
	// ① 去掉正文开头与页面标题重复的 h1
	out=out.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/,"");
	// ② AI 警告：单独成块的 > [!WARNING]
	out=out.replace(
		/<blockquote>\s*<p>\s*\[!WARNING\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/g,
		'<blockquote class="hz-warn"><p><strong>[!WARNING]</strong></p><p>$1</p></blockquote>'
	);
	// ③ 其它 GitHub 风格提示
	out=out.replace(
		/<blockquote>\s*<p>\s*\[!NOTE\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/g,
		'<blockquote class="hz-note"><p><strong>[!NOTE]</strong></p><p>$1</p></blockquote>'
	);
	out=out.replace(
		/<blockquote>\s*<p>\s*\[!TIP\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/g,
		'<blockquote class="hz-tip"><p><strong>[!TIP]</strong></p><p>$1</p></blockquote>'
	);
	// ④ 表格横向滚动
	out=out.replace(/<table>/g,'<div class="hz-table-wrap"><table>');
	out=out.replace(/<\/table>/g,'</table></div>');
	return out;
}

function HzMobileNav(){
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
				children:D.jsx("div",{className:"hz-doc-mobile-panel",children:D.jsx(HzDocList,{onItemClick:function(){setOpen(false)}})})
			})
			:null})
	]});
}

/** 窄屏的篇目列表（替代原侧栏树，只在移动端面板里用） */
function HzDocList(props){
	var nav=hzUseNav(),cur=hzUseSel();
	var flat=hzFlat(nav);
	if(!flat.length)return null;
	var after=props&&props.onItemClick;
	return D.jsx("div",{className:"hz-doclist",children:flat.map(function(it){
		var on=it.key===cur.key;
		return D.jsxs("button",{
			key:it.key,
			type:"button",
			className:"hz-doclist-item"+(on?" active":""),
			onClick:function(){hzSetSel({key:it.key,hash:""});if(after)after()},
			children:[
				D.jsx("span",{className:"hz-doclist-group",children:it.group}),
				D.jsx("span",{className:"hz-doclist-title",children:it.title})
			]
		},it.key);
	})});
}

/** 右侧「本页目录」 */
function HzToc(props){
	var headings=props.headings||[];
	var rm=useRM();
	var st=E.useState(""),act=st[0],setAct=st[1];
	E.useEffect(function(){
		if(!headings.length)return;
		var onScroll=function(){
			var best="";
			for(var i=0;i<headings.length;i++){
				var el=document.getElementById(headings[i].slug);
				if(!el)continue;
				if(el.getBoundingClientRect().top<=110)best=headings[i].slug;else break;
			}
			setAct(best||(headings[0]?headings[0].slug:""));
		};
		onScroll();
		window.addEventListener("scroll",onScroll,{passive:true});
		return function(){window.removeEventListener("scroll",onScroll)};
	},[headings]);
	if(!headings.length)return null;
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

/**
 * 上一篇 / 下一篇。
 * 到头的按钮不可选中（disabled），点击时给出 (,,o-o,,) 提示。
 */
function HzPager(props){
	var flat=props.flat,idx=props.idx;
	var tipSt=E.useState(""),tip=tipSt[0],setTip=tipSt[1];
	var rm=useRM();
	var timer=E.useRef(null);

	E.useEffect(function(){
		return function(){if(timer.current)clearTimeout(timer.current)};
	},[]);

	// 切篇时清掉提示
	E.useEffect(function(){setTip("")},[idx]);

	var nope=function(delta){
		// delta < 0 表示「上一篇」到头，> 0 表示「下一篇」到头
		setTip((delta<0?"已经是第一篇了 ":"已经是最后一篇了 ")+HZ_NOPE);
		if(timer.current)clearTimeout(timer.current);
		timer.current=setTimeout(function(){setTip("")},2600);
	};

	var mk=function(delta,label){
		var target=idx+delta;
		var ok=target>=0&&target<flat.length;
		var go=function(){
			if(!ok){nope(delta);return}
			hzSetSel({key:flat[target].key,hash:""});
			hzScrollTo("");
			try{window.scrollTo({top:0,behavior:"smooth"})}catch(err){}
		};
		var cls="hz-pager-btn"+(delta>0?" hz-pager-next":"");
		var inner=[
			delta<0?D.jsx("span",{className:"hz-pager-arrow","aria-hidden":"true",children:"\u2190"}):null,
			D.jsxs("span",{className:"hz-pager-text",children:[
				D.jsx("span",{className:"hz-pager-label",children:label}),
				D.jsx("span",{className:"hz-pager-title",children:ok?flat[target].title:"\u6CA1\u6709\u4E86"})
			]}),
			delta>0?D.jsx("span",{className:"hz-pager-arrow","aria-hidden":"true",children:"\u2192"}):null
		];
		return D.jsx("button",{
			type:"button",
			className:cls+(ok?"":" disabled"),
			"aria-disabled":ok?void 0:"true",
			"data-ok":ok?"1":"0",
			title:ok?flat[target].title:(delta<0?"\u5DF2\u7ECF\u662F\u7B2C\u4E00\u7BC7\u4E86":"\u5DF2\u7ECF\u662F\u6700\u540E\u4E00\u7BC7\u4E86"),
			onClick:go,
			children:inner
		});
	};

	return D.jsxs("div",{className:"hz-pager",children:[
		D.jsxs("div",{className:"hz-pager-row",children:[
			mk(-1,"\u4E0A\u4E00\u7BC7"),
			mk(1,"\u4E0B\u4E00\u7BC7")
		]}),
		D.jsx(AP,{initial:!1,children:tip
			?D.jsx(fm.div,{
				initial:{height:0,opacity:0},
				animate:{height:"auto",opacity:1},
				exit:{height:0,opacity:0},
				transition:rm?{duration:0}:{height:{duration:.2,ease:HZ_EASE},opacity:{duration:.16}},
				className:"overflow-hidden",
				children:D.jsx("p",{className:"hz-pager-tip",role:"status",children:tip})
			})
			:null})
	]});
}

export function DocsPage(){
	var sel=hzUseSel();
	var nav=hzUseNav();
	var st=E.useState(null),doc=st[0],setDoc=st[1];
	var es=E.useState(""),err=es[0],setErr=es[1];
	var rm=useRM();

	var flat=hzFlat(nav);

	// 首次进入若没有选中项，取第一篇
	E.useEffect(function(){
		if(sel.key||!flat.length)return;
		hzSetSel({key:flat[0].key,hash:""});
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

	var idx=-1;
	for(var i=0;i<flat.length;i++)if(flat[i].key===sel.key){idx=i;break}
	var groupLabel=idx>=0?flat[idx].group:"";

	var bodyKey=err?"err":(doc?doc.key:"load");
	var body=err
		?D.jsx("p",{className:"hz-doc-err",children:err})
		:(doc
			?D.jsx("div",{className:"hz-doc-article",dangerouslySetInnerHTML:{__html:hzDecorate(doc.html)}})
			:D.jsx("p",{className:"hz-doc-loading",children:"\u52A0\u8F7D\u4E2D\u2026"}));

	return D.jsxs("div",{className:"hz-doc-page",children:[
		D.jsx(HzMobileNav,{}),
		D.jsxs("div",{className:"hz-doc-head",children:[
			groupLabel?D.jsx("span",{className:"hz-doc-crumb",children:groupLabel}):null,
			D.jsx("h1",{className:"hz-doc-title",children:doc?doc.title:sel.key||"\u6587\u6863"})
		]}),
		D.jsxs("div",{className:"hz-doc-cols",children:[
			D.jsxs("div",{className:"hz-doc-main",children:[
				D.jsx(AP,{mode:"wait",initial:!1,children:
					D.jsx(fm.div,{
						key:bodyKey,
						initial:rm?false:{opacity:0,y:6},
						animate:{opacity:1,y:0},
						exit:rm?{opacity:1}:{opacity:0,y:-4},
						transition:rm?{duration:0}:{duration:.22,ease:HZ_EASE},
						children:body
					},bodyKey)
				}),
				flat.length&&!err?D.jsx(HzPager,{flat:flat,idx:idx}):null
			]}),
			doc&&doc.headings&&doc.headings.length
				?D.jsx("aside",{className:"hz-doc-aside",children:D.jsx(HzToc,{headings:doc.headings,curHash:sel.hash})})
				:null
		]})
	]});
}
