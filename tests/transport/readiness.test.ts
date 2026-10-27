import express from "express";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const firestoreDouble = vi.hoisted(() => ({
  enabled: false,
  probe: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../../src/store/firestore.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/store/firestore.js")>()),
  isFirestoreEnabled: () => firestoreDouble.enabled,
  getFirestore: () => ({ doc: () => ({ get: () => firestoreDouble.probe() }) }),
}));

import {
  READINESS_STORAGE_TIMEOUT_MS,
  createReadinessCheck,
  createReadinessHandler,
  type ReadinessDeps,
} from "../../src/transport/readiness.js";
import { resetShutdownStateForTests } from "../../src/transport/graceful-shutdown.js";
import { startHttpTransport } from "../../src/transport/http.js";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";

const SENSITIVE = "PERMISSION_DENIED project=synthetic-secret-project key=synthetic-key-material";

function deps(overrides: Partial<ReadinessDeps> = {}): ReadinessDeps {
  return {
    env: { NODE_ENV: "development", DEPLOYMENT_MODE: "upstream" },
    storageConfigured: () => true,
    probeStorage: async () => undefined,
    checkKeyring: () => undefined,
    isShuttingDown: () => false,
    cacheTtlMs: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  firestoreDouble.enabled = false;
  firestoreDouble.probe.mockReset();
  resetShutdownStateForTests();
  resetOAuthProviderForTests();
});

describe("readiness check", () => {
  it("is ready only when storage, keyring and deployment mode all check out", async () => {
    const result = await createReadinessCheck(deps())();
    expect(result).toEqual({
      ready: true,
      checks: { deployment: "ok", keyring: "ok", storage: "ok" },
    });
  });

  it("is not ready, with a non-sensitive reason, when the Firestore round trip fails", async () => {
    const failing = vi.fn().mockRejectedValue(new Error(SENSITIVE));
    const result = await createReadinessCheck(deps({ probeStorage: failing }))();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("storage_unavailable");
    expect(result.checks.storage).toBe("fail");
    expect(JSON.stringify(result)).not.toContain("synthetic");
  });

  it("bounds the Firestore round trip at two seconds", async () => {
    vi.useFakeTimers();
    const hanging = vi.fn(() => new Promise<void>(() => undefined));
    let settled = false;
    const pending = createReadinessCheck(deps({ probeStorage: hanging }))().then((r) => {
      settled = true;
      return r;
    });
    expect(READINESS_STORAGE_TIMEOUT_MS).toBe(2000);
    await vi.advanceTimersByTimeAsync(READINESS_STORAGE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toMatchObject({ ready: false, reason: "storage_timeout" });
  });

  it("reports an encryption keyring that cannot load without leaking the cause", async () => {
    const result = await createReadinessCheck(
      deps({
        checkKeyring: () => {
          throw new Error(SENSITIVE);
        },
      }),
    )();
    expect(result).toMatchObject({ ready: false, reason: "keyring_unavailable" });
    expect(result.checks.keyring).toBe("fail");
    expect(JSON.stringify(result)).not.toContain("synthetic");
  });

  it("exercises the real keyring: production without any key is not ready", async () => {
    const { resetKeyCacheForTests } = await import("../../src/auth/crypto.js");
    resetKeyCacheForTests();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEYRING_JSON", "");
    const { checkEncryptionKeyring } = await import("../../src/transport/readiness.js");
    expect(() => checkEncryptionKeyring()).toThrow();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    resetKeyCacheForTests();
    expect(() => checkEncryptionKeyring()).not.toThrow();
    resetKeyCacheForTests();
  });

  it.each([
    [{ NODE_ENV: "production", DEPLOYMENT_MODE: "waiting" }, "deployment_mode_invalid"],
    [{ NODE_ENV: "production" }, "deployment_mode_invalid"],
    [{ NODE_ENV: "production", DEPLOYMENT_MODE: "awaiting_credentials" }, "deployment_mode_not_serving"],
    [{ NODE_ENV: "production", DEPLOYMENT_MODE: "agency" }, "deployment_config_invalid"],
  ] as const)("flags an inconsistent deployment mode %j", async (env, reason) => {
    const probe = vi.fn(async () => undefined);
    const result = await createReadinessCheck(deps({ env, probeStorage: probe }))();
    expect(result).toMatchObject({ ready: false, reason });
    expect(result.checks.deployment).toBe("fail");
  });

  it("requires storage in agency mode but skips it for a single-tenant deployment without Firestore", async () => {
    const agencyEnv = {
      NODE_ENV: "production",
      DEPLOYMENT_MODE: "agency",
      META_APP_ID: "123",
      META_APP_SECRET: "synthetic-app-secret",
      TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
      SESSION_COOKIE_SECRET: "synthetic-session-".repeat(3),
      OAUTH_SECRET: "synthetic-signing-".repeat(3),
      AUTH_ALLOWED_FB_USER_IDS: "123",
      FIRESTORE_PROJECT_ID: "synthetic-project",
      GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/synthetic.json",
      SERVER_URL: "https://agency.example.com",
    };
    const unconfigured = await createReadinessCheck(
      deps({ env: agencyEnv, storageConfigured: () => false }),
    )();
    expect(unconfigured).toMatchObject({ ready: false, reason: "storage_not_configured" });

    const configured = await createReadinessCheck(deps({ env: agencyEnv }))();
    expect(configured.ready).toBe(true);

    const single = await createReadinessCheck(
      deps({ storageConfigured: () => false, probeStorage: vi.fn() }),
    )();
    expect(single).toEqual({
      ready: true,
      checks: { deployment: "ok", keyring: "ok", storage: "skipped" },
    });
  });

  it("is not ready once shutdown has begun, without touching storage", async () => {
    const probe = vi.fn(async () => undefined);
    const result = await createReadinessCheck(
      deps({ isShuttingDown: () => true, probeStorage: probe }),
    )();
    expect(result).toMatchObject({ ready: false, reason: "shutting_down" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("coalesces concurrent probes and caches the answer so an unauthenticated caller cannot drive Firestore load", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => undefined);
    const check = createReadinessCheck(deps({ probeStorage: probe, cacheTtlMs: 5000 }));
    await Promise.all(Array.from({ length: 50 }, () => check()));
    expect(probe).toHaveBeenCalledTimes(1);
    await check();
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    await check();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("recovers on the next probe once Firestore is reachable again", async () => {
    vi.useFakeTimers();
    const probe = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error(SENSITIVE))
      .mockResolvedValue(undefined);
    const check = createReadinessCheck(deps({ probeStorage: probe, cacheTtlMs: 1000 }));
    expect((await check()).ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1001);
    expect((await check()).ready).toBe(true);
  });
});

describe("readiness handler", () => {
  async function serve(check: Parameters<typeof createReadinessHandler>[0]) {
    const app = express();
    app.get("/ready", createReadinessHandler(check));
    const server = await new Promise<Server>((resolve) => {
      const s = createNodeServer(app).listen(0, "127.0.0.1", () => resolve(s));
    });
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/ready`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it("answers 200 when ready and 503 with a reason code and no cache when not", async () => {
    let ready = true;
    const handle = await serve(async () =>
      ready
        ? { ready: true, checks: { deployment: "ok", keyring: "ok", storage: "ok" } }
        : {
            ready: false,
            reason: "storage_unavailable",
            checks: { deployment: "ok", keyring: "ok", storage: "fail" },
          },
    );
    try {
      const ok = await fetch(handle.url);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("no-store");
      expect(await ok.json()).toEqual({
        status: "ready",
        checks: { deployment: "ok", keyring: "ok", storage: "ok" },
      });
      ready = false;
      const down = await fetch(handle.url);
      expect(down.status).toBe(503);
      expect(down.headers.get("cache-control")).toBe("no-store");
      expect(await down.json()).toEqual({
        status: "not_ready",
        reason: "storage_unavailable",
        checks: { deployment: "ok", keyring: "ok", storage: "fail" },
      });
    } finally {
      await handle.close();
    }
  });

  it("never throws out of the route if the check itself blows up", async () => {
    const handle = await serve(async () => {
      throw new Error(SENSITIVE);
    });
    try {
      const response = await fetch(handle.url);
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).toContain("readiness_check_failed");
      expect(text).not.toContain("synthetic");
    } finally {
      await handle.close();
    }
  });
});

describe("/ready on the real HTTP transport", () => {
  async function boot() {
    for (const [key, value] of Object.entries({
      NODE_ENV: "production",
      DEPLOYMENT_MODE: "upstream",
      SERVER_URL: "https://agency.example.com",
      META_APP_ID: "",
      META_APP_SECRET: "",
      MCP_API_KEY: "",
      LUMIN_PLATFORM_ENABLED: "false",
      LUMIN_META_PRIVACY_ENABLED: "false",
      TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
      OAUTH_SECRET: randomBytes(32).toString("hex"),
    })) vi.stubEnv(key, value);
    resetOAuthProviderForTests();
    let server: Server | undefined;
    vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Express) {
      server = createNodeServer(this);
      server.listen(0, "127.0.0.1");
      return server;
    } as typeof express.application.listen);
    await startHttpTransport(() => new McpServer({ name: "ready-test", version: "1" }), 0);
    if (!server!.listening) await new Promise<void>((resolve) => server!.once("listening", resolve));
    return {
      origin: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`,
      close: () =>
        new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve()))),
    };
  }

  it("keeps /health as process liveness while /ready reflects a broken Firestore", async () => {
    firestoreDouble.enabled = true;
    firestoreDouble.probe.mockRejectedValue(new Error(SENSITIVE));
    const app = await boot();
    try {
      const health = await fetch(app.origin + "/health", { redirect: "manual" });
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ status: "ok" });
      expect(firestoreDouble.probe).not.toHaveBeenCalled();

      const ready = await fetch(app.origin + "/ready", { redirect: "manual" });
      expect(ready.status).toBe(503);
      const body = (await ready.json()) as { status: string; reason: string };
      expect(body).toMatchObject({ status: "not_ready", reason: "storage_unavailable" });
      expect(JSON.stringify(body)).not.toContain("synthetic");
      expect(firestoreDouble.probe).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("answers 200 on /ready over plain HTTP (no HTTPS redirect) when Firestore answers", async () => {
    firestoreDouble.enabled = true;
    firestoreDouble.probe.mockResolvedValue({ exists: false });
    const app = await boot();
    try {
      const ready = await fetch(app.origin + "/ready", { redirect: "manual" });
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({
        status: "ready",
        checks: { deployment: "ok", keyring: "ok", storage: "ok" },
      });
    } finally {
      await app.close();
    }
  });
});
