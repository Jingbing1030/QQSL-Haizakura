/**
 * i18n-core.js — Haizakura WebUI 多语言内核
 *
 * 纯 ES module，零外部依赖，可直接被 `<script type="module">` 加载，
 * 也可在 Node 中导入做单测（所有浏览器 API 均已做存在性判断）。
 *
 * 导出：
 *   LANGS          语言清单（数组，每项 { code, label, nativeName, english, dir }）
 *   DEFAULT_LANG   默认语言码（'zh-cn'）
 *   STORAGE_KEY    localStorage 键名（'haizakura_lang'）
 *   LANG_EVENT     window 事件名（'haizakura:langchange'）
 *   getLang()      读取当前语言码
 *   setLang(code)  切换语言（持久化 + 派发 haizakura:langchange）
 *   t(key, vars?)  取文案，支持 {name} 变量插值
 *   onLangChange(cb)  订阅语言变化，返回取消订阅函数
 *   has(key) / getMessages(lang?) / resolveLang(code) / interpolate(s, vars)
 */

import { MESSAGES } from './hz-i18n-messages.js';

/** 默认语言：简体中文（chunk 内写死的原文语言）。 */
export const DEFAULT_LANG = 'zh-cn';

/** 语言偏好持久化键名。 */
export const STORAGE_KEY = 'haizakura_lang';

/** 语言变化时在 window 上派发的事件名（detail = { lang, previous }）。 */
export const LANG_EVENT = 'haizakura:langchange';

/**
 * 语言清单。顺序即设置页语言选择器的展示顺序。
 * label 为该语言在本语言中的自称（endonym），单独提供 english 便于日志与调试。
 */
export const LANGS = Object.freeze([
  Object.freeze({ code: 'ja', label: '日本語', nativeName: '日本語', english: 'Japanese', dir: 'ltr' }),
  Object.freeze({ code: 'zh-pseudo', label: '中國語', nativeName: '中國語', english: 'Pseudo-Chinese', dir: 'ltr' }),
  Object.freeze({ code: 'zh-cn', label: '简体中文', nativeName: '简体中文', english: 'Simplified Chinese', dir: 'ltr' }),
  Object.freeze({ code: 'zh-tw', label: '繁體中文', nativeName: '繁體中文', english: 'Traditional Chinese (Taiwan)', dir: 'ltr' }),
  Object.freeze({ code: 'en', label: 'English', nativeName: 'English', english: 'English', dir: 'ltr' }),
]);

const LANG_CODES = LANGS.map((l) => l.code);
const LANG_SET = new Set(LANG_CODES);

/* ------------------------------------------------------------------ *
 * 浏览器环境探测（在 Node 下全部安全降级）
 * ------------------------------------------------------------------ */

const HAS_WINDOW = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
const HAS_DOCUMENT = typeof document !== 'undefined';
const HAS_STORAGE = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (_) {
    // Safari 隐私模式下访问 localStorage 会直接抛错
    return false;
  }
})();

/** 读取 localStorage，失败一律当作「没有」。 */
function storageGet(key) {
  if (!HAS_STORAGE) return null;
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

/** 写入 localStorage，失败静默（配额 / 隐私模式）。 */
function storageSet(key, value) {
  if (!HAS_STORAGE) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 语言解析
 * ------------------------------------------------------------------ */

/**
 * 把任意输入规范化成受支持的语言码；无法识别时回退 DEFAULT_LANG。
 * 兼容大小写与下划线写法（zh_CN / ZH-CN / zh-cn 均可）。
 * @param {unknown} code
 * @returns {string}
 */
export function resolveLang(code) {
  if (typeof code !== 'string') return DEFAULT_LANG;
  const raw = code.trim();
  if (!raw) return DEFAULT_LANG;
  if (LANG_SET.has(raw)) return raw;
  const lower = raw.toLowerCase().replace(/_/g, '-');
  if (LANG_SET.has(lower)) return lower;
  // zh-Hans / zh-SG … 归到简体；zh-Hant / zh-HK / zh-TW 归到繁体
  if (lower === 'zh' || lower === 'zh-hans' || lower.startsWith('zh-cn') || lower.startsWith('zh-sg')) return 'zh-cn';
  if (lower.startsWith('zh-hant') || lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-mo')) return 'zh-tw';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';
  // 语言清单里第一条以该前缀开头的语言（例如 'zh-pseudo'）
  const prefixed = LANG_CODES.find((c) => lower.startsWith(c));
  return prefixed || DEFAULT_LANG;
}

let currentLang = null;

/**
 * 当前语言码。首次调用时从 localStorage 读取；无法识别或未设置则用默认语言。
 * @returns {string}
 */
export function getLang() {
  if (currentLang === null) {
    currentLang = resolveLang(storageGet(STORAGE_KEY));
  }
  return currentLang;
}

/* ------------------------------------------------------------------ *
 * 语言变化订阅
 * ------------------------------------------------------------------ */

/** @type {Set<(lang: string, previous: string) => void>} */
const listeners = new Set();
let crossTabBound = false;

function emit(lang, previous) {
  for (const cb of Array.from(listeners)) {
    try {
      cb(lang, previous);
    } catch (err) {
      // 单个订阅者报错不能影响其它订阅者与语言状态
      if (typeof console !== 'undefined' && console.error) {
        console.error('[i18n] onLangChange listener failed:', err);
      }
    }
  }
}

function bindCrossTab() {
  if (crossTabBound || !HAS_WINDOW) return;
  crossTabBound = true;
  // 其它标签页改了语言，本页同步跟随（localStorage 的 storage 事件只在别的文档触发）
  window.addEventListener('storage', (event) => {
    if (!event || event.key !== STORAGE_KEY) return;
    applyLang(resolveLang(event.newValue), { persist: false, dispatch: true });
  });
}

/**
 * 订阅语言变化。
 * @param {(lang: string, previous: string) => void} cb
 * @returns {() => void} 取消订阅函数
 */
export function onLangChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  bindCrossTab();
  return () => listeners.delete(cb);
}

/* ------------------------------------------------------------------ *
 * 切换语言
 * ------------------------------------------------------------------ */

function syncDocumentLang(lang) {
  if (!HAS_DOCUMENT || !document.documentElement) return;
  const entry = LANGS.find((l) => l.code === lang);
  document.documentElement.setAttribute('lang', lang);
  if (entry) document.documentElement.setAttribute('dir', entry.dir);
}

function applyLang(next, options) {
  const opts = options || {};
  const previous = getLang();
  currentLang = next;
  if (opts.persist !== false) {
    storageSet(STORAGE_KEY, next);
    if (!HAS_STORAGE && HAS_WINDOW) {
      // 无法持久化（隐私模式）时给出一次明确提示，避免用户以为设置没生效
      try {
        window.dispatchEvent(
          new CustomEvent('haizakura:langpersistfailed', { detail: { lang: next, key: STORAGE_KEY } }),
        );
      } catch (_) {
        /* 忽略 */
      }
    }
  }
  syncDocumentLang(next);
  if (opts.dispatch !== false && HAS_WINDOW) {
    try {
      window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: { lang: next, previous } }));
    } catch (_) {
      // 极老的浏览器不支持 CustomEvent 构造器时退化为普通事件
      try {
        const evt = document.createEvent('CustomEvent');
        evt.initCustomEvent(LANG_EVENT, false, false, { lang: next, previous });
        window.dispatchEvent(evt);
      } catch (__) {
        /* 忽略 */
      }
    }
  }
  if (next !== previous || opts.force) emit(next, previous);
  return next;
}

/**
 * 设置语言。无法识别的值回退到默认语言。
 * 无论语言是否真的变化都会派发 haizakura:langchange（detail = { lang, previous }）。
 * @param {unknown} code
 * @returns {string} 实际生效的语言码
 */
export function setLang(code) {
  return applyLang(resolveLang(code));
}

/**
 * 恢复默认语言（清除持久化偏好）。
 * @returns {string}
 */
export function resetLang() {
  if (HAS_STORAGE) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* 忽略 */
    }
  }
  return applyLang(DEFAULT_LANG);
}

/* ------------------------------------------------------------------ *
 * 文案查询
 * ------------------------------------------------------------------ */

/** 取某个语言的文案表；未知语言回退 zh-cn。 */
export function getMessages(lang) {
  const code = lang === undefined ? getLang() : resolveLang(lang);
  return MESSAGES[code] || MESSAGES[DEFAULT_LANG] || {};
}

/** key 是否存在于基准（zh-cn）文案表。 */
export function has(key) {
  const base = MESSAGES[DEFAULT_LANG] || {};
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(base, key);
}

/**
 * 变量插值：把 `{name}` 替换为 vars.name。
 * 缺失的变量保持原样（便于发现漏配），`${...}` 形式的模板串不会被当作变量。
 * @param {string} template
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function interpolate(template, vars) {
  if (typeof template !== 'string' || !vars) return template;
  return template.replace(/\{([A-Za-z0-9_$.\-]+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    const value = vars[name];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/**
 * 取文案。
 * 查找顺序：当前语言 → zh-cn 基准 → 原样返回 key。
 * @param {string} key
 * @param {Record<string, unknown>} [vars] 形如 { name: 'World' }，替换文案里的 {name}
 * @returns {string}
 */
export function t(key, vars) {
  if (key === null || key === undefined) return '';
  const lang = getLang();
  const table = MESSAGES[lang] || {};
  let value = table[key];
  if (value === undefined && lang !== DEFAULT_LANG) {
    const base = MESSAGES[DEFAULT_LANG] || {};
    value = base[key];
  }
  if (value === undefined) value = String(key);
  return interpolate(value, vars);
}

/** t() 的语义别名，方便 `const { _ } = ...` 用法。 */
export const translate = t;

/* ------------------------------------------------------------------ *
 * 默认导出
 * ------------------------------------------------------------------ */

const i18n = {
  LANGS,
  DEFAULT_LANG,
  STORAGE_KEY,
  LANG_EVENT,
  getLang,
  setLang,
  resetLang,
  resolveLang,
  onLangChange,
  getMessages,
  has,
  interpolate,
  t,
  translate,
};

export default i18n;
