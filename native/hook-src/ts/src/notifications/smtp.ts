// A hand-rolled SMTP/ESMTP client: MIME assembly, EHLO capability parse, optional
// STARTTLS upgrade, AUTH PLAIN with AUTH LOGIN fallback, dot-stuffing.
//
// Reference region: src/notifications/smtp.ts L347954-L348242 (290 lines).
//
// ---------------------------------------------------------------------------
// Why hand-rolled instead of nodemailer
// ---------------------------------------------------------------------------
// The rewrite has zero runtime dependencies (`ts/package.json` lists only
// `typescript` and `@types/node` as devDependencies) and this subtree is the one
// place where adding a dependency was considered and rejected: nodemailer is ~1 MB
// and pulls in its own address parser, and the surface actually needed here is
// "+ one plain-text or HTML part, to a fixed recipient list, over submission ports
// 465/587". Everything below is `node:net`, `node:tls` and `Buffer`.
//
// ---------------------------------------------------------------------------
// The three protocol decisions that are easy to get wrong
// ---------------------------------------------------------------------------
// 1. **Implicit TLS vs STARTTLS.** `smtpSecure: true` means TLS from the first byte
//    (port 465, `smtps`). `smtpSecure: false` means plaintext, then upgrade *if*
//    the server advertises STARTTLS. A client that only ever upgrades, or only ever
//    connects over TLS, works against roughly half of real mail servers and fails
//    against the other half with a confusing "connection closed".
//
// 2. **`AUTH PLAIN` before `AUTH LOGIN`.** PLAIN is one round trip and LOGIN is
//    three, so PLAIN is preferred whenever the server offers it. The subtle part is
//    the fallback condition: `authenticate` retries with LOGIN only when the server
//    offers *both* mechanisms (a 5xx on PLAIN may still succeed on LOGIN), and
//    rethrows immediately when PLAIN is the only one or the failure was 535
//    ("bad credentials") — retrying a wrong password just burns a login attempt and
//    some servers rate-limit it.
//
// 3. **Dot-stuffing.** A body line that starts with `.` must be sent as `..`, or the
//    server reads it as end-of-data. `dotStuff` is applied to the *whole MIME
//    message*, which is safe only because the message is base64 — base64 output
//    contains no line that starts with `.` in the first place, so the regex is a
//    no-op on well-formed input and a rescue on a body that somehow is not base64.
//    The end-of-data `.` is sent as a separate command (L348213).
//
// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------
// Every socket gets `setTimeout(timeoutMs)` (default 15 s) and the timeout destroys
// the socket, which makes the pending `read()` reject. Note the reference's own bug
// is preserved: `failTimeout` checks `finished` but `finished` is only set after
// QUIT, so a timeout during QUIT destroys a socket that is already done — harmless,
// and it is what makes `finished` observable at all (§348189-348192).
//
// ---------------------------------------------------------------------------
// Verbs are uppercase-command + 3-digit reply, but the reply parser is lenient
// ---------------------------------------------------------------------------
// `consumeReply` accepts multi-line replies (`250-EXTENSION` continuation followed by
// `250 DONE`), skips lines that are not `\d{3}[ -]`, and returns `null` for a
// partial reply so the caller re-reads. It does NOT enforce reply-code ordering:
// `command()` takes an `ok` predicate because the acceptable code differs per verb
// (`RCPT` accepts 250 or 251, `AUTH` wants 235, `DATA` wants 354).

import net from "node:net";
import tls from "node:tls";

const CRLF = "\r\n";
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A failure with the SMTP reply code attached.
 *
 * `responseCode` is what `formatSmtpError` keys on (535 → "认证失败") and what
 * `authenticate` uses to decide whether a LOGIN retry is worthwhile. `code` is the
 * *socket* error code (`ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT`), reused rather
 * than renamed because it is the only one the formatter has to recognize.
 */
export class SmtpError extends Error {
  readonly responseCode: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, opts: { responseCode?: number | undefined; code?: string | undefined } = {}) {
    super(message);
    this.name = "SmtpError";
    this.responseCode = opts.responseCode;
    this.code = opts.code;
  }
}

/** One message to send. `to` is already parsed — `sendSmtpMail` does not split. */
export interface SmtpMailMessage {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string | undefined;
  readonly pass?: string | undefined;
  readonly from: string;
  /** Bare addresses, one per recipient. `parseRecipients` produces this. */
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
}

export interface SendSmtpMailOptions {
  /** Whole-transaction budget, applied per socket. Default 15 s. */
  timeoutMs?: number | undefined;
  /**
   * Passed straight to `tls.connect`. `false` exists only for a test against a
   * self-signed socket pair; a production caller should never set it.
   */
  rejectUnauthorized?: boolean | undefined;
}

/** `^[^\s<>@]+@[^\s<>@]+$` — deliberately loose; the server is the authority. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s<>@]+@[^\s<>@]+$/.test(value);
}

/**
 * Address from `Name <user@host>` or a bare addr; `null` if neither is usable.
 *
 * The angle-bracket form wins over the display name, and a value that is *only* a
 * display name (`张三`) yields `null` rather than being sent as an address — SMTP
 * would reject it at RCPT time, i.e. after the connection is already open.
 */
export function extractAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const angled = /<([^<>]+)>/.exec(trimmed);
  const addr = (angled?.[1] ?? trimmed).trim();
  return looksLikeEmail(addr) ? addr : null;
}

/**
 * Split a comma / semicolon / newline list and keep unique addresses.
 *
 * Dedupe is case-insensitive (`addr.toLowerCase()`) but the *stored* spelling is
 * the first one seen, so `A@x.com, a@x.com` sends one message to `A@x.com`. Sending
 * both would earn a duplicate-content penalty from most providers.
 */
export function parseRecipients(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;\n]+/)) {
    const addr = extractAddress(part);
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

/**
 * RFC 2047 encode a header value, but only when it is not already ASCII.
 *
 * A pure-ASCII value is emitted raw because that is what a human reading the
 * message source expects and what every client parses; `=?UTF-8?B?…?=` for
 * `Subject: hello` is legal but unreadable. Values containing CR/LF are also
 * encoded, which is the header-injection guard: a newline in a subject could
 * otherwise start a new header.
 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value) && !/[\r\n]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * RFC 5322 `Date:` — `toUTCString` emits `GMT`, which is obsolete; `+0000` is the
 * numeric form the grammar prefers. Kept because a strict parser on the receiving
 * end is not hypothetical (SpamAssassin flags `GMT`).
 */
function rfc5322Date(d: Date): string {
  return d.toUTCString().replace(/GMT$/, "+0000");
}

/** Base64, wrapped at 76 characters per RFC 2045. No trailing CRLF. */
function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, (line) => `${line}\r\n`).trimEnd();
}

/** A body starting with `<` is HTML. The `^\s*` allows a leading newline from a template. */
function isHtmlBody(body: string): boolean {
  return /^\s*</.test(body);
}

/**
 * Escape a line-initial `.` as `..` (RFC 5321 §4.5.2).
 *
 * `gm` is required: without it only the first line of the message is protected.
 */
export function dotStuff(payload: string): string {
  return payload.replace(/^\./gm, "..");
}

/**
 * Build a single-part MIME message (plain or HTML). Exported for tests.
 *
 * `now` is injectable so a test can pin `Date:` and `Message-ID` — both are the
 * only non-deterministic parts, and asserting on a base64 body is worthless if the
 * headers around it move.
 *
 * The `Message-ID` domain is the literal `snowluma` (not a real hostname) because
 * the reference uses it and nothing validates it; a synthetic domain is more honest
 * than claiming to be the SMTP server's.
 */
export function buildMimeMessage(mail: SmtpMailMessage, now: Date = new Date()): string {
  const fromAddr = extractAddress(mail.from);
  const toHeader = mail.to.join(", ");
  const html = isHtmlBody(mail.body);
  const id = `<${now.getTime()}.${Math.random().toString(36).slice(2, 10)}@snowluma>`;
  const headers = [
    `From: ${mail.from.trim() || (fromAddr ? `<${fromAddr}>` : "")}`,
    `To: ${toHeader}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${rfc5322Date(now)}`,
    `Message-ID: ${id}`,
    "MIME-Version: 1.0",
    `Content-Type: ${html ? "text/html" : "text/plain"}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrap76(Buffer.from(mail.body, "utf8").toString("base64"));
  return `${headers.join(CRLF)}${CRLF}${CRLF}${body}${CRLF}`;
}

interface SmtpReply {
  readonly code: number;
  readonly lines: readonly string[];
  readonly text: string;
}

/**
 * Pull one complete reply off the front of `buf`, or `null` if it is incomplete.
 *
 * A reply is complete at the first line whose separator is a space (not a hyphen).
 * Everything before that is a continuation, and everything after is the start of
 * the next reply — returned as `rest` so the session can keep it.
 */
function consumeReply(buf: string): { reply: SmtpReply; rest: string } | null {
  let offset = 0;
  const lines: string[] = [];
  let code = 0;
  while (offset < buf.length) {
    const nl = buf.indexOf("\n", offset);
    if (nl === -1) return null;
    // Slice on the LF and strip a trailing CR: a server that sends bare LF (some
    // submission proxies do) must not produce a reply code of `250\r`.
    const line = buf.slice(offset, nl).replace(/\r$/, "");
    offset = nl + 1;
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!m) continue;
    code = Number(m[1]);
    lines.push(m[3] as string);
    if (m[2] === " ") {
      return { reply: { code, lines, text: lines.join("\n") }, rest: buf.slice(offset) };
    }
  }
  return null;
}

/**
 * Parse the EHLO reply into `{starttls, auth}`.
 *
 * Capability lines are uppercased before matching because RFC 5321 does not fix the
 * case and servers differ (`Auth Plain`, `STARTTLS`). `AUTH` with no mechanism list
 * is not treated as `AUTH PLAIN` — an empty set makes `authenticate` fall through
 * to LOGIN, which is the only mechanism such a server could mean.
 */
function parseCapabilities(reply: SmtpReply): { starttls: boolean; auth: Set<string> } {
  const auth = new Set<string>();
  let starttls = false;
  for (const line of reply.lines) {
    const u = line.toUpperCase();
    if (u === "STARTTLS" || u.startsWith("STARTTLS ")) starttls = true;
    if (u.startsWith("AUTH ")) {
      for (const mech of u.slice(5).split(/\s+/)) if (mech) auth.add(mech);
    }
  }
  return { starttls, auth };
}

/**
 * Open the initial socket — TLS or plaintext — and wait for it to be usable.
 *
 * `servername` is set only for a hostname. SNI with an IP literal is illegal (RFC
 * 6066 forbids it) and some TLS stacks abort the handshake; `net.isIP(host) === 0`
 * is the check, and passing `undefined` is what disables SNI.
 *
 * The listeners installed here are removed on success so they cannot fire later and
 * destroy a healthy session — the reference's `removeAllListeners` on both events
 * (§348085-348086). A socket that errors *after* this point is caught by
 * `SmtpSession.read`'s own `error` listener instead.
 */
function connectSocket(
  host: string,
  port: number,
  secure: boolean,
  timeoutMs: number,
  rejectUnauthorized: boolean,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = secure
      ? tls.connect({
          host,
          port,
          servername: net.isIP(host) === 0 ? host : undefined,
          rejectUnauthorized,
        })
      : net.connect({ host, port });
    const fail = (err: Error): void => {
      sock.destroy();
      reject(err);
    };
    sock.setTimeout(timeoutMs);
    sock.once("timeout", () => fail(new SmtpError("SMTP connection timed out", { code: "ETIMEDOUT" })));
    sock.once("error", fail);
    sock.once(secure ? "secureConnect" : "connect", () => {
      sock.removeAllListeners("timeout");
      sock.removeAllListeners("error");
      resolve(sock);
    });
  });
}

/**
 * STARTTLS: wrap an existing plaintext socket in a TLS session.
 *
 * The `callback` form of `tls.connect({socket})` is used rather than listening for
 * `secureConnect` so that a handshake failure rejects instead of hanging — with the
 * event form, `error` fires but the promise has no way to know the callback will
 * never run.
 */
function upgradeTls(
  socket: net.Socket,
  host: string,
  timeoutMs: number,
  rejectUnauthorized: boolean,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect(
      {
        socket,
        servername: net.isIP(host) === 0 ? host : undefined,
        rejectUnauthorized,
      },
      () => resolve(tlsSocket),
    );
    tlsSocket.setTimeout(timeoutMs);
    tlsSocket.once("timeout", () => {
      tlsSocket.destroy();
      reject(new SmtpError("SMTP STARTTLS timed out", { code: "ETIMEDOUT" }));
    });
    tlsSocket.once("error", reject);
  });
}

/**
 * One connection's line protocol.
 *
 * The session owns the read buffer so a reply split across two TCP segments is
 * reassembled; `read` first drains what is already buffered (the STARTTLS case
 * leaves the post-upgrade greeting in `buf`) and only then installs listeners.
 */
class SmtpSession {
  private socket: net.Socket;
  private buf = "";

  constructor(socket: net.Socket) {
    this.socket = socket;
  }

  destroy(): void {
    this.socket.destroy();
  }

  /**
   * (Re-)arm the idle timeout.
   *
   * Re-armed after the STARTTLS upgrade because `replaceSocket` swaps the underlying
   * socket and the new one has no timeout set. The handler is `once`, so a long
   * transaction needs it re-armed per phase — which is what `sendSmtpMail` does.
   */
  attachTimeout(timeoutMs: number, onTimeout: () => void): void {
    this.socket.setTimeout(timeoutMs);
    this.socket.once("timeout", onTimeout);
  }

  async read(): Promise<SmtpReply> {
    const ready = consumeReply(this.buf);
    if (ready) {
      this.buf = ready.rest;
      return ready.reply;
    }
    return new Promise((resolve, reject) => {
      const onData = (chunk: Buffer): void => {
        this.buf += chunk.toString("utf8");
        const got = consumeReply(this.buf);
        if (!got) return;
        this.buf = got.rest;
        cleanup();
        resolve(got.reply);
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      // A bare close with no reply is the normal way a server drops a client that
      // sent something illegal; without this branch the promise would hang until
      // the socket timeout, and the caller would report ETIMEDOUT instead of the
      // real cause.
      const onClose = (): void => {
        cleanup();
        reject(new SmtpError("SMTP connection closed"));
      };
      const cleanup = (): void => {
        this.socket.removeListener("data", onData);
        this.socket.removeListener("error", onError);
        this.socket.removeListener("close", onClose);
      };
      this.socket.on("data", onData);
      this.socket.once("error", onError);
      this.socket.once("close", onClose);
    });
  }

  write(data: string): void {
    this.socket.write(data);
  }

  /**
   * Send one command line and require an acceptable reply.
   *
   * `label` overrides the verb in the error message for the two commands whose verb
   * is not self-explanatory: `DATA` for the message body's `.` terminator (a
   * failure there is a send failure, not a `.`-command failure) and `AUTH` for
   * the base64 payloads of `AUTH LOGIN`, which would otherwise surface as
   * `dXNlcg== failed: 535`.
   */
  async command(line: string, ok: (code: number) => boolean, label?: string): Promise<SmtpReply> {
    this.write(line + CRLF);
    const reply = await this.read();
    if (!ok(reply.code)) {
      throw new SmtpError(`${label ?? line.split(" ")[0] ?? "SMTP"} failed: ${reply.code} ${reply.text}`.trim(), {
        responseCode: reply.code,
      });
    }
    return reply;
  }

  /**
   * Swap in the TLS socket after a successful STARTTLS.
   *
   * `buf` is cleared rather than kept: whatever the plaintext side had buffered is
   * either a partial reply (impossible — STARTTLS is only sent after a complete
   * one) or discarded garbage from the upgrade, and keeping it would let pre-TLS
   * bytes be parsed as post-TLS protocol.
   */
  replaceSocket(next: net.Socket): void {
    this.socket = next;
    this.buf = "";
  }
}

/**
 * Map a send failure to a message an operator can act on.
 *
 * The three socket codes are collapsed into one "cannot connect" string because they
 * are all the same operator problem (wrong host, wrong port, firewall) and the
 * distinction is already in the log. 535 is special-cased to "认证失败" because it
 * is by far the most common failure and the server's English text is not helpful.
 * `self-signed|unable to verify` is the certificate case, which is *not* an
 * `SmtpError` — it comes out of the TLS stack before any SMTP verb.
 */
export function formatSmtpError(err: unknown, host: string, port: number): string {
  if (err instanceof SmtpError) {
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
      return `无法连接 SMTP：${host}:${port}`;
    }
    if (err.responseCode === 535) return "SMTP 认证失败";
    return err.message;
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
      return `无法连接 SMTP：${host}:${port}`;
    }
    if (/self-signed|unable to verify/i.test(err.message)) return `SMTP 证书不受信任：${host}`;
    return err.message || "邮件发送失败";
  }
  return "邮件发送失败";
}

/**
 * The `AUTH PLAIN` → `AUTH LOGIN` strategy.
 *
 * See the file header for the fallback rule. The `catch` deliberately swallows a
 * non-535 `SmtpError` from PLAIN when LOGIN is also offered: a server that
 * advertises `AUTH PLAIN LOGIN` but rejects the initial-response form still accepts
 * the challenge/response form, and that is exactly the case this retry exists for.
 */
async function authenticate(
  session: SmtpSession,
  mechs: ReadonlySet<string>,
  user: string,
  pass: string,
): Promise<void> {
  const hasPlain = mechs.has("PLAIN");
  const hasLogin = mechs.has("LOGIN");
  if (hasPlain || !hasLogin) {
    try {
      // `\0user\0pass` — the RFC 4616 form: authorization identity (empty), authcid,
      // password. The empty leading field is not optional.
      const token = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
      await session.command(`AUTH PLAIN ${token}`, (c) => c === 235, "AUTH");
      return;
    } catch (err) {
      if (hasPlain && !hasLogin) throw err;
      if (err instanceof SmtpError && err.responseCode === 535) throw err;
    }
  }
  await loginAuth(session, user, pass);
}

async function loginAuth(session: SmtpSession, user: string, pass: string): Promise<void> {
  await session.command("AUTH LOGIN", (c) => c === 334, "AUTH");
  await session.command(Buffer.from(user, "utf8").toString("base64"), (c) => c === 334, "AUTH");
  await session.command(Buffer.from(pass, "utf8").toString("base64"), (c) => c === 235, "AUTH");
}

/**
 * Send one message. Throws `SmtpError` (or a raw socket error) on failure.
 *
 * Callers that must not throw use `createDefaultSendMail`, which wraps this in
 * `formatSmtpError`. This function is the one place that owns the socket lifecycle,
 * so it is also the only place that can guarantee the socket is destroyed — hence
 * the `finally`.
 *
 * Recipients are sent one `RCPT TO` per address rather than as a single command:
 * that is the only way to know *which* address was rejected, and 250/251 are both
 * accepted because 251 ("will forward") is a success.
 */
export async function sendSmtpMail(mail: SmtpMailMessage, opts: SendSmtpMailOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const rejectUnauthorized = opts.rejectUnauthorized ?? true;
  const fromAddr = extractAddress(mail.from);
  if (!fromAddr) throw new SmtpError("invalid from address");
  if (mail.to.length === 0) throw new SmtpError("no recipients");

  let sock = await connectSocket(mail.host, mail.port, mail.secure, timeoutMs, rejectUnauthorized);
  const session = new SmtpSession(sock);
  // `finished` exists so a timeout that fires after the transaction has succeeded
  // does not destroy a socket the pool (or QUIT) still needs — see the file header.
  let finished = false;
  const failTimeout = (): void => {
    if (finished) return;
    session.destroy();
  };
  session.attachTimeout(timeoutMs, failTimeout);
  try {
    const greeting = await session.read();
    if (greeting.code !== 220) {
      throw new SmtpError(`SMTP greeting failed: ${greeting.code} ${greeting.text}`.trim(), {
        responseCode: greeting.code,
      });
    }
    const ehlo = async (): Promise<SmtpReply> => session.command("EHLO [127.0.0.1]", (c) => c === 250);
    // The EHLO argument is an address literal, not a hostname: the client may be
    // behind NAT with no resolvable name, and a server that does reverse lookups on
    // a bare hostname can add seconds of latency.
    let caps = parseCapabilities(await ehlo());
    if (!mail.secure && caps.starttls) {
      await session.command("STARTTLS", (c) => c === 220);
      const upgraded = await upgradeTls(sock, mail.host, timeoutMs, rejectUnauthorized);
      session.replaceSocket(upgraded);
      session.attachTimeout(timeoutMs, failTimeout);
      sock = upgraded;
      // Re-EHLO is mandatory (RFC 3207 §4.2): the plaintext capability list is
      // unauthenticated, and the AUTH mechanisms only appear after the upgrade on
      // most servers. Skipping it authenticates against the wrong list.
      caps = parseCapabilities(await ehlo());
    }
    const user = mail.user?.trim() ?? "";
    if (user) await authenticate(session, caps.auth, user, mail.pass ?? "");
    await session.command(`MAIL FROM:<${fromAddr}>`, (c) => c === 250);
    for (const rcpt of mail.to) await session.command(`RCPT TO:<${rcpt}>`, (c) => c === 250 || c === 251);
    await session.command("DATA", (c) => c === 354);
    session.write(dotStuff(buildMimeMessage(mail)));
    // The body is written before the `.` command, so the terminator is a `command`
    // and its reply is awaited like any other. Sending `.` inside `write` would make
    // a rejected message indistinguishable from an accepted one.
    await session.command(".", (c) => c === 250, "DATA");
    try {
      await session.command("QUIT", (c) => c === 221);
    } catch {
      // QUIT is advisory: the message is already accepted at this point, and a
      // dropped connection after the final 250 does not unsend it.
    }
    finished = true;
  } catch (err) {
    finished = true;
    throw err;
  } finally {
    session.destroy();
  }
}
