/**
 * hz-i18n-boot.js — WebUI 多语言引导脚本
 *
 * 这是**唯一**需要在 index.html 里引用的文件：
 *
 *   <script type="module" src="/assets/hz-i18n-boot.js"></script>
 *
 * 它自己再去 import 其余 4 个模块（core / messages / dom / settings-language），
 * 所以 index.html 只需要一行。
 *
 * 引导顺序：
 *   1. 尽早读取 localStorage 里的语言偏好，并把 <html lang> 与 data-hz-lang 写对
 *      （此时 DOM 还没解析完，先不做翻译，避免改动解析中的文档）；
 *   2. DOM ready 后启动 DOM 运行时翻译器（全量扫一遍 + 挂 MutationObserver）；
 *   3. 启动设置页语言选择器的定位与补插逻辑；
 *   4. 监听路由/视图切换，重扫新增内容。
 *
 * 设计原则：**任何一步失败都不能把页面搞白**。所有步骤都包在 try/catch 里，
 * 出错只在控制台警告，宿主 bundle 照常运行。
 */

import { getLang, setLang, onLangChange, LANGS } from './hz-i18n-core.js';
import { startDomI18n, translateNow } from './hz-i18n-dom.js';
import { startSettingsLanguage } from './hz-settings-language.js';

/** 引导完成标记，避免被重复执行。 */
const BOOT_FLAG = '__HZ_I18N_BOOTED__';
const BOOT_ATTR = 'data-hz-i18n-booted';

function warn(...args) {
  if (typeof console !== 'undefined' && console.warn) console.warn('[hz-i18n]', ...args);
}

/**
 * 只在值真的变化时才写属性。
 *
 * 这不是微优化：我们的 MutationObserver 监听的是属性变化，
 * 而无条件 `setAttribute` 会「写属性 → 触发观察 → 再写属性」形成自激循环
 * （微任务队列永远非空，页面的定时器与渲染都拿不到执行机会，表现为卡死）。
 */
function setAttrIfChanged(el, name, value) {
  if (!el) return false;
  if (el.getAttribute(name) === value) return false;
  el.setAttribute(name, value);
  return true;
}

/** 第 1 步：把语言写到 <html> 上，让 CSS 可以按语言做微调。 */
function applyHtmlLang() {
  try {
    const lang = getLang();
    const html = document.documentElement;
    if (!html) return;
    setAttrIfChanged(html, 'lang', lang);
    setAttrIfChanged(html, 'data-hz-lang', lang);
    setAttrIfChanged(html, BOOT_ATTR, '1');
    // 日文 / 伪中文下加一个排印提示类，方便字体回退
    const cls = html.classList;
    if (cls) {
      const wantJa = lang === 'ja';
      const wantZh = lang === 'zh-cn' || lang === 'zh-tw' || lang === 'zh-pseudo';
      if (cls.contains('hz-lang-ja') !== wantJa) cls.toggle('hz-lang-ja', wantJa);
      if (cls.contains('hz-lang-zh') !== wantZh) cls.toggle('hz-lang-zh', wantZh);
    }
  } catch (err) {
    warn('failed to apply <html lang>', err);
  }
}

/** 第 2 步 + 第 3 步。 */
function start() {
  try {
    startDomI18n({
      onApplied(lang) {
        try {
          setAttrIfChanged(document.documentElement, 'data-hz-lang', lang);
        } catch (_) {
          /* 忽略 */
        }
      },
    });
  } catch (err) {
    warn('failed to start DOM translator', err);
  }

  try {
    startSettingsLanguage();
  } catch (err) {
    warn('failed to start settings language picker', err);
  }
}

/**
 * 第 4 步：SPA 换页后 React 会重建 DOM，这里轻量地补扫一次。
 * 用 rAF 合并高频变更，不做全量轮询。
 */
function watchRouteChanges() {
  if (typeof window === 'undefined') return;
  let pending = false;
  const rescan = () => {
    pending = false;
    try {
      translateNow();
    } catch (err) {
      warn('rescan failed', err);
    }
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(rescan);
    else setTimeout(rescan, 50);
  };
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  // pushState / replaceState 不派发事件，这里包一层
  try {
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      if (typeof original !== 'function') continue;
      history[method] = function patched(...args) {
        const result = original.apply(this, args);
        schedule();
        return result;
      };
    }
  } catch (err) {
    warn('failed to patch history', err);
  }
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

function boot() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window[BOOT_FLAG]) return;
  window[BOOT_FLAG] = true;

  applyHtmlLang();

  const ready = () => {
    start();
    watchRouteChanges();
    try {
      onLangChange(() => applyHtmlLang());
    } catch (err) {
      warn('failed to bind language change', err);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }
}

boot();

/* ------------------------------------------------------------------ *
 * 对外暴露：方便在 DevTools 里手动切语言与排查
 * ------------------------------------------------------------------ */

if (typeof window !== 'undefined') {
  window.HaizakuraI18n = {
    LANGS,
    getLang,
    setLang,
    /** 手动重扫整页（例如怀疑有漏翻时）。 */
    rescan: () => translateNow(),
    /** 控制台里 `HaizakuraI18n.setLang('zh-pseudo')` 即可预览伪中国语。 */
  };
}

export { boot, applyHtmlLang };
export default boot;
