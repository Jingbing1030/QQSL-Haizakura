import { strict as assert } from "node:assert";
import { once } from "node:events";
import { describe, test } from "node:test";

import { OneBotNetworkManager } from "../src/onebot/manager.js";
import { WebSocketClient } from "../src/onebot/websocket.js";
import { makeCtx, RecordingApi } from "./onebot-harness.js";

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    import("node:net").then(({ createServer }) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") { server.close(); reject(new Error("no TCP address")); return; }
        server.close((error) => error ? reject(error) : resolve(address.port));
      });
    });
  });
}

describe("Satori server adapter", () => {
  test("manager reconciliation mounts the sentinel as a Satori server", async () => {
    const api = new RecordingApi({
      get_login_info: { response: { status: "ok", retcode: 0, data: { user_id: 10001, nickname: "bot" } } },
    });
    const ctx = makeCtx(api);
    const port = await availablePort();
    const manager = new OneBotNetworkManager({ ctx });
    const config = {
      networks: {
        httpServers: [], httpClients: [], wsClients: [],
        wsServers: [{ name: "satori", host: "127.0.0.1", port, path: "/v1/events", accessToken: "secret" }],
      },
    };
    try {
      const result = await manager.reconcile(config);
      assert.equal(result.applied, true, JSON.stringify(result.errors));
      assert.equal(result.statuses[0]?.kind, "satoriServer");
      assert.equal(manager.get("satori")?.describeStatus().kind, "satoriServer");

      const login = await fetch(`http://127.0.0.1:${port}/v1/login.get`, {
        method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json", "Satori-Platform": "haizakura", "Satori-User-ID": ctx.uin }, body: "{}",
      });
      assert.equal(login.status, 200);
      assert.equal((await login.json() as { platform: string }).platform, "haizakura");
      const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/login.get`, { method: "POST" });
      assert.equal(unauthorized.status, 401);

      const ws = new WebSocketClient(`ws://127.0.0.1:${port}/v1/events`);
      const frames: Array<Record<string, unknown>> = [];
      ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString("utf8")) as Record<string, unknown>));
      await once(ws, "open");
      ws.send(JSON.stringify({ op: 3, body: { token: "secret" } }));
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("READY not received")), 2000);
        const poll = () => {
          if (frames.some((frame) => frame.op === 4)) { clearTimeout(deadline); resolve(); }
          else setTimeout(poll, 10);
        };
        poll();
      });
      ws.send(JSON.stringify({ op: 1, body: {} }));
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("PONG not received")), 2000);
        const poll = () => {
          if (frames.some((frame) => frame.op === 2)) { clearTimeout(deadline); resolve(); }
          else setTimeout(poll, 10);
        };
        poll();
      });

      await manager.emitEvent({
        post_type: "message", message_type: "group", time: 1700000000,
        group_id: 7, user_id: 8, message_id: 9,
        message: [{ type: "text", data: { text: "hello" } }], raw_message: "hello",
        sender: { nickname: "peer" },
      });
      await manager.emitEvent({ post_type: "notice", notice_type: "group_increase", group_id: 7, user_id: 8 });
      await manager.emitEvent({ post_type: "request", request_type: "friend", user_id: 8, flag: "flag-1", comment: "hi" });
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("event frames not received")), 2000);
        const poll = () => {
          const events = frames.filter((frame) => frame.op === 0).map((frame) => frame.body as Record<string, unknown>);
          const types = new Set(events.map((event) => event.type));
          if (types.has("message-created") && types.has("guild-member-added") && types.has("friend-request")) { clearTimeout(deadline); resolve(); }
          else setTimeout(poll, 10);
        };
        poll();
      });
      const eventBodies = frames.filter((frame) => frame.op === 0).map((frame) => frame.body as Record<string, unknown>);
      const messageEvent = eventBodies.find((event) => event.type === "message-created") as Record<string, unknown>;
      assert.equal((messageEvent.message as Record<string, unknown>).id, "9");
      assert.equal((eventBodies.find((event) => event.type === "friend-request")?.message as Record<string, unknown>).id, "flag-1");
      ws.terminate();
    } finally {
      await manager.shutdown();
    }
  });
});
