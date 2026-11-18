/**
 * i18n-dom.js — Haizakura WebUI DOM 运行时翻译器
 *
 * 背景：WebUI 是**编译后的 chunk**，中文原文写死在 bundle 里，无法修改产物。
 * 因此本模块反过来工作：
 *   1. 用 `i18n-messages.js` 的 zh-cn 一列建立「中文原文 → key」反向索引；
 *   2. 扫描 DOM 文本节点与 placeholder / title / aria-label 等属性；
 *   3. 命中原文后，用当前语言的译文替换。
 *
 * 关键机制：
 *   - **可逆**：命中的节点会把 `{ key, groups }` 记进 WeakMap。切回中文（或再切到
 *     别的语言）时优先用记下来的 key 重新渲染，不依赖「译文 → key」的反查。
 *   - **去重**：翻译过的文本节点/属性打上 `data-hz-i18n` 标记，避免重复处理。
 *   - **动态模板**：原文里含 `${...}` 的条目（例如 `进程 ${n}`）会被编译成正则，
 *     捕获运行时的真实值，再按目标语言的 `${...}` 槽位回填。
 *   - **节流**：MutationObserver 只把脏节点塞进队列，用 requestAnimationFrame
 *     在下一帧批量处理，并限制单帧预算，避免长列表页面卡顿。
 *   - **安全区**：script / style / code / pre / textarea 内容、contenteditable、
 *     以及带 `data-hz-i18n-skip` 的子树一律跳过（日志正文不该被翻译）。
 *
 * 纯 ES module，无外部依赖。
 */

import { MESSAGES } from './hz-i18n-messages.js';
import { getLang, onLangChange, t, DEFAULT_LANG, LANG_EVENT } from './hz-i18n-core.js';

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 已处理节点的标记属性。 */
export const MARK_ATTR = 'data-hz-i18n';

/** 挂上这个属性的子树（及其后代）会被完全跳过。 */
export const SKIP_ATTR = 'data-hz-i18n-skip';

/** 需要翻译的属性名。 */
export const ATTRS = Object.freeze(['placeholder', 'title', 'aria-label', 'alt', 'data-tooltip']);

/** 只在这些 input 类型上翻译 value。 */
const VALUE_INPUT_TYPES = new Set(['button', 'submit', 'reset']);

/** 永不进入的标签。 */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'KBD', 'SAMP',
  'SVG', 'MATH', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO',
]);

/** 文本节点最短长度：单字符不予处理，避免误伤。 */
const MIN_TEXT_LEN = 1;

/**
 * TreeWalker 的 whatToShow 掩码。
 * 注意：SHOW_TEXT / SHOW_ELEMENT 属于 `Node`，**不是** `NodeFilter`
 * （`NodeFilter.SHOW_TEXT` 在真实浏览器里是 undefined），所以这里直接用字面量，
 * 免得依赖运行环境是否把常量挂在全局上。
 */
const SHOW_TEXT = 4;
const SHOW_ELEMENT = 1;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

/* ------------------------------------------------------------------ *
 * 反向索引构建
 * ------------------------------------------------------------------ */

const HAS_CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const SLOT_RE = /\$\{[^}]*\}/g;

/**
 * 归一化用于查表的文本：统一空白（含全角空格与换行），两端去空白。
 * @param {string} s
 */
export function normalizeKey(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[\t\r\n\f\v]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把含 `${...}` 的原文编译成正则 + 槽位描述。
 * @param {string} source
 */
function compilePattern(source) {
  const parts = [];
  let last = 0;
  let slots = 0;
  SLOT_RE.lastIndex = 0;
  let m;
  while ((m = SLOT_RE.exec(source)) !== null) {
    parts.push({ literal: source.slice(last, m.index) });
    parts.push({ slot: slots++ });
    last = m.index + m[0].length;
  }
  parts.push({ literal: source.slice(last) });
  if (slots === 0) return null;

  let re = '^';
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.literal !== undefined) {
      re += escapeRegExp(normalizeKey(part.literal) ? part.literal : part.literal);
      continue;
    }
    const isLastSlot = !parts.slice(i + 1).some((p) => p.slot !== undefined);
    re += isLastSlot ? '([\\s\\S]+)' : '([\\s\\S]+?)';
  }
  re += '$';

  const literalChars = parts.filter((p) => p.literal).map((p) => p.literal).join('').length;
  if (literalChars < 2) return null; // 字面量太少，正则太松，容易误伤

  try {
    return { regex: new RegExp(re), slots };
  } catch (_) {
    return null;
  }
}

/** 目标文案里的 `${...}` 槽位数量。 */
function targetSlotCount(target) {
  SLOT_RE.lastIndex = 0;
  let n = 0;
  while (SLOT_RE.exec(target) !== null) n += 1;
  return n;
}

/** 把捕获到的运行时值回填进目标文案的 `${...}` 槽位。 */
function fillPattern(target, groups) {
  if (!groups || groups.length === 0) return target;
  let i = 0;
  return target.replace(SLOT_RE, (match) => {
    if (i >= groups.length) return match;
    const value = groups[i];
    i += 1;
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * 构建反向索引。
 * @returns {{ exact: Map<string, string>, patterns: Array<{regex: RegExp, slots: number, key: string, source: string}>, ambiguous: Map<string, string[]> }}
 */
export function buildReverseIndex() {
  const base = MESSAGES[DEFAULT_LANG] || {};
  const exact = new Map();
  const patterns = [];
  const ambiguous = new Map();

  for (const key of Object.keys(base)) {
    const source = base[key];
    if (typeof source !== 'string' || source === '') continue;
    const norm = normalizeKey(source);
    if (!norm) continue;

    if (norm.indexOf('${') !== -1 || source.indexOf('${') !== -1) {
      const compiled = compilePattern(source);
      if (compiled) {
        patterns.push({ regex: compiled.regex, slots: compiled.slots, key, source });
        continue;
      }
      // 无法编译（例如截断的 `${e.message||`）则退化为精确匹配
    }

    if (exact.has(norm)) {
      const list = ambiguous.get(norm) || [exact.get(norm)];
      list.push(key);
      ambiguous.set(norm, list);
      continue; // 保留先出现的 key
    }
    exact.set(norm, key);
  }

  // 长模式优先，减少短模式抢先命中的概率
  patterns.sort((a, b) => b.source.length - a.source.length);

  return { exact, patterns, ambiguous };
}

const INDEX = buildReverseIndex();

/**
 * 按中文原文查 key。
 * @param {string} text
 * @returns {{ key: string, groups?: string[] } | null}
 */
export function lookupKey(text) {
  const norm = normalizeKey(text);
  if (!norm || norm.length < MIN_TEXT_LEN) return null;

  const hit = INDEX.exact.get(norm);
  if (hit) return { key: hit };

  if (!HAS_CJK.test(norm)) return null; // 已经是别的语言，不用再正则试
  for (const p of INDEX.patterns) {
    const m = p.regex.exec(norm);
    if (m) return { key: p.key, groups: m.slice(1) };
  }
  return null;
}

/** 索引统计，便于排查「为什么没翻」。 */
export function indexStats() {
  return {
    exact: INDEX.exact.size,
    patterns: INDEX.patterns.length,
    ambiguous: INDEX.ambiguous.size,
  };
}

/** 存在多种中文原文映射的 key，文档/调试用。 */
export function ambiguousSources() {
  return Array.from(INDEX.ambiguous.entries());
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

/** 文本节点 → { key, groups } */
const nodeKeys = new WeakMap();
/** 元素 → Map<属性名, { key, groups }> */
const attrKeys = new WeakMap();

/**
 * 把某个捕获到的实参再翻一次。
 *
 * 原件里有很多「把中文当参数拼进另一段中文」的写法，例如
 * `${标题} loaded`、`${数量} 个活动传输`。如果只填槽位而不翻实参，
 * 结果就是一句半中半外的文字。这里对每个实参做一次反向查找，
 * 命中就用译文代替；未命中（数字、型号、专有名词）则原样保留。
 */
function renderArg(value, lang) {
  if (typeof value !== 'string' || !value) return value;
  if (!HAS_CJK.test(value)) return value;
  const hit = lookupKey(value);
  if (!hit) return value;
  const table = MESSAGES[lang] || {};
  const base = MESSAGES[DEFAULT_LANG] || {};
  let target = table[hit.key];
  if (target === undefined) target = base[hit.key];
  if (target === undefined || target.charAt(0) === '$') return value;
  if (hit.groups && hit.groups.length) {
    target = fillPattern(target, hit.groups.map((g) => renderArg(g, lang)));
  }
  return target;
}

function render(key, groups, lang) {
  const table = MESSAGES[lang] || {};
  const base = MESSAGES[DEFAULT_LANG] || {};
  let target = table[key];
  if (target === undefined) target = base[key];
  if (target === undefined) return null;
  if (groups && groups.length) {
    const slots = targetSlotCount(target);
    const args = groups.slice(0, Math.max(slots, groups.length));
    target = fillPattern(target, args.map((g) => renderArg(g, lang)));
  }
  return target;
}

function shouldSkipElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute && el.hasAttribute(SKIP_ATTR)) return true;
  if (el.isContentEditable) return true;
  const attr = el.getAttribute && el.getAttribute('translate');
  if (attr === 'no') return true;
  return false;
}

/** 从某个节点向上找，判断是否在跳过子树内。 */
function isInSkippedSubtree(node, rootEl) {
  let el = node.nodeType === 1 ? node : node.parentNode;
  while (el && el.nodeType === 1) {
    if (shouldSkipElement(el)) return true;
    if (el === rootEl) break;
    el = el.parentNode;
  }
  return false;
}

/**
 * 翻译单个文本节点。
 * @returns {boolean} 是否发生了写入
 */
function translateTextNode(node, lang, rootEl) {
  const original = node.nodeValue;
  if (typeof original !== 'string' || !original.trim()) return false;
  if (isInSkippedSubtree(node, rootEl)) return false;

  const cached = nodeKeys.get(node);
  let key = null;
  let groups = null;

  /**
   * 缓存只有在两种情形下才可信：
   *   1. `original === cached.source`  —— 内容没变（重扫时的常态）；
   *   2. `original === cached.written` —— 内容就是我们上一次写进去的译文。
   * 否则说明 React 把节点内容换成了**新的中文原文**（例如
   * 「本进程 211.7 MB」→「本进程 999.9 MB」）。此时继续用缓存里的
   * `groups` 会渲染出**旧的运行时数值**，必须重新查表取新的捕获组。
   */
  const cacheFresh = cached && (original === cached.source || (cached.written != null && original === cached.written));

  if (cacheFresh) {
    key = cached.key;
    groups = cached.groups;
  } else {
    const hit = lookupKey(original);
    if (!hit) {
      // 已经翻不动了（例如 React 写入了不认识的文本），丢掉过期缓存
      if (cached) nodeKeys.delete(node);
      return false;
    }
    key = hit.key;
    groups = hit.groups || null;
    nodeKeys.set(node, { key, groups, written: null, source: original });
  }

  const next = render(key, groups, lang);
  if (next === null) return false;

  // 保留原有的首尾空白（chunk 里常有 ` 条` / `处理済 ` 这类片段）
  const lead = original.match(/^\s*/)[0];
  const trail = original.match(/\s*$/)[0];
  const body = original.slice(lead.length, original.length - trail.length);
  const value = body === original ? next : lead + next + trail;

  if (value === original) {
    markNode(node);
    return false;
  }
  // ⚠️ 不能用「上次写过什么」来跳过：
  // React 重新渲染时会把文本节点改回中文原文，
  // 此时 original 已经变回原文、value 仍是译文，两者不等，必须重写。
  // （真正的「不需要写」已经被上面的 value === original 拦住。）
  node.nodeValue = value;
  const entry = nodeKeys.get(node);
  if (entry) entry.written = value;
  markNode(node);
  return true;
}

/**
 * 打标记。
 * 先读再写：绝大多数节点在第一次遍历时就已经带上标记了，
 * 省掉一次 `setAttribute` 就省掉一次 MutationObserver 记录（长列表页差别很大）。
 */
function markNode(node) {
  const parent = node.parentNode;
  if (!parent || parent.nodeType !== 1 || !parent.setAttribute) return;
  try {
    if (parent.getAttribute(MARK_ATTR) === '1') return;
    parent.setAttribute(MARK_ATTR, '1');
  } catch (_) {
    /* 忽略 */
  }
}

/** 翻译元素上的属性。 */
function translateAttributes(el, lang, rootEl) {
  if (!el.getAttribute || !el.setAttribute) return false;
  let changed = false;
  const cache = attrKeys.get(el) || new Map();

  for (const name of ATTRS) {
    const raw = el.getAttribute(name);
    if (!raw || !raw.trim()) continue;
    const cached = cache.get(name);
    let key = null;
    let groups = null;
    // 与文本节点同理：只有「内容未变」或「内容正是我们写进去的译文」时缓存才可信，
    // 否则 React 换了新的动态数值，必须重新查表拿新的捕获组。
    const cacheFresh = cached && (raw === cached.source || (cached.written != null && raw === cached.written));
    if (cacheFresh) {
      key = cached.key;
      groups = cached.groups;
    } else {
      const hit = lookupKey(raw);
      if (!hit) {
        if (cached) cache.delete(name);
        continue;
      }
      key = hit.key;
      groups = hit.groups || null;
      cache.set(name, { key, groups, source: raw });
    }
    const next = render(key, groups, lang);
    if (next === null) continue;
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    const body = raw.slice(lead.length, raw.length - trail.length);
    const rebuilt = body === raw ? next : lead + next + trail;
    if (rebuilt !== raw) {
      // 只按「现值 vs 译文」判断是否需要写。
      // 不能再拿 written 来跳过：React 换掉动态数值后，译文串虽然和上次不同，
      // 但如果我们误判成「写过」就会把中文原文留在 DOM 上（本文件旧版即有此 bug）。
      el.setAttribute(name, rebuilt);
      const entry = cache.get(name);
      if (entry) entry.written = rebuilt;
      changed = true;
    }
  }

  // input[type=button|submit|reset] 的显示文字
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (VALUE_INPUT_TYPES.has(type)) {
      const raw = el.getAttribute('value');
      if (raw && raw.trim()) {
        const cached = cache.get('value');
        let key = null;
        let groups = null;
        const cacheFresh = cached && (raw === cached.source || (cached.written != null && raw === cached.written));
        if (cacheFresh) {
          key = cached.key;
          groups = cached.groups;
        } else {
          const hit = lookupKey(raw);
          if (hit) {
            key = hit.key;
            groups = hit.groups || null;
            cache.set('value', { key, groups, source: raw });
          } else if (cached) {
            cache.delete('value');
          }
        }
        if (key) {
          const next = render(key, groups, lang);
          if (next !== null && next !== raw) {
            el.setAttribute('value', next);
            const entry = cache.get('value');
            if (entry) entry.written = next;
            changed = true;
          }
        }
      }
    }
  }

  if (changed) {
    try {
      if (el.getAttribute(MARK_ATTR) !== '1') el.setAttribute(MARK_ATTR, '1');
    } catch (_) {
      /* 忽略 */
    }
  }
  attrKeys.set(el, cache);
  return changed;
}

/** 递归翻译一棵子树。 */
function translateTree(root, lang, rootEl) {
  if (!root) return 0;
  let count = 0;
  const owner = rootEl || (root.nodeType === 1 ? root : null);
  if (isInSkippedSubtree(root, owner)) return 0;

  if (root.nodeType === 3) {
    return translateTextNode(root, lang, owner) ? 1 : 0;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return 0;

  if (root.nodeType === 1 && translateAttributes(root, lang, owner)) count += 1;

  const walker = document.createTreeWalker(root, SHOW_TEXT | SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        return shouldSkipElement(node) ? FILTER_REJECT : FILTER_ACCEPT;
      }
      return FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 3) {
      if (translateTextNode(node, lang, owner)) count += 1;
    } else if (node.nodeType === 1) {
      if (translateAttributes(node, lang, owner)) count += 1;
    }
    node = walker.nextNode();
  }
  return count;
}

/* ------------------------------------------------------------------ *
 * 节流调度
 * ------------------------------------------------------------------ */

const dirty = new Set();
let scheduled = false;
let running = false;
let observer = null;
let started = false;
let lastApplyLang = null;

const BUDGET_PER_FRAME = 220; // 单帧最多处理的节点数

function requestFrame(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return setTimeout(fn, 16);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestFrame(flush);
}

function flush() {
  scheduled = false;
  if (running || dirty.size === 0) return;
  running = true;
  const lang = getLang();
  let processed = 0;
  try {
    for (const node of Array.from(dirty)) {
      dirty.delete(node);
      if (!node.isConnected) continue;
      try {
        if (node.nodeType === 3) {
          translateTextNode(node, lang, null);
        } else if (node.nodeType === 1) {
          translateTree(node, lang, null);
        }
      } catch (err) {
        warn('translate failed for node', err);
      }
      processed += 1;
      if (processed >= BUDGET_PER_FRAME && dirty.size > 0) {
        schedule();
        break;
      }
    }
    if (document.title) {
      const hit = lookupKey(document.title);
      if (hit) {
        const next = render(hit.key, hit.groups, lang);
        if (next && next !== document.title) document.title = next;
      }
    }
  } finally {
    running = false;
  }
}

function warn(...args) {
  if (typeof console !== 'undefined' && console.warn) console.warn('[i18n-dom]', ...args);
}

/** 判断一次 mutation 是否由我们自己触发（我们写入后 observer 会再收到一次）。 */
function isOwnMutation(mutation) {
  const target = mutation.target;
  if (!target) return false;
  if (mutation.type === 'attributes' && mutation.attributeName === MARK_ATTR) return true;
  return false;
}

function onMutations(mutations) {
  let touched = false;
  for (const m of mutations) {
    if (isOwnMutation(m)) continue;
    if (m.type === 'childList') {
      for (const n of m.addedNodes) {
        if (n.nodeType === 3 || n.nodeType === 1) {
          dirty.add(n);
          touched = true;
        }
      }
      if (m.removedNodes.length) {
        // 目标节点自身被替换时，父节点需要重新扫描
        if (m.target && m.target.nodeType === 1) {
          dirty.add(m.target);
          touched = true;
        }
      }
    } else if (m.type === 'characterData') {
      dirty.add(m.target);
      touched = true;
    } else if (m.type === 'attributes') {
      dirty.add(m.target);
      touched = true;
    }
  }
  if (touched) schedule();
}

/* ------------------------------------------------------------------ *
 * 对外 API
 * ------------------------------------------------------------------ */

/**
 * 立即翻译整份文档（或指定子树）。
 * @param {ParentNode} [root]
 * @returns {number} 处理计数
 */
export function translateNow(root) {
  if (typeof document === 'undefined') return 0;
  const target = root || document.body || document.documentElement;
  if (!target) return 0;
  const lang = getLang();
  const count = translateTree(target, lang, null);
  if (!root && document.title) {
    const hit = lookupKey(document.title);
    if (hit) {
      const next = render(hit.key, hit.groups, lang);
      if (next && next !== document.title) document.title = next;
    }
  }
  return count;
}

/** 启动观察器（幂等）。 */
export function startDomI18n(options) {
  if (typeof document === 'undefined') return () => {};
  const opts = options || {};
  if (started) {
    translateNow();
    return stopDomI18n;
  }
  started = true;

  const apply = () => {
    const lang = getLang();
    lastApplyLang = lang;
    nodeKeysCleanupHint();
    translateNow();
    // 只在变化时写：写属性本身会触发我们的观察器，无条件写会自激
    const html = document.documentElement;
    if (html) {
      if (html.getAttribute('data-hz-lang') !== lang) html.setAttribute('data-hz-lang', lang);
      if (html.getAttribute('lang') !== lang) html.setAttribute('lang', lang);
    }
    if (opts.onApplied) {
      try {
        opts.onApplied(lang);
      } catch (err) {
        warn('onApplied failed', err);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }

  const target = document.documentElement;
  observer = new MutationObserver(onMutations);
  observer.observe(target, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS, 'value'],
  });

  onLangChange(() => {
    // 语言变了：全量重扫一次（缓存里存着 key，所以能正确切回中文）
    apply();
  });

  if (typeof window !== 'undefined') {
    window.addEventListener(LANG_EVENT, () => schedule());
  }

  return stopDomI18n;
}

/** 占位：WeakMap 不需要手动清理，保留函数以便将来接入清理逻辑。 */
function nodeKeysCleanupHint() {
  /* no-op */
}

/** 停止观察器。 */
export function stopDomI18n() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  dirty.clear();
  scheduled = false;
  started = false;
  return true;
}

/** 当前是否在观察。 */
export function isDomI18nRunning() {
  return started;
}

/** 上一次全量应用时的语言。 */
export function lastAppliedLang() {
  return lastApplyLang;
}

export default {
  MARK_ATTR,
  SKIP_ATTR,
  ATTRS,
  buildReverseIndex,
  lookupKey,
  indexStats,
  ambiguousSources,
  translateNow,
  startDomI18n,
  stopDomI18n,
  isDomI18nRunning,
  lastAppliedLang,
  normalizeKey,
};
