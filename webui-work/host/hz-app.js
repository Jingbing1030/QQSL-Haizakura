/**
 * hz-app.js —— 浏览器入口。
 *
 * 设计要点（踩过的坑都记在这里）：
 *
 * ⚠️ 不要隐藏 #root！
 *   原界面的侧栏（aside）与顶栏（header）都在 #root 里，那是用户唯一的
 *   导航入口。第一版把 #root 整个 display:none，结果页面能显示但无法
 *   切页 —— 导航被自己扣掉了。
 *
 *   正确做法：**只替换 <main> 的内容**，保留 aside / header 不动。
 *   这样导航、用户菜单、主题切换都还在，只有内容区换成新组件。
 *
 * ⚠️ 渲染失败不能白屏：先在离屏容器里挂载成功，再替换内容。
 */
import { boot as bootI18n } from './hz-i18n-boot.js';
import { getLang, onLangChange } from './hz-i18n-core.js';
import { translateNow } from './hz-i18n-dom.js';
import { mountRoute, unmountRoute } from './hz-pages.js';

/** 由插件页接管内容区的路径。 */
const OWNED = ['/', '/processes', '/logs', '/debug', '/settings', '/config'];

const pathNow = () => location.pathname.replace(/\/+$/, '') || '/';

let currentRoute = null;      // 当前接管的路径
let offscreen = null;         // 离屏试挂载容器

/** 找内容区容器：原界面的 <main> 里那个 overflow-hidden 的 div。 */
function findContentHost() {
  const main = document.querySelector('main');
  if (!main) return null;
  // main 里第一个有实际尺寸的子容器就是内容区
  for (const child of main.children) {
    const r = child.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return child;
  }
  return main.children[0] || main;
}

/** 离屏容器：试挂载用，成功后才往页面上放。 */
function ensureOffscreen() {
  if (offscreen && offscreen.isConnected) return offscreen;
  offscreen = document.createElement('div');
  offscreen.id = 'hz-offscreen';
  offscreen.style.cssText =
    'position:absolute;left:-99999px;top:0;width:1200px;height:800px;overflow:hidden';
  document.body.appendChild(offscreen);
  return offscreen;
}

/** 顶部错误条（只在自己渲染失败时出现，不影响原界面）。 */
function showBanner(text, onRetry) {
  let bar = document.getElementById('hz-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'hz-banner';
    bar.style.cssText =
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;' +
      'padding:10px 16px;font:13px/1.5 system-ui,sans-serif;background:#7f1d1d;color:#fff;' +
      'border-radius:10px;display:flex;gap:12px;align-items:center;box-shadow:0 6px 20px rgba(0,0,0,.3)';
    document.body.appendChild(bar);
  }
  bar.textContent = '';
  const span = document.createElement('span');
  span.textContent = text;
  bar.appendChild(span);
  if (onRetry) {
    const btn = document.createElement('button');
    btn.textContent = '重试';
    btn.style.cssText =
      'padding:3px 10px;border:1px solid rgba(255,255,255,.5);border-radius:6px;' +
      'background:transparent;color:#fff;cursor:pointer;font:inherit';
    btn.onclick = onRetry;
    bar.appendChild(btn);
  }
}

function hideBanner() {
  document.getElementById('hz-banner')?.remove();
}

/**
 * 应用路由。
 *
 * 只在 OWNED 路径且挂载成功时替换内容区；其余情况一律交还原界面。
 */
async function applyRoute() {
  const p = pathNow();
  if (p === currentRoute) return;

  // 用户主动关掉过新界面
  let optedOut = false;
  try { optedOut = sessionStorage.getItem('hz-plugin-pages-off') === '1'; } catch { /* noop */ }

  const host = findContentHost();

  // 离开上一个自有路由：把它挂的那份卸掉，交还原内容
  if (currentRoute && OWNED.includes(currentRoute)) {
    unmountRoute(currentRoute);
  }
  currentRoute = p;

  if (!OWNED.includes(p) || optedOut || !host) {
    // 清掉我们可能留下的容器
    document.getElementById('hz-route-host')?.remove();
    if (offscreen) { offscreen.textContent = ''; }
    if (optedOut && OWNED.includes(p)) hideBanner();
    return;
  }

  // ── 先在离屏容器里挂载：成功才动页面 ──
  const stage = ensureOffscreen();
  stage.textContent = '';

  try {
    await mountRoute(p, stage, {});
    if (stage.childElementCount === 0) throw new Error('挂载后没有内容');

    // 成功：把内容区替换成我们的宿主
    // 记下原内容，便于交还时恢复（SPA 会自己重渲染，通常不需要，但留着更稳）
    host.style.display = 'none';

    let mine = document.getElementById('hz-route-host');
    if (!mine) {
      mine = document.createElement('div');
      mine.id = 'hz-route-host';
      mine.setAttribute('data-hz-route-host', '1');
      host.parentNode.insertBefore(mine, host.nextSibling);
    }
    mine.style.display = '';
    // 把离屏里挂好的节点搬过来（保持同一个 DOM，不重挂）
    mine.textContent = '';
    while (stage.firstChild) mine.appendChild(stage.firstChild);

    hideBanner();
  } catch (err) {
    // 失败：原内容区保持原样，只在底部提示
    if (offscreen) offscreen.textContent = '';
    document.getElementById('hz-route-host')?.remove();
    host.style.display = '';
    showBanner('新版界面加载失败，已保留原界面 · ' + (err?.message ?? String(err)), () => {
      hideBanner();
      currentRoute = null;
      applyRoute();
    });
    console.error('[haizakura] 页面挂载失败', err);
  }
}

/** 让出控制权，永久使用原界面。 */
function fallbackToReact() {
  try { sessionStorage.setItem('hz-plugin-pages-off', '1'); } catch { /* noop */ }
  document.getElementById('hz-route-host')?.remove();
  const host = findContentHost();
  if (host) host.style.display = '';
  hideBanner();
  currentRoute = null;
}

function watchRoute() {
  window.addEventListener('popstate', () => { currentRoute = null; applyRoute(); });
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) {
      const r = orig.apply(this, args);
      setTimeout(() => { currentRoute = null; applyRoute(); }, 30);
      return r;
    };
  }
}

async function main() {
  try { bootI18n(); } catch (err) { console.warn('[haizakura] i18n 引导失败', err); }

  onLangChange(() => {
    translateNow();
    if (currentRoute && OWNED.includes(currentRoute)) {
      currentRoute = null;
      applyRoute();
    }
  });

  watchRoute();
  await applyRoute();

  // React 首屏渲染比我们晚，稍后再试一次
  let tries = 0;
  const t = setInterval(() => {
    if (document.querySelector('main')) { currentRoute = null; applyRoute(); clearInterval(t); }
    if (++tries >= 10) clearInterval(t);
  }, 600);

  const wantHot =
    new URLSearchParams(location.search).has('hot') ||
    localStorage.getItem('haizakura_hotload') === '1';
  if (wantHot) {
    const { watchManifest } = await import('./hz-hotload.js');
    watchManifest();
    console.log('[haizakura] 组件热加载已启用');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

window.__hz = {
  applyRoute, fallbackToReact, getLang,
  reenable() {
    try { sessionStorage.removeItem('hz-plugin-pages-off'); } catch { /* noop */ }
    currentRoute = null;
    applyRoute();
  },
};