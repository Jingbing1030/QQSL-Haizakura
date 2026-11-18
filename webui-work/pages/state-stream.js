/**
 * state-stream.js —— 与官方 WebUI 同构的实时状态层。
 *
 * 为什么需要它（原版本来就这么做）：
 *   官方前端用一条 SSE 长连接 `/api/state/stream`，服务端在 `processes` /
 *   `qq-list` / `connections` 三个 resource 变化时主动推送快照。
 *   各页面通过全局 store 消费，`refreshX()` 只是「立刻再拉一次」。
 *
 *   我上一版改成每页各自 fetch + 5 秒轮询，导致：
 *     · 最多滞后 5 秒（原版是秒级推送）
 *     · 多个页面各发一份请求，重复拉取
 *     · 手动刷新与轮询互相覆盖，闪一下旧数据
 *
 * 事件格式（实测）：
 *   {"kind":"ready"}                       连接就绪
 *   {"kind":"dropped","count":N}           推送积压被丢弃 N 条 → 需要全量重同步
 *   {"resource":"processes","data":[...]}  某 resource 的新快照
 *   {"kind":"event"|"action", ...}         其它事件（本项目暂不消费）
 */

import { readToken, TOKEN_HEADER } from './data-layer.js';

/** 支持的 resource 名称（与服务端 state-stream 的 streams 一一对应）。 */
export const RESOURCES = ['processes', 'qq-list', 'connections'];

/* ── 内部状态 ────────────────────────────────────────────────── */

const snapshots = new Map();      // resource → data
const listeners = new Map();      // resource → Set<cb>
const globalListeners = new Set(); // 所有变化的监听

let conn = null;                  // AbortController
let status = 'idle';              // idle | connecting | open | reconnecting | closed
let retryDelay = 1000;
let retryTimer = null;
let droppedTotal = 0;

/** 状态变化时通知（供 UI 显示「连接中/已断开」）。 */
const statusListeners = new Set();

function setStatus(next) {
  if (status === next) return;
  status = next;
  for (const cb of statusListeners) {
    try { cb(next); } catch { /* noop */ }
  }
}

export function getStatus() { return status; }
export function getDroppedCount() { return droppedTotal; }

export function onStatusChange(cb) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

/* ── 订阅 ────────────────────────────────────────────────────── */

export function getSnapshot(resource) {
  return snapshots.get(resource);
}

/**
 * 订阅某 resource 的快照变化。
 * 回调签名：(data, meta) — meta 含 { reason: 'push'|'drop'|'manual' }
 */
export function subscribe(resource, cb) {
  if (!listeners.has(resource)) listeners.set(resource, new Set());
  listeners.get(resource).add(cb);
  return () => listeners.get(resource)?.delete(cb);
}

/** 订阅任意 resource 变化。 */
export function subscribeAll(cb) {
  globalListeners.add(cb);
  return () => globalListeners.delete(cb);
}

function emit(resource, data, reason) {
  snapshots.set(resource, data);
  const set = listeners.get(resource);
  if (set) {
    for (const cb of set) {
      try { cb(data, { reason }); } catch (err) { console.error('[state-stream]', err); }
    }
  }
  for (const cb of globalListeners) {
    try { cb(resource, data, reason); } catch { /* noop */ }
  }
}

/* ── SSE 连接 ────────────────────────────────────────────────── */

/**
 * 建立 SSE 连接。
 *
 * 用 fetch + ReadableStream 而不是 EventSource —— EventSource 不能带
 * 自定义请求头，而鉴权走的是 X-SnowLuma-Token。
 */
export async function connect() {
  if (conn) return;
  const ac = new AbortController();
  conn = ac;
  setStatus('connecting');

  const token = readToken();
  const headers = { Accept: 'text/event-stream' };
  if (token) headers[TOKEN_HEADER] = token;

  let res;
  try {
    res = await fetch('/api/state/stream', { headers, signal: ac.signal, cache: 'no-store' });
  } catch (err) {
    conn = null;
    setStatus('idle');
    scheduleRetry();
    return;
  }

  if (!res.ok || !res.body) {
    conn = null;
    setStatus('idle');
    scheduleRetry();
    return;
  }

  setStatus('open');
  retryDelay = 1000;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE 以空行分帧
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handleFrame(frame);
      }
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      // 网络抖动，稍后重连
    }
  } finally {
    if (conn === ac) conn = null;
    setStatus('closed');
    scheduleRetry();
  }
}

function handleFrame(frame) {
  // 取所有 data: 行（SSE 允许一行数据拆成多行）
  const lines = frame.split('\n');
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    else if (line.startsWith(':') || line === '') { /* 心跳或空行 */ }
  }
  if (!dataLines.length) return;

  let payload;
  try { payload = JSON.parse(dataLines.join('\n')); } catch { return; }

  if (payload.kind === 'ready') { setStatus('open'); return; }

  if (payload.kind === 'dropped') {
    // 积压丢弃 → 必须全量重同步，否则界面会停在旧状态
    droppedTotal += payload.count || 1;
    void resyncAll('drop');
    return;
  }

  if (payload.resource && RESOURCES.includes(payload.resource)) {
    emit(payload.resource, payload.data, 'push');
    return;
  }
  // kind: event / action 等，本项目不消费
}

/* ── 手动刷新 ────────────────────────────────────────────────── */

/** resource → 对应的一次性拉取端点。 */
const FETCH_ENDPOINT = {
  processes: '/api/processes',
  'qq-list': '/api/qq-list',
  connections: '/api/connections',
};

/** resource → 从响应体里取数据的字段名。 */
const PICK = {
  processes: (p) => (Array.isArray(p) ? p : (p?.list ?? [])),
  'qq-list': (p) => (p?.list ?? []),
  connections: (p) => (p?.list ?? []),
};

/**
 * 立即拉取某个 resource（对应原版的 refreshProcesses / refreshQqList）。
 * 不依赖 SSE，SSE 断开时也能用。
 */
export async function refresh(resource) {
  const ep = FETCH_ENDPOINT[resource];
  if (!ep) throw new Error(`未知 resource: ${resource}`);
  const token = readToken();
  const headers = {};
  if (token) headers[TOKEN_HEADER] = token;
  const res = await fetch(ep, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`${ep} → HTTP ${res.status}`);
  const payload = await res.json();
  const data = PICK[resource](payload);
  emit(resource, data, 'manual');
  return data;
}

export async function refreshAll() {
  await Promise.all(RESOURCES.map((r) => refresh(r).catch(() => {})));
}

/** dropped 之后的全量重同步。 */
async function resyncAll(reason) {
  for (const r of RESOURCES) {
    try {
      const token = readToken();
      const headers = {};
      if (token) headers[TOKEN_HEADER] = token;
      const res = await fetch(FETCH_ENDPOINT[r], { headers, cache: 'no-store' });
      if (!res.ok) continue;
      const payload = await res.json();
      emit(r, PICK[r](payload), reason);
    } catch { /* 单个失败不影响其它 */ }
  }
}

/* ── 断线重连 ────────────────────────────────────────────────── */

function scheduleRetry() {
  if (retryTimer) return;
  setStatus('reconnecting');
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryDelay = Math.min(retryDelay * 2, 30000);   // 指数退避，上限 30 秒
    void connect();
  }, retryDelay);
}

/** 主动关闭连接（页面卸载时调用）。 */
export function disconnect() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (conn) { conn.abort(); conn = null; }
  setStatus('closed');
}

/** 断线期间用：浏览器重新可见时立刻补一次。 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && status !== 'open') {
      retryDelay = 1000;
      void connect();
    }
  });
}
