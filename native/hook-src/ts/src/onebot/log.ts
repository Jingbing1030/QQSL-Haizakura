// Logger for the OneBot network layer.
//
// Reference regions:
//   ../common/src/request-context.ts L1388-L1416  AsyncLocalStorage request id
//   ../common/src/logger.ts          L1424-L1572  levels, render(), emit(), child()
//
// The transports are chatty (`[%s] listening %s:%d%s%s`, `[%s] socket error:
// %s`, …) and some of those lines are the only observable evidence for a
// decision, so the port keeps the same surface — including the `[req#N]`
// ambient correlation tag that `runWithTraceRequest` installs around every
// inbound HTTP request (L1562).
//
// Divergence, deliberate: the reference's ring buffers, file transport,
// redaction and ANSI styling all belong to the desktop app's log viewer
// (`getLogSnapshot`, `subscribeLogs`, `logger.jsonl`). None of that is
// observable on the OneBot wire, so the port keeps the message pipeline
// (printf formatting + ambient request id + child uin tag) and leaves
// persistence to the host application via `setLogSink`.

import { AsyncLocalStorage } from "node:async_hooks";
import { format as nodeFormat } from "node:util";
import { readEnvAlias } from "../bridge/env.js";

export type LogLevel = "trace" | "debug" | "info" | "success" | "warn" | "error";

/** L1577 `LEVEL_WEIGHT`. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 5,
  debug: 10,
  info: 20,
  success: 25,
  warn: 30,
  error: 40,
};

/** L1585 `LEVEL_LABEL`. */
const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  success: "OK",
  warn: "WARN",
  error: "ERROR",
};

/** L1576 `UIN_SLOT_WIDTH` — the fixed-width column the desktop UI aligns on. */
const UIN_SLOT_WIDTH = 12;

const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "success", "warn", "error"];

/** One emitted record, in the shape a `setLogSink` consumer receives. */
export interface LogEntry {
  level: LogLevel;
  scope: string;
  uin?: number;
  req?: number;
  message: string;
  line: string;
  time: string;
}

export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  success(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(meta: { uin?: number }): Logger;
}

export type LogSink = (entry: LogEntry) => void;

let currentLevel: LogLevel = resolveMinLevel();
let sink: LogSink | null = null;
let nextReqId = 0;

const requestStorage = new AsyncLocalStorage<{ id: number }>();

function resolveMinLevel(): LogLevel {
  const raw = (readEnvAlias("LOG_LEVEL") ?? "info").toLowerCase();
  if ((LOG_LEVELS as string[]).includes(raw)) return raw as LogLevel;
  return "info";
}

/** L1443 `shouldLog`. */
function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel];
}

/** L1457 `getLogLevel` / L1460 `setLogLevel` (returns false for a bad name). */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function setLogLevel(level: string): boolean {
  const lower = String(level).toLowerCase();
  if (!(LOG_LEVELS as string[]).includes(lower)) return false;
  currentLevel = lower as LogLevel;
  return true;
}

/**
 * Redirect emitted records. `null` restores the console default. The OneBot
 * transports never call this; it exists so a host (or a test) can capture the
 * exact lines the reference would have printed.
 */
export function setLogSink(next: LogSink | null): void {
  sink = next;
}

/** L1407 `currentRequestId`. */
function currentRequestId(): number | undefined {
  return requestStorage.getStore()?.id;
}

/**
 * L1562 `runWithTraceRequest`: bind a fresh request id for the whole async
 * chain, but only when tracing is on and no id is already bound — otherwise a
 * nested call would double-tag the line.
 */
export function runWithTraceRequest<T>(fn: () => T): T {
  if (currentRequestId() !== undefined || currentLevel !== "trace") return fn();
  nextReqId += 1;
  return requestStorage.run({ id: nextReqId }, fn);
}

/** L1463 `currentTime` — local wall clock, second precision. */
function currentTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** L1470 `render`, minus the ANSI branch (`useColor()` needs a TTY). */
function render(level: LogLevel, options: { scope: string; uin?: number }, message: string, reqId?: number): string {
  const ts = currentTime();
  const label = LEVEL_LABEL[level].padEnd(5, " ");
  const uinTag = options.uin !== undefined ? `[${options.uin}]` : "";
  const uinSlot = uinTag.padEnd(UIN_SLOT_WIDTH);
  const reqTag = reqId !== undefined ? `[req#${reqId}]` : "";
  return `${ts} ${label} ${uinSlot} [${options.scope}] ${reqTag ? `${reqTag} ` : ""}${message}`;
}

/** L1483 `emit`. */
function emit(level: LogLevel, options: { scope: string; uin?: number }, args: unknown[]): void {
  if (!shouldLog(level)) return;
  // A trace thunk is only evaluated when trace output is actually enabled.
  const realArgs = level === "trace" && args.length === 1 && typeof args[0] === "function" ? (args[0] as () => unknown[])() : args;
  const reqId = currentRequestId();
  const message = nodeFormat(...(realArgs as [unknown, ...unknown[]]));
  const entry: LogEntry = {
    level,
    scope: options.scope,
    ...(options.uin !== undefined ? { uin: options.uin } : {}),
    ...(reqId !== undefined ? { req: reqId } : {}),
    message,
    line: render(level, options, message, reqId),
    time: new Date().toISOString(),
  };
  if (sink) {
    sink(entry);
    return;
  }
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  try {
    stream.write(`${entry.line}\n`);
  } catch {
    /* a closed stdout must not take the transport down */
  }
}

/** L1544 `makeLogger`. */
function makeLogger(options: { scope: string; uin?: number }): Logger {
  return {
    trace: (...args) => emit("trace", options, args),
    debug: (...args) => emit("debug", options, args),
    info: (...args) => emit("info", options, args),
    success: (...args) => emit("success", options, args),
    warn: (...args) => emit("warn", options, args),
    error: (...args) => emit("error", options, args),
    child: (meta) => makeLogger({ ...options, ...(typeof meta.uin === "number" ? { uin: meta.uin } : {}) }),
  };
}

/** L1569 `createLogger`. */
export function createLogger(scope: string): Logger {
  return makeLogger({ scope });
}

/** L1572 `errorMessage` (defined L88): never returns undefined, never throws. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}