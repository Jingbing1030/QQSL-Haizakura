/**
 * atoms.js — Haizakura WebUI 原子组件库
 * =============================================================================
 * 目标：**原子化**。每个导出只做一件事，纯函数式（无内部状态、无副作用订阅），
 * 调用一次就返回一个 DOM 节点（少量返回 HTML 字符串的辅助函数单独标注）。
 *
 * 设计约定
 * -----------------------------------------------------------------------------
 * 1. 全部使用原生 DOM API，**不依赖任何 npm 包**、不使用 JSX / 模板引擎。
 * 2. 组件不读全局状态、不发请求。数据由调用方（plugin / page）传入。
 * 3. 用户可见文案全部来自本文件顶部的 `STRINGS`，便于后续 i18n 层整体替换：
 *      STRINGS.someKey            → 字符串
 *      STRINGS.someKey({a: 1})    → 参数化字符串（函数）
 *    组件本身不拼接任何自然语言，除了 STRINGS 里的内容。
 * 4. 所有取值都做了空值兜底（`—`），**不伪造数据**：API 没给的字段不猜。
 *
 * 关键 API 说明（详见 data-layer.js 与各 plugin 的注释）
 * -----------------------------------------------------------------------------
 * 本文件不直接访问 API，但组件的形状是照着下列真实响应设计的：
 *   GET /api/status   → { status: "running" }
 *   GET /api/system   → { hostname, platform, arch, archLabel, release, distro,
 *                         uptime, processUptime, nodeVersion,
 *                         cpu{ model, cores, speedMHz, loadAvg[], perCore[], average },
 *                         memory{ total, free, used, usagePercent,
 *                                 runtimeRss? ... }   ← 见 system 探针记录
 *                         runtime{ pid, lowIntegrity, rss, heapTotal, heapUsed,
 *                                  external, arrayBuffers } }
 *   GET /api/processes → { list: [ { pid, name, path, injected, connected,
 *                                    loggedIn, uin, status, error, method,
 *                                    account: { uin, nickname } | null } ] }
 *   GET /api/qq-list   → { list: [ { uin, nickname } ] }
 *   GET /api/connections → { list: [ { uin, nickname, adapters: [ {
 *                            name, kind, status, detail, lastError?, lastErrorAt? } ],
 *                            databaseMigration: { phase, usable, processed, total,
 *                                                 progress, estimatedRemainingSeconds } } ] }
 *   GET /api/notifications/recent → { recent: [ { time, uin, event, channelId,
 *                                                 ok, status, error? } ] }
 *
 * @module atoms
 */

/* ========================================================================== *
 * STRINGS — 全部用户可见文案（i18n 单一替换点）
 * ========================================================================== */

export const STRINGS = {
  /* ---- 通用 ---- */
  empty: '—',
  loading: '加载中',
  retry: '重试',
  refresh: '刷新',
  close: '关闭',
  confirm: '确认',
  cancel: '取消',
  unknown: '未知',

  /* ---- 状态徽章（Badge tone） ---- */
  toneOk: '正常',
  toneWarn: '注意',
  toneError: '异常',
  toneIdle: '未启用',
  toneBusy: '进行中',

  /* ---- 空态 / 错误态 ---- */
  emptyTitle: '暂无数据',
  emptyHint: '当前没有可显示的内容',
  errorTitle: '加载失败',
  errorHint: '请检查后端服务与网络后重试',
  staleNotice: '刷新失败，以下为上次成功读取的数据',
  staleHint: '数据可能已过期',

  /* ---- 表格 ---- */
  tableEmpty: '暂无记录',

  /* ---- 进度条 ---- */
  progressLabel: ({ value, max }) => `${value} / ${max}`,

  /* ---- 开关 ---- */
  toggleOn: '已开启',
  toggleOff: '已关闭',

  /* ---- 指标单位（Stat.unit） ---- */
  unitPercent: '%',
  unitMs: 'ms',
  unitBytes: 'B',
  unitCount: '个',
};

/* ========================================================================== *
 * 内部工具
 * ========================================================================== */

/**
 * 极简元素构造器。**仅供本文件与 plugin 层内部使用**（导出以便复用）。
 *
 * @param {string} tag       标签名，如 'div'
 * @param {Object} [attrs]   属性表。特殊键：
 *                            - `class`   → className
 *                            - `text`    → textContent（防 XSS）
 *                            - `html`    → innerHTML（**仅传可信内容**）
 *                            - `dataset` → data-* 集合
 *                            - `style`   → 内联样式对象
 *                            - `on*`     → 事件监听（如 onClick）
 *                            - 其余键    → setAttribute（null/undefined/false 跳过）
 * @param {Array<Node|string|null|false|undefined>} [children] 子节点
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv !== null && dv !== undefined) node.dataset[dk] = String(dv);
      }
    } else if (key === 'style' && typeof value === 'object') {
      for (const [sk, sv] of Object.entries(value)) {
        if (sv !== null && sv !== undefined) node.style.setProperty(sk, String(sv));
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      // onClick → click，onKeyDown → keydown
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

/**
 * 把 children 数组（可含 null / false / 字符串 / Node）挂到父节点。
 * @param {Node} parent
 * @param {*} children
 */
export function appendChildren(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === '') continue;
    if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      // 字符串一律走 textContent，避免把服务端文本当 HTML 解析
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
  return parent;
}

/**
 * 清空节点（保留节点本身，便于复用重渲染）。
 * @param {HTMLElement} node
 * @returns {HTMLElement}
 */
export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * 用新内容替换节点内部（先清空再挂载）。
 * @param {HTMLElement} node
 * @param {*} children
 */
export function replaceChildren(node, children) {
  clear(node);
  appendChildren(node, children);
  return node;
}

/**
 * 安全取值为可显示文本：null/undefined/'' → STRINGS.empty。
 * @param {*} value
 * @returns {string}
 */
export function display(value) {
  if (value === null || value === undefined) return STRINGS.empty;
  const text = String(value).trim();
  return text === '' ? STRINGS.empty : text;
}

/* ========================================================================== *
 * 格式化（不产生文案，只处理数字；单位由调用方 / STRINGS 提供）
 * ========================================================================== */

/**
 * 字节 → 人类可读。返回 { value, unit }，**unit 交给调用方决定是否本地化**。
 * 来源：/api/system 的 memory.* 与 runtime.*（单位：字节）
 * @param {number} bytes
 * @returns {{value: string, unit: string}}
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return { value: STRINGS.empty, unit: '' };
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = 0;
  let value = n;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return { value: value.toFixed(digits), unit: units[index] };
}

/**
 * 秒 → 紧凑时长（如 `2天3小时` / `5分12秒`）。
 * 来源：/api/system 的 uptime / processUptime（单位：秒，浮点）
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  const total = Math.floor(Number(seconds));
  if (!Number.isFinite(total) || total < 0) return STRINGS.empty;
  if (total < 60) return `${total}s`;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${secs}s`;
}

/**
 * 数字 → 固定小数位；非数字回落 `—`。
 * @param {number} value
 * @param {number} [digits]
 * @returns {string}
 */
export function formatNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return STRINGS.empty;
  return n.toFixed(digits);
}

/**
 * 毫秒时间戳 / ISO 字符串 → 本地时间文本。
 * 来源：/api/notifications/recent 的 `time`（毫秒数字）
 * @param {number|string} time
 * @param {boolean} [withDate]
 * @returns {string}
 */
export function formatTime(time, withDate = false) {
  if (time === null || time === undefined) return STRINGS.empty;
  const date = time instanceof Date ? time : new Date(Number(time) || time);
  if (Number.isNaN(date.getTime())) return STRINGS.empty;
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  if (!withDate) return clock;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

/* ========================================================================== *
 * 图标（内联 SVG，零依赖）
 * 仅用于装饰；语义信息一律由文本承担（无障碍）。
 * ========================================================================== */

const ICON_PATHS = {
  server: 'M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5Zm0 11a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3Z',
  cpu: 'M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2M6 6h12v12H6z',
  memory: 'M4 6h16v10H4zM8 16v3M12 16v3M16 16v3M7 9h2v4H7zM12 9h2v4h-2zM17 9h2v4h-2z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6V8m0 8h5',
  plug: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8Zm6 15v-4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1Z',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  unplug: 'M19 5 22 2M2 22l3-3M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4ZM12 6l6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z',
};

/**
 * 内联 SVG 图标。
 * @param {keyof typeof ICON_PATHS|string} name
 * @param {{size?: number, class?: string}} [opts]
 * @returns {SVGSVGElement}
 */
export function Icon(name, opts = {}) {
  const size = opts.size ?? 16;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (opts.class) svg.setAttribute('class', opts.class);

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.server);
  svg.appendChild(path);
  return svg;
}

/* 图标名 → 中文可读名的映射交给各页面自己维护（避免 atoms 混入业务语义）。 */

/* ========================================================================== *
 * 布局原子
 * ========================================================================== */

/**
 * 卡片容器。标题栏 + 可选操作区 + 内容区。
 *
 * @param {Object} options
 * @param {string} [options.title]          标题（纯文本）
 * @param {string} [options.hint]           标题下方说明（纯文本）
 * @param {Node[]|Node} [options.actions]   右上角操作区
 * @param {Node[]|Node} options.children    内容区
 * @param {string} [options.class]          附加类名
 * @param {boolean} [options.stretch]       是否撑满父容器高度
 * @returns {HTMLElement}
 */
export function Card({ title, hint, actions, children, class: extraClass, stretch } = {}) {
  const root = el('section', {
    class: ['hz-card', stretch ? 'hz-card--stretch' : '', extraClass || ''].filter(Boolean).join(' '),
  });

  if (title || hint || actions) {
    const head = el('header', { class: 'hz-card__head' });
    const titles = el('div', { class: 'hz-card__titles' });
    if (title) titles.appendChild(el('h2', { class: 'hz-card__title', text: title }));
    if (hint) titles.appendChild(el('p', { class: 'hz-card__hint', text: hint }));
    head.appendChild(titles);

    if (actions) {
      const actionBox = el('div', { class: 'hz-card__actions' });
      appendChildren(actionBox, actions);
      head.appendChild(actionBox);
    }
    root.appendChild(head);
  }

  const body = el('div', { class: 'hz-card__body' });
  appendChildren(body, children);
  root.appendChild(body);
  return root;
}

/**
 * 数值指标卡（单个 KPI）。数值 + 单位 + 副标题，可选 tone 着色。
 *
 * @param {Object} options
 * @param {string} options.label            指标名（如「在线账号」）
 * @param {string|number} options.value     数值（原样显示，不做格式化）
 * @param {string} [options.unit]           单位（如 `%` / `ms`）
 * @param {'ok'|'warn'|'error'|'idle'|'accent'} [options.tone] 语义色
 * @param {string} [options.hint]           副标题（说明来源 / 状态）
 * @param {Node} [options.icon]             图标节点
 * @returns {HTMLElement}
 */
export function Stat({ label, value, unit, tone, hint, icon } = {}) {
  const root = el('div', {
    class: ['hz-stat', tone ? `hz-stat--${tone}` : ''].filter(Boolean).join(' '),
  });

  if (icon) {
    const iconBox = el('div', { class: 'hz-stat__icon' });
    iconBox.appendChild(icon);
    root.appendChild(iconBox);
  }

  const body = el('div', { class: 'hz-stat__body' });
  body.appendChild(el('p', { class: 'hz-stat__label', text: display(label) }));

  const valueRow = el('p', { class: 'hz-stat__value' });
  valueRow.appendChild(el('span', { class: 'hz-stat__number', text: display(value) }));
  if (unit) valueRow.appendChild(el('span', { class: 'hz-stat__unit', text: unit }));
  body.appendChild(valueRow);

  if (hint) body.appendChild(el('p', { class: 'hz-stat__hint', text: hint }));

  root.appendChild(body);
  return root;
}

/**
 * 状态徽章。tone 决定颜色；text 决定文案。
 *
 * tone 取值与后端真实状态枚举的对应关系（见各 plugin）：
 *   ok    → 健康 / 在线 / 正常
 *   warn  → 注意 / 等待 / 降级
 *   error → 异常 / 失败 / 断开
 *   idle  → 未启用 / 可加载 / 空闲
 *   busy  → 加载中 / 进行中
 *
 * @param {Object} options
 * @param {string} options.text
 * @param {'ok'|'warn'|'error'|'idle'|'busy'} [options.tone]
 * @param {string} [options.title]  悬停提示（如原始英文状态）
 * @returns {HTMLElement}
 */
export function Badge({ text, tone = 'idle', title } = {}) {
  return el('span', {
    class: `hz-badge hz-badge--${tone}`,
    text: display(text),
    title: title ?? null,
    role: 'status',
  });
}

/**
 * 加载指示器。`label` 会渲染为可见文本（默认「加载中」），便于屏幕阅读器。
 * @param {{label?: string, size?: number, inline?: boolean}} [options]
 * @returns {HTMLElement}
 */
export function Spinner({ label, size = 16, inline = false } = {}) {
  const root = el('span', {
    class: ['hz-spinner', inline ? 'hz-spinner--inline' : ''].filter(Boolean).join(' '),
    role: 'status',
    'aria-live': 'polite',
  });
  root.appendChild(
    el('span', {
      class: 'hz-spinner__ring',
      style: { width: `${size}px`, height: `${size}px` },
    }),
  );
  root.appendChild(el('span', { class: 'hz-spinner__label', text: label ?? STRINGS.loading }));
  return root;
}

/**
 * 骨架屏。**只在「已知即将有内容」的占位场景使用**；
 * 真实的 loading 状态请用 Spinner 或 state 视图（见 stateView）。
 *
 * @param {{lines?: number, height?: number, class?: string}} [options]
 * @returns {HTMLElement}
 */
export function Skeleton({ lines = 3, height = 14, class: extraClass } = {}) {
  const root = el('div', {
    class: ['hz-skeleton', extraClass || ''].filter(Boolean).join(' '),
    'aria-hidden': 'true',
  });
  for (let i = 0; i < Math.max(1, lines); i += 1) {
    root.appendChild(
      el('span', {
        class: 'hz-skeleton__line',
        style: {
          height: `${height}px`,
          // 最后一行短一些，视觉上更像文本段落
          width: i === lines - 1 && lines > 1 ? '62%' : '100%',
        },
      }),
    );
  }
  return root;
}

/**
 * 空态。**空数组必须走这里，而不是被静默当成"没有内容"的空白**。
 *
 * @param {Object} options
 * @param {string} [options.title]
 * @param {string} [options.hint]
 * @param {Node[]|Node} [options.action]  可选操作（如「刷新」按钮）
 * @param {Node} [options.icon]
 * @returns {HTMLElement}
 */
export function EmptyState({ title, hint, action, icon } = {}) {
  const root = el('div', { class: 'hz-state hz-state--empty', role: 'status' });
  const iconBox = el('div', { class: 'hz-state__icon' });
  iconBox.appendChild(icon || Icon('inbox', { size: 28 }));
  root.appendChild(iconBox);
  root.appendChild(el('p', { class: 'hz-state__title', text: title ?? STRINGS.emptyTitle }));
  if (hint) root.appendChild(el('p', { class: 'hz-state__hint', text: hint }));
  if (action) {
    const actionBox = el('div', { class: 'hz-state__action' });
    appendChildren(actionBox, action);
    root.appendChild(actionBox);
  }
  return root;
}

/**
 * 错误态。**错误必须可见**：message 原样展示服务端/网络错误文本，
 * 并提供 retry 回调；不需要静默降级成空列表。
 *
 * @param {Object} options
 * @param {string} options.message        错误文本（来自 data-layer 的 error.message）
 * @param {Function} [options.retry]      重试回调；给出则渲染重试按钮
 * @param {string} [options.title]        标题，默认「加载失败」
 * @param {string} [options.hint]         补充说明
 * @returns {HTMLElement}
 */
export function ErrorState({ message, retry, title, hint } = {}) {
  const root = el('div', { class: 'hz-state hz-state--error', role: 'alert' });
  const iconBox = el('div', { class: 'hz-state__icon' });
  iconBox.appendChild(Icon('alert', { size: 28 }));
  root.appendChild(iconBox);
  root.appendChild(el('p', { class: 'hz-state__title', text: title ?? STRINGS.errorTitle }));
  root.appendChild(el('p', { class: 'hz-state__message', text: display(message) }));
  if (hint) root.appendChild(el('p', { class: 'hz-state__hint', text: hint }));
  if (typeof retry === 'function') {
    const actionBox = el('div', { class: 'hz-state__action' });
    actionBox.appendChild(Button({ label: STRINGS.retry, variant: 'outline', onClick: retry }));
    root.appendChild(actionBox);
  }
  return root;
}

/**
 * 按钮。
 *
 * @param {Object} options
 * @param {string} options.label
 * @param {'primary'|'outline'|'ghost'|'danger'} [options.variant]
 * @param {Function} [options.onClick]
 * @param {boolean} [options.disabled]
 * @param {boolean} [options.busy]      显示 spinner 并禁用（进行中）
 * @param {Node} [options.icon]
 * @param {string} [options.title]      悬停提示
 * @param {'button'|'submit'} [options.type]
 * @returns {HTMLButtonElement}
 */
export function Button({
  label,
  variant = 'outline',
  onClick,
  disabled,
  busy,
  icon,
  title,
  type = 'button',
} = {}) {
  const btn = el('button', {
    class: `hz-btn hz-btn--${variant}`,
    type,
    title: title ?? null,
    'aria-busy': busy ? 'true' : null,
    disabled: disabled || busy ? true : null,
  });

  if (busy) {
    btn.appendChild(el('span', { class: 'hz-btn__spinner', 'aria-hidden': 'true' }));
  } else if (icon) {
    btn.appendChild(icon);
  }
  btn.appendChild(el('span', { class: 'hz-btn__label', text: display(label) }));

  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  return btn;
}

/**
 * 按钮组（分段控件 / 工具条）。仅做布局，不含业务逻辑。
 * @param {Node[]} children
 * @param {{class?: string}} [options]
 * @returns {HTMLElement}
 */
export function ButtonGroup(children, { class: extraClass } = {}) {
  const root = el('div', {
    class: ['hz-btn-group', extraClass || ''].filter(Boolean).join(' '),
    role: 'group',
  });
  appendChildren(root, children);
  return root;
}

/**
 * 表格。head 为字符串数组，rows 为二维数组（每格是 Node 或可显示值）。
 *
 * @param {Object} options
 * @param {string[]} options.head
 * @param {Array<Array<Node|string|number>>} options.rows
 * @param {string[]} [options.align]   每列对齐 'left'|'right'|'center'
 * @param {string} [options.empty]     无行时的占位文案
 * @param {string} [options.class]
 * @returns {HTMLElement}
 */
export function Table({ head = [], rows = [], align = [], empty, class: extraClass } = {}) {
  const wrap = el('div', { class: ['hz-table-wrap', extraClass || ''].filter(Boolean).join(' ') });

  if (rows.length === 0) {
    wrap.appendChild(el('p', { class: 'hz-table__empty', text: empty ?? STRINGS.tableEmpty }));
    return wrap;
  }

  const table = el('table', { class: 'hz-table' });

  if (head.length > 0) {
    const thead = el('thead');
    const tr = el('tr');
    head.forEach((label, index) => {
      tr.appendChild(
        el('th', {
          class: `hz-table__th hz-table__cell--${align[index] || 'left'}`,
          text: label,
          scope: 'col',
        }),
      );
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  const tbody = el('tbody');
  rows.forEach((cells) => {
    const tr = el('tr', { class: 'hz-table__row' });
    cells.forEach((cell, index) => {
      const td = el('td', { class: `hz-table__td hz-table__cell--${align[index] || 'left'}` });
      if (cell instanceof Node) {
        td.appendChild(cell);
      } else {
        td.textContent = display(cell);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/**
 * 列表行（键值对 / 带操作的行）。cells 里每项可以是 Node 或值。
 * 语义上是「一行」的通用容器，供表格之外的列表布局复用。
 *
 * @param {Object} options
 * @param {Array<Node|string|number>} options.cells
 * @param {Node[]} [options.actions]  行尾操作
 * @param {string} [options.tone]     'ok'|'warn'|'error'|'idle' 左侧强调条
 * @param {string} [options.class]
 * @returns {HTMLElement}
 */
export function Row({ cells = [], actions, tone, class: extraClass } = {}) {
  const root = el('div', {
    class: ['hz-row', tone ? `hz-row--${tone}` : '', extraClass || ''].filter(Boolean).join(' '),
  });

  const main = el('div', { class: 'hz-row__cells' });
  cells.forEach((cell) => {
    const box = el('div', { class: 'hz-row__cell' });
    if (cell instanceof Node) box.appendChild(cell);
    else box.textContent = display(cell);
    main.appendChild(box);
  });
  root.appendChild(main);

  if (actions) {
    const actionBox = el('div', { class: 'hz-row__actions' });
    appendChildren(actionBox, actions);
    root.appendChild(actionBox);
  }
  return root;
}

/**
 * 键值明细列表（「标签 : 值」）。
 * 用于 system / runtime 这类扁平字段展示。
 *
 * @param {Array<{label: string, value: Node|string|number, title?: string}>} items
 * @returns {HTMLElement}
 */
export function KeyValueList(items = []) {
  const root = el('dl', { class: 'hz-kv' });
  for (const item of items) {
    if (!item) continue;
    const rowEl = el('div', { class: 'hz-kv__row' });
    rowEl.appendChild(el('dt', { class: 'hz-kv__key', text: display(item.label) }));
    const dd = el('dd', { class: 'hz-kv__value', title: item.title ?? null });
    if (item.value instanceof Node) dd.appendChild(item.value);
    else dd.textContent = display(item.value);
    rowEl.appendChild(dd);
    root.appendChild(rowEl);
  }
  return root;
}

/**
 * 开关（受控）。当前状态由 checked 决定，切换时把**新值**交给 onChange。
 * 组件自己不改状态 —— 状态必须由调用方（通常是 Resource / 本地 UI 状态）驱动。
 *
 * @param {Object} options
 * @param {boolean} options.checked
 * @param {(next: boolean) => void} [options.onChange]
 * @param {string} [options.label]    无障碍标签
 * @param {boolean} [options.disabled]
 * @returns {HTMLElement}
 */
export function Toggle({ checked = false, onChange, label, disabled } = {}) {
  const root = el('button', {
    class: `hz-toggle${checked ? ' hz-toggle--on' : ''}`,
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label ?? null,
    title: label ?? null,
    disabled: disabled ? true : null,
  });
  root.appendChild(el('span', { class: 'hz-toggle__thumb' }));
  if (typeof onChange === 'function') {
    root.addEventListener('click', () => onChange(!checked));
  }
  return root;
}

/**
 * 进度条。value/max 都来自真实数据（如 databaseMigration.progress）。
 * 传入非有限数值时渲染不确定态（无填充），**不猜一个百分比**。
 *
 * @param {Object} options
 * @param {number} options.value
 * @param {number} [options.max]
 * @param {'ok'|'warn'|'error'} [options.tone]
 * @param {boolean} [options.showLabel]
 * @returns {HTMLElement}
 */
export function ProgressBar({ value, max = 100, tone, showLabel } = {}) {
  const root = el('div', { class: 'hz-progress' });
  const numValue = Number(value);
  const numMax = Number(max);
  const determinate = Number.isFinite(numValue) && Number.isFinite(numMax) && numMax > 0;
  const percent = determinate ? Math.min(100, Math.max(0, (numValue / numMax) * 100)) : 0;

  const track = el('div', {
    class: ['hz-progress__track', tone ? `hz-progress__track--${tone}` : ''].filter(Boolean).join(' '),
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': determinate ? String(numMax) : null,
    'aria-valuenow': determinate ? String(numValue) : null,
    'aria-valuetext': determinate ? STRINGS.progressLabel({ value: numValue, max: numMax }) : null,
  });
  track.appendChild(el('span', { class: 'hz-progress__fill', style: { width: `${percent}%` } }));
  root.appendChild(track);

  if (showLabel && determinate) {
    root.appendChild(el('span', { class: 'hz-progress__label', text: `${percent.toFixed(0)}%` }));
  }
  return root;
}

/**
 * 提示气泡（可选组件）。用原生 title 之外的可见浮层。
 * 为保持原子性，这里只做「内容包装 + 悬停显示」，不做定位计算。
 *
 * @param {Object} options
 * @param {string} options.text
 * @param {Node|string} options.children
 * @returns {HTMLElement}
 */
export function Tooltip({ text, children } = {}) {
  const root = el('span', { class: 'hz-tooltip' });
  const trigger = el('span', { class: 'hz-tooltip__trigger', tabindex: '0' });
  if (children instanceof Node) trigger.appendChild(children);
  else trigger.textContent = display(children);
  root.appendChild(trigger);
  root.appendChild(el('span', { class: 'hz-tooltip__bubble', role: 'tooltip', text: display(text) }));
  return root;
}

/* ========================================================================== *
 * 状态视图 —— 服务端加载状态驱动的统一渲染入口
 * ========================================================================== *
 * 这是「按服务端状态驱动」约束的落地点：
 *   idle    → 什么都不渲染（还没开始请求）
 *   loading → Spinner（若有上次成功数据，则保留数据并叠加"刷新中"提示）
 *   error   → ErrorState（**必须可见**；有旧数据时同时显示旧数据 + 明确标注已过期）
 *   ready   → render(data)
 *   ready 且 data 为空 → EmptyState（除非提供了 isEmpty 判定）
 * 调用方永远不需要自己写 if/else 分支，也就不会漏掉 error。
 */

/**
 * @param {Object} options
 * @param {import('./data-layer.js').Resource} options.resource  数据源
 * @param {(data: any) => Node|Node[]} options.render            成功态渲染
 * @param {(data: any) => boolean} [options.isEmpty]             判定空态
 * @param {string} [options.emptyTitle]
 * @param {string} [options.emptyHint]
 * @param {Node[]|Node} [options.emptyAction]
 * @param {string} [options.loadingLabel]
 * @param {Function} [options.onRetry]    默认用 resource.retry
 * @returns {HTMLElement}
 */
export function stateView({
  resource,
  render,
  isEmpty,
  emptyTitle,
  emptyHint,
  emptyAction,
  loadingLabel,
  onRetry,
} = {}) {
  const root = el('div', { class: 'hz-stateview' });
  const snapshot = resource ? resource.get() : { status: 'idle', data: null, error: null };

  const drawReady = (data, stale) => {
    const empty = typeof isEmpty === 'function' ? isEmpty(data) : Array.isArray(data) && data.length === 0;
    if (empty) {
      root.appendChild(EmptyState({ title: emptyTitle, hint: emptyHint, action: emptyAction }));
      return;
    }
    if (stale) {
      root.appendChild(
        el('p', {
          class: 'hz-stale',
          role: 'status',
          text: STRINGS.staleNotice,
        }),
      );
    }
    appendChildren(root, render(data));
  };

  switch (snapshot.status) {
    case 'loading':
      // 首次加载：只有 spinner。已有旧数据时：保留数据 + 顶部提示（避免闪烁）。
      if (snapshot.data !== null && snapshot.data !== undefined) {
        drawReady(snapshot.data, false);
        root.insertBefore(
          el('p', { class: 'hz-refreshing', role: 'status', text: loadingLabel ?? STRINGS.loading }),
          root.firstChild,
        );
      } else {
        root.appendChild(Spinner({ label: loadingLabel ?? STRINGS.loading }));
      }
      break;

    case 'error': {
      const message = snapshot.error ? snapshot.error.message : STRINGS.unknown;
      // 有旧数据：错误条 + 旧数据（明确标注过期），信息不丢失。
      if (snapshot.data !== null && snapshot.data !== undefined) {
        root.appendChild(
          ErrorState({
            message,
            retry: onRetry ?? (resource ? () => resource.retry() : undefined),
            hint: STRINGS.staleHint,
          }),
        );
        drawReady(snapshot.data, false);
      } else {
        root.appendChild(
          ErrorState({
            message,
            retry: onRetry ?? (resource ? () => resource.retry() : undefined),
          }),
        );
      }
      break;
    }

    case 'ready':
      drawReady(snapshot.data, false);
      break;

    case 'idle':
    default:
      // 还没请求过：留空，等 Resource.load() 触发状态变化。
      break;
  }

  return root;
}

/**
 * 把一组 Resource 的加载状态合并成一个「整页」状态，用于页面级骨架判断。
 * 规则：只要有一个 error → 'error'；否则有 loading → 'loading'；
 *       全部 ready → 'ready'；否则 'idle'。
 *
 * @param {Array<import('./data-layer.js').Resource>} resources
 * @returns {'idle'|'loading'|'ready'|'error'}
 */
export function combineStatus(resources = []) {
  let sawLoading = false;
  let sawIdle = false;
  for (const resource of resources) {
    if (!resource) continue;
    const { status } = resource.get();
    if (status === 'error') return 'error';
    if (status === 'loading') sawLoading = true;
    if (status === 'idle') sawIdle = true;
  }
  if (sawLoading) return 'loading';
  if (sawIdle) return 'idle';
  return 'ready';
}

/* ========================================================================== *
 * 复合原子
 * ========================================================================== */

/**
 * 网格容器。
 * @param {Node[]} children
 * @param {{cols?: number, min?: string, gap?: string, class?: string}} [options]
 * @returns {HTMLElement}
 */
export function Grid(children, { cols, min = '220px', gap = '12px', class: extraClass } = {}) {
  const style = { gap };
  if (cols) style['grid-template-columns'] = `repeat(${cols}, minmax(0, 1fr))`;
  else style['grid-template-columns'] = `repeat(auto-fill, minmax(${min}, 1fr))`;

  const root = el('div', {
    class: ['hz-grid', extraClass || ''].filter(Boolean).join(' '),
    style,
  });
  appendChildren(root, children);
  return root;
}

/**
 * 堆叠容器（纵向排列）。
 * @param {Node[]} children
 * @param {{gap?: string, class?: string}} [options]
 * @returns {HTMLElement}
 */
export function Stack(children, { gap = '16px', class: extraClass } = {}) {
  const root = el('div', {
    class: ['hz-stack', extraClass || ''].filter(Boolean).join(' '),
    style: { gap },
  });
  appendChildren(root, children);
  return root;
}

/**
 * 区块小标题（卡片内部分组）。
 * @param {string} text
 * @param {Node[]} [actions]
 * @returns {HTMLElement}
 */
export function SectionTitle(text, actions) {
  const root = el('div', { class: 'hz-section-title' });
  root.appendChild(el('h3', { class: 'hz-section-title__text', text: display(text) }));
  if (actions) {
    const box = el('div', { class: 'hz-section-title__actions' });
    appendChildren(box, actions);
    root.appendChild(box);
  }
  return root;
}

/**
 * 头像占位（首字母/首二字）。WebUI 的头像接口是 `GET /avatar/:uin`，
 * 但它需要 Cookie 会话，本层不擅自拉取图片，只渲染文字占位，
 * 由宿主决定是否替换成 <img>。
 *
 * @param {{uin?: string, nickname?: string, size?: number}} options
 * @returns {HTMLElement}
 */
export function Avatar({ uin, nickname, size = 36 } = {}) {
  const seed = display(nickname) !== STRINGS.empty ? String(nickname) : String(uin ?? '');
  const initials = seed.slice(0, 2) || '?';
  return el('span', {
    class: 'hz-avatar',
    style: { width: `${size}px`, height: `${size}px`, 'font-size': `${Math.round(size * 0.36)}px` },
    title: uin ? `QQ ${uin}` : null,
    text: initials,
    'aria-hidden': 'true',
  });
}