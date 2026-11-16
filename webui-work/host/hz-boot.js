/**
 * hz-boot.js —— 多语言与插件化页面的集成宿主。
 *
 * 设计：不侵入原 React 树（那是编译后的 chunk，改不动）。
 * 做法是：
 *   ① 加载 i18n 内核，恢复用户语言偏好
 *   ② 启动 DOM 运行时翻译器，把界面中文换成目标语言
 *   ③ 在「设置 / 外观」下挂载语言选择器
 *   ④ 监听路由变化，把 /、/processes、/logs、/debug 交给新插件页渲染
 *
 * 原 SPA 仍是主导航；我们只在它渲染完成后叠加/接管。
 */
import * as i18n from './hz-i18n-core.js';
import { MESSAGES } from './hz-i18n-messages.js';
import { startDomTranslator, retranslateAll } from './hz-i18n-dom.js';

const ROUTES_OWNED = ['/', '/processes', '/logs', '/debug'];

let pluginHost = null;

/** 读取当前路径（去掉 base）。 */
function currentPath() {
  return location.pathname.replace(/\/+$/, '') || '/';
}

/** 插件页宿主容器：懒建，固定挂在 #root 之后。 */
function ensureHost() {
  if (pluginHost && pluginHost.isConnected) return pluginHost;
  pluginHost = document.createElement('div');
  pluginHost.id = 'hz-plugin-host';
  pluginHost.setAttribute('data-hz-owned', '1');
  document.body.appendChild(pluginHost);
  return pluginHost;
}

/** 显示/隐藏插件宿主。 */
function setHostActive(active) {
  const h = ensureHost();
  h.style.display = active ? '' : 'none';
  // 接管时把 React 根的内容隐藏，避免两套界面叠在一起
  const root = document.getElementById('root');
  if (root) root.style.display = active ? 'none' : '';
}

/**
 * 挂载某个路由的插件页。
 * 插件由 hz-pages.js 注册表提供（动态 import，避免一次性加载全部）。
 */
async function mountRoute(path) {
  const host = ensureHost();
  host.textContent = '';
  try {
    const pages = await import('./hz-pages.js');
    const page = pages.getPage(path);
    if (!page) { setHostActive(false); return; }
    setHostActive(true);
    await page.mount(host, {
      t: i18n.t,
      lang: i18n.getLang,
      onLangChange: i18n.onLangChange,
    });
  } catch (err) {
    setHostActive(true);
    host.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'padding:24px;font:14px/1.6 system-ui;color:#c33';
    box.textContent = '页面加载失败：' + (err && err.message ? err.message : String(err));
    host.appendChild(box);
  }
}

/** 路由变化处理。 */
function onRouteChange() {
  const p = currentPath();
  if (ROUTES_OWNED.includes(p)) {
    mountRoute(p);
  } else {
    setHostActive(false);
  }
}

/** 挂载语言选择器到「设置 / 外观」。 */
async function mountLanguagePicker() {
  try {
    const mod = await import('./hz-settings-language.js');
    if (mod && typeof mod.mountLanguagePicker === 'function') {
      mod.mountLanguagePicker();
    }
  } catch (err) {
    // 语言选择器失败不应影响其它功能
    console.warn('[haizakura] 语言选择器未加载:', err && err.message);
  }
}

/** 引导。 */
async function boot() {
  i18n.initLang(MESSAGES);
  const lang = i18n.getLang();
  document.documentElement.setAttribute('lang', lang === 'zh-pseudo' ? 'zh-Hant' : lang);

  // 语言切换后重译整棵树
  i18n.onLangChange(() => {
    retranslateAll();
    // 插件页需要重挂以应用新语言
    if (ROUTES_OWNED.includes(currentPath())) mountRoute(currentPath());
    mountLanguagePicker();
  });

  startDomTranslator(i18n.t, i18n.getLang);

  // 路由监听：pushState 不会触发 popstate，所以要同时挂钩
  window.addEventListener('popstate', onRouteChange);
  const origPush = history.pushState;
  history.pushState = function (...args) {
    const r = origPush.apply(this, args);
    setTimeout(onRouteChange, 0);
    return r;
  };

  // 首次进入 + 等 React 渲染出「设置」页后再挂选择器
  onRouteChange();
  mountLanguagePicker();
  // React 异步渲染，多试几次
  let tries = 0;
  const timer = setInterval(() => {
    mountLanguagePicker();
    if (++tries >= 10) clearInterval(timer);
  }, 800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
