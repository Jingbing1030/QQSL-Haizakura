// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/notification-templates.ts"
// original bundle lines 346212-346224  (11 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var DEFAULT_WEBHOOK_BODY = `{
  "title": "账号状态通知：{event}",
  "desp": "您的账号状态发生了改变。\\n\\n**昵称**：{nickname}\\n**QQ号**：{uin}\\n**当前状态**：{event}\\n**进程状态**：{status}\\n**时间**：{time}"
}`;
var DEFAULT_EMAIL_BODY = `账号状态发生了改变。

昵称：{nickname}
QQ号：{uin}
当前状态：{event}
进程状态：{status}
时间：{time}`;
export {};
