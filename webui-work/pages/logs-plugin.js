/**
 * logs-plugin.js — Haizakura WebUI「日志」页（原子化 / 插件化 / 服务端状态驱动）
 *
 * 设计约束
 *  1. 原子化：优先复用宿主提供的原子组件（`globalThis.HaizakuraAtoms`，由 atoms.js 提供）。
 *     若 atoms.js 尚未就绪，则退回本文件底部的 `INLINE_ATOMS`（已标注「应由 atoms.js 提供」），
 *     接口签名与原子层保持一致，接入时无需改调用点。
 *  2. 插件化：本文件只导出 `createLogsPlugin()` / `definePlugin` 产物，
 *     由宿主注册（`definePlugin({ id, title, mount, unmount, refresh })`）。
 *  3. 状态驱动：loading / ready / error / empty 四态均由真实服务端响应推导，不伪造数据。
 *  4. 零依赖：纯原生 DOM，无 npm 依赖，无框架。
 *
 * 真实数据源（已对 snowluma-hz 实测）
 *  - GET  /api/logs/level           → { level, levels: ["trace","debug","info","success","warn","error"] }
 *  - POST /api/logs/level { level } → { level, levels }；非法级别返回 400 { message, levels }
 *  - GET  /api/logs?limit=N         → { list: [ { id, time, level, scope, uin?, req?, message, line } ] }
 *  - GET  /api/logs/stream          → SSE。首帧 `data: {"type":"ready"}`，
 *                                     后续帧为原始日志条目（无 `type` 字段）：
 *                                     { id, time, level, scope, uin, req?, message, line }
 *                                     心跳：`: heartbeat`（15s）。鉴权用 X-SnowLuma-Token。
 *  - GET  /api/logs/export/trace    → text/plain 附件，文件名取自 Content-Disposition：
 *                                     `snowluma-trace-<ISO>.log`
 *
 * @module logs-plugin
 */

/* ------------------------------------------------------------------ *
 * STRINGS — 全部用户可见文案集中于此，后续由 i18n 层接管
 * ------------------------------------------------------------------ */
export const STRINGS = {
    page: {
        title: '运行日志',
        subtitle: '服务端环形缓冲区 + SSE 实时推送',
    },
    status: {
        loading: '连接中',
        live: '实时',
        reconnecting: '重连中',
        closed: '已断开',
    },
    level: {
        label: '服务端日志级别',
        hint: '普通日志仅影响控制台 / 实时流；首次登录凭据仅输出到启动终端；文件等级由环境变量决定，默认为 debug',
        switching: '正在更新服务端日志级别',
        updated: '日志级别已更新',
        updateFailed: '日志级别更新失败',
        loadFailed: '加载服务端日志级别失败',
        restoreInfo: '恢复 INFO',
        switchTo: (level) => `切换为 ${String(level).toUpperCase()}`,
    },
    trace: {
        banner: 'TRACE 已开启：正在记录大量、可能未经脱敏的数据',
        dialogTitle: '开启 TRACE 日志？',
        dialogIntro: '开启前请确认：',
        warnings: [
            'TRACE 会产生非常大量的数据。',
            'TRACE 可能包含未经脱敏的隐私数据和凭据。',
            'TRACE 不适合长时间开启。',
            'TRACE 仅用于小规模问题复现和 bug 反馈。',
        ],
        confirm: '开启 TRACE',
    },
    search: {
        placeholder: '搜索消息 / 模块 / 级别',
        clear: '清除搜索',
    },
    filter: {
        title: '显示选项',
        levels: '级别',
        clear: '清除筛选',
        presetHint: '一键套用级别 / 行数 / 换行；手动调整后变为「自定义」',
        maxLines: '最大行数',
        wrap: '自动换行',
        autoScrollOn: '自动滚动已开启',
        autoScrollPaused: '自动滚动已暂停',
    },
    presets: {
        label: '视图预设',
        custom: '自定义',
        dev: '开发',
        devHint: '全部级别 · 2000 行 · 换行',
        ops: '运维',
        opsHint: 'INFO 以上 · 1000 行',
        minimal: '精简',
        minimalHint: '仅 WARN/ERROR · 500 行',
    },
    highlight: {
        title: '高亮关键词',
        placeholder: '输入关键词后回车',
        add: '添加',
        remove: (keyword) => `移除高亮规则 ${keyword}`,
        hint: '命中关键词的行会被着色',
        colors: { amber: '琥珀', rose: '玫瑰', emerald: '翡翠', sky: '天蓝', violet: '紫' },
    },
    toolbar: {
        exportView: '导出当前视图',
        exportTrace: '导出完整 TRACE',
        clearView: '清空视图',
        refresh: '刷新',
    },
    clear: {
        dialogTitle: '清空当前日志视图？',
        dialogBody: '此操作仅清空浏览器视图中的日志，不会影响服务端的日志缓冲区。',
        confirm: '清空',
        busy: '正在清空日志视图',
        done: '日志视图已清空',
        failed: '日志视图清空失败',
    },
    export: {
        traceBusyTitle: '正在导出完整 TRACE',
        traceBusyDetail: '正在读取服务端 TRACE 文件',
        traceDone: '完整 TRACE 已导出',
        traceFailed: 'TRACE 导出失败',
        viewFailed: '导出失败',
        viewFilePrefix: 'snowluma-logs',
        traceFallbackName: 'snowluma-trace.log',
    },
    list: {
        empty: '暂无日志',
        emptyFiltered: '没有符合筛选条件的日志',
        count: (shown, total, streaming) => `${shown}/${total} 条 · ${streaming}`,
        loadFailed: '加载日志失败',
        retry: '重试',
        columns: { time: '时间', level: '级别', scope: '模块', message: '消息' },
        requestId: '请求关联号',
    },
    a11y: {
        logRegion: '日志列表',
        autoScrollToggle: '自动滚动开关',
    },
};

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 与服务端 LOG_LEVELS 一致（顺序即权重升序）。 */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'success', 'warn', 'error'];

const LEVEL_WEIGHT = LOG_LEVELS.reduce((acc, lvl, i) => ((acc[lvl] = i), acc), {});

/** 服务端 normalizeRuntimeConfig 的夹取区间：clampInt(maxLines, 100, 5000)。 */
const MAX_LINES_MIN = 100;
const MAX_LINES_MAX = 5000;

const DEFAULT_MAX_LINES = 1000;
const RECENT_LIMIT = 1000;

/** 视图预设（对齐 reference/logs-page 的 dev / ops / minimal）。 */
const PRESETS = [
    {
        id: 'dev',
        label: STRINGS.presets.dev,
        hint: STRINGS.presets.devHint,
        bundle: { visibleLevels: LOG_LEVELS.slice(), maxLines: 2000, autoScroll: true, wrap: true },
    },
    {
        id: 'ops',
        label: STRINGS.presets.ops,
        hint: STRINGS.presets.opsHint,
        bundle: { visibleLevels: ['info', 'success', 'warn', 'error'], maxLines: 1000, autoScroll: true, wrap: false },
    },
    {
        id: 'minimal',
        label: STRINGS.presets.minimal,
        hint: STRINGS.presets.minimalHint,
        bundle: { visibleLevels: ['warn', 'error'], maxLines: 500, autoScroll: true, wrap: false },
    },
];

const HIGHLIGHT_COLORS = [
    { id: 'amber', swatch: '#f59e0b' },
    { id: 'rose', swatch: '#f43f5e' },
    { id: 'emerald', swatch: '#10b981' },
    { id: 'sky', swatch: '#38bdf8' },
    { id: 'violet', swatch: '#8b5cf6' },
];

const TOKEN_STORAGE_KEY = 'snowluma_token';
const TOKEN_HEADER = 'X-SnowLuma-Token';

/** SSE 重连间隔，对齐 reference 的 openSseChannel（1s）。 */
const RECONNECT_DELAY_MS = 1000;

/** 单帧上限，对齐 reference 的 1 MiB 防护。 */
const MAX_FRAME_BYTES = 1024 * 1024;

/** 批量入队窗口：SSE 高频下 80ms 合并一次渲染，对齐 reference。 */
const FLUSH_INTERVAL_MS = 80;

/* ------------------------------------------------------------------ *
 * 原子层解析 —— 优先 atoms.js，缺失时退回 INLINE_ATOMS
 * ------------------------------------------------------------------ */

/**
 * 取原子组件表。
 * atoms.js 由另一条工作流提供；接入后本函数的返回即切换为共享实现，
 * 调用点无需改动（INLINE_ATOMS 与共享原子层同签名）。
 * @returns {object}
 */
function resolveAtoms() {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    return g.HaizakuraAtoms || INLINE_ATOMS;
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function readToken() {
    try {
        return globalThis.localStorage ? globalThis.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
    } catch {
        return null;
    }
}

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** 把服务端 ISO 时间渲染为本地 HH:MM:SS；解析失败则原样返回。 */
function formatClock(iso) {
    if (typeof iso !== 'string' || iso === '') return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 服务端条目缺少 line 时用与后端 render() 相同的版式重建。 */
function renderFallbackLine(entry) {
    const time = formatClock(entry.time);
    const level = String(entry.level || '').toUpperCase().padEnd(7, ' ');
    const scope = entry.scope || '';
    const req = entry.req === undefined ? '' : `[req#${entry.req}] `;
    return `${time} ${level} [${scope}] ${req}${entry.message || ''}`;
}

function safeStringify(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/** 触发浏览器下载（无依赖）。 */
function downloadBlob(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ *
 * API 客户端（最小实现）
 * 若宿主已注入共享客户端（globalThis.HaizakuraApi），则直接复用其 request/getJson/postJson。
 * ------------------------------------------------------------------ */

function createApi() {
    const shared = globalThis.HaizakuraApi;
    if (shared && typeof shared.getJson === 'function' && typeof shared.postJson === 'function') {
        return shared;
    }

    function headers(extra) {
        const h = Object.assign({}, extra || {});
        const token = readToken();
        if (token) h[TOKEN_HEADER] = token;
        return h;
    }

    async function request(path, init) {
        const opts = Object.assign({ cache: 'no-store' }, init || {});
        opts.headers = headers(opts.headers);
        if (opts.body && !(opts.body instanceof FormData) && !opts.headers['Content-Type']) {
            opts.headers['Content-Type'] = 'application/json';
        }
        return fetch(path, opts);
    }

    async function readJson(res) {
        let body = null;
        try {
            body = await res.json();
        } catch {
            body = null;
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            const err = new Error(res.ok ? '服务端返回了无效的 JSON 响应' : res.statusText || '请求失败');
            err.status = res.status;
            throw err;
        }
        return body;
    }

    async function getJson(path) {
        const res = await request(path, { method: 'GET' });
        const body = await readJson(res);
        if (!res.ok) {
            const err = new Error(body.message || body.error || res.statusText || '请求失败');
            err.status = res.status;
            err.body = body;
            throw err;
        }
        return body;
    }

    async function postJson(path, payload) {
        const res = await request(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        const body = await readJson(res);
        if (!res.ok) {
            const err = new Error(body.message || body.error || res.statusText || '请求失败');
            err.status = res.status;
            err.body = body;
            throw err;
        }
        return body;
    }

    return {
        request,
        getJson,
        postJson,
        token: readToken,
        headerName: TOKEN_HEADER,
    };
}

/* ------------------------------------------------------------------ *
 * SSE 通道（fetch + ReadableStream，带鉴权头、重连、心跳容忍）
 * 说明：/api/logs/stream 需要 X-SnowLuma-Token，原生 EventSource 无法携带自定义头，
 *       因此按 reference 的做法用 fetch 流式读取并自行解析 `data:` 帧。
 * ------------------------------------------------------------------ */

function createSseParser() {
    let buffer = '';
    let dataLines = [];
    let pendingCr = false;
    let bytes = 0;

    return function* feed(chunk) {
        for (const ch of chunk) {
            if (pendingCr && ch === '\n') {
                pendingCr = false;
                continue;
            }
            if (ch !== '\r' && ch !== '\n') {
                if (pendingCr) pendingCr = false;
                buffer += ch;
                bytes += 1;
                if (bytes > MAX_FRAME_BYTES) throw new Error('实时数据帧过大');
                continue;
            }
            pendingCr = ch === '\r';
            if (buffer === '') {
                const payload = dataLines.join('\n');
                dataLines = [];
                bytes = 0;
                if (payload) yield payload;
            } else if (buffer.startsWith('data:')) {
                const rest = buffer.slice(5);
                dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest);
            } else if (buffer === 'data') {
                dataLines.push('');
            }
            // 其它字段（event: / id: / retry: / 注释 `: heartbeat`）按 SSE 规范忽略。
            buffer = '';
        }
    };
}

/**
 * 打开一条 SSE 通道。
 * @param {string} url
 * @param {{method?:string, body?:string, onEvent:(payload:object)=>void, onStatus:(status:string)=>void}} opts
 * @returns {() => void} dispose
 */
function openSseChannel(url, opts) {
    const onEvent = opts.onEvent;
    const onStatus = opts.onStatus || (() => {});
    const method = opts.method || 'GET';
    const body = opts.body;

    let disposed = false;
    let hidden = false;
    let controller = null;
    let retryTimer = null;

    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    function clearRetry() {
        if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
    }

    function abort() {
        const c = controller;
        controller = null;
        if (c) c.abort();
    }

    function scheduleRetry() {
        if (disposed || hidden || retryTimer !== null) return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void connect();
        }, RECONNECT_DELAY_MS);
        onStatus('reconnecting');
    }

    function teardown() {
        if (disposed) return;
        disposed = true;
        clearRetry();
        abort();
        if (isBrowser) {
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('pageshow', onShow);
            document.removeEventListener('visibilitychange', onVisibility);
            document.removeEventListener('freeze', onHide);
        }
        onStatus('closed');
    }

    async function connect() {
        if (disposed || hidden || controller) return;
        const token = readToken();
        if (!token) {
            teardown();
            return;
        }
        const my = new AbortController();
        controller = my;
        const headers = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache', [TOKEN_HEADER]: token };
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        try {
            const res = await fetch(url, {
                method,
                cache: 'no-store',
                headers,
                body,
                signal: my.signal,
            });
            if (controller !== my || disposed) {
                if (res.body) await res.body.cancel().catch(() => {});
                return;
            }
            if (res.status === 401) {
                teardown();
                return;
            }
            if (!res.ok || !res.body) {
                throw new Error(res.statusText || '实时连接失败');
            }
            onStatus('open');
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            const parse = createSseParser();
            for (;;) {
                const { done, value } = await reader.read();
                if (controller !== my || disposed) break;
                const text = decoder.decode(value || new Uint8Array(0), { stream: !done });
                for (const payload of parse(text)) {
                    let parsed;
                    try {
                        parsed = JSON.parse(payload);
                    } catch {
                        continue; // 非 JSON 帧直接跳过，不污染视图
                    }
                    onEvent(parsed);
                }
                if (done) break;
            }
        } catch (err) {
            if (!(err && err.name === 'AbortError') && !(my.signal && my.signal.aborted)) {
                // 连接异常：交给 scheduleRetry 处理，不抛出到调用方。
            }
        } finally {
            if (controller === my) controller = null;
            if (!disposed) scheduleRetry();
        }
    }

    function onHide() {
        hidden = true;
        clearRetry();
        abort();
    }

    function onShow() {
        if (!hidden) return;
        hidden = false;
        clearRetry();
        void connect();
    }

    function onVisibility() {
        if (document.visibilityState === 'visible') onShow();
    }

    if (isBrowser) {
        window.addEventListener('pagehide', onHide);
        window.addEventListener('pageshow', (e) => {
            if (e && e.persisted) onShow();
        });
        document.addEventListener('visibilitychange', onVisibility);
        document.addEventListener('freeze', onHide);
    }

    void connect();
    return teardown;
}

/* ------------------------------------------------------------------ *
 * 页面状态
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} LogsState
 * @property {'loading'|'ready'|'error'|'empty'} status
 * @property {string|null} error
 * @property {Array<object>} lines
 * @property {string|null} level
 * @property {string[]} levels
 * @property {Set<string>} visibleLevels
 * @property {number} maxLines
 * @property {boolean} autoScroll
 * @property {boolean} wrap
 * @property {string} search
 * @property {string} preset
 * @property {Array<{keyword:string,color:string}>} highlightRules
 * @property {string} streamStatus
 */

function createInitialState() {
    return {
        status: 'loading',
        error: null,
        lines: [],
        level: null,
        levels: LOG_LEVELS.slice(),
        visibleLevels: new Set(LOG_LEVELS),
        maxLines: DEFAULT_MAX_LINES,
        autoScroll: true,
        wrap: false,
        search: '',
        preset: 'dev',
        highlightRules: [],
        streamStatus: 'closed',
    };
}

/* ------------------------------------------------------------------ *
 * 插件
 * ------------------------------------------------------------------ */

/**
 * 创建日志页插件。
 * @param {object} [options]
 * @param {object} [options.api]   注入的 API 客户端（默认 createApi()）
 * @param {object} [options.atoms] 注入的原子组件表（默认 resolveAtoms()）
 * @param {object} [options.strings] 文案覆盖（i18n 接管前的过渡口）
 * @returns {{id:string,title:string,mount:Function,unmount:Function,refresh:Function}}
 */
export function createLogsPlugin(options) {
    const opts = options || {};
    const api = opts.api || createApi();
    const strings = opts.strings || STRINGS;

    /** @type {LogsState} */
    let state = createInitialState();

    let container = null;
    let atoms = null;
    let root = null;
    let listEl = null;
    let disposers = [];
    let disposeStream = null;
    let pendingLines = [];
    let flushTimer = null;
    let mounted = false;

    /* ---------------- 渲染 ---------------- */

    function visibleLines() {
        const needle = state.search.trim().toLowerCase();
        const matched = [];
        for (const entry of state.lines) {
            const lvl = String(entry && entry.level ? entry.level : '').toLowerCase();
            if (!state.visibleLevels.has(lvl)) continue;
            if (needle) {
                const haystack = [
                    entry.message,
                    entry.scope,
                    entry.level,
                    entry.uin === undefined ? '' : String(entry.uin),
                    entry.req === undefined ? '' : String(entry.req),
                ]
                    .join('\u0000')
                    .toLowerCase();
                if (!haystack.includes(needle)) continue;
            }
            matched.push(entry);
        }
        return matched;
    }

    function highlightColorFor(text) {
        if (!state.highlightRules.length || !text) return null;
        const lower = text.toLowerCase();
        for (const rule of state.highlightRules) {
            if (rule.keyword && lower.includes(rule.keyword.toLowerCase())) {
                const found = HIGHLIGHT_COLORS.find((c) => c.id === rule.color);
                return found ? found.swatch : HIGHLIGHT_COLORS[0].swatch;
            }
        }
        return null;
    }

    function renderLine(entry) {
        const { el } = atoms;
        const level = String(entry.level || 'info').toLowerCase();
        const message = entry.message === undefined || entry.message === null ? '' : String(entry.message);
        const swatch = highlightColorFor(message);

        const reqChip =
            entry.req === undefined
                ? null
                : el('span', {
                      class: 'hz-log-req',
                      title: strings.list.requestId,
                      text: `#${entry.req}`,
                  });

        const main = el(
            'div',
            {
                class: 'hz-log-line',
                'data-level': level,
                dataset: { id: String(entry.id === undefined ? '' : entry.id) },
                style: swatch ? { borderLeftColor: swatch } : null,
            },
            el('span', { class: 'hz-log-time', text: formatClock(entry.time) }),
            el('span', { class: 'hz-log-level', 'data-level': level, text: level.toUpperCase() }),
            el('span', {
                class: 'hz-log-scope',
                text: entry.scope === undefined || entry.scope === null ? '' : `[${entry.scope}]`,
            }),
            el(
                'span',
                {
                    class: state.wrap ? 'hz-log-msg hz-log-msg--wrap' : 'hz-log-msg',
                    title: state.wrap ? null : message,
                },
                reqChip,
                el('span', { text: message }),
            ),
        );
        return main;
    }

    function renderListBody() {
        const { el, EmptyState } = atoms;
        const lines = visibleLines();

        if (state.status === 'loading' && state.lines.length === 0) {
            const wrap = el('div', { class: 'hz-logs-lines' });
            for (let i = 0; i < 8; i += 1) {
                wrap.appendChild(el('div', { class: 'hz-skeleton hz-skeleton--line' }));
            }
            return wrap;
        }

        if (state.status === 'error' && state.lines.length === 0) {
            return EmptyState({
                tone: 'error',
                title: strings.list.loadFailed,
                hint: state.error || '',
                action: { label: strings.list.retry, onClick: () => void reload({ keepLines: false }) },
            });
        }

        if (lines.length === 0) {
            const filtered = state.lines.length > 0 || state.search.trim() !== '';
            return EmptyState({
                tone: 'empty',
                title: filtered ? strings.list.emptyFiltered : strings.list.empty,
                hint: filtered ? strings.search.placeholder : '',
                action: filtered
                    ? {
                          label: strings.filter.clear,
                          onClick: () => {
                              state.search = '';
                              state.visibleLevels = new Set(LOG_LEVELS);
                              state.preset = 'custom';
                              render();
                          },
                      }
                    : null,
            });
        }

        const wrap = el('div', { class: 'hz-logs-lines', role: 'log', 'aria-label': strings.a11y.logRegion });
        for (const entry of lines) wrap.appendChild(renderLine(entry));
        return wrap;
    }

    function renderLevelControls() {
        const { el, Button, Badge } = atoms;
        const bar = el('div', { class: 'hz-toolbar-group' });
        bar.appendChild(el('span', { class: 'hz-label', text: strings.level.label }));

        const current = state.level;
        for (const lvl of state.levels) {
            bar.appendChild(
                Button({
                    label: lvl.toUpperCase(),
                    active: current === lvl,
                    disabled: current === null,
                    title: current === lvl ? lvl : strings.level.switchTo(lvl),
                    onClick: () => void requestLevel(lvl),
                }),
            );
        }
        if (current === 'trace') {
            bar.appendChild(
                Button({
                    label: strings.level.restoreInfo,
                    variant: 'outline',
                    onClick: () => void requestLevel('info'),
                }),
            );
        }
        if (state.level) bar.appendChild(Badge({ label: state.level.toUpperCase(), tone: state.level }));
        return bar;
    }

    function renderTraceBanner() {
        const { el } = atoms;
        if (state.level !== 'trace') return null;
        return el('div', { class: 'hz-banner hz-banner--warn', role: 'alert' }, el('span', { text: strings.trace.banner }));
    }

    function renderToolbar() {
        const { el, Button, IconButton, Input, Select } = atoms;

        const search = Input({
            value: state.search,
            placeholder: strings.search.placeholder,
            onInput: (value) => {
                state.search = value;
                renderList();
            },
        });

        const presetSelect = Select({
            value: state.preset,
            options: PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.hint })).concat([
                { value: 'custom', label: strings.presets.custom },
            ]),
            ariaLabel: strings.presets.label,
            onChange: (value) => {
                const preset = PRESETS.find((p) => p.id === value);
                if (preset) {
                    Object.assign(state, preset.bundle);
                    state.visibleLevels = new Set(preset.bundle.visibleLevels);
                    state.preset = preset.id;
                } else {
                    state.preset = 'custom';
                }
                render();
            },
        });

        const wrapToggle = Button({
            label: strings.filter.wrap,
            active: state.wrap,
            onClick: () => {
                state.wrap = !state.wrap;
                state.preset = 'custom';
                render();
            },
        });

        const autoScrollToggle = Button({
            label: state.autoScroll ? strings.filter.autoScrollOn : strings.filter.autoScrollPaused,
            active: state.autoScroll,
            title: strings.a11y.autoScrollToggle,
            onClick: () => {
                state.autoScroll = !state.autoScroll;
                render();
            },
        });

        const maxLines = Input({
            type: 'number',
            value: String(state.maxLines),
            ariaLabel: strings.filter.maxLines,
            min: MAX_LINES_MIN,
            max: MAX_LINES_MAX,
            onInput: (value) => {
                state.maxLines = clampInt(value, MAX_LINES_MIN, MAX_LINES_MAX, DEFAULT_MAX_LINES);
                state.preset = 'custom';
                trimLines();
                renderList();
            },
        });

        const exportView = Button({
            label: strings.toolbar.exportView,
            onClick: () => exportView(),
        });

        const exportTrace = Button({
            label: strings.toolbar.exportTrace,
            busy: state.traceExporting === true,
            onClick: () => void exportTrace(),
        });

        const clearView = Button({
            label: strings.toolbar.clearView,
            variant: 'danger',
            onClick: () => clearView(),
        });

        const refresh = IconButton({
            label: strings.toolbar.refresh,
            icon: 'refresh',
            onClick: () => void reload({ keepLines: true }),
        });

        const row1 = el(
            'div',
            { class: 'hz-toolbar' },
            el('div', { class: 'hz-toolbar-group hz-toolbar-group--grow' }, search, presetSelect),
            el('div', { class: 'hz-toolbar-group' }, wrapToggle, autoScrollToggle, maxLines, refresh),
        );

        const row2 = el(
            'div',
            { class: 'hz-toolbar' },
            renderLevelControls(),
            el('div', { class: 'hz-toolbar-group' }, exportView, exportTrace, clearView),
        );

        const levels = el('div', { class: 'hz-toolbar-group hz-chips' });
        for (const lvl of LOG_LEVELS) {
            levels.appendChild(
                Button({
                    label: lvl.toUpperCase(),
                    active: state.visibleLevels.has(lvl),
                    title: lvl,
                    onClick: () => {
                        const next = new Set(state.visibleLevels);
                        if (next.has(lvl)) next.delete(lvl);
                        else next.add(lvl);
                        state.visibleLevels = next;
                        state.preset = 'custom';
                        render();
                    },
                }),
            );
        }

        const row3 = el(
            'div',
            { class: 'hz-toolbar' },
            el('span', { class: 'hz-label', text: strings.filter.levels }),
            levels,
            state.visibleLevels.size < LOG_LEVELS.length
                ? Button({
                      label: strings.filter.clear,
                      variant: 'ghost',
                      onClick: () => {
                          state.visibleLevels = new Set(LOG_LEVELS);
                          state.preset = 'custom';
                          render();
                      },
                  })
                : null,
        );

        return el('div', { class: 'hz-logs-controls' }, renderTraceBanner(), row1, row2, row3, renderHighlightEditor());
    }

    function renderHighlightEditor() {
        const { el, Button, Input, Badge } = atoms;
        const wrap = el('div', { class: 'hz-toolbar hz-highlight' });
        wrap.appendChild(el('span', { class: 'hz-label', text: strings.highlight.title }));

        let draftColor = 'amber';
        const draft = Input({
            value: '',
            placeholder: strings.highlight.placeholder,
            ariaLabel: strings.highlight.title,
            onKeyDown: (ev) => {
                if (ev.key === 'Enter') commit();
            },
        });

        function commit() {
            const keyword = String(draft.value || '').trim();
            if (!keyword) return;
            state.highlightRules = state.highlightRules
                .concat([{ keyword, color: draftColor }])
                .slice(-20);
            draft.value = '';
            render();
        }

        wrap.appendChild(draft);
        for (const color of HIGHLIGHT_COLORS) {
            wrap.appendChild(
                Button({
                    label: strings.highlight.colors[color.id],
                    active: draftColor === color.id,
                    swatch: color.swatch,
                    onClick: () => {
                        draftColor = color.id;
                        render();
                    },
                }),
            );
        }
        wrap.appendChild(Button({ label: strings.highlight.add, onClick: commit }));
        wrap.appendChild(el('span', { class: 'hz-hint', text: strings.highlight.hint }));

        if (state.highlightRules.length) {
            const ruleWrap = el('div', { class: 'hz-toolbar-group hz-chips' });
            state.highlightRules.forEach((rule, index) => {
                ruleWrap.appendChild(
                    Badge({
                        label: rule.keyword,
                        swatch: (HIGHLIGHT_COLORS.find((c) => c.id === rule.color) || HIGHLIGHT_COLORS[0]).swatch,
                        title: strings.highlight.remove(rule.keyword),
                        onClick: () => {
                            state.highlightRules = state.highlightRules.filter((_, i) => i !== index);
                            render();
                        },
                    }),
                );
            });
            wrap.appendChild(ruleWrap);
        }
        return wrap;
    }

    function renderStatusBar() {
        const { el } = atoms;
        const lines = visibleLines();
        const statusText =
            state.streamStatus === 'open'
                ? strings.status.live
                : state.streamStatus === 'reconnecting'
                  ? strings.status.reconnecting
                  : state.streamStatus === 'closed'
                    ? strings.status.closed
                    : strings.status.loading;
        return el(
            'div',
            { class: 'hz-statusbar' },
            el('span', {
                class: 'hz-statusbar-dot',
                dataset: { status: state.streamStatus },
            }),
            el('span', { text: statusText }),
            el('span', { class: 'hz-statusbar-sep', text: '·' }),
            el('span', { text: strings.list.count(lines.length, state.lines.length, 'SSE 实时推送') }),
            state.maxLines ? el('span', { class: 'hz-statusbar-sep', text: '·' }) : null,
            state.maxLines ? el('span', { text: `${strings.filter.maxLines} ${state.maxLines}` }) : null,
        );
    }

    function renderList() {
        if (!listEl) return;
        const scrollTop = listEl.scrollTop;
        const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 48;
        listEl.replaceChildren(renderListBody());
        syncSkeleton();
        if (state.autoScroll && atBottom) {
            listEl.scrollTop = listEl.scrollHeight;
        } else {
            listEl.scrollTop = scrollTop;
        }
        const bar = root && root.querySelector('.hz-statusbar');
        if (bar) bar.replaceWith(renderStatusBar());
    }

    function syncSkeleton() {
        if (root) root.setAttribute('data-status', state.status);
    }

    function render() {
        if (!mounted || !container) return;
        const { el } = atoms;
        if (!root) {
            listEl = el('div', { class: 'hz-logs-scroll', tabindex: '0' });
            listEl.addEventListener('scroll', () => {
                // 用户手动上滚时暂停自动滚动；回到底部时恢复。
                const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 48;
                if (!atBottom && state.autoScroll) {
                    state.autoScroll = false;
                    const toggle = root.querySelector('[data-role="autoscroll"]');
                    if (toggle) toggle.setAttribute('data-active', 'false');
                }
            });
            root = el(
                'div',
                { class: 'hz-page hz-logs', dataset: { status: state.status } },
                el(
                    'header',
                    { class: 'hz-page-header' },
                    el(
                        'div',
                        null,
                        el('h1', { class: 'hz-page-title', text: strings.page.title }),
                        el('p', { class: 'hz-page-subtitle', text: strings.page.subtitle }),
                    ),
                ),
                el('div', { class: 'hz-logs-controls-slot' }),
                listEl,
                renderStatusBar(),
            );
            container.replaceChildren(root);
        }
        root.querySelector('.hz-logs-controls-slot').replaceChildren(renderToolbar());
        syncSkeleton();
        renderList();
    }

    /* ---------------- 行为 ---------------- */

    function trimLines() {
        if (state.lines.length > state.maxLines) {
            state.lines = state.lines.slice(-state.maxLines);
        }
    }

    function pushLines(entries) {
        if (!entries.length) return;
        const known = new Set(state.lines.map((e) => e.id));
        const fresh = [];
        for (const entry of entries) {
            if (entry && entry.id !== undefined && known.has(entry.id)) continue;
            fresh.push(entry);
        }
        if (!fresh.length) return;
        state.lines = state.lines.concat(fresh);
        trimLines();
        if (state.status !== 'ready') state.status = 'ready';
        renderList();
    }

    function scheduleFlush() {
        if (flushTimer !== null) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            const batch = pendingLines;
            pendingLines = [];
            pushLines(batch);
        }, FLUSH_INTERVAL_MS);
    }

    function onStreamEvent(payload) {
        if (!payload || typeof payload !== 'object') return;
        // 控制帧（{"type":"ready"} 等）不属于日志条目。
        if ('type' in payload) return;
        pendingLines.push(payload);
        scheduleFlush();
    }

    function onStreamStatus(status) {
        state.streamStatus = status;
        const bar = root && root.querySelector('.hz-statusbar');
        if (bar) bar.replaceWith(renderStatusBar());
    }

    function openStream() {
        if (disposeStream) {
            disposeStream();
            disposeStream = null;
        }
        disposeStream = openSseChannel('/api/logs/stream', {
            onEvent: onStreamEvent,
            onStatus: onStreamStatus,
        });
    }

    async function loadLevel() {
        const body = await api.getJson('/api/logs/level');
        state.level = typeof body.level === 'string' ? body.level : null;
        state.levels = Array.isArray(body.levels) && body.levels.length ? body.levels.slice() : LOG_LEVELS.slice();
    }

    async function loadRecent() {
        const body = await api.getJson(`/api/logs?limit=${RECENT_LIMIT}`);
        if (!Array.isArray(body.list)) throw new Error(strings.list.loadFailed);
        return body.list;
    }

    /**
     * 拉取服务端状态并重建视图（refresh() 的实体）。
     * @param {{keepLines?: boolean}} [opts]
     */
    async function reload(opts) {
        const keepLines = !!(opts && opts.keepLines);
        if (!keepLines) state.status = 'loading';
        state.error = null;
        render();

        const results = await Promise.allSettled([loadRecent(), loadLevel()]);
        const [recent, level] = results;

        if (recent.status === 'rejected') {
            state.error = recent.reason && recent.reason.message ? recent.reason.message : strings.list.loadFailed;
            if (state.lines.length === 0) {
                state.status = 'error';
            } else {
                state.status = 'ready';
            }
        } else {
            state.lines = recent.value.slice(-state.maxLines);
            state.status = state.lines.length === 0 ? 'empty' : 'ready';
        }

        if (level.status === 'rejected') {
            // 级别读取失败不阻断日志流；保留已有级别，错误在状态栏可见。
            if (!state.level) state.level = null;
        }

        render();
    }

    async function requestLevel(level) {
        if (!level || level === state.level) return;
        // 服务端未做 TRACE 二次确认，这里按 reference 的交互约定补上。
        if (state.level !== 'trace' && level === 'trace') {
            const ok = await confirmDialog({
                title: strings.trace.dialogTitle,
                body: () => {
                    const { el } = atoms;
                    return el(
                        'div',
                        { class: 'hz-dialog-body' },
                        el('p', { text: strings.trace.dialogIntro }),
                        el(
                            'ul',
                            { class: 'hz-dialog-list' },
                            ...strings.trace.warnings.map((line) => el('li', { text: line })),
                        ),
                    );
                },
                confirmLabel: strings.trace.confirm,
                destructive: true,
                busyLabel: strings.level.switching,
            });
            if (!ok) return;
        }
        const previous = state.level;
        try {
            const body = await api.postJson('/api/logs/level', { level });
            state.level = typeof body.level === 'string' ? body.level : level;
            if (Array.isArray(body.levels) && body.levels.length) state.levels = body.levels.slice();
            render();
            notify(strings.level.updated, 'success');
        } catch (err) {
            state.level = previous;
            render();
            notify(err && err.message ? err.message : strings.level.updateFailed, 'error');
        }
    }

    async function exportView() {
        const lines = visibleLines();
        if (!lines.length) {
            notify(strings.export.viewFailed, 'error');
            return;
        }
        const text = lines.map((e) => e.line || renderFallbackLine(e)).join('\n') + '\n';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadBlob(text, `${strings.export.viewFilePrefix}-${stamp}.log`, 'text/plain;charset=utf-8');
    }

    async function exportTrace() {
        if (state.traceExporting) return;
        state.traceExporting = true;
        render();
        try {
            const res = await api.request('/api/logs/export/trace', { method: 'GET' });
            if (!res.ok) {
                let message = strings.export.traceFailed;
                try {
                    const body = await res.json();
                    message = body.message || body.error || message;
                } catch {
                    /* 保持默认文案 */
                }
                throw new Error(message);
            }
            const disposition = res.headers.get('Content-Disposition') || '';
            const matched = disposition.match(/filename="([^"]+)"/);
            const filename = matched ? matched[1] : strings.export.traceFallbackName;
            downloadBlob(await res.text(), filename, 'text/plain;charset=utf-8');
            notify(strings.export.traceDone, 'success');
        } catch (err) {
            notify(err && err.message ? err.message : strings.export.traceFailed, 'error');
        } finally {
            state.traceExporting = false;
            render();
        }
    }

    async function clearView() {
        const ok = await confirmDialog({
            title: strings.clear.dialogTitle,
            body: strings.clear.dialogBody,
            confirmLabel: strings.clear.confirm,
            destructive: true,
            busyLabel: strings.clear.busy,
        });
        if (!ok) return;
        try {
            state.lines = [];
            pendingLines = [];
            state.status = 'empty';
            render();
            notify(strings.clear.done, 'success');
        } catch (err) {
            notify(err && err.message ? err.message : strings.clear.failed, 'error');
        }
    }

    /* ---------------- 对话框 / 通知（原子层缺失时的最小实现） ---------------- */

    function confirmDialog(spec) {
        if (typeof atoms.ConfirmDialog === 'function') {
            return Promise.resolve(
                atoms.ConfirmDialog({
                    title: spec.title,
                    body: spec.body,
                    confirmLabel: spec.confirmLabel,
                    destructive: spec.destructive,
                }),
            );
        }
        if (typeof globalThis.confirm === 'function') {
            const text = typeof spec.body === 'string' ? spec.body : spec.title;
            return Promise.resolve(globalThis.confirm(`${spec.title}\n\n${text}`));
        }
        return Promise.resolve(false);
    }

    function notify(message, tone) {
        if (typeof atoms.notify === 'function') {
            atoms.notify({ message, tone });
            return;
        }
        if (typeof globalThis.console === 'object') {
            globalThis.console[tone === 'error' ? 'warn' : 'info'](`[logs] ${message}`);
        }
    }

    /* ---------------- 生命周期 ---------------- */

    return {
        id: 'logs',
        title: strings.page.title,

        /**
         * 挂载。
         * @param {HTMLElement} host 容器
         * @param {{atoms?:object}} [ctx]
         */
        mount(host, ctx) {
            if (!host) throw new Error('logs-plugin: mount() 需要一个容器元素');
            if (mounted) this.unmount();
            container = host;
            atoms = (ctx && ctx.atoms) || opts.atoms || resolveAtoms();
            if (!atoms || typeof atoms.el !== 'function') {
                throw new Error('logs-plugin: 原子层不可用（既未注入 ctx.atoms，也没有 globalThis.HaizakuraAtoms）');
            }
            mounted = true;
            state = createInitialState();
            root = null;
            render();
            void reload({ keepLines: false }).then(() => {
                if (mounted) openStream();
            });
        },

        /** 卸载：断开 SSE、清定时器、释放 DOM。 */
        unmount() {
            mounted = false;
            if (disposeStream) {
                disposeStream();
                disposeStream = null;
            }
            if (flushTimer !== null) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            pendingLines = [];
            for (const dispose of disposers) {
                try {
                    dispose();
                } catch {
                    /* 忽略清理异常 */
                }
            }
            disposers = [];
            if (container) container.replaceChildren();
            container = null;
            root = null;
            listEl = null;
        },

        /** 重新同步服务端状态（级别 + 最近日志），并确保 SSE 在线。 */
        refresh() {
            return reload({ keepLines: true }).then(() => {
                if (mounted && !disposeStream) openStream();
            });
        },

        /** 断言/调试用：暴露当前状态快照（只读语义，勿直接改写）。 */
        getState() {
            return {
                status: state.status,
                error: state.error,
                level: state.level,
                levels: state.levels.slice(),
                lines: state.lines.length,
                visible: visibleLines().length,
                streamStatus: state.streamStatus,
                autoScroll: state.autoScroll,
                wrap: state.wrap,
                maxLines: state.maxLines,
                preset: state.preset,
                visibleLevels: LOG_LEVELS.filter((l) => state.visibleLevels.has(l)),
                minWeight: LEVEL_WEIGHT,
            };
        },
    };
}

/* ------------------------------------------------------------------ *
 * definePlugin
 * ------------------------------------------------------------------ */

/**
 * 注册插件。宿主若提供 `globalThis.HaizakuraDefinePlugin` 则优先复用其实现
 * （由插件运行时统一登记、做 id 冲突检查与热替换）。
 * @template T
 * @param {T} definition
 * @returns {T}
 */
export function definePlugin(definition) {
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('definePlugin: 需要插件定义对象');
    }
    for (const key of ['id', 'title', 'mount', 'unmount', 'refresh']) {
        if (!(key in definition)) throw new TypeError(`definePlugin: 缺少 ${key}`);
    }
    const host = globalThis.HaizakuraDefinePlugin;
    if (typeof host === 'function') return host(definition);
    const registry = (globalThis.__HAIZAKURA_PLUGINS__ =
        globalThis.__HAIZAKURA_PLUGINS__ || []);
    const existing = registry.findIndex((p) => p && p.id === definition.id);
    if (existing >= 0) registry[existing] = definition;
    else registry.push(definition);
    return Object.freeze(definition);
}

export default definePlugin(createLogsPlugin());

/* ------------------------------------------------------------------ *
 * INLINE_ATOMS —— 应由 atoms.js 提供
 * 接口与共享原子层一致；atoms.js 到位后本块即被 resolveAtoms() 旁路。
 * ------------------------------------------------------------------ */

export const INLINE_ATOMS = (() => {
    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                if (value === null || value === undefined || value === false) continue;
                if (key === 'class') node.className = value;
                else if (key === 'text') node.textContent = value;
                else if (key === 'dataset') Object.assign(node.dataset, value);
                else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
                else if (key.startsWith('on') && typeof value === 'function') {
                    node.addEventListener(key.slice(2).toLowerCase(), value);
                } else if (key === 'value') node.value = value;
                else if (key === 'checked' || key === 'disabled' || key === 'active') {
                    if (value === true) node.setAttribute(key, '');
                } else node.setAttribute(key, String(value));
            }
        }
        append(node, children);
        return node;
    }

    function append(node, children) {
        for (const child of children) {
            if (child === null || child === undefined || child === false) continue;
            if (Array.isArray(child)) append(node, child);
            else if (child instanceof Node) node.appendChild(child);
            else node.appendChild(document.createTextNode(String(child)));
        }
    }

    function Button(spec) {
        const node = el('button', {
            type: 'button',
            class: ['hz-btn', spec.variant ? `hz-btn--${spec.variant}` : '', spec.active ? 'is-active' : '']
                .filter(Boolean)
                .join(' '),
            title: spec.title || null,
            disabled: spec.disabled === true,
            dataset: { role: spec.role || 'button' },
            onclick: spec.onClick || null,
        });
        if (spec.swatch) node.appendChild(el('span', { class: 'hz-swatch', style: { background: spec.swatch } }));
        node.appendChild(el('span', { text: spec.label }));
        if (spec.busy) node.setAttribute('data-busy', 'true');
        return node;
    }

    function IconButton(spec) {
        const node = el('button', {
            type: 'button',
            class: 'hz-iconbtn',
            title: spec.label,
            'aria-label': spec.label,
            onclick: spec.onClick || null,
        });
        node.appendChild(el('span', { class: `hz-icon hz-icon--${spec.icon || 'dot'}`, text: '⟳' }));
        return node;
    }

    function Input(spec) {
        const node = el('input', {
            type: spec.type || 'text',
            class: 'hz-input',
            value: spec.value === undefined ? '' : spec.value,
            placeholder: spec.placeholder || null,
            'aria-label': spec.ariaLabel || null,
            min: spec.min === undefined ? null : spec.min,
            max: spec.max === undefined ? null : spec.max,
        });
        if (typeof spec.onInput === 'function') node.addEventListener('input', (e) => spec.onInput(e.target.value, e));
        if (typeof spec.onKeyDown === 'function') node.addEventListener('keydown', spec.onKeyDown);
        return node;
    }

    function Select(spec) {
        const node = el('select', {
            class: 'hz-select',
            'aria-label': spec.ariaLabel || null,
        });
        for (const option of spec.options || []) {
            const opt = el('option', {
                value: option.value,
                text: option.hint ? `${option.label} — ${option.hint}` : option.label,
            });
            if (option.value === spec.value) opt.selected = true;
            node.appendChild(opt);
        }
        if (typeof spec.onChange === 'function') node.addEventListener('change', (e) => spec.onChange(e.target.value, e));
        return node;
    }

    function Badge(spec) {
        const node = el('button', {
            type: 'button',
            class: 'hz-badge',
            title: spec.title || null,
            dataset: { tone: spec.tone || 'neutral' },
            onclick: spec.onClick || null,
            disabled: typeof spec.onClick !== 'function',
        });
        if (spec.swatch) node.appendChild(el('span', { class: 'hz-swatch', style: { background: spec.swatch } }));
        node.appendChild(el('span', { text: spec.label }));
        return node;
    }

    function EmptyState(spec) {
        const node = el('div', { class: 'hz-empty', dataset: { tone: spec.tone || 'empty' } });
        node.appendChild(el('p', { class: 'hz-empty-title', text: spec.title }));
        if (spec.hint) node.appendChild(el('p', { class: 'hz-empty-hint', text: spec.hint }));
        if (spec.action) node.appendChild(Button(spec.action));
        return node;
    }

    return {
        __source: 'inline-fallback', // 应由 atoms.js 提供
        el,
        Button,
        IconButton,
        Input,
        Select,
        Badge,
        EmptyState,
    };
})();
