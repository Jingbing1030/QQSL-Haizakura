// Tests for the hand-rolled SMTP client.
//
// Two kinds of assertion, and the split is deliberate:
//
//   1. **PURE FUNCTIONS** — `extractAddress`, `parseRecipients`, `buildMimeMessage`,
//      `dotStuff`, `formatSmtpError`. These are where the RFC details live (76-column
//      base64, `+0000` not `GMT`, dot-stuffing, the display-name-wins rule), and each
//      is stated as the reference's own behaviour rather than as "round-trips".
//
//   2. **A REAL SMTP SERVER ON LOOPBACK.** `sendSmtpMail` is a protocol
//      implementation; the only honest way to test it is against a socket that
//      speaks SMTP. A fake transport would prove nothing about the command sequence,
//      the STARTTLS upgrade, or the AUTH fallback. The server below is ~60 lines and
//      records the exact verb sequence so a test can assert on it — which is what
//      makes the "PLAIN then LOGIN" and "re-EHLO after STARTTLS" behaviours
//      observable instead of implied.
//
// The TLS cases use `rejectUnauthorized: false` against a self-signed cert
// generated at test time by `node:crypto` — no fixture file, no network.
//
// What is NOT tested: real DNS, real certificate chains, real AUTH servers. Those
// need the network and would only prove the network is up.
//
// Line numbers in test names are `reference/index.mjs` positions.

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";


import {
  SmtpError,
  buildMimeMessage,
  dotStuff,
  extractAddress,
  formatSmtpError,
  parseRecipients,
  sendSmtpMail,
  type SmtpMailMessage,
} from "../src/notifications/smtp.js";

const MAIL: SmtpMailMessage = {
  host: "127.0.0.1",
  port: 0,
  secure: false,
  from: "Bot <bot@example.com>",
  to: ["a@example.com", "b@example.com"],
  subject: "账号offline",
  body: "hello",
};

/**
 * A self-signed certificate for the TLS tests, generated once with
 * `openssl req -x509 -newkey rsa:2048 -nodes -subj "/CN=localhost" -days 36500`
 * and inlined so the suite needs no fixture directory and no network.
 *
 * It is self-signed, so `rejectUnauthorized: true` must fail on it — which is what
 * the "certificate is rejected by default" test asserts. The expiry is far enough
 * out that this does not rot.
 */
const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDm1qEDBKZgJa01
fNECkB+Qf721H3bw5NgAXWELsgMjdzREJRQNwcPwEmB5D937ejsYF2TE6DBw29jB
wx99a/zAOv+EoBR8cJaxxIooTkFFSnfuTMNbTe/6uRGryBgO0fja5js98Nl5wF4y
ubvdarLaZ6T1diOsivMlliQMDV3GgFRqy8RB0LRZtLkLQTmskPaR+TrOaJAcc5bj
H9tlDim1OK/iEXzllvgF4Y2bFgXwyDpdydN21V8Sta8eb26j0oxOglJ+S3EKRqoc
ITNkcv5YnIMiw2PdUo+vvENMf6wnHdru6dUIIJRC+GNjQcg1fkqSt/w+Da7HpcpL
waCL2145AgMBAAECggEABbm2FaaUX9cfZC+72WXsun9Im8jzgMcUSnIGea1JIaSP
wc7vn+W57+bsyKPpnBash4zw/WdK6Emzpx6pVcmLY9Myyj3UND/wpOkciiJiwQ63
ScxSnh2hQaU8eHfGjPuNQhSqzH8ATeJFE9oCfFvsorkmYMY03U8296wxKbFdLZKu
M8j34SBE1nvwxFrhtVIFgr6NELKE6uUJ60NAtJFYTTf6Ga9YOEL3fn5+mYtRhlxf
zABYp8Ih3jFwE/BkzpN3vhSjp+18TUUcosRcaWnAZV1qWfp2cX3zh8A3jaccGVfJ
4txAuaYjFNEGReYHxA7tRoKS/SgwOU+/hdDBa52EzwKBgQD8+GFAX58K5FDX5MPC
FWQK+7QxeYgRalSOCgULJp1rV3ibFrdnM6dbxWKPdAn77JaWSJYdzG/YT85cS74/
ewP80GsfQN0xxYpSvSfFwf8Yh08VrYyyRO4nMe9PaxBiobyNnb31ffcjYEb9Xnza
yKmSVZtmuSr2dUTsZz7r+YG81wKBgQDpmmREtxjc6v3JUqSDw6FU/BPFpoWvDwwW
G8ZTOaEI7X6sMgtGqGDiV1V6uJSmnKj+WBzZUhQBZRH17F4RytIh81xNDsqUMbFp
G5GxZA+bTnU9C+HRptGz5bR+ad/GLorDueFd8N33i/phitL/NSC8G263G1bjPOKq
JaroK4TLbwKBgH3jhVIpw9YBxRGLcLfXOVAV7phoaIRyK937soLYFqLihsx3Q5IC
LJkI44GMN6O9Gztyp/HwWQCGxqU7tFOW/mcDuSt2dh1ctvdx1qcdYbttKrgZA9l7
YCD1Qqh9GUxcPJ8lDvFqXGCoeut/6BZgobKHE6zNHUpFFaWnw7JfGmdFAoGATGSp
Fa+q+dP/Wq8kDdMUF264KJLkdPM+yJwcp2rZNsoz+qwC9ABsbpiQ46kpM7NXsJWw
GYG1+R7MWNgLi1YAkgm7zZdguEXn9q+FXbWTRP7LaENSffVH7sTX2d9VxsHBr3BC
Oy5h6GpmXy+/AKanJdzyv/6402c92NaopXRV4RECgYAqQ8YflBrDEPvLprb/4dB4
eYH5Eh2rcSKu+ZoISWIxYRrqTUZyi/BHUZXq9kiGbcXvJ7XIxVfLB4sE5eox88hM
AXq5wtewv67usybRPYZ+8Ja+K5013cGwtUmDl7hzAduNl6xjd8xB15w4vF2ibQMn
pDFWDr8FlHbhpuAg4Omj+Q==
-----END PRIVATE KEY-----`;

const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDCzCCAfOgAwIBAgIUSCGdvpcPhOdrmJ+YPJuWHOFfGWUwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTEyMjIyMDU1MVoYDzIxMjYx
MDI5MjIwNTUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDm1qEDBKZgJa01fNECkB+Qf721H3bw5NgAXWELsgMj
dzREJRQNwcPwEmB5D937ejsYF2TE6DBw29jBwx99a/zAOv+EoBR8cJaxxIooTkFF
SnfuTMNbTe/6uRGryBgO0fja5js98Nl5wF4yubvdarLaZ6T1diOsivMlliQMDV3G
gFRqy8RB0LRZtLkLQTmskPaR+TrOaJAcc5bjH9tlDim1OK/iEXzllvgF4Y2bFgXw
yDpdydN21V8Sta8eb26j0oxOglJ+S3EKRqocITNkcv5YnIMiw2PdUo+vvENMf6wn
Hdru6dUIIJRC+GNjQcg1fkqSt/w+Da7HpcpLwaCL2145AgMBAAGjUzBRMB0GA1Ud
DgQWBBQP56gG9zyeXuGAT7rM5I5v2BdNzzAfBgNVHSMEGDAWgBQP56gG9zyeXuGA
T7rM5I5v2BdNzzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQC+
l3kB/PKh5z/kRiSulOPkAym8s6mL0DOijQdjmwS8ZzXhpKfqvnEh4ZONJxT3sNVg
UbKj+Al2NwNvq9PLUKAd7G3IbccyAnpDHytVk8DF8exmYcqYsI2Ika2SSl/m/8qR
0kWDbKOn8lOPbYa7w/b14z/O2eLUK5diYMUDmIgT5HsoTLxjMwYpHLur1vTLrX6L
p1+zTWx8Br+mYVdFZoxdtQYi9I9uYxunbHRH2bvsmhyy6WGcaWyuiStmbxzEG+zu
z0yXSy5VRD7c8fnQrRFaZLeTXYGJc1Gi7cMpu84bmVY3YXpDEV+PnZQJjxETpdIe
6VSM3sMT7MUpxoFMiOKJ
-----END CERTIFICATE-----`;

// ===========================================================================
// Address parsing (L347967, L347979)
// ===========================================================================

test("L347971 extractAddress takes the angled form over a display name", () => {
  assert.equal(extractAddress("张三 <zhang@example.com>"), "zhang@example.com");
  assert.equal(extractAddress("zhang@example.com"), "zhang@example.com");
  assert.equal(extractAddress("  zhang@example.com  "), "zhang@example.com");
});

test("L347976 extractAddress rejects a display name with no address", () => {
  assert.equal(extractAddress("张三"), null);
  assert.equal(extractAddress(""), null);
  assert.equal(extractAddress("   "), null);
  assert.equal(extractAddress("a b@example.com"), null, "internal whitespace is not an address");
  assert.equal(extractAddress("<not-an-address>"), null);
});

test("L347979 parseRecipients accepts comma, semicolon and newline separators", () => {
  assert.deepEqual(parseRecipients("a@x.com,b@x.com;c@x.com\nd@x.com"), [
    "a@x.com",
    "b@x.com",
    "c@x.com",
    "d@x.com",
  ]);
});

test("L347985 parseRecipients dedupes case-insensitively, keeping the first spelling", () => {
  assert.deepEqual(parseRecipients("A@x.com, a@x.com, b@x.com"), ["A@x.com", "b@x.com"]);
});

test("L347983 parseRecipients drops the empty parts a trailing separator produces", () => {
  assert.deepEqual(parseRecipients("a@x.com,,"), ["a@x.com"]);
  assert.deepEqual(parseRecipients(""), []);
});

// ===========================================================================
// MIME assembly (L348009)
// ===========================================================================

test("L348021 a plain-text body produces text/plain with a base64 transfer encoding", () => {
  const mime = buildMimeMessage({ ...MAIL, body: "hello world" }, new Date(0));
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  // `hello world` base64 is `aGVsbG8gd29ybGQ=`.
  assert.match(mime, /aGVsbG8gd29ybGQ=/);
});

test("L348002 a body starting with `<` (after whitespace) is HTML", () => {
  assert.match(buildMimeMessage({ ...MAIL, body: "<p>hi</p>" }, new Date(0)), /text\/html/);
  assert.match(buildMimeMessage({ ...MAIL, body: "  \n<p>hi</p>" }, new Date(0)), /text\/html/);
  // A `<` mid-body does not make it HTML.
  assert.match(buildMimeMessage({ ...MAIL, body: "x < y" }, new Date(0)), /text\/plain/);
});

test("L347992 a non-ASCII subject is RFC 2047 encoded", () => {
  const mime = buildMimeMessage({ ...MAIL, subject: "账号offline" }, new Date(0));
  const expected = `Subject: =?UTF-8?B?${Buffer.from("账号offline", "utf8").toString("base64")}?=`;
  // `includes`, not a regex: base64 contains `+` (a quantifier) and `=` (a literal
  // that has to be escaped), so a pattern built from it is unreadable and wrong.
  assert.ok(mime.includes(expected), `missing ${expected}`);
});

test("L347993 an ASCII subject is emitted raw — no needless encoding", () => {
  assert.match(buildMimeMessage({ ...MAIL, subject: "hello" }, new Date(0)), /Subject: hello\r\n/);
});

test("L347993 a CRLF in the subject is encoded, so it cannot start a new header", () => {
  const mime = buildMimeMessage({ ...MAIL, subject: "x\r\nBcc: evil@example.com" }, new Date(0));
  assert.doesNotMatch(mime, /Bcc: evil@example\.com\r\n/, "the injection must not survive as a header");
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
});

test("L347996 Date: uses the numeric +0000 offset, not the obsolete GMT", () => {
  const mime = buildMimeMessage(MAIL, new Date("2026-11-23T00:00:00Z"));
  assert.match(mime, /Date: Mon, 23 Nov 2026 00:00:00 \+0000/);
  assert.doesNotMatch(mime, /GMT/);
});

test("L348015 From: keeps the display name; a bare address is wrapped in angles", () => {
  assert.match(buildMimeMessage(MAIL, new Date(0)), /From: Bot <bot@example\.com>/);
  assert.match(buildMimeMessage({ ...MAIL, from: "bot@example.com" }, new Date(0)), /From: bot@example\.com/);
});

test("L348011 To: joins every recipient", () => {
  assert.match(buildMimeMessage(MAIL, new Date(0)), /To: a@example\.com, b@example\.com/);
});

test("L347999 base64 is wrapped at 76 columns", () => {
  const body = "x".repeat(300);
  const mime = buildMimeMessage({ ...MAIL, body }, new Date(0));
  const payload = mime.split("\r\n\r\n")[1] ?? "";
  for (const line of payload.split("\r\n")) {
    assert.ok(line.length <= 76, `line of ${String(line.length)} chars exceeds 76`);
  }
});

test("L348019 Message-ID is unique per message but stable in shape", () => {
  const now = new Date(1_700_000_000_000);
  const a = buildMimeMessage(MAIL, now);
  const b = buildMimeMessage(MAIL, now);
  const id = (s: string): string => /Message-ID: (<[^>]+>)/.exec(s)?.[1] ?? "";
  assert.match(id(a), /^<1700000000000\.[a-z0-9]+@snowluma>$/);
  assert.notEqual(id(a), id(b), "two messages in the same millisecond must not collide");
});

// ===========================================================================
// Dot-stuffing (L348005)
// ===========================================================================

test("L348006 a line-initial dot is doubled", () => {
  assert.equal(dotStuff(".hidden\nvisible"), "..hidden\nvisible");
  assert.equal(dotStuff("first\n.\nlast"), "first\n..\nlast");
});

test("L348005 dot-stuffing applies to every line, not just the first", () => {
  assert.equal(dotStuff("a\n.b\n.c"), "a\n..b\n..c");
});

test("dot-stuffing leaves a mid-line dot alone", () => {
  assert.equal(dotStuff("a.b"), "a.b");
});

// ===========================================================================
// Error formatting (L348166)
// ===========================================================================

test("L348168 the three connection errors collapse to one actionable message", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"]) {
    assert.equal(
      formatSmtpError(new SmtpError("boom", { code }), "smtp.example.com", 465),
      "无法连接 SMTP：smtp.example.com:465",
    );
  }
});

test("L348169 535 becomes 认证失败 rather than the server's English text", () => {
  assert.equal(formatSmtpError(new SmtpError("535 5.7.8 bad", { responseCode: 535 }), "h", 587), "SMTP 认证失败");
});

test("L348170 any other SmtpError keeps its own message", () => {
  assert.equal(formatSmtpError(new SmtpError("550 mailbox unavailable", { responseCode: 550 }), "h", 587), "550 mailbox unavailable");
});

test("L348175 a certificate failure is named as one", () => {
  assert.equal(
    formatSmtpError(new Error("unable to verify the first certificate"), "smtp.example.com", 465),
    "SMTP 证书不受信任：smtp.example.com",
  );
  assert.equal(formatSmtpError(new Error("self-signed certificate in chain"), "h", 465), "SMTP 证书不受信任：h");
});

test("L348174 a plain Error with a socket code still maps to 无法连接", () => {
  const err = new Error("connect ECONNREFUSED") as NodeJS.ErrnoException;
  err.code = "ECONNREFUSED";
  assert.equal(formatSmtpError(err, "h", 25), "无法连接 SMTP：h:25");
});

test("L348176 an empty Error message falls back to 邮件发送失败", () => {
  assert.equal(formatSmtpError(new Error(""), "h", 25), "邮件发送失败");
});

test("L348178 a non-Error falls back to 邮件发送失败", () => {
  assert.equal(formatSmtpError("a string", "h", 25), "邮件发送失败");
  assert.equal(formatSmtpError(undefined, "h", 25), "邮件发送失败");
});

// ===========================================================================
// A real SMTP server on loopback
// ===========================================================================

interface SmtpServerOptions {
  /** Capabilities advertised in response to EHLO. */
  capabilities?: readonly string[];
  /** Reply to AUTH PLAIN. */
  plainReply?: string;
  /** Reply to AUTH LOGIN's username challenge. */
  loginUserReply?: string;
  /** Reply to AUTH LOGIN's password challenge. */
  loginPassReply?: string;
  /** Answer STARTTLS and upgrade. */
  starttls?: boolean;
}

interface Recorded {
  /** Every command line the client sent, in order. */
  readonly commands: string[];
  /**
   * The DATA payload, un-dot-stuffed.
   *
   * A getter, not a value: the object is handed to the test *before* the client
   * connects, so a plain property would snapshot an empty array and every payload
   * assertion would compare against `""`.
   */
  readonly data: string;
}

/**
 * A minimal SMTP responder that records the verb sequence.
 *
 * It is deliberately dumb (no state machine beyond DATA) — the point is to observe
 * what the client sends, not to validate it. `capabilities` is the knob that lets a
 * test offer only PLAIN, only LOGIN, or both.
 */
async function withSmtpServer(
  opts: SmtpServerOptions,
  run: (port: number, recorded: Recorded) => Promise<void>,
): Promise<void> {
  const commands: string[] = [];
  const dataLines: string[] = [];
  let inData = false;
  const capabilities = opts.capabilities ?? ["AUTH PLAIN LOGIN"];

  const attach = (socket: net.Socket): void => {
    // `\r\n`-delimited line reader that keeps partial lines between chunks.
    let buf = "";
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      for (;;) {
        const nl = buf.indexOf("\r\n");
        if (nl === -1) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            commands.push(".");
            socket.write("250 OK\r\n");
            continue;
          }
          dataLines.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        commands.push(line);
        const verb = line.split(" ")[0]?.toUpperCase() ?? "";
        if (verb === "EHLO") {
          socket.write(["250-test", ...capabilities.map((c) => `250-${c}`), "250 SIZE 10485760"].join("\r\n") + "\r\n");
        } else if (verb === "STARTTLS" && opts.starttls) {
          socket.write("220 Ready to start TLS\r\n");
          // The upgrade is the caller's job; see `withTlsSmtpServer`.
        } else if (verb === "AUTH") {
          if (line.toUpperCase().startsWith("AUTH PLAIN")) {
            socket.write(`${opts.plainReply ?? "235 2.7.0 Accepted"}\r\n`);
          } else {
            socket.write("334 VXNlcm5hbWU6\r\n");
          }
        } else if (line === b64("user") || line === b64("pass")) {
          if (line === b64("user")) socket.write(`${opts.loginUserReply ?? "334 UGFzc3dvcmQ6"}\r\n`);
          else socket.write(`${opts.loginPassReply ?? "235 2.7.0 Accepted"}\r\n`);
        } else if (verb === "MAIL" || verb === "RCPT") {
          socket.write("250 OK\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (verb === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("502 Unknown\r\n");
        }
      }
    });
    socket.on("error", () => {
      // The client destroys the socket after QUIT; ECONNRESET here is expected.
    });
  };

  const server = net.createServer(attach);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run((address as net.AddressInfo).port, {
      commands,
      get data(): string {
        return dataLines.join("\r\n");
      },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

test("L348195 the happy path sends greeting → EHLO → MAIL → RCPT ×2 → DATA → . → QUIT", async () => {
  await withSmtpServer({}, async (port, recorded) => {
    await sendSmtpMail({ ...MAIL, port }, { timeoutMs: 5_000 });
    const verbs = recorded.commands.map((c) => c.split(" ")[0]);
    assert.deepEqual(verbs, ["EHLO", "MAIL", "RCPT", "RCPT", "DATA", ".", "QUIT"]);
    assert.equal(recorded.commands[0], "EHLO [127.0.0.1]", "EHLO uses an address literal");
    assert.equal(recorded.commands[1], "MAIL FROM:<bot@example.com>");
    assert.deepEqual(recorded.commands.slice(2, 4), ["RCPT TO:<a@example.com>", "RCPT TO:<b@example.com>"]);
    // The payload is base64 of `hello`, and the terminator is a separate command.
    assert.match(recorded.data, new RegExp(b64("hello")));
  });
});

test("L348208 AUTH PLAIN is used when the server offers it", async () => {
  await withSmtpServer({ capabilities: ["AUTH PLAIN"] }, async (port, recorded) => {
    await sendSmtpMail({ ...MAIL, port, user: "user", pass: "pass" }, { timeoutMs: 5_000 });
    const auth = recorded.commands.find((c) => c.startsWith("AUTH"));
    assert.ok(auth);
    // `\0user\0pass`
    assert.equal(auth, `AUTH PLAIN ${b64("\0user\0pass")}`);
    assert.equal(recorded.commands.filter((c) => c.startsWith("AUTH")).length, 1, "one round trip");
  });
});

test("L348236 AUTH LOGIN is used when the server offers only LOGIN", async () => {
  await withSmtpServer({ capabilities: ["AUTH LOGIN"] }, async (port, recorded) => {
    await sendSmtpMail({ ...MAIL, port, user: "user", pass: "pass" }, { timeoutMs: 5_000 });
    const authIdx = recorded.commands.findIndex((c) => c === "AUTH LOGIN");
    assert.equal(authIdx, 1, "AUTH LOGIN immediately after EHLO");
    assert.equal(recorded.commands[authIdx + 1], b64("user"));
    assert.equal(recorded.commands[authIdx + 2], b64("pass"));
  });
});

test("L348228 PLAIN failing with a non-535 code falls back to LOGIN when both are offered", async () => {
  await withSmtpServer(
    { capabilities: ["AUTH PLAIN LOGIN"], plainReply: "504 5.7.4 Unrecognized mechanism" },
    async (port, recorded) => {
      // The fallback is the whole reason `authenticate` has a catch.
      await sendSmtpMail({ ...MAIL, port, user: "user", pass: "pass" }, { timeoutMs: 5_000 });
      assert.ok(
        recorded.commands.some((c) => c === "AUTH LOGIN"),
        "LOGIN is retried after a non-535 PLAIN failure",
      );
    },
  );
});

test("L348234 a 535 from PLAIN is rethrown — no LOGIN retry to burn a login attempt", async () => {
  await withSmtpServer(
    { capabilities: ["AUTH PLAIN LOGIN"], plainReply: "535 5.7.8 Authentication credentials invalid" },
    async (port, recorded) => {
      await assert.rejects(
        sendSmtpMail({ ...MAIL, port, user: "user", pass: "wrong" }, { timeoutMs: 5_000 }),
        (err: unknown) => err instanceof SmtpError && err.responseCode === 535,
      );
      assert.equal(recorded.commands.includes("AUTH LOGIN"), false);
    },
  );
});

test("L348233 PLAIN as the only mechanism rethrows its failure instead of trying LOGIN", async () => {
  await withSmtpServer({ capabilities: ["AUTH PLAIN"], plainReply: "504 5.7.4 nope" }, async (port, recorded) => {
    await assert.rejects(sendSmtpMail({ ...MAIL, port, user: "user", pass: "pass" }, { timeoutMs: 5_000 }));
    assert.equal(recorded.commands.includes("AUTH LOGIN"), false);
  });
});

test("no AUTH is attempted when no user is configured", async () => {
  await withSmtpServer({}, async (port, recorded) => {
    await sendSmtpMail({ ...MAIL, port }, { timeoutMs: 5_000 });
    assert.equal(recorded.commands.some((c) => c.startsWith("AUTH")), false);
  });
});

test("L348196 a non-220 greeting aborts before any command", async () => {
  // A server that refuses the connection at the greeting.
  const server = net.createServer((socket) => {
    socket.write("554 no service\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await assert.rejects(
      sendSmtpMail({ ...MAIL, port }, { timeoutMs: 5_000 }),
      (err: unknown) => err instanceof SmtpError && err.responseCode === 554,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("L348184 an invalid From address throws before opening a socket", async () => {
  // Port 1 is almost certainly closed; reaching it would give ECONNREFUSED, so a
  // validation error proves the check comes first.
  await assert.rejects(
    sendSmtpMail({ ...MAIL, from: "张三", port: 1 }, { timeoutMs: 1_000 }),
    (err: unknown) => err instanceof SmtpError && err.message === "invalid from address",
  );
});

test("L348185 no recipients throws before opening a socket", async () => {
  await assert.rejects(
    sendSmtpMail({ ...MAIL, to: [], port: 1 }, { timeoutMs: 1_000 }),
    (err: unknown) => err instanceof SmtpError && err.message === "no recipients",
  );
});

test("L348206 a RCPT rejection fails the send with the response code", async () => {
  const server = net.createServer((socket) => {
    let buf = "";
    socket.write("220 test\r\n");
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      for (;;) {
        const nl = buf.indexOf("\r\n");
        if (nl === -1) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (line.startsWith("EHLO")) socket.write("250-test\r\n250 SIZE 1\r\n");
        else if (line.startsWith("MAIL")) socket.write("250 OK\r\n");
        else if (line.startsWith("RCPT")) socket.write("550 no such user\r\n");
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await assert.rejects(
      sendSmtpMail({ ...MAIL, port }, { timeoutMs: 5_000 }),
      (err: unknown) => err instanceof SmtpError && err.responseCode === 550,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("L348191 a silent server is bounded by the timeout, surfacing as `connection closed`", async () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    // Deliberately silent — no greeting.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    // Pinned as-is: the timeout handler *destroys* the socket (L348191) rather than
    // rejecting, so the pending `read()` sees `close` and reports "SMTP connection
    // closed". ETIMEDOUT only surfaces from `connectSocket`, i.e. when the TCP
    // connect itself never completes. Both bound the transaction; only one names it.
    await assert.rejects(
      sendSmtpMail({ ...MAIL, port }, { timeoutMs: 150 }),
      (err: unknown) => err instanceof SmtpError && /connection closed/.test(err.message),
    );
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("L348140 a connection closed mid-command rejects rather than hanging", async () => {
  const server = net.createServer((socket) => {
    socket.write("220 test\r\n");
    // Close as soon as the client says anything.
    socket.once("data", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await assert.rejects(
      sendSmtpMail({ ...MAIL, port }, { timeoutMs: 5_000 }),
      (err: unknown) => err instanceof SmtpError && /connection closed/.test(err.message),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ===========================================================================
// STARTTLS / implicit TLS (L348091, L348066, L348199)
// ===========================================================================

test("L348199 STARTTLS upgrades the socket and re-EHLOs over TLS", async () => {
  const secureContext = tls.createSecureContext({ key: TLS_KEY, cert: TLS_CERT });
  const commands: string[] = [];
  let ehloCount = 0;

  const server = net.createServer((socket) => {
    let buf = "";
    let tlsSocket: tls.TLSSocket | null = null;
    const handle = (sock: net.Socket): void => {
      sock.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        for (;;) {
          const nl = buf.indexOf("\r\n");
          if (nl === -1) break;
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          commands.push(line);
          if (line.startsWith("EHLO")) {
            ehloCount += 1;
            if (ehloCount === 1) sock.write("250-test\r\n250 STARTTLS\r\n");
            else sock.write("250-test\r\n250 AUTH PLAIN\r\n");
          } else if (line === "STARTTLS") {
            sock.write("220 Ready\r\n");
            socket.removeAllListeners("data");
            tlsSocket = new tls.TLSSocket(socket, { isServer: true, secureContext });
            tlsSocket.on("secure", () => {
              buf = "";
              handle(tlsSocket as tls.TLSSocket);
            });
            tlsSocket.on("error", () => undefined);
          } else if (line.startsWith("AUTH")) {
            sock.write("235 Accepted\r\n");
          } else if (line.startsWith("MAIL") || line.startsWith("RCPT")) {
            sock.write("250 OK\r\n");
          } else if (line === "DATA") {
            sock.write("354 go\r\n");
          } else if (line === ".") {
            sock.write("250 queued\r\n");
          } else if (line === "QUIT") {
            sock.write("221 bye\r\n");
            sock.end();
          }
        }
      });
      sock.on("error", () => undefined);
    };
    handle(socket);
    socket.write("220 test\r\n");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await sendSmtpMail({ ...MAIL, port, user: "user", pass: "pass" }, { timeoutMs: 5_000, rejectUnauthorized: false });
    assert.ok(commands.includes("STARTTLS"), "STARTTLS was issued");
    assert.equal(ehloCount, 2, "EHLO is re-issued after the upgrade (RFC 3207 §4.2)");
    // AUTH only appears in the post-upgrade capability list, so its presence proves
    // the re-EHLO reply was the one used.
    assert.ok(commands.some((c) => c.startsWith("AUTH PLAIN")));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("L348071 a self-signed certificate is rejected by default (rejectUnauthorized: true)", async () => {
  const server = tls.createServer({ key: TLS_KEY, cert: TLS_CERT }, (socket) => {
    socket.write("220 test\r\n");
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await assert.rejects(
      sendSmtpMail({ ...MAIL, port, secure: true }, { timeoutMs: 5_000 }),
      (err: unknown) => err instanceof Error && /self-signed|unable to verify|DEPTH_ZERO/i.test(err.message),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("L348084 an implicit-TLS connection succeeds with rejectUnauthorized: false", async () => {
  const commands: string[] = [];
  const server = tls.createServer({ key: TLS_KEY, cert: TLS_CERT }, (socket) => {
    let buf = "";
    socket.write("220 test\r\n");
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      for (;;) {
        const nl = buf.indexOf("\r\n");
        if (nl === -1) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        commands.push(line);
        if (line.startsWith("EHLO")) socket.write("250-test\r\n250 SIZE 1\r\n");
        else if (line.startsWith("MAIL") || line.startsWith("RCPT")) socket.write("250 OK\r\n");
        else if (line === "DATA") socket.write("354 go\r\n");
        else if (line === ".") socket.write("250 queued\r\n");
        else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        }
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await sendSmtpMail({ ...MAIL, port, secure: true }, { timeoutMs: 5_000, rejectUnauthorized: false });
    // No STARTTLS on an implicit-TLS connection, by definition.
    assert.equal(commands.includes("STARTTLS"), false);
    assert.ok(commands.includes("."));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
