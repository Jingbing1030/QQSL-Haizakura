/**
 * plugin.js — Haizakura WebUI 插件化内核
 * =============================================================================
 * 目标：**插件化**。页面不再是一段写死的渲染代码，而是「组件注册表 + 按序挂载」。
 *
 * 一个页面 = 一组 Plugin 按 order 升序挂载到容器里。
 * 每个 Plugin 自己持有自己的数据源（Resource），自己管理 load / refresh 生命周期，
 * 因此新增一块内容 = 新增一个插件并 register()，无需改动页面代码。
 *
 * 生命周期
 * -----------------------------------------------------------------------------
 *   mount(el, ctx)   第一次挂载；通常在这里 subscribe + 触发首次 load
 *   refresh()        主动刷新（页面「刷新」按钮 / 定时器）
 *   unmount()        卸载；**必须**解绑订阅、清空定时器，否则会内存泄漏
 *
 * 约定
 * -----------------------------------------------------------------------------
 * - Plugin 不得直接操作兄弟插件；跨插件通信一律走 ctx（共享 Resource/事件总线）。
 * - mount() 里应记录 unsubscribe 函数，在 unmount() 中调用。
 * - 幂等：mount 调用前内核会先对该插件 unmount（若之前挂过），避免重复订阅。
 * - 任何错误都不得被吞掉：插件渲染错误态（见 atoms.stateView）。
 *
 * @module plugin
 */

/* ========================================================================== *
 * STRINGS — 本模块的用户可见文案
 * ========================================================================== */

export const STRINGS = {
  pageTitle: '页面',
  empty: '该页面没有注册任何插件',
  duplicateId: ({ id }) => `插件 id 重复：${id}`,
  mountFailed: ({ id, message }) => `插件「${id}」挂载失败：${message}`,
  refreshAll: '全部刷新',
};

/* ========================================================================== *
 * Plugin 定义
 * ========================================================================== */

/**
 * 归一化一个插件定义。补齐默认值、校验必填项。
 *
 * @param {Object} spec
 * @param {string} spec.id            唯一 id（必填）
 * @param {string} [spec.title]       显示名
 * @param {string} [spec.icon]        atoms.Icon 的图标名
 * @param {number} [spec.order]       挂载顺序，小的在前（默认 100）
 * @param {(el: HTMLElement, ctx: Object) => void} spec.mount   必填
 * @param {() => void} [spec.unmount]
 * @param {() => void|Promise<void>} [spec.refresh]
 * @param {() => import('./data-layer.js').Resource[]} [spec.resources] 声明数据源
 * @param {string} [spec.description]  说明（可用于调试面板）
 * @returns {Object} 冻结后的插件对象
 */
export function definePlugin(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('definePlugin(spec): spec 必须是对象');
  }
  if (typeof spec.id !== 'string' || spec.id.trim() === '') {
    throw new TypeError('definePlugin(spec): id 必须是非空字符串');
  }
  if (typeof spec.mount !== 'function') {
    throw new TypeError(`definePlugin(${spec.id}): mount 必须是函数`);
  }

  return Object.freeze({
    id: spec.id,
    title: spec.title ?? spec.id,
    icon: spec.icon ?? null,
    description: spec.description ?? '',
    order: Number.isFinite(spec.order) ? spec.order : 100,
    mount: spec.mount,
    unmount: typeof spec.unmount === 'function' ? spec.unmount : () => {},
    refresh: typeof spec.refresh === 'function' ? spec.refresh : () => {},
    // resources() 让内核可以做统一刷新 / 统一错误统计，插件无需暴露内部字段
    resources: typeof spec.resources === 'function' ? spec.resources : () => [],
  });
}

/* ========================================================================== *
 * 注册表
 * ========================================================================== */

/** @type {Map<string, Object>} id → 归一化插件 */
const registry = new Map();

/**
 * 注册一个插件。相同 id 重复注册会抛错（防止两个模块互相覆盖、静默失效）。
 * @param {Object} plugin  已 definePlugin 的对象，或裸 spec（会自动归一化）
 * @returns {Object} 归一化后的插件
 */
export function registerPlugin(plugin) {
  const normalized = typeof plugin?.mount === 'function' && !('id' in (plugin || {}))
    ? definePlugin(plugin)
    : (Object.isFrozen(plugin) ? plugin : definePlugin(plugin));

  if (registry.has(normalized.id)) {
    throw new Error(STRINGS.duplicateId({ id: normalized.id }));
  }
  registry.set(normalized.id, normalized);
  return normalized;
}

/**
 * 取全部已注册插件，按 order 升序（同 order 保持注册顺序）。
 * @returns {Object[]}
 */
export function getPlugins() {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

/**
 * 按 id 取插件。
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getPlugin(id) {
  return registry.get(id);
}

/**
 * 清空注册表。主要给测试用；生产代码请勿调用。
 */
export function clearPlugins() {
  registry.clear();
}

/* ========================================================================== *
 * 挂载器
 * ========================================================================== */

/**
 * 默认 context 工厂。ctx 是插件之间唯一的共享通道。
 *
 * @param {Object} [options]
 * @param {Document|HTMLElement} [options.root]  页面根节点（供插件查 DOM）
 * @param {Object} [options.resources]           「名称 → Resource」共享数据源
 * @param {Object} [options.services]            其他共享服务（如 navigate 函数）
 * @returns {Object} ctx
 */
export function createContext({ root, resources = {}, services = {} } = {}) {
  /** 事件总线：插件之间只通过它通信，不直接引用对方 */
  const listeners = new Map();

  const ctx = {
    root: root ?? null,
    /** 共享 Resource 集合，例如 ctx.resources.processList */
    resources,
    /** 共享服务，例如 ctx.services.navigate('/processes') */
    services,
    /** 页面级插件实例表（由 mountAll 填充），用于页面级「全部刷新」 */
    instances: new Map(),

    /**
     * 订阅自定义事件。
     * @param {string} type
     * @param {(payload: any) => void} handler
     * @returns {() => void} 取消订阅
     */
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
      return () => listeners.get(type)?.delete(handler);
    },

    /**
     * 触发事件。单个 handler 抛错不影响其他 handler。
     * @param {string} type
     * @param {*} [payload]
     */
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          handler(payload);
        } catch (err) {
          // 事件处理器失败不得中断其他处理器
          console.error(`[plugin] ctx handler for "${type}" failed:`, err);
        }
      }
    },

    /**
     * 清空全部订阅（页面卸载时调用）。
     */
    dispose() {
      listeners.clear();
      ctx.instances.clear();
    },
  };

  return ctx;
}

/**
 * 挂载所有插件到 root。返回一个句柄，用于 refreshAll / unmountAll。
 *
 * 每个插件被包在一个独立的 <section> 里：
 *   - 单个插件崩溃不会带走整页（错误就地渲染为 ErrorState）
 *   - 卸载/重挂载时只需替换自己的容器
 *
 * @param {HTMLElement} root
 * @param {Object} [ctx]
 * @param {Object} [options]
 * @param {Object[]} [options.plugins]  覆盖注册表（默认用 getPlugins()）
 * @returns {{refreshAll: () => Promise<void>, unmountAll: () => void, ctx: Object, plugins: Object[]}}
 */
export function mountAll(root, ctx = createContext({ root }), { plugins } = {}) {
  const list = Array.isArray(plugins) ? plugins : getPlugins();
  const mounted = [];
  const container = root;

  // 保留一份 root 引用，供插件内部查询（例如滚动位置保持）
  ctx.root = container;

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hz-plugin-empty';
    empty.textContent = STRINGS.empty;
    root.appendChild(empty);
  }

  for (const plugin of list) {
    // 每个插件一个宿主节点，带上 data-plugin 便于调试与样式定位
    const host = document.createElement('div');
    host.className = 'hz-plugin';
    host.dataset.plugin = plugin.id;
    root.appendChild(host);

    const instance = {
      plugin,
      host,
      failed: false,
      error: null,
      unmount: null,
    };

    try {
      const handle = plugin.mount(host, ctx);
      // mount 允许返回 unmount 函数（与 plugin.unmount 二选一，都会被执行）
      instance.unmount = typeof handle === 'function' ? handle : null;
    } catch (err) {
      // 挂载失败：就地显示错误，不吞异常
      instance.failed = true;
      instance.error = err;
      host.textContent = '';
      const box = document.createElement('div');
      box.className = 'hz-plugin-error';
      box.setAttribute('role', 'alert');
      box.textContent = STRINGS.mountFailed({
        id: plugin.id,
        message: err instanceof Error ? err.message : String(err),
      });
      host.appendChild(box);
      console.error(`[plugin] mount "${plugin.id}" failed:`, err);
    }

    ctx.instances.set(plugin.id, instance);
    mounted.push(instance);
  }

  return {
    ctx,
    plugins: list,

    /**
     * 依次刷新所有插件。单个插件刷新失败不影响其他插件，
     * 但失败会汇总抛出，便于调用方展示。
     */
    async refreshAll() {
      const failures = [];
      for (const instance of mounted) {
        if (instance.failed) continue;
        try {
          await instance.plugin.refresh();
        } catch (err) {
          failures.push({ id: instance.plugin.id, error: err });
          console.error(`[plugin] refresh "${instance.plugin.id}" failed:`, err);
        }
      }
      if (failures.length > 0) {
        throw new Error(
          failures
            .map((f) => `${f.id}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
            .join('; '),
        );
      }
    },

    /**
     * 卸载所有插件（**幂等**）。插件自己的 unmount 里的异常被隔离。
     */
    unmountAll() {
      for (const instance of mounted) {
        try {
          instance.plugin.unmount();
        } catch (err) {
          console.error(`[plugin] unmount "${instance.plugin.id}" failed:`, err);
        }
        try {
          instance.unmount?.();
        } catch (err) {
          console.error(`[plugin] returned unmount for "${instance.plugin.id}" failed:`, err);
        }
        instance.host.remove();
      }
      mounted.length = 0;
      ctx.dispose();
    },
  };
}

/* ========================================================================== *
 * 便捷基类：带一组 Resource 的插件
 * ========================================================================== *
 * 绝大多数插件都是同一个形状：
 *   1. 声明若干 Resource
 *   2. 首次挂载时 load 全部 Resource
 *   3. 任一 Resource 状态变化 → 局部重渲染
 *   4. 卸载时取消订阅
 * `createResourcePlugin` 把这段样板代码收敛掉，让插件只写渲染逻辑。
 */

/**
 * @param {Object} spec
 * @param {string} spec.id
 * @param {string} [spec.title]
 * @param {string} [spec.icon]
 * @param {number} [spec.order]
 * @param {string} [spec.description]
 * @param {(ctx: Object) => Object<string, import('./data-layer.js').Resource>} spec.createResources
 *        在 mount 时创建数据源（每次挂载新建，避免遗留旧状态）
 * @param {(state: {resources: Object, ctx: Object, el: HTMLElement}) => Node|Node[]} spec.render
 *        纯渲染函数：只根据 resources 的当前快照产出节点
 * @returns {Object} 已 definePlugin 的插件
 */
export function createResourcePlugin(spec) {
  if (typeof spec.createResources !== 'function') {
    throw new TypeError(`createResourcePlugin(${spec.id}): createResources 必须是函数`);
  }
  if (typeof spec.render !== 'function') {
    throw new TypeError(`createResourcePlugin(${spec.id}): render 必须是函数`);
  }

  /** 每次挂载的运行时状态（卸载时清空，避免跨挂载泄漏） */
  let runtime = null;

  const draw = () => {
    if (!runtime) return;
    const { el: host, ctx, resources, unsubscribers } = runtime;
    // 每次整体重绘插件自己的宿主节点（插件间互不影响）
    while (host.firstChild) host.removeChild(host.firstChild);
    try {
      const output = spec.render({ resources, ctx, el: host });
      // render 可能返回 Node / Node[] / 字符串
      const nodes = Array.isArray(output) ? output : [output];
      for (const node of nodes) {
        if (!node) continue;
        if (node instanceof Node) host.appendChild(node);
        else host.appendChild(document.createTextNode(String(node)));
      }
    } catch (err) {
      // 渲染异常也要可见
      const box = document.createElement('div');
      box.className = 'hz-plugin-error';
      box.setAttribute('role', 'alert');
      box.textContent = err instanceof Error ? err.message : String(err);
      host.appendChild(box);
      console.error(`[plugin] render "${spec.id}" failed:`, err);
    }
    // unsubscribers 在此处仅为可读性保留引用；实际解绑在 unmount
    void unsubscribers;
  };

  return definePlugin({
    id: spec.id,
    title: spec.title,
    icon: spec.icon,
    order: spec.order,
    description: spec.description,

    mount(host, ctx) {
      const resources = spec.createResources(ctx);
      const unsubscribers = [];

      runtime = { el: host, ctx, resources, unsubscribers, draw };

      // 每个 Resource 状态变化都触发一次插件局部重绘
      for (const resource of Object.values(resources)) {
        if (!resource || typeof resource.subscribe !== 'function') continue;
        unsubscribers.push(resource.subscribe(() => draw()));
      }

      // 先画一次（此时是 idle / loading，取决于 Resource 初始状态）
      draw();

      // 再触发加载：所有 Resource 并行，失败由各自状态承载（不在这里 catch 掉）
      for (const resource of Object.values(resources)) {
        if (!resource || typeof resource.load !== 'function') continue;
        resource.load();
      }
    },

    unmount() {
      if (!runtime) return;
      for (const unsubscribe of runtime.unsubscribers) {
        try {
          unsubscribe();
        } catch (err) {
          console.error(`[plugin] unsubscribe "${spec.id}" failed:`, err);
        }
      }
      // 中止进行中的请求，避免卸载后仍回调
      for (const resource of Object.values(runtime.resources)) {
        resource?.abort?.();
      }
      runtime = null;
    },

    refresh() {
      if (!runtime) return;
      for (const resource of Object.values(runtime.resources)) {
        resource?.refresh?.();
      }
    },

    resources() {
      return runtime ? Object.values(runtime.resources) : [];
    },
  });
}