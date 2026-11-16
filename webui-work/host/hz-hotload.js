/**
 * hz-hotload.js —— 组件热加载内核。
 *
 * 目标：不重启、不刷新页面，就能替换任意已挂载组件的实现。
 *
 * 三个层次：
 *   ① 组件注册表：id → { mount, unmount, version }
 *   ② 依赖追踪：组件订阅的数据源变化时自动重渲染
 *   ③ 热替换：重新 import 同一 URL（带 cache-busting）→ 卸载旧的 → 挂载新的
 *
 * 样式策略：**完全沿用现有 WebUI**。新组件只用现有设计令牌
 * （--background / --foreground / --card / --border / --primary / --radius …）
 * 和现有类名约定，不引入新配色、不新增 CSS 变量。
 */

/* ── 组件注册表 ─────────────────────────────────────────────── */

const registry = new Map();       // id → instance
const watchers = new Set();       // 订阅变更的回调

/**
 * 注册并挂载一个组件。
 *
 * @param {string} id           唯一标识，热替换时用它定位
 * @param {HTMLElement} host    挂载点
 * @param {object} impl         组件实现，需有 mount(host, ctx)
 * @param {object} [ctx]        传给 mount 的上下文
 */
export function register(id, host, impl, ctx = {}) {
  // 已存在则先卸掉旧的（热替换语义）
  if (registry.has(id)) unregister(id);

  if (!impl || typeof impl.mount !== 'function') {
    throw new TypeError(`register(${id}): impl.mount 必须是函数`);
  }

  const inst = {
    id,
    host,
    impl,
    ctx,
    version: 0,
    mounted: false,
    render: null,
  };

  impl.mount(host, {
    ...ctx,
    // 组件可以拿这个来主动请求重渲染
    requestRender: () => render(id),
  });
  inst.mounted = true;

  registry.set(id, inst);
  notify(id, 'mounted');
  return inst;
}

/** 卸载并从注册表移除。 */
export function unregister(id) {
  const inst = registry.get(id);
  if (!inst) return false;
  try {
    if (typeof inst.impl.unmount === 'function') inst.impl.unmount();
  } catch (err) {
    console.warn(`[hotload] ${id} unmount 失败:`, err && err.message);
  }
  // 清空挂载点（组件自己没清干净时兜底）
  if (inst.host) inst.host.textContent = '';
  inst.mounted = false;
  registry.delete(id);
  notify(id, 'unmounted');
  return true;
}

/** 重渲染：卸载再挂载，但不重新 import。 */
export function render(id) {
  const inst = registry.get(id);
  if (!inst) return false;
  const { host, impl, ctx } = inst;
  try {
    if (typeof impl.unmount === 'function') impl.unmount();
  } catch { /* 忽略 */ }
  host.textContent = '';
  impl.mount(host, { ...ctx, requestRender: () => render(id) });
  inst.version += 1;
  notify(id, 'rendered');
  return true;
}

/**
 * 热替换：重新加载模块并换掉实现。
 *
 * 用 `?v=<timestamp>` 绕过 ES module 的 URL 缓存 —— 浏览器对同一 URL 的
 * module 只求值一次，不加查询串就永远是旧代码。
 *
 * @param {string} id        要替换的组件
 * @param {string} moduleUrl 模块 URL（可用相对路径）
 * @param {string} [exportName] 具名导出；不传则用 default
 */
export async function hotReplace(id, moduleUrl, exportName) {
  const inst = registry.get(id);
  if (!inst) throw new Error(`hotReplace(${id}): 组件未注册`);

  const bust = (moduleUrl.includes('?') ? '&' : '?') + 'v=' + Date.now();
  const mod = await import(moduleUrl + bust);
  const impl = exportName ? mod[exportName] : (mod.default || mod);

  if (!impl || typeof impl.mount !== 'function') {
    throw new Error(`hotReplace(${id}): ${moduleUrl} 没有可用的 mount`);
  }

  try {
    if (typeof inst.impl.unmount === 'function') inst.impl.unmount();
  } catch { /* 忽略 */ }
  inst.host.textContent = '';

  inst.impl = impl;
  impl.mount(inst.host, { ...inst.ctx, requestRender: () => render(id) });
  inst.version += 1;

  notify(id, 'replaced');
  return inst.version;
}

/* ── 变更通知 ──────────────────────────────────────────────── */

function notify(id, event) {
  for (const cb of watchers) {
    try { cb({ id, event, version: registry.get(id)?.version }); } catch { /* 忽略 */ }
  }
}

/** 订阅组件变更（挂载/卸载/重渲染/热替换）。 */
export function onComponentChange(cb) {
  watchers.add(cb);
  return () => watchers.delete(cb);
}

/** 当前已挂载的组件清单。 */
export function listComponents() {
  return [...registry.values()].map((i) => ({
    id: i.id, mounted: i.mounted, version: i.version,
  }));
}

/* ── 开发辅助：文件监听触发热替换 ──────────────────────────── */

/**
 * 轮询一个清单文件，发现变化就热替换对应组件。
 *
 * 这是给「改代码 → 立刻看到效果」用的：构建脚本把清单写到
 * /assets/hz-hotload.json，内容形如
 *   { "overview": { "url": "/assets/overview-plugin.js", "export": "default" } }
 * 文件里的 mtime 或 hash 变了，就 reload 那个组件。
 *
 * 生产环境不启动它（由调用方决定）。
 */
export function watchManifest(manifestUrl = '/assets/hz-hotload.json', intervalMs = 1500) {
  let last = '';
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const res = await fetch(manifestUrl + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        if (text !== last) {
          last = text;
          const manifest = JSON.parse(text);
          for (const [id, spec] of Object.entries(manifest)) {
            if (!registry.has(id)) continue;
            try {
              await hotReplace(id, spec.url, spec.export);
              console.log(`[hotload] ${id} → v${registry.get(id).version}`);
            } catch (err) {
              console.warn(`[hotload] ${id} 替换失败:`, err && err.message);
            }
          }
        }
      }
    } catch { /* 清单不存在时静默 */ }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  }

  tick();
  return {
    stop() { stopped = true; if (timer) clearTimeout(timer); },
  };
}
