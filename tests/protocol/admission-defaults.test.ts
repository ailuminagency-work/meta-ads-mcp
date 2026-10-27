import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import { bootServer, forgeAccessToken, FB_USER_ID, INITIALIZE_BODY, mcpPost, OTHER_FB_USER_ID, type Harness } from "./harness.js";
import { saveToken, upsertUser } from "../../src/store/meta-token-repo.js";

/**
 * Every other protocol test boots with MCP_MAX_IN_FLIGHT=1000 and
 * MCP_RATE_LIMIT_PER_MINUTE=100000, so nothing else in the suite sees the limits
 * an operator gets. This file removes both overrides: the server runs with the
 * production defaults (16 in flight, 4 per subject, 120 a minute).
 */
const PRODUCTION_LIMITS = {
  MCP_MAX_IN_FLIGHT: undefined,
  MCP_MAX_IN_FLIGHT_PER_SUBJECT: undefined,
  MCP_RATE_LIMIT_PER_MINUTE: undefined,
  MCP_REQUEST_TIMEOUT_SECONDS: undefined,
};

let harness: Harness;
let sockets: net.Socket[] = [];

async function register(): Promise<void> {
  for (const id of [FB_USER_ID, OTHER_FB_USER_ID]) {
    await upsertUser(id, { id, name: id, email: null, pictureUrl: null });
    await saveToken({
      fbUserId: id,
      name: "personal",
      accessToken: `SYNTHETIC-${id}`,
      kind: "system_user",
      expiresAt: null,
      metaUserId: id,
      metaUserName: id,
      setAsDefault: true,
    });
  }
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

/** Opens a POST /mcp whose body never completes, and reports the status line if the server answers. */
function stalledCall(port: number, token: string): { answered: Promise<number | null>; socket: net.Socket } {
  const socket = net.connect(port, "127.0.0.1");
  sockets.push(socket);
  socket.on("error", () => {});
  socket.on("connect", () => {
    socket.write(
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: Bearer ${token}\r\nContent-Length: 5000\r\n\r\n{"jsonrpc"`,
    );
  });
  const answered = new Promise<number | null>((resolve) => {
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString();
      const match = /^HTTP\/1\.1 (\d{3})/.exec(received);
      if (match) resolve(Number(match[1]));
    });
    setTimeout(() => resolve(null), 1_500).unref();
  });
  return { answered, socket };
}

describe("/mcp admission with the production defaults", () => {
  beforeAll(async () => {
    harness = await bootServer({ env: PRODUCTION_LIMITS });
    await register();
  });
  afterAll(async () => {
    await harness.close();
  });

  it("lets one subject hold four stalled calls, refuses its fifth and later ones at once, and keeps serving everyone else", async () => {
    const port = Number(new URL(harness.origin).port);
    const a = await forgeAccessToken({ fbUserId: FB_USER_ID });
    const b = await forgeAccessToken({ fbUserId: OTHER_FB_USER_ID });
    expect((await mcpPost(harness.origin, b, INITIALIZE_BODY)).status).toBe(200);

    const calls = Array.from({ length: 16 }, () => stalledCall(port, a));
    const answers = await Promise.all(calls.map((call) => call.answered));

    expect(answers.filter((status) => status === 429)).toHaveLength(12);
    expect(answers.filter((status) => status === null)).toHaveLength(4);
    const duringB = await mcpPost(harness.origin, b, INITIALIZE_BODY);
    expect(duringB.status).toBe(200);
    const duringA = await mcpPost(harness.origin, a, INITIALIZE_BODY);
    expect(duringA.status).toBe(429);
    expect(duringA.headers.get("retry-after")).toBe("1");
    expect((await mcpPost(harness.origin, undefined, INITIALIZE_BODY)).status).toBe(401);
  }, 30_000);

  it("frees the subject's slots when its stalled connections are aborted", async () => {
    const port = Number(new URL(harness.origin).port);
    const a = await forgeAccessToken({ fbUserId: FB_USER_ID });
    const held = Array.from({ length: 4 }, () => stalledCall(port, a));
    await Promise.all(held.map((call) => call.answered));
    expect((await mcpPost(harness.origin, a, INITIALIZE_BODY)).status).toBe(429);

    for (const call of held) call.socket.destroy();
    const deadline = Date.now() + 3_000;
    let status = 429;
    while (status === 429 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = (await mcpPost(harness.origin, a, INITIALIZE_BODY)).status;
    }
    expect(status).toBe(200);
  }, 30_000);
});

describe("/mcp rate limit with the production default", () => {
  beforeAll(async () => {
    harness = await bootServer({ env: PRODUCTION_LIMITS });
    await register();
  });
  afterAll(async () => {
    await harness.close();
  });

  it("answers the 121st call of a subject in a minute with 429 and leaves another subject untouched", async () => {
    const a = await forgeAccessToken({ fbUserId: FB_USER_ID });
    const b = await forgeAccessToken({ fbUserId: OTHER_FB_USER_ID });
    const statuses: number[] = [];
    for (let call = 0; call < 125; call += 1) statuses.push((await mcpPost(harness.origin, a, INITIALIZE_BODY)).status);

    expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(120)).toEqual([429, 429, 429, 429, 429]);
    expect((await mcpPost(harness.origin, b, INITIALIZE_BODY)).status).toBe(200);
  }, 120_000);
});
