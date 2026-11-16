/**
 * hz-boot.js —— 集成引导。
 *
 * 职责：
 *   ① 恢复语言偏好，启动 DOM 翻译
 *   ② 在「设置 / 外观」挂载语言选择器
 *   ③ 拦截路由，把 /、/processes、/logs、/debug、/settings、/config
 *      交给新插件页渲染
 *   ④ 开发模式下启用组件热加载
 *
 * 不侵入原 React 树（那是编译产物，改不动）。
 */
import * as i18n from './hz-i18n-core.js';
import { MESSAGES } from './hz-i18n-messages.js';
import { startDomTranslator, retranslateAll } from './hz-i18n-dom.js';
import { mountRoute, unmountRoute } from './hz-pages.js';
import { watchManifest } from './hz-hotload.js';

const OWNED = ['/', '/processes', '/logs', '/debug', '/settings', '/config'];

let currentPath = null;
let lastRouteKey = null;

const pathNow = () => location.pathname.replace(/\/+$/, '') || '/';

/** 路由宿主：懒建，挂在 #root 之后。 */
function ensureHost() {
  let h = document.getElementById('hz-route-host');
  if (h?.isConnected) return h;
  h = document.createElement('div');
  h.id = 'hz-route-host';
  h.setAttribute('data-hz-route-host', '1');
  document.body.appendChild(h);
  return h;
}

/** 接管/交还页面。 */
async function applyRoute() {
  const p = pathNow();
  if (p === lastRouteKey) return;

  const host = ensureHost();
  const root = document.getElementById('root');

  if (!OWNED.includes(p)) {
    // 交还给原 React 页面
    host.style.display = 'none';
    if (root) root.style.display = '';
    if (lastRouteKey && OWNED.includes(lastRouteKey)) {
      unmountRoute(lastRouteKey);
    }
    lastRouteKey = p;
    return;
  }

  // 接管
  if (root) root.style.display = 'none';
  host.style.display = '';

  if (lastRouteKey && lastRouteKey !== p && OWNED.includes(lastRouteKey)) {
    unmountRoute(lastRouteKey);
  }
  host.textContent = '';
  await mountRoute(p, host, { t: i18n.t, lang: i18n.getLang });
  lastRouteKey = p;
}

/** 语言选择器。 */
async function mountLangPicker() {
  try {
    const mod = await import('./hz-settings-language.js');
    mod?.mountLanguagePicker?.();
  } catch (err) {
    console.warn('[haizakura] 语言选择器未加载:', err?.message);
  }
}

/** 引导。 */
async function boot() {
  i18n.initLang(MESSAGES);
  const lang = i18n.getLang();
  document.documentElement.setAttribute('lang', lang === 'zh-pseudo' ? 'zh-Hant' : lang);

  i18n.onLangChange(() => {
    retranslateAll();
    lastRouteKey = null;          // 强制重挂，让新语言生效
    applyRoute();
    mountLangPicker();
  });

  startDomTranslator(i18n.t, i18n.getLang);

  // 路由监听
  window.addEventListener('popstate', () => { lastRouteKey = null; applyRoute(); });
  const origPush = history.pushState;
  history.pushState = function (...args) {
    const r = origPush.apply(this, args);
    setTimeout(() => { lastRouteKey = null; applyRoute(); }, 0);
    return r;
  };
  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args);
    setTimeout(() => { lastRouteKey = null; applyRoute(); }, 0);
    return r;
  };

  await applyRoute();
  mountLangPicker();

  // React 异步渲染，多试几次挂语言选择器
  let tries = 0;
  const timer = setInterval(() => {
    mountLangPicker();
    if (++tries >= 12) clearInterval(timer);
  }, 800);

  // 热加载：只有显式开启才启动
  if (new URLSearchParams(location.search).has('hot') ||
      localStorage.getItem('haizakura_hotload') === '1') {
    watchManifest();
    console.log('[haizakura] 组件热加载已启用');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
