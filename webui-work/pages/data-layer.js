/**
 * data-layer.js — 服务端状态驱动的数据层
 * =============================================================================
 * 目标：**按服务端加载状态驱动**界面。UI 不允许自己猜「有没有数据」，
 * 它只能读 Resource 的状态机快照。
 *
 * Resource 状态机
 * -----------------------------------------------------------------------------
 *            load()                成功
 *   idle ─────────────► loading ──────────► ready
 *     ▲                   │  ▲                │
 *     │                   │  └──── refresh() ─┘
 *     │      失败          ▼
 *     └──────────────── error ──retry()──► loading（保留上次成功数据）
 *
 * 语义要点
 * -----------------------------------------------------------------------------
 * 1. **错误必须可见**。失败绝不静默成 `[]`；`state.data` 保持 null（首次失败）
 *    或保留「最后一次成功的数据」（刷新失败），并同时把 error 暴露出来，
 *    由 UI 同时呈现「错误条 + 已过期数据」。
 * 2. **不伪造数据**。服务端返回非对象 / 非预期形状 → 报错，而不是当作空。
 * 3. `subscribe(cb)` 在**任何**状态变化时同步回调，返回取消订阅函数。
 * 4. `retry()` 与 `refresh()` 的区别只是语义：retry 用于 error 后重来，
 *    refresh 用于已 ready 时拉最新；内部走同一条 load 路径。
 * 5. 并发保护：同一 Resource 同时只允许一个在途请求；新请求会中止旧的。
 *
 * 鉴权（实测自生产实例，2026-11-16）
 * -----------------------------------------------------------------------------
 * - 令牌存放：`localStorage['snowluma_token']`（裸字符串，非 JSON）
 *   与前端现有实现一致（reference/index-CbgqmStD.js 中
 *   `var en = 'snowluma_token'`，store.load() = localStorage.getItem(en)）。
 * - 请求头：`X-SnowLuma-Token: <token>`（服务端以 `x-snowluma-token` 读取，
 *   HTTP 头大小写不敏感）。`Authorization: Bearer <token>` 是备选。
 *   参考 docs-source/webui/api.md §2.2。
 * - 无令牌 → 401 `{ status:"failed", message:"Unauthorized" }`
 * - 令牌过期 → 401 `{ status:"failed", message:"Token expired or invalid" }`
 * - 协议门禁 → 403 `{ ..., consentRequired: true }`
 * - 强制改密门禁 → 403 `{ ..., mustChangePassword: true }`
 *   （两者都**只**是 403，不能都当成普通网络错误处理）
 *
 * @module data-layer
 */

/* ========================================================================== *
 * STRINGS — 本模块的用户可见文案
 * ========================================================================== */

export const STRINGS = {
  networkError: '网络错误，请检查连接',
  timeout: '请求超时，请重试',
  unauthorized: '登录状态已失效，请重新登录',
  consentRequired: '请先阅读并同意用户协议与隐私政策',
  mustChangePassword: '请先修改密码',
  httpError: ({ status, statusText }) => `请求失败（HTTP ${status}${statusText ? ` ${statusText}` : ''}）`,
  invalidJson: '服务端返回了无效的 JSON 响应',
  invalidShape: ({ endpoint }) => `服务端返回的数据结构不符合预期（${endpoint}）`,
  serverMessage: ({ message }) => message,
  aborted: '请求已取消',
};

/* ========================================================================== *
 * 配置
 * ========================================================================== */

/** localStorage 中存放会话令牌的键（与现有前端一致） */
export const TOKEN_STORAGE_KEY = 'snowluma_token';

/** 会话令牌请求头名（服务端读取 x-snowluma-token） */
export const TOKEN_HEADER = 'X-SnowLuma-Token';

/** 默认请求超时（毫秒）。现有前端用 30000。 */
export const DEFAULT_TIMEOUT_MS = 30000;

/** 默认 API 前缀；留空表示同源相对路径 */
export const DEFAULT_BASE_URL = '';

/* ========================================================================== *
 * 错误类型
 * ========================================================================== */

/**
 * 数据层统一错误。携带足够信息让 UI 区分「该提示重登」还是「该重试」。
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {number} [options.status]   HTTP 状态码（0 = 网络层失败）
   * @param {string} [options.code]     机器可读错误码
   * @param {string} [options.endpoint]
   * @param {*} [options.payload]       服务端原始响应体（若有）
   * @param {boolean} [options.authIssue] 是否属于鉴权/授权问题（401/403）
   */
  constructor(message, { status = 0, code = 'UNKNOWN', endpoint = '', payload = null, authIssue = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
    this.payload = payload;
    this.authIssue = authIssue;
  }
}

/* ========================================================================== *
 * 令牌存取
 * ========================================================================== */

/**
 * 读取当前会话令牌。**每次调用都重新读 localStorage**，这样其他标签页
 * 登录/登出后本页能立即跟上，不会用陈旧令牌。
 * @returns {string|null}
 */
export function readToken() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    // 隐私模式 / 存储被禁用
    return null;
  }
}

/**
 * 写入 / 清除会话令牌。
 * @param {string|null} token
 */
export function writeToken(token) {
  try {
    if (token === null || token === undefined || token === '') {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      localStorage.setItem(TOKEN_STORAGE_KEY, String(token));
    }
  } catch {
    /* 存储不可用时静默 —— 不影响本次请求（令牌在内存里仍有效） */
  }
}

/**
 * 鉴权失效时的全局通知钩子。宿主（页面壳）可注册以跳转登录页。
 * @type {Array<(reason: 'unauthorized'|'consent'|'password') => void>}
 */
const authListeners = new Set();

/**
 * 注册鉴权失效回调。
 * @param {(reason: 'unauthorized'|'consent'|'password') => void} handler
 * @returns {() => void} 取消注册
 */
/* ------------------------------------------------------------------ *
 * 401 去抖
 *
 * 单次 401 不足以判定会话失效：页面首次加载时令牌可能还在写入途中，
 * 或者几个请求几乎同时发出、服务端只认了其中一个。此前每遇 401 就
 * 立刻清 localStorage，结果是并发请求互相把令牌删掉，之后永久 401。
 * ------------------------------------------------------------------ */

let authFailureCount = 0;
let authFailureToken = null;
const AUTH_FAILURE_THRESHOLD = 2;

/** 请求成功后调用：当前令牌有效，清掉失败计数。 */
export function resetAuthFailure() {
  authFailureCount = 0;
  authFailureToken = null;
}

/**
 * 遇到 401 时判断该不该清令牌。
 * @param {string|null} usedToken 发起该请求时用的令牌
 * @returns {boolean} true = 判定会话确实失效
 */
function shouldClearToken(usedToken) {
  const now = readToken();
  // 当前令牌已与本次请求用的不同 → 期间有别的流程更新过，不动
  if (now && usedToken && now !== usedToken) return false;
  if (authFailureToken !== usedToken) {
    authFailureToken = usedToken;
    authFailureCount = 0;
  }
  authFailureCount += 1;
  return authFailureCount >= AUTH_FAILURE_THRESHOLD;
}

export function onAuthIssue(handler) {
  authListeners.add(handler);
  return () => authListeners.delete(handler);
}

function notifyAuthIssue(reason) {
  for (const handler of [...authListeners]) {
    try {
      handler(reason);
    } catch (err) {
      console.error('[data-layer] auth handler failed:', err);
    }
  }
}

/* ========================================================================== *
 * HTTP 核心
 * ========================================================================== */

/**
 * 从响应体里尽力提取服务端消息。
 * 服务端错误体形如 `{ status:"failed", message:"..." }`，
 * 各业务端点也可能返回 `{ success:false, message:"..." }`。
 * @param {*} payload
 * @returns {string} 取不到则空串
 */
function extractMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.message === 'string' && payload.message) return payload.message;
  if (typeof payload.error === 'string' && payload.error) return payload.error;
  return '';
}

/**
 * 统一请求。**所有** API 调用都应经过这里，以保证鉴权头与错误语义一致。
 *
 * @param {string} endpoint            如 '/api/system'
 * @param {Object} [options]
 * @param {string} [options.method]    'GET' | 'POST' | ...
 * @param {*} [options.body]           会被 JSON.stringify（除非已是字符串/FormData）
 * @param {Object} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.expectObject] 是否要求响应体是 JSON 对象（默认 true）
 * @returns {Promise<*>} 解析后的响应体
 * @throws {ApiError}
 */
export async function request(endpoint, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    expectObject = true,
  } = options;

  const finalHeaders = { ...headers };
  const token = readToken();
  // 记下本次实际用的令牌：401 判断「是否同一令牌连续失败」要用它
  const usedToken = token || null;
  if (token) finalHeaders[TOKEN_HEADER] = token;

  let payloadBody;
  if (body !== undefined && body !== null) {
    if (typeof body === 'string' || body instanceof FormData || body instanceof Blob) {
      payloadBody = body;
    } else {
      payloadBody = JSON.stringify(body);
      if (!finalHeaders['Content-Type']) finalHeaders['Content-Type'] = 'application/json';
    }
  }

  // 超时用独立的 AbortController；调用方的 signal 也要能中止。
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onOuterAbort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  let response;
  try {
    response = await fetch(`${DEFAULT_BASE_URL}${endpoint}`, {
      method,
      headers: finalHeaders,
      body: payloadBody,
      signal: controller.signal,
      // 令牌可能随标签页变化，禁止缓存 API 响应
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (err) {
    if (controller.signal.aborted) {
      // 区分「调用方主动取消」与「超时」
      if (signal?.aborted) {
        throw new ApiError(STRINGS.aborted, { code: 'ABORTED', endpoint });
      }
      throw new ApiError(STRINGS.timeout, { code: 'TIMEOUT', endpoint });
    }
    throw new ApiError(err instanceof Error ? err.message || STRINGS.networkError : STRINGS.networkError, {
      code: 'NETWORK',
      endpoint,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }

  // 解析响应体：即使是非 2xx 也要尝试解析，以便拿到服务端 message
  let payload = null;
  let parseFailed = false;
  const text = await response.text().catch(() => '');
  if (text && text.trim() !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }

  if (response.ok) {
    // 拿到 2xx 说明令牌是有效的，清掉 401 计数
    resetAuthFailure();
  }

  if (!response.ok) {
    const serverMessage = extractMessage(payload);

    // 401：认证失败。
    //
    // ⚠️ **绝不在这里清 localStorage 的令牌。**
    // 页面首次加载时 app 可能还没把令牌写进去，此时发出的请求必然 401；
    // 如果组件因为「自己没用上令牌」就把它删掉，就会把 app 即将写入
    // （或刚写入）的有效令牌一并清除，之后永久 401、无法自愈。
    // 令牌的生命周期归 app 所有，组件只读不写。
    // 这里只上报状态，让 UI 显示「未授权 + 重试」即可。
    if (response.status === 401) {
      notifyAuthIssue('unauthorized');
      throw new ApiError(serverMessage || STRINGS.unauthorized, {
        status: 401,
        code: 'UNAUTHORIZED',
        endpoint,
        payload,
        authIssue: true,
      });
    }

    // 403：区分两级门禁与普通禁止
    if (response.status === 403) {
      if (payload && payload.consentRequired === true) {
        notifyAuthIssue('consent');
        throw new ApiError(serverMessage || STRINGS.consentRequired, {
          status: 403,
          code: 'CONSENT_REQUIRED',
          endpoint,
          payload,
          authIssue: true,
        });
      }
      if (payload && payload.mustChangePassword === true) {
        notifyAuthIssue('password');
        throw new ApiError(serverMessage || STRINGS.mustChangePassword, {
          status: 403,
          code: 'MUST_CHANGE_PASSWORD',
          endpoint,
          payload,
          authIssue: true,
        });
      }
      throw new ApiError(serverMessage || STRINGS.httpError({ status: 403, statusText: response.statusText }), {
        status: 403,
        code: 'FORBIDDEN',
        endpoint,
        payload,
        authIssue: true,
      });
    }

    throw new ApiError(serverMessage || STRINGS.httpError({ status: response.status, statusText: response.statusText }), {
      status: response.status,
      code: 'HTTP_ERROR',
      endpoint,
      payload,
    });
  }

  if (parseFailed) {
    throw new ApiError(STRINGS.invalidJson, { status: response.status, code: 'INVALID_JSON', endpoint });
  }

  // 空响应体：POST 操作类端点可能不返回内容，视为 null（不算错误）
  if (payload === null) return null;

  // 现有前端约定：JSON 端点必须返回对象；数组 / 标量视为协议错误，而不是空列表
  if (expectObject && (typeof payload !== 'object' || Array.isArray(payload))) {
    throw new ApiError(STRINGS.invalidShape({ endpoint }), {
      status: response.status,
      code: 'INVALID_SHAPE',
      endpoint,
      payload,
    });
  }

  return payload;
}

/* ========================================================================== *
 * Resource
 * ========================================================================== */

/**
 * @typedef {Object} ResourceSnapshot
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {*} data          最近一次成功的数据（失败时保留旧值；从未成功过则为 null）
 * @property {ApiError|null} error
 * @property {number} updatedAt 最近一次成功的时间戳（0 = 从未成功）
 * @property {boolean} loading  是否有在途请求
 */

/**
 * 一个数据源。持有状态机 + 订阅通知 + 请求去重。
 *
 * 关键设计：`data` 与 `error` **同时存在**。刷新失败时不会清空旧数据，
 * UI 可以同时显示「⚠ 刷新失败」与「上次成功的数据」，信息密度不下降。
 */
export class Resource {
  /**
   * @param {string} name   调试用名称，如 'processList'
   * @param {Object} spec
   * @param {string} spec.endpoint        请求路径（静态）
   * @param {(name: string, snapshot: ResourceSnapshot) => void} [spec.onChange] 便捷回调
   * @param {() => string} [spec.endpointFactory] 动态路径（与 endpoint 二选一）
   * @param {Object} [spec.request]       传给 request() 的默认选项
   * @param {(payload: any) => any} [spec.select] 从响应体挑出真正需要的数据
   * @param {Object} [spec.method]        请求方法（默认 GET）
   */
  constructor(name, spec = {}) {
    if (typeof spec.endpoint !== 'string' && typeof spec.endpointFactory !== 'function') {
      throw new TypeError(`Resource(${name}): 必须提供 endpoint 或 endpointFactory`);
    }
    this.name = name;
    this.spec = spec;
    this.status = 'idle';
    this.data = null;
    this.error = null;
    this.updatedAt = 0;

    /** @type {Set<(snapshot: ResourceSnapshot) => void>} */
    this.listeners = new Set();

    /** 在途请求的中止控制器 */
    this.controller = null;

    /** 递增的请求序号：忽略过期响应（后发先至） */
    this.requestSeq = 0;
  }

  /**
   * 只读快照。UI 只应该通过它读取状态。
   * @returns {ResourceSnapshot}
   */
  get() {
    return {
      status: this.status,
      data: this.data,
      error: this.error,
      updatedAt: this.updatedAt,
      loading: this.status === 'loading',
    };
  }

  /**
   * 订阅状态变化。订阅时**立即**用当前快照回调一次，
   * 这样 UI 不必自己先读一遍再订阅（避免竞态与首帧空白）。
   *
   * @param {(snapshot: ResourceSnapshot) => void} listener
   * @returns {() => void} 取消订阅
   */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscribe(listener): listener 必须是函数');
    this.listeners.add(listener);
    // 立即同步一次当前状态
    try {
      listener(this.get());
    } catch (err) {
      console.error(`[data-layer] listener for "${this.name}" threw:`, err);
    }
    return () => this.listeners.delete(listener);
  }

  /** 通知所有订阅者。监听器异常被隔离，不影响其他监听器。 */
  notify() {
    const snapshot = this.get();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error(`[data-layer] listener for "${this.name}" threw:`, err);
      }
    }
    try {
      this.spec.onChange?.(this.name, snapshot);
    } catch (err) {
      console.error(`[data-layer] onChange for "${this.name}" threw:`, err);
    }
  }

  /** 取消进行中的请求（若有）。 */
  abort() {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

  /**
   * 发起一次加载。
   * @param {Object} [options]
   * @param {boolean} [options.silent]  为 true 时不广播 loading 态（静默后台刷新）
   * @returns {Promise<ResourceSnapshot>}
   */
  async load({ silent = false } = {}) {
    // 中止上一个在途请求，保证「最新请求获胜」
    this.abort();

    const controller = new AbortController();
    this.controller = controller;
    const seq = ++this.requestSeq;

    this.error = null;
    this.status = 'loading';
    if (!silent) this.notify();

    const endpoint = typeof this.spec.endpointFactory === 'function'
      ? this.spec.endpointFactory()
      : this.spec.endpoint;

    try {
      const payload = await request(endpoint, {
        method: this.spec.method ?? 'GET',
        ...(this.spec.request ?? {}),
        signal: controller.signal,
      });

      // 过期响应：期间又发了新请求，直接丢弃
      if (seq !== this.requestSeq) return this.get();

      const selected = typeof this.spec.select === 'function' ? this.spec.select(payload) : payload;
      this.data = selected;
      this.error = null;
      this.status = 'ready';
      this.updatedAt = Date.now();
    } catch (err) {
      if (seq !== this.requestSeq) return this.get();

      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError(err instanceof Error ? err.message : String(err), {
              code: 'UNKNOWN',
              endpoint,
            });

      // 主动取消不算错误态：保持原状态，避免页面闪一下 error
      if (apiError.code === 'ABORTED') {
        if (this.status === 'loading') this.status = this.data === null ? 'idle' : 'ready';
        this.notify();
        return this.get();
      }

      this.error = apiError;
      this.status = 'error';
      // 注意：**不清空 this.data**。刷新失败时保留上次成功数据，
      // 由 UI 决定如何同时呈现「错误」与「旧数据」。
    } finally {
      if (this.controller === controller) this.controller = null;
      if (seq === this.requestSeq) this.notify();
    }

    return this.get();
  }

  /** 语义别名：错误后重试。 */
  retry() {
    return this.load();
  }

  /** 语义别名：已就绪时拉取最新（静默，不闪 loading）。 */
  refresh() {
    return this.load({ silent: this.status === 'ready' });
  }

  /**
   * 本地写入一次成功数据（用于 POST 操作返回的权威结果，
   * 避免再发一次 GET）。**只接受服务端真实返回的数据**。
   * @param {*} data
   */
  seed(data) {
    this.data = data;
    this.error = null;
    this.status = 'ready';
    this.updatedAt = Date.now();
    this.notify();
    return this.get();
  }
}

/* ========================================================================== *
 * Resource 工厂 + 真实端点定义
 * ========================================================================== *
 * 下面的每个工厂函数都标注了**真实响应结构**（2026-11-16 在生产容器内实测），
 * 以便字段映射有据可依。探针命令见交付说明。
 */

/**
 * `GET /api/status`
 * 实测响应：`{ "status": "running" }`（HTTP 200；无令牌 401）
 * 副作用：顺带刷新 /avatar 的会话 Cookie。
 * @returns {Resource}
 */
export function createStatusResource() {
  return new Resource('status', {
    endpoint: '/api/status',
    select: (payload) => ({ status: typeof payload.status === 'string' ? payload.status : '' }),
  });
}

/**
 * `GET /api/system`
 * 实测响应（生产容器内，已实测）：
 * {
 *   "hostname": "d50cb228b8a9", "platform": "linux", "arch": "arm64",
 *   "archLabel": "ARM64", "release": "7.0.0-1009-oracle",
 *   "distro": "Ubuntu (kernel 7.0.0)",
 *   "uptime": 4361116.18, "processUptime": 8770.79, "nodeVersion": "v24.22.2",
 *   "cpu": { "model":"Neoverse-N1", "cores":2, "speedMHz":0,
 *            "loadAvg":[0.15,0.29,0.45],
 *            "perCore":[11.65,10.83], "average":11.245 },
 *   "memory": { "total":12503748608, "free":4821004288,
 *               "used":7682744320, "usagePercent":61.44 },
 *   "runtime": { "pid":264207, "lowIntegrity":false, "rss":252891136,
 *                "heapTotal":48644096, "heapUsed":45772680,
 *                "external":32559428, "arrayBuffers":2761970 }
 * }
 * 注意：memory 里**没有** `runtimeRss` 字段（旧前端用 `t.runtime.rss` 自行计算
 * 「本进程」占用），因此本层保持原样，由 UI 组合。
 * @returns {Resource}
 */
export function createSystemResource() {
  return new Resource('system', {
    endpoint: '/api/system',
    select: (payload) => payload,
  });
}

/**
 * `GET /api/processes`
 * 实测响应：
 * {
 *   "list": [{
 *     "pid": 79, "name": "qq", "path": "",
 *     "injected": true, "connected": true, "loggedIn": true,
 *     "uin": "1000000001", "status": "online", "error": "",
 *     "method": "reconnect",
 *     "account": { "uin": "1000000001", "nickname": "示例用户" }   // 或 null
 *   }]
 * }
 * 服务端在失败时返回 `{ list: [], message: "..." }` 且 HTTP 500 —— 本层会把
 * 500 当错误抛出（**不会**把 message 吞成空列表）。
 *
 * status 枚举（源码 statusFor()，五态 + 两个带外态）：
 *   available    未注入，可加载
 *   loading      注入中（带外，由 HookSession 显式设置）
 *   connecting   已注入但未连上
 *   loaded       已连上但未登录
 *   online       已连上且已登录
 *   disconnected 曾经登录过、当前断开
 *   error        出错（error 字段带原因）
 * @returns {Resource}
 */
export function createProcessesResource() {
  return new Resource('processList', {
    endpoint: '/api/processes',
    select: (payload) => (Array.isArray(payload.list) ? payload.list : []),
  });
}

/**
 * `GET /api/qq-list`
 * 实测响应：`{ "list": [{ "uin": "1000000001", "nickname": "示例用户" }] }`
 * 语义：已接入 OneBot 的账号实例（**已登录**的会话），不是"所有 QQ 进程"。
 * @returns {Resource}
 */
export function createQqListResource() {
  return new Resource('qqList', {
    endpoint: '/api/qq-list',
    select: (payload) => (Array.isArray(payload.list) ? payload.list : []),
  });
}

/**
 * `GET /api/connections`
 * 实测响应：
 * {
 *   "list": [{
 *     "uin": "1000000001", "nickname": "示例用户",
 *     "adapters": [
 *       { "name":"http-default","kind":"httpServer","status":"ok","detail":"监听中" },
 *       { "name":"ws-default","kind":"wsServer","status":"ok","detail":"1 个客户端" },
 *       { "name":"satori-main","kind":"satoriServer","status":"ok",
 *         "detail":"Satori v1 · 0 个事件客户端" }
 *     ],
 *     "databaseMigration": { "phase":"complete","usable":true,
 *                            "processed":0,"total":0,"progress":1,
 *                            "estimatedRemainingSeconds":0 }
 *   }]
 * }
 * adapter.status 枚举：ok | warn | down | degraded | disabled
 * adapter.kind  枚举：httpServer | httpClient | wsServer | wsClient | satoriServer
 *                   （源码里还有 satoriClient 变体）
 * databaseMigration.phase 枚举：preparing | failed | 其他（迁移中）| complete
 * @returns {Resource}
 */
export function createConnectionsResource() {
  return new Resource('connections', {
    endpoint: '/api/connections',
    select: (payload) => (Array.isArray(payload.list) ? payload.list : []),
  });
}

/**
 * `GET /api/notifications/recent?limit=N`
 * 实测响应：`{ "recent": [] }`（当前无投递记录）
 * 有记录时每条形如（源码 NotificationManager.record）：
 * {
 *   "time": 1763290000000,        // 毫秒时间戳
 *   "uin": "1000000001",
 *   "event": "offline" | "online",
 *   "channelId": "<渠道 id>",
 *   "ok": true|false,
 *   "status": 200 | undefined,    // HTTP 状态码（HTTP 类渠道）
 *   "error": "..." | undefined    // ok=false 时的原因
 * }
 * limit 默认 100、上限 100（服务端 Math.min(..., 100)）。
 * @param {number} [limit]
 * @returns {Resource}
 */
export function createNotificationsResource(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 20));
  return new Resource('notifications', {
    endpoint: `/api/notifications/recent?limit=${safeLimit}`,
    select: (payload) => (Array.isArray(payload.recent) ? payload.recent : []),
  });
}

/* ========================================================================== *
 * 进程操作（POST）—— 进程页的动作数据源
 * ========================================================================== *
 * 三个端点都返回同一形状（实测）：
 *   { "success": true|false, "process": { ...与 GET /api/processes 同一结构... } }
 * 失败时（实测 load 不存在的 pid）：
 *   { "success": false, "process": { ..., "status":"error",
 *                                    "error":"component loading failed [COMPONENT_LOAD_FAILED]" } }
 * 503（hookManager 缺失）：`{ success:false, message:"hook manager is not available" }`
 * 400（非法 pid）：`{ success:false, message:"invalid pid" }`
 * 500（内部异常）：`{ success:false, message:"操作失败，请检查服务器日志" }`
 *
 * ⚠️ 注意：`success:false` 时 HTTP 状态码仍是 **200**（除 4xx/5xx 分支外），
 * 所以**不能只看 response.ok**，必须检查 payload.success 与 process.status。
 */

/** 进程操作语义 */
export const PROCESS_ACTIONS = ['load', 'unload', 'refresh'];

/**
 * 对某个 pid 执行 load/unload/refresh。
 *
 * @param {number} pid
 * @param {'load'|'unload'|'refresh'} action
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{success: boolean, process: Object|null, message: string}>}
 * @throws {ApiError} 仅在传输层 / 鉴权 / 协议错误时抛出；
 *                    业务失败（success:false）以返回值表达，便于 UI 就地提示。
 */
export async function runProcessAction(pid, action, { signal } = {}) {
  if (!PROCESS_ACTIONS.includes(action)) {
    throw new TypeError(`runProcessAction: 未知动作 ${action}`);
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new TypeError(`runProcessAction: 非法 pid ${pid}`);
  }

  const payload = await request(`/api/processes/${pid}/${action}`, {
    method: 'POST',
    signal,
  });

  // 服务端可能只返回 message（503/400/500），此时没有 process
  const process = payload && typeof payload.process === 'object' ? payload.process : null;
  const success = Boolean(payload && payload.success === true);
  const message = payload && typeof payload.message === 'string' ? payload.message : '';

  return { success, process, message };
}

/**
 * 创建一个「操作型」Resource：把一次进程操作包装成状态机，
 * 让 UI 可以用同一套 loading/error 语义渲染按钮。
 *
 * 与普通 Resource 不同：它不自动 load，而是由 `run()` 显式触发，
 * 且成功后会把权威结果 `seed()` 回共享的进程列表 Resource（若有提供）。
 *
 * @param {Object} spec
 * @param {string} spec.name
 * @param {number} spec.pid
 * @param {'load'|'unload'|'refresh'} spec.action
 * @param {Resource} [spec.processList]  成功后用于回写的进程列表数据源
 * @returns {Resource & {run: () => Promise<*>}}
 */
export function createProcessActionResource({ name, pid, action, processList }) {
  const resource = new Resource(name, {
    endpoint: `/api/processes/${pid}/${action}`,
    // 操作型 Resource 不会走通用 GET 路径，这里只是满足构造校验
    select: (payload) => payload,
  });

  /**
   * 执行操作。返回 { success, process, message }，同时把状态写入自身。
   * @returns {Promise<{success: boolean, process: Object|null, message: string}>}
   */
  resource.run = async () => {
    resource.abort();
    const controller = new AbortController();
    resource.controller = controller;
    const seq = ++resource.requestSeq;

    resource.error = null;
    resource.status = 'loading';
    resource.notify();

    try {
      const result = await runProcessAction(pid, action, { signal: controller.signal });
      if (seq !== resource.requestSeq) return result;

      if (result.success) {
        resource.data = result.process;
        resource.error = null;
        resource.status = 'ready';
        resource.updatedAt = Date.now();

        // 用服务端返回的权威进程信息回写列表，避免再发一次 GET。
        // 这里只替换对应 pid 的那一条，其余保持原样。
        if (processList && result.process && Array.isArray(processList.data)) {
          const index = processList.data.findIndex((item) => item && item.pid === pid);
          if (index >= 0) {
            const next = processList.data.slice();
            next[index] = result.process;
            processList.seed(next);
          }
        }
      } else {
        // 业务失败：HTTP 200 但 success:false。构造 ApiError 以便 UI 统一渲染。
        const detail =
          (result.process && typeof result.process.error === 'string' && result.process.error) ||
          result.message ||
          '';
        resource.error = new ApiError(detail || STRINGS.httpError({ status: 0, statusText: '' }), {
          code: 'ACTION_FAILED',
          endpoint: `/api/processes/${pid}/${action}`,
          payload: result,
        });
        resource.status = 'error';
        // 失败时也把服务端返回的进程信息保存下来（它带着真实 error 文本）
        if (result.process) resource.data = result.process;
      }
      return result;
    } catch (err) {
      if (seq !== resource.requestSeq) throw err;
      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError(err instanceof Error ? err.message : String(err), {
              code: 'UNKNOWN',
              endpoint: `/api/processes/${pid}/${action}`,
            });
      if (apiError.code !== 'ABORTED') {
        resource.error = apiError;
        resource.status = 'error';
      }
      throw apiError;
    } finally {
      if (resource.controller === controller) resource.controller = null;
      if (seq === resource.requestSeq) resource.notify();
    }
  };

  return resource;
}

/* ========================================================================== *
 * 刷新调度器
 * ========================================================================== */

/**
 * 轮询调度器。**遵守页面前端既有约定**（docs-source/webui/overview.md
 * 「Foreground polling pauses in hidden tabs and waits for each request to
 * finish before scheduling the next」）：
 *   - 页面隐藏时暂停
 *   - 上一次请求完成后才安排下一次（不堆叠请求）
 *
 * @param {Object} options
 * @param {number} options.intervalMs
 * @param {() => Promise<void>|void} options.task
 * @returns {{start: () => void, stop: () => void, trigger: () => Promise<void>}}
 */
export function createPoller({ intervalMs = 5000, task } = {}) {
  let timer = null;
  let running = false;
  let stopped = true;

  const schedule = () => {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, intervalMs);
  };

  const tick = async () => {
    if (stopped) return;
    // 隐藏标签页不轮询
    if (typeof document !== 'undefined' && document.hidden) {
      schedule();
      return;
    }
    if (running) return; // 理论上不会发生（上面保证串行）
    running = true;
    try {
      await task();
    } catch (err) {
      // 轮询失败由各 Resource 的状态承载，这里只记录
      console.warn('[data-layer] poll task failed:', err);
    } finally {
      running = false;
      schedule();
    }
  };

  const onVisibility = () => {
    if (stopped) return;
    if (!document.hidden) void tick();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility);
      }
      schedule();
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
    trigger: tick,
  };
}