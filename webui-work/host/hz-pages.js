/**
 * hz-pages.js —— 路由 → 页面注册表 + 热加载接入。
 *
 * 页面模块有两种形态，都支持：
 *   形态 A（overview / processes / settings / config）：
 *     export function createXxxPage({ services, resources, plugins })
 *     → 返回未挂载的 DOM 根节点
 *   形态 B（logs / debug）：
 *     export function createXxxPlugin(options)
 *     → 返回 { mount(host, ctx), unmount(), refresh(), getState() }
 *
 * 每个页面通过 hotload.register() 挂载，因此可以在不刷新页面的情况下
 * 热替换实现（改代码 → 立即见效）。
 */

import { register as hlRegister, unregister as hlUnregister, hotReplace } from './hz-hotload.js';

const REGISTRY = new Map();

export function registerPage(path, loader) { REGISTRY.set(path, loader); }
export function getPage(path) { const l = REGISTRY.get(path); return l ? l() : null; }
export function listPages() { return [...REGISTRY.keys()]; }

/* ── 样式：沿用现有 WebUI 令牌，无需额外注入开关 ─────────────── */

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/assets/hz-pages.css';
  link.setAttribute('data-hz-owned', '1');
  document.head.appendChild(link);
}

/* ── 错误占位 ────────────────────────────────────────────────── */

function errorPage(id, detail) {
  return {
    id,
    mount(host) {
      const box = document.createElement('div');
      box.className = 'hz-state hz-state--error';
      const t = document.createElement('div');
      t.className = 'hz-state__title';
      t.textContent = '页面未就绪';
      const p = document.createElement('div');
      p.className = 'hz-state__hint';
      p.textContent = detail;
      box.append(t, p);
      host.appendChild(box);
    },
  };
}

const camel = (s) => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());

/* ── 形态适配 ────────────────────────────────────────────────── */

function adapt(id, mod) {
  const C = camel(id);

  // 形态 A：createXxxPage → DOM
  const pageFactory = mod[`create${C}Page`] || mod.createPage;
  if (typeof pageFactory === 'function') {
    let root = null;
    return {
      id, kind: 'page',
      mount(host, ctx) {
        ensureStyles();
        root = pageFactory({ services: ctx?.services, resources: ctx?.resources });
        if (!root) throw new Error(`create${C}Page 未返回 DOM 节点`);
        host.appendChild(root);
      },
      unmount() {
        if (root?.parentNode) root.parentNode.removeChild(root);
        root = null;
      },
    };
  }

  // 形态 B：createXxxPlugin → { mount(host, ctx) }
  const pluginFactory = mod[`create${C}Plugin`];
  if (typeof pluginFactory === 'function') {
    let inst = null;
    return {
      id, kind: 'plugin',
      mount(host, ctx) {
        ensureStyles();
        inst = pluginFactory({});
        if (!inst?.mount) throw new Error(`create${C}Plugin 未返回带 mount() 的对象`);
        inst.mount(host, { atoms: mod.INLINE_ATOMS, ...ctx });
      },
      unmount() { inst?.unmount?.(); inst = null; },
      refresh() { return inst?.refresh?.(); },
      getState() { return inst?.getState?.(); },
    };
  }

  // 形态 C：模块本身就是插件对象
  if (mod.default?.mount) {
    const d = mod.default;
    return {
      id, kind: 'plugin-default',
      mount(host, ctx) { ensureStyles(); d.mount(host, ctx); },
      unmount() { d.unmount?.(); },
    };
  }

  const hint = { overview: 'overview-plugin.js', processes: 'processes-plugin.js',
                 logs: 'logs-plugin.js', debug: 'debug-plugin.js',
                 settings: 'settings-plugin.js', config: 'config-plugin.js' }[id] || id;
  return errorPage(id, `${hint} 既未导出 create${C}Page 也未导出 create${C}Plugin`);
}

/* ── 注册（带热加载）─────────────────────────────────────────── */

const MODULE_PATH = {
  overview: './overview-plugin.js',
  processes: './processes-plugin.js',
  logs: './logs-plugin.js',
  debug: './debug-plugin.js',
  settings: './settings-plugin.js',
  config: './config-plugin.js',
};

/**
 * 挂载某路由的页面到 host。
 *
 * 用 hotload 注册，id 形如 `page:/logs`，之后可以：
 *   hotReplace('page:/logs', './logs-plugin.js')
 * 来热替换（不刷新页面）。
 */
export async function mountRoute(path, host, ctx = {}) {
  const id = 'page:' + path;
  const loader = REGISTRY.get(path);
  if (!loader) { host.textContent = ''; return null; }

  let page;
  try {
    page = await loader();
  } catch (err) {
    page = errorPage(path, `加载失败：${err?.message ?? String(err)}`);
  }

  // 记下模块路径，供热替换使用
  const routeEntry = [...REGISTRY.keys()].indexOf(path);
  const impl = {
    ...page,
    __module: MODULE_PATH[pathToId(path)],
  };

  hlRegister(id, host, impl, ctx);
  return id;
}

export function unmountRoute(path) {
  return hlUnregister('page:' + path);
}

/** 热替换某路由的页面实现。 */
export async function hotReplaceRoute(path) {
  const id = 'page:' + path;
  const modPath = MODULE_PATH[pathToId(path)];
  if (!modPath) throw new Error(`未知路由 ${path}`);
  const bust = (modPath.includes('?') ? '&' : '?') + 'v=' + Date.now();
  const mod = await import(modPath + bust);
  const impl = adapt(pathToId(path), mod);
  // 借 hotload 的替换能力：先塞进去再替换
  const host = document.querySelector('[data-hz-route-host]');
  if (!host) throw new Error('找不到路由宿主');
  hlUnregister(id);
  hlRegister(id, host, impl, {});
  return id;
}

const pathToId = (p) => p.replace(/^\//, '') || 'overview';

/* ── 注册所有路由 ────────────────────────────────────────────── */

for (const [id, modPath] of Object.entries(MODULE_PATH)) {
  const route = id === 'overview' ? '/' : '/' + id;
  registerPage(route, async () => adapt(id, await import(modPath)));
}
