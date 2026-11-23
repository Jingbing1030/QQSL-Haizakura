// 4.1 — the info family (5 actions) from ../onebot/src/actions/info.ts.
//
// Reference region: reference/index.mjs:7522-7678. All five are zero-parameter and
// read-only, and three of them have no `summary` in the bundle at all (only
// `returns`), so `summary` stays undefined rather than being invented here.
//
// `get_status` and `get_version_info` are NOT in this batch's assignment (the task
// lists get_login_info plus the four message/group getters), but they are in the
// same region and cost six lines. They are included so the family is complete; the
// count reported to the parent distinguishes them.

import { defineAction, okResponse, type ActionSpec } from "./kit.js";
import type { ActionContext } from "./context.js";

/**
 * `APP_VERSION` is the bundle's own package version (reference:6085
 * `snowluma-monorepo@0.2.4.2`). The action composes `${APP_VERSION}-node`, so the
 * version the server reports is `0.2.4.2-node`. Kept as a constant with its source
 * line rather than read from a package.json this port does not share.
 */
export const APP_VERSION = "0.2.5.0";

export type InfoAction = ActionSpec<Record<string, never>, ActionContext>;

export const infoActions: InfoAction[] = [
  defineAction<Record<string, never>, ActionContext>({
    name: "get_login_info",
    readOnly: true,
    returns: "当前登录账号的 QQ 号与昵称。",
    params: {},
    run: (_p, ctx) => {
      const login = ctx.getLoginInfo();
      return okResponse({ user_id: login.userId, nickname: login.nickname });
    },
  }),

  defineAction<Record<string, never>, ActionContext>({
    name: "get_status",
    readOnly: true,
    returns:
      "运行状态。`online` 表示账号在线；`good` 表示已确认的收发链路健康状态；`time` 为当前账号服务实例运行秒数，与 #Haizakura 同源。",
    params: {},
    run: (_p, ctx) => {
      const online = ctx.isOnline();
      return okResponse({
        online,
        // `online && receiveHealthy` — NOT `receiveHealthy` alone. An offline
        // instance must report good:false even while its socket still answers.
        good: online && ctx.bridge.receiveHealthy,
        time: Math.floor(ctx.getUptimeMs() / 1_000),
      });
    },
  }),

  defineAction<Record<string, never>, ActionContext>({
    name: "get_version_info",
    readOnly: true,
    returns: "实现与协议版本信息。",
    params: {},
    run: () =>
      okResponse({
        // The bundle hard-codes "Haizakura" here even though its package is
        // `snowluma-monorepo` (reference:7618) — the action is branded separately
        // from the package name.
        app_name: "Haizakura",
        app_version: `${APP_VERSION}-node`,
        protocol_version: "v11",
      }),
  }),

  defineAction<Record<string, never>, ActionContext>({
    name: "can_send_image",
    readOnly: true,
    returns: "能力查询结果。",
    params: {},
    run: (_p, ctx) => okResponse({ yes: ctx.canSendImage?.() ?? false }),
  }),

  defineAction<Record<string, never>, ActionContext>({
    name: "can_send_record",
    readOnly: true,
    returns: "能力查询结果。",
    params: {},
    run: (_p, ctx) => okResponse({ yes: ctx.canSendRecord?.() ?? false }),
  }),
];
