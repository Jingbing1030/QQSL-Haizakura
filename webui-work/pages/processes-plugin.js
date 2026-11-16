/**
 * processes-plugin.js — 「进程」页（插件化组装）
 * =============================================================================
 * 数据源（全部为真实 API，已在生产容器内实测）
 * -----------------------------------------------------------------------------
 *   GET  /api/processes                 → { list: [processInfo] }
 *   POST /api/processes/:pid/load       → { success, process }
 *   POST /api/processes/:pid/unload     → { success, process }
 *   POST /api/processes/:pid/refresh    → { success, process }
 *
 * processInfo 实测结构：
 * {
 *   "pid": 79,
 *   "name": "qq",              // 进程名
 *   "path": "",                // 可执行文件路径（Linux 上可能为空）
 *   "injected": true,          // Haizakura 注入是否在位
 *   "connected": true,         // 与 QQ 的管道是否连上
 *   "loggedIn": true,          // 账号是否已登录
 *   "uin": "3254926145",       // 已登录 QQ 号（"0" 表示未识别）
 *   "status": "online",        // 见下方枚举
 *   "error": "",               // 出错原因（status==="error" 时非空）
 *   "method": "reconnect",     // 注入/连接方式
 *   "account": { "uin": "3254926145", "nickname": "碧海" } | null
 * }
 *
 * status 枚举（源码 statusFor() + HookSession 的带外状态）：
 *   available     未注入 → 可加载
 *   loading       注入进行中
 *   connecting    已注入，等待连接
 *   loaded        已连接，等待登录
 *   online        已连接且已登录
 *   disconnected  曾登录，当前断开
 *   error         出错（error 字段带原因）
 *
 * 与现有进程页（reference/processes-page-DTL34wKX.js）的对照
 * -----------------------------------------------------------------------------
 * 现有页面的列：`[{id:'pid',label:'PID'}, {id:'name',label:'名称'},
 *               {id:'status',label:'状态'}]` —— 用于**排序**（不是表格列）。
 * 每张进程卡展示：头像/图标、显示名（昵称 > uin > name）、状态徽章、
 *   `PID {pid}` + `· QQ {uin}`、path、error；
 * 每张卡的操作：刷新管道状态（refresh）、加载/卸载（load/unload，带确认对话框）。
 *
 * 状态文案（现有页面 j 映射，本文件保持一致）：
 *   available→可加载、loading→加载中、connecting→等待连接、loaded→等待登录、
 *   online→已在线、error→错误、disconnected→已断开
 * 状态徽章颜色（现有页面 M() 映射）：
 *   online→success、error/disconnected→destructive、
 *   loading/connecting/loaded→default、其他→secondary
 *
 * 本页以**表格**呈现（列 = PID / 名称 / 状态 / 账号 / 路径 / 操作），
 * 信息密度不低于卡片布局，同时便于多进程对比；卡片式详情作为展开行保留。
 *
 * @module processes-plugin
 */

import {
  Card,
  Badge,
  Spinner,
  EmptyState,
  ErrorState,
  Button,
  ButtonGroup,
  Table,
  Toggle,
  Icon,
  Avatar,
  el,
  display,
  formatTime,
  STRINGS as A,
} from './atoms.js';

import {
  createProcessesResource,
  createProcessActionResource,
  PROCESS_ACTIONS,
} from './data-layer.js';

import { createResourcePlugin, definePlugin, registerPlugin, mountAll, createContext } from './plugin.js';

/* ========================================================================== *
 * STRINGS — 本页全部用户可见文案
 * ========================================================================== */

export const STRINGS = {
  /* ---- 页面 ---- */
  pageTitle: '进程',
  pageHint: '加载后，已登录账号将自动接入 OneBot',
  refreshAll: '刷新',

  /* ---- 状态文案（对齐现有进程页的 j 映射） ---- */
  status: {
    available: '可加载',
    loading: '加载中',
    connecting: '等待连接',
    loaded: '等待登录',
    online: '已在线',
    error: '错误',
    disconnected: '已断开',
  },

  /* ---- 状态 → tone ---- */
  statusTone: {
    online: 'ok',
    error: 'error',
    disconnected: 'error',
    loading: 'busy',
    connecting: 'busy',
    loaded: 'warn',
    available: 'idle',
  },

  /* ---- 表格列 ---- */
  colPid: 'PID',
  colName: '名称',
  colStatus: '状态',
  colAccount: '账号',
  colPath: '路径',
  colActions: '操作',

  /* ---- 排序 ---- */
  sortLabel: '排序方式',
  sortPid: 'PID',
  sortName: '名称',
  sortStatus: '状态',

  /* ---- 行内文案 ---- */
  pidText: ({ pid }) => `PID ${pid}`,
  qqText: ({ uin }) => `QQ ${uin}`,
  unknownAccount: '未识别账号',
  noPath: '—',

  /* ---- 操作按钮 ---- */
  actionLoad: '加载',
  actionUnload: '卸载',
  actionRefresh: '刷新管道',
  actionLoading: '加载中',
  actionUnloading: '卸载中',
  actionRefreshing: '刷新中',
  actionRefreshTitle: '刷新管道状态 / 重连',
  actionRefreshAria: ({ pid }) => `刷新进程 ${pid} 的管道状态`,

  /* ---- 确认对话框 ---- */
  confirmLoadTitle: '确认加载 Haizakura？',
  confirmLoadBody: ({ name }) => `将向进程 ${name} 注入 Haizakura，并开始监听登录状态。`,
  confirmUnloadTitle: '确认卸载 Haizakura？',
  confirmUnloadBody: ({ name }) => `将从进程 ${name} 卸载 Haizakura 注入，可能导致当前会话断开。`,
  confirmLoadOk: '加载',
  confirmUnloadOk: '卸载',
  dialogClose: '关闭',

  /* ---- 空态 / 错误态 ---- */
  emptyTitle: '未检测到可加载 QQ 主进程',
  emptyHint: '启动 QQ 后刷新',
  errorTitle: '进程列表加载失败',

  /* ---- 操作反馈 ---- */
  opRunning: ({ name, action }) => `正在${action}：${name}`,
  opSucceeded: ({ name, action }) => `${action}成功：${name}`,
  opFailed: ({ name, action, message }) => `${action}失败：${name} — ${message}`,
  staleNotice: '刷新失败，以下为上次成功读取的进程状态',
  updatedAt: ({ time }) => `更新于 ${time}`,
  autoRefresh: '自动刷新',
  autoRefreshInterval: ({ seconds }) => `每 ${seconds} 秒`,
  dataSourceNote: '数据来源：GET /api/processes；操作：POST /api/processes/:pid/{load,unload,refresh}',
};

/* ========================================================================== *
 * 常量
 * ========================================================================== */

/**
 * 排序权重（对齐现有进程页的 A 常量）：状态越"靠前"越需要关注。
 * online < loaded < connecting < loading < available < disconnected < error
 */
export const STATUS_ORDER = {
  online: 0,
  loaded: 1,
  connecting: 2,
  loading: 3,
  available: 4,
  disconnected: 5,
  error: 6,
};

/** 后端 status 枚举（用于未知值兜底显示） */
export const PROCESS_STATUSES = Object.keys(STRINGS.status);

/* ========================================================================== *
 * 纯函数：派生与排序
 * ========================================================================== */

/**
 * 进程的展示名：昵称 > QQ 号 > 进程名 > `PID n`。
 * 与现有页面一致：优先 account.nickname / account.uin（服务端确认的身份），
 * 其次 loggedIn 时的 uin，最后回落到 name。
 * @param {Object} proc
 * @returns {string}
 */
export function processDisplayName(proc) {
  if (!proc) return A.empty;
  const account = proc.account;
  if (account && account.nickname) return String(account.nickname);
  if (account && account.uin && account.uin !== '0') return String(account.uin);
  if (proc.loggedIn && proc.uin && proc.uin !== '0') return String(proc.uin);
  if (proc.name) return String(proc.name);
  return STRINGS.pidText({ pid: proc.pid });
}

/**
 * 进程对应的 QQ 号：账号里的 uin 优先，其次进程 uin。
 * 服务端未识别时 uin 为 `"0"`，此时返回空串（不显示假的 0）。
 * @param {Object} proc
 * @returns {string}
 */
export function processUin(proc) {
  if (!proc) return '';
  const accountUin = proc.account && proc.account.uin ? String(proc.account.uin) : '';
  if (accountUin && accountUin !== '0') return accountUin;
  const uin = proc.uin ? String(proc.uin) : '';
  return uin === '0' ? '' : uin;
}

/**
 * 状态文案。未知状态原样显示（不猜成"正常"）。
 * @param {string} status
 * @returns {string}
 */
export function statusText(status) {
  return STRINGS.status[status] || display(status);
}

/**
 * 状态 tone。
 * @param {string} status
 */
export function statusTone(status) {
  return STRINGS.statusTone[status] || 'idle';
}

/**
 * 某个进程当前允许的操作。规则与现有页面一致：
 *   - injected === true  → 可卸载（unload）；可刷新（refresh）
 *   - injected === false  → 可加载（load）
 *   - 注入相关中间态（loading / connecting / disconnected）→ 可刷新
 *   - online / loaded    → 可刷新 + 可卸载
 * 实时状态为 loading 时全部禁用（服务端正在处理）。
 *
 * @param {Object} proc
 * @returns {{canLoad: boolean, canUnload: boolean, canRefresh: boolean}}
 */
export function processActions(proc) {
  if (!proc) return { canLoad: false, canUnload: false, canRefresh: false };
  const injected = proc.injected === true;
  const busy = proc.status === 'loading';
  // 现有页面：「刷新」按钮在 injected || connecting || disconnected 时显示
  const refreshable =
    injected || proc.status === 'connecting' || proc.status === 'disconnected';
  return {
    canLoad: !injected && !busy,
    canUnload: injected && !busy,
    canRefresh: refreshable && !busy,
  };
}

/**
 * 排序进程列表。默认按 pid 升序（对齐现有页面的 processesSort 默认值 'pid'）。
 *
 * @param {Array} list
 * @param {'pid'|'name'|'status'} sortBy
 * @returns {Array} 新数组（不修改入参）
 */
export function sortProcesses(list, sortBy = 'pid') {
  const copy = Array.isArray(list) ? list.slice() : [];
  if (sortBy === 'name') {
    copy.sort((a, b) => processDisplayName(a).localeCompare(processDisplayName(b)));
  } else if (sortBy === 'status') {
    copy.sort(
      (a, b) =>
        (STATUS_ORDER[a?.status] ?? 99) - (STATUS_ORDER[b?.status] ?? 99) ||
        (a?.pid ?? 0) - (b?.pid ?? 0),
    );
  } else {
    copy.sort((a, b) => (a?.pid ?? 0) - (b?.pid ?? 0));
  }
  return copy;
}

/* ========================================================================== *
 * 确认对话框（原生 <dialog>，零依赖）
 * ========================================================================== */

/**
 * 打开一个确认对话框。返回 Promise<boolean>。
 * 使用原生 <dialog>，自带焦点陷阱与 Esc 关闭。
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} options.confirmText
 * @param {boolean} [options.destructive]
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmText, destructive = false }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'hz-dialog' });

    const form = el('div', { class: 'hz-dialog__panel' });
    form.appendChild(el('h2', { class: 'hz-dialog__title', text: title }));
    form.appendChild(el('p', { class: 'hz-dialog__body', text: body }));

    const actions = el('div', { class: 'hz-dialog__actions' });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (dialog.open) dialog.close();
      dialog.remove();
    };

    actions.appendChild(
      Button({ label: A.cancel, variant: 'ghost', onClick: () => finish(false) }),
    );
    actions.appendChild(
      Button({
        label: confirmText,
        variant: destructive ? 'danger' : 'primary',
        onClick: () => finish(true),
      }),
    );
    form.appendChild(actions);
    dialog.appendChild(form);

    // 点遮罩关闭 = 取消
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });
    // Esc / 浏览器关闭
    dialog.addEventListener('close', () => {
      if (!settled) {
        settled = true;
        resolve(false);
        dialog.remove();
      }
    });

    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
}

/* ========================================================================== *
 * 渲染
 * ========================================================================== */

/**
 * 渲染操作反馈条（进行中 / 成功 / 失败）。**失败必须可见**。
 * @param {Object|null} feedback
 * @returns {HTMLElement}
 */
export function renderFeedback(feedback) {
  if (!feedback) return el('div', { class: 'hz-feedback hz-feedback--hidden' });

  const tone = feedback.tone || 'idle'; // 'busy' | 'ok' | 'error'
  const box = el('div', { class: `hz-feedback hz-feedback--${tone}`, role: tone === 'error' ? 'alert' : 'status' });

  if (tone === 'busy') {
    box.appendChild(Spinner({ label: feedback.text, inline: true, size: 13 }));
  } else {
    box.appendChild(el('span', { class: 'hz-feedback__text', text: feedback.text }));
  }

  if (feedback.onDismiss) {
    box.appendChild(
      Button({
        label: A.close,
        variant: 'ghost',
        onClick: feedback.onDismiss,
      }),
    );
  }
  return box;
}

/**
 * 渲染单个进程行的操作按钮组。
 *
 * @param {Object} proc
 * @param {Object} handlers
 * @param {Object} opState  当前进行中的操作：{ [pid]: {action} }
 * @returns {HTMLElement}
 */
export function renderRowActions(proc, handlers, opState = {}) {
  const { canLoad, canUnload, canRefresh } = processActions(proc);
  const running = opState[proc.pid];
  const busy = Boolean(running);
  const group = el('div', { class: 'hz-row-actions' });

  if (canRefresh) {
    const isRefreshing = running?.action === 'refresh';
    group.appendChild(
      Button({
        label: isRefreshing ? STRINGS.actionRefreshing : STRINGS.actionRefresh,
        variant: 'ghost',
        icon: Icon('refresh', { size: 13 }),
        busy: isRefreshing,
        disabled: busy,
        title: STRINGS.actionRefreshTitle,
        onClick: () => handlers.onRefresh?.(proc),
      }),
    );
  }

  if (proc.injected === true) {
    const isUnloading = running?.action === 'unload';
    group.appendChild(
      Button({
        label: isUnloading ? STRINGS.actionUnloading : STRINGS.actionUnload,
        variant: 'danger',
        icon: Icon('unplug', { size: 13 }),
        busy: isUnloading,
        disabled: (busy && !isUnloading) || !canUnload,
        onClick: () => handlers.onUnload?.(proc),
      }),
    );
  } else {
    const isLoading = running?.action === 'load';
    group.appendChild(
      Button({
        label: isLoading ? STRINGS.actionLoading : STRINGS.actionLoad,
        variant: 'primary',
        busy: isLoading,
        disabled: (busy && !isLoading) || !canLoad,
        onClick: () => handlers.onLoad?.(proc),
      }),
    );
  }

  return group;
}

/**
 * 渲染进程表。
 *
 * @param {Object} snapshot   processes Resource 的快照
 * @param {Object} options
 * @param {'pid'|'name'|'status'} options.sortBy
 * @param {Object} options.handlers
 * @param {Object} options.opState
 * @returns {HTMLElement}
 */
export function renderProcessTable(snapshot, { sortBy = 'pid', handlers = {}, opState = {} } = {}) {
  const list = Array.isArray(snapshot.data) ? snapshot.data : [];

  /* ---- loading（首次） ---- */
  if (snapshot.status === 'loading' && list.length === 0) {
    return el('div', { class: 'hz-pad' }, [Spinner({ label: A.loading })]);
  }

  /* ---- error（无旧数据） ---- */
  if (snapshot.error && list.length === 0) {
    return el('div', { class: 'hz-pad' }, [
      ErrorState({
        message: snapshot.error.message,
        retry: handlers.onRetry,
        title: STRINGS.errorTitle,
      }),
    ]);
  }

  /* ---- empty ---- */
  if (snapshot.data !== null && list.length === 0) {
    return el('div', { class: 'hz-pad' }, [
      EmptyState({
        title: STRINGS.emptyTitle,
        hint: STRINGS.emptyHint,
        icon: Icon('cpu', { size: 28 }),
        action: [Button({ label: A.refresh, variant: 'outline', onClick: handlers.onRetry })],
      }),
    ]);
  }

  if (snapshot.data === null) {
    return el('div', { class: 'hz-pad' }, [Spinner({ label: A.loading })]);
  }

  const sorted = sortProcesses(list, sortBy);

  /* ---- 陈旧数据提示 ----
   * 「刷新失败但仍有上次成功数据」也是一种**必须可见**的错误态：
   * 这里同时渲染错误条与旧数据，绝不静默吞掉 error。
   * 放在渲染函数内部（而不是交给调用方），是为了让任何调用者都不会漏掉它。
   */
  const container = el('div', { class: 'hz-proc-view' });
  if (snapshot.error && list.length > 0) {
    container.appendChild(
      el('div', { class: 'hz-stale', role: 'alert' }, [
        el('span', { text: `${snapshot.error.message}；${STRINGS.staleNotice}` }),
        Button({ label: A.retry, variant: 'ghost', onClick: handlers.onRetry }),
      ]),
    );
  }

  const rows = sorted.map((proc) => {
    const uin = processUin(proc);
    const name = processDisplayName(proc);

    // 名称单元格：头像 + 显示名（昵称/uin/name）
    const nameCell = el('div', { class: 'hz-proc-name' });
    nameCell.appendChild(Avatar({ uin, nickname: proc.account?.nickname, size: 30 }));
    const nameText = el('div', { class: 'hz-proc-name__text' });
    nameText.appendChild(el('span', { class: 'hz-proc-name__main', text: name }));
    if (proc.account?.nickname && uin) {
      nameText.appendChild(el('span', { class: 'hz-proc-name__sub', text: STRINGS.qqText({ uin }) }));
    }
    nameCell.appendChild(nameText);

    // 状态单元格：徽章 +（error 时）原因文本
    const statusCell = el('div', { class: 'hz-proc-status' });
    statusCell.appendChild(
      Badge({ text: statusText(proc.status), tone: statusTone(proc.status), title: proc.status }),
    );
    if (proc.error) {
      statusCell.appendChild(
        el('span', { class: 'hz-proc-status__error', title: proc.error, text: proc.error }),
      );
    }
    // method 是服务端给的注入/连接方式，作为次要信息保留（信息密度）
    if (proc.method) {
      statusCell.appendChild(el('span', { class: 'hz-proc-status__method', text: proc.method }));
    }

    // 账号单元格
    const accountCell = el('div', { class: 'hz-proc-account' });
    if (uin) {
      accountCell.appendChild(el('span', { class: 'hz-proc-account__uin', text: uin }));
    } else {
      accountCell.appendChild(el('span', { class: 'hz-proc-account__none', text: STRINGS.unknownAccount }));
    }

    // 路径单元格
    const pathCell = el('span', {
      class: 'hz-proc-path',
      title: proc.path || null,
      text: proc.path ? String(proc.path) : STRINGS.noPath,
    });

    return [
      el('span', { class: 'hz-mono', text: String(proc.pid ?? A.empty) }),
      nameCell,
      statusCell,
      accountCell,
      pathCell,
      renderRowActions(proc, handlers, opState),
    ];
  });

  container.appendChild(
    Table({
      head: [
        STRINGS.colPid,
        STRINGS.colName,
        STRINGS.colStatus,
        STRINGS.colAccount,
        STRINGS.colPath,
        STRINGS.colActions,
      ],
      rows,
      align: ['right', 'left', 'left', 'left', 'left', 'right'],
      empty: STRINGS.emptyTitle,
    }),
  );
  return container;
}

/* ========================================================================== *
 * 插件
 * ========================================================================== */

/**
 * 进程页主插件。
 *
 * 状态管理要点：
 * - `processList`：GET /api/processes，页面唯一数据源
 * - `opState`：{ [pid]: { action } }，记录每个进程正在进行的操作
 * - `feedback`：最近一次操作的反馈（进行中 / 成功 / 失败），失败常驻直到手动关闭
 * - 自动刷新：默认 5 秒轮询（createPoller 遵守「隐藏标签页暂停」约定）
 *
 * 因为需要维护较多本地状态，这里手写 definePlugin 而非 createResourcePlugin。
 */
export function createProcessesPlugin() {
  /** 每次挂载的运行时状态 */
  let runtime = null;

  return definePlugin({
    id: 'processes.table',
    title: STRINGS.pageTitle,
    icon: 'plug',
    order: 10,
    description: '进程列表 + 加载/卸载/刷新管道（GET /api/processes + POST 操作）',

    mount(host, ctx) {
      const processList = ctx.resources.processList ?? createProcessesResource();

      const state = {
        sortBy: 'pid', // 对齐现有页面 pages.processesSort 默认值
        opState: {}, // pid → { action }
        feedback: null,
        autoRefresh: true,
      };

      /** 定时器与订阅句柄，unmount 时清理 */
      let unsubscribe = null;
      let pollTimer = null;

      /* ---------------- 渲染 ---------------- */

      const draw = () => {
        if (!runtime) return;
        while (host.firstChild) host.removeChild(host.firstChild);

        const snapshot = processList.get();
        const list = Array.isArray(snapshot.data) ? snapshot.data : [];

        /* ---- 卡片 ---- */
        const card = Card({
          title: STRINGS.pageTitle,
          hint: STRINGS.pageHint,
        });
        const body = card.querySelector('.hz-card__body');

        /* ---- 工具条：排序 / 自动刷新 / 手动刷新 ---- */
        const toolbar = el('div', { class: 'hz-toolbar' });

        // 排序分段控件（仅在多进程时显示，对齐现有页面的 length>1 判断）
        if (list.length > 1) {
          const sortGroup = el('div', {
            class: 'hz-segmented',
            role: 'radiogroup',
            'aria-label': STRINGS.sortLabel,
          });
          for (const [value, label] of [
            ['pid', STRINGS.sortPid],
            ['name', STRINGS.sortName],
            ['status', STRINGS.sortStatus],
          ]) {
            const active = state.sortBy === value;
            const btn = el('button', {
              class: `hz-segmented__item${active ? ' is-active' : ''}`,
              type: 'button',
              role: 'radio',
              'aria-checked': active ? 'true' : 'false',
              text: label,
            });
            btn.addEventListener('click', () => {
              state.sortBy = value;
              draw();
            });
            sortGroup.appendChild(btn);
          }
          toolbar.appendChild(sortGroup);
        }

        const spacer = el('div', { class: 'hz-toolbar__spacer' });
        toolbar.appendChild(spacer);

        // 自动刷新开关 + 间隔说明
        const autoLabel = el('label', { class: 'hz-inline-toggle' });
        autoLabel.appendChild(el('span', { text: STRINGS.autoRefresh }));
        autoLabel.appendChild(
          Toggle({
            checked: state.autoRefresh,
            label: STRINGS.autoRefresh,
            onChange: (next) => {
              state.autoRefresh = next;
              if (next) startPolling();
              else stopPolling();
              draw();
            },
          }),
        );
        autoLabel.appendChild(
          el('span', { class: 'hz-muted', text: STRINGS.autoRefreshInterval({ seconds: 5 }) }),
        );
        toolbar.appendChild(autoLabel);

        // 上次更新时间（来自 Resource.updatedAt，真实时间戳）
        if (snapshot.updatedAt > 0) {
          toolbar.appendChild(
            el('span', {
              class: 'hz-muted',
              text: STRINGS.updatedAt({ time: formatTime(snapshot.updatedAt) }),
            }),
          );
        }

        toolbar.appendChild(
          Button({
            label: STRINGS.refreshAll,
            variant: 'outline',
            icon: Icon('refresh', { size: 14 }),
            busy: snapshot.status === 'loading' && snapshot.data !== null,
            onClick: () => processList.refresh(),
          }),
        );

        body.appendChild(toolbar);

        /* ---- 反馈条 ---- */
        if (state.feedback) {
          body.appendChild(
            renderFeedback({
              ...state.feedback,
              onDismiss: () => {
                state.feedback = null;
                draw();
              },
            }),
          );
        }

        /* ---- 表格（陈旧数据提示由 renderProcessTable 内部负责，避免重复） ---- */
        body.appendChild(
          renderProcessTable(snapshot, {
            sortBy: state.sortBy,
            opState: state.opState,
            handlers: {
              onRetry: () => processList.retry(),
              onRefresh: (proc) => runAction(proc, 'refresh'),
              onLoad: (proc) => runAction(proc, 'load'),
              onUnload: (proc) => runAction(proc, 'unload'),
            },
          }),
        );

        /* ---- 页脚说明：数据来源（便于运维定位） ---- */
        body.appendChild(
          el('p', {
            class: 'hz-panel__note',
            text: STRINGS.dataSourceNote,
          }),
        );

        host.appendChild(card);
      };

      /* ---------------- 操作 ---------------- */

      /**
       * 执行一个进程操作。
       * load / unload 需要确认；refresh 直接执行（对齐现有页面）。
       *
       * @param {Object} proc
       * @param {'load'|'unload'|'refresh'} action
       */
      const runAction = async (proc, action) => {
        if (!runtime || state.opState[proc.pid]) return; // 防重复点击

        const name = processDisplayName(proc);

        if (action === 'load' || action === 'unload') {
          const ok = await confirmDialog({
            title: action === 'unload' ? STRINGS.confirmUnloadTitle : STRINGS.confirmLoadTitle,
            body:
              action === 'unload'
                ? STRINGS.confirmUnloadBody({ name })
                : STRINGS.confirmLoadBody({ name }),
            confirmText: action === 'unload' ? STRINGS.confirmUnloadOk : STRINGS.confirmLoadOk,
            destructive: action === 'unload',
          });
          if (!ok) return;
        }

        const actionLabel =
          action === 'load' ? STRINGS.actionLoad : action === 'unload' ? STRINGS.actionUnload : STRINGS.actionRefresh;

        state.opState[proc.pid] = { action };
        state.feedback = {
          tone: 'busy',
          text: STRINGS.opRunning({ name, action: actionLabel }),
        };
        draw();

        // 用操作型 Resource 承载状态机（成功后会把权威结果回写进 processList）
        const opResource = createProcessActionResource({
          name: `process:${proc.pid}:${action}`,
          pid: proc.pid,
          action,
          processList,
        });

        try {
          const result = await opResource.run();

          if (result.success) {
            state.feedback = {
              tone: 'ok',
              text: STRINGS.opSucceeded({ name, action: actionLabel }),
            };
            // 成功后 1.5 秒自动收起成功提示（错误提示则常驻）
            setTimeout(() => {
              if (runtime && state.feedback?.tone === 'ok') {
                state.feedback = null;
                draw();
              }
            }, 1500);
          } else {
            const message =
              (result.process && result.process.error) || result.message || A.unknown;
            state.feedback = {
              tone: 'error',
              text: STRINGS.opFailed({ name, action: actionLabel, message }),
            };
          }
        } catch (err) {
          state.feedback = {
            tone: 'error',
            text: STRINGS.opFailed({
              name,
              action: actionLabel,
              message: err instanceof Error ? err.message : String(err),
            }),
          };
        } finally {
          delete state.opState[proc.pid];
          // 操作完再拉一次列表，确保拿到服务端最新状态（操作结果可能影响其他字段）
          void processList.refresh();
          draw();
        }
      };

      /* ---------------- 轮询 ---------------- */

      const startPolling = () => {
        stopPolling();
        pollTimer = setInterval(() => {
          if (!runtime) return;
          if (!state.autoRefresh) return;
          // 有操作在进行时不要覆盖状态（避免按旧快照覆盖乐观更新）
          if (Object.keys(state.opState).length > 0) return;
          if (typeof document !== 'undefined' && document.hidden) return;
          void processList.refresh();
        }, 5000);
      };

      const stopPolling = () => {
        if (pollTimer !== null) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };

      /* ---------------- 启动 ---------------- */

      runtime = { host, ctx, processList, state };
      unsubscribe = processList.subscribe(() => draw());
      processList.load();
      startPolling();

      /* ---------------- 卸载 ---------------- */

      return () => {
        stopPolling();
        unsubscribe?.();
        processList.abort?.();
        runtime = null;
      };
    },

    unmount() {
      runtime = null;
    },

    refresh() {
      runtime?.processList?.refresh();
    },

    resources() {
      return runtime ? [runtime.processList] : [];
    },
  });
}

/** 单例（页面只挂一个进程插件） */
export const processesPlugin = createProcessesPlugin();

/* ========================================================================== *
 * 页面外壳
 * ========================================================================== */

/**
 * 进程页的共享数据源。与总览页共享同一 Resource 类型，
 * 但进程页独立创建（两页不会同时挂载，无需跨页共享）。
 * @returns {Object<string, import('./data-layer.js').Resource>}
 */
export function createProcessesResources() {
  return {
    processList: createProcessesResource(),
  };
}

/**
 * 注册进程页插件。
 * @param {Object} [registryApi] { registerPlugin }
 */
export function registerProcessesPlugins(registryApi) {
  const api = registryApi ?? { registerPlugin };
  try {
    api.registerPlugin(processesPlugin);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('插件 id 重复')) throw err;
  }
}

/**
 * 创建并组装「进程」页。
 *
 * 用法：
 *   const page = createProcessesPage();
 *   container.appendChild(page.root);
 *   ...
 *   page.destroy();
 *
 * @param {Object} [options]
 * @param {Object} [options.services]
 * @param {Object} [options.resources]
 * @param {Object[]} [options.plugins]  覆盖默认插件列表（便于扩展/裁剪）
 * @returns {{root: HTMLElement, ctx: Object, resources: Object,
 *            plugins: Object[], handle: Object,
 *            refreshAll: () => Promise<void>, destroy: () => void}}
 */
export function createProcessesPage({ services = {}, resources: injected, plugins } = {}) {
  const resources = injected ?? createProcessesResources();

  const root = el('div', { class: 'hz-page hz-page--processes' });

  /* ---- 页头 ---- */
  const header = el('header', { class: 'hz-page__head' });
  const titles = el('div', { class: 'hz-page__titles' });
  titles.appendChild(el('h1', { class: 'hz-page__title', text: STRINGS.pageTitle }));
  titles.appendChild(el('p', { class: 'hz-page__hint', text: STRINGS.pageHint }));
  header.appendChild(titles);

  header.appendChild(
    el('div', { class: 'hz-page__actions' }, [
      Button({
        label: STRINGS.refreshAll,
        variant: 'outline',
        icon: Icon('refresh', { size: 14 }),
        onClick: () => {
          void refreshAll();
        },
      }),
    ]),
  );
  root.appendChild(header);

  /* ---- 插件宿主 ---- */
  const pluginHost = el('div', { class: 'hz-page__plugins' });
  root.appendChild(pluginHost);

  /* ---- 挂载 ---- */
  const ctx = createContext({ root, resources, services });
  const list = plugins ?? [processesPlugin];
  const handle = mountAll(pluginHost, ctx, { plugins: list });

  const refreshAll = async () => {
    await Promise.allSettled(Object.values(resources).map((resource) => resource.refresh()));
  };

  const destroy = () => {
    handle.unmountAll();
    for (const resource of Object.values(resources)) resource.abort?.();
  };

  return { root, ctx, resources, plugins: list, handle, refreshAll, destroy };
}

/* ========================================================================== *
 * 默认导出
 * ========================================================================== */

export default {
  STRINGS,
  PROCESS_STATUSES,
  STATUS_ORDER,
  PROCESS_ACTIONS,
  // 纯函数
  processDisplayName,
  processUin,
  statusText,
  statusTone,
  processActions,
  sortProcesses,
  // 渲染
  renderProcessTable,
  renderRowActions,
  renderFeedback,
  confirmDialog,
  // 页面
  createProcessesResources,
  registerProcessesPlugins,
  createProcessesPage,
  processesPlugin,
  createProcessesPlugin,
};