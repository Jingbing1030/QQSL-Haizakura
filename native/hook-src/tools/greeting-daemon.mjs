#!/usr/bin/env node
// 问候守护进程：按固定间隔调用 greeting.mjs，并在异常时继续存活。
//
// 为什么不直接塞进 crontab：
//   * 这个容器里没有 cron（实测 which crontab cron 都为空）。
//   * supervisor 已经在管 qq 和 snowluma，加一个 program 就能统一启停和看日志，
//     比另装一套调度器轻。
//
// 为什么用自循环而不是"每小时第 0 分"：
//   用户要的是"距离上次发送已过去 c"的播报，c 的语义决定了间隔必须稳定，
//   否则报出来的 c 会忽长忽短。固定间隔 + 状态文件记录真实发送时刻，
//   即使某次失败，下一次报的 c 也是真实的。
//
// 失败处理：单次失败只记日志，不退出。守护进程退出的唯一条件是收到 SIGTERM。

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, 'greeting.mjs');

const GROUP = process.env.GREETING_GROUP || '';
const TOKEN = process.env.GREETING_TOKEN || '';
const BASE = process.env.GREETING_BASE || 'http://127.0.0.1:3000';
// 默认 1 小时。用秒表示，便于测试时调小。
const INTERVAL_S = Number(process.env.GREETING_INTERVAL_S || 3600);

if (!GROUP) { console.error('缺少 GREETING_GROUP'); process.exit(1); }

function log(msg) {
  // 不加时间戳前缀以外的格式，方便 supervisor 的 stdout_logfile 直接读
  console.log(`[greeting ${new Date().toISOString()}] ${msg}`);
}

function runOnce() {
  return new Promise((resolve) => {
    const args = [SCRIPT, GROUP, `--base=${BASE}`];
    if (TOKEN) args.push(`--token=${TOKEN}`);
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      // 输出整段转进日志：greeting.mjs 的 stdout 就是最终发出的文案，
      // 保留它等于同时留了一份消息内容，排查"发错内容"时不必再去问群历史。
      for (const line of out.trim().split('\n')) if (line) log(line);
      log(`exit=${code}`);
      resolve(code);
    });
    child.on('error', (e) => { log(`spawn 失败: ${e.message}`); resolve(-1); });
  });
}

let stopping = false;
process.on('SIGTERM', () => { stopping = true; log('收到 SIGTERM，准备退出'); });
process.on('SIGINT', () => { stopping = true; log('收到 SIGINT，准备退出'); });

log(`启动 group=${GROUP} interval=${INTERVAL_S}s base=${BASE}`);

// 启动时先跑一次，否则要等满一个间隔才有第一条消息
await runOnce();

while (!stopping) {
  // 分段休眠，这样 SIGTERM 能在 1 秒内被响应，而不是等满一小时
  const deadline = Date.now() + INTERVAL_S * 1000;
  while (!stopping && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (stopping) break;
  await runOnce();
}
log('已退出');
process.exit(0);
