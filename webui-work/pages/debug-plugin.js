/**
 * debug-plugin.js — Haizakura WebUI「调试」页（原子化 / 插件化 / 服务端状态驱动）
 *
 * 设计约束
 *  1. 原子化：优先复用宿主原子层（`globalThis.HaizakuraAtoms`，由 atoms.js 提供）；
 *     缺失时退回本文件底部的 `INLINE_ATOMS`（已标注「应由 atoms.js 提供」），
 *     包括可搜索组合框与 JSON 结果查看器。
 *  2. 插件化：导出 `createDebugPlugin()` / `definePlugin` 产物。
 *  3. 状态驱动：loading / ready / error / empty 四态由真实响应推导。
 *  4. 零依赖：纯原生 DOM。
 *
 * 真实数据源（已对 snowluma-hz 实测）
 *  - GET  /api/qq-list           → { list: [ { uin, nickname } ] }
 *  - GET  /api/debug/actions     → { actions:[ ActionDoc ], categories:[ {category,count} ] }
 *      ActionDoc = { name, aliases[], summary, returns?, returnsSchema?, examples[],
 *                    readOnly, params[ {name,type,required,role?,schema?,desc?,default?} ],
 *                    invariants[], inputSchema, category, stream? }
 *      实测：222 个 action、12 个分类；其中 5 个带 `stream: true`。
 *  - POST /api/debug/invoke         { uin, action, params } → 动作结果对象
 *      成功 { status:"ok", retcode:0, data:... }
 *      业务失败 { status:"failed", retcode:1404, data:null, wording:"unknown action" }（HTTP 200）
 *      参数校验失败 { status:"failed", message:"无效的账号" }（HTTP 400）
 *  - POST /api/debug/invoke-stream  { uin, action, params } → SSE，每帧一个 `data: <json>`
 *      末帧判别：status === "ok" && data?.type === "response"
 *      进度帧：data.progress，或 data.transferred / data.total
 *  - POST /api/debug/upload?filename=<name>  原始 body → { status:"ok", path, size }
 *      失败 { status:"failed", message }（HTTP 400）；服务端 4 GiB 上限
 *
 * @module debug-plugin
 */

/* ------------------------------------------------------------------ *
 * STRINGS — 全部用户可见文案集中于此，后续由 i18n 层接管
 * ------------------------------------------------------------------ */
export const STRINGS = {
    page: {
        title: '调试工具',
        subtitle: '接口测试 · 实时观测 · API 参考',
        tabs: { tester: 'Action 测试台', catalog: 'API 浏览器' },
    },
    common: {
        loading: '加载中…',
        retry: '重试',
        refresh: '刷新',
        cancel: '取消',
        copy: '复制',
        copied: '已复制',
        clear: '清空',
        remove: '删除',
        confirm: '确认',
        search: '搜索',
        none: '无匹配项',
    },
    load: {
        failed: '加载开发者工具失败',
        accountsFailed: '加载账号列表失败',
        actionsFailed: '加载 action 列表失败',
    },
    account: {
        label: '账号',
        placeholder: '选择账号…',
        empty: '(无在线账号)',
        emptyHint: '无在线账号',
        avatarAlt: '账号头像',
    },
    action: {
        label: 'Action',
        placeholder: 'search action…',
        helper: '可直接在上方输入 action 名后回车使用',
        required: '请填写 action',
        none: '无匹配 action',
        readOnly: '只读·安全',
        sideEffect: '有副作用',
        streaming: '流式',
        aliases: '别名:',
        paramsTitle: '参数',
        returnsPrefix: '返回',
        noParams: '该接口无参数。',
        categoryAll: '全部',
    },
    params: {
        title: '参数',
        modes: { form: '表单', json: 'JSON' },
        jsonLabel: '参数 JSON',
        jsonPlaceholder: '{}',
        jsonHint: '粘贴完整 JSON 对象，保留原始字段。',
        invalidJson: 'params JSON 无效',
        mustBeObject: 'params 必须是对象',
        default: (value) => `默认 ${value}`,
        required: '必填',
        messageHint: '文本填写 JSON 字符串（如 "[{\\"type\\":\\"text\\",\\"data\\":{\\"text\\":\\"hi\\"}}]"）',
    },
    run: {
        execute: '执行',
        executing: '执行中…',
        stream: '流式执行',
        needAccount: '请选择账号',
        needAction: '请填写 action',
        invokeFailed: '调用失败',
        streamFailed: '流式调用失败',
        destructiveTitle: '确认执行破坏性操作',
        destructiveBody: (uin, action) => `即将以账号 ${uin} 执行 ${action}，该操作会真实生效且通常不可撤销。确认继续？`,
        destructiveConfirm: '确认执行',
        warning: '调用会真实生效（真发消息 / 真踢人等），请谨慎。',
        pickAccountFirst: '请先选择账号',
    },
    result: {
        title: '响应',
        idle: '执行后在此查看结果',
        frames: (n) => `${n} 帧`,
        frame: '帧',
        export: '导出 JSON',
        failed: '失败',
        success: '成功',
        elapsed: (ms) => `${ms} ms`,
        streamSummary: '流式',
    },
    history: {
        title: '调用历史',
        toggle: '历史',
        empty: '暂无历史',
        clear: '清空历史',
        use: '使用',
        at: '时间',
        duration: '耗时',
        state: '结果',
    },
    upload: {
        title: '上传',
        pick: '选择或拖入文件',
        modeUrl: 'URL',
        modeServer: '服务器路径',
        modeUpload: '上传',
        serverHint: '使用服务器上的文件路径',
        uploading: '上传中…',
        failed: '上传失败',
        uploaded: '已上传:',
        cancel: '取消上传',
    },
    catalog: {
        searchPlaceholder: '搜索 action 名 / 摘要 / 别名…',
        empty: '无匹配 action',
        params: '参数',
        name: '名称',
        type: '类型',
        required: '必填',
        desc: '说明',
        try: '试一下',
        yes: '是',
        no: '否',
        count: (shown, total) => `${shown}/${total}`,
    },
    a11y: {
        resultRegion: '调用结果',
        historyRegion: '调用历史',
        destructive: '破坏性操作',
    },
};

/* ------------------------------------------------------------------ *
 * 常量（对齐 reference/debug-page 的取值）
 * ------------------------------------------------------------------ */

/** 破坏性动作识别，逐字对齐 reference。 */
export const DESTRUCTIVE_ACTION_PATTERN =
    /(kick|ban|mute|recall|withdraw|delete|del_|dismiss|disband|leave|quit|remove|revoke)/i;

/** 流式帧保留上限，对齐 reference（At = 2000）。 */
const STREAM_FRAME_CAP = 2000;

const HISTORY_KEY = 'snowluma.debug.history.v1';
const HISTORY_CAP = 200; // 对齐 reference（wt = 200）

const TOKEN_STORAGE_KEY = 'snowluma_token';
const TOKEN_HEADER = 'X-SnowLuma-Token';

const NUMERIC_TYPE_PATTERN = /int|uint|number|messageId/i;

/* ------------------------------------------------------------------ *
 * 原子层解析 —— 优先 atoms.js，缺失时退回 INLINE_ATOMS
 * ------------------------------------------------------------------ */

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

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeStringify(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

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

async function copyText(text, atoms) {
    if (atoms && typeof atoms.copyToClipboard === 'function') return atoms.copyToClipboard(text);
    if (globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch {
        ok = false;
    }
    ta.remove();
    return ok;
}

/* ------------------------------------------------------------------ *
 * API 客户端（最小实现；宿主注入 globalThis.HaizakuraApi 时优先复用）
 * ------------------------------------------------------------------ */

function createApi() {
    const shared = globalThis.HaizakuraApi;
    if (shared && typeof shared.getJson === 'function' && typeof shared.postJson === 'function') {
        return shared;
    }

    function withToken(extra) {
        const h = Object.assign({}, extra || {});
        const token = readToken();
        if (token) h[TOKEN_HEADER] = token;
        return h;
    }

    function request(path, init) {
        const opts = Object.assign({ cache: 'no-store' }, init || {});
        opts.headers = withToken(opts.headers);
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
        if (!isPlainObject(body)) {
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

    return { request, getJson, postJson };
}

/* ------------------------------------------------------------------ *
 * SSE 读取（invoke-stream 专用；一次性消费，无重连）
 * ------------------------------------------------------------------ */

function createSseParser() {
    let buffer = '';
    let dataLines = [];
    let pendingCr = false;
    return function* feed(chunk) {
        for (const ch of chunk) {
            if (pendingCr && ch === '\n') {
                pendingCr = false;
                continue;
            }
            if (ch !== '\r' && ch !== '\n') {
                if (pendingCr) pendingCr = false;
                buffer += ch;
                continue;
            }
            pendingCr = ch === '\r';
            if (buffer === '') {
                const payload = dataLines.join('\n');
                dataLines = [];
                if (payload) yield payload;
            } else if (buffer.startsWith('data:')) {
                const rest = buffer.slice(5);
                dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest);
            }
            buffer = '';
        }
    };
}

/**
 * 消费一条 SSE POST。
 * @param {string} url
 * @param {object} payload
 * @param {(frame:object)=>void} onFrame
 * @param {AbortSignal} signal
 */
async function postSse(url, payload, onFrame, signal) {
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    const token = readToken();
    if (token) headers[TOKEN_HEADER] = token;

    const res = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers,
        body: JSON.stringify(payload),
        signal,
    });
    if (res.status === 401) throw new Error('未授权');
    if (!res.ok || !res.body) {
        let message = res.statusText || '流式调用失败';
        try {
            const body = await res.json();
            message = body.message || body.error || message;
        } catch {
            /* 保持默认文案 */
        }
        throw new Error(message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parse = createSseParser();
    for (;;) {
        const { done, value } = await reader.read();
        const text = decoder.decode(value || new Uint8Array(0), { stream: !done });
        for (const raw of parse(text)) {
            let frame;
            try {
                frame = JSON.parse(raw);
            } catch {
                continue;
            }
            onFrame(frame);
        }
        if (done) break;
    }
}

/* ------------------------------------------------------------------ *
 * 参数编解码 —— 逐条对齐 reference 的 xt() / St()
 * ------------------------------------------------------------------ */

/**
 * 把表单里的原始字符串按 param.type 还原成服务端期望的类型。
 * 空字符串 → undefined（即不发送该参数），与 reference 一致。
 * @param {{name:string,type:string}} param
 * @param {string} raw
 */
export function coerceParam(param, raw) {
    if (raw === '' || raw === undefined || raw === null) return undefined;

    if (NUMERIC_TYPE_PATTERN.test(String(param.type))) {
        const n = Number(raw);
        return Number.isFinite(n) ? n : raw;
    }
    if (param.type === 'bool' || param.type === 'boolean') {
        return raw === 'true' || raw === '1' || raw === true;
    }
    if (param.type === 'object' || param.type === 'string | object[]') {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error(`${param.name} 的 JSON 格式无效`);
        }
        if (param.type === 'object' && !isPlainObject(parsed)) throw new Error(`${param.name} 必须是 JSON 对象`);
        if (param.type === 'string | object[]' && typeof parsed !== 'string' && !(Array.isArray(parsed) && parsed.every(isPlainObject))) {
            throw new Error(`${param.name} 必须是 JSON 字符串或对象数组`);
        }
        return parsed;
    }
    if (param.type === 'message') {
        const text = String(raw).trim();
        if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
            try {
                return JSON.parse(text);
            } catch {
                /* 落到纯文本 */
            }
        }
        return raw;
    }
    return raw;
}

/**
 * 收集表单参数。
 * @param {Array<object>} params ActionDoc.params
 * @param {Record<string,string>} values
 * @returns {Record<string,unknown>}
 */
export function collectFormParams(params, values) {
    const out = {};
    for (const param of params || []) {
        const raw = values && param.name in values ? values[param.name] : '';
        const coerced = coerceParam(param, raw);
        if (coerced !== undefined) out[param.name] = coerced;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * 历史记录（localStorage，对齐 reference 的 key 与容量）
 * ------------------------------------------------------------------ */

let historySeq = 0;

function loadHistory() {
    try {
        const raw = globalThis.localStorage ? localStorage.getItem(HISTORY_KEY) : null;
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveHistory(entry, current) {
    const record = Object.assign({}, entry, {
        id: `h-${Number(entry.at).toString(36)}-${(historySeq += 1).toString(36)}`,
    });
    const next = [record].concat(current || []).slice(0, HISTORY_CAP);
    try {
        if (globalThis.localStorage) localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
        /* 配额满：仅在内存里保留 */
    }
    return next;
}

function clearStoredHistory() {
    try {
        if (globalThis.localStorage) localStorage.removeItem(HISTORY_KEY);
    } catch {
        /* 忽略 */
    }
}

/* ------------------------------------------------------------------ *
 * 插件
 * ------------------------------------------------------------------ */

/**
 * @param {object} [options]
 * @param {object} [options.api]
 * @param {object} [options.atoms]
 * @param {object} [options.strings]
 */
export function createDebugPlugin(options) {
    const opts = options || {};
    const api = opts.api || createApi();
    const strings = opts.strings || STRINGS;

    let container = null;
    let atoms = null;
    let ui = null;
    let mounted = false;
    let state = null;
    let streamController = null;
    let uploadController = null;

    function createState() {
        return {
            status: 'loading', // loading | ready | error | empty
            error: null,
            tab: 'tester',
            accounts: [],
            actions: [],
            categories: [],
            accountsLoading: true,
            accountsError: null,
            actionsLoading: true,
            actionsError: null,
            uin: '',
            action: '',
            paramMode: 'form',
            formValues: {},
            jsonText: '{}',
            running: false,
            result: null,
            callError: null,
            frames: [],
            history: [],
            catalogQuery: '',
            catalogCategory: '',
            historyOpen: false,
            uploadProgress: null,
            uploadName: null,
            uploadError: null,
        };
    }

    /* ---------------- 派生 ---------------- */

    function currentDoc() {
        return state.actions.find((doc) => doc.name === state.action) || null;
    }

    function isStreaming() {
        const doc = currentDoc();
        return !!(doc && doc.stream);
    }

    function isDestructive() {
        return DESTRUCTIVE_ACTION_PATTERN.test(state.action || '');
    }

    function effectiveParamMode() {
        return state.paramMode === 'json' || !currentDoc() ? 'json' : 'form';
    }

    function filteredCatalog() {
        const needle = state.catalogQuery.trim().toLowerCase();
        return state.actions.filter((doc) => {
            if (state.catalogCategory && doc.category !== state.catalogCategory) return false;
            if (!needle) return true;
            const haystack = [doc.name, doc.summary, (doc.aliases || []).join(' '), doc.category]
                .join('\u0000')
                .toLowerCase();
            return haystack.includes(needle);
        });
    }

    /* ---------------- 参数校验 ---------------- */

    function buildParams() {
        if (effectiveParamMode() === 'json') {
            let parsed;
            try {
                parsed = JSON.parse(state.jsonText || '{}');
            } catch {
                return { error: strings.params.invalidJson };
            }
            if (!isPlainObject(parsed)) return { error: strings.params.mustBeObject };
            return { params: parsed };
        }
        const doc = currentDoc();
        try {
            return { params: collectFormParams(doc ? doc.params : [], state.formValues) };
        } catch (err) {
            return { error: err && err.message ? err.message : String(err) };
        }
    }

    /* ---------------- 调用 ---------------- */

    async function run() {
        if (!state.uin) {
            state.callError = strings.run.needAccount;
            syncTester();
            return;
        }
        if (!state.action.trim()) {
            state.callError = strings.run.needAction;
            syncTester();
            return;
        }
        const built = buildParams();
        if (built.error) {
            state.callError = built.error;
            syncTester();
            return;
        }
        if (isDestructive()) {
            const ok = await confirmDialog({
                title: strings.run.destructiveTitle,
                body: strings.run.destructiveBody(state.uin, state.action),
                confirmLabel: strings.run.destructiveConfirm,
                destructive: true,
            });
            if (!ok) return;
        }
        await invoke(built.params);
    }

    async function invoke(params) {
        const startedAt = Date.now();
        const uin = state.uin;
        const action = state.action.trim();
        const streaming = isStreaming();

        state.running = true;
        state.callError = null;
        state.result = null;
        state.frames = [];
        syncTester();

        let ok = false;
        try {
            if (streaming) {
                streamController = new AbortController();
                let last = null;
                await postSse(
                    '/api/debug/invoke-stream',
                    { uin, action, params },
                    (frame) => {
                        last = frame;
                        state.frames =
                            state.frames.length >= STREAM_FRAME_CAP
                                ? state.frames.slice(-(STREAM_FRAME_CAP - 1)).concat([frame])
                                : state.frames.concat([frame]);
                        syncResult();
                    },
                    streamController.signal,
                );
                state.result = last;
                ok = !!last && last.status === 'ok' && last.data && last.data.type === 'response';
            } else {
                const result = await api.postJson('/api/debug/invoke', { uin, action, params });
                state.result = result;
                ok = result.status === 'ok';
            }
        } catch (err) {
            const aborted = err && (err.name === 'AbortError' || (streamController && streamController.signal.aborted));
            if (!aborted) state.callError = err && err.message ? err.message : streaming ? strings.run.streamFailed : strings.run.invokeFailed;
        } finally {
            streamController = null;
            state.running = false;
            state.history = saveHistory(
                { at: startedAt, uin, action, params, ok, ms: Date.now() - startedAt, stream: streaming },
                state.history,
            );
            syncTester();
            syncHistory();
        }
    }

    function abortRun() {
        if (streamController) streamController.abort();
    }

    /* ---------------- 上传 ---------------- */

    function uploadFile(file) {
        if (!file) return;
        const filename = file.name;
        state.uploadName = filename;
        state.uploadProgress = 0;
        state.uploadError = null;
        syncUpload();

        const token = readToken();
        const xhr = new XMLHttpRequest();
        uploadController = xhr;
        const abort = () => xhr.abort();
        const onAbortSignal = () => xhr.abort();
        const ac = new AbortController();

        xhr.open('POST', `/api/debug/upload?filename=${encodeURIComponent(filename)}`);
        if (token) xhr.setRequestHeader(TOKEN_HEADER, token);
        xhr.responseType = 'json';
        xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable && ev.total > 0) {
                state.uploadProgress = ev.loaded / ev.total;
                syncUpload();
            }
        };
        xhr.onload = () => {
            const body = xhr.response;
            if (xhr.status === 401) {
                state.uploadError = '未授权';
            } else if (xhr.status >= 200 && xhr.status < 300 && body && typeof body.path === 'string' && body.path) {
                state.uploadProgress = 1;
                state.uploadError = null;
                setParamValue('file', body.path);
                notify(`${strings.upload.uploaded} ${body.path}`, 'success');
            } else {
                state.uploadError = (body && body.message) || strings.upload.failed;
            }
            state.uploadProgress = null;
            uploadController = null;
            ac.abort();
            syncUpload();
        };
        xhr.onerror = () => {
            state.uploadError = strings.upload.failed;
            state.uploadProgress = null;
            uploadController = null;
            syncUpload();
        };
        xhr.onabort = () => {
            state.uploadProgress = null;
            uploadController = null;
            syncUpload();
        };
        ac.signal.addEventListener('abort', onAbortSignal, { once: true });
        void abort;
        xhr.send(file);
    }

    function setParamValue(name, value) {
        state.formValues = Object.assign({}, state.formValues, { [name]: value });
        if (effectiveParamMode() === 'form') syncParamFields();
    }

    /* ---------------- 渲染：骨架 ---------------- */

    function mountDom(host) {
        const { el } = atoms;

        const tabBar = el('div', { class: 'hz-tabs', role: 'tablist' });
        const tabButtons = {};
        for (const key of ['tester', 'catalog']) {
            const btn = el('button', {
                type: 'button',
                class: 'hz-tab',
                role: 'tab',
                text: strings.page.tabs[key],
                onclick: () => {
                    state.tab = key;
                    syncShell();
                },
            });
            tabButtons[key] = btn;
            tabBar.appendChild(btn);
        }

        const loadingBar = el('div', { class: 'hz-skeleton hz-skeleton--bar' });
        const alertSlot = el('div', { class: 'hz-alert-slot' });
        const testerSlot = el('div', { class: 'hz-panel hz-panel--tester' });
        const catalogSlot = el('div', { class: 'hz-panel hz-panel--catalog' });

        const root = el(
            'div',
            { class: 'hz-page hz-debug', dataset: { status: state.status } },
            el(
                'header',
                { class: 'hz-page-header' },
                el(
                    'div',
                    null,
                    el('h1', { class: 'hz-page-title', text: strings.page.title }),
                    el('p', { class: 'hz-page-subtitle', text: strings.page.subtitle }),
                ),
                tabBar,
            ),
            loadingBar,
            alertSlot,
            testerSlot,
            catalogSlot,
        );

        host.replaceChildren(root);
        ui = {
            root,
            tabButtons,
            loadingBar,
            alertSlot,
            testerSlot,
            catalogSlot,
            tester: null,
            catalog: null,
        };
        buildTester();
    }

    /* ---------------- 渲染：测试台 ---------------- */

    function buildTester() {
        const { el, Button, ComboBox, Section } = atoms;
        const slot = ui.testerSlot;

        const account = ComboBox({
            value: '',
            options: accountOptions(),
            placeholder: strings.account.placeholder,
            emptyHint: strings.account.emptyHint,
            ariaLabel: strings.account.label,
            onInput: (value) => {
                state.uin = value;
            },
            onPick: (value) => {
                state.uin = value;
                syncActionMeta();
            },
        });

        const actionCombo = ComboBox({
            value: '',
            options: actionOptions(),
            placeholder: strings.action.placeholder,
            emptyHint: strings.action.none,
            ariaLabel: strings.action.label,
            allowRaw: true,
            onInput: (value) => {
                state.action = value;
            },
            onPick: (value) => {
                state.action = value;
                state.formValues = {};
                state.result = null;
                state.frames = [];
                state.callError = null;
                buildParamFields();
                syncActionMeta();
            },
        });

        const metaSlot = el('div', { class: 'hz-action-meta' });
        const warning = el('div', { class: 'hz-banner hz-banner--warn', role: 'alert', text: strings.run.warning });

        const paramModeButtons = {};
        for (const mode of ['form', 'json']) {
            paramModeButtons[mode] = Button({
                label: strings.params.modes[mode],
                active: false,
                onClick: () => {
                    state.paramMode = mode;
                    buildParamFields();
                    syncTester();
                },
            });
        }

        const paramFields = el('div', { class: 'hz-param-fields' });
        const jsonEditor = el('textarea', {
            class: 'hz-textarea hz-textarea--json',
            spellcheck: 'false',
            'aria-label': strings.params.jsonLabel,
            placeholder: strings.params.jsonPlaceholder,
        });
        jsonEditor.addEventListener('input', () => {
            state.jsonText = jsonEditor.value;
        });

        const runBtn = Button({ label: strings.run.execute, variant: 'primary', onClick: () => void run() });
        const abortBtn = Button({ label: strings.common.cancel, variant: 'danger', onClick: () => abortRun() });
        const callErrorSlot = el('div', { class: 'hz-call-error' });

        const resultSlot = el('div', { class: 'hz-result' });
        const framesSlot = el('div', { class: 'hz-frames' });

        const historyList = el('div', { class: 'hz-history-list', role: 'list', 'aria-label': strings.a11y.historyRegion });
        const historyClearBtn = Button({
            label: strings.history.clear,
            variant: 'ghost',
            onClick: () => {
                state.history = [];
                clearStoredHistory();
                syncHistory();
            },
        });
        const historyPanel = el(
            'div',
            { class: 'hz-history', hidden: true },
            el(
                'div',
                { class: 'hz-history-head' },
                el('span', { class: 'hz-label', text: strings.history.title }),
                historyClearBtn,
            ),
            historyList,
        );

        const tester = el(
            'div',
            { class: 'hz-tester' },
            Section({
                title: strings.page.tabs.tester,
                extra: warning,
                body: el(
                    'div',
                    { class: 'hz-tester-form' },
                    el(
                        'div',
                        { class: 'hz-grid-2' },
                        labeled(el, strings.account.label, account.node),
                        labeled(el, strings.action.label, actionCombo.node),
                    ),
                    metaSlot,
                    el(
                        'div',
                        { class: 'hz-param-head' },
                        el('span', { class: 'hz-label', text: strings.params.title }),
                        el('div', { class: 'hz-segmented' }, paramModeButtons.form, paramModeButtons.json),
                    ),
                    paramFields,
                    jsonEditor,
                    callErrorSlot,
                    el('div', { class: 'hz-run-row' }, runBtn, abortBtn, historyClearBtn ? null : null),
                ),
            }),
            Section({ title: strings.result.title, body: el('div', null, resultSlot, framesSlot) }),
            historyPanel,
        );

        slot.replaceChildren(tester);
        ui.tester = {
            account,
            actionCombo,
            metaSlot,
            paramModeButtons,
            paramFields,
            jsonEditor,
            runBtn,
            abortBtn,
            callErrorSlot,
            resultSlot,
            framesSlot,
            historyList,
            historyPanel,
            warning,
        };

        buildParamFields();
        syncHistory();
    }

    function labeled(el, label, control) {
        return el(
            'label',
            { class: 'hz-field' },
            el('span', { class: 'hz-field-label', text: label }),
            control,
        );
    }

    function accountOptions() {
        if (!state.accounts.length) return [];
        return state.accounts.map((acc) => ({
            value: String(acc.uin),
            label: acc.nickname || String(acc.uin),
            sub: acc.nickname ? String(acc.uin) : undefined,
        }));
    }

    function actionOptions() {
        return state.actions.map((doc) => ({ value: doc.name, label: doc.name, sub: doc.summary }));
    }

    function buildParamFields() {
        if (!ui || !ui.tester) return;
        const { el } = atoms;
        const wrap = ui.tester.paramFields;
        const mode = effectiveParamMode();

        ui.tester.jsonEditor.hidden = mode !== 'json';
        wrap.hidden = mode !== 'form';
        if (mode !== 'form') return;

        const doc = currentDoc();
        if (!doc) {
            wrap.replaceChildren(el('p', { class: 'hz-hint', text: strings.catalog.empty }));
            return;
        }
        const params = doc.params || [];
        if (!params.length) {
            wrap.replaceChildren(el('p', { class: 'hz-hint', text: strings.action.noParams }));
            return;
        }
        wrap.replaceChildren(...params.map((param) => buildParamField(doc, param)));
    }

    function buildParamField(doc, param) {
        const { el, Input } = atoms;
        const role = param.role;
        const current = state.formValues[param.name] === undefined ? '' : state.formValues[param.name];
        const placeholder = paramPlaceholder(param);

        const onValue = (value) => {
            state.formValues = Object.assign({}, state.formValues, { [param.name]: value });
        };

        let control;
        const enumValues = param.schema && Array.isArray(param.schema.enum) ? param.schema.enum : null;
        if (enumValues) {
            const select = el('select', { class: 'hz-select' });
            select.appendChild(el('option', { value: '', text: placeholder }));
            for (const v of enumValues) select.appendChild(el('option', { value: String(v), text: String(v) }));
            select.value = current;
            select.addEventListener('change', () => onValue(select.value));
            control = select;
        } else if (param.type === 'bool' || param.type === 'boolean') {
            const select = el('select', { class: 'hz-select' });
            if (!param.required) select.appendChild(el('option', { value: '', text: placeholder }));
            select.appendChild(el('option', { value: 'true', text: 'true' }));
            select.appendChild(el('option', { value: 'false', text: 'false' }));
            select.value = current;
            select.addEventListener('change', () => onValue(select.value));
            control = select;
        } else if (param.type === 'object' || param.type === 'string | object[]') {
            const area = el('textarea', {
                class: 'hz-textarea hz-textarea--param',
                placeholder,
                spellcheck: 'false',
            });
            area.value = current;
            area.addEventListener('input', () => onValue(area.value));
            control = area;
        } else if (param.type === 'message') {
            const area = el('textarea', {
                class: 'hz-textarea hz-textarea--param',
                placeholder,
                spellcheck: 'false',
            });
            area.value = current;
            area.addEventListener('input', () => onValue(area.value));
            control = el(
                'div',
                { class: 'hz-field-control' },
                area,
                el('span', { class: 'hz-hint', text: strings.params.messageHint }),
            );
        } else {
            const input = Input({
                value: current,
                placeholder,
                type: NUMERIC_TYPE_PATTERN.test(String(param.type)) ? 'number' : 'text',
                onInput: onValue,
            });
            control = input;
        }

        const fileRole = role === 'image' || role === 'file' || role === 'record' || role === 'video';
        const row = el(
            'div',
            { class: 'hz-field hz-field--param' },
            el(
                'span',
                { class: 'hz-field-label' },
                el('code', { class: 'hz-mono', text: param.name }),
                param.required ? el('span', { class: 'hz-req', text: '*' }) : null,
                el('span', { class: 'hz-field-type', text: param.type }),
            ),
            control,
            param.desc ? el('span', { class: 'hz-hint', text: param.desc }) : null,
            fileRole ? buildUploadControl(param) : null,
        );
        return row;
    }

    function paramPlaceholder(param) {
        if (param.default !== undefined) return strings.params.default(JSON.stringify(param.default));
        if (param.required) return strings.params.required;
        if (param.desc) return param.desc;
        return param.type || '';
    }

    function buildUploadControl(param) {
        const { el, Button } = atoms;
        const fileInput = el('input', { type: 'file', class: 'sr-only' });
        const pick = Button({
            label: strings.upload.pick,
            variant: 'outline',
            onClick: () => fileInput.click(),
        });
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (file) uploadFile(file);
        });
        const status = el('span', { class: 'hz-hint' });
        const wrap = el(
            'div',
            { class: 'hz-upload', dataset: { role: param.name } },
            fileInput,
            pick,
            status,
            el('span', { class: 'hz-hint', text: strings.upload.serverHint }),
        );
        // 拖放
        wrap.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            wrap.setAttribute('data-drop', 'true');
        });
        wrap.addEventListener('dragleave', () => wrap.removeAttribute('data-drop'));
        wrap.addEventListener('drop', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            wrap.removeAttribute('data-drop');
            const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
            if (file) uploadFile(file);
        });
        return wrap;
    }

    function syncParamFields() {
        if (!ui || !ui.tester) return;
        const mode = effectiveParamMode();
        ui.tester.jsonEditor.hidden = mode !== 'json';
        ui.tester.paramFields.hidden = mode !== 'form';
        if (mode === 'json') {
            if (ui.tester.jsonEditor.value !== state.jsonText) ui.tester.jsonEditor.value = state.jsonText;
            return;
        }
        // 表单：把 state 的值回写到同名的 textarea/input（避免重建导致失焦）
        for (const node of ui.tester.paramFields.querySelectorAll('[data-param]')) {
            const name = node.getAttribute('data-param');
            const value = state.formValues[name] === undefined ? '' : state.formValues[name];
            if (node.value !== value) node.value = value;
        }
    }

    function syncActionMeta() {
        if (!ui || !ui.tester) return;
        const { el, Badge } = atoms;
        const doc = currentDoc();
        ui.tester.metaSlot.replaceChildren();
        if (!doc) return;
        if (doc.readOnly) {
            ui.tester.metaSlot.appendChild(Badge({ label: strings.action.readOnly, tone: 'safe' }));
        } else {
            ui.tester.metaSlot.appendChild(Badge({ label: strings.action.sideEffect, tone: 'warn', title: strings.a11y.destructive }));
        }
        if (doc.stream) ui.tester.metaSlot.appendChild(Badge({ label: strings.action.streaming, tone: 'info' }));
        if (doc.category) ui.tester.metaSlot.appendChild(Badge({ label: doc.category, tone: 'neutral' }));
        if (doc.summary) ui.tester.metaSlot.appendChild(el('span', { class: 'hz-hint', text: doc.summary }));
        if (doc.returns) {
            ui.tester.metaSlot.appendChild(
                el('span', { class: 'hz-hint', text: `${strings.action.returnsPrefix} ${doc.returns}` }),
            );
        }
        if (doc.aliases && doc.aliases.length) {
            ui.tester.metaSlot.appendChild(
                el('span', {
                    class: 'hz-hint',
                    text: `${strings.action.aliases} ${doc.aliases.join(', ')}`,
                }),
            );
        }
    }

    function syncResult() {
        if (!ui || !ui.tester) return;
        const { el, CodeBlock, Button, EmptyState } = atoms;
        const slot = ui.tester.resultSlot;
        const framesSlot = ui.tester.framesSlot;

        if (state.running && !state.result && state.frames.length === 0) {
            slot.replaceChildren(el('p', { class: 'hz-hint', text: strings.run.executing }));
        } else if (state.result) {
            slot.replaceChildren(resultView(el, CodeBlock, Button, state.result));
        } else if (state.callError) {
            slot.replaceChildren(el('div', { class: 'hz-banner hz-banner--error', role: 'alert', text: state.callError }));
        } else {
            slot.replaceChildren(EmptyState({ tone: 'idle', title: strings.result.idle }));
        }

        if (state.frames.length) {
            framesSlot.replaceChildren(
                el('div', { class: 'hz-label', text: strings.result.frames(state.frames.length) }),
                ...state.frames.map((frame) =>
                    el(
                        'div',
                        { class: 'hz-frame' },
                        el('pre', { class: 'hz-code', text: safeStringify(frame) }),
                    ),
                ),
            );
        } else {
            framesSlot.replaceChildren();
        }
    }

    function resultView(el, CodeBlock, Button, result) {
        const frame = result && typeof result === 'object' ? result : {};
        const isFailure = frame.status === 'failed' || (frame.data && frame.data.type === 'error') || 'error' in frame;
        const payload = isFailure ? frame : frame.data === undefined ? frame : frame.data;
        const head = el(
            'div',
            { class: 'hz-result-head' },
            el('span', {
                class: 'hz-badge',
                dataset: { tone: isFailure ? 'error' : 'success' },
                text: isFailure ? strings.result.failed : strings.result.success,
            }),
            frame.retcode === undefined ? null : el('code', { class: 'hz-mono', text: `retcode ${frame.retcode}` }),
            frame.wording ? el('span', { class: 'hz-hint', text: frame.wording }) : null,
            frame.message ? el('span', { class: 'hz-hint', text: frame.message }) : null,
        );
        const actions = el(
            'div',
            { class: 'hz-result-actions' },
            Button({
                label: strings.common.copy,
                variant: 'ghost',
                onClick: () => void copyText(safeStringify(frame), atoms).then((ok) => ok && notify(strings.common.copied, 'success')),
            }),
            Button({
                label: strings.result.export,
                variant: 'ghost',
                onClick: () =>
                    downloadBlob(safeStringify(frame), `debug-result-${Date.now()}.json`, 'application/json;charset=utf-8'),
            }),
        );
        const body =
            typeof CodeBlock === 'function'
                ? CodeBlock({ code: safeStringify(payload) })
                : el('pre', { class: 'hz-code', text: safeStringify(payload) });
        return el('div', { class: 'hz-result-body', role: 'region', 'aria-label': strings.a11y.resultRegion }, head, actions, body);
    }

    function syncHistory() {
        if (!ui || !ui.tester) return;
        const { el, Button } = atoms;
        const list = ui.tester.historyList;
        list.replaceChildren();
        if (!state.history.length) {
            list.appendChild(el('p', { class: 'hz-hint', text: strings.history.empty }));
            return;
        }
        state.history.forEach((entry) => {
            const row = el(
                'div',
                { class: 'hz-history-row', role: 'listitem' },
                el('span', { class: 'hz-badge', dataset: { tone: entry.ok ? 'success' : 'error' }, text: entry.ok ? 'OK' : 'FAIL' }),
                el('code', { class: 'hz-mono', text: entry.action }),
                el('span', { class: 'hz-hint', text: `@${entry.uin}` }),
                entry.stream ? el('span', { class: 'hz-badge', dataset: { tone: 'info' }, text: strings.action.streaming }) : null,
                el('span', { class: 'hz-hint', text: strings.result.elapsed(entry.ms) }),
                el('span', { class: 'hz-hint', text: new Date(entry.at).toLocaleTimeString() }),
                Button({
                    label: strings.history.use,
                    variant: 'ghost',
                    onClick: () => applyHistory(entry),
                }),
            );
            list.appendChild(row);
        });
    }

    function applyHistory(entry) {
        state.uin = entry.uin;
        state.action = entry.action;
        state.paramMode = 'json';
        state.jsonText = safeStringify(entry.params || {});
        state.result = null;
        state.frames = [];
        state.callError = null;
        if (ui.tester.account) ui.tester.account.setValue(entry.uin);
        if (ui.tester.actionCombo) ui.tester.actionCombo.setValue(entry.action);
        buildParamFields();
        syncActionMeta();
        syncTester();
    }

    function syncUpload() {
        if (!ui || !ui.tester) return;
        for (const wrap of ui.tester.paramFields.querySelectorAll('.hz-upload')) {
            const status = wrap.querySelector('.hz-hint:last-of-type');
            const target = wrap.querySelector('.hz-hint');
            const node = target || status;
            if (!node) continue;
            if (state.uploadError) node.textContent = state.uploadError;
            else if (state.uploadProgress !== null) {
                node.textContent = `${strings.upload.uploading} ${Math.round(state.uploadProgress * 100)}%`;
            } else if (state.uploadName) node.textContent = `${strings.upload.uploaded} ${state.uploadName}`;
        }
    }

    function syncTester() {
        if (!ui || !ui.tester) return;
        const t = ui.tester;
        const mode = effectiveParamMode();

        t.paramModeButtons.form.setAttribute('data-active', String(mode === 'form'));
        t.paramModeButtons.json.setAttribute('data-active', String(mode === 'json'));
        t.jsonEditor.hidden = mode !== 'json';
        t.paramFields.hidden = mode !== 'form';

        t.runBtn.textContent = state.running ? strings.run.executing : isStreaming() ? strings.run.stream : strings.run.execute;
        t.runBtn.disabled = state.running;
        t.abortBtn.hidden = !state.running || !isStreaming();

        t.callErrorSlot.replaceChildren();
        if (state.callError) {
            t.callErrorSlot.appendChild(
                el2('div', { class: 'hz-banner hz-banner--error', role: 'alert', text: state.callError }),
            );
        }

        t.warning.hidden = false;
        t.historyPanel.hidden = !state.historyOpen;
        t.account.setDisabled(state.accountsLoading || state.accounts.length === 0);
        t.account.setLoading(state.accountsLoading);
        t.account.setOptions(accountOptions());
        t.actionCombo.setLoading(state.actionsLoading);
        t.actionCombo.setOptions(actionOptions());

        syncParamFields();
        syncActionMeta();
        syncResult();
    }

    function el2(tag, attrs, ...children) {
        return atoms.el(tag, attrs, ...children);
    }

    /* ---------------- 渲染：API 浏览器 ---------------- */

    function buildCatalog() {
        const { el, Input, Button } = atoms;
        const search = Input({
            value: '',
            placeholder: strings.catalog.searchPlaceholder,
            ariaLabel: strings.catalog.searchPlaceholder,
            onInput: (value) => {
                state.catalogQuery = value;
                syncCatalogList();
            },
        });
        const chips = el('div', { class: 'hz-chips' });
        const list = el('div', { class: 'hz-catalog-list' });
        const count = el('span', { class: 'hz-hint' });

        const allBtn = Button({
            label: strings.action.categoryAll,
            active: true,
            onClick: () => {
                state.catalogCategory = '';
                syncCatalogList();
            },
        });

        const catalog = el(
            'div',
            { class: 'hz-catalog' },
            el('div', { class: 'hz-toolbar' }, search, count),
            el('div', { class: 'hz-toolbar hz-chips' }, allBtn, chips),
            list,
        );

        ui.catalogSlot.replaceChildren(catalog);
        ui.catalog = { search, chips, list, count, allBtn };

        for (const item of state.categories) {
            chips.appendChild(
                Button({
                    label: `${item.category} ${item.count}`,
                    active: false,
                    onClick: () => {
                        state.catalogCategory = state.catalogCategory === item.category ? '' : item.category;
                        syncCatalogList();
                    },
                }),
            );
        }
        syncCatalogList();
    }

    function syncCatalogList() {
        if (!ui || !ui.catalog) return;
        const { el, Badge } = atoms;
        const rows = filteredCatalog();
        ui.catalog.count.textContent = strings.catalog.count(rows.length, state.actions.length);
        ui.catalog.allBtn.setAttribute('data-active', String(state.catalogCategory === ''));

        let index = 0;
        for (const btn of ui.catalog.chips.children) {
            const item = state.categories[index];
            index += 1;
            if (!item) continue;
            btn.setAttribute('data-active', String(state.catalogCategory === item.category));
        }

        if (!rows.length) {
            ui.catalog.list.replaceChildren(el('p', { class: 'hz-hint', text: strings.catalog.empty }));
            return;
        }
        ui.catalog.list.replaceChildren(
            ...rows.map((doc) =>
                el(
                    'details',
                    { class: 'hz-catalog-item' },
                    el(
                        'summary',
                        null,
                        el('code', { class: 'hz-mono', text: doc.name }),
                        doc.readOnly
                            ? Badge({ label: strings.action.readOnly, tone: 'safe' })
                            : Badge({ label: strings.action.sideEffect, tone: 'warn' }),
                        doc.stream ? Badge({ label: strings.action.streaming, tone: 'info' }) : null,
                        el('span', { class: 'hz-hint', text: doc.summary || '' }),
                    ),
                    el(
                        'div',
                        { class: 'hz-catalog-body' },
                        doc.aliases && doc.aliases.length
                            ? el('p', { class: 'hz-hint', text: `${strings.action.aliases} ${doc.aliases.join(', ')}` })
                            : null,
                        el(
                            'table',
                            { class: 'hz-table' },
                            el(
                                'thead',
                                null,
                                el(
                                    'tr',
                                    null,
                                    el('th', { text: strings.catalog.name }),
                                    el('th', { text: strings.catalog.type }),
                                    el('th', { text: strings.catalog.required }),
                                    el('th', { text: strings.catalog.desc }),
                                ),
                            ),
                            el(
                                'tbody',
                                null,
                                ...(doc.params || []).map((param) =>
                                    el(
                                        'tr',
                                        null,
                                        el('td', null, el('code', { class: 'hz-mono', text: param.name })),
                                        el('td', { text: String(param.type) }),
                                        el('td', { text: param.required ? strings.catalog.yes : strings.catalog.no }),
                                        el('td', { text: param.desc || '' }),
                                    ),
                                ),
                            ),
                        ),
                        (doc.params || []).length === 0 ? el('p', { class: 'hz-hint', text: strings.action.noParams }) : null,
                    ),
                ),
            ),
        );
    }

    /* ---------------- 渲染：外壳 ---------------- */

    function syncShell() {
        if (!ui) return;
        ui.root.setAttribute('data-status', state.status);
        ui.root.setAttribute('data-tab', state.tab);
        for (const key of Object.keys(ui.tabButtons)) {
            ui.tabButtons[key].setAttribute('data-active', String(state.tab === key));
            ui.tabButtons[key].setAttribute('aria-selected', String(state.tab === key));
        }
        const loading = state.status === 'loading';
        ui.loadingBar.hidden = !loading;
        ui.testerSlot.hidden = state.tab !== 'tester';
        ui.catalogSlot.hidden = state.tab !== 'catalog';

        ui.alertSlot.replaceChildren();
        if (state.status === 'error') {
            ui.alertSlot.appendChild(
                atoms.el(
                    'div',
                    { class: 'hz-banner hz-banner--error', role: 'alert' },
                    atoms.el('span', { text: state.error || strings.load.failed }),
                    atoms.Button({ label: strings.common.retry, onClick: () => void reload() }),
                ),
            );
        } else if (state.status === 'empty') {
            ui.alertSlot.appendChild(
                atoms.el('div', { class: 'hz-banner hz-banner--warn', role: 'status', text: strings.account.emptyHint }),
            );
        }
        if (state.accountsError) {
            ui.alertSlot.appendChild(
                atoms.el('div', { class: 'hz-banner hz-banner--warn', role: 'status', text: `${strings.load.accountsFailed}: ${state.accountsError}` }),
            );
        }
        if (state.actionsError) {
            ui.alertSlot.appendChild(
                atoms.el('div', { class: 'hz-banner hz-banner--warn', role: 'status', text: `${strings.load.actionsFailed}: ${state.actionsError}` }),
            );
        }
    }

    function renderAll() {
        syncShell();
        syncTester();
        if (ui.catalog) syncCatalogList();
    }

    /* ---------------- 数据 ---------------- */

    async function loadAccounts() {
        const body = await api.getJson('/api/qq-list');
        const list = Array.isArray(body.list) ? body.list : [];
        return list.map((item) => ({ uin: String(item.uin), nickname: item.nickname }));
    }

    async function loadActions() {
        const body = await api.getJson('/api/debug/actions');
        const actions = Array.isArray(body.actions) ? body.actions : [];
        const categories = Array.isArray(body.categories) ? body.categories : [];
        return { actions, categories };
    }

    async function reload() {
        state.status = 'loading';
        state.error = null;
        state.accountsLoading = true;
        state.actionsLoading = true;
        renderAll();
        buildCatalog();

        const [accounts, actions] = await Promise.allSettled([loadAccounts(), loadActions()]);

        if (accounts.status === 'fulfilled') {
            state.accounts = accounts.value;
            state.accountsError = null;
            if (state.accounts.length && !state.uin) {
                state.uin = state.accounts[0].uin;
                if (ui.tester) ui.tester.account.setValue(state.uin);
            }
        } else {
            state.accounts = [];
            state.accountsError = accounts.reason && accounts.reason.message ? accounts.reason.message : strings.load.accountsFailed;
        }
        state.accountsLoading = false;

        if (actions.status === 'fulfilled') {
            state.actions = actions.value.actions;
            state.categories = actions.value.categories;
            state.actionsError = null;
        } else {
            state.actions = [];
            state.categories = [];
            state.actionsError = actions.reason && actions.reason.message ? actions.reason.message : strings.load.actionsFailed;
        }
        state.actionsLoading = false;

        if (state.actions.length === 0) {
            state.status = 'error';
            state.error =
                state.actionsError || (accounts.status === 'rejected' ? state.accountsError : null) || strings.load.failed;
        } else if (state.accounts.length === 0) {
            state.status = 'empty';
        } else {
            state.status = 'ready';
        }
        renderAll();
        buildCatalog();
        syncTester();
    }

    /* ---------------- 对话框 / 通知 ---------------- */

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
            return Promise.resolve(globalThis.confirm(`${spec.title}\n\n${spec.body}`));
        }
        return Promise.resolve(false);
    }

    function notify(message, tone) {
        if (typeof atoms.notify === 'function') {
            atoms.notify({ message, tone });
            return;
        }
        if (typeof globalThis.console === 'object') {
            globalThis.console[tone === 'error' ? 'warn' : 'info'](`[debug] ${message}`);
        }
    }

    /* ---------------- 生命周期 ---------------- */

    return {
        id: 'debug',
        title: strings.page.title,

        mount(host, ctx) {
            if (!host) throw new Error('debug-plugin: mount() 需要一个容器元素');
            if (mounted) this.unmount();
            container = host;
            atoms = (ctx && ctx.atoms) || opts.atoms || resolveAtoms();
            if (!atoms || typeof atoms.el !== 'function') {
                throw new Error('debug-plugin: 原子层不可用（既未注入 ctx.atoms，也没有 globalThis.HaizakuraAtoms）');
            }
            state = createState();
            state.history = loadHistory();
            mounted = true;
            ui = null;
            mountDom(host);
            void reload();
        },

        unmount() {
            mounted = false;
            if (streamController) streamController.abort();
            streamController = null;
            if (uploadController) uploadController.abort();
            uploadController = null;
            if (container) container.replaceChildren();
            container = null;
            ui = null;
            state = null;
        },

        refresh() {
            return reload();
        },

        /** 断言/调试用状态快照。 */
        getState() {
            return {
                status: state.status,
                error: state.error,
                accounts: state.accounts.length,
                actions: state.actions.length,
                categories: state.categories.length,
                uin: state.uin,
                action: state.action,
                streaming: isStreaming(),
                destructive: isDestructive(),
                paramMode: effectiveParamMode(),
                running: state.running,
                frames: state.frames.length,
                history: state.history.length,
                resultShown: !!state.result,
                callError: state.callError,
            };
        },
    };
}

/* ------------------------------------------------------------------ *
 * definePlugin
 * ------------------------------------------------------------------ */

/**
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
    const registry = (globalThis.__HAIZAKURA_PLUGINS__ = globalThis.__HAIZAKURA_PLUGINS__ || []);
    const existing = registry.findIndex((p) => p && p.id === definition.id);
    if (existing >= 0) registry[existing] = definition;
    else registry.push(definition);
    return Object.freeze(definition);
}

export default definePlugin(createDebugPlugin());

/* ------------------------------------------------------------------ *
 * INLINE_ATOMS —— 应由 atoms.js 提供
 * 与共享原子层同签名；atoms.js 到位后由 resolveAtoms() 旁路本块。
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
                else if (key === 'hidden') node.hidden = value === true;
                else if (key.startsWith('on') && typeof value === 'function') {
                    node.addEventListener(key.slice(2).toLowerCase(), value);
                } else if (key === 'value') node.value = value;
                else node.setAttribute(key, String(value));
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
            onclick: spec.onClick || null,
        });
        if (spec.swatch) node.appendChild(el('span', { class: 'hz-swatch', style: { background: spec.swatch } }));
        node.appendChild(el('span', { class: 'hz-btn-label', text: spec.label }));
        return node;
    }

    function Input(spec) {
        const node = el('input', {
            type: spec.type || 'text',
            class: 'hz-input',
            value: spec.value === undefined ? '' : spec.value,
            placeholder: spec.placeholder || null,
            'aria-label': spec.ariaLabel || null,
        });
        if (typeof spec.onInput === 'function') node.addEventListener('input', (e) => spec.onInput(e.target.value, e));
        return node;
    }

    function Badge(spec) {
        return el('span', {
            class: 'hz-badge',
            title: spec.title || null,
            dataset: { tone: spec.tone || 'neutral' },
            text: spec.label,
        });
    }

    function EmptyState(spec) {
        const node = el('div', { class: 'hz-empty', dataset: { tone: spec.tone || 'empty' } });
        node.appendChild(el('p', { class: 'hz-empty-title', text: spec.title }));
        if (spec.hint) node.appendChild(el('p', { class: 'hz-empty-hint', text: spec.hint }));
        if (spec.action) node.appendChild(Button(spec.action));
        return node;
    }

    function Section(spec) {
        return el(
            'section',
            { class: 'hz-section' },
            spec.title
                ? el('div', { class: 'hz-section-head' }, el('h2', { class: 'hz-section-title', text: spec.title }), spec.extra || null)
                : null,
            spec.body,
        );
    }

    function CodeBlock(spec) {
        return el('pre', { class: 'hz-code', text: spec.code });
    }

    /**
     * 可搜索组合框。允许直接输入原文（allowRaw），配合「可直接在上方输入…」提示。
     * atoms.js 版本预计会带虚拟滚动；本回退版不做虚拟化（222 项 + 少量账号足够）。
     */
    function ComboBox(spec) {
        const wrap = el('div', { class: 'hz-combo' });
        const input = el('input', {
            type: 'text',
            class: 'hz-input hz-combo-input',
            value: spec.value === undefined ? '' : spec.value,
            placeholder: spec.placeholder || '',
            'aria-label': spec.ariaLabel || '',
            role: 'combobox',
            autocomplete: 'off',
        });
        const menu = el('div', { class: 'hz-combo-menu', role: 'listbox', hidden: true });

        let options = spec.options || [];
        let filtered = options.slice();
        let active = -1;
        let loading = false;
        let error = null;

        function renderMenu() {
            menu.replaceChildren();
            if (loading) {
                menu.appendChild(el('div', { class: 'hz-combo-empty', text: '…' }));
                return;
            }
            if (error) {
                menu.appendChild(el('div', { class: 'hz-combo-empty hz-combo-error', text: error }));
                return;
            }
            if (!filtered.length) {
                menu.appendChild(
                    el('div', {
                        class: 'hz-combo-empty',
                        text: spec.emptyHint || '',
                    }),
                );
                return;
            }
            filtered.forEach((opt, index) => {
                menu.appendChild(
                    el(
                        'div',
                        {
                            class: index === active ? 'hz-combo-option is-active' : 'hz-combo-option',
                            role: 'option',
                            'aria-selected': String(index === active),
                            onmousedown: (ev) => {
                                ev.preventDefault();
                                pick(opt);
                            },
                            onmouseenter: () => {
                                active = index;
                                renderMenu();
                            },
                        },
                        el('span', { class: 'hz-combo-label', text: opt.label }),
                        opt.sub ? el('span', { class: 'hz-combo-sub', text: opt.sub }) : null,
                    ),
                );
            });
        }

        function refilter() {
            const needle = input.value.trim().toLowerCase();
            filtered = !needle
                ? options.slice()
                : options.filter(
                      (o) =>
                          String(o.label).toLowerCase().includes(needle) ||
                          String(o.sub || '').toLowerCase().includes(needle),
                  );
            active = filtered.length ? 0 : -1;
        }

        function open() {
            refilter();
            renderMenu();
            menu.hidden = false;
        }

        function close() {
            menu.hidden = true;
            active = -1;
        }

        function pick(opt) {
            input.value = opt.value;
            close();
            if (typeof spec.onPick === 'function') spec.onPick(opt.value, opt);
        }

        function commitRaw() {
            close();
            if (typeof spec.onPick === 'function') spec.onPick(input.value, null);
        }

        input.addEventListener('focus', open);
        input.addEventListener('input', () => {
            if (typeof spec.onInput === 'function') spec.onInput(input.value);
            open();
        });
        input.addEventListener('blur', () => {
            // 失焦后延时关闭，保证 mousedown 选中先发生。
            setTimeout(() => {
                close();
                if (spec.allowRaw) commitRaw();
            }, 120);
        });
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                if (menu.hidden) open();
                if (!filtered.length) return;
                active = ev.key === 'ArrowDown' ? (active + 1) % filtered.length : (active - 1 + filtered.length) % filtered.length;
                renderMenu();
            } else if (ev.key === 'Enter') {
                ev.preventDefault();
                if (filtered.length && active >= 0) pick(filtered[active]);
                else commitRaw();
            } else if (ev.key === 'Escape') {
                close();
            }
        });

        wrap.appendChild(input);
        wrap.appendChild(menu);

        return {
            node: wrap,
            input,
            setValue(value) {
                input.value = value === undefined || value === null ? '' : String(value);
            },
            setOptions(next) {
                options = next || [];
                if (!menu.hidden) open();
            },
            setLoading(next) {
                loading = !!next;
                if (!menu.hidden) renderMenu();
            },
            setError(next) {
                error = next || null;
                if (!menu.hidden) renderMenu();
            },
            setDisabled(next) {
                input.disabled = !!next;
            },
        };
    }

    return {
        __source: 'inline-fallback', // 应由 atoms.js 提供
        el,
        Button,
        Input,
        Badge,
        EmptyState,
        Section,
        CodeBlock,
        ComboBox,
    };
})();
