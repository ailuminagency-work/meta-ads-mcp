import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { echoStateOnAuthorizeErrors } from "../../src/transport/authorize-error-state.js";
import { saveToken } from "../../src/store/meta-token-repo.js";
import {
  approveConsent,
  authorizeParams,
  CLAUDE_REDIRECT,
  OPERATOR_ID,
  pkce,
  registerClient,
  sessionCookieFor,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("authorization error redirects echo the client's state (RFC 6749 4.1.2.1)", () => {
  it("does so for a consent form rejected for its code_challenge_method", async () => {
    server = await startAuthServer();
    const client = await registerClient(server.origin);
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
    const params = authorizeParams({
      clientId: client.client_id,
      challenge: pkce().challenge,
      method: "plain",
      state: "caller-state-123",
    });

    const response = await approveConsent(server.origin, jar, params, "personal");

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location")!);
    expect(target.origin + target.pathname).toBe(CLAUDE_REDIRECT);
    expect(target.searchParams.get("error")).toBe("invalid_request");
    expect(target.searchParams.get("state")).toBe("caller-state-123");
    expect(target.searchParams.get("code")).toBeNull();
  });

  it("no longer serves the single-tenant GET /authorize path: without a Meta login nobody can approve", async () => {
    server = await startAuthServer({ META_APP_ID: "", META_APP_SECRET: "" });
    const params = authorizeParams({
      clientId: "unregistered-client",
      challenge: pkce().challenge,
      method: "plain",
      state: "caller-state-456",
    });

    const response = await fetch(`${server.origin}/authorize?${params}`, { redirect: "manual" });

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("echoStateOnAuthorizeErrors", () => {
  async function withApp<T>(setup: (app: express.Express) => void, run: (origin: string) => Promise<T>): Promise<T> {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(echoStateOnAuthorizeErrors());
    setup(app);
    const listener: Server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    try {
      return await run(`http://127.0.0.1:${(listener.address() as AddressInfo).port}`);
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  }

  it("encodes a hostile state value instead of letting it add parameters", async () => {
    await withApp(
      (app) => app.get("/", (_req, res) => res.redirect(302, "https://claude.ai/cb?error=invalid_request")),
      async (origin) => {
        const hostile = "x&error=none&code=stolen#frag";
        const response = await fetch(`${origin}/?state=${encodeURIComponent(hostile)}`, { redirect: "manual" });
        const target = new URL(response.headers.get("location")!);
        expect(target.searchParams.get("state")).toBe(hostile);
        expect(target.searchParams.get("error")).toBe("invalid_request");
        expect(target.searchParams.get("code")).toBeNull();
        expect(target.hash).toBe("");
      },
    );
  });

  it("leaves success redirects, relative redirects and redirects that already carry state alone", async () => {
    await withApp(
      (app) => {
        app.get("/ok", (_req, res) => res.redirect(302, "https://claude.ai/cb?code=abc"));
        app.get("/relative", (_req, res) => res.redirect("/auth/meta?return=%2Fauthorize"));
        app.get("/has-state", (_req, res) => res.redirect(302, "https://claude.ai/cb?error=access_denied&state=theirs"));
        app.get("/no-state", (_req, res) => res.redirect(302, "https://claude.ai/cb?error=access_denied"));
      },
      async (origin) => {
        const location = async (path: string) =>
          (await fetch(`${origin}${path}`, { redirect: "manual" })).headers.get("location");
        expect(await location("/ok?state=s")).toBe("https://claude.ai/cb?code=abc");
        expect(await location("/relative?state=s")).toBe("/auth/meta?return=%2Fauthorize");
        expect(await location("/has-state?state=mine")).toBe("https://claude.ai/cb?error=access_denied&state=theirs");
        expect(await location("/no-state")).toBe("https://claude.ai/cb?error=access_denied");
      },
    );
  });

  it("reads the state of a posted request from the body", async () => {
    await withApp(
      (app) => app.post("/", (_req, res) => res.redirect(302, "cursor://anysphere.cursor-retrieval/oauth/cb?error=invalid_request")),
      async (origin) => {
        const response = await fetch(origin, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ state: "posted-state" }),
          redirect: "manual",
        });
        expect(new URL(response.headers.get("location")!).searchParams.get("state")).toBe("posted-state");
      },
    );
  });
});
