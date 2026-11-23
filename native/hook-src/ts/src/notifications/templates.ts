// The two default body templates a channel gets when its config omits
// `bodyTemplate`.
//
// Reference region: ../common/src/notification-templates.ts L347941-L347953
// (13 lines, ported verbatim — including the `\\n` escapes, see below).
//
// Why these are constants and not built by a function: they are the *stored*
// default. `normalizeChannel` materializes one of them into the channel object, so
// a saved `notifications.json` carries the full template text rather than a
// `null` the WebUI has to render as "default". That means changing a template here
// only affects channels created afterwards — existing files keep the old text,
// which is the correct behaviour for an operator-editable field.
//
// The webhook default is **JSON** and the email default is **plain text**. That
// difference is load-bearing for `renderTemplate`: it decides whether substituted
// values get JSON-escaped. A nickname containing `"` would produce invalid JSON in
// the webhook payload otherwise, and a webhook receiver that fails to parse it
// reports nothing useful.
//
// The webhook body's newlines are the two characters `\` + `n`, not real newlines:
// the payload is JSON, and a JSON string cannot contain a literal newline.

/** Webhook default — a JSON object, so `renderTemplate` JSON-escapes substitutes. */
export const DEFAULT_WEBHOOK_BODY = `{
  "title": "账号状态通知：{event}",
  "desp": "您的账号状态发生了改变。\\n\\n**昵称**：{nickname}\\n**QQ号**：{uin}\\n**当前状态**：{event}\\n**进程状态**：{status}\\n**时间**：{time}"
}`;

/** Email default — plain text, so `renderTemplate` substitutes raw strings. */
export const DEFAULT_EMAIL_BODY = `账号状态发生了改变。

昵称：{nickname}
QQ号：{uin}
当前状态：{event}
进程状态：{status}
时间：{time}`;

/**
 * The default `Subject:` template, which lives in `config.ts` in the reference
 * (L348382) rather than in the templates module. Exported from here anyway so both
 * templates are in one place and `config.ts` has a single import for them.
 */
export const DEFAULT_SUBJECT_TEMPLATE = "账号{event}：{nickname} ({uin})";
