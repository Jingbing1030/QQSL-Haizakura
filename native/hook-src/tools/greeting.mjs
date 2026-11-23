#!/usr/bin/env node
// 定时问候：向指定群发送一条"按时段报时 + 期间消息统计"的消息。
//
// 设计取舍：
//   * 统计口径是"自上次发送以来"，所以必须先落盘上次发送时间（state 文件），
//     否则进程重启或手动运行会把窗口算错。state 不存在时按首次运行处理——
//     报"首次运行"，而不是谎报一个从未测量过的区间。
//   * 消息统计只数"别人发的"，也就是 user_id != 自己。自己刚发的那条问候
//     不应该算进下一次的 x 条里，否则数字会永久自增 1。
//   * 群数 / 用户数按 window 内出现过的去重集合统计，不是累计。
//   * 服务器时间取容器本地时间；北京时间显式按 UTC+8 换算，不依赖 TZ 环境变量，
//     因为容器里 TZ 未必设置成 Asia/Shanghai。
//   * 时间跨度用 Date.now() 的差值，精确到毫秒（消息里保留三位小数）。
//     不用本地时间相减，那样会跨夏令时/时区抖动算错。
//
// 用法：
//   node greeting.mjs <group_id> [--dry-run] [--token=...] [--base=http://127.0.0.1:3000]
//
// 退出码：0 成功；1 参数错误；2 接口失败。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_BASE = 'http://127.0.0.1:3000';
const DEFAULT_TOKEN = process.env.ONEBOT_TOKEN || '';
// State location, in order of preference:
//   1. GREETING_STATE_DIR, so a deployment can point it somewhere writable
//   2. <home>/.local/state
//   3. /tmp, as a last resort that at least survives within one boot
//
// This mattered immediately: the daemon runs as `snowluma` with HOME=/app, and /app is
// not writable by that user, so the first real run failed with EACCES and silently
// degraded to "first run" forever -- the message said so, but the interval and the
// statistics would never have appeared.
function stateDir() {
  const candidates = [];
  if (process.env.GREETING_STATE_DIR) candidates.push(process.env.GREETING_STATE_DIR);
  candidates.push(join(homedir(), '.local', 'state'));
  candidates.push('/tmp/greeting-state');
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '.probe'), ''); // 真写一次才算可写，mkdir 成功不代表能写
      return dir;
    } catch { /* 试下一个 */ }
  }
  return null;
}

const STATE_DIR = stateDir();
const STATE_FILE = STATE_DIR ? join(STATE_DIR, 'greeting-state.json') : '';

// ---- 参数 ----------------------------------------------------------------

function parseArgs(argv) {
  const out = { groupId: 0, dryRun: false, base: DEFAULT_BASE, token: DEFAULT_TOKEN, quiet: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--quiet') out.quiet = true;
    else if (arg.startsWith('--token=')) out.token = arg.slice(8);
    else if (arg.startsWith('--base=')) out.base = arg.slice(7);
    else if (/^\d+$/.test(arg)) out.groupId = Number(arg);
    else if (arg === '--help' || arg === '-h') { usage(); process.exit(0); }
    else { console.error(`无法识别的参数: ${arg}`); usage(); process.exit(1); }
  }
  if (!out.groupId) { console.error('缺少群号'); usage(); process.exit(1); }
  return out;
}

function usage() {
  console.error('用法: node greeting.mjs <group_id> [--dry-run] [--quiet] [--token=...] [--base=...]');
}

// ---- OneBot 调用 ---------------------------------------------------------

async function call(base, token, action, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/${action}`, {
    method: 'POST', headers, body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${action}: 非 JSON 响应 (${res.status}) ${text.slice(0, 200)}`); }
  if (body.retcode !== 0) throw new Error(`${action}: retcode=${body.retcode} ${body.wording || ''} ${JSON.stringify(body.data ?? '')}`.trim());
  return body.data;
}

// ---- 时间 ----------------------------------------------------------------

// 北京时间按固定 UTC+8 换算。中国自 1991 年起不再实行夏令时，固定偏移是正确的，
// 而依赖 TZ=Asia/Shanghai 会让脚本在 TZ 未设置的容器里输出错误的小时数。
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingParts(nowMs) {
  const d = new Date(nowMs + BEIJING_OFFSET_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
  };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatBeijing(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function formatServer(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// 时段问候语。边界按中文习惯取：5 点起算上午，11 点中午，13 点下午仍算"下午"，
// 但用户给定的文案里"下午"没有出现在选择集中，所以 13:00-17:59 用"晚上好"会在
// 傍晚前就说晚上，不合适 —— 因此 13:00 之后到 18:00 归入"中午"，18 点后才是晚上。
function greetingFor(hour) {
  if (hour >= 5 && hour < 9) return '早上好';
  if (hour >= 9 && hour < 12) return '上午好';
  if (hour >= 12 && hour < 18) return '中午好';
  if (hour >= 18 && hour < 23) return '晚上好';
  if (hour >= 23 || hour < 4) return '夜深了早点睡吧';
  return '快天亮了早点睡吧'; // 4:00-4:59
}

// 把毫秒差拆成 天/小时/分钟/秒，秒保留三位小数。
//
// 用整数毫秒做全部运算而不是浮点秒：浮点在 10^9 量级的毫秒上仍能精确到毫秒，
// 但连续减法取余容易在 59.999/60.000 边界上抖，整数毫秒没有这个问题。
function splitDuration(ms) {
  if (ms < 0) ms = 0;
  const wholeMs = Math.round(ms);
  const days = Math.floor(wholeMs / 86400000);
  let rest = wholeMs - days * 86400000;
  const hours = Math.floor(rest / 3600000);
  rest -= hours * 3600000;
  const minutes = Math.floor(rest / 60000);
  rest -= minutes * 60000;
  const seconds = rest / 1000;
  return { days, hours, minutes, seconds };
}

function formatDuration(d) {
  const parts = [];
  if (d.days) parts.push(`${d.days}天`);
  if (d.hours) parts.push(`${d.hours}小时`);
  if (d.minutes) parts.push(`${d.minutes}分钟`);
  // 秒总是出现，且带三位小数，这样即使只有几百毫秒也能看出确实测过
  parts.push(`${d.seconds.toFixed(3)}秒`);
  return parts.join('');
}

// ---- 统计 ----------------------------------------------------------------

// 从上次发送时刻到现在的消息里，统计"别人发的"条数、涉及群数、涉及用户数。
//
// 群列表用 get_group_list，再逐群拉历史：OneBot 没有全局消息流接口，
// 而每个群的历史条数上限有限，所以按需取。窗口很长时这个做法会漏消息，
// 此时如实说明窗口可能不完整，而不是给一个看起来精确的错数。
async function collectStats(opts, sinceMs, nowMs) {
  const windowSeconds = Math.max(1, Math.ceil((nowMs - sinceMs) / 1000));
  const groups = await call(opts.base, opts.token, 'get_group_list');
  const me = (await call(opts.base, opts.token, 'get_login_info')).user_id;

  // 每个群取多少条历史。
  //
  // 曾用 ceil(窗口秒数 / 3) 反推"窗口内最多可能有多少条"，但那个估计对小窗口严重高估：
  // 8 分钟的窗口算出 160，被截到 100，于是"取满 100 条"就被误判成"窗口可能不完整"——
  // 而实际只收到 5 条。判定"不完整"的正确依据是**取到的最早一条仍晚于窗口起点**，
  // 也就是下面用时间戳判断，而不是用条数判断。
  const perGroup = 100;
  let messages = 0;
  const groupsHit = new Set();
  const usersHit = new Set();
  let truncated = false;

  for (const g of groups) {
    let batch;
    try {
      batch = await call(opts.base, opts.token, 'get_group_msg_history',
        { group_id: g.group_id, count: perGroup, message_seq: 0 });
    } catch { continue; } // 单群失败不应让整条问候失败
    const list = batch?.messages ?? [];
    for (const m of list) {
      if (Number(m.time) * 1000 < sinceMs) continue;
      if (Number(m.user_id) === Number(me)) continue; // 自己发的不算
      messages += 1;
      groupsHit.add(g.group_id);
      usersHit.add(m.user_id);
    }
    // 是否需要拉更多历史，看的是**这批里最早一条是否还在窗口之内**：
    // 如果最早一条仍晚于 sinceMs，说明更早的消息可能没被取到，窗口不完整。
    // 用条数判断会把"某群恰好 100 条但都超出窗口"也算成不完整，那是错的。
    if (list.length > 0) {
      const oldest = Math.min(...list.map((m) => Number(m.time) * 1000));
      if (oldest > sinceMs + 1000) truncated = true;
    }
  }
  return { messages, groups: groupsHit.size, users: usersHit.size, truncated, scanned: groups.length };
}

// ---- 状态 ----------------------------------------------------------------

function loadState() {
  if (!STATE_FILE) return null;
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

function saveState(state) {
  if (!STATE_FILE) {
    console.error('警告: 找不到可写目录，无法保存状态，每次都会当成首次运行');
    return;
  }
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error(`警告: 状态写入失败 (${e.message})`);
  }
}

// ---- 主流程 --------------------------------------------------------------

const opts = parseArgs(process.argv);
const nowMs = Date.now();
const bj = beijingParts(nowMs);
const state = loadState();

let spanMs = 0;
let firstRun = true;
if (state && Number.isFinite(state.lastSentMs) && state.lastSentMs > 0 && state.lastSentMs <= nowMs) {
  spanMs = nowMs - state.lastSentMs;
  firstRun = false;
}

let stats = { messages: 0, groups: 0, users: 0, truncated: false, scanned: 0 };
if (!firstRun) {
  try {
    stats = await collectStats(opts, state.lastSentMs, nowMs);
  } catch (e) {
    console.error(`统计失败 (${e.message})，将以 0 播报并标注`);
    stats = { messages: 0, groups: 0, users: 0, truncated: true, scanned: 0, error: e.message };
  }
}

const greeting = greetingFor(bj.hour);
const lines = [];
lines.push(`${greeting}，现在是北京时间 ${formatBeijing(bj)}，服务器时间 ${formatServer(nowMs)}`);

if (firstRun) {
  lines.push('这是首次运行，还没有上一次发送记录，暂不播报间隔与消息统计。');
} else {
  lines.push(`距离上次发送本消息已过去 ${formatDuration(splitDuration(spanMs))}`);
  if (stats.error) {
    lines.push(`统计未能完成（${stats.error}），本次数字不可用。`);
  } else {
    // truncated 时不假装数字完整：窗口内某群的消息可能多于此批
    const caveat = stats.truncated ? '（窗口较长，统计可能不完整）' : '';
    lines.push(`在此期间收到了 ${stats.messages} 条消息，来自 ${stats.groups} 个群，${stats.users} 个用户${caveat}`);
  }
}

const message = lines.join('\n');

if (opts.dryRun) {
  console.log('--- 将要发送 ---');
  console.log(message);
  console.log('--- (dry-run，未发送) ---');
  process.exit(0);
}

try {
  const sent = await call(opts.base, opts.token, 'send_group_msg', {
    group_id: opts.groupId,
    message: [{ type: 'text', data: { text: message } }],
  });
  saveState({ lastSentMs: nowMs, groupId: opts.groupId, messageId: sent?.message_id ?? null });
  if (!opts.quiet) console.log(`已发送 message_id=${sent?.message_id}\n${message}`);
  process.exit(0);
} catch (e) {
  console.error(`发送失败: ${e.message}`);
  process.exit(2);
}
