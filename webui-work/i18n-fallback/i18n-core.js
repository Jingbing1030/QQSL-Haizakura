/**
 * Haizakura i18n 内核（兜底实现）
 * 5 语言：日本語 / 中國語（伪中国语）/ 简体中文 / 繁體中文 / English
 * 无依赖，纯 ES module
 */
export const LANGS = [
  { code: 'ja', label: '日本語' },
  { code: 'zh-pseudo', label: '中國語' },
  { code: 'zh-cn', label: '简体中文' },
  { code: 'zh-tw', label: '繁體中文' },
  { code: 'en', label: 'English' },
];

const STORAGE_KEY = 'haizakura_lang';
const DEFAULT_LANG = 'zh-cn';
const VALID = new Set(LANGS.map(l => l.code));

let current = DEFAULT_LANG;
let messages = {};
const listeners = new Set();

export function isValidLang(code) { return VALID.has(code); }

export function getLang() { return current; }

export function initLang(getMessages) {
  messages = getMessages || {};
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VALID.has(saved)) current = saved;
  } catch { /* localStorage 不可用时用默认 */ }
  return current;
}

export function setLang(code) {
  if (!VALID.has(code) || code === current) return current;
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  document.documentElement.setAttribute('lang', code === 'zh-pseudo' ? 'zh-Hant' : code);
  try {
    window.dispatchEvent(new CustomEvent('haizakura:langchange', { detail: { lang: code } }));
  } catch { /* ignore */ }
  listeners.forEach(cb => { try { cb(code); } catch { /* ignore */ } });
  return current;
}

export function onLangChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function t(key, vars) {
  const table = messages[current] || {};
  let s = table[key];
  if (s === undefined) s = (messages[DEFAULT_LANG] || {})[key];
  if (s === undefined) return key;
  if (vars) {
    s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }
  return s;
}
