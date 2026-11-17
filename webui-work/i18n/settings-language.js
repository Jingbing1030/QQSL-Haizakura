/**
 * settings-language.js — 在设置页「外观」区块动态插入「语言」小节
 *
 * 目标页面的结构（来自编译后的 settings-page chunk，无法改源码，所以运行时找）：
 *
 *   <div class="flex flex-col gap-5">                 ← 外观页面根
 *     <fieldset aria-label="主题、配色与背景">        ← 「主题」卡片
 *       <section>                                     ← 组件 $（带 title 的卡片）
 *         <header><h3>主题</h3><p>说明…</p></header>
 *         <div class="divide-y …border-t…">            ← 选项行容器
 *           <div>… 配色方案 …</div>
 *           <div>… 显示模式（跟随系统/浅色/深色 三按钮）…</div>
 *           <div>… 深色强度 …</div>
 *         </div>
 *       </section>
 *       <section>… 强调色 …</section>
 *     </fieldset>
 *     <section>… 背景 …</section>
 *     …
 *   </div>
 *
 * 插入策略（按可靠性从高到低逐级降级）：
 *   1. 找到标题文本为「主题」的 section，把「语言」section 插到它后面（最贴近题面要求）；
 *   2. 退一步：找到标题为「外观」的 section / 「主题、配色与背景」的 fieldset，
 *      插到它的子元素之后；
 *   3. 再退：找到设置页根容器（外观页根 / 设置页主导），插到最前面；
 *   4. 兜底：在设置页顶部挂一个**浮动**语言切换条，保证功能一定可用。
 *
 * 每级都做了幂等保护：重复调用不会插入第二份。
 * 每次语言变化后，选择器自身的高亮与文案会重新渲染（因为我们是文案表之外的原生 DOM）。
 *
 * 纯 ES module，无外部依赖。
 */

import { LANGS, getLang, setLang, onLangChange, t } from './hz-i18n-core.js';
import { MARK_ATTR } from './hz-i18n-dom.js';

/** 选择器容器的 id，用于幂等判断。 */
export const PICKER_ID = 'hz-language-picker';

/** 兜底浮动条的 id。 */
export const FALLBACK_ID = 'hz-language-fallback';

/** 挂到 <html> 上，记录当前用的是哪一级插入策略。 */
const MODE_ATTR = 'data-hz-lang-picker-mode';

/* ------------------------------------------------------------------ *
 * 文案
 * ------------------------------------------------------------------ */

/** 语言小节标题：「语言」。t() 查不到时退回中文字面量。 */
function labelTitle() {
  return t('settings.language.title') === 'settings.language.title'
    ? '语言'
    : t('settings.language.title');
}

function labelHint() {
  return t('settings.language.hint') === 'settings.language.hint'
    ? '界面显示语言，切换后立即生效并记住。'
    : t('settings.language.hint');
}

/* ------------------------------------------------------------------ *
 * 图标（内联 SVG，不依赖 chunk 里的 lucide 组件）
 * ------------------------------------------------------------------ */

/**
 * 图标用 SVG path 数据描述，运行时用 createElementNS 构建。
 *
 * 刻意**不用 innerHTML**：部分部署会启用 Trusted Types CSP，
 * 那时 `el.innerHTML = '<svg …>'` 会直接抛 TypeError；而 createElementNS 不受限制。
 */
const ICON_PATHS = {
  languages: ['m5 8 6 6', 'm4 14 6-6 2-3', 'M2 5h12', 'M7 2h1', 'm22 22-5-10-5 10', 'M14 18h6'],
  ja: ['M4 7h8', 'M8 4v3c0 4-2 7-5 9', 'M13 20c3 0 5-2 5-5V8', 'M15 4h5'],
  'zh-pseudo': ['M3 5h18', 'M3 12h18', 'M3 19h12'],
  'zh-cn': ['M8 8h8', 'M8 12h8', 'M8 16h4'],
  'zh-tw': ['M8 8h8', 'M12 8v8', 'M8 16h8'],
  en: ['M3 12h18', 'M12 3a15 15 0 0 1 0 18', 'M12 3a15 15 0 0 0 0 18'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 构建一个 24×24 描边图标。
 * @param {string} name ICON_PATHS 的键
 * @param {string} cls 图标的 class
 * @param {boolean} [withCircle] 是否加外圈（地球图标用）
 */
function buildIcon(name, cls, withCircle) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  if (withCircle) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12');
    c.setAttribute('r', '9');
    svg.appendChild(c);
  }
  for (const d of ICON_PATHS[name] || ICON_PATHS['zh-cn']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** 各语言对应的图标。 */
function languageIcon(code) {
  if (code === 'en') return buildIcon('en', 'size-3.5', true);
  if (code === 'zh-cn' || code === 'zh-tw') return buildIcon(code, 'size-3.5', true);
  return buildIcon(code, 'size-3.5', false);
}

/* ------------------------------------------------------------------ *
 * 样式（只注入一次；用 Tailwind 类 + 少量变量，跟随主题）
 * ------------------------------------------------------------------ */

const STYLE_ID = 'hz-language-picker-style';

/**
 * 样式与选择器自身都不该被 DOM 翻译器改写：
 * 语言名是各语言的自称（「日本語」不该在英语界面下变成「Japanese」）。
 */
const SKIP_MARK = 'data-hz-i18n-skip';

const CSS = `
.hz-lang-row{display:flex;flex-direction:column;gap:.75rem;padding:1rem 1.25rem;}
.hz-lang-row__label{font-size:.875rem;line-height:1.25rem;font-weight:500;margin:0;}
.hz-lang-row__hint{font-size:12px;line-height:1.35;color:var(--muted-foreground);margin:.125rem 0 0;}
.hz-lang-group{position:relative;display:inline-flex;flex-wrap:wrap;align-items:center;gap:.375rem;border-radius:.75rem;border:1px solid var(--border);background:color-mix(in oklab,var(--card) 60%,transparent);padding:.375rem;max-width:100%;}
.hz-lang-btn{position:relative;display:inline-flex;align-items:center;gap:.375rem;border-radius:9999px;border:1px solid transparent;padding:.375rem .75rem;font-size:.8125rem;line-height:1.1;font-weight:500;cursor:pointer;background:transparent;color:var(--muted-foreground);transition:color .15s ease-out,transform .15s ease-out,background-color .15s ease-out;}
.hz-lang-btn:hover{color:var(--foreground);}
.hz-lang-btn:active{transform:scale(.96);}
.hz-lang-btn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 40%,transparent);}
.hz-lang-btn[aria-checked="true"]{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary);}
.hz-lang-btn__code{font-size:11px;opacity:.7;}
.hz-lang-fallback{position:fixed;top:.75rem;right:.75rem;z-index:60;display:flex;align-items:center;gap:.5rem;border-radius:9999px;border:1px solid var(--border);background:color-mix(in oklab,var(--card) 92%,transparent);backdrop-filter:blur(8px);padding:.375rem .5rem;box-shadow:0 6px 20px rgb(0 0 0 /.18);}
.hz-lang-fallback__label{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--muted-foreground);padding-inline:.25rem;}
`;

function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.setAttribute(SKIP_MARK, '');
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

/* ------------------------------------------------------------------ *
 * 构建选择器 DOM
 * ------------------------------------------------------------------ */

/**
 * 构建语言按钮组（结构与主题的「跟随系统/浅色/深色」三按钮组一致：
 * 圆角药丸容器 + 每个选项一个带 icon 的 button，选中项高亮）。
 * @returns {HTMLElement}
 */
export function buildLanguagePicker(options) {
  const opts = options || {};
  const compact = !!opts.compact;

  const group = document.createElement('div');
  group.className = 'hz-lang-group';
  group.id = opts.id || PICKER_ID;
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', t('settings.language.picker') === 'settings.language.picker' ? '语言选择器' : t('settings.language.picker'));
  // 语言名本身是各语言的自称，不参与翻译；整体挂 skip 免得被 DOM 翻译器改写
  group.setAttribute(SKIP_MARK, '');

  for (const lang of LANGS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hz-lang-btn';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('data-hz-lang-code', lang.code);
    btn.setAttribute('title', lang.label + ' · ' + lang.english);
    btn.appendChild(languageIcon(lang.code));
    const text = document.createElement('span');
    text.className = 'hz-lang-btn__text';
    text.textContent = lang.label;
    btn.appendChild(text);
    if (!compact) {
      const codeEl = document.createElement('span');
      codeEl.className = 'hz-lang-btn__code';
      codeEl.textContent = lang.code;
      btn.appendChild(codeEl);
    }
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setLang(lang.code);
    });
    group.appendChild(btn);
  }

  syncPicker(group);
  return group;
}

/**
 * 把选中态同步到当前语言。
 *
 * **只在值真的变化时才写属性。** 本模块的 MutationObserver 监听整棵子树，
 * 无条件 `setAttribute` 会形成「写属性 → 观察器回调 → syncPicker → 再写属性」
 * 的自激循环，把微任务队列塞满导致页面卡死。
 *
 * @returns {number} 实际改动的属性个数
 */
export function syncPicker(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || !scope.querySelectorAll) return 0;
  const current = getLang();
  const btns = scope.querySelectorAll('[data-hz-lang-code]');
  let changed = 0;
  for (const btn of btns) {
    const selected = btn.getAttribute('data-hz-lang-code') === current;
    const wantChecked = selected ? 'true' : 'false';
    const wantTab = selected ? '0' : '-1';
    if (btn.getAttribute('aria-checked') !== wantChecked) {
      btn.setAttribute('aria-checked', wantChecked);
      changed += 1;
    }
    if (btn.getAttribute('tabindex') !== wantTab) {
      btn.setAttribute('tabindex', wantTab);
      changed += 1;
    }
  }
  return changed;
}

/** 构建「语言」小节（带标题 + 说明 + 按钮组）。 */
function buildLanguageSection() {
  const section = document.createElement('section');
  section.id = PICKER_ID + '-section';
  section.setAttribute(SKIP_MARK, '');

  const row = document.createElement('div');
  row.className = 'hz-lang-row';

  const label = document.createElement('p');
  label.className = 'hz-lang-row__label';
  label.id = PICKER_ID + '-label';
  label.textContent = labelTitle();

  const hint = document.createElement('p');
  hint.className = 'hz-lang-row__hint';
  hint.id = PICKER_ID + '-hint';
  hint.textContent = labelHint();

  const head = document.createElement('div');
  head.className = 'min-w-0';
  head.appendChild(label);
  head.appendChild(hint);

  const group = buildLanguagePicker({});
  group.setAttribute('aria-labelledby', label.id);
  group.setAttribute('aria-describedby', hint.id);

  row.appendChild(head);
  row.appendChild(group);
  section.appendChild(row);
  return section;
}

/* ------------------------------------------------------------------ *
 * 页面定位
 * ------------------------------------------------------------------ */

function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** 所有可能作为卡片标题的标题元素。 */
function headingElements() {
  const out = [];
  const list = document.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
  for (const el of list) out.push(el);
  return out;
}

const CARD_TAGS = /^(SECTION|FIELDSET|ARTICLE|DIV|LI)$/;

/**
 * 从某个元素向上找最近的「卡片」祖先。
 * 只认 SECTION / FIELDSET / ARTICLE；找不到再退到带 card 类名的 DIV。
 */
function nearestCard(el, allowDiv) {
  let n = el.parentElement || (el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : null);
  while (n && n !== document.body && n.nodeType === 1) {
    const tag = n.tagName;
    if (tag === 'SECTION' || tag === 'FIELDSET' || tag === 'ARTICLE') return n;
    if (allowDiv && CARD_TAGS.test(tag)) {
      const cls = typeof n.className === 'string' ? n.className : '';
      if (/card/i.test(cls)) return n;
    }
    n = n.parentElement || null;
  }
  return null;
}

/**
 * 按标题文本找卡片。
 *
 * 早期版本用「元素的 querySelector 里有这个标题」来判断，结果**外层容器也会命中**
 * （fieldset 的子孙里有 h3「主题」，于是 fieldset 抢在真正的卡片前面被返回）。
 * 现在改成反向查找：先定位标题元素本身，再向上找最近的卡片祖先，天然规避这个问题。
 *
 * @param {string[]} wanted 候选标题（各语言写法都列进来，因为 DOM 显示的是当前语言）
 * @returns {Element|null}
 */
function findByHeading(wanted) {
  const set = new Set(wanted.map(norm));
  let fallback = null;
  for (const head of headingElements()) {
    const txt = norm(head.textContent);
    if (!set.has(txt) || !txt) continue;
    const card = nearestCard(head, false) || nearestCard(head, true);
    if (card) return card;
    if (!fallback && head.parentElement) fallback = head.parentElement;
  }
  return fallback;
}

/** 「外观」这类不一定渲染成标题的区块：找自身浅层文本恰好等于目标词的卡片。 */
function findByShallowText(wanted) {
  const set = new Set(wanted.map(norm));
  const all = document.querySelectorAll('section, fieldset, article, div');
  for (const el of all) {
    const first = el.firstElementChild;
    if (!first) continue;
    const txt = norm(first.textContent);
    if (txt && txt.length <= 20 && set.has(txt)) return el;
  }
  return null;
}

/**
 * 记录本次使用的是哪一级策略。
 * @param {'theme-card'|'appearance-section'|'appearance-root'|'settings-root'|'floating'} mode
 */
function setMode(mode) {
  try {
    document.documentElement.setAttribute(MODE_ATTR, mode);
  } catch (_) {
    /* 忽略 */
  }
}

/** 读取当前策略（调试用）。 */
export function getPickerMode() {
  if (typeof document === 'undefined') return null;
  return document.documentElement.getAttribute(MODE_ATTR);
}

/** 判断某个元素是否已经在 DOM 里（我们插入的标记还在）。 */
function alreadyMounted() {
  if (typeof document === 'undefined') return false;
  return !!document.getElementById(PICKER_ID) || !!document.getElementById(PICKER_ID + '-section');
}

/**
 * 找「主题」卡片：标题为「主题」的 section / fieldset。
 * 由于 DOM 里显示的是**当前语言**，我们把 5 种语言的可能标题都试一遍。
 */
function findThemeCard() {
  return findByHeading(['主题', '主題', 'テーマ', 'Theme']);
}

function findAppearanceSection() {
  return findByHeading(['外观', '外觀', '外観', 'Appearance']) || findByShallowText(['外观', '外觀', '外観', 'Appearance']);
}

function findAppearanceRoot() {
  // 外观页根：「主题」卡片的祖先，且不是整个设置页
  const theme = findThemeCard();
  if (theme && theme.parentElement) return theme.parentElement;
  const fs = document.querySelector('fieldset[aria-label="主题、配色与背景"]');
  if (fs && fs.parentElement) return fs.parentElement;
  return null;
}

/**
 * 设置页根容器。
 *
 * 刻意**不**回退到 `#root` / `document.body`：那样在任何页面上都能"找到"容器，
 * 于是浮动兜底分支永远走不到，反倒会把语言小节插进登录页、日志页这类无关页面。
 * 这里只认真正像设置页的锚点，一个都没有时交给浮动兜底条。
 */
/**
 * 当前路由是不是设置页。
 *
 * 语言选择器**只应出现在设置页** —— 之前只看「有没有 <main>」，
 * 结果每个页面都被插了一条语言栏。改成同时看路径与 DOM 特征。
 */
function isSettingsRoute() {
  try {
    const p = (location.pathname || '').replace(/\/+$/, '') || '/';
    if (p === '/settings') return true;
    // 命中设置页的间接特征：页面上有「外观」这个分区标题
    const nodes = document.querySelectorAll('h1,h2,h3,h4,span,div,button');
    for (let i = 0; i < nodes.length && i < 400; i++) {
      const t = (nodes[i].textContent || '').trim();
      if (t === '外观' || t === '外觀' || t === 'Appearance' || t === '外観') {
        // 排除浮层/菜单里的同名文字：要求它有个像设置页的祖先
        if (nodes[i].closest('main,section,form,[class*="settings"],[class*="Settings"]')) return true;
      }
    }
  } catch (_) { /* 忽略 */ }
  return false;
}


/**
 * 设法拿到「外观」面板的容器。
 *
 * 新设置页是 tab 式：只有活动 tab 的内容在 DOM 里。
 * 如果当前不在外观 tab，就主动点一下它的按钮 —— 这样挂载点才会出现。
 * 只在设置页、且只会点一次，避免和用户操作打架。
 */
let clickedAppearance = false;
function ensureAppearancePanel() {
  // 已经有挂载点，直接返回
  const slot = document.querySelector('[data-hz-slot="language"]');
  if (slot) return slot;

  // 找「外观」导航按钮（tab）
  const labels = ['外观', '外觀', 'Appearance', '外観'];
  const candidates = document.querySelectorAll(
    '.hz-settings__nav-item, [role="tab"], nav button, [class*="nav"] button, button'
  );
  for (const btn of candidates) {
    const t = (btn.textContent || '').trim();
    if (!labels.some((L) => t === L || t.startsWith(L))) continue;
    // 已经在这个 tab 上就不重复点
    const active = btn.classList.contains('is-active') || btn.classList.contains('active') ||
                   btn.getAttribute('aria-selected') === 'true';
    if (!active && !clickedAppearance) {
      clickedAppearance = true;
      try { btn.click(); } catch (_) { /* 忽略 */ }
      return null;   // 让下一次调度再取
    }
    if (active) break;
  }

  const after = document.querySelector('[data-hz-slot="language"]');
  if (after) return after;

  // 退一步：设置宿主里任何带「外观」标题的卡片
  const host = document.querySelector('.hz-settings-host');
  if (host) {
    for (const el of host.querySelectorAll('h1,h2,h3,h4,legend,div,span')) {
      if (el.closest('button,nav,[role="tablist"],[class*="nav"]')) continue;
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').trim();
      if (labels.some((L) => t === L)) {
        const card = el.closest('section,fieldset,article,[class*="card"],[class*="panel"]');
        if (card) return card;
        if (el.parentElement) return el.parentElement;
      }
    }
  }
  return null;
}

function findSettingsRoot() {
  if (!isSettingsRoute()) return null;
  // 优先拿「外观」面板（必要时主动切 tab）
  const panel = ensureAppearancePanel();
  if (panel) return panel;
  // 面板还没出来：先回到设置宿主，下一次调度（点击 tab 之后）会再试
  return document.querySelector('.hz-settings-host') || null;
}

/* ------------------------------------------------------------------ *
 * 挂载 / 卸载
 * ------------------------------------------------------------------ */

function mountFloating() {
  if (!isSettingsRoute()) {
    const stale = document.getElementById(FALLBACK_ID);
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    return false;
  }
  if (document.getElementById(FALLBACK_ID)) return true;

  // 目标容器：外观面板 > 设置宿主 > main。（**绝不挂到 body**）
  const anchor =
    ensureAppearancePanel() ||
    document.querySelector('.hz-settings-host') ||
    document.querySelector('main');
  if (!anchor) return false;

  const bar = document.createElement('div');
  bar.className = 'hz-lang-fallback';
  bar.id = FALLBACK_ID;
  bar.setAttribute(SKIP_MARK, '');
  bar.style.cssText =
    'margin:14px 0;padding:12px 14px;border:1px solid var(--border,rgba(0,0,0,.12));' +
    'border-radius:calc(var(--radius,.75rem)*.7);display:flex;flex-direction:column;gap:8px';

  const label = document.createElement('span');
  label.className = 'hz-lang-fallback__label';
  label.textContent = labelTitle();
  label.style.cssText = 'font-size:13px;font-weight:500';
  bar.appendChild(label);
  bar.appendChild(buildLanguagePicker({ compact: false, id: PICKER_ID }));

  anchor.appendChild(bar);
  setMode('floating');
  return true;
}

/**
 * 尝试把语言小节插进设置页。
 * @returns {'theme-card'|'appearance-section'|'appearance-root'|'settings-root'|null} 实际用的策略
 */
export function mountLanguageSection() {
  // 不在设置页：把之前插进去的界面收走，直接返回
  if (!isSettingsRoute()) {
    unmountLanguageSection();
    return false;
  }
  if (typeof document === 'undefined') return null;
  ensureStyle();
  if (alreadyMounted()) return getPickerMode() || 'theme-card';

  const section = buildLanguageSection();

  // 1) 插到「主题」卡片之后
  const theme = findThemeCard();
  if (theme && theme.parentElement) {
    if (theme.nextSibling) theme.parentElement.insertBefore(section, theme.nextSibling);
    else theme.parentElement.appendChild(section);
    setMode('theme-card');
    return 'theme-card';
  }

  // 2) 插到「外观」区块里面
  const appearance = findAppearanceSection();
  if (appearance) {
    appearance.appendChild(section);
    setMode('appearance-section');
    return 'appearance-section';
  }

  // 3) 插到外观页根
  const root = findAppearanceRoot();
  if (root) {
    root.insertBefore(section, root.firstChild);
    setMode('appearance-root');
    return 'appearance-root';
  }

  // 4) 插到设置页根
  const settingsRoot = findSettingsRoot();
  if (settingsRoot) {
    settingsRoot.insertBefore(section, settingsRoot.firstChild);
    setMode('settings-root');
    return 'settings-root';
  }

  // 5) 兜底：浮动条
  mountFloating();
  return 'floating';
}

/** 移除已插入的 UI（用于卸载或重新定位）。 */
export function unmountLanguageSection() {
  if (typeof document === 'undefined') return false;
  let removed = false;
  for (const id of [PICKER_ID + '-section', FALLBACK_ID, PICKER_ID]) {
    const el = document.getElementById(id);
    if (el && el.parentNode) {
      // 浮动条内部还嵌着一个 #hz-language-picker，这里分开处理
      el.parentNode.removeChild(el);
      removed = true;
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ *
 * 观察器：SPA 路由切换后设置页是重新渲染的，插入的节点会丢
 * ------------------------------------------------------------------ */

let mo = null;
let scheduled = false;
let bound = false;

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    try {
      mountLanguageSection();
      syncPicker(document);
    } catch (_) {
      /* 忽略 */
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

/**
 * 启动设置页语言选择器。幂等：重复调用只会绑定一次观察器。
 * @returns {() => void} 停止函数
 */
export function startSettingsLanguage() {
  if (typeof document === 'undefined') return () => {};
  ensureStyle();
  mountLanguageSection();

  if (!bound) {
    bound = true;
    onLangChange(() => {
      // 语言变了：按钮高亮不变，但标题/说明需要重画
      const label = document.getElementById(PICKER_ID + '-label');
      if (label) label.textContent = labelTitle();
      const hint = document.getElementById(PICKER_ID + '-hint');
      if (hint) hint.textContent = labelHint();
      const fb = document.querySelector('.' + 'hz-lang-fallback__label');
      if (fb) fb.textContent = labelTitle();
      syncPicker(document);
    });

    // 路由变化：离开设置页就收走语言 UI
    try {
      let lastPath = location.pathname;
      setInterval(() => {
        if (location.pathname !== lastPath) {
          lastPath = location.pathname;
          if (!isSettingsRoute()) unmountLanguageSection();
          else scheduleMount();
        }
      }, 600);
    } catch (_) { /* 忽略 */ }

    // SPA 重渲染后补插
    mo = new MutationObserver(() => {
      if (!document.getElementById(PICKER_ID) && !document.getElementById(PICKER_ID + '-section')) {
        scheduleMount();
      } else {
        syncPicker(document);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  return stopSettingsLanguage;
}

/** 停止观察器（保留已插入的 UI）。 */
export function stopSettingsLanguage() {
  if (mo) {
    mo.disconnect();
    mo = null;
  }
  bound = false;
  scheduled = false;
  return true;
}

export default {
  PICKER_ID,
  FALLBACK_ID,
  buildLanguagePicker,
  mountLanguageSection,
  unmountLanguageSection,
  startSettingsLanguage,
  stopSettingsLanguage,
  syncPicker,
  getPickerMode,
};
