/**
 * overview-plugin.js — 「总览」页（插件化组装）
 * =============================================================================
 * 页面 = 一组插件按 order 挂载。本文件包含：
 *   - 页面级共享数据源（overviewResources）：多个插件复用同一份 Resource，
 *     避免同一端点被重复请求（信息密度不降，请求数不涨）。
 *   - 若干「区块插件」：每个负责一块内容，各自独立订阅、独立错误呈现。
 *   - `registerOverviewPlugins()` / `createOverviewPage()`：注册表 + 组装入口。
 *
 * 信息密度对齐（与 reference/overview-page-CNwOieN2.js 逐项对照）
 * -----------------------------------------------------------------------------
 * 现有总览页（含部件库）共 9 个可见区块 + 4 个可选区块，指标项如下：
 *
 *  A. 5 个 KPI 指标卡（stat:*），每张 = 标签 + 主值 + 副标题：
 *     stat:status     「服务状态」  主值 运行中 / 否则显示原始 status
 *                                   副标 已连接到后端 / 请检查后端进程
 *                                   ← GET /api/status → { status:"running" }
 *     stat:accounts   「在线账号」  主值 list.length
 *                                   副标 已接入 N 个会话
 *                                   ← GET /api/qq-list → { list:[{uin,nickname}] }
 *     stat:processes  「进程注入」  主值 `${在线进程数} 在线`
 *                                   副标 `${总数} 进程 · ${可注入数} 可注入`
 *                                   可注入 = !injected 的条数
 *                                   ← GET /api/processes
 *     stat:host       「主机名」    主值 hostname
 *                                   副标 `${distro 简称} · ${archLabel}`
 *                                   详情 主机名 / 系统
 *                                   ← GET /api/system
 *     stat:uptime     「系统运行」  主值 formatDuration(uptime)
 *                                   副标 `进程 ${formatDuration(processUptime)}`
 *                                   详情 系统运行 / Haizakura 进程
 *                                   ← GET /api/system
 *
 *  B. host 区块「主机资源」，三张子卡：
 *     CPU 使用率   → cpu.average（%）+ 每核 perCore[] 方块 + loadAvg 三个值
 *     内存使用     → memory.usagePercent + 堆叠条：本进程(runtime.rss) /
 *                    其他已用(memory.used - runtime.rss) / 空闲(memory.free)
 *     运行进程     → runtime.pid + RSS / 堆内存(heapUsed / heapTotal) / 外部内存
 *     副标题       → `${cpu.model} · ${cpu.cores} 核 · Node ${nodeVersion}`
 *
 *  C. connections 区块「OneBot 连接」：
 *     每账号一行：昵称 + uin + 每个 adapter 一条（状态徽章 + name + kind + detail
 *     + lastError/lastErrorAt），以及 databaseMigration 进度条与剩余时间估算。
 *     adapter.kind 中文：httpServer→HTTP 服务端、httpClient→HTTP 上报、
 *                        wsServer→WS 服务端、wsClient→WS 客户端、
 *                        satoriServer/satoriClient→Satori 服务端/客户端
 *     adapter.status 中文：ok→正常、warn→注意、down→异常、
 *                          degraded→应用失败、disabled→未启用
 *     migration.phase 文案：preparing→正在准备数据库，账号暂不可用、
 *                           failed→(usable? 历史数据迁移失败，账号功能可用
 *                                          : 数据库准备失败，账号暂不可用)、
 *                           其他→正在后台迁移历史数据，账号功能可用
 *
 *  D. sessions 区块「在线会话」：昵称 + uin + 在线小圆点（← /api/qq-list）
 *
 *  E. alerts 区块「最近告警」：最近 N 条日志（level/scope/message/time）
 *     ← 现有实现用 GET /api/logs + /api/logs/stream；本页按任务约定改用
 *       GET /api/notifications/recent（通知投递记录）作为「最近通知」数据源，
 *       并在同一卡片内并列展示 /api/logs 的最近告警，两者都不丢。
 *
 * 现有页面还有 note / link / account / deliveries 四个**默认隐藏**的可选部件，
 * 属于个性化配置，不属于「总览指标」，本次不实现（说明见交付汇报）。
 *
 * 字段映射全部来自实测响应，未采信的字段一律不显示（不猜、不伪造）。
 *
 * @module overview-plugin
 */

import {
  Card,
  Stat,
  Badge,
  Spinner,
  EmptyState,
  ErrorState,
  Button,
  Table,
  Row,
  KeyValueList,
  ProgressBar,
  Toggle,
  Icon,
  Grid,
  Avatar,
  el,
  display,
  formatBytes,
  formatDuration,
  formatNumber,
  formatTime,
  STRINGS as A,
} from './atoms.js';

import {
  Resource,
  createStatusResource,
  createSystemResource,
  createProcessesResource,
  createQqListResource,
  createConnectionsResource,
  createNotificationsResource,
} from './data-layer.js';

import { createResourcePlugin, definePlugin, registerPlugin, mountAll, createContext } from './plugin.js';

/* ========================================================================== *
 * STRINGS — 本页全部用户可见文案
 * ========================================================================== */

export const STRINGS = {
  /* ---- 页面 ---- */
  pageTitle: '总览',
  pageHint: 'Haizakura 运行状态一览',
  refreshAll: '刷新全部',

  /* ---- KPI 卡 ---- */
  statusLabel: '服务状态',
  statusRunning: '运行中',
  statusBackendOk: '已连接到后端',
  statusBackendBad: '请检查后端进程',
  statusUnknown: '状态未知',

  accountsLabel: '在线账号',
  accountsValue: ({ count }) => `${count}`,
  accountsHint: ({ count }) => `已接入 ${count} 个会话`,
  accountsHintEmpty: '暂无已接入账号',

  processesLabel: '进程注入',
  processesValue: ({ online }) => `${online} 在线`,
  processesHint: ({ total, injectable }) => `${total} 进程 · ${injectable} 可注入`,
  processesHintEmpty: '未检测到 QQ 进程',

  hostLabel: '主机名',
  hostHintLoading: '正在采集主机信息…',
  hostDetail: ({ hostname, distro, archLabel }) => `主机名：${hostname}\n系统：${distro} · ${archLabel}`,

  uptimeLabel: '系统运行',
  uptimeHint: ({ value }) => `进程 ${value}`,
  uptimeDetail: ({ system, process }) => `系统运行：${system}\nHaizakura 进程：${process}`,

  staleSuffix: ' · 更新失败，显示上次数据',

  /* ---- 主机资源卡 ---- */
  hostResTitle: '主机资源',
  hostResHint: ({ model, cores, node, stale }) =>
    `${model} · ${cores} 核 · Node ${node}${stale ? ' · 更新失败，显示上次数据' : ''}`,
  cpuTitle: 'CPU 使用率',
  cpuCores: ({ count }) => `${count} 核`,
  cpuLoad: '负载',
  memoryTitle: '内存使用',
  memoryProc: '本进程',
  memoryOther: '其他已用',
  memoryFree: '空闲',
  memoryTotal: '总计',
  runtimeTitle: '运行进程',
  runtimeRss: 'RSS',
  runtimeHeap: '堆内存',
  runtimeExternal: '外部内存',
  runtimeArrayBuffers: 'ArrayBuffer',
  runtimePid: ({ pid }) => `PID ${pid}`,
  coreTooltip: ({ index, value }) => `核心 ${index}：${value}`,

  /* ---- 连接卡 ---- */
  connectionsTitle: 'OneBot 连接',
  connectionsHint: '各账号协议端点的实时连接状态',
  connectionsOnlyIssues: ' · 仅异常',
  onlyIssuesLabel: '仅显示异常',
  connectionsFilter: ({ filter }) => ` · 筛选：${filter}`,
  noAdapters: '未配置任何协议端点',
  filterPlaceholder: '筛选（账号昵称 / QQ 号）',
  emptyConnections: '暂无已接入的账号实例',
  emptyConnectionsFiltered: '无匹配的连接',

  adapterStatus: {
    ok: '正常',
    warn: '注意',
    down: '异常',
    degraded: '应用失败',
    disabled: '未启用',
  },
  adapterKind: {
    httpServer: 'HTTP 服务端',
    httpClient: 'HTTP 上报',
    wsServer: 'WS 服务端',
    wsClient: 'WS 客户端',
    satoriServer: 'Satori 服务端',
    satoriClient: 'Satori 客户端',
  },

  migrationPreparing: '正在准备数据库，账号暂不可用',
  migrationFailedUsable: '历史数据迁移失败，账号功能可用',
  migrationFailedUnusable: '数据库准备失败，账号暂不可用',
  migrationRunning: '正在后台迁移历史数据，账号功能可用',
  migrationProgress: ({ processed, total }) => `已处理 ${processed} / ${total} 条`,
  migrationRemainingEstimating: '剩余时间估算中',
  migrationRemainingSoon: '即将完成',
  migrationRemainingSeconds: ({ seconds }) => `预计剩余 ${seconds} 秒`,
  migrationRemainingMinutes: ({ minutes }) => `预计剩余 ${minutes} 分钟`,
  migrationRemainingHours: ({ hours, minutes }) =>
    minutes > 0 ? `预计剩余 ${hours} 小时 ${minutes} 分钟` : `预计剩余 ${hours} 小时`,

  /* ---- 在线会话卡 ---- */
  sessionsTitle: '在线会话',
  sessionsHint: '当前已接入并完成登录的 QQ 账号',
  sessionsFilter: ({ filter }) => `（筛选：${filter}）`,
  emptySessions: '暂无在线会话',
  emptySessionsFiltered: '无匹配的会话',
  onlineTooltip: '在线',

  /* ---- 最近通知卡 ---- */
  notifyTitle: '最近通知',
  notifyHint: ({ count, limit }) => `最近 ${count} 条 · 最多 ${limit} 条`,
  emptyNotify: '暂无通知投递记录',
  notifyTableTime: '时间',
  notifyTableAccount: '账号',
  notifyTableEvent: '事件',
  notifyTableChannel: '渠道',
  notifyTableResult: '结果',
  eventOnline: '上线',
  eventOffline: '离线',
  deliverOk: '成功',
  deliverFail: '失败',
  deliverUnknown: '未知',

  /* ---- 最近告警卡 ---- */
  alertsTitle: '最近告警',
  alertsHint: ({ count, levels }) => `最近 ${count} 条 · ${levels}`,
  emptyAlerts: '暂无告警',
  alertsViewLogs: '查看日志',
  alertTime: '时间',
  alertLevel: '级别',
  alertScope: '范围',
  alertMessage: '内容',
  alertType: '类型',

  /* ---- 表格列 ---- */
  tableField: '项目',
  tableValue: '值',
};

/* ========================================================================== *
 * 常量：后端枚举 → 展示映射
 * ========================================================================== */

/**
 * HookProcessStatus → Badge tone。
 * 与现有前端 processes 页的映射保持一致（见 reference/processes-page-*.js
 * 中 M(e) 函数）：online→success、error/disconnected→destructive、
 * loading/connecting/loaded→default、available→secondary。
 * 本库 tone 取值：ok | warn | error | idle | busy。
 */
export const PROCESS_STATUS_TONE = {
  online: 'ok',
  loaded: 'warn',
  connecting: 'busy',
  loading: 'busy',
  disconnected: 'error',
  error: 'error',
  available: 'idle',
};

/** adapter.status → Badge tone（源码枚举 ok|warn|down|degraded|disabled） */
export const ADAPTER_STATUS_TONE = {
  ok: 'ok',
  warn: 'warn',
  down: 'error',
  degraded: 'error',
  disabled: 'idle',
};

/** 告警级别 → tone（复用日志级别枚举 trace|debug|info|success|warn|error） */
export const LOG_LEVEL_TONE = {
  trace: 'idle',
  debug: 'idle',
  info: 'idle',
  success: 'ok',
  warn: 'warn',
  error: 'error',
};

/* ========================================================================== *
 * 共享数据源
 * ========================================================================== */

/**
 * 创建总览页全部数据源。**每次创建页面调用一次**，挂到 ctx.resources 上，
 * 各区块插件共享（同一端点只请求一次）。
 *
 * 端点速查（全部已实测，见 data-layer.js 的注释）：
 *   status        GET /api/status               → { status }
 *   system        GET /api/system               → { hostname, cpu, memory, runtime, ... }
 *   processList   GET /api/processes            → { list: [processInfo] }
 *   qqList        GET /api/qq-list              → { list: [{uin,nickname}] }
 *   connections   GET /api/connections          → { list: [{uin,...,adapters[]}] }
 *   notifications GET /api/notifications/recent → { recent: [{time,uin,event,...}] }
 *
 * @returns {Object<string, import('./data-layer.js').Resource>}
 */
export function createOverviewResources() {
  return {
    status: createStatusResource(),
    system: createSystemResource(),
    processList: createProcessesResource(),
    qqList: createQqListResource(),
    connections: createConnectionsResource(),
    notifications: createNotificationsResource(20),
  };
}

/* ========================================================================== *
 * 派生计算（纯函数，便于单测）
 * ========================================================================== */

/**
 * 从进程列表算出「在线台数 / 可注入台数」。
 * @param {Array} processes  GET /api/processes 的 list
 */
export function summarizeProcesses(processes = []) {
  const list = Array.isArray(processes) ? processes : [];
  return {
    total: list.length,
    online: list.filter((p) => p && p.status === 'online').length,
    injectable: list.filter((p) => p && !p.injected).length,
  };
}

/**
 * 拆出内存三段的字节数。**完全按现有前端的算法**：
 *   本进程  = min(runtime.rss, memory.used)
 *   其他    = memory.used - 本进程
 *   空闲    = memory.free
 * @param {Object} system  GET /api/system
 */
export function splitMemory(system) {
  if (!system || !system.memory) return null;
  const total = Number(system.memory.total) || 0;
  const used = Number(system.memory.used) || 0;
  const free = Number(system.memory.free) || 0;
  const rss = Number(system.runtime?.rss) || 0;
  const proc = Math.min(rss, used);
  const other = Math.max(0, used - proc);
  return { total, used, free, proc, other };
}

/**
 * 迁移剩余时间 → 文案。对齐现有前端的 Vt() 逻辑。
 * @param {number|null} seconds
 */
function migrationEtaText(seconds) {
  if (seconds === null || seconds === undefined) return STRINGS.migrationRemainingEstimating;
  const value = Number(seconds);
  if (!Number.isFinite(value)) return STRINGS.migrationRemainingEstimating;
  if (value <= 0) return STRINGS.migrationRemainingSoon;
  if (value < 60) return STRINGS.migrationRemainingSeconds({ seconds: Math.round(value) });
  const minutes = Math.ceil(value / 60);
  if (minutes < 60) return STRINGS.migrationRemainingMinutes({ minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return STRINGS.migrationRemainingHours({ hours, minutes: rest });
}

/**
 * distro 简称。对齐现有前端的 At() 的精简版（去括号、压空白）。
 * 例：'Ubuntu (kernel 7.0.0)' → 'Ubuntu'
 * @param {string} distro
 */
export function shortDistro(distro) {
  if (typeof distro !== 'string' || distro.trim() === '') return A.empty;
  return distro
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || A.empty;
}

/**
 * 把「上次成功数据 + 当前错误」合成一句副标题，避免信息丢失。
 * @param {string} base
 * @param {import('./data-layer.js').ApiError|null} error
 * @param {boolean} hasData
 */
export function staleAwareHint(base, error, hasData) {
  if (!error) return base;
  return hasData ? `${base}${STRINGS.staleSuffix}` : error.message;
}

/* ========================================================================== *
 * 区块渲染（纯函数：输入 Resource 快照，输出 DOM）
 * ========================================================================== */

/**
 * 渲染 5 张 KPI 指标卡（stat:status / accounts / processes / host / uptime）。
 * 每张卡的 tone / 副标题都由**该数据源自己的状态**决定。
 *
 * @param {Object} resources
 * @returns {HTMLElement}
 */
export function renderStats(resources) {
  const statusSnap = resources.status.get();
  const systemSnap = resources.system.get();
  const processSnap = resources.processList.get();
  const qqSnap = resources.qqList.get();

  const cards = [];

  /* --- stat:status ← GET /api/status { status:"running" } --- */
  {
    const raw = statusSnap.data ? statusSnap.data.status : '';
    const running = raw === 'running';
    const hint = statusSnap.error
      ? statusSnap.error.message
      : running
        ? STRINGS.statusBackendOk
        : statusSnap.status === 'loading'
          ? A.loading
          : STRINGS.statusBackendBad;
    cards.push(
      Stat({
        label: STRINGS.statusLabel,
        value: statusSnap.status === 'loading' && !statusSnap.data ? A.empty : running ? STRINGS.statusRunning : raw || A.empty,
        tone: statusSnap.error ? 'error' : running ? 'ok' : 'warn',
        hint,
        icon: Icon('server', { size: 20 }),
      }),
    );
  }

  /* --- stat:accounts ← GET /api/qq-list { list:[{uin,nickname}] } --- */
  {
    const list = Array.isArray(qqSnap.data) ? qqSnap.data : [];
    const known = qqSnap.status === 'ready' || list.length > 0;
    const hint = staleAwareHint(
      list.length > 0 ? STRINGS.accountsHint({ count: list.length }) : STRINGS.accountsHintEmpty,
      qqSnap.error,
      list.length > 0,
    );
    cards.push(
      Stat({
        label: STRINGS.accountsLabel,
        // 失败且无旧数据 → 「—」，不伪装成 0
        value: qqSnap.error && list.length === 0 ? A.empty : known ? list.length : A.empty,
        tone: qqSnap.error ? (list.length > 0 ? 'warn' : 'error') : list.length > 0 ? 'ok' : 'idle',
        hint,
        icon: Icon('users', { size: 20 }),
      }),
    );
  }

  /* --- stat:processes ← GET /api/processes { list:[processInfo] } --- */
  {
    const list = Array.isArray(processSnap.data) ? processSnap.data : [];
    const { total, online, injectable } = summarizeProcesses(list);
    const hint = staleAwareHint(
      total > 0 ? STRINGS.processesHint({ total, injectable }) : STRINGS.processesHintEmpty,
      processSnap.error,
      total > 0,
    );
    cards.push(
      Stat({
        label: STRINGS.processesLabel,
        value: processSnap.error && total === 0 ? A.empty : total > 0 ? STRINGS.processesValue({ online }) : A.empty,
        tone: processSnap.error ? (total > 0 ? 'warn' : 'error') : online > 0 ? 'ok' : 'idle',
        hint,
        icon: Icon('plug', { size: 20 }),
      }),
    );
  }

  /* --- stat:host ← GET /api/system { hostname, distro, archLabel } --- */
  {
    const sys = systemSnap.data;
    const hint = staleAwareHint(
      sys ? `${shortDistro(sys.distro)} · ${display(sys.archLabel)}` : STRINGS.hostHintLoading,
      systemSnap.error,
      Boolean(sys),
    );
    cards.push(
      Stat({
        label: STRINGS.hostLabel,
        value: sys ? display(sys.hostname) : systemSnap.status === 'loading' ? A.empty : A.empty,
        tone: systemSnap.error ? (sys ? 'warn' : 'error') : 'accent',
        hint,
        icon: Icon('cpu', { size: 20 }),
      }),
    );
  }

  /* --- stat:uptime ← GET /api/system { uptime, processUptime } --- */
  {
    const sys = systemSnap.data;
    const hint = sys ? STRINGS.uptimeHint({ value: formatDuration(sys.processUptime) }) : undefined;
    cards.push(
      Stat({
        label: STRINGS.uptimeLabel,
        value: sys ? formatDuration(sys.uptime) : A.empty,
        tone: systemSnap.error ? (sys ? 'warn' : 'error') : 'accent',
        hint,
        icon: Icon('clock', { size: 20 }),
      }),
    );
  }

  return Grid(cards, { min: '200px' });
}

/**
 * 渲染「主机资源」卡：CPU / 内存 / 运行进程 三张子卡。
 * 数据源：GET /api/system
 *
 * @param {Object} resources
 * @param {{cpu?: boolean, memory?: boolean, runtime?: boolean}} [visible]
 * @returns {HTMLElement}
 */
export function renderHostResources(resources, visible = { cpu: true, memory: true, runtime: true }) {
  const snap = resources.system.get();
  const sys = snap.data;

  const card = Card({
    title: STRINGS.hostResTitle,
    hint: sys
      ? STRINGS.hostResHint({
          model: String(sys.cpu?.model ?? '').trim() || A.unknown,
          cores: sys.cpu?.cores ?? A.empty,
          node: display(sys.nodeVersion),
          stale: Boolean(snap.error),
        })
      : snap.error
        ? snap.error.message
        : STRINGS.hostHintLoading,
    actions: [
      Button({
        label: A.refresh,
        variant: 'outline',
        icon: Icon('refresh', { size: 14 }),
        onClick: () => resources.system.refresh(),
      }),
    ],
  });

  const body = card.querySelector('.hz-card__body');

  // 错误且无数据：在这里就地显示（不要空白）
  if (snap.error && !sys) {
    body.appendChild(ErrorState({ message: snap.error.message, retry: () => resources.system.retry() }));
    return card;
  }
  if (!sys) {
    body.appendChild(Spinner({ label: A.loading }));
    return card;
  }

  const panels = [];

  /* --- CPU 使用率 ← cpu.average / cpu.perCore[] / cpu.loadAvg[3] / cpu.cores --- */
  if (visible.cpu) {
    const cpu = sys.cpu ?? {};
    const inner = el('div', { class: 'hz-panel' });
    inner.appendChild(
      el('div', { class: 'hz-panel__head' }, [
        el('span', { class: 'hz-panel__title', text: STRINGS.cpuTitle }),
        el('span', { class: 'hz-panel__meta', text: STRINGS.cpuCores({ count: cpu.cores ?? 0 }) }),
        el('span', {
          class: 'hz-panel__value',
          text: Number.isFinite(Number(cpu.average)) ? `${formatNumber(cpu.average, 1)}%` : A.empty,
        }),
      ]),
    );
    inner.appendChild(
      ProgressBar({
        value: Number(cpu.average) || 0,
        max: 100,
        tone: Number(cpu.average) >= 90 ? 'error' : Number(cpu.average) >= 70 ? 'warn' : 'ok',
      }),
    );
    const loadAvg = Array.isArray(cpu.loadAvg) ? cpu.loadAvg : [];
    if (loadAvg.length > 0) {
      inner.appendChild(
        el('p', {
          class: 'hz-panel__note',
          text: `${STRINGS.cpuLoad}: ${loadAvg.map((v) => formatNumber(v, 2)).join(' / ')}`,
        }),
      );
    }
    const perCore = Array.isArray(cpu.perCore) ? cpu.perCore : [];
    if (perCore.length > 0) {
      const coreGrid = el('div', { class: 'hz-cores' });
      perCore.forEach((value, index) => {
        const pct = Math.min(100, Math.max(0, Number(value) || 0));
        coreGrid.appendChild(
          el('div', {
            class: 'hz-cores__cell',
            style: { background: `color-mix(in oklab, var(--primary) ${pct.toFixed(1)}%, var(--muted))` },
            title: STRINGS.coreTooltip({ index, value: `${formatNumber(pct, 1)}%` }),
            text: String(index),
          }),
        );
      });
      inner.appendChild(coreGrid);
    }
    panels.push(inner);
  }

  /* --- 内存使用 ← memory.total/free/used/usagePercent + runtime.rss --- */
  if (visible.memory) {
    const mem = splitMemory(sys);
    const inner = el('div', { class: 'hz-panel' });
    inner.appendChild(
      el('div', { class: 'hz-panel__head' }, [
        el('span', { class: 'hz-panel__title', text: STRINGS.memoryTitle }),
        el('span', {
          class: 'hz-panel__value',
          text: Number.isFinite(Number(sys.memory?.usagePercent))
            ? `${formatNumber(sys.memory.usagePercent, 1)}%`
            : A.empty,
        }),
      ]),
    );

    if (mem) {
      const segments = [
        { key: 'proc', label: STRINGS.memoryProc, bytes: mem.proc, color: 'var(--primary)' },
        {
          key: 'other',
          label: STRINGS.memoryOther,
          bytes: mem.other,
          color: 'color-mix(in oklab, var(--primary) 45%, transparent)',
        },
        {
          key: 'free',
          label: STRINGS.memoryFree,
          bytes: mem.free,
          color: 'color-mix(in oklab, var(--muted-foreground) 30%, transparent)',
        },
      ];
      const bar = el('div', { class: 'hz-mem-bar' });
      for (const seg of segments) {
        const grow = mem.total > 0 ? (seg.bytes / mem.total) * 100 : 0;
        bar.appendChild(
          el('span', {
            class: 'hz-mem-bar__seg',
            style: { flexGrow: String(Math.max(grow, 0.5)), background: seg.color },
            title: `${seg.label} ${formatBytes(seg.bytes).value} ${formatBytes(seg.bytes).unit}`,
          }),
        );
      }
      inner.appendChild(bar);

      const legend = el('div', { class: 'hz-legend' });
      const items = [
        ...segments,
        { key: 'total', label: STRINGS.memoryTotal, bytes: mem.total, color: 'transparent' },
      ];
      for (const seg of items) {
        const formatted = formatBytes(seg.bytes);
        const entry = el('span', { class: 'hz-legend__item' });
        if (seg.key !== 'total') {
          entry.appendChild(el('i', { class: 'hz-legend__dot', style: { background: seg.color } }));
        }
        entry.appendChild(el('span', { text: seg.label }));
        entry.appendChild(el('b', { text: `${formatted.value} ${formatted.unit}`.trim() }));
        legend.appendChild(entry);
      }
      inner.appendChild(legend);
    }
    panels.push(inner);
  }

  /* --- 运行进程 ← runtime.pid / rss / heapUsed / heapTotal / external --- */
  if (visible.runtime) {
    const runtime = sys.runtime ?? {};
    const inner = el('div', { class: 'hz-panel' });
    inner.appendChild(
      el('div', { class: 'hz-panel__head' }, [
        el('span', { class: 'hz-panel__title', text: STRINGS.runtimeTitle }),
        el('span', {
          class: 'hz-panel__value',
          text: runtime.pid === undefined ? A.empty : STRINGS.runtimePid({ pid: runtime.pid }),
        }),
      ]),
    );

    const heapUsed = formatBytes(runtime.heapUsed);
    const heapTotal = formatBytes(runtime.heapTotal);
    inner.appendChild(
      KeyValueList([
        { label: STRINGS.runtimeRss, value: `${formatBytes(runtime.rss).value} ${formatBytes(runtime.rss).unit}` },
        {
          label: STRINGS.runtimeHeap,
          value: `${heapUsed.value} ${heapUsed.unit} / ${heapTotal.value} ${heapTotal.unit}`,
        },
        {
          label: STRINGS.runtimeExternal,
          value: `${formatBytes(runtime.external).value} ${formatBytes(runtime.external).unit}`,
        },
        {
          label: STRINGS.runtimeArrayBuffers,
          value: `${formatBytes(runtime.arrayBuffers).value} ${formatBytes(runtime.arrayBuffers).unit}`,
        },
      ]),
    );
    panels.push(inner);
  }

  body.appendChild(Grid(panels, { min: '260px' }));
  return card;
}

/**
 * 渲染 migration 提示条（对齐现有前端的 Bt 组件）。
 * 数据源：GET /api/connections → databaseMigration
 * @param {Object} migration
 * @returns {HTMLElement|null}
 */
export function renderMigration(migration) {
  if (!migration || typeof migration !== 'object') return null;
  if (migration.phase === 'complete') return null;
  // usable === false 且 phase 不是 failed：现有前端在无 adapter 时返回 null
  const failed = migration.phase === 'failed';
  const usable = migration.usable !== false;

  const text = migration.phase === 'preparing'
    ? STRINGS.migrationPreparing
    : failed
      ? usable
        ? STRINGS.migrationFailedUsable
        : STRINGS.migrationFailedUnusable
      : STRINGS.migrationRunning;

  const percent = migration.progress === null || migration.progress === undefined
    ? null
    : Math.round(Number(migration.progress) * 100);

  const box = el('div', { class: `hz-migration${failed ? ' hz-migration--failed' : ''}` });
  const head = el('div', { class: 'hz-migration__head' });
  head.appendChild(el('span', { class: 'hz-migration__text', text }));
  if (percent !== null && Number.isFinite(percent)) {
    head.appendChild(el('span', { class: 'hz-migration__percent', text: `${percent}%` }));
  }
  box.appendChild(head);

  if (percent !== null && Number.isFinite(percent)) {
    box.appendChild(ProgressBar({ value: percent, max: 100, tone: failed ? 'error' : 'warn' }));
  }

  const notes = el('div', { class: 'hz-migration__notes' });
  if (migration.total !== null && migration.total !== undefined) {
    notes.appendChild(
      el('span', {
        text: STRINGS.migrationProgress({
          processed: Number(migration.processed ?? 0).toLocaleString(),
          total: Number(migration.total).toLocaleString(),
        }),
      }),
    );
  }
  if (!failed) {
    notes.appendChild(el('span', { text: migrationEtaText(migration.estimatedRemainingSeconds) }));
  } else if (migration.error) {
    notes.appendChild(el('span', { text: String(migration.error) }));
  }
  if (notes.childNodes.length > 0) box.appendChild(notes);

  return box;
}

/**
 * 渲染「OneBot 连接」卡。
 * 数据源：GET /api/connections → { list:[{uin,nickname,adapters[],databaseMigration}] }
 *
 * @param {Object} resources
 * @param {{filter?: string, onlyIssues?: boolean}} [options]
 * @returns {HTMLElement}
 */
export function renderConnections(resources, { filter = '', onlyIssues = false } = {}) {
  const snap = resources.connections.get();
  const needle = String(filter).trim().toLowerCase();

  const card = Card({
    title: STRINGS.connectionsTitle,
    hint: `${STRINGS.connectionsHint}${onlyIssues ? STRINGS.connectionsOnlyIssues : ''}${
      needle ? STRINGS.connectionsFilter({ filter }) : ''
    }`,
  });
  const body = card.querySelector('.hz-card__body');

  const list = Array.isArray(snap.data) ? snap.data : [];

  if (snap.status === 'loading' && list.length === 0) {
    body.appendChild(Spinner({ label: A.loading }));
    return card;
  }
  if (snap.error && list.length === 0) {
    body.appendChild(ErrorState({ message: snap.error.message, retry: () => resources.connections.retry() }));
    return card;
  }
  if (list.length === 0) {
    body.appendChild(EmptyState({ title: STRINGS.emptyConnections, icon: Icon('plug', { size: 28 }) }));
    return card;
  }

  if (snap.error) {
    body.appendChild(ErrorState({ message: snap.error.message, retry: () => resources.connections.retry(), hint: A.staleHint }));
  }

  // 过滤（对齐现有前端：先按 onlyIssues 裁 adapter，再按昵称/uin 过滤账号）
  let view = list.map((account) => ({
    ...account,
    adapters: onlyIssues
      ? (Array.isArray(account.adapters) ? account.adapters : []).filter((a) => a && a.status !== 'ok')
      : Array.isArray(account.adapters) ? account.adapters : [],
  }));
  if (onlyIssues) view = view.filter((a) => a.adapters.length > 0);
  if (needle) {
    view = view.filter(
      (a) =>
        String(a.nickname ?? '').toLowerCase().includes(needle) ||
        String(a.uin ?? '').toLowerCase().includes(needle),
    );
  }

  if (view.length === 0) {
    body.appendChild(
      EmptyState({
        title: needle || onlyIssues ? STRINGS.emptyConnectionsFiltered : STRINGS.emptyConnections,
        icon: Icon('plug', { size: 28 }),
      }),
    );
    return card;
  }

  const group = el('div', { class: 'hz-conn-list' });
  for (const account of view) {
    const block = el('div', { class: 'hz-conn' });

    const title = el('div', { class: 'hz-conn__title' });
    title.appendChild(
      el('span', { class: 'hz-conn__name', text: display(account.nickname) !== A.empty ? account.nickname : account.uin }),
    );
    title.appendChild(el('span', { class: 'hz-conn__uin', text: `QQ ${display(account.uin)}` }));
    block.appendChild(title);

    const migration = renderMigration(account.databaseMigration);
    if (migration) block.appendChild(migration);

    if (account.adapters.length > 0) {
      const rows = el('div', { class: 'hz-conn__adapters' });
      for (const adapter of account.adapters) {
        const tone = ADAPTER_STATUS_TONE[adapter.status] || 'idle';
        const cells = el('div', { class: 'hz-conn__adapter-main' });

        const line1 = el('div', { class: 'hz-conn__adapter-line' });
        line1.appendChild(el('span', { class: 'hz-conn__adapter-name', text: display(adapter.name) }));
        line1.appendChild(
          el('span', {
            class: 'hz-conn__adapter-kind',
            text: STRINGS.adapterKind[adapter.kind] || display(adapter.kind),
          }),
        );
        cells.appendChild(line1);

        if (adapter.detail) {
          cells.appendChild(el('div', { class: 'hz-conn__adapter-detail', text: String(adapter.detail) }));
        }
        if (adapter.lastError && adapter.lastErrorAt) {
          cells.appendChild(
            el('div', {
              class: 'hz-conn__adapter-error',
              text: `${formatTime(adapter.lastErrorAt, true)} · ${adapter.lastError}`,
            }),
          );
        }

        rows.appendChild(
          Row({
            cells: [
              Badge({
                text: STRINGS.adapterStatus[adapter.status] || display(adapter.status),
                tone,
                title: adapter.status,
              }),
              cells,
            ],
            tone,
          }),
        );
      }
      block.appendChild(rows);
    } else if (account.databaseMigration?.usable !== false) {
      block.appendChild(el('p', { class: 'hz-conn__noadapter', text: STRINGS.noAdapters }));
    }

    group.appendChild(block);
  }
  body.appendChild(group);
  return card;
}

/**
 * 渲染「在线会话」卡。
 * 数据源：GET /api/qq-list → { list:[{uin,nickname}] }
 * @param {Object} resources
 * @param {{filter?: string}} [options]
 */
export function renderSessions(resources, { filter = '' } = {}) {
  const snap = resources.qqList.get();
  const needle = String(filter).trim().toLowerCase();

  const card = Card({
    title: STRINGS.sessionsTitle,
    hint: `${STRINGS.sessionsHint}${needle ? STRINGS.sessionsFilter({ filter }) : ''}`,
  });
  const body = card.querySelector('.hz-card__body');

  const list = Array.isArray(snap.data) ? snap.data : [];

  if (snap.status === 'loading' && list.length === 0) {
    body.appendChild(Spinner({ label: A.loading }));
    return card;
  }
  if (snap.error && list.length === 0) {
    body.appendChild(ErrorState({ message: snap.error.message, retry: () => resources.qqList.retry() }));
    return card;
  }
  if (list.length === 0) {
    body.appendChild(EmptyState({ title: STRINGS.emptySessions, icon: Icon('users', { size: 28 }) }));
    return card;
  }

  const view = needle
    ? list.filter(
        (item) =>
          String(item.nickname ?? '').toLowerCase().includes(needle) ||
          String(item.uin ?? '').toLowerCase().includes(needle),
      )
    : list;

  if (view.length === 0) {
    body.appendChild(EmptyState({ title: STRINGS.emptySessionsFiltered, icon: Icon('users', { size: 28 }) }));
    return card;
  }

  if (snap.error) {
    body.appendChild(ErrorState({ message: snap.error.message, retry: () => resources.qqList.retry(), hint: A.staleHint }));
  }

  const items = view.map((item) =>
    Row({
      cells: [
        Avatar({ uin: item.uin, nickname: item.nickname, size: 36 }),
        el('div', { class: 'hz-session' }, [
          el('span', { class: 'hz-session__name', text: display(item.nickname) !== A.empty ? item.nickname : item.uin }),
          el('span', { class: 'hz-session__uin', text: `QQ ${display(item.uin)}` }),
        ]),
        el('span', { class: 'hz-dot hz-dot--on', title: STRINGS.onlineTooltip }),
      ],
      tone: 'ok',
    }),
  );

  body.appendChild(el('div', { class: 'hz-session-grid' }, items));
  return card;
}

/**
 * 渲染「最近通知」卡。
 * 数据源：GET /api/notifications/recent?limit=20 → { recent:[{time,uin,event,channelId,ok,status,error}] }
 *
 * @param {Object} resources
 * @param {Object} [notify]  通知服务（可选）：{ test(channelId), refresh() }
 */
export function renderNotifications(resources, notify) {
  const snap = resources.notifications.get();

  const card = Card({
    title: STRINGS.notifyTitle,
    hint: STRINGS.notifyHint({ count: Array.isArray(snap.data) ? snap.data.length : 0, limit: 20 }),
    actions: [
      Button({
        label: A.refresh,
        variant: 'ghost',
        icon: Icon('refresh', { size: 14 }),
        onClick: () => (notify?.refresh ? notify.refresh() : resources.notifications.refresh()),
      }),
    ],
  });
  const body = card.querySelector('.hz-card__body');

  if (snap.status === 'loading' && snap.data === null) {
    body.appendChild(Spinner({ label: A.loading }));
    return card;
  }
  if (snap.error) {
    body.appendChild(
      ErrorState({
        message: snap.error.message,
        retry: () => resources.notifications.retry(),
        hint: Array.isArray(snap.data) && snap.data.length > 0 ? A.staleHint : undefined,
      }),
    );
    if (!Array.isArray(snap.data) || snap.data.length === 0) return card;
  }

  const list = Array.isArray(snap.data) ? snap.data : [];
  if (list.length === 0) {
    body.appendChild(EmptyState({ title: STRINGS.emptyNotify, icon: Icon('bell', { size: 28 }) }));
    return card;
  }

  const rows = list.map((record) => {
    const ok = record.ok === true;
    const failed = record.ok === false;
    const resultText = ok ? STRINGS.deliverOk : failed ? STRINGS.deliverFail : STRINGS.deliverUnknown;
    const eventText =
      record.event === 'online' ? STRINGS.eventOnline : record.event === 'offline' ? STRINGS.eventOffline : display(record.event);

    const resultCell = el('div', { class: 'hz-notify-result' });
    resultCell.appendChild(Badge({ text: resultText, tone: ok ? 'ok' : failed ? 'error' : 'idle' }));
    if (failed && record.error) {
      resultCell.appendChild(el('span', { class: 'hz-notify-result__error', text: String(record.error) }));
    } else if (Number.isFinite(Number(record.status))) {
      resultCell.appendChild(el('span', { class: 'hz-notify-result__status', text: `HTTP ${record.status}` }));
    }

    return [
      formatTime(record.time, true),
      display(record.uin),
      eventText,
      display(record.channelId),
      resultCell,
    ];
  });

  body.appendChild(
    Table({
      head: [
        STRINGS.notifyTableTime,
        STRINGS.notifyTableAccount,
        STRINGS.notifyTableEvent,
        STRINGS.notifyTableChannel,
        STRINGS.notifyTableResult,
      ],
      rows,
      align: ['left', 'left', 'left', 'left', 'left'],
      empty: STRINGS.emptyNotify,
    }),
  );
  return card;
}

/**
 * 渲染「最近告警」卡。
 * 数据源：GET /api/logs?limit=N → { list:[{id,time,level,scope,uin?,message,line}] }
 * （现有总览页的 alerts 区块即此端点；本卡保持同样的数据来源与列。）
 *
 * @param {Object} logSource  { snapshot, retry, refresh }
 */
export function renderAlerts(logSource) {
  const snap = logSource.snapshot();
  const card = Card({
    title: STRINGS.alertsTitle,
    hint: STRINGS.alertsHint({
      count: Array.isArray(snap.data) ? snap.data.length : 0,
      levels: ['warn', 'error'].join(' / ').toUpperCase(),
    }),
    actions: [
      Button({
        label: A.refresh,
        variant: 'ghost',
        icon: Icon('refresh', { size: 14 }),
        onClick: () => logSource.refresh(),
      }),
    ],
  });
  const body = card.querySelector('.hz-card__body');

  if (snap.status === 'loading' && snap.data === null) {
    body.appendChild(Spinner({ label: A.loading }));
    return card;
  }
  if (snap.error) {
    body.appendChild(ErrorState({ message: snap.error.message, retry: () => logSource.retry() }));
    if (!Array.isArray(snap.data) || snap.data.length === 0) return card;
  }

  const list = Array.isArray(snap.data) ? snap.data : [];
  if (list.length === 0) {
    body.appendChild(EmptyState({ title: STRINGS.emptyAlerts, icon: Icon('bell', { size: 28 }) }));
    return card;
  }

  const rows = list.map((entry) => {
    const level = String(entry.level ?? '');
    return [
      formatTime(entry.time, true),
      Badge({ text: level.toUpperCase() || A.empty, tone: LOG_LEVEL_TONE[level] || 'idle', title: level }),
      display(entry.scope),
      el('span', { class: 'hz-alert-msg', title: String(entry.message ?? ''), text: display(entry.message) }),
    ];
  });

  body.appendChild(
    Table({
      head: [STRINGS.alertTime, STRINGS.alertLevel, STRINGS.alertScope, STRINGS.alertMessage],
      rows,
      align: ['left', 'left', 'left', 'left'],
      empty: STRINGS.emptyAlerts,
    }),
  );
  return card;
}

/* ========================================================================== *
 * 最近告警数据源（GET /api/logs）
 * ========================================================================== *
 * 该端点不在任务指定的 5 个总览数据源里，但现有总览页的 alerts 区块用它，
 * 为「信息密度不下降」在此补一个 Resource。
 *
 * 实测响应：
 * { "list": [ { "id": 6242, "time": "2026-11-16T11:52:04.125Z",
 *               "level": "info", "scope": "WebUI",
 *               "message": "...", "line": "...",
 *               "uin": 3254926145            // 可选，账号相关日志才有
 *          } ] }
 * 注意：服务端**按插入顺序**返回最近 limit 条（非逆序），
 * 所以取末尾（最新）若干条 —— 现有前端也是用 .slice(-count)。
 * level 枚举：trace | debug | info | success | warn | error
 */

/**
 * @param {number} [limit]     保留的条数（默认 20）
 * @param {string[]} [levels]  关注的级别（默认 warn + error）
 * @returns {Resource}
 */
export function createAlertsResource(limit = 20, levels = ['warn', 'error']) {
  const wanted = new Set(levels);
  return new Resource('alerts', {
    // 多取一些再按级别过滤，避免过滤后条数过少
    endpoint: `/api/logs?limit=${Math.max(limit * 4, 200)}`,
    select: (payload) => {
      const list = Array.isArray(payload.list) ? payload.list : [];
      return list.filter((entry) => entry && wanted.has(String(entry.level))).slice(-limit);
    },
  });
}

/* ========================================================================== *
 * 插件定义
 * ========================================================================== */

/**
 * KPI 指标条插件（5 张 stat 卡）。
 * 依赖：status / system / processList / qqList
 */
export const statsPlugin = createResourcePlugin({
  id: 'overview.stats',
  title: STRINGS.pageTitle,
  icon: 'server',
  order: 10,
  description: '5 张 KPI 指标卡：服务状态 / 在线账号 / 进程注入 / 主机名 / 系统运行',
  createResources: (ctx) => ({
    status: ctx.resources.status,
    system: ctx.resources.system,
    processList: ctx.resources.processList,
    qqList: ctx.resources.qqList,
  }),
  render: ({ resources }) => renderStats(resources),
});

/**
 * 主机资源插件。依赖：system
 */
export const hostPlugin = createResourcePlugin({
  id: 'overview.host',
  title: STRINGS.hostResTitle,
  icon: 'cpu',
  order: 40,
  description: 'CPU / 内存 / 运行进程 三张子卡（GET /api/system）',
  createResources: (ctx) => ({ system: ctx.resources.system }),
  render: ({ resources }) => renderHostResources(resources),
});

/**
 * OneBot 连接插件。依赖：connections
 * 自带「仅显示异常」「筛选」两个本地交互控件（不落盘，仅本页状态）。
 *
 * 用闭包持有本次挂载的运行时状态（Resource + 视图状态），
 * 这样 refresh() / unmount() 都能访问到，而不依赖 `this`
 * （definePlugin 返回的插件对象是冻结的，不能往上挂字段）。
 */
export const connectionsPlugin = (() => {
  /** 本次挂载的运行时状态；unmount 时置 null */
  let runtime = null;

  return definePlugin({
    id: 'overview.connections',
    title: STRINGS.connectionsTitle,
    icon: 'plug',
    order: 20,
    description: '各账号协议端点连接状态 + 数据库迁移进度（GET /api/connections）',

    mount(host, ctx) {
      const resource = ctx.resources.connections;
      /** 本地视图状态（只影响本插件渲染，不进全局、不落盘） */
      const view = { filter: '', onlyIssues: false };

      /** 只重绘列表区（保留卡片外框与筛选输入框，输入不会丢焦点） */
      const redrawBody = () => {
        const card = host.querySelector('.hz-card');
        if (!card) return;
        const body = card.querySelector('.hz-card__body');
        const fresh = renderConnections({ connections: resource }, view);

        const freshBody = fresh.querySelector('.hz-card__body');
        const freshHint = fresh.querySelector('.hz-card__hint');
        const hintNode = card.querySelector('.hz-card__hint');

        if (body && freshBody) {
          while (body.firstChild) body.removeChild(body.firstChild);
          while (freshBody.firstChild) body.appendChild(freshBody.firstChild);
        }
        if (hintNode && freshHint) hintNode.textContent = freshHint.textContent;
      };

      /** 完整重绘（首次挂载 / 开关切换时用） */
      const draw = () => {
        if (!runtime) return;
        while (host.firstChild) host.removeChild(host.firstChild);

        const card = renderConnections({ connections: resource }, view);

        // 把本地交互控件插进卡片头部
        const head = card.querySelector('.hz-card__head');
        if (head) {
          const controls = el('div', { class: 'hz-conn-controls' });

          const input = el('input', {
            class: 'hz-input',
            type: 'search',
            value: view.filter,
            placeholder: STRINGS.filterPlaceholder,
            'aria-label': STRINGS.filterPlaceholder,
          });
          input.addEventListener('input', () => {
            view.filter = input.value;
            redrawBody();
          });
          controls.appendChild(input);

          const toggleLabel = el('label', { class: 'hz-inline-toggle' });
          toggleLabel.appendChild(el('span', { text: STRINGS.onlyIssuesLabel }));
          // 复用 atoms 的受控 Toggle；切换后整体重绘以更新 aria-checked
          toggleLabel.appendChild(
            Toggle({
              checked: view.onlyIssues,
              label: STRINGS.onlyIssuesLabel,
              onChange: (next) => {
                view.onlyIssues = next;
                draw();
              },
            }),
          );
          controls.appendChild(toggleLabel);

          head.appendChild(controls);
        }

        host.appendChild(card);
      };

      runtime = { host, resource, draw };
      const unsubscribe = resource.subscribe(() => draw());
      resource.load();

      return () => {
        unsubscribe();
        runtime = null;
      };
    },

    unmount() {
      // 实际清理在 mount 返回的 unmount 里完成；这里置空防御重复调用
      runtime = null;
    },

    refresh() {
      runtime?.resource?.refresh();
    },

    resources() {
      return runtime ? [runtime.resource] : [];
    },
  });
})();

/**
 * 在线会话插件。依赖：qqList
 */
export const sessionsPlugin = createResourcePlugin({
  id: 'overview.sessions',
  title: STRINGS.sessionsTitle,
  icon: 'users',
  order: 50,
  description: '已接入并完成登录的 QQ 账号（GET /api/qq-list）',
  createResources: (ctx) => ({ qqList: ctx.resources.qqList }),
  render: ({ resources }) => renderSessions(resources),
});

/**
 * 最近通知插件。依赖：notifications
 */
export const notificationsPlugin = createResourcePlugin({
  id: 'overview.notifications',
  title: STRINGS.notifyTitle,
  icon: 'bell',
  order: 30,
  description: '通知投递记录（GET /api/notifications/recent）',
  createResources: (ctx) => ({ notifications: ctx.resources.notifications }),
  render: ({ resources }) => renderNotifications(resources),
});

/**
 * 最近告警插件。使用本文件自己的 Resource（GET /api/logs）。
 */
export const alertsPlugin = createResourcePlugin({
  id: 'overview.alerts',
  title: STRINGS.alertsTitle,
  icon: 'bell',
  order: 60,
  description: '最近 warn/error 日志（GET /api/logs）',
  createResources: () => ({ alerts: createAlertsResource(20, ['warn', 'error']) }),
  render: ({ resources }) =>
    renderAlerts({
      snapshot: () => resources.alerts.get(),
      retry: () => resources.alerts.retry(),
      refresh: () => resources.alerts.refresh(),
    }),
});

/* ========================================================================== *
 * 页面外壳（插件化组装）
 * ========================================================================== */

/**
 * 总览页全部区块插件，按挂载顺序排列。
 * 顺序对齐现有页面的布局顺序：KPI → 连接 → 通知 → 主机 → 会话 → 告警。
 * @returns {Object[]}
 */
export function getOverviewPlugins() {
  return [
    statsPlugin,
    connectionsPlugin,
    notificationsPlugin,
    hostPlugin,
    sessionsPlugin,
    alertsPlugin,
  ];
}

/**
 * 注册总览页插件（可重复调用；重复 id 会抛错，便于发现接线错误）。
 * @param {Object} [registryApi]  { registerPlugin }，默认用 plugin.js 的
 */
export function registerOverviewPlugins(registryApi) {
  const api = registryApi ?? { registerPlugin };
  for (const plugin of getOverviewPlugins()) {
    try {
      api.registerPlugin(plugin);
    } catch (err) {
      // 已注册过（热重载场景）→ 跳过；其他错误继续抛
      if (!(err instanceof Error) || !err.message.includes('插件 id 重复')) throw err;
    }
  }
}

/**
 * 创建并组装「总览」页。
 *
 * 页面结构 = 页头（标题 + 刷新全部）+ 插件宿主容器。
 * 每个区块都是独立插件，自己订阅自己的数据源、自己渲染 loading/error/empty。
 *
 * 用法（宿主 / 路由层）：
 *   const page = createOverviewPage({ services: { navigate } });
 *   container.appendChild(page.root);   // 内部已 mount 全部插件并开始加载
 *   ...
 *   page.refreshAll();                  // 刷新全部数据源
 *   page.destroy();                     // 卸载全部插件 + 停轮询
 *
 * @param {Object} [options]
 * @param {Object} [options.services]  传给 ctx 的共享服务（如 navigate）
 * @param {Object} [options.resources] 复用外部数据源（缺省时新建）
 * @returns {{root: HTMLElement, ctx: Object, resources: Object,
 *            plugins: Object[], handle: Object,
 *            refreshAll: () => Promise<void>, destroy: () => void}}
 */
export function createOverviewPage({ services = {}, resources: injected } = {}) {
  const resources = injected ?? createOverviewResources();

  const root = el('div', { class: 'hz-page hz-page--overview' });

  /* ---------- 页头 ---------- */
  const header = el('header', { class: 'hz-page__head' });
  const titles = el('div', { class: 'hz-page__titles' });
  titles.appendChild(el('h1', { class: 'hz-page__title', text: STRINGS.pageTitle }));
  titles.appendChild(el('p', { class: 'hz-page__hint', text: STRINGS.pageHint }));
  header.appendChild(titles);

  const refreshBtn = Button({
    label: STRINGS.refreshAll,
    variant: 'outline',
    icon: Icon('refresh', { size: 14 }),
    onClick: () => {
      void refreshAll();
    },
  });
  header.appendChild(el('div', { class: 'hz-page__actions' }, [refreshBtn]));
  root.appendChild(header);

  /* ---------- 插件宿主 ---------- */
  const pluginHost = el('div', { class: 'hz-page__plugins' });
  root.appendChild(pluginHost);

  /* ---------- 上下文 + 挂载 ---------- */
  const ctx = createContext({ root, resources, services });
  const plugins = getOverviewPlugins();
  const handle = mountAll(pluginHost, ctx, { plugins });

  /** 刷新全部共享数据源。单个失败不影响其他（错误各自呈现在自己区块里）。 */
  const refreshAll = async () => {
    await Promise.allSettled(Object.values(resources).map((resource) => resource.refresh()));
  };

  /** 卸载：插件解绑订阅、中止在途请求。**幂等**。 */
  const destroy = () => {
    handle.unmountAll();
    // 共享 Resource 可能没有插件再持有，主动中止在途请求
    for (const resource of Object.values(resources)) resource.abort?.();
  };

  return { root, ctx, resources, plugins, handle, refreshAll, destroy };
}

/* ========================================================================== *
 * 默认导出：一个可直接被宿主调用的装配函数
 * ========================================================================== */

export default {
  STRINGS,
  createOverviewResources,
  getOverviewPlugins,
  registerOverviewPlugins,
  createOverviewPage,
  // 纯渲染函数（便于测试与复用）
  renderStats,
  renderHostResources,
  renderConnections,
  renderSessions,
  renderNotifications,
  renderAlerts,
  renderMigration,
  // 派生计算
  summarizeProcesses,
  splitMemory,
  shortDistro,
  staleAwareHint,
  // 枚举映射
  PROCESS_STATUS_TONE,
  ADAPTER_STATUS_TONE,
  LOG_LEVEL_TONE,
};