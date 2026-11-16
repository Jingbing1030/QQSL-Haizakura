/**
 * hz-app.js —— 真正的入口引导（浏览器加载这一个）。
 *
 * 分工：
 *   hz-i18n-boot.js  语言内核 + DOM 翻译 + 设置页语言选择器（子代理写的，已充分测试）
 *   hz-pages.js      路由 → 页面注册表（沿用现有样式令牌）
 *   hz-hotload.js    组件热加载
 *   本文件            把三者串起来 + 路由接管
 *
 * 用法：index.html 末尾加
 *   <script type="module" src="/assets/hz-app.js"></script>
 */
import { boot as bootI18n } from './hz-i18n-boot.js';
import { getLang, onLangChange } from './hz-i18n-core.js';
import { translateNow } from './hz-i18n-dom.js';
import { getPage, listPages } from './hz-pages.js';
import { register as hlRegister, unregister as hlUnregister } from './hz-hotload.js';

/** 由新插件页接管的路径。其余路径仍走原 React 页面。 */
const OWNED = ['/', '/processes', '/logs', '/debug'];

/** 可热加载的页面；改这些文件后无需刷新。 */
const HOT = {
  '/': './overview-plugin.js',
  '/processes': './processes-plugin.js',
  '/logs': './logs-plugin.js',
  '/debug': './debug-plugin.js',
};

let currentRoute = null;

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

/**
 * 应用当前路由。
 *
 * 接管时隐藏 #root（原 React 树）、显示我们的宿主；
 * 交还时反向操作。这样两套界面不会重叠。
 */
async function applyRoute() {
  const p = pathNow();
  if (p === currentRoute) return;

  const host = ensureHost();
  const root = document.getElementById('root');
  const owned = OWNED.includes(p);

  // 离开上一个自有路由时卸载它
  if (currentRoute && OWNED.includes(currentRoute) && currentRoute !== p) {
    hlUnregister('page:' + currentRoute);
  }
  currentRoute = p;

  if (!owned) {
    host.style.display = 'none';
    if (root) root.style.display = '';
    return;
  }

  if (root) root.style.display = 'none';
  host.style.display = '';
  host.textContent = '';

  let page;
  try {
    page = await getPage(p);
  } catch (err) {
    page = null;
    console.error('[haizakura] 页面加载失败', err);
  }

  if (!page) {
    const d = document.createElement('div');
    d.className = 'hz-state hz-state--error';
    d.textContent = `没有为 ${p} 注册页面`;
    host.appendChild(d);
    return;
  }

  hlRegister('page:' + p, host, page, {});
}

/** 挂路由监听。 */
function watchRoute() {
  window.addEventListener('popstate', applyRoute);
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) {
      const r = orig.apply(this, args);
      // 让 React 先把 DOM 更新完，再决定是否接管
      setTimeout(applyRoute, 0);
      return r;
    };
  }
}

/** 主引导。 */
async function main() {
  // ① 语言：内核 + DOM 翻译 + 设置页选择器
  try {
    bootI18n();
  } catch (err) {
    console.warn('[haizakura] i18n 引导失败', err);
  }

  // ② 语言切换后重译并重挂自有路由（让新语言的文案生效）
  onLangChange(() => {
    translateNow();
    const p = currentRoute;
    currentRoute = null;          // 强制重挂
    if (p && OWNED.includes(p)) applyRoute();
  });

  // ③ 路由接管
  watchRoute();
  await applyRoute();

  // ④ 热加载（显式开启才启用）
  const wantHot = new URLSearchParams(location.search).has('hot') ||
                  localStorage.getItem('haizakura_hotload') === '1';
  if (wantHot) {
    const [{ watchManifest }] = await Promise.all([import('./hz-hotload.js')]);
    watchManifest();
    console.log('[haizakura] 组件热加载已启用（打开 ?hot 或设 localStorage.haizakura_hotload=1）');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

// 调试用
window.__hz = { applyRoute, listPages, getLang };
