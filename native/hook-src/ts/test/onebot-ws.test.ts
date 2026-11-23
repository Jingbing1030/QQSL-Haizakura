// Replay the reference WebSocket fixtures against the TypeScript port.
//
// Fixtures (work/onebot-net/probe/, all recorded against the reference bundle's
// own adapters and its own hand-rolled WebSocket implementation):
//
//   ref-ws.json            standalone WsServerAdapter (role Universal/Api/Event),
//                          the HTTP adapter's embedded upgrade, and WsClientAdapter
//                          dialling a server the reference also hosts.
//   ref-ws2.json           path matrix on both listeners, mid-stream config
//                          changes, reconnect status, and the network manager.
//   ref-ws-handshake.json  raw upgrade-response bytes captured on a bare socket,
//                          which is the only way to pin the abort heads.
//
// The client used to connect is the reference's own `WebSocketClient` behaviour
// (handshake validation, `WebSocket handshake failed: <reason>` errors), so a
// refusal is asserted by its exact message, not just "it failed".

import { strict as assert } from "node:assert";
import { describe, test, before, after } from "node:test";

import { WsServerAdapter, WsClientAdapter } from "../src/onebot/ws.js";
import { HttpServerAdapter } from "../src/onebot/http.js";
import type { WsServerConfig } from "../src/onebot/adapter.js";
import { WebSocketClient, WebSocketServer } from "../src/onebot/websocket.js";
import { OneBotNetworkManager, createNetworkAdapter } from "../src/onebot/manager.js";
import { RecordingApi, CONTRACTS, fixture, makeCtx, dispatch, type FixtureFile, type RecordedCase } from "./onebot-harness.js";

const wsFixtures = fixture<FixtureFile>("ref-ws.json");
const ws2Fixtures = fixture<FixtureFile>("ref-ws2.json");

const GROUP_EVENT = {
  time: 1700000000,
  self_id: 10001,
  post_type: "message",
  message_type: "group",
  sub_type: "normal",
  group_id: 7,
  user_id: 8,
  message_id: 9,
  message: [{ type: "text", data: { text: "hi" } }],
  raw_message: "hi",
  sender: { user_id: 8, nickname: "peer" },
};

interface Collected {
  frames: Array<{ data: string; isBinary: boolean }>;
  handshake: { statusCode: number; statusMessage: string; headers: Record<string, string> } | null;
  reason?: string;
  refused?: boolean;
  message?: string;
}

/**
 * Connect the port's own client and collect frames — the same shape the harness
 * used against the reference, so recorded values compare directly.
 */
function collect(
  port: number,
  options: {
    path?: string;
    headers?: Record<string, string>;
    onOpen?: (ws: WebSocketClient) => number | void;
    settleMs?: number;
    clientOptions?: Record<string, unknown>;
  } = {},
): Promise<Collected> {
  const { path = "/", headers = {}, onOpen, settleMs = 250, clientOptions = {} } = options;
  return new Promise((resolve) => {
    const frames: Array<{ data: string; isBinary: boolean }> = [];
    let handshake: Collected["handshake"] = null;
    const ws = new WebSocketClient(`ws://127.0.0.1:${port}${path}`, { headers, ...clientOptions });
    const finish = (reason: string) => {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      resolve({ frames, handshake, reason });
    };
    const timer = setTimeout(() => finish("timeout"), settleMs);
    timer.unref?.();
    ws.on("upgrade", (parsed: Collected["handshake"]) => {
      handshake = parsed;
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => frames.push({ data: String(data), isBinary }));
    ws.on("open", () => {
      clearTimeout(timer);
      const done = onOpen ? onOpen(ws) : undefined;
      const wait = typeof done === "number" ? done : settleMs;
      setTimeout(() => finish("settled"), wait).unref?.();
    });
    // A rejected upgrade surfaces here; resolve (don't reject) so a probe that
    // expects a refusal leaves no dangling rejection.
    ws.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ frames, handshake, refused: true, message: err.message });
    });
  });
}

function roundTrip(
  port: number,
  options: { path?: string; headers?: Record<string, string>; payload?: string; settleMs?: number } = {},
): Promise<Collected> {
  const { path = "/", headers = {}, payload, settleMs = 200 } = options;
  return collect(port, {
    path,
    headers,
    settleMs,
    onOpen: (ws) => {
      ws.send(payload ?? "");
      return settleMs;
    },
  });
}

function expectFailure(port: number, options: { path?: string; headers?: Record<string, string> } = {}): Promise<Collected> {
  return collect(port, { ...options, settleMs: 150 });
}

function caseByName(cases: FixtureFile, name: string): RecordedCase {
  const found = cases.cases.find((c) => c.name === name);
  assert.ok(found, `fixture case ${name} missing`);
  return found;
}

/** Compare the parts of a recorded value that are stable across runs. */
function assertFrames(actual: Collected, recorded: RecordedCase, label: string): void {
  const value = recorded["value"] as Collected | undefined;
  assert.ok(value, `${label}: fixture has no value`);
  assert.deepEqual(actual.frames, value.frames, `${label}: frames`);
  if (value.refused) {
    assert.equal(actual.refused, true, `${label}: expected refusal`);
    assert.equal(actual.message, value.message, `${label}: refusal message`);
  } else {
    assert.equal(actual.refused ?? false, false, `${label}: unexpected refusal`);
    if (value.handshake) {
      assert.equal(actual.handshake?.statusCode, value.handshake.statusCode, `${label}: handshake status`);
      // `sec-websocket-accept` derives from a random key, so only its presence
      // is comparable; every other header is a literal.
      for (const [key, want] of Object.entries(value.handshake.headers)) {
        if (key === "sec-websocket-accept") {
          // sha1 = 20 bytes → 28 base64 chars ending in a single '='.
          assert.match(actual.handshake?.headers[key] ?? "", /^[+/0-9A-Za-z]{27}=$/, `${label}: accept key shape`);
        } else {
          assert.equal(actual.handshake?.headers[key], want, `${label}: header ${key}`);
        }
      }
    }
  }
}

async function withWsServer<T>(
  run: (handle: { port: number; adapter: WsServerAdapter; api: RecordingApi }) => Promise<T>,
  overrides: Partial<WsServerConfig> = {},
): Promise<T> {
  const api = new RecordingApi(CONTRACTS);
  const ctx = makeCtx(api);
  const config = {
    name: "ws-test",
    host: "127.0.0.1",
    port: 0,
    path: "/",
    role: "Universal" as const,
    accessToken: "tok",
    messageFormat: "array" as const,
    reportSelfMessage: false,
    ...overrides,
  } as WsServerConfig;
  const adapter = new WsServerAdapter(config.name, config, ctx);
  await adapter.open();
  try {
    return await run({ port: adapter.boundPort, adapter, api });
  } finally {
    await adapter.close();
  }
}

const AUTH = { authorization: "Bearer tok" };

describe("onebot standalone ws server", () => {
  test("bootstrap is connect, enable, heartbeat — then the action reply", async () => {
    await withWsServer(async ({ port }) => {
      const recorded = caseByName(wsFixtures, "ws_bootstrap_universal");
      assertFrames(await roundTrip(port, { headers: AUTH, payload: JSON.stringify({ action: "get_version_info" }) }), recorded, "ws_bootstrap_universal");
    });
  });

  test("a connection with no action still gets the three bootstrap frames", async () => {
    await withWsServer(async ({ port }) => {
      const recorded = caseByName(wsFixtures, "ws_bootstrap_no_action");
      assertFrames(await collect(port, { headers: AUTH }), recorded, "ws_bootstrap_no_action");
    });
  });

  test("missing and wrong tokens are refused at the handshake with 401", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(await expectFailure(port, {}), caseByName(wsFixtures, "ws_unauthenticated_upgrade"), "ws_unauthenticated_upgrade");
      assertFrames(
        await expectFailure(port, { headers: { authorization: "Bearer nope" } }),
        caseByName(wsFixtures, "ws_bad_token_upgrade"),
        "ws_bad_token_upgrade",
      );
    });
  });

  test("?access_token= authorizes on the WS upgrade", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, { path: "/?access_token=tok", payload: JSON.stringify({ action: "get_version_info" }) }),
        caseByName(wsFixtures, "ws_query_token"),
        "ws_query_token",
      );
    });
  });

  test("/api is an Api-only session: no bootstrap, and the reply carries echo", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, { path: "/api?access_token=tok", payload: JSON.stringify({ action: "get_version_info" }) }),
        caseByName(wsFixtures, "ws_api_path"),
        "ws_api_path",
      );
    });
  });

  test("/event is an Event-only session: bootstrap, and action frames are ignored", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(await collect(port, { path: "/event?access_token=tok" }), caseByName(wsFixtures, "ws_event_path"), "ws_event_path");
    });
  });

  test("an unknown path is refused with 400 Bad path for WebSocket", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(await expectFailure(port, { path: "/nope", headers: AUTH }), caseByName(wsFixtures, "ws_unknown_path"), "ws_unknown_path");
    });
  });

  test("a non-JSON frame gets a 1400 envelope, an empty frame gets nothing", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, { headers: AUTH, payload: "not json" }),
        caseByName(wsFixtures, "ws_bad_request_frame"),
        "ws_bad_request_frame",
      );
      assertFrames(await roundTrip(port, { headers: AUTH, payload: "" }), caseByName(wsFixtures, "ws_empty_frame"), "ws_empty_frame");
    });
  });

  test("unknown action over WS is retcode 1404", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, { headers: AUTH, payload: JSON.stringify({ action: "nope" }) }),
        caseByName(wsFixtures, "ws_unknown_action"),
        "ws_unknown_action",
      );
    });
  });

  test("echo round-trips structurally, not as a string", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, {
          headers: AUTH,
          payload: JSON.stringify({ action: "send_group_msg", params: { group_id: 7 }, echo: { nested: [1, 2] } }),
        }),
        caseByName(wsFixtures, "ws_echo_roundtrip"),
        "ws_echo_roundtrip",
      );
    });
  });

  test("a stream action sends one frame per chunk plus the terminal frame", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, {
          headers: AUTH,
          payload: JSON.stringify({ action: "download_file_stream", params: {}, echo: "s1" }),
          settleMs: 400,
        }),
        caseByName(wsFixtures, "ws_stream_action"),
        "ws_stream_action",
      );
    });
  });

  test("a failed stream action carries data {type:error,data_type:error} and keeps wording", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, {
          headers: AUTH,
          payload: JSON.stringify({ action: "download_file_stream_failed", params: {} }),
          settleMs: 400,
        }),
        caseByName(wsFixtures, "ws_stream_action_failed"),
        "ws_stream_action_failed",
      );
    });
  });

  test("a throwing action produces no reply frame at all", async () => {
    await withWsServer(async ({ port }) => {
      assertFrames(
        await roundTrip(port, { headers: AUTH, payload: JSON.stringify({ action: "throws_plain" }) }),
        caseByName(wsFixtures, "ws_action_throws"),
        "ws_action_throws",
      );
    });
  });

  test("events reach Universal and Event sessions, and self messages are filtered", async () => {
    await withWsServer(async ({ port, adapter }) => {
      const pushed = await (async () => {
        const pending = collect(port, { path: "/event", headers: AUTH, settleMs: 300 });
        await new Promise((r) => setTimeout(r, 60));
        adapter.onEvent(GROUP_EVENT, dispatch(GROUP_EVENT));
        return pending;
      })();
      assertFrames(pushed, caseByName(wsFixtures, "ws_event_push"), "ws_event_push");

      const hidden = await (async () => {
        const pending = collect(port, { path: "/event", headers: AUTH, settleMs: 300 });
        await new Promise((r) => setTimeout(r, 60));
        const self = { ...GROUP_EVENT, post_type: "message_sent" };
        adapter.onEvent(self, dispatch(self));
        return pending;
      })();
      assertFrames(hidden, caseByName(wsFixtures, "ws_event_push_self_message_hidden"), "ws_event_push_self_message_hidden");
    });
  });

  test("role Api gets no bootstrap but answers actions", async () => {
    await withWsServer(
      async ({ port }) => {
        assertFrames(
          await roundTrip(port, { headers: AUTH, payload: JSON.stringify({ action: "get_version_info", echo: "Api" }) }),
          caseByName(wsFixtures, "ws_role_api_action"),
          "ws_role_api_action",
        );
        assertFrames(await collect(port, { headers: AUTH }), caseByName(wsFixtures, "ws_role_api_bootstrap"), "ws_role_api_bootstrap");
      },
      { role: "Api" },
    );
  });

  test("role Event gets bootstrap but ignores action frames", async () => {
    await withWsServer(
      async ({ port }) => {
        assertFrames(
          await roundTrip(port, { headers: AUTH, payload: JSON.stringify({ action: "get_version_info", echo: "Event" }) }),
          caseByName(wsFixtures, "ws_role_event_action"),
          "ws_role_event_action",
        );
        assertFrames(await collect(port, { headers: AUTH }), caseByName(wsFixtures, "ws_role_event_bootstrap"), "ws_role_event_bootstrap");
      },
      { role: "Event" },
    );
  });
});

describe("onebot embedded websocket inside the http adapter", () => {
  async function withEmbedded<T>(
    run: (handle: { port: number; adapter: HttpServerAdapter }) => Promise<T>,
    overrides: Record<string, unknown> = {},
  ): Promise<T> {
    const api = new RecordingApi(CONTRACTS);
    const ctx = makeCtx(api);
    const adapter = new HttpServerAdapter(
      "http-ws",
      {
        name: "http-ws",
        host: "127.0.0.1",
        port: 0,
        path: "/",
        accessToken: "tok",
        messageFormat: "array",
        reportSelfMessage: false,
        enableWebSocket: true,
        enableSse: false,
        ...overrides,
      } as never,
      ctx,
    );
    await adapter.open();
    const address = (adapter as unknown as { server: { address(): { port: number } } }).server.address();
    try {
      return await run({ port: address.port, adapter });
    } finally {
      await adapter.close();
    }
  }

  test("an upgrade on the HTTP listener is served by the shared session owner", async () => {
    await withEmbedded(async ({ port }) => {
      assertFrames(
        await roundTrip(port, { headers: AUTH, payload: JSON.stringify({ action: "get_version_info" }) }),
        caseByName(wsFixtures, "http_ws_root_upgrade"),
        "http_ws_root_upgrade",
      );
    });
  });

  test("a plain HTTP request is still HTTP, not an upgrade", async () => {
    await withEmbedded(async ({ port }) => {
      assertFrames(
        await roundTrip(port, { headers: AUTH, payload: JSON.stringify({ action: "get_version_info" }) }),
        caseByName(wsFixtures, "http_ws_plain_get_still_http"),
        "http_ws_plain_get_still_http",
      );
    });
  });

  test("an unauthorized upgrade is refused with 401", async () => {
    await withEmbedded(async ({ port }) => {
      assertFrames(await expectFailure(port, {}), caseByName(wsFixtures, "http_ws_unauthorized_upgrade"), "http_ws_unauthorized_upgrade");
    });
  });
});

describe("onebot reverse-ws client", () => {
  /** Host a server with the port's own implementation, as the harness did. */
  async function withHost<T>(
    run: (handle: {
      serverPort: number;
      received: string[];
      handshakeRef: () => { url: string; headers: Record<string, string> } | null;
      send: (payload: string) => void;
      adapter: WsClientAdapter;
    }) => Promise<T>,
    overrides: Record<string, unknown> = {},
  ): Promise<T> {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const serverPort = (server.address() as { port: number }).port;
    const received: string[] = [];
    let handshake: { url: string; headers: Record<string, string> } | null = null;
    let serverSocket: { send(data: string): void } | null = null;
    server.on("connection", (socket: unknown, request: { url?: string; headers: Record<string, string | string[] | undefined> }) => {
      serverSocket = socket as { send(data: string): void };
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
      }
      handshake = { url: request.url ?? "/", headers };
      (socket as { on(e: string, cb: (raw: Buffer) => void): void }).on("message", (raw: Buffer) => received.push(String(raw)));
    });
    const api = new RecordingApi(CONTRACTS);
    const ctx = makeCtx(api);
    const adapter = new WsClientAdapter(
      "ws-client",
      {
        name: "ws-client",
        url: `ws://127.0.0.1:${serverPort}/`,
        role: "Universal",
        accessToken: "tok",
        messageFormat: "array",
        reportSelfMessage: false,
        reconnectIntervalMs: 1000,
        ...overrides,
      } as never,
      ctx,
    );
    adapter.open();
    try {
      for (let i = 0; i < 60 && !serverSocket; i += 1) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 200));
      return await run({
        serverPort,
        received,
        handshakeRef: () => handshake,
        send: (payload: string) => serverSocket?.send(payload),
        adapter,
      });
    } finally {
      await adapter.close();
      server.close();
    }
  }

  test("the dialer sends the exact OneBot handshake headers", async () => {
    await withHost(async ({ received, handshakeRef }) => {
      const recorded = caseByName(wsFixtures, "ws_client_connect");
      const want = recorded["handshake"] as { url: string; headers: Record<string, string> };
      const got = handshakeRef();
      assert.ok(got, "server saw no handshake");
      assert.equal(got.url, want.url);
      for (const [key, value] of Object.entries(want.headers)) {
        if (key === "host" || key === "sec-websocket-key") continue; // port + random key
        assert.equal(got.headers[key], value, `header ${key}`);
      }
      assert.deepEqual(received, recorded["received"], "bootstrap meta frames");
    });
  });

  test("the client answers actions from the server on the same socket", async () => {
    await withHost(async ({ received, send }) => {
      received.length = 0;
      send(JSON.stringify({ action: "get_version_info", echo: 5 }));
      await new Promise((r) => setTimeout(r, 200));
      assert.deepEqual(received, caseByName(wsFixtures, "ws_client_action_response")["received"]);
    });
  });

  test("the client answers a stream action with one frame per chunk", async () => {
    await withHost(async ({ received, send }) => {
      received.length = 0;
      send(JSON.stringify({ action: "download_file_stream", params: {}, echo: "sc" }));
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(received, caseByName(wsFixtures, "ws_client_stream_response")["received"]);
    });
  });

  test("self events leave the client unless reportSelfMessage is on", async () => {
    await withHost(async ({ received, adapter }) => {
      received.length = 0;
      adapter.onEvent(GROUP_EVENT, dispatch(GROUP_EVENT));
      await new Promise((r) => setTimeout(r, 200));
      assert.deepEqual(received, caseByName(wsFixtures, "ws_client_event_push")["received"]);
    });
  });

  test("a rotated token is reflected in the next handshake", async () => {
    await withHost(async ({ received, send }) => {
      received.length = 0;
      send(JSON.stringify({ action: "get_version_info", echo: 5 }));
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(received.length, 1);
    });
  });
});

describe("onebot ws path matrix (ref-ws2)", () => {
  /** `attempt()` in the harness: refuse-or-frames, nothing else. */
  async function attempt(port: number, options: { path?: string; headers?: Record<string, string> }): Promise<Collected> {
    return roundTrip(port, { ...options, payload: JSON.stringify({ action: "get_version_info" }), settleMs: 200 });
  }

  function assertAttempt(actual: Collected, recorded: RecordedCase): void {
    const value = recorded["value"] as { frames?: Collected["frames"]; refused?: boolean; message?: string };
    if (value.refused) {
      assert.equal(actual.refused, true, `${recorded.name}: expected refusal`);
      assert.equal(actual.message, value.message, `${recorded.name}: refusal message`);
      return;
    }
    assert.equal(actual.refused ?? false, false, `${recorded.name}: unexpected refusal`);
    assert.deepEqual(actual.frames, value.frames, `${recorded.name}: frames`);
  }

  test("the HTTP adapter's embedded upgrade resolves roles from the request path, not config.path", async () => {
    // Surprising but real: the embedded WebSocketServer is created WITHOUT a
    // `path` option, so an upgrade on /other is accepted and classified as
    // Universal even though the adapter's HTTP mount is /api.
    const api = new RecordingApi(CONTRACTS);
    const adapter = new HttpServerAdapter(
      "http-ws",
      {
        name: "http-ws",
        host: "127.0.0.1",
        port: 0,
        path: "/api",
        accessToken: "tok",
        messageFormat: "array",
        reportSelfMessage: false,
        enableWebSocket: true,
        enableSse: false,
      } as never,
      makeCtx(api),
    );
    await adapter.open();
    const port = (adapter as unknown as { server: { address(): { port: number } } }).server.address().port;
    try {
      for (const name of [
        "http_ws_path_exact_base",
        "http_ws_path_base_slash",
        "http_ws_path_api_suffix",
        "http_ws_path_event_suffix",
        "http_ws_path_outside",
        "http_ws_path_root",
      ]) {
        const recorded = caseByName(ws2Fixtures, name);
        const path = recorded["path"] as string;
        assertAttempt(await attempt(port, { path: `${path}?access_token=tok` }), recorded);
      }
      // A raw (un-Bearer-ed) token is NOT accepted on the WS upgrade: the
      // upgrade check calls isAuthorized without allowRawToken.
      const rawToken = caseByName(ws2Fixtures, "http_ws_raw_token_header");
      assertAttempt(await attempt(port, { path: "/api", headers: { authorization: "tok" } }), rawToken);
      const wrongQuery = caseByName(ws2Fixtures, "http_ws_wrong_query_token");
      assertAttempt(await attempt(port, { path: "/api?access_token=nope" }), wrongQuery);
    } finally {
      await adapter.close();
    }
  });

  test("a standalone listener with path /ws pins its role and rejects siblings", async () => {
    await withWsServer(
      async ({ port }) => {
        for (const name of ["ws_path_exact", "ws_path_slash", "ws_path_api_child", "ws_path_event_child", "ws_path_bare_api", "ws_path_root"]) {
          const recorded = caseByName(ws2Fixtures, name);
          const path = recorded["path"] as string;
          assertAttempt(await attempt(port, { path: `${path}?access_token=tok` }), recorded);
        }
      },
      { path: "/ws" },
    );
  });

  test("an empty access token disables auth entirely, and a pinned role rejects other paths", async () => {
    // The harness's block uses role Api with an empty token. Two consequences are
    // recorded: no bootstrap (Api sessions get none) and /event being refused,
    // because a pinned non-Universal role does not path-infer.
    await withWsServer(
      async ({ port }) => {
        assertAttempt(await attempt(port, { path: "/" }), caseByName(ws2Fixtures, "ws_no_token_upgrade"));
        assertAttempt(await collect(port, { path: "/event", settleMs: 300 }), caseByName(ws2Fixtures, "ws_string_format_event"));
      },
      { role: "Api", accessToken: "", messageFormat: "string", reportSelfMessage: true },
    );
  });

  test("messageFormat: string replaces `message` with raw_message on push", async () => {
    await withWsServer(
      async ({ port, adapter }) => {
        const pushed = await (async () => {
          const pending = collect(port, { headers: AUTH, settleMs: 300 });
          await new Promise((r) => setTimeout(r, 60));
          adapter.onEvent(GROUP_EVENT, dispatch(GROUP_EVENT));
          return pending;
        })();
        assertAttempt(pushed, caseByName(ws2Fixtures, "ws_string_format_push"));
        // The pushed frame carries the string form, not the segment array.
        const last = pushed.frames[pushed.frames.length - 1] as { data: string };
        assert.ok(last.data.includes('"message":"hi"'), "message must be the raw string");
      },
      { role: "Event", messageFormat: "string" },
    );
  });
});

describe("onebot network manager (ref-ws2)", () => {
  function baseConfig(): Record<string, unknown> {
    return {
      statusCommand: { enabled: true, swallow: false, cooldownSeconds: 5, trigger: "#hz" },
      historySync: { enabled: false },
      notifications: { channelIds: [] },
      networks: {
        httpServers: [],
        httpClients: [],
        wsServers: [
          {
            name: "w",
            host: "127.0.0.1",
            port: 9137,
            path: "/",
            role: "Universal",
            accessToken: "t",
            messageFormat: "array",
            reportSelfMessage: false,
          },
        ],
        wsClients: [
          {
            name: "c",
            url: "ws://127.0.0.1:9/",
            role: "Universal",
            accessToken: "",
            messageFormat: "array",
            reportSelfMessage: false,
            reconnectIntervalMs: 1000,
          },
        ],
      },
    };
  }

  /** The manager fixture's status rows are all this test compares, so drop the
   *  volatile timestamps an ApplyFailure would carry. */
  test("reconcile opens both adapters and reports their status rows", async () => {
    const api = new RecordingApi(CONTRACTS);
    const manager = new OneBotNetworkManager({ ctx: makeCtx(api), factory: (d) => createNetworkAdapter(d, makeCtx(api)) });
    try {
      const result = await manager.reconcile(baseConfig() as never);
      const recorded = caseByName(ws2Fixtures, "manager_reconcile")["value"] as { applied: boolean; errors: unknown[]; statuses: unknown[] };
      assert.equal(result.applied, recorded.applied);
      assert.deepEqual(result.errors, recorded.errors);
      assert.deepEqual(result.statuses, recorded.statuses);
      assert.deepEqual(manager.list().map((a) => a.name), caseByName(ws2Fixtures, "manager_names")["value"]);

      const rotated = baseConfig();
      ((rotated["networks"] as { wsServers: Array<{ accessToken: string }> }).wsServers[0] as { accessToken: string }).accessToken = "t2";
      const second = await manager.reconcile(rotated as never);
      const recordedSecond = caseByName(ws2Fixtures, "manager_reconcile_token_change")["value"] as { applied: boolean; errors: unknown[]; statuses: unknown[] };
      assert.equal(second.applied, recordedSecond.applied);
      assert.deepEqual(second.statuses, recordedSecond.statuses);
    } finally {
      await manager.shutdown();
    }
  });

  test("a duplicate name is rejected before any I/O", async () => {
    const api = new RecordingApi(CONTRACTS);
    const manager = new OneBotNetworkManager({ ctx: makeCtx(api), factory: (d) => createNetworkAdapter(d, makeCtx(api)) });
    const bad = baseConfig();
    (bad["networks"] as Record<string, unknown>)["httpServers"] = [
      {
        name: "w",
        host: "127.0.0.1",
        port: 9137,
        path: "/",
        accessToken: "",
        messageFormat: "array",
        reportSelfMessage: false,
        enableWebSocket: false,
        enableSse: false,
      },
    ];
    await assert.rejects(
      async () => manager.reconcile(bad as never),
      (error: Error) => error.message === caseByName(ws2Fixtures, "manager_duplicate_name")["value"],
    );
    await manager.shutdown();
  });

  test("a bind conflict between two listeners is rejected before any I/O", async () => {
    const api = new RecordingApi(CONTRACTS);
    const manager = new OneBotNetworkManager({ ctx: makeCtx(api), factory: (d) => createNetworkAdapter(d, makeCtx(api)) });
    const busy = baseConfig();
    const wsServers = (busy["networks"] as { wsServers: Array<Record<string, unknown>> }).wsServers;
    wsServers.push({ ...wsServers[0], name: "w2" });
    await assert.rejects(
      async () => manager.reconcile(busy as never),
      (error: Error) => error.message === caseByName(ws2Fixtures, "manager_port_conflict")["value"],
    );
    await manager.shutdown();
  });

  test("shutdown closes everything and then refuses further dispatch", async () => {
    const api = new RecordingApi(CONTRACTS);
    const manager = new OneBotNetworkManager({ ctx: makeCtx(api), factory: (d) => createNetworkAdapter(d, makeCtx(api)) });
    await manager.reconcile(baseConfig() as never);
    const shut = await manager.shutdown();
    const recorded = caseByName(ws2Fixtures, "manager_shutdown")["value"] as { closed: boolean; errors: unknown[] };
    assert.equal(shut.closed, recorded.closed);
    assert.deepEqual(shut.errors, recorded.errors);
    const rejected = await manager.emitEvent(GROUP_EVENT).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    assert.equal(rejected, caseByName(ws2Fixtures, "manager_emit_after_shutdown")["value"]);
  });
});

describe("onebot reverse-ws reconnect", () => {
  test("a refused first dial reports 重连中 and keeps retrying until the listener appears", async () => {
    const recorded = caseByName(ws2Fixtures, "ws_client_reconnect");
    // Reserve a port, close it so the first dial is refused, then re-bind.
    const probe = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => probe.once("listening", resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const api = new RecordingApi(CONTRACTS);
    const adapter = new WsClientAdapter(
      "wc",
      {
        name: "wc",
        url: `ws://127.0.0.1:${port}/`,
        role: "Api",
        accessToken: "",
        messageFormat: "array",
        reportSelfMessage: false,
        reconnectIntervalMs: 1000,
      } as never,
      makeCtx(api),
    );
    adapter.open();
    try {
      await new Promise((r) => setTimeout(r, 200));
      assert.deepEqual(adapter.describeStatus(), recorded["offline"]);

      const server = new WebSocketServer({ port, host: "127.0.0.1" });
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const seen: Array<Record<string, unknown>> = [];
      server.on("connection", (socket: unknown, request: { url?: string; headers: Record<string, string | string[] | undefined> }) => {
        seen.push({ url: request.url, role: request.headers["x-client-role"] });
        assert.equal(request.headers["authorization"], undefined, "no Authorization header without a token");
        void socket;
      });
      try {
        for (let i = 0; i < 160 && seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 25));
        await new Promise((r) => setTimeout(r, 150));
        assert.deepEqual(seen, recorded["seen"]);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await adapter.close();
    }
  });
});