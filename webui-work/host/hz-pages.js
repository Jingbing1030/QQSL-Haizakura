/**
 * hz-pages.js —— 路由 → 页面注册表。
 *
 * 目前存在【两种】页面模块形态，本适配器都支持：
 *
 *   形态 A（overview / processes）：
 *     export function createXxxPage({ services, resources, plugins })
 *     → 返回一个未挂载的 DOM 根节点，由宿主 appendChild
 *
 *   形态 B（logs / debug）：
 *     export function createXxxPlugin(options)
 *     → 返回 { mount(host, ctx), unmount(), refresh(), getState() }
 *
 * 两种都能挂到同一个 routed host 上。C 形态（createPage 工厂）也留了兜底。
 */

const REGISTRY = new Map();

export function registerPage(path, loader) { REGISTRY.set(path, loader); }
export function getPage(path) { const l = REGISTRY.get(path); return l ? l() : null; }
export function listPages() { return [...REGISTRY.keys()]; }

/* ── 样式表 ──────────────────────────────────────────────────── */

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

/* ── 错误占位（避免整站白屏，同时把问题说清楚）──────────────── */

function errorPage(id, detail) {
  return {
    id,
    mount(host) {
      const box = document.createElement('div');
      box.style.cssText = 'padding:28px;font:14px/1.7 system-ui';
      const h = document.createElement('h2');
      h.style.cssText = 'margin:0 0 8px;font-size:17px';
      h.textContent = '页面未就绪';
      const p = document.createElement('p');
      p.style.cssText = 'margin:0;color:#8b849c';
      p.textContent = detail;
      box.appendChild(h);
      box.appendChild(p);
      host.appendChild(box);
    },
  };
}

/* ── 形态探测 ────────────────────────────────────────────────── */

const camel = (s) => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());

/**
 * 把一个页面模块适配成统一的 { id, mount(host, ctx), unmount? } 接口。
 */
function adapt(id, mod) {
  const C = camel(id);

  // 形态 A：createXxxPage → DOM 节点
  const pageFactory = mod[`create${C}Page`] || mod.createPage;
  if (typeof pageFactory === 'function') {
    let mountedRoot = null;
    return {
      id,
      kind: 'page',
      mount(host, ctx) {
        ensureStyles();
        mountedRoot = pageFactory({ services: ctx && ctx.services, resources: ctx && ctx.resources });
        if (!mountedRoot) throw new Error(`create${C}Page 没有返回 DOM 节点`);
        host.appendChild(mountedRoot);
        return mountedRoot;
      },
      unmount() {
        if (mountedRoot && mountedRoot.parentNode) mountedRoot.parentNode.removeChild(mountedRoot);
        mountedRoot = null;
      },
    };
  }

  // 形态 B：createXxxPlugin → { mount(host, ctx), unmount() }
  const pluginFactory = mod[`create${C}Plugin`];
  if (typeof pluginFactory === 'function') {
    let instance = null;
    return {
      id,
      kind: 'plugin',
      mount(host, ctx) {
        ensureStyles();
        instance = pluginFactory({});
        if (!instance || typeof instance.mount !== 'function') {
          throw new Error(`create${C}Plugin 没有返回带 mount() 的对象`);
        }
        instance.mount(host, { atoms: mod.INLINE_ATOMS });
        return host;
      },
      unmount() {
        if (instance && typeof instance.unmount === 'function') instance.unmount();
        instance = null;
      },
      refresh() {
        if (instance && typeof instance.refresh === 'function') return instance.refresh();
      },
      getState() {
        if (instance && typeof instance.getState === 'function') return instance.getState();
      },
    };
  }

  // 形态 C：模块本身就是一个插件对象
  if (mod.default && typeof mod.default.mount === 'function') {
    return {
      id,
      kind: 'plugin-default',
      mount(host, ctx) { ensureStyles(); mod.default.mount(host, ctx); return host; },
      unmount() { if (typeof mod.default.unmount === 'function') mod.default.unmount(); },
    };
  }

  return errorPage(
    id,
    `${moduleHint(id)} 既没有 create${C}Page，也没有 create${C}Plugin`,
  );
}

const moduleHint = (id) => {
  const map = { overview: 'overview-plugin.js', processes: 'processes-plugin.js',
                logs: 'logs-plugin.js', debug: 'debug-plugin.js' };
  return map[id] || id;
};

/* ── 注册 ────────────────────────────────────────────────────── */

function register(id, path) {
  registerPage(path, async () => {
    try {
      const mod = await import(path);
      return adapt(id, mod);
    } catch (err) {
      return errorPage(id, `加载 ${path} 失败：${err && err.message ? err.message : String(err)}`);
    }
  });
}

register('overview', './overview-plugin.js');
register('processes', './processes-plugin.js');
register('logs', './logs-plugin.js');
register('debug', './debug-plugin.js');
