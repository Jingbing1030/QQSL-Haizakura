/**
 * config-plugin.js — Haizakura WebUI 账号配置页（原子化 / 插件化 / 服务端状态驱动）
 * =============================================================================
 * 重写编译后 502KB 的 `config-page-B0emcOKR.js`（该文件含大量内嵌字典数据，
 * 实际 UI 逻辑只占很小一部分）。本实现按「账号 → 节点分类 → 节点」三层拆分，
 * 每个账号配置走一个 Resource，加载 / 保存 / 热重载状态全部由服务端响应驱动。
 *
 * 复用（不重复造轮子）
 * -----------------------------------------------------------------------------
 *   ./atoms.js       el / Card / Button / Badge / Toggle / KeyValueList /
 *                    EmptyState / ErrorState / Spinner / Icon / stateView /
 *                    display / formatTime / STRINGS as A
 *   ./data-layer.js  Resource / request
 *   ./plugin.js      definePlugin / registerPlugin
 *
 * 设计约束
 * -----------------------------------------------------------------------------
 * 1) 原子化：控件全部来自 atoms.js，本文件只做组合与数据接线。
 * 2) 插件化：导出 definePlugin({id,title,mount,unmount,refresh}) + 注册函数。
 * 3) 服务端状态驱动：账号列表、账号配置、保存结果都读真实响应；
 *    「已保存并热重载」/「已保存，待下次连接生效」/「热重载失败」三种结果
 *    严格按服务端返回的 saved / applied / online / reloaded / errors 呈现，
 *    **不猜测、不乐观谎报**。
 * 4) 未保存修改保护：切换账号 / 关闭页面前提示（脏状态标记）。
 *
 * 真实 API（均已在 snowluma-hz 容器探针 + 服务端源码双向核对）
 * -----------------------------------------------------------------------------
 *   GET  /api/qq-list                → { list: [ { uin, nickname } ] }
 *   GET  /api/config/:uin            → { config: OneBotConfig }
 *   POST /api/config/:uin  (body=OneBotConfig 本体)
 *        → { success, saved, applied, online, errors[], adapters, config,
 *            reloaded, message }
 *   GET  /api/processes              → { list: [ { uin, status, account } ] }（判断在线）
 *   GET  /api/connections            → { list: [ { uin, adapters:[{name,kind,status,detail}] } ] }
 *   GET  /api/notifications/config   → { config: { channels[] } }（渠道多选）
 *   GET  /api/global-config          → { config: { musicSignUrl } }（只读展示）
 *
 * OneBotConfig 结构（服务端 assertValidOneBotConfig 强校验）
 * -----------------------------------------------------------------------------
 * {
 *   networks: {
 *     httpServers: [{ name, enabled?, accessToken?, protocol?, messageFormat,
 *                     reportSelfMessage, maxPayloadBytes?,
 *                     host?, port, path?, enableWebSocket?, enableSse? }],
 *     httpClients: [{ name, enabled?, accessToken?, protocol?, messageFormat,
 *                     reportSelfMessage, url, timeoutMs? }],
 *     wsServers:   [{ name, enabled?, accessToken?, protocol?, messageFormat,
 *                     reportSelfMessage, maxPayloadBytes?,
 *                     host?, port, path?, role? }],
 *     wsClients:   [{ name, enabled?, accessToken?, protocol?, messageFormat,
 *                     reportSelfMessage, maxPayloadBytes?, url, role?,
 *                     reconnectIntervalMs? }]
 *   },
 *   statusCommand: { enabled:boolean, swallow:boolean, cooldownSeconds:number, trigger:string },
 *   historySync:   { enabled:boolean },
 *   notifications: { channelIds: string[] }
 * }
 *
 * 服务端硬约束（违反即 400，前端必须提前拦住）
 * -----------------------------------------------------------------------------
 * - `name` 非空、无首尾空格、**跨四类唯一**（同一个名字不能同时出现在两类里）
 * - httpServers/wsServers：`port` 为 1..65535 整数；`host` 若给出必须是不含
 *   /?#@ 的有效绑定地址；`path` 必须以 / 开头、不含 ? #、且是规范化 pathname
 * - 同一 host:port（含 0.0.0.0/:: 通配）不得重复绑定
 * - httpClients 的 url 必须是 http:/https:；wsClients 必须是 ws:/wss:；
 *   适配器 enabled 时 url 不可为空
 * - wsClients.reconnectIntervalMs 为 1000..2147483647
 * - maxPayloadBytes 为 1024..2147483648（httpClients 不接受该字段）
 * - messageFormat ∈ {array, string}；reportSelfMessage 必须是 boolean
 * - role ∈ {Api, Event, Universal}
 * - statusCommand.trigger：非空、单行、≤32 字符；cooldownSeconds 为非负整数
 * - notifications.channelIds：匹配 /^[\w.-]+$/、≤64 字符
 *
 * accessToken 策略（服务端 validateOneBotAccessTokenChanges）
 * -----------------------------------------------------------------------------
 * - 令牌未变更（按同名或同下标比对）→ 直接放行
 * - 令牌为空：仅当 adapter.host 是本机回环地址，或请求来自回环客户端时放行；
 *   否则报「未绑定本机地址，远程保存必须填写令牌」
 * - 令牌非空：长度须 ≥16，且 zxcvbn 强度分 ≥3，否则拒绝
 * 因此前端在「清空令牌 + 非本机绑定」时必须先拦住，否则保存必然失败。
 *
 * @module config-plugin
 */

import {
  el,
  display,
  formatTime,
  Card,
  Button,
  Badge,
  Toggle,
  EmptyState,
  ErrorState,
  Spinner,
  Icon,
  KeyValueList,
  stateView,
  STRINGS as A,
} from './atoms.js';

import { Resource, request } from './data-layer.js';

import { definePlugin, registerPlugin } from './plugin.js';

/* ========================================================================== *
 * STRINGS — 本页全部用户可见文案
 * 取自编译产物 config-page-B0emcOKR.js 的原始中文（109 条中的配置页部分）。
 * ========================================================================== */

export const STRINGS = {
  /* ---- 页面 ---- */
  pageTitle: '账号配置',
  pageHint: 'OneBot 协议端点',
  loading: '正在读取…',
  loadFailed: '加载账号配置失败',
  unavailable: '账号配置不可用',
  retry: '重试',
  refresh: '刷新',
  cancel: '取消',
  close: '关闭',
  save: '保存',
  saving: '保存中…',
  savingShort: '保存中',
  saved: '已保存',
  unsaved: '未保存',
  unsavedChanges: '还有未保存的修改。',
  dirtySwitchTitle: '放弃未保存的修改？',
  dirtySwitchBody: '当前会话 {uin} 还有未保存的修改。切换到 {next} 会丢弃这些修改。',
  dirtySwitchConfirm: '放弃并切换',
  add: '新建',
  edit: '编辑',
  remove: '删除',
  enabled: '启用',
  disabled: '未启用',
  copy: '复制',
  copied: '已复制',
  copyFailed: '复制失败，请手动选择并拷贝。',
  hide: '隐藏',
  show: '显示',

  /* ---- 账号列表 ---- */
  accountList: '账号列表',
  account: '账号 {uin}',
  expandAccounts: '展开账号列表',
  collapseAccounts: '收起账号列表',
  noAccounts: '没有可配置的 QQ 账号。',
  noAccountsHint: '先在「进程」页加载一个 QQ 账号。',
  onlineBadge: '在线',
  offlineBadge: '离线',
  loadAccountsFailed: '加载账号列表失败',

  /* ---- 保存结果（严格对应服务端 message/saved/applied/online） ---- */
  saveOkApplied: '配置已保存并完成热重载。',
  saveOkPending: '配置已保存，将在账号下次连接时应用。',
  saveOkPartial: '配置已保存，但部分网络节点未能应用；旧节点已尽力恢复，请查看错误详情。',
  saveOkReloadFailed: '配置已保存，但热重载失败，请检查服务器日志。',
  saveNotConfirmed: '服务器未确认配置已保存。',
  saveFailed: '保存失败：{message}',
  saveFailuresHeading: '应用失败明细',
  saveFailureItem: '{name} · {phase} · {message}',
  previousSaved: '上一版本已保存，当前修改待保存。',
  unsavedDot: '未保存',

  /* ---- 节点分类（编译产物 X 常量） ---- */
  groupGeneral: '通用设置',
  kindHttpServers: 'HTTP API',
  kindHttpServersHint: '本地监听 HTTP 端口，OneBot 客户端发起请求',
  kindHttpServersNoun: 'HTTP API 服务',
  kindHttpClients: 'HTTP 客户端',
  kindHttpClientsHint: '主动向远端 URL POST 推送事件',
  kindHttpClientsNoun: 'HTTP 推送客户端',
  kindWsServers: 'WS 服务端',
  kindWsServersHint: '本地监听 WebSocket 端口，客户端建立持久连接',
  kindWsServersNoun: 'WebSocket 服务',
  kindWsClients: 'WS 客户端',
  kindWsClientsHint: '主动连接到外部 WebSocket 服务器（reverse-ws）',
  kindWsClientsNoun: 'WebSocket 反向客户端',
  tabCategories: '节点配置分类',
  nodeEmpty: '该分类下还没有节点。',
  nodeAdd: '新建{noun}',
  nodeEdit: '编辑{noun}',

  /* ---- 节点字段 ---- */
  fieldName: '名称',
  fieldEnabled: '启用',
  fieldAccessToken: '访问令牌 (accessToken)',
  fieldAccessTokenHint: '留空将关闭该服务端的鉴权，仅建议在本机使用。',
  fieldMessageFormat: '消息格式',
  messageFormatArray: '数组',
  messageFormatString: 'CQ 码',
  fieldMessageFormatHint: '数组为标准 OneBot 段，CQ 码为兼容字符串',
  fieldReportSelf: '上报自身消息',
  fieldReportSelfHint: '将机器人自己发送的消息也作为 message_sent 事件上报',
  fieldHost: '主机',
  fieldPort: '端口',
  fieldPath: '路径',
  fieldUrl: '目标 URL',
  fieldTimeout: '超时 (ms)',
  fieldReconnect: '重连间隔 (ms)',
  fieldMaxPayload: '单帧上限 (bytes)',
  fieldRole: '角色',
  fieldRoleHint: 'Universal 收发合一，Event / Api 分离',
  fieldEnableWebSocket: '启用 WebSocket',
  fieldEnableWebSocketHint: '复用当前 HTTP 端口和授权 Token 接收 WebSocket 连接',
  fieldEnableSse: '启用 SSE',
  fieldEnableSseHint: '通过当前 HTTP 路径下的 /_events 持续推送事件，支持短暂断线重放',
  fieldProtocol: '协议',
  summariseNoUrl: '(未设置 URL)',

  /* ---- 令牌强度提示（与服务端 assessAccessToken 一致） ---- */
  tokenEmptyLocal: '留空将关闭该服务端的鉴权，仅建议在本机使用。',
  tokenEmptyRemote: '未绑定本机地址时，远程访问必须填写令牌；请生成令牌或将主机改为 127.0.0.1。',
  tokenTooShort: '令牌至少需要 16 个字符，请继续补充或重新生成。',
  tokenGuessable: '令牌容易被猜中，请使用右侧按钮生成新的随机令牌。',
  tokenOk: '令牌强度符合要求。',
  tokenGenerate: '生成随机令牌',

  /* ---- 校验错误（前端预校验，与服务端规则一致） ---- */
  errNameRequired: '名称不能为空',
  errNameWhitespace: '名称不能有首尾空格',
  errNameDuplicate: '名称与其它节点重复（四类节点中必须唯一）',
  errHostInvalid: '主机必须是有效的绑定地址（不能包含空格 / ? # @）',
  errPortInvalid: '端口必须是 1–65535 的整数',
  errPathInvalid: '路径必须以 / 开头，且不能包含 ? 或 #',
  errUrlRequired: '启用状态下必须填写 URL',
  errUrlHttp: 'URL 必须是 http(s) 地址',
  errUrlWs: 'URL 必须是 ws(s) 地址',
  errPortConflict: '与节点「{name}」的 {host}:{port} 绑定冲突',
  errTimeoutInvalid: '超时必须是不小于 1 的整数',
  errReconnectInvalid: '重连间隔必须在 1000–2147483647 之间',
  errMaxPayloadInvalid: '单帧上限必须在 1024–2147483648 之间',
  errTriggerRequired: '触发词不能为空，且不超过 32 字符',
  errCooldownInvalid: '冷却时间必须是非负整数',
  errChannelIdInvalid: '通知渠道 ID 格式无效',
  errRoleInvalid: '角色必须是 Api / Event / Universal',

  /* ---- 通用设置（statusCommand / historySync / notifications） ---- */
  generalTitle: '通用设置',
  generalHint: '状态命令、历史同步与上线/下线通知。',
  statusCommandTitle: '内置状态命令',
  statusCommandHint: '收到纯文本 {trigger} 时回复 Haizakura 版本 / 平台 / 运行时长。任何人可触发，关闭后完全不响应。',
  statusCommandEnabled: '启用状态命令',
  statusCommandTrigger: '触发词',
  statusCommandTriggerHint: '自定义触发词，默认 {default}。最长 32 字符，匹配前会去除首尾空格并转为小写。',
  statusCommandSwallow: '不转发给下游 (swallow)',
  statusCommandSwallowHint: '开启后，命中的触发词不再投递给已连接的 Bot（仍会回复并本地记录）。默认关闭即透传。',
  statusCommandCooldown: '回复冷却（秒）',
  statusCommandCooldownHint: '同一会话在该秒数内重复触发不再回复，防刷屏。0 表示不限制。',
  historySyncTitle: '登录时补齐云端历史记录',
  historySyncHint: '下次账号登录或重启后生效。只静默写入本地消息库，不重放历史事件，也不改变 QQ 已读状态。每次最多处理 3 个群和 3 个好友、每个会话 20 条，自动请求至少间隔 2 秒。',
  historySyncEnabled: '启用历史同步',
  notificationsTitle: '上下线通知渠道',
  notificationsHint: '该账号上线 / 下线时向选中的渠道推送通知。渠道在「设置 → 通知」中全局定义。',
  notificationsEmpty: '尚未定义任何通知渠道（请到「设置 → 通知」新增）。',
  notificationsSelected: '已选 {selected} / 共 {total}',
  notificationsLoadFailed: '加载通知渠道失败',
  channelPrefix: '渠道',

  /* ---- 连接状态 ---- */
  connectionsTitle: '在线连接',
  connectionsHint: '当前账号已生效的协议适配器状态。',
  connectionsEmpty: '暂无在线会话。',
  connectionsLoadFailed: '加载连接状态失败',
  statusOk: '正常',
  statusWarn: '注意',
  statusError: '异常',
  statusIdle: '未启用',
  statusFailed: '应用失败',
  timeUnknown: '时间未知',
  thisNode: '该节点',

  /* ---- 未保存提示 ---- */
  dirtyNotice: '有未保存的修改',
  discard: '放弃修改',
};

/* ========================================================================== *
 * 常量
 * ======================================================================== */

/** 四类节点分类（编译产物 X 常量；title/description/noun 与 summarize 语义一致）。 */
export const NODE_KINDS = {
  httpServers: {
    key: 'httpServers',
    title: STRINGS.kindHttpServers,
    hint: STRINGS.kindHttpServersHint,
    noun: STRINGS.kindHttpServersNoun,
    side: 'server',
    urlProtocols: null,
    hasRole: false,
    hasWebSocketFlags: true,
    hasTimeout: false,
    hasReconnect: false,
    acceptsMaxPayload: true,
    defaultPort: 3000,
  },
  httpClients: {
    key: 'httpClients',
    title: STRINGS.kindHttpClients,
    hint: STRINGS.kindHttpClientsHint,
    noun: STRINGS.kindHttpClientsNoun,
    side: 'client',
    urlProtocols: ['http:', 'https:'],
    hasRole: false,
    hasWebSocketFlags: false,
    hasTimeout: true,
    hasReconnect: false,
    acceptsMaxPayload: false,
    defaultPort: null,
    defaultUrl: 'http://127.0.0.1:5700',
  },
  wsServers: {
    key: 'wsServers',
    title: STRINGS.kindWsServers,
    hint: STRINGS.kindWsServersHint,
    noun: STRINGS.kindWsServersNoun,
    side: 'server',
    urlProtocols: null,
    hasRole: true,
    hasWebSocketFlags: false,
    hasTimeout: false,
    hasReconnect: false,
    acceptsMaxPayload: true,
    defaultPort: 3001,
  },
  wsClients: {
    key: 'wsClients',
    title: STRINGS.kindWsClients,
    hint: STRINGS.kindWsClientsHint,
    noun: STRINGS.kindWsClientsNoun,
    side: 'client',
    urlProtocols: ['ws:', 'wss:'],
    hasRole: true,
    hasWebSocketFlags: false,
    hasTimeout: false,
    hasReconnect: true,
    acceptsMaxPayload: true,
    defaultPort: null,
    defaultUrl: 'ws://127.0.0.1:8080/ws',
  },
};

/** 节点分类展示顺序（编译产物 mn：general 在最前）。 */
export const NODE_KIND_ORDER = ['general', 'httpServers', 'httpClients', 'wsServers', 'wsClients'];

/** 入站类型（服务端 INBOUND_KINDS，受 accessToken 策略约束）。 */
export const INBOUND_KINDS = ['httpServers', 'wsServers'];

/** 角色白名单。 */
export const ROLE_OPTIONS = [
  { value: 'Universal', label: 'Universal' },
  { value: 'Api', label: 'Api' },
  { value: 'Event', label: 'Event' },
];

/** 消息格式。 */
export const MESSAGE_FORMAT_OPTIONS = [
  { value: 'array', label: STRINGS.messageFormatArray },
  { value: 'string', label: STRINGS.messageFormatString },
];

/** 服务端默认 statusCommand（DEFAULT_STATUS_COMMAND）。 */
export const DEFAULT_STATUS_COMMAND = {
  enabled: true,
  swallow: false,
  cooldownSeconds: 5,
  trigger: '#Haizakura',
};

/** 服务端硬性范围。 */
export const LIMITS = {
  portMin: 1,
  portMax: 65535,
  maxPayloadMin: 1024,
  maxPayloadMax: 2 * 1024 * 1024 * 1024,
  reconnectMin: 1000,
  reconnectMax: 2147483647,
  triggerMaxLength: 32,
  cooldownMax: 31536000,
  tokenMinLength: 16,
  nameMax: 100,
};

/** 判断是否本机回环绑定（服务端 isLoopbackBindHost 的等价实现）。 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

export function isLoopbackBindHost(host) {
  const value = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!value) return false;
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  return LOOPBACK_HOSTS.has(value) || value.startsWith('127.');
}

/* ========================================================================== *
 * 小工具
 * ======================================================================== */

export function fmt(template, vars) {
  if (typeof template !== 'string') return '';
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match);
}

function dash(value) {
  if (value === undefined || value === null || value === '') return A.empty;
  return value;
}

/** 生成 base64url 随机令牌（与服务端 generateAccessToken 同为 32 字节 → 43 字符）。 */
export function generateAccessToken(bytes) {
  const size = bytes || 32;
  const buffer = new Uint8Array(size);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buffer);
  } else {
    for (let i = 0; i < size; i += 1) buffer[i] = Math.floor(Math.random() * 256);
  }
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(buffer).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 令牌强度评估（镜像服务端 assessAccessToken 的两条硬规则）。 */
export function assessToken(token, { host, remote } = {}) {
  const value = typeof token === 'string' ? token : '';
  if (!value) {
    return isLoopbackBindHost(host) || remote === false
      ? { valid: true, tone: 'warn', message: STRINGS.tokenEmptyLocal }
      : { valid: false, tone: 'error', message: STRINGS.tokenEmptyRemote };
  }
  if (value.length < LIMITS.tokenMinLength) {
    return { valid: false, tone: 'error', message: STRINGS.tokenTooShort };
  }
  /* 服务端用 zxcvbn 打分；前端不引依赖，做保守的熵估计：
     长度足够且字符种类 ≥3 视为通过，否则提示可能被猜中。 */
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length;
  if (value.length < 20 && classes < 3) {
    return { valid: false, tone: 'error', message: STRINGS.tokenGuessable };
  }
  return { valid: true, tone: 'ok', message: STRINGS.tokenOk };
}

/* ========================================================================== *
 * 校验（严格镜像服务端 assertValidOneBotConfig 的可见错误）
 * ======================================================================== */

/** 有效绑定地址（服务端 isValidBindHost$1 的等价实现）。 */
export function isValidBindHost(value) {
  const host = String(value || '');
  if (!host || host !== host.trim()) return false;
  if (!host || host.length > 253) return false;
  if (/[\s/?#@]/u.test(host)) return false;
  if (host.includes(':')) {
    /* IPv6：只做粗略校验（不含非法字符且至少一个冒号） */
    return /^[0-9a-fA-F:.]+$/.test(host);
  }
  if (/^[\d.]+$/.test(host)) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split('.').every((n) => Number(n) <= 255);
  }
  const trimmed = host.endsWith('.') ? host.slice(0, -1) : host;
  return trimmed.split('.').every((label) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(label));
}

function normalisedPath(value) {
  const raw = String(value === undefined || value === null || value === '' ? '/' : value);
  if (!raw.startsWith('/')) return null;
  if (raw.includes('?') || raw.includes('#')) return null;
  try {
    const url = new URL('http://127.0.0.1' + raw);
    return url.pathname === raw ? raw : null;
  } catch {
    return null;
  }
}

function parseUrl(value) {
  try {
    return new URL(String(value).trim());
  } catch {
    return null;
  }
}

/**
 * 校验单个节点。
 * @param {string} kind   NODE_KINDS 的 key
 * @param {Object} node   待校验节点
 * @param {Object} context { otherNames: string[], bindings: Map, index: number }
 * @returns {string|null} 错误文案，null 表示通过
 */
export function validateNode(kind, node, context = {}) {
  const spec = NODE_KINDS[kind];
  if (!spec) return null;
  const otherNames = context.otherNames || [];
  const bindings = context.bindings || new Map();

  const name = typeof node.name === 'string' ? node.name : '';
  if (!name.trim()) return STRINGS.errNameRequired;
  if (name !== name.trim()) return STRINGS.errNameWhitespace;
  if (otherNames.includes(name)) return STRINGS.errNameDuplicate;

  if (spec.side === 'server') {
    if (!Number.isInteger(node.port) || node.port < LIMITS.portMin || node.port > LIMITS.portMax) {
      return STRINGS.errPortInvalid;
    }
    if (node.host !== undefined && node.host !== '') {
      if (typeof node.host !== 'string') return STRINGS.errHostInvalid;
      if (!isValidBindHost(node.host)) return STRINGS.errHostInvalid;
    }
    if (node.path !== undefined && node.path !== '') {
      if (normalisedPath(node.path) === null) return STRINGS.errPathInvalid;
    }
    /* 绑定冲突检测（仅对启用节点） */
    if (node.enabled !== false) {
      const host = (typeof node.host === 'string' && node.host.trim() ? node.host.trim() : '0.0.0.0').toLowerCase();
      const exact = host + ':' + node.port;
      if (bindings.has(exact) && bindings.get(exact) !== context.index) {
        return fmt(STRINGS.errPortConflict, { name: bindings.get(exact + '::name') || '', host, port: node.port });
      }
      const isWildcard = host === '0.0.0.0' || host === '::' || host === '[::]';
      if (isWildcard) {
        for (const key of bindings.keys()) {
          if (key.endsWith(':' + node.port) && bindings.get(key) !== context.index) {
            return fmt(STRINGS.errPortConflict, { name: bindings.get(key + '::name') || '', host, port: node.port });
          }
        }
      }
    }
  } else {
    const url = typeof node.url === 'string' ? node.url.trim() : '';
    if (node.enabled !== false && !url) return STRINGS.errUrlRequired;
    if (url) {
      const parsed = parseUrl(url);
      if (!parsed) return spec.urlProtocols && spec.urlProtocols[0] === 'ws:' ? STRINGS.errUrlWs : STRINGS.errUrlHttp;
      if (spec.urlProtocols && !spec.urlProtocols.includes(parsed.protocol)) {
        return spec.urlProtocols[0] === 'ws:' ? STRINGS.errUrlWs : STRINGS.errUrlHttp;
      }
    }
    if (spec.hasTimeout && node.timeoutMs !== undefined) {
      if (!Number.isSafeInteger(node.timeoutMs) || node.timeoutMs <= 0) return STRINGS.errTimeoutInvalid;
    }
  }

  if (spec.hasReconnect && node.reconnectIntervalMs !== undefined) {
    if (!Number.isSafeInteger(node.reconnectIntervalMs)
      || node.reconnectIntervalMs < LIMITS.reconnectMin
      || node.reconnectIntervalMs > LIMITS.reconnectMax) {
      return STRINGS.errReconnectInvalid;
    }
  }
  if (spec.acceptsMaxPayload && node.maxPayloadBytes !== undefined) {
    if (!Number.isSafeInteger(node.maxPayloadBytes)
      || node.maxPayloadBytes < LIMITS.maxPayloadMin
      || node.maxPayloadBytes > LIMITS.maxPayloadMax) {
      return STRINGS.errMaxPayloadInvalid;
    }
  }
  if (spec.hasRole && node.role !== undefined && !['Api', 'Event', 'Universal'].includes(node.role)) {
    return STRINGS.errRoleInvalid;
  }
  return null;
}

/**
 * 校验整个 OneBotConfig。返回第一个错误（null 表示通过）。
 * 与服务端一致：先按分类逐项校验，再复查跨类 name 唯一性与端口冲突。
 */
export function validateConfig(config) {
  if (!config || typeof config !== 'object') return STRINGS.unavailable;
  const networks = config.networks;
  if (!networks || typeof networks !== 'object') return STRINGS.unavailable;

  /* 跨四类的 name 唯一性 */
  const seen = new Map();
  for (const kind of ['httpServers', 'httpClients', 'wsServers', 'wsClients']) {
    const list = networks[kind];
    if (!Array.isArray(list)) return fmt(STRINGS.saveFailed, { message: 'networks.' + kind + ' 必须是数组' });
    for (const node of list) {
      if (!node || typeof node !== 'object') return fmt(STRINGS.saveFailed, { message: 'networks.' + kind + ' 含非对象项' });
      const name = typeof node.name === 'string' ? node.name : '';
      if (!name.trim()) return STRINGS.errNameRequired;
      if (name !== name.trim()) return STRINGS.errNameWhitespace;
      if (seen.has(name)) return STRINGS.errNameDuplicate;
      seen.set(name, kind);
    }
  }

  /* 逐项字段校验（不含绑定冲突） */
  for (const kind of ['httpServers', 'httpClients', 'wsServers', 'wsClients']) {
    const list = networks[kind] || [];
    for (const node of list) {
      const err = validateNode(kind, node, { otherNames: [] });
      if (err) return err;
    }
  }

  /* 绑定冲突：严格复刻服务端 validateServerBinding 的**顺序注册**语义。
     服务端边遍历边登记，冲突时报「当前节点 vs 已登记的先前节点」，
     因此旧节点才是消息里被点名的一方；这里保持一致，避免指错节点。 */
  const bindings = new Map();
  for (const kind of ['httpServers', 'wsServers']) {
    const list = networks[kind] || [];
    for (const node of list) {
      if (node.enabled === false) continue;
      const host = (typeof node.host === 'string' && node.host.trim() ? node.host.trim() : '0.0.0.0').toLowerCase();
      const port = node.port;
      const exact = host + ':' + port;
      const exactPrevious = bindings.get(exact);
      if (exactPrevious) {
        return fmt(STRINGS.errPortConflict, { name: exactPrevious, host, port });
      }
      const wildcardKey = '*:' + port;
      const wildcardPrevious = bindings.get(wildcardKey);
      if (wildcardPrevious) {
        return fmt(STRINGS.errPortConflict, { name: wildcardPrevious, host: '0.0.0.0', port });
      }
      if (host === '0.0.0.0' || host === '::' || host === '[::]') {
        for (const [key, name] of bindings.entries()) {
          if (key.endsWith(':' + port)) {
            return fmt(STRINGS.errPortConflict, { name, host, port });
          }
        }
        bindings.set(wildcardKey, node.name);
      }
      bindings.set(exact, node.name);
    }
  }

  /* statusCommand */
  const status = config.statusCommand;
  if (!status || typeof status !== 'object') return fmt(STRINGS.saveFailed, { message: 'statusCommand 必须是对象' });
  if (typeof status.enabled !== 'boolean') return fmt(STRINGS.saveFailed, { message: 'statusCommand.enabled 必须是布尔值' });
  if (typeof status.swallow !== 'boolean') return fmt(STRINGS.saveFailed, { message: 'statusCommand.swallow 必须是布尔值' });
  if (!Number.isInteger(status.cooldownSeconds) || status.cooldownSeconds < 0) return STRINGS.errCooldownInvalid;
  const trigger = typeof status.trigger === 'string' ? status.trigger : '';
  if (!trigger.trim() || trigger.length > LIMITS.triggerMaxLength || /[\r\n]/.test(trigger)) {
    return STRINGS.errTriggerRequired;
  }

  /* historySync */
  if (!config.historySync || typeof config.historySync.enabled !== 'boolean') {
    return fmt(STRINGS.saveFailed, { message: 'historySync.enabled 必须是布尔值' });
  }

  /* notifications.channelIds */
  if (config.notifications !== undefined) {
    const ids = config.notifications && config.notifications.channelIds;
    if (!Array.isArray(ids)) return fmt(STRINGS.saveFailed, { message: 'notifications.channelIds 必须是数组' });
    for (const id of ids) {
      if (typeof id !== 'string' || !id || id.length > 64 || !/^[\w.-]+$/.test(id)) {
        return STRINGS.errChannelIdInvalid;
      }
    }
  }
  return null;
}

/**
 * 校验 accessToken 变更（镜像服务端 validateOneBotAccessTokenChanges）。
 * 只对入站类型（httpServers / wsServers）生效。
 */
export function validateAccessTokens(previous, next, { allowEmpty = false } = {}) {
  for (const kind of INBOUND_KINDS) {
    const previousList = (previous && previous.networks && previous.networks[kind]) || [];
    const nextList = (next && next.networks && next.networks[kind]) || [];
    for (let index = 0; index < nextList.length; index += 1) {
      const adapter = nextList[index];
      const token = typeof adapter.accessToken === 'string' ? adapter.accessToken : '';
      const named = previousList.find((item) => item.name === adapter.name);
      const unchanged = (named && (named.accessToken || '') === token)
        || (previousList[index] && previousList[index].accessToken === token);
      if (unchanged) continue;
      if (!token) {
        if (allowEmpty || isLoopbackBindHost(adapter.host)) continue;
        return fmt(STRINGS.tokenEmptyRemote, {});
      }
      const assessment = assessToken(token, { host: adapter.host });
      if (!assessment.valid) return assessment.message;
    }
  }
  return null;
}

/* ========================================================================== *
 * 样式（仅补 atoms.js 未覆盖的类名，幂等注入）
 * ======================================================================== */

const STYLE_ID = 'hz-config-plugin-styles';

export function ensureConfigStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.hz-cfg{display:flex;flex-direction:column;gap:16px}
.hz-cfg__toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.hz-cfg__heading{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}
.hz-cfg__sub{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.hz-cfg__actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.hz-cfg__layout{display:flex;flex-direction:column;gap:16px}
@media (min-width:768px){.hz-cfg__layout{flex-direction:row;align-items:flex-start;gap:20px}}
.hz-cfg__accounts{display:flex;flex-direction:column;gap:4px;min-width:0}
@media (min-width:768px){.hz-cfg__accounts{width:208px;flex-shrink:0}}
.hz-cfg__account{display:flex;align-items:center;gap:8px;border:1px solid transparent;background:transparent;border-radius:8px;padding:7px 10px;font-size:13px;text-align:left;color:var(--muted-foreground);cursor:pointer;min-height:36px}
.hz-cfg__account:hover{background:var(--accent);color:var(--foreground)}
.hz-cfg__account.is-active{border-color:var(--primary);background:color-mix(in oklab, var(--primary) 12%, transparent);color:var(--primary)}
.hz-cfg__account-uin{margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;opacity:.7}
.hz-cfg__panel{display:flex;flex-direction:column;gap:16px;min-width:0;flex:1}
.hz-cfg__tabs{display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--border);padding-bottom:2px}
.hz-cfg__tab{position:relative;display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:8px 11px;font-size:13px;color:var(--muted-foreground);cursor:pointer;min-height:40px}
.hz-cfg__tab:hover{color:var(--foreground)}
.hz-cfg__tab.is-active{color:var(--foreground)}
.hz-cfg__tab.is-active::after{content:'';position:absolute;left:8px;right:8px;bottom:-2px;height:2px;border-radius:999px;background:var(--primary)}
.hz-cfg__tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:16px;padding:0 5px;border-radius:999px;background:var(--secondary);color:var(--secondary-foreground);font-size:10px;font-variant-numeric:tabular-nums}
.hz-cfg__tab.is-active .hz-cfg__tab-count{background:var(--primary);color:var(--primary-foreground)}
.hz-cfg__nodes{display:flex;flex-direction:column}
.hz-cfg__node{display:flex;flex-direction:column;gap:10px;padding:14px 20px;border-bottom:1px solid color-mix(in oklab, var(--border) 60%, transparent)}
.hz-cfg__node:last-child{border-bottom:0}
.hz-cfg__node-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.hz-cfg__node-name{font-size:13px;font-weight:600}
.hz-cfg__node-summary{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--muted-foreground);word-break:break-all}
.hz-cfg__node-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:auto}
.hz-row{display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid color-mix(in oklab, var(--border) 60%, transparent)}
.hz-row:last-child{border-bottom:0}
.hz-row--inline{flex-direction:column}
.hz-row--stack{flex-direction:column}
@media (min-width:640px){.hz-row--inline{flex-direction:row;align-items:center;justify-content:space-between;gap:24px}}
.hz-row__text{display:flex;flex-direction:column;gap:3px;min-width:0}
.hz-row__label{font-size:13px;font-weight:500}
.hz-row__hint{margin:0;font-size:12px;line-height:1.5;color:var(--muted-foreground)}
.hz-row__control{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.hz-input,.hz-select,.hz-textarea{border:1px solid var(--border);border-radius:8px;background:var(--background);color:var(--foreground);padding:7px 9px;font-size:13px;width:100%;max-width:22rem}
.hz-textarea{max-width:100%;min-height:4.5rem;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5}
.hz-input--number{max-width:9rem}
.hz-input--token{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.hz-field{display:flex;flex-direction:column;gap:6px;padding:12px 20px;border-bottom:1px solid color-mix(in oklab, var(--border) 60%, transparent)}
.hz-field:last-child{border-bottom:0}
.hz-field__label{font-size:12px;font-weight:500}
.hz-field__hint{font-size:11px;color:var(--muted-foreground);line-height:1.5}
.hz-dialog .hz-field{padding:8px 0;border-bottom:0}
.hz-notice{margin:0;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:12px;line-height:1.55}
.hz-notice--error{border-color:var(--destructive);color:var(--destructive)}
.hz-notice--warning{border-color:var(--warning,#d97706);color:var(--warning,#d97706)}
.hz-notice--success{border-color:var(--success,#16a34a);color:var(--success,#16a34a)}
.hz-notice--info{color:var(--muted-foreground)}
.hz-notice__text{margin:0}
.hz-cfg__feedback{display:flex;flex-direction:column;gap:6px}
.hz-cfg__failures{margin:0;padding-left:18px;font-size:11.5px;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.hz-cfg__token-note{font-size:11px;line-height:1.5}
.hz-cfg__token-note--ok{color:var(--success,#16a34a)}
.hz-cfg__token-note--warn{color:var(--warning,#d97706)}
.hz-cfg__token-note--error{color:var(--destructive)}
.hz-cfg__channels{display:flex;flex-direction:column;gap:6px}
.hz-cfg__channel{display:flex;align-items:center;gap:8px;font-size:13px}
.hz-cfg__conn{display:flex;flex-direction:column;gap:2px;padding:10px 20px;border-bottom:1px solid color-mix(in oklab, var(--border) 60%, transparent);font-size:12.5px}
.hz-cfg__conn:last-child{border-bottom:0}
.hz-cfg__conn-head{display:flex;align-items:center;gap:8px}
.hz-cfg__conn-name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.hz-cfg__conn-detail{color:var(--muted-foreground);font-size:11.5px}
.hz-dialog-overlay{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;background:rgb(0 0 0 / .45);padding:16px}
.hz-dialog-overlay.is-open{display:flex}
.hz-dialog{width:min(38rem,100%);max-height:86vh;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card);padding:16px;display:flex;flex-direction:column;gap:10px}
.hz-dialog__title{margin:0;font-size:15px;font-weight:600}
.hz-dialog__hint{margin:0;font-size:12px;color:var(--muted-foreground);line-height:1.5}
.hz-dialog__content{display:flex;flex-direction:column;gap:8px}
.hz-dialog__footer{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
`;
  document.head.appendChild(style);
}

/* ========================================================================== *
 * 表单原子（atoms.js 未提供 input/select/textarea，这里按其 el() 约定组合）
 * ======================================================================== */

export function fieldRow(label, control, hint, layout) {
  const text = el('div', { class: 'hz-row__text' }, [
    label ? el('span', { class: 'hz-row__label', text: label }) : null,
    hint ? el('p', { class: 'hz-row__hint', text: hint }) : null,
  ]);
  return el('div', { class: `hz-row hz-row--${layout || 'inline'}` }, [text, el('div', { class: 'hz-row__control' }, control)]);
}

export function formField(label, control, hint) {
  return el('label', { class: 'hz-field' }, [
    el('span', { class: 'hz-field__label', text: label }),
    control,
    hint ? el('span', { class: 'hz-field__hint', text: hint }) : null,
  ]);
}

export function textInput(value, { placeholder, type, onInput, readOnly, class: extraClass } = {}) {
  const node = el('input', {
    type: type || 'text',
    class: `hz-input${extraClass ? ' ' + extraClass : ''}`,
    placeholder: placeholder || null,
    autocomplete: 'off',
    spellcheck: 'false',
    readonly: readOnly ? true : null,
  });
  node.value = value === undefined || value === null ? '' : String(value);
  if (onInput) node.addEventListener('input', () => onInput(node.value));
  return node;
}

export function numberInput(value, { min, max, step, onInput, placeholder } = {}) {
  const node = el('input', {
    type: 'number',
    class: 'hz-input hz-input--number',
    min: min === undefined ? null : String(min),
    max: max === undefined ? null : String(max),
    step: step === undefined ? null : String(step),
    placeholder: placeholder || null,
  });
  node.value = value === undefined || value === null ? '' : String(value);
  if (onInput) node.addEventListener('input', () => onInput(node.value));
  return node;
}

export function selectControl(value, options, onChange, ariaLabel) {
  const node = el('select', { class: 'hz-select', 'aria-label': ariaLabel || null });
  for (const option of options) {
    const opt = el('option', { value: String(option.value), text: option.label });
    if (String(option.value) === String(value)) opt.selected = true;
    node.appendChild(opt);
  }
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

export function segmented(value, options, onChange, ariaLabel) {
  const group = el('div', { class: 'hz-btn-group', role: 'radiogroup', 'aria-label': ariaLabel || null });
  for (const option of options) {
    const active = option.value === value;
    const btn = el('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': active ? 'true' : 'false',
      'aria-label': option.label,
      class: `hz-btn hz-btn--${active ? 'primary' : 'outline'}`,
      onClick: () => onChange(option.value),
    });
    btn.appendChild(el('span', { class: 'hz-btn__label', text: option.label }));
    group.appendChild(btn);
  }
  return group;
}

/* ========================================================================== *
 * 极简模态框
 * ======================================================================== */

export function openDialog({ title, hint, content = [], confirmLabel, cancelLabel, destructive, onConfirm, wide } = {}) {
  const overlay = el('div', { class: 'hz-dialog-overlay' });
  const box = el('div', { class: 'hz-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  if (wide) box.style.width = 'min(48rem,100%)';
  box.appendChild(el('h3', { class: 'hz-dialog__title', text: title }));
  if (hint) box.appendChild(el('p', { class: 'hz-dialog__hint', text: hint }));

  const contentBox = el('div', { class: 'hz-dialog__content' });
  for (const node of content) if (node) contentBox.appendChild(node);
  box.appendChild(contentBox);

  const close = () => {
    overlay.classList.remove('is-open');
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  box.appendChild(el('div', { class: 'hz-dialog__footer' }, [
    Button({ label: cancelLabel || STRINGS.cancel, variant: 'ghost', onClick: close }),
    Button({
      label: confirmLabel || STRINGS.save,
      variant: destructive ? 'danger' : 'primary',
      onClick: () => { if (onConfirm) onConfirm(close); },
    }),
  ]));

  overlay.appendChild(box);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.classList.add('is-open');
  return { close, node: overlay, box };
}

/* ========================================================================== *
 * 数据源
 * ======================================================================== */

/** 账号列表 + 当前账号配置 + 连接状态 + 通知渠道。 */
export function createConfigResources() {
  return {
    /** GET /api/qq-list → { list: [{uin, nickname}] } */
    accounts: new Resource('configAccounts', {
      endpoint: '/api/qq-list',
      select: (payload) => payload.list || [],
    }),
    /** GET /api/processes（判断账号在线） */
    processes: new Resource('configProcesses', {
      endpoint: '/api/processes',
      select: (payload) => payload.list || [],
    }),
    /** GET /api/connections（适配器实时状态） */
    connections: new Resource('configConnections', {
      endpoint: '/api/connections',
      select: (payload) => payload.list || [],
    }),
    /** GET /api/notifications/config → 渠道列表用于多选 */
    channels: new Resource('configChannels', {
      endpoint: '/api/notifications/config',
      select: (payload) => (payload.config && payload.config.channels) || [],
    }),
  };
}

/**
 * 单个账号的 OneBot 配置 Resource（endpointFactory 按 uin 动态生成）。
 * @param {string} uin
 */
export function createAccountConfigResource(uin) {
  return new Resource(`configOneBot_${uin}`, {
    endpointFactory: () => `/api/config/${encodeURIComponent(uin)}`,
    select: (payload) => payload.config,
  });
}

/**
 * 保存账号配置。
 * @param {string} uin
 * @param {Object} config
 * @returns {Promise<Object>} 服务端响应（含 saved/applied/online/errors/message）
 */
export function saveAccountConfig(uin, config) {
  return request(`/api/config/${encodeURIComponent(uin)}`, { method: 'POST', body: config });
}

/**
 * 把保存响应翻译成 UI 反馈（严格按服务端字段，不臆测）。
 * @param {Object} result POST /api/config/:uin 的响应
 * @returns {{tone: 'ok'|'warn'|'error', text: string, failures: Array}}
 */
export function describeSaveResult(result) {
  if (!result || typeof result !== 'object') {
    return { tone: 'error', text: STRINGS.saveNotConfirmed, failures: [] };
  }
  const failures = Array.isArray(result.errors) ? result.errors : [];
  const failuresView = failures.map((item) => ({
    name: item && item.name ? item.name : STRINGS.thisNode,
    phase: item && item.phase ? item.phase : A.empty,
    message: item && item.message ? item.message : A.unknown,
    at: item && item.at ? formatTime(item.at) : STRINGS.timeUnknown,
  }));

  if (result.success !== true || result.saved !== true) {
    return {
      tone: 'error',
      text: fmt(STRINGS.saveFailed, { message: result.message || STRINGS.saveNotConfirmed }),
      failures: failuresView,
    };
  }
  if (failures.length > 0) {
    return { tone: 'warn', text: STRINGS.saveOkPartial, failures: failuresView };
  }
  if (result.online === false) {
    return { tone: 'warn', text: STRINGS.saveOkPending, failures: [] };
  }
  if (result.applied === true && result.reloaded === true) {
    return { tone: 'ok', text: STRINGS.saveOkApplied, failures: [] };
  }
  if (result.applied === true) {
    return { tone: 'ok', text: STRINGS.saveOkApplied, failures: [] };
  }
  /* 保存成功但 applied !== true：可能是热重载失败 */
  return { tone: 'warn', text: result.message || STRINGS.saveOkReloadFailed, failures: failuresView };
}

/* ========================================================================== *
 * 分区渲染
 * ======================================================================== */

/** 节点摘要（对齐编译产物 X[kind].summarize 的语义）。 */
export function summariseNode(kind, node) {
  if (kind === 'httpServers') {
    const host = (node.host || '0.0.0.0');
    const path = (node.path || '/').replace(/^\/?/, '/');
    return host + ':' + node.port + path
      + (node.enableWebSocket === true ? ' · WebSocket' : '')
      + (node.enableSse === true ? ' · SSE' : '');
  }
  if (kind === 'wsServers') {
    const host = (node.host || '0.0.0.0');
    const path = (node.path || '/').replace(/^\/?/, '/');
    return host + ':' + node.port + path + ' · ' + (node.role || 'Universal');
  }
  if (kind === 'httpClients') return node.url || STRINGS.summariseNoUrl;
  return (node.url || STRINGS.summariseNoUrl) + ' · ' + (node.role || 'Universal');
}

/** 节点列表（每个节点一张小卡：名称 + 摘要 + 状态 + 操作）。 */
export function renderNodeList(kind, nodes, handlers) {
  const spec = NODE_KINDS[kind];
  const { onAdd, onEdit, onRemove, onToggle } = handlers;
  const box = el('div', { class: 'hz-cfg__nodes' });

  if (!Array.isArray(nodes) || nodes.length === 0) {
    box.appendChild(EmptyState({
      title: STRINGS.nodeEmpty,
      action: [Button({ label: fmt(STRINGS.nodeAdd, { noun: spec.noun }), variant: 'outline', onClick: onAdd })],
      icon: Icon('plug', { size: 28 }),
    }));
    return box;
  }

  for (const node of nodes) {
    const enabled = node.enabled !== false;
    const head = el('div', { class: 'hz-cfg__node-head' }, [
      el('span', { class: 'hz-cfg__node-name', text: dash(node.name) }),
      Badge({ text: enabled ? STRINGS.enabled : STRINGS.disabled, tone: enabled ? 'ok' : 'idle' }),
      el('div', { class: 'hz-cfg__node-actions' }, [
        Toggle({
          checked: enabled,
          label: STRINGS.fieldEnabled,
          onChange: (next) => onToggle(node, next),
        }),
        Button({ label: STRINGS.edit, variant: 'outline', onClick: () => onEdit(node) }),
        Button({ label: STRINGS.remove, variant: 'danger', onClick: () => onRemove(node) }),
      ]),
    ]);
    box.appendChild(el('div', { class: 'hz-cfg__node' }, [
      head,
      el('span', { class: 'hz-cfg__node-summary', text: summariseNode(kind, node) }),
    ]));
  }
  return box;
}

/**
 * 通用设置面板（statusCommand / historySync / notifications）。
 * @param {Object} config        OneBotConfig（就地修改副本）
 * @param {Object} handlers      { onChange, channels, dirty }
 */
export function renderGeneralPanel(config, handlers) {
  const { onChange, channels } = handlers;
  const status = config.statusCommand || { ...DEFAULT_STATUS_COMMAND };
  const history = config.historySync || { enabled: false };
  const selected = new Set((config.notifications && config.notifications.channelIds) || []);
  const wrap = el('div', { class: 'hz-cfg__panel' });

  /* --- 状态命令 --- */
  const triggerInput = textInput(status.trigger, {
    placeholder: DEFAULT_STATUS_COMMAND.trigger,
    onInput: (value) => {
      config.statusCommand = { ...config.statusCommand, trigger: value };
      onChange();
    },
  });
  const cooldownInput = numberInput(status.cooldownSeconds, {
    min: 0, max: LIMITS.cooldownMax, step: 1,
    onInput: (raw) => {
      const n = Number(raw);
      if (Number.isSafeInteger(n) && n >= 0) {
        config.statusCommand = { ...config.statusCommand, cooldownSeconds: n };
        onChange();
      }
    },
  });

  wrap.appendChild(Card({
    title: STRINGS.statusCommandTitle,
    hint: fmt(STRINGS.statusCommandHint, { trigger: status.trigger || DEFAULT_STATUS_COMMAND.trigger }),
    children: [
      fieldRow(STRINGS.statusCommandEnabled, Toggle({
        checked: status.enabled === true,
        label: STRINGS.statusCommandEnabled,
        onChange: (next) => {
          config.statusCommand = { ...config.statusCommand, enabled: next };
          onChange();
        },
      })),
      fieldRow(STRINGS.statusCommandTrigger, triggerInput,
        fmt(STRINGS.statusCommandTriggerHint, { default: DEFAULT_STATUS_COMMAND.trigger })),
      fieldRow(STRINGS.statusCommandSwallow, Toggle({
        checked: status.swallow === true,
        label: STRINGS.statusCommandSwallow,
        onChange: (next) => {
          config.statusCommand = { ...config.statusCommand, swallow: next };
          onChange();
        },
      }), STRINGS.statusCommandSwallowHint),
      fieldRow(STRINGS.statusCommandCooldown, cooldownInput, STRINGS.statusCommandCooldownHint),
    ],
  }));

  /* --- 历史同步 --- */
  wrap.appendChild(Card({
    title: STRINGS.historySyncTitle,
    hint: STRINGS.historySyncHint,
    children: [
      fieldRow(STRINGS.historySyncEnabled, Toggle({
        checked: history.enabled === true,
        label: STRINGS.historySyncEnabled,
        onChange: (next) => {
          config.historySync = { ...config.historySync, enabled: next };
          onChange();
        },
      })),
    ],
  }));

  /* --- 通知渠道多选 --- */
  const channelBox = el('div', { class: 'hz-cfg__channels' });
  const channelList = Array.isArray(channels) ? channels : [];
  if (channelList.length === 0) {
    channelBox.appendChild(el('p', { class: 'hz-row__hint', text: STRINGS.notificationsEmpty }));
  } else {
    for (const channel of channelList) {
      const id = channel.id;
      channelBox.appendChild(el('div', { class: 'hz-cfg__channel' }, [
        Toggle({
          checked: selected.has(id),
          label: dash(channel.name || id),
          onChange: (next) => {
            if (next) selected.add(id); else selected.delete(id);
            config.notifications = { ...(config.notifications || {}), channelIds: [...selected] };
            onChange();
            summaryNode.textContent = fmt(STRINGS.notificationsSelected, { selected: selected.size, total: channelList.length });
          },
        }),
        el('span', { text: `${dash(channel.name || id)}` }),
        Badge({ text: channel.type === 'email' ? '邮件' : 'Webhook', tone: 'idle' }),
      ]));
    }
  }
  const summaryNode = el('p', {
    class: 'hz-row__hint',
    text: fmt(STRINGS.notificationsSelected, { selected: selected.size, total: channelList.length }),
  });

  wrap.appendChild(Card({
    title: STRINGS.notificationsTitle,
    hint: STRINGS.notificationsHint,
    children: [channelBox, el('div', { class: 'hz-row' }, [summaryNode])],
  }));

  return wrap;
}

/**
 * 单个节点的编辑表单内容（放进对话框）。
 * @returns {{node: HTMLElement, read: () => Object, error: () => string|null}}
 */
export function buildNodeEditor(kind, draft, context = {}) {
  const spec = NODE_KINDS[kind];
  const model = JSON.parse(JSON.stringify(draft));
  const box = el('div', { class: 'hz-dialog__content' });
  const nameError = el('p', { class: 'hz-field__hint' });
  let tokenNode = null;
  let tokenNote = null;

  /* 名称 */
  const nameInput = textInput(model.name, {
    onInput: (value) => { model.name = value; },
  });
  box.appendChild(formField(STRINGS.fieldName, nameInput, null));
  box.appendChild(nameError);

  /* 启用 */
  box.appendChild(formField(STRINGS.fieldEnabled, Toggle({
    checked: model.enabled !== false,
    label: STRINGS.fieldEnabled,
    onChange: (next) => { model.enabled = next; },
  })));

  /* 服务端类：host / port / path */
  if (spec.side === 'server') {
    box.appendChild(formField(STRINGS.fieldHost, textInput(model.host === undefined ? '0.0.0.0' : model.host, {
      onInput: (value) => { model.host = value; },
    }), '默认 0.0.0.0；仅本机可填 127.0.0.1'));
    box.appendChild(formField(STRINGS.fieldPort, numberInput(model.port, {
      min: LIMITS.portMin, max: LIMITS.portMax, step: 1,
      onInput: (raw) => { model.port = Number(raw); },
    })));
    box.appendChild(formField(STRINGS.fieldPath, textInput(model.path === undefined ? '/' : model.path, {
      onInput: (value) => { model.path = value; },
    })));
  } else {
    box.appendChild(formField(STRINGS.fieldUrl, textInput(model.url || '', {
      placeholder: spec.defaultUrl,
      onInput: (value) => { model.url = value; },
    })));
  }

  /* accessToken（仅服务端类） */
  if (spec.side === 'server') {
    tokenNote = el('p', { class: 'hz-field__hint hz-cfg__token-note' });
    const input = textInput(model.accessToken || '', {
      type: 'text',
      class: 'hz-input--token',
      onInput: (value) => {
        model.accessToken = value;
        refreshTokenNote();
      },
    });
    tokenNode = input;
    const refreshTokenNote = () => {
      const assessment = assessToken(model.accessToken, { host: model.host });
      tokenNote.textContent = assessment.message;
      tokenNote.className = 'hz-field__hint hz-cfg__token-note hz-cfg__token-note--' + assessment.tone;
    };
    refreshTokenNote();
    box.appendChild(formField(STRINGS.fieldAccessToken, [
      input,
      Button({
        label: STRINGS.tokenGenerate,
        variant: 'outline',
        onClick: () => {
          model.accessToken = generateAccessToken(32);
          input.value = model.accessToken;
          refreshTokenNote();
        },
      }),
    ], STRINGS.fieldAccessTokenHint));
    box.appendChild(tokenNote);
  }

  /* 消息格式 / 上报自身消息 */
  box.appendChild(formField(STRINGS.fieldMessageFormat, selectControl(
    model.messageFormat || 'array',
    MESSAGE_FORMAT_OPTIONS,
    (value) => { model.messageFormat = value; },
    STRINGS.fieldMessageFormat,
  ), STRINGS.fieldMessageFormatHint));
  box.appendChild(formField(STRINGS.fieldReportSelf, Toggle({
    checked: model.reportSelfMessage === true,
    label: STRINGS.fieldReportSelf,
    onChange: (next) => { model.reportSelfMessage = next; },
  }), STRINGS.fieldReportSelfHint));

  /* HTTP 服务端的 WebSocket / SSE 开关 */
  if (spec.hasWebSocketFlags) {
    box.appendChild(formField(STRINGS.fieldEnableWebSocket, Toggle({
      checked: model.enableWebSocket === true,
      label: STRINGS.fieldEnableWebSocket,
      onChange: (next) => { model.enableWebSocket = next; },
    }), STRINGS.fieldEnableWebSocketHint));
    box.appendChild(formField(STRINGS.fieldEnableSse, Toggle({
      checked: model.enableSse === true,
      label: STRINGS.fieldEnableSse,
      onChange: (next) => { model.enableSse = next; },
    }), STRINGS.fieldEnableSseHint));
  }

  /* 角色 */
  if (spec.hasRole) {
    box.appendChild(formField(STRINGS.fieldRole, selectControl(
      model.role || 'Universal',
      ROLE_OPTIONS,
      (value) => { model.role = value; },
      STRINGS.fieldRole,
    ), STRINGS.fieldRoleHint));
  }

  /* 超时（httpClients） */
  if (spec.hasTimeout) {
    box.appendChild(formField(STRINGS.fieldTimeout, numberInput(
      model.timeoutMs === undefined ? '' : model.timeoutMs,
      {
        min: 1, step: 1,
        onInput: (raw) => {
          if (raw === '') { delete model.timeoutMs; return; }
          const n = Number(raw);
          if (Number.isSafeInteger(n) && n > 0) model.timeoutMs = n; else delete model.timeoutMs;
        },
      },
    )));
  }

  /* 重连间隔（wsClients） */
  if (spec.hasReconnect) {
    box.appendChild(formField(STRINGS.fieldReconnect, numberInput(
      model.reconnectIntervalMs === undefined ? 5000 : model.reconnectIntervalMs,
      {
        min: LIMITS.reconnectMin, step: 1,
        onInput: (raw) => {
          const n = Number(raw);
          if (Number.isSafeInteger(n) && n >= LIMITS.reconnectMin) model.reconnectIntervalMs = n;
        },
      },
    )));
  }

  /* 单帧上限 */
  if (spec.acceptsMaxPayload) {
    box.appendChild(formField(STRINGS.fieldMaxPayload, numberInput(
      model.maxPayloadBytes === undefined ? '' : model.maxPayloadBytes,
      {
        min: LIMITS.maxPayloadMin, step: 1,
        onInput: (raw) => {
          if (raw === '') { delete model.maxPayloadBytes; return; }
          const n = Number(raw);
          if (Number.isSafeInteger(n) && n >= LIMITS.maxPayloadMin) model.maxPayloadBytes = n;
          else delete model.maxPayloadBytes;
        },
      },
    ), `留空使用服务端默认；范围 ${LIMITS.maxPayloadMin}–${LIMITS.maxPayloadMax}`));
  }

  const otherNames = context.otherNames || [];

  return {
    node: box,
    model,
    /** 读取并做前端校验，返回错误文案或 null。 */
    read() {
      /* 名称重复检查（跨四类） */
      if (otherNames.includes(String(model.name || '').trim())) {
        nameError.textContent = STRINGS.errNameDuplicate;
        return STRINGS.errNameDuplicate;
      }
      nameError.textContent = '';
      const err = validateNode(kind, model, { otherNames, index: context.index });
      if (err) return err;
      /* 令牌策略：变更且为空 + 非本机绑定 → 明确拦住 */
      if (spec.side === 'server' && model.accessToken !== undefined) {
        const assessment = assessToken(model.accessToken, { host: model.host });
        if (!assessment.valid) return assessment.message;
      }
      return null;
    },
    /** 归一化后的节点（去掉空字符串字段，服务端 clean() 同语义）。 */
    toNode() {
      const out = {};
      for (const [key, value] of Object.entries(model)) {
        if (value === undefined || value === '' || value === null) continue;
        out[key] = value;
      }
      if (spec.side === 'server') {
        if (out.host === undefined) out.host = '0.0.0.0';
        if (out.path === undefined) out.path = '/';
      }
      if (out.messageFormat === undefined) out.messageFormat = 'array';
      if (out.reportSelfMessage === undefined) out.reportSelfMessage = false;
      if (spec.hasRole && out.role === undefined) out.role = 'Universal';
      return out;
    },
    refreshTokenNote() {
      if (!tokenNode || !tokenNote) return;
      const assessment = assessToken(model.accessToken, { host: model.host });
      tokenNote.textContent = assessment.message;
      tokenNote.className = 'hz-field__hint hz-cfg__token-note hz-cfg__token-note--' + assessment.tone;
    },
  };
}

/**
 * 连接状态面板。
 * @param {Array} connections GET /api/connections 的 list
 * @param {Object} snapshot   Resource 快照
 * @param {Function} onRetry
 */
export function renderConnectionsPanel(connections, snapshot, onRetry) {
  return stateView({
    resource: { get: () => snapshot },
    isEmpty: () => !Array.isArray(connections) || connections.length === 0,
    emptyTitle: STRINGS.connectionsEmpty,
    loadingLabel: STRINGS.loading,
    onRetry,
    render: () => {
      const box = el('div', {});
      for (const entry of connections) {
        const adapters = Array.isArray(entry.adapters) ? entry.adapters : [];
        if (adapters.length === 0) continue;
        for (const adapter of adapters) {
          const tone = adapter.status === 'ok' ? 'ok'
            : adapter.status === 'error' ? 'error'
              : adapter.status === 'warn' ? 'warn' : 'idle';
          const label = adapter.status === 'ok' ? STRINGS.statusOk
            : adapter.status === 'error' ? STRINGS.statusError
              : adapter.status === 'warn' ? STRINGS.statusWarn
                : STRINGS.statusIdle;
          box.appendChild(el('div', { class: 'hz-cfg__conn' }, [
            el('div', { class: 'hz-cfg__conn-head' }, [
              el('span', { class: 'hz-cfg__conn-name', text: dash(adapter.name) }),
              Badge({ text: label, tone }),
              el('span', { class: 'hz-cfg__conn-detail', text: dash(adapter.kind) }),
            ]),
            el('span', { class: 'hz-cfg__conn-detail', text: dash(adapter.detail) }),
          ]));
        }
      }
      return [box];
    },
  });
}

/* ========================================================================== *
 * 插件本体
 * ======================================================================== */

/** 宿主元素 → 运行时上下文（definePlugin 会冻结插件对象，故用 WeakMap）。 */
const runtimeByHost = new WeakMap();

/**
 * 创建账号配置插件。
 *
 * @param {Object} [options]
 * @param {Object} [options.resources] 覆盖默认 Resource 集合（测试注入用）
 * @returns {Object} definePlugin 归一化后的插件
 */
export function createConfigPlugin(options = {}) {
  let runtime = null;

  /** 当前是否有未保存修改。 */
  const isDirty = () => !!(runtime && runtime.dirty);

  /** 从服务端重新读取当前账号配置（丢弃本地修改）。 */
  const reloadConfig = async () => {
    if (!runtime || !runtime.uin) return;
    await runtime.configResource.load();
  };

  /** 保存当前账号配置。 */
  const save = async () => {
    if (!runtime || !runtime.uin) return null;
    const config = runtime.config;
    if (!config) return null;

    /* 前端先校验，避免必然失败的请求 */
    const frontError = validateConfig(config);
    if (frontError) {
      runtime.feedback = { tone: 'error', text: frontError, failures: [] };
      draw();
      return null;
    }
    const tokenError = validateAccessTokens(runtime.originalConfig, config, { allowEmpty: false });
    if (tokenError) {
      runtime.feedback = { tone: 'error', text: tokenError, failures: [] };
      draw();
      return null;
    }

    runtime.saving = true;
    draw();
    try {
      const result = await saveAccountConfig(runtime.uin, config);
      const view = describeSaveResult(result);
      runtime.feedback = view;
      if (result && result.saved === true) {
        runtime.dirty = false;
        runtime.originalConfig = JSON.parse(JSON.stringify(result.config || config));
        await runtime.configResource.load({ silent: true });
      }
      return result;
    } catch (error) {
      runtime.feedback = {
        tone: 'error',
        text: fmt(STRINGS.saveFailed, { message: error && error.message ? error.message : A.unknown }),
        failures: [],
      };
      return null;
    } finally {
      if (runtime) runtime.saving = false;
      draw();
    }
  };

  /** 切换账号（脏状态时先确认）。 */
  const selectAccount = (uin) => {
    if (!runtime || runtime.uin === uin) return;
    const apply = () => {
      if (!runtime) return;
      runtime.uin = uin;
      runtime.config = null;
      runtime.originalConfig = null;
      runtime.dirty = false;
      runtime.feedback = null;
      runtime.tab = 'general';
      runtime.configResource = createAccountConfigResource(uin);
      const unsubscribe = runtime.configResource.subscribe(() => {
        if (!runtime || runtime.uin !== uin) return;
        const snapshot = runtime.configResource.get();
        if (snapshot.status === 'ready' && snapshot.data && !runtime.dirty) {
          runtime.config = JSON.parse(JSON.stringify(snapshot.data));
          runtime.originalConfig = JSON.parse(JSON.stringify(snapshot.data));
        }
        draw();
      });
      runtime.unsubscribers.push(unsubscribe);
      runtime.configResource.load();
      draw();
    };

    if (isDirty()) {
      openDialog({
        title: STRINGS.dirtySwitchTitle,
        hint: fmt(STRINGS.dirtySwitchBody, { uin: runtime.uin, next: uin }),
        confirmLabel: STRINGS.dirtySwitchConfirm,
        destructive: true,
        onConfirm: (close) => { close(); apply(); },
      });
      return;
    }
    apply();
  };

  /** 整块重绘。 */
  const draw = () => {
    if (!runtime) return;
    const { host, resources, tab } = runtime;
    while (host.firstChild) host.removeChild(host.firstChild);

    const root = el('div', { class: 'hz-cfg', 'data-hz-plugin': 'config' });

    /* ---- 顶部工具条 ---- */
    const accountsSnapshot = resources.accounts.get();
    const accounts = Array.isArray(accountsSnapshot.data) ? accountsSnapshot.data : [];
    const processes = (resources.processes.get().data) || [];
    const onlineUins = new Set(
      processes.filter((p) => p && p.status === 'online' && p.uin).map((p) => String(p.uin)),
    );
    const currentAccount = accounts.find((a) => String(a.uin) === String(runtime.uin));

    const statusNode = el('span', { class: 'hz-cfg__actions' });
    if (runtime.saving) {
      statusNode.appendChild(Spinner({ label: STRINGS.saving, inline: true, size: 14 }));
    } else if (runtime.dirty) {
      statusNode.appendChild(Badge({ text: STRINGS.unsaved, tone: 'warn' }));
    }

    root.appendChild(el('div', { class: 'hz-cfg__toolbar' }, [
      el('div', {}, [
        el('h2', { class: 'hz-cfg__heading', text: STRINGS.pageHint }),
        runtime.uin
          ? el('p', { class: 'hz-cfg__sub', text: `UIN ${runtime.uin}${currentAccount && currentAccount.nickname ? ' · ' + currentAccount.nickname : ''}` })
          : null,
      ]),
      el('div', { class: 'hz-cfg__actions' }, [
        statusNode,
        Button({
          label: STRINGS.refresh,
          variant: 'ghost',
          icon: Icon('refresh'),
          onClick: () => {
            resources.accounts.load({ silent: true });
            resources.processes.load({ silent: true });
            if (runtime.configResource) runtime.configResource.load({ silent: true });
          },
        }),
        Button({
          label: STRINGS.save,
          variant: 'primary',
          disabled: !runtime.uin || !runtime.config || runtime.saving,
          busy: runtime.saving === true,
          onClick: () => { save(); },
        }),
      ]),
    ]));

    /* ---- 反馈 ---- */
    if (runtime.feedback) {
      const fb = el('div', { class: 'hz-cfg__feedback' });
      fb.appendChild(el('div', {
        class: `hz-notice hz-notice--${runtime.feedback.tone === 'ok' ? 'success' : runtime.feedback.tone === 'warn' ? 'warning' : 'error'}`,
        role: runtime.feedback.tone === 'error' ? 'alert' : 'status',
      }, [el('p', { class: 'hz-notice__text', text: runtime.feedback.text })]));
      if (runtime.feedback.failures && runtime.feedback.failures.length > 0) {
        const list = el('ul', { class: 'hz-cfg__failures' });
        for (const failure of runtime.feedback.failures) {
          list.appendChild(el('li', {
            text: fmt(STRINGS.saveFailureItem, { name: failure.name, phase: failure.phase, message: failure.message }),
          }));
        }
        fb.appendChild(el('p', { class: 'hz-row__hint', text: STRINGS.saveFailuresHeading }));
        fb.appendChild(list);
      }
      root.appendChild(fb);
    }

    /* ---- 账号列表 + 配置面板 ---- */
    const layout = el('div', { class: 'hz-cfg__layout' });

    /* 账号列表 */
    const accountsBox = el('div', { class: 'hz-cfg__accounts' });
    if (accountsSnapshot.status === 'loading' && accounts.length === 0) {
      accountsBox.appendChild(Spinner({ label: STRINGS.loading }));
    } else if (accountsSnapshot.status === 'error' && accounts.length === 0) {
      accountsBox.appendChild(ErrorState({
        message: accountsSnapshot.error ? accountsSnapshot.error.message : STRINGS.loadAccountsFailed,
        retry: () => resources.accounts.load(),
      }));
    } else if (accounts.length === 0) {
      accountsBox.appendChild(EmptyState({
        title: STRINGS.noAccounts,
        hint: STRINGS.noAccountsHint,
        icon: Icon('users', { size: 28 }),
      }));
    } else {
      for (const account of accounts) {
        const uin = String(account.uin);
        const active = uin === String(runtime.uin);
        const online = onlineUins.has(uin);
        accountsBox.appendChild(el('button', {
          type: 'button',
          class: `hz-cfg__account${active ? ' is-active' : ''}`,
          'aria-current': active ? 'true' : null,
          onClick: () => selectAccount(uin),
        }, [
          Icon('users', { size: 14 }),
          el('span', { text: dash(account.nickname || uin) }),
          online ? Badge({ text: STRINGS.onlineBadge, tone: 'ok' }) : null,
          el('span', { class: 'hz-cfg__account-uin', text: uin }),
        ]));
      }
    }
    layout.appendChild(accountsBox);

    /* 配置面板 */
    const panel = el('div', { class: 'hz-cfg__panel' });
    if (!runtime.uin) {
      panel.appendChild(EmptyState({
        title: STRINGS.noAccounts,
        hint: STRINGS.noAccountsHint,
        icon: Icon('plug', { size: 28 }),
      }));
    } else if (!runtime.config) {
      const snap = runtime.configResource ? runtime.configResource.get() : { status: 'idle', error: null };
      panel.appendChild(stateView({
        resource: { get: () => snap },
        isEmpty: (data) => !data,
        loadingLabel: STRINGS.loading,
        onRetry: () => runtime.configResource && runtime.configResource.load(),
        render: () => [el('p', { class: 'hz-row__hint', text: STRINGS.unavailable })],
      }));
    } else {
      /* 分类标签页 */
      const counts = {
        httpServers: (runtime.config.networks.httpServers || []).length,
        httpClients: (runtime.config.networks.httpClients || []).length,
        wsServers: (runtime.config.networks.wsServers || []).length,
        wsClients: (runtime.config.networks.wsClients || []).length,
      };
      const tabsBox = el('div', { class: 'hz-cfg__tabs', role: 'tablist', 'aria-label': STRINGS.tabCategories });
      for (const key of NODE_KIND_ORDER) {
        const label = key === 'general' ? STRINGS.groupGeneral : NODE_KINDS[key].title;
        const active = tab === key;
        const btn = el('button', {
          type: 'button',
          role: 'tab',
          id: `hz-cfg-tab-${key}`,
          class: `hz-cfg__tab${active ? ' is-active' : ''}`,
          'aria-selected': active ? 'true' : 'false',
          'aria-controls': `hz-cfg-panel-${key}`,
          onClick: () => { runtime.tab = key; draw(); },
        }, [el('span', { text: label })]);
        if (key !== 'general') btn.appendChild(el('span', { class: 'hz-cfg__tab-count', text: String(counts[key] || 0) }));
        tabsBox.appendChild(btn);
      }
      panel.appendChild(tabsBox);

      const tabPanel = el('div', {
        id: `hz-cfg-panel-${tab}`,
        role: 'tabpanel',
        'aria-labelledby': `hz-cfg-tab-${tab}`,
      });

      if (tab === 'general') {
        tabPanel.appendChild(renderGeneralPanel(runtime.config, {
          channels: resources.channels.get().data || [],
          onChange: () => { runtime.dirty = true; draw(); },
        }));
        tabPanel.appendChild(Card({
          title: STRINGS.connectionsTitle,
          hint: STRINGS.connectionsHint,
          children: [renderConnectionsPanel(
            (resources.connections.get().data || []).filter((entry) => String(entry.uin) === String(runtime.uin)),
            resources.connections.get(),
            () => resources.connections.load(),
          )],
        }));
      } else {
        const spec = NODE_KINDS[tab];
        tabPanel.appendChild(Card({
          title: spec.title,
          hint: spec.hint,
          actions: [Button({
            label: fmt(STRINGS.nodeAdd, { noun: spec.noun }),
            variant: 'outline',
            icon: Icon('plug'),
            onClick: () => openNodeDialog(tab, null, -1),
          })],
          children: [renderNodeList(tab, runtime.config.networks[tab] || [], {
            onAdd: () => openNodeDialog(tab, null, -1),
            onEdit: (node) => openNodeDialog(tab, node, (runtime.config.networks[tab] || []).indexOf(node)),
            onRemove: (node) => {
              const index = (runtime.config.networks[tab] || []).indexOf(node);
              if (index < 0) return;
              runtime.config.networks[tab].splice(index, 1);
              runtime.dirty = true;
              draw();
            },
            onToggle: (node, next) => {
              const target = (runtime.config.networks[tab] || []).find((item) => item.name === node.name);
              if (!target) return;
              if (next) delete target.enabled; else target.enabled = false;
              runtime.dirty = true;
              draw();
            },
          })],
        }));
      }
      panel.appendChild(tabPanel);
    }
    layout.appendChild(panel);
    root.appendChild(layout);

    host.appendChild(root);
  };

  /** 打开节点新建 / 编辑对话框。 */
  const openNodeDialog = (kind, existing, index) => {
    if (!runtime) return;
    const spec = NODE_KINDS[kind];
    const networks = runtime.config.networks;
    /* 跨四类的已有名称（用于重复检查） */
    const allNames = [];
    for (const key of ['httpServers', 'httpClients', 'wsServers', 'wsClients']) {
      for (const node of (networks[key] || [])) {
        if (node && node.name) allNames.push(node.name);
      }
    }
    const otherNames = allNames.filter((name) => {
      if (index < 0) return true;
      const current = (networks[kind] || [])[index];
      return !current || current.name !== name;
    });

    const seed = existing
      ? JSON.parse(JSON.stringify(existing))
      : defaultNodeFor(kind, (networks[kind] || []).length + 1);

    const editor = buildNodeEditor(kind, seed, { otherNames, index });
    const message = el('p', { class: 'hz-row__hint' });

    openDialog({
      title: existing ? fmt(STRINGS.nodeEdit, { noun: spec.noun }) : fmt(STRINGS.nodeAdd, { noun: spec.noun }),
      hint: spec.hint,
      wide: true,
      content: [editor.node, message],
      confirmLabel: existing ? STRINGS.save : STRINGS.add,
      onConfirm: (close) => {
        const error = editor.read();
        if (error) { message.textContent = error; return; }
        const node = editor.toNode();
        const list = networks[kind] || (networks[kind] = []);
        if (index >= 0 && index < list.length) list[index] = node; else list.push(node);
        runtime.dirty = true;
        close();
        draw();
      },
    });
  };

  return definePlugin({
    id: 'config',
    title: STRINGS.pageTitle,
    icon: 'plug',
    order: 20,
    description: '账号配置页（OneBot 协议端点 / 状态命令 / 历史同步 / 通知渠道）',

    mount(host, ctx) {
      ensureConfigStyles();
      const resources = options.resources || createConfigResources();

      runtime = {
        host,
        ctx,
        resources,
        uin: null,
        tab: 'general',
        config: null,
        originalConfig: null,
        configResource: null,
        dirty: false,
        saving: false,
        feedback: null,
        unsubscribers: [],
      };

      runtimeByHost.set(host, runtime);

      /* 共享 Resource 订阅 */
      for (const key of ['accounts', 'processes', 'connections', 'channels']) {
        const resource = resources[key];
        runtime.unsubscribers.push(resource.subscribe(() => {
          if (runtime) draw();
        }));
      }

      resources.accounts.load();
      resources.processes.load();
      resources.connections.load();
      resources.channels.load();

      /* 账号列表到达后自动选中第一个 */
      runtime.unsubscribers.push(resources.accounts.subscribe((snapshot) => {
        if (!runtime) return;
        if (snapshot.status !== 'ready') return;
        const list = Array.isArray(snapshot.data) ? snapshot.data : [];
        if (!runtime.uin && list.length > 0) selectAccount(String(list[0].uin));
      }));

      draw();
    },

    unmount() {
      if (!runtime) return;
      for (const unsubscribe of runtime.unsubscribers) {
        try { unsubscribe(); } catch (error) { console.error('[config-plugin] unsubscribe failed:', error); }
      }
      for (const resource of Object.values(runtime.resources)) resource.abort();
      if (runtime.configResource) runtime.configResource.abort();
      if (runtime.host) {
        runtimeByHost.delete(runtime.host);
        while (runtime.host.firstChild) runtime.host.removeChild(runtime.host.firstChild);
      }
      runtime = null;
    },

    refresh() {
      if (!runtime) return;
      runtime.resources.accounts.load({ silent: true });
      runtime.resources.processes.load({ silent: true });
      runtime.resources.connections.load({ silent: true });
      if (runtime.configResource && !runtime.dirty) runtime.configResource.load({ silent: true });
    },

    resources() {
      if (!runtime) return [];
      const list = Object.values(runtime.resources);
      if (runtime.configResource) list.push(runtime.configResource);
      return list;
    },
  });
}

/** 新建节点的默认值（对齐编译产物 X[kind].defaultEntry）。 */
export function defaultNodeFor(kind, index) {
  const spec = NODE_KINDS[kind];
  const base = {
    name: `${kind === 'httpServers' ? 'http' : kind === 'httpClients' ? 'httppost' : kind === 'wsServers' ? 'ws' : 'wsclient'}-${index}`,
    messageFormat: 'array',
    reportSelfMessage: false,
  };
  if (spec.side === 'server') {
    return {
      ...base,
      host: '127.0.0.1',
      port: spec.defaultPort,
      path: '/',
      accessToken: generateAccessToken(32),
      ...(spec.hasWebSocketFlags ? { enableWebSocket: false, enableSse: false } : {}),
      ...(spec.hasRole ? { role: 'Universal' } : {}),
    };
  }
  return {
    ...base,
    url: spec.defaultUrl,
    ...(spec.hasRole ? { role: 'Universal' } : {}),
    ...(spec.hasReconnect ? { reconnectIntervalMs: 5000 } : {}),
  };
}

/** 取回某宿主元素对应的运行时（测试 / 协作使用）。 */
export function getConfigRuntime(host) {
  if (!host) return null;
  return runtimeByHost.get(host) || null;
}

/* ========================================================================== *
 * 注册 / 页面组装
 * ======================================================================== */

export const configPlugin = createConfigPlugin();

/**
 * 注册账号配置插件（重复注册被容忍）。
 * @param {Object} [registryApi] { registerPlugin }
 */
export function registerConfigPlugins(registryApi) {
  const api = registryApi ?? { registerPlugin };
  try {
    api.registerPlugin(configPlugin);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('插件 id 重复')) throw error;
  }
  return configPlugin;
}

/**
 * 组装账号配置页。
 *
 * @param {HTMLElement} container
 * @param {Object} [options] { resources }
 * @returns {{plugin: Object, host: HTMLElement, refresh: Function, destroy: Function}}
 */
export function createConfigPage(container, options = {}) {
  if (!container) throw new TypeError('createConfigPage(container): container 必填');
  const resources = options.resources || createConfigResources();
  const plugin = createConfigPlugin({ resources });
  const host = el('div', { class: 'hz-config-host' });
  container.appendChild(host);
  plugin.mount(host, {
    root: container,
    resources,
    services: {},
    emit() {},
    on() { return () => {}; },
  });

  return {
    plugin,
    host,
    resources,
    refresh: () => plugin.refresh(),
    save: () => {
      const state = getConfigRuntime(host);
      return state ? saveAccountConfig(state.uin, state.config) : null;
    },
    destroy: () => {
      plugin.unmount();
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
}

/* ========================================================================== *
 * 默认导出
 * ======================================================================== */

export default {
  STRINGS,
  NODE_KINDS,
  NODE_KIND_ORDER,
  INBOUND_KINDS,
  ROLE_OPTIONS,
  MESSAGE_FORMAT_OPTIONS,
  DEFAULT_STATUS_COMMAND,
  LIMITS,
  // 纯函数
  fmt,
  isLoopbackBindHost,
  isValidBindHost,
  generateAccessToken,
  assessToken,
  validateNode,
  validateConfig,
  validateAccessTokens,
  summariseNode,
  describeSaveResult,
  defaultNodeFor,
  // 渲染
  fieldRow,
  formField,
  textInput,
  numberInput,
  selectControl,
  segmented,
  openDialog,
  ensureConfigStyles,
  renderNodeList,
  renderGeneralPanel,
  renderConnectionsPanel,
  buildNodeEditor,
  // 数据
  createConfigResources,
  createAccountConfigResource,
  saveAccountConfig,
  // 页面
  createConfigPlugin,
  configPlugin,
  registerConfigPlugins,
  createConfigPage,
  getConfigRuntime,
};