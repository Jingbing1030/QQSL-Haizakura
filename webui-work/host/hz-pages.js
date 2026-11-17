/**
 * hz-pages.js —— 路由 → 页面注册表。
 *
 * 页面模块共有三种形态（子代理各写各的），**统一判据是返回值内容**，
 * 不猜形参、不猜文件名：
 *
 *   ① createXxxPlugin(options) → { mount(host, ctx), unmount?, refresh? }
 *      logs-plugin.js / debug-plugin.js
 *
 *   ② createXxxPage(opts) → { root: Node, destroy?, refreshAll?, refresh? }
 *      overview-plugin.js / processes-plugin.js
 *      调用方拿到 root 自行 appendChild —— 注意**它不自己挂载**。
 *
 *   ③ createXxxPage(container, opts) → { plugin, host, ... }
 *      settings-plugin.js / config-plugin.js
 *      已经 appendChild 到 container，调用方什么都不用做。
 *
 * 于是挂载逻辑只有一条：调工厂 → 看返回值
 *   · 有 root 且是 Node     → appendChild(root)
 *   · 是 Node 本身          → appendChild 它
 *   · 都没给且宿主已有子节点 → 说明它自己挂了，什么都不做
 *   · 以上都不成立          → 报错（由 hz-app.js 兜底回退）
 */

import { register as hlRegister, unregister as hlUnregister } from './hz-hotload.js';

const REGISTRY = new Map();
const MODULES = new Map();

export function registerPage(path, loader) { REGISTRY.set(path, loader); }
export function getPage(path) { const l = REGISTRY.get(path); return l ? l() : null; }
export function listPages() { return [...REGISTRY.keys()]; }
export function modulePath(path) { return MODULES.get(path) || null; }

/* ── 样式 ────────────────────────────────────────────────────── */

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
      t.textContent = '页面渲染失败';
      const p = document.createElement('div');
      p.className = 'hz-state__hint';
      p.textContent = detail;
      box.append(t, p);
      host.appendChild(box);
    },
  };
}

const camel = (s) => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());

/**
 * 工厂的第一个形参是不是「容器」。
 *
 * 不用 fn.length：`(container, options = {})` 的 length 是 1，
 * 而 `({ services } = {})` 的 length 是 0 —— 两者靠 length 分不开。
 * 看形参名与是否解构才可靠。
 */
function wantsContainer(fn) {
  const src = String(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const open = src.indexOf('(');
  if (open < 0) return false;
  const head = src.slice(open + 1, src.indexOf(')', open) < 0 ? undefined : src.indexOf(')', open));
  const first = head.split(',')[0].trim();
  if (!first) return false;
  if (first.startsWith('{') || first.startsWith('[')) return false;   // 解构 → options
  const name = first.split('=')[0].trim();
  return /^(container|root|host|el|parent|node|mount|target|slot)$/i.test(name);
}

const isNode = (v) => !!v && typeof v === 'object' && typeof v.nodeType === 'number';

/* ── 形态适配 ───────────────────────────────────────────────── */

function adapt(id, mod) {
  const C = camel(id);
  const pluginFactory = mod[`create${C}Plugin`];
  const pageFactory = mod[`create${C}Page`] || mod.createPage;

  // ① 插件形态：明确导出带 mount 的对象工厂
  if (typeof pluginFactory === 'function' && typeof pageFactory !== 'function') {
    let inst = null;
    return {
      id, kind: 'plugin',
      mount(host, ctx) {
        ensureStyles();
        inst = pluginFactory({});
        if (!inst || typeof inst.mount !== 'function') {
          throw new Error(`create${C}Plugin 未返回带 mount() 的对象`);
        }
        inst.mount(host, { atoms: mod.INLINE_ATOMS, ...ctx });
        return host;
      },
      unmount() { try { inst?.unmount?.(); } catch { /* noop */ } inst = null; },
      refresh() { return inst?.refresh?.(); },
      getState() { return inst?.getState?.(); },
    };
  }

  if (typeof pageFactory !== 'function') {
    return errorPage(id, `${id}-plugin.js 既没有 create${C}Page 也没有 create${C}Plugin`);
  }

  // ② / ③ 页面形态：调一次，按返回值和宿主状态决定怎么挂
  let created = null;
  return {
    id, kind: 'page',
    mount(host, ctx) {
      ensureStyles();

      // 判断工厂要不要容器：**看形参名，不看 .length**。
      // 因为 `function f(container, options = {})` 的 .length 是 1
      // （有默认值的参数不计入），靠 length 会把 options 当成容器传进去。
      const arg = wantsContainer(pageFactory)
        ? [host, { resources: ctx?.resources, services: ctx?.services }]
        : [{ services: ctx?.services, resources: ctx?.resources }];

      created = pageFactory(...arg) || null;

      // 情况的组合，逐一处理
      if (isNode(created)) {                    // 直接返回节点
        host.appendChild(created);
        return created;
      }
      if (created && isNode(created.root)) {    // { root, ... }
        host.appendChild(created.root);
        return created;
      }
      if (host.childElementCount > 0) {         // 自己挂好了
        return created || host;
      }
      throw new Error(`create${C}Page 既不返回 DOM 节点，也没有自行挂载`);
    },
    unmount() {
      try {
        if (created && typeof created.destroy === 'function') created.destroy();
        else if (created && typeof created.unmount === 'function') created.unmount();
      } catch { /* noop */ }
      created = null;
    },
    refresh() {
      if (created && typeof created.refreshAll === 'function') return created.refreshAll();
      if (created && typeof created.refresh === 'function') return created.refresh();
    },
  };
}

/* ── 注册 ───────────────────────────────────────────────────── */

const MODULE_PATH = {
  overview: './overview-plugin.js',
  processes: './processes-plugin.js',
  logs: './logs-plugin.js',
  debug: './debug-plugin.js',
  settings: './settings-plugin.js',
  config: './config-plugin.js',
};

const ROUTE_OF = {
  overview: '/', processes: '/processes', logs: '/logs',
  debug: '/debug', settings: '/settings', config: '/config',
};

for (const [id, modPath] of Object.entries(MODULE_PATH)) {
  const route = ROUTE_OF[id];
  MODULES.set(route, modPath);
  registerPage(route, async () => {
    try {
      return adapt(id, await import(modPath));
    } catch (err) {
      return errorPage(id, `加载 ${modPath} 失败：${err?.message ?? String(err)}`);
    }
  });
}

export async function mountRoute(path, host, ctx = {}) {
  const page = await getPage(path);
  if (!page) { host.textContent = ''; return null; }
  const id = 'page:' + path;
  hlRegister(id, host, page, ctx);
  return id;
}

export function unmountRoute(path) {
  return hlUnregister('page:' + path);
}

export async function hotReplaceRoute(path) {
  const modPath = MODULES.get(path);
  if (!modPath) throw new Error(`未知路由 ${path}`);
  const host = document.querySelector('[data-hz-route-host]');
  if (!host) throw new Error('找不到路由宿主');
  const id = 'page:' + path;
  const bust = (modPath.includes('?') ? '&' : '?') + 'v=' + Date.now();
  const mod = await import(modPath + bust);
  const impl = adapt(path.replace(/^\//, '') || 'overview', mod);
  hlUnregister(id);
  host.textContent = '';
  hlRegister(id, host, impl, {});
  return id;
}