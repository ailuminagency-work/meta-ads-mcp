import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import {
  createMcpAdmission,
  DEFAULT_MCP_MAX_IN_FLIGHT,
  DEFAULT_MCP_RATE_LIMIT_PER_MINUTE,
  DEFAULT_MCP_MAX_IN_FLIGHT_PER_SUBJECT,
  DEFAULT_MCP_REQUEST_TIMEOUT_SECONDS,
  readMcpAdmissionConfig,
  type McpAdmission,
  type McpAdmissionConfig,
} from "../../src/transport/mcp-admission.js";
import { logger } from "../../src/utils/logger.js";
import {
  approveConsent,
  authorizeParams,
  CLAUDE_REDIRECT,
  codeFrom,
  OPERATOR_ID,
  pkce,
  postToken,
  registerClient,
  sessionCookieFor,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";
import { saveToken } from "../../src/store/meta-token-repo.js";

const SUBJECT_A = "100000000000001";
const SUBJECT_B = "100000000000002";

let server: http.Server | undefined;
let authServer: AuthServer | undefined;
let open: Array<() => void> = [];
let clock = 1_700_000_000_000;

afterEach(async () => {
  for (const release of open.splice(0)) release();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
  await authServer?.close();
  authServer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const config = (overrides: Partial<McpAdmissionConfig> = {}): McpAdmissionConfig => ({
  maxInFlight: 16,
  perSubjectPerWindow: 120,
  windowMs: 60_000,
  maxTrackedSubjects: 10_000,
  ...overrides,
});

async function start(admission: McpAdmission): Promise<string> {
  const app = express();
  app.post(
    "/mcp",
    (req, _res, next) => {
      const user = req.headers["x-test-user"];
      (req as express.Request & { auth?: unknown }).auth = { clientId: "synthetic-client", extra: typeof user === "string" ? { fbUserId: user } : {} };
      next();
    },
    admission,
    (req, res) => {
      if (req.headers["x-flood"] === "1") {
        res.setHeader("content-type", "application/octet-stream");
        res.write(Buffer.alloc(64 * 1024 * 1024));
        return;
      }
      if (req.headers["x-hold"] === "1") {
        open.push(() => {
          if (!res.writableEnded && !res.destroyed) res.json({ held: true });
        });
        return;
      }
      res.json({ ok: true });
    },
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function send(base: string, user: string, hold = false): { done: Promise<{ status: number; retryAfter: string | undefined; body: string }>; abort: () => void } {
  let abort = () => {};
  const done = new Promise<{ status: number; retryAfter: string | undefined; body: string }>((resolve, reject) => {
    const req = http.request(
      `${base}/mcp`,
      { method: "POST", agent: false, headers: { "x-test-user": user, "content-type": "application/json", ...(hold ? { "x-hold": "1" } : {}) } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] as string | undefined, body }));
      },
    );
    abort = () => req.destroy();
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNRESET") resolve({ status: 0, retryAfter: undefined, body: "" });
      else reject(error);
    });
    req.end("{}");
  });
  return { done, abort: () => abort() };
}

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("per-instance in-flight cap on /mcp (G3-04)", () => {
  it("admits the configured number of concurrent calls and answers the next with 429, Retry-After and a JSON-RPC body", async () => {
    const admission = createMcpAdmission(config({ maxInFlight: 16 }));
    const base = await start(admission);
    const held = Array.from({ length: 16 }, (_, index) => send(base, `user-${index}`, true));
    await until(() => admission.stats().inFlight === 16, "16 calls in flight");

    const refused = await send(base, "user-extra").done;

    expect(refused.status).toBe(429);
    expect(refused.retryAfter).toBe("1");
    expect(JSON.parse(refused.body)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Too many requests; retry after the interval in the Retry-After header" },
      id: null,
    });
    expect(admission.stats().rejectedInFlight).toBe(1);
    for (const release of open.splice(0)) release();
    expect((await Promise.all(held.map((h) => h.done))).every((r) => r.status === 200)).toBe(true);
  });

  it("frees the slot when a call finishes", async () => {
    const admission = createMcpAdmission(config({ maxInFlight: 1 }));
    const base = await start(admission);
    const first = send(base, SUBJECT_A, true);
    await until(() => admission.stats().inFlight === 1, "first call in flight");
    expect((await send(base, SUBJECT_B).done).status).toBe(429);

    for (const release of open.splice(0)) release();
    expect((await first.done).status).toBe(200);
    await until(() => admission.stats().inFlight === 0, "slot released");

    expect((await send(base, SUBJECT_B).done).status).toBe(200);
  });

  it("frees the slot when the client aborts mid-call", async () => {
    const admission = createMcpAdmission(config({ maxInFlight: 2 }));
    const base = await start(admission);
    const first = send(base, SUBJECT_A, true);
    const second = send(base, SUBJECT_B, true);
    await until(() => admission.stats().inFlight === 2, "two calls in flight");
    expect((await send(base, "user-extra").done).status).toBe(429);

    first.abort();
    second.abort();
    await until(() => admission.stats().inFlight === 0, "aborted calls released");

    expect((await send(base, "user-extra").done).status).toBe(200);
  });

  it("does not count a refused request as in flight and never releases twice", async () => {
    const admission = createMcpAdmission(config({ maxInFlight: 1 }));
    const base = await start(admission);
    const held = send(base, SUBJECT_A, true);
    await until(() => admission.stats().inFlight === 1, "held");
    for (let index = 0; index < 5; index += 1) expect((await send(base, SUBJECT_B).done).status).toBe(429);
    expect(admission.stats().inFlight).toBe(1);
    for (const release of open.splice(0)) release();
    await held.done;
    await until(() => admission.stats().inFlight === 0, "released");
    expect(admission.stats().inFlight).toBe(0);
  });
});

describe("per-subject sliding rate limit on /mcp (G3-04)", () => {
  it("allows the limit within the window, refuses the next with the time until the oldest call leaves the window", async () => {
    const admission = createMcpAdmission(config({ perSubjectPerWindow: 5 }), () => clock);
    const base = await start(admission);
    for (let index = 0; index < 5; index += 1) {
      expect((await send(base, SUBJECT_A).done).status).toBe(200);
      clock += 1_000;
    }
    clock += 25_000;

    const refused = await send(base, SUBJECT_A).done;

    expect(refused.status).toBe(429);
    expect(refused.retryAfter).toBe("30");
    expect(admission.stats().rejectedRate).toBe(1);
  });

  it("slides: the first call leaving the window admits exactly one more", async () => {
    const admission = createMcpAdmission(config({ perSubjectPerWindow: 2 }), () => clock);
    const base = await start(admission);
    const start0 = clock;
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    clock = start0 + 30_000;
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    clock = start0 + 59_999;
    expect((await send(base, SUBJECT_A).done).status).toBe(429);
    clock = start0 + 60_001;
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    expect((await send(base, SUBJECT_A).done).status).toBe(429);
  });

  it("does not let one subject spend another subject's allowance", async () => {
    const admission = createMcpAdmission(config({ perSubjectPerWindow: 2 }), () => clock);
    const base = await start(admission);
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    expect((await send(base, SUBJECT_A).done).status).toBe(429);
    expect((await send(base, SUBJECT_B).done).status).toBe(200);
  });

  it("does not spend allowance on a request refused by the in-flight cap", async () => {
    const admission = createMcpAdmission(config({ maxInFlight: 1, perSubjectPerWindow: 2 }), () => clock);
    const base = await start(admission);
    const held = send(base, SUBJECT_B, true);
    await until(() => admission.stats().inFlight === 1, "held");
    for (let index = 0; index < 4; index += 1) expect((await send(base, SUBJECT_A).done).status).toBe(429);
    for (const release of open.splice(0)) release();
    await held.done;
    await until(() => admission.stats().inFlight === 0, "released");

    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
  });

  it("fails closed when the tracking table is full of live subjects, and recovers once entries expire", async () => {
    const admission = createMcpAdmission(config({ maxTrackedSubjects: 3 }), () => clock);
    const base = await start(admission);
    for (const user of ["u1", "u2", "u3"]) expect((await send(base, user).done).status).toBe(200);

    const refused = await send(base, "u4").done;
    expect(refused.status).toBe(429);
    expect(refused.retryAfter).toBe("60");
    expect(admission.stats().rejectedCapacity).toBe(1);
    expect(admission.stats().trackedSubjects).toBe(3);
    expect((await send(base, "u1").done).status).toBe(200);

    clock += 61_000;
    expect((await send(base, "u4").done).status).toBe(200);
  });

  it("puts a request that carries no identity into one shared bucket instead of skipping the limit", async () => {
    const admission = createMcpAdmission(config({ perSubjectPerWindow: 2 }), () => clock);
    const app = express();
    app.post("/mcp", admission, (_req, res) => res.json({ ok: true }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = () => fetch(`${base}/mcp`, { method: "POST", body: "{}" }).then((r) => r.status);
    expect(await call()).toBe(200);
    expect(await call()).toBe(200);
    expect(await call()).toBe(429);
  });
});

describe("what the rejection log carries", () => {
  it("counts rejections without a raw identifier, token or key", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const admission = createMcpAdmission(config({ maxInFlight: 1, perSubjectPerWindow: 1 }), () => clock);
    const base = await start(admission);
    const held = send(base, SUBJECT_A, true);
    await until(() => admission.stats().inFlight === 1, "held");
    await send(base, SUBJECT_B).done;
    for (const release of open.splice(0)) release();
    await held.done;
    await until(() => admission.stats().inFlight === 0, "released");
    await send(base, SUBJECT_A).done;

    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalled();
    expect(logged).toContain("mcp_admission_rejected");
    expect(logged).toContain("rejectedTotal");
    expect(logged).not.toContain(SUBJECT_A);
    expect(logged).not.toContain(SUBJECT_B);
    expect(logged).not.toContain("synthetic-client");
  });

  it("logs at most once a second per reason and carries the number it suppressed", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const admission = createMcpAdmission(config({ perSubjectPerWindow: 1 }), () => clock);
    const base = await start(admission);
    await send(base, SUBJECT_A).done;
    for (let index = 0; index < 4; index += 1) await send(base, SUBJECT_A).done;
    expect(warn).toHaveBeenCalledTimes(1);
    clock += 1_500;
    await send(base, SUBJECT_A).done;
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls[1])).toContain('"suppressedSinceLastLog":3');
    expect(admission.stats().rejectedRate).toBe(5);
  });
});

describe("per-subject in-flight cap on /mcp (G1R-01, G3R-01)", () => {
  it("stops one subject at its cap with 429 and Retry-After while every other subject keeps being served", async () => {
    const admission = createMcpAdmission(config({ maxInFlight: 16, perSubjectInFlight: 4 }));
    const base = await start(admission);
    const held = Array.from({ length: 4 }, () => send(base, SUBJECT_A, true));
    await until(() => admission.stats().inFlight === 4, "four calls in flight");

    const refused = await Promise.all(Array.from({ length: 12 }, () => send(base, SUBJECT_A, true).done));

    expect(refused.every((response) => response.status === 429 && response.retryAfter === "1")).toBe(true);
    expect(admission.stats().inFlight).toBe(4);
    expect(admission.stats().rejectedSubjectInFlight).toBe(12);
    expect((await send(base, SUBJECT_B).done).status).toBe(200);
    for (const release of open.splice(0)) release();
    expect((await Promise.all(held.map((h) => h.done))).every((r) => r.status === 200)).toBe(true);
  });

  it("frees the subject's slots when its calls finish or are aborted", async () => {
    const admission = createMcpAdmission(config({ perSubjectInFlight: 2 }));
    const base = await start(admission);
    const first = send(base, SUBJECT_A, true);
    const second = send(base, SUBJECT_A, true);
    await until(() => admission.stats().inFlight === 2, "two calls in flight");
    expect((await send(base, SUBJECT_A).done).status).toBe(429);

    first.abort();
    await until(() => admission.stats().inFlight === 1, "one call released by the abort");
    expect((await send(base, SUBJECT_A).done).status).toBe(200);

    second.abort();
    await until(() => admission.stats().inFlight === 0, "all released");
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
  });

  it("does not spend rate allowance on a call refused by the per-subject cap", async () => {
    const admission = createMcpAdmission(config({ perSubjectInFlight: 2, perSubjectPerWindow: 3 }), () => clock);
    const base = await start(admission);
    send(base, SUBJECT_A, true);
    const second = send(base, SUBJECT_A, true);
    await until(() => admission.stats().inFlight === 2, "two calls in flight");
    for (let index = 0; index < 5; index += 1) expect((await send(base, SUBJECT_A).done).status).toBe(429);

    second.abort();
    await until(() => admission.stats().inFlight === 1, "one released");
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    expect((await send(base, SUBJECT_A).done).status).toBe(429);
    expect(admission.stats().rejectedRate).toBe(1);
  });

  it("logs a per-subject rejection with a hashed subject only", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const admission = createMcpAdmission(config({ perSubjectInFlight: 1 }), () => clock);
    const base = await start(admission);
    send(base, SUBJECT_A, true);
    await until(() => admission.stats().inFlight === 1, "held");
    await send(base, SUBJECT_A).done;

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('"reason":"subject_in_flight"');
    expect(logged).not.toContain(SUBJECT_A);
  });
});

describe("request watchdog and stalled readers on /mcp (G3R-01)", () => {
  it("ends a call that is still unanswered after the request timeout with a 504 and frees its slot", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const admission = createMcpAdmission(config({ maxInFlight: 1, requestTimeoutMs: 150 }));
    const base = await start(admission);
    const started = Date.now();
    const call = send(base, SUBJECT_A, true);

    const answer = await call.done;

    expect(answer.status).toBe(504);
    expect(JSON.parse(answer.body)).toEqual({ jsonrpc: "2.0", error: { code: -32000, message: "Request timed out" }, id: null });
    expect(Date.now() - started).toBeLessThan(2_000);
    await until(() => admission.stats().inFlight === 0, "slot released after the 504");
    expect(admission.stats().timedOut).toBe(1);
    expect(JSON.stringify(warn.mock.calls)).toContain("mcp_request_timed_out");
    expect((await send(base, SUBJECT_B).done).status).toBe(200);
  });

  it("does not touch a call that is answered in time", async () => {
    const admission = createMcpAdmission(config({ requestTimeoutMs: 400 }));
    const base = await start(admission);
    expect((await send(base, SUBJECT_A).done).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(admission.stats().timedOut).toBe(0);
  });

  it("destroys a response the client has stopped reading and frees the slot", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const admission = createMcpAdmission(config({ maxInFlight: 1, responseStallMs: 300, stallCheckMs: 50 }));
    const base = await start(admission);
    const port = Number(new URL(base).port);
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`POST /mcp HTTP/1.1\r\nHost: x\r\nx-test-user: ${SUBJECT_A}\r\nx-flood: 1\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}`);
      socket.pause();
    });
    socket.on("error", () => {});
    try {
      await until(() => admission.stats().inFlight === 1, "flooding call admitted");
      await until(() => admission.stats().stalled === 1, "stalled response detected");
      await until(() => admission.stats().inFlight === 0, "slot released after the stall");
      expect(JSON.stringify(warn.mock.calls)).toContain("mcp_response_stalled");
      expect((await send(base, SUBJECT_B).done).status).toBe(200);
    } finally {
      socket.destroy();
    }
  }, 15_000);
});

describe("configuration", () => {
  it("defaults to 16 in flight and 120 calls a minute per subject", () => {
    expect(readMcpAdmissionConfig({})).toMatchObject({ maxInFlight: DEFAULT_MCP_MAX_IN_FLIGHT, perSubjectPerWindow: DEFAULT_MCP_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 });
    expect(DEFAULT_MCP_MAX_IN_FLIGHT).toBe(16);
    expect(DEFAULT_MCP_RATE_LIMIT_PER_MINUTE).toBe(120);
  });

  it("defaults to 4 in flight per subject and a request timeout above the longest tool call", () => {
    const config = readMcpAdmissionConfig({});
    expect(config.perSubjectInFlight).toBe(DEFAULT_MCP_MAX_IN_FLIGHT_PER_SUBJECT);
    expect(config.perSubjectInFlight).toBe(4);
    expect(config.requestTimeoutMs).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_SECONDS * 1_000);
    expect(config.requestTimeoutMs).toBeGreaterThan(3_600_000);
  });

  it("reads the per-subject cap and the request timeout from the environment", () => {
    expect(readMcpAdmissionConfig({ MCP_MAX_IN_FLIGHT_PER_SUBJECT: "2", MCP_REQUEST_TIMEOUT_SECONDS: "300" })).toMatchObject({
      perSubjectInFlight: 2,
      requestTimeoutMs: 300_000,
    });
    expect(readMcpAdmissionConfig({ MCP_MAX_IN_FLIGHT_PER_SUBJECT: "", MCP_REQUEST_TIMEOUT_SECONDS: " " })).toMatchObject({ perSubjectInFlight: 4, requestTimeoutMs: 3_700_000 });
  });

  it.each(["0", "-1", "abc", "1.5", "1001"])("refuses MCP_MAX_IN_FLIGHT_PER_SUBJECT=%s instead of dropping the cap", (value) => {
    expect(() => readMcpAdmissionConfig({ MCP_MAX_IN_FLIGHT_PER_SUBJECT: value })).toThrow(/MCP_MAX_IN_FLIGHT_PER_SUBJECT must be a positive integer/);
  });

  it.each(["0", "29", "7201", "abc", "1.5", "-300"])("refuses MCP_REQUEST_TIMEOUT_SECONDS=%s instead of dropping the watchdog", (value) => {
    expect(() => readMcpAdmissionConfig({ MCP_REQUEST_TIMEOUT_SECONDS: value })).toThrow(/MCP_REQUEST_TIMEOUT_SECONDS must be an integer from 30 to 7200/);
  });

  it("reads both limits from the environment and treats an empty value as unset", () => {
    expect(readMcpAdmissionConfig({ MCP_MAX_IN_FLIGHT: "4", MCP_RATE_LIMIT_PER_MINUTE: "30" })).toMatchObject({ maxInFlight: 4, perSubjectPerWindow: 30 });
    expect(readMcpAdmissionConfig({ MCP_MAX_IN_FLIGHT: " ", MCP_RATE_LIMIT_PER_MINUTE: "" })).toMatchObject({ maxInFlight: 16, perSubjectPerWindow: 120 });
  });

  it.each(["0", "-1", "abc", "1.5", "1e3", "0x10", "1001", "99999999999"])("refuses MCP_MAX_IN_FLIGHT=%s instead of dropping the limit", (value) => {
    expect(() => readMcpAdmissionConfig({ MCP_MAX_IN_FLIGHT: value })).toThrow(/MCP_MAX_IN_FLIGHT must be a positive integer/);
  });

  it.each(["0", "-5", "many", "2.5", "100001"])("refuses MCP_RATE_LIMIT_PER_MINUTE=%s instead of dropping the limit", (value) => {
    expect(() => readMcpAdmissionConfig({ MCP_RATE_LIMIT_PER_MINUTE: value })).toThrow(/MCP_RATE_LIMIT_PER_MINUTE must be a positive integer/);
  });
});

describe("wired into the real transport", () => {
  async function bearer(env: Record<string, string | undefined>) {
    authServer = await startAuthServer(env);
    const client = await registerClient(authServer.origin);
    await saveToken({
      fbUserId: OPERATOR_ID,
      name: "personal",
      accessToken: "synthetic-access-token-value",
      kind: "user",
      expiresAt: null,
      metaUserId: OPERATOR_ID,
      metaUserName: "Synthetic",
      setAsDefault: true,
    });
    const jar = await sessionCookieFor(OPERATOR_ID);
    const { verifier, challenge } = pkce();
    const approved = await approveConsent(authServer.origin, jar, authorizeParams({ clientId: client.client_id, challenge }), "personal");
    const exchanged = await postToken(authServer.origin, {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: codeFrom(approved),
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(exchanged.status).toBe(200);
    return { origin: authServer.origin, token: ((await exchanged.json()) as { access_token: string }).access_token };
  }

  const ping = (origin: string, token: string) =>
    fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

  it("throttles an authenticated subject after MCP_RATE_LIMIT_PER_MINUTE calls and leaves unauthenticated 401s alone", async () => {
    const { origin, token } = await bearer({ MCP_RATE_LIMIT_PER_MINUTE: "3" });
    for (let index = 0; index < 3; index += 1) expect((await ping(origin, token)).status).toBe(200);

    const refused = await ping(origin, token);

    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await refused.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
    const anonymous = await fetch(`${origin}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(anonymous.status).toBe(401);
  });

  it("refuses to start with an unusable limit", async () => {
    await expect(startAuthServer({ MCP_MAX_IN_FLIGHT: "0" })).rejects.toThrow(/MCP_MAX_IN_FLIGHT must be a positive integer/);
  });
});
