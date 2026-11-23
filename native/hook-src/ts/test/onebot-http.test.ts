// Replay the reference HTTP fixtures against the TypeScript HttpServerAdapter.
//
// Every case here was recorded by driving the reference bundle's own adapter
// over a real socket (work/onebot-net/probe/harness-http.mjs). The assertions
// are exact: status, the stable subset of headers, the byte-for-byte body, and
// the `(action, params)` the transport handed the action layer — which is what
// pins query JSON-parsing, the body/`params` split, form decoding and `echo`
// extraction.
//
// One assertion differs from the reference *on purpose and is documented here*:
// see "port divergence: bad request wording" at the end of this file.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import http from "node:http";

import { HttpServerAdapter, type HttpServerConfig } from "../src/onebot/http.js";
import { RecordingApi, CONTRACTS, fixture, makeCtx, stableHeaders, type FixtureFile, type RecordedCase } from "./onebot-harness.js";

const http_ = fixture<FixtureFile>("ref-http.json");

interface Server {
  adapter: HttpServerAdapter;
  api: RecordingApi;
  port: number;
  config: HttpServerConfig;
}

const AUTH = { authorization: "Bearer tok" };

function config(overrides: Partial<HttpServerConfig> = {}): HttpServerConfig {
  return {
    name: "http-test",
    host: "127.0.0.1",
    port: 0,
    path: "/",
    accessToken: "tok",
    messageFormat: "array",
    reportSelfMessage: false,
    enableWebSocket: false,
    enableSse: false,
    ...overrides,
  } as HttpServerConfig;
}

async function start(overrides: Partial<HttpServerConfig> = {}): Promise<Server> {
  const api = new RecordingApi(CONTRACTS);
  const ctx = makeCtx(api);
  const cfg = config(overrides);
  const adapter = new HttpServerAdapter("http-test", cfg, ctx);
  await adapter.open();
  const address = (adapter as unknown as { server: { address(): { port: number } } }).server.address();
  return { adapter, api, port: address.port, config: cfg };
}

function request(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const { method = "GET", path = "/", headers = {}, body } = options;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: stableHeaders(res.headers), body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Read an SSE stream until it goes quiet, mirroring the harness. */
function readSse(
  port: number,
  options: { path?: string; headers?: Record<string, string>; untilBytes?: number; quietMs?: number } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const { path = "/_events", headers = {}, untilBytes = 4096, quietMs = 400 } = options;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "GET", path, headers }, (res) => {
      let body = "";
      let timer: NodeJS.Timeout | undefined;
      const done = () => {
        clearTimeout(timer);
        req.destroy();
        // Raw headers: an SSE response sets `Connection: keep-alive` explicitly,
        // so it is a real signal here even though Node synthesizes it elsewhere.
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        resolve({ status: res.statusCode ?? 0, headers, body });
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(done, quietMs);
      };
      arm();
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (body.length >= untilBytes) return done();
        arm();
      });
      res.on("end", done);
      res.on("error", (err: Error & { code?: string }) => {
        if (err.code !== "ECONNRESET") reject(err);
      });
    });
    req.on("error", (err: Error & { code?: string }) => {
      if (err.code !== "ECONNRESET") reject(err);
    });
    req.end();
  });
}

function caseByName(name: string): RecordedCase {
  const found = http_.cases.find((c) => c.name === name);
  assert.ok(found, `fixture case ${name} missing`);
  return found;
}

/** Compare one response against its recording; returns the response too. */
function assertMatches(actual: { status: number; headers: Record<string, string>; body: string }, recorded: RecordedCase): void {
  assert.equal(actual.status, recorded.status, `${recorded.name}: status`);
  const wantsContentType = recorded.headers?.["content-type"];
  if (wantsContentType !== undefined) {
    assert.equal(actual.headers["content-type"], wantsContentType, `${recorded.name}: content-type`);
  }
  assert.equal(actual.body, recorded.body, `${recorded.name}: body`);
}

describe("onebot http adapter — recorded reference responses", () => {
  let main: Server;

  before(async () => {
    main = await start();
  });

  after(async () => {
    await main.adapter.close();
  });

  /** Run one plain request and assert the recording, including traced params. */
  async function replay(
    name: string,
    options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
    server: Server = main,
  ): Promise<void> {
    const recorded = caseByName(name);
    server.api.reset();
    const actual = await request(server.port, options);
    assertMatches(actual, recorded);
    if (recorded.params) {
      assert.deepEqual(server.api.trace, recorded.params, `${name}: action params`);
    }
  }

  test("GET / answers the online probe", async () => {
    await replay("get_root", { headers: AUTH });
  });

  test("missing, wrong and raw tokens", async () => {
    await replay("get_root_no_auth", {});
    await replay("get_root_bad_auth", { headers: { authorization: "Bearer nope" } });
    // Raw token in Authorization is accepted on the HTTP API (allowRawToken).
    await replay("get_root_raw_token_header", { headers: { authorization: "tok" } });
  });

  test("query-parameter token, and a wrong one next to a valid header", async () => {
    await replay("get_root_query_token", { path: "/?access_token=tok" });
    await replay("get_root_wrong_query_token", { path: "/?access_token=nope", headers: AUTH });
  });

  test("GET action decodes query params with per-value JSON.parse", async () => {
    await replay("get_action_query_params", {
      path: "/get_login_info?user_id=10001&flag=true&text=hello&bad=%7Bnotjson",
      headers: AUTH,
    });
  });

  test("unknown action is a 200 with retcode 1404", async () => {
    await replay("get_unknown_action", { path: "/no_such_action", headers: AUTH });
  });

  test("an action without auth is 401 before dispatch", async () => {
    await replay("get_action_missing_auth", { path: "/get_login_info" });
  });

  test("traceparent is accepted for logging but not trusted as a request id", async () => {
    await replay("get_root_with_traceparent", {
      headers: { ...AUTH, traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" },
    });
    await replay("get_root_with_bad_traceparent", { headers: { ...AUTH, traceparent: "zz-nope" } });
  });

  test("POST JSON with params", async () => {
    await replay("post_json_action", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ action: "send_group_msg", params: { group_id: 7, message: "hi" }, echo: "e1" }),
    });
  });

  test("POST JSON without params keeps `action` inside the params object", async () => {
    await replay("post_json_no_params", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ action: "get_version_info" }),
    });
    await replay("post_json_flat_params", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ action: "get_login_info", user_id: 42 }),
    });
  });

  test("action in the path wins, params and echo come from the body", async () => {
    await replay("post_action_in_path_json_body", {
      method: "POST",
      path: "/send_group_msg",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ params: { group_id: 1 }, echo: 17 }),
    });
  });

  test("malformed / array / null / empty JSON bodies", async () => {
    await replay("post_json_invalid", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "{not json",
    });
    await replay("post_json_array_body", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "[1,2,3]",
    });
    await replay("post_json_null_body", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "null",
    });
    await replay("post_json_empty_body", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "",
    });
  });

  test("form-encoded bodies JSON-parse each value", async () => {
    await replay("post_form_action", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/x-www-form-urlencoded" },
      body: "action=send_group_msg&group_id=7&message=%5B%7B%22type%22%3A%22text%22%7D%5D&echo=form1",
    });
    await replay("post_form_numeric_string", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/x-www-form-urlencoded" },
      body: "action=get_login_info&user_id=10001&flag=false",
    });
  });

  test("unsupported content-type is rejected, but a missing one is not", async () => {
    await replay("post_unsupported_content_type", {
      method: "POST",
      headers: { ...AUTH, "content-type": "text/plain" },
      body: "action=get_login_info",
    });
    await replay("post_no_content_type_valid_json", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ action: "get_login_info" }),
    });
  });

  test("a body with neither action nor action-in-path is 400", async () => {
    await replay("post_missing_action", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ params: { a: 1 } }),
    });
  });

  test("PUT and DELETE are 405 method not allowed", async () => {
    await replay("put_root", { method: "PUT", headers: AUTH });
    await replay("delete_action", { method: "DELETE", path: "/get_login_info", headers: AUTH });
  });

  test("an off-prefix path keeps the leftover segment as the action name", async () => {
    // The reference computes the action by substring, not by rejecting.
    await replay("get_wrong_path_prefix", { path: "/nope/get_login_info", headers: AUTH });
  });

  test("stream action returns ordered chunk and terminal envelopes over HTTP", async () => {
    const echo = { request_id: "stream-echo-1" };
    const frames = Array.from({ length: 10 }, (_, index) => ({
      type: "stream",
      data_type: "data",
      index,
      payload: `chunk-${index}`,
    }));
    const terminal = { status: "ok" as const, retcode: 0, data: { type: "response", chunks: 10 } };
    const streamApi = new RecordingApi({
      test_download_stream: { kind: "stream", frames, terminal },
    });
    const streamConfig = config();
    const adapter = new HttpServerAdapter("http-stream-test", streamConfig, makeCtx(streamApi));
    await adapter.open();
    const address = (adapter as unknown as { server: { address(): { port: number } } }).server.address();
    try {
      const actual = await request(address.port, {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ action: "test_download_stream", params: { seed: 42 }, echo }),
      });
      assert.equal(actual.status, 200);
      assert.ok(!(actual.headers["content-type"] ?? "").includes("application/json"));
      const rawFrames = actual.body.split("\r\n\r\n");
      assert.equal(rawFrames.at(-1), "", "body ends with the frame delimiter");
      const decoded = rawFrames.slice(0, -1).map((frame) => JSON.parse(frame) as Record<string, unknown>);
      const want = [
        ...frames.map((data) => ({
          status: "ok",
          retcode: 0,
          data,
          message: "",
          wording: "",
          stream: "stream-action",
          echo,
        })),
        { ...terminal, stream: "stream-action", echo, message: "", wording: "" },
      ];
      assert.equal(decoded.length, 11, "10 chunks and one terminal frame");
      assert.deepEqual(decoded, want);
      assert.deepEqual(streamApi.trace, [{ call: "handle", action: "test_download_stream", params: { seed: 42 } }]);
    } finally {
      await adapter.close();
    }
  });

  test("failed action envelopes keep retcode 100 and its wording verbatim", async () => {
    await replay("post_action_failed_envelope", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ action: "send_msg_failed", params: {}, echo: "e2" }),
    });
  });

  test("a throwing action becomes 500 / retcode 1200 with the raw message", async () => {
    await replay("post_action_throws", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ action: "throws_plain" }),
    });
  });

  test("SSE is 404 unless enabled", async () => {
    await replay("post_sse_disabled", { path: "/_events", headers: AUTH });
  });

  test("echo from a query parameter", async () => {
    await replay("get_action_with_echo_query_only", { path: "/get_login_info?echo=7", headers: AUTH });
  });

  test("a quiesced instance answers 503 server closing and traces the action", async () => {
    main.api.setAccepting(false);
    try {
      await replay("get_root_quiesced", { headers: AUTH });
      await replay("post_action_quiesced", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ action: "get_login_info" }),
      });
    } finally {
      main.api.setAccepting(true);
    }
    await replay("get_root_after_unquiesce", { headers: AUTH });
  });

  test("path prefix mounts: /api, /api/, /api/<action>, and a bare /", async () => {
    const pref = await start({ path: "/api" });
    try {
      const cases: Array<[string, { path: string }]> = [
        ["prefix_root", { path: "/api" }],
        ["prefix_root_slash", { path: "/api/" }],
        ["prefix_action", { path: "/api/get_login_info" }],
        ["prefix_bare_root", { path: "/" }],
        ["prefix_events_path", { path: "/api/_events" }],
      ];
      for (const [name, options] of cases) {
        const recorded = caseByName(name);
        pref.api.reset();
        const actual = await request(pref.port, { ...options, headers: AUTH });
        assertMatches(actual, recorded);
        if (recorded.params) assert.deepEqual(pref.api.trace, recorded.params, `${name}: params`);
      }
    } finally {
      await pref.adapter.close();
    }
  });
});

describe("onebot http adapter — SSE event stream", () => {
  let server: Server;

  before(async () => {
    server = await start({ enableSse: true });
  });

  after(async () => {
    await server.adapter.close();
  });

  const ev1 = {
    time: 1700000000,
    self_id: 10001,
    post_type: "message",
    message_type: "group",
    group_id: 7,
    user_id: 8,
    message_id: 9,
    message: [{ type: "text", data: { text: "hi" } }],
    raw_message: "hi",
    sub_type: "normal",
  };
  const ev2 = {
    ...ev1,
    message_id: 10,
    post_type: "message_sent",
    message: [{ type: "text", data: { text: "self" } }],
    raw_message: "self",
  };

  /** The reference's `sseConnections.epoch`; a random uuidv4 per generation. */
  function epoch(): string {
    return (server.adapter as unknown as { sseConnections: { epoch: string } }).sseConnections.epoch;
  }

  test("the initial frame is retry: 3000 then the three bootstrap meta events", async () => {
    const recorded = caseByName("sse_stream");
    const actual = await readSse(server.port, { headers: AUTH });
    assert.equal(actual.status, recorded.status);
    for (const [key, value] of Object.entries(recorded.headers ?? {})) {
      assert.equal(actual.headers[key], value, `sse_stream: ${key}`);
    }
    // Ids carry a fresh uuid epoch, so compare the shape and the payloads.
    const want = (recorded.body as string).replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
    const got = actual.body.replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
    assert.equal(got, want);
    assert.match(actual.body, /^retry: 3000\n\n/);
    assert.equal((actual.body.match(/data: /g) ?? []).length, 3, "three bootstrap frames");
  });

  test("an event advances the sequence, and a self message is replayed only when allowed", async () => {
    const recorded = caseByName("sse_stream");
    server.adapter.onEvent(ev1, dispatchOf(ev1));
    // Half the path via the adapter, half straight at the connection set: the
    // reference exercises both seams and they must agree.
    (server.adapter as unknown as { sseConnections: { onEvent(p: unknown): void } }).sseConnections.onEvent(dispatchOf(ev2));
    const actual = await readSse(server.port, { headers: AUTH });
    const want = (recorded.afterEvent as { body: string }).body.replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
    const got = actual.body.replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
    assert.equal(got, want);
    // `reportSelfMessage: false`, so ev2 never entered the history.
    assert.ok(!actual.body.includes('"message_sent"'), "self message must be suppressed");
  });

  test("Last-Event-ID replays after the cursor", async () => {
    const recorded = caseByName("sse_stream");
    const replay = await readSse(server.port, { headers: { ...AUTH, "last-event-id": `${epoch()}:1` } });
    const want = (recorded.replay as { body: string }).body.replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
    const got = replay.body.replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
    assert.equal(got, want);
  });

  test("a malformed, foreign-epoch or future cursor is rejected", async () => {
    for (const name of ["sse_bad_last_event_id", "sse_unavailable_epoch"]) {
      const recorded = caseByName(name);
      const cursor = name === "sse_bad_last_event_id" ? "garbage" : "00000000-0000-4000-8000-000000000000:1";
      const actual = await readSse(server.port, { headers: { ...AUTH, "last-event-id": cursor } });
      assert.equal(actual.status, recorded.status, `${name}: status`);
      assert.equal(actual.body, recorded.body, `${name}: body`);
    }
    const future = caseByName("sse_future_sequence");
    const actual = await readSse(server.port, { headers: { ...AUTH, "last-event-id": `${epoch()}:999` } });
    assert.equal(actual.status, future.status);
    assert.equal(actual.body, future.body);
  });

  test("POST /_events is 405 with Allow: GET", async () => {
    const recorded = caseByName("sse_post_events");
    const actual = await request(server.port, { method: "POST", path: "/_events", headers: AUTH });
    assert.equal(actual.status, recorded.status);
    assert.equal(actual.headers["allow"], "GET");
    assert.equal(actual.body, recorded.body);
  });

  test("SSE still requires auth", async () => {
    const recorded = caseByName("sse_unauthorized");
    const actual = await request(server.port, { path: "/_events" });
    assert.equal(actual.status, recorded.status);
    assert.equal(actual.body, recorded.body);
  });

  test("replay from 0 and from 1 are byte-identical to the reference", async () => {
    for (const [name, cursor] of [
      ["sse_replay_from_1", `${1}`],
      ["sse_replay_from_0", `${0}`],
    ] as const) {
      const recorded = caseByName(name);
      const actual = await readSse(server.port, { headers: { ...AUTH, "last-event-id": `${epoch()}:${cursor}` } });
      assert.equal(actual.status, recorded.status, `${name}: status`);
      const want = (recorded.body as string).replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
      const got = actual.body.replace(/id: [0-9a-f-]{36}:(\d+)/g, "id: <epoch>:$1");
      assert.equal(got, want, `${name}: body`);
    }
  });
});

/** buildDispatchPayload as the manager computes it (event-filter L339452). */
function dispatchOf(event: Record<string, unknown>): { isSelfMessage: boolean; arrayJson: string; stringJson: string } {
  const isSelfMessage = event["post_type"] === "message_sent";
  const arrayJson = JSON.stringify(event);
  let stringJson = arrayJson;
  if ((event["post_type"] === "message" || event["post_type"] === "message_sent") && Array.isArray(event["message"])) {
    const raw = typeof event["raw_message"] === "string" ? (event["raw_message"] as string) : "";
    stringJson = JSON.stringify({ ...event, message: raw });
  }
  return { isSelfMessage, arrayJson, stringJson };
}