import crypto from "node:crypto";
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { createWaitingApp } from "../../src/transport/waiting.js";
import { startHttpTransport } from "../../src/transport/http.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown, touched: 0 }));

vi.mock("../../src/store/firestore.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/store/firestore.js")>()),
  getFirestore: () => {
    holder.touched++;
    return holder.db;
  },
  isFirestoreEnabled: () => true,
}));

const SRC = path.resolve(process.cwd(), "src");

function staticImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)\.js["']|(?:^|\n)\s*import\s+["'](\.{1,2}\/[^"']+)\.js["']/g)) {
    found.push(path.resolve(path.dirname(file), `${match[1] ?? match[2]}.ts`));
  }
  return found;
}

function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    pending.push(...staticImports(file));
  }
  return seen;
}

const relative = (files: Set<string>) => [...files].map((file) => path.relative(SRC, file).split(path.sep).join("/")).sort();

describe("credential-waiting mode cannot touch stored credentials", () => {
  it("statically reaches no store, crypto, keyring, migration or platform module from the entrypoint's eager imports", () => {
    const closure = relative(staticClosure(path.join(SRC, "index.ts")));
    expect(closure).toContain("transport/waiting.ts");
    const forbidden = closure.filter((file) =>
      file.startsWith("store/") || file.startsWith("platform/") ||
      /^auth\/(crypto|keyring|token-key-migration|platform-credential-key-migration|encrypted-corpus-retirement)/.test(file) ||
      file === "server.ts" || file === "transport/http.ts");
    expect(forbidden).toEqual([]);
  });

  it("serves its routes without any Firestore access or cipher operation", async () => {
    const cipher = vi.spyOn(crypto, "createCipheriv");
    const decipher = vi.spyOn(crypto, "createDecipheriv");
    holder.touched = 0;
    const server = createNodeServer(createWaitingApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${origin}/health`)).status).toBe(200);
      expect((await fetch(`${origin}/mcp`, { method: "POST" })).status).toBe(503);
      expect((await fetch(`${origin}/auth/meta/callback?code=x`)).status).toBe(503);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(holder.touched).toBe(0);
    expect(cipher).not.toHaveBeenCalled();
    expect(decipher).not.toHaveBeenCalled();
  });
});

describe("read-only agency boot writes and re-encrypts nothing", () => {
  let server: Server | undefined;
  let db: FakeFirestore;

  beforeEach(() => {
    db = new FakeFirestore();
    holder.db = db;
    holder.touched = 0;
    for (const [key, value] of Object.entries({
      NODE_ENV: "production",
      DEPLOYMENT_MODE: "agency",
      SERVER_URL: "https://agency.example.com",
      META_APP_ID: "300",
      META_APP_SECRET: "synthetic-app-secret",
      FIRESTORE_PROJECT_ID: "synthetic-project",
      TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
      TOKEN_ENCRYPTION_KEY_NEXT: crypto.randomBytes(32).toString("hex"),
      SESSION_COOKIE_SECRET: crypto.randomBytes(32).toString("hex"),
      OAUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      LUMIN_PLATFORM_ENABLED: "false",
      LUMIN_META_PRIVACY_ENABLED: "false",
      AGENCY_WRITES_ENABLED: "false",
      AUTH_ALLOWED_FB_USER_IDS: "800",
      MCP_API_KEY: "",
    })) vi.stubEnv(key, value);
    resetOAuthProviderForTests();
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetOAuthProviderForTests();
  });

  it("performs zero Firestore writes and zero cipher operations while booting and answering unauthenticated probes", async () => {
    const cipher = vi.spyOn(crypto, "createCipheriv");
    const decipher = vi.spyOn(crypto, "createDecipheriv");
    vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Express) {
      server = createNodeServer(this);
      server.listen(0, "127.0.0.1");
      return server;
    } as typeof express.application.listen);

    await startHttpTransport(() => new McpServer({ name: "synthetic-boot", version: "1" }), 0);
    if (!server!.listening) await new Promise<void>((resolve) => server!.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const headers = { "x-forwarded-proto": "https" };

    expect((await fetch(`${origin}/health`, { headers })).status).toBe(200);
    expect((await fetch(`${origin}/.well-known/oauth-authorization-server`, { headers })).status).toBe(200);
    expect((await fetch(`${origin}/mcp`, { method: "POST", headers })).status).toBe(401);

    expect(db.writeLog).toEqual([]);
    expect(db.docs.size).toBe(0);
    expect(cipher).not.toHaveBeenCalled();
    expect(decipher).not.toHaveBeenCalled();

    const registration = await fetch(`${origin}/register`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://client.example.com/callback"], token_endpoint_auth_method: "none" }),
    });
    expect(registration.status).toBe(201);
    expect(db.writeLog.map((entry) => entry.path.split("/")[0])).toContain("mcp_clients");
  });
});
