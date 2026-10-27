import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dryRunProductionBootstrap } from "../../src/platform/production-bootstrap.js";
import { FirestoreAuthCodesStore } from "../../src/store/persistent-auth-codes.js";
import { FirestoreClientsStore } from "../../src/store/persistent-clients-store.js";
import { FirestoreJtiStore } from "../../src/store/persistent-jti-store.js";
import { NEVER_TTL_COLLECTIONS, OAUTH_STORE_TTL_POLICIES } from "../../src/store/retention.js";
import { FakeDocRef, FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({ getFirestore: () => holder.db, isFirestoreEnabled: () => true }));

const DAY_MS = 86_400_000;
const nowSeconds = () => Math.floor(Date.now() / 1000);
let db: FakeFirestore;

beforeEach(() => {
  db = new FakeFirestore();
  holder.db = db;
});

describe("authorization code store", () => {
  const entry = (overrides = {}) => ({ clientId: "c", codeChallenge: "x", redirectUri: "https://claude.ai/api/mcp/auth_callback", expiresAt: nowSeconds() + 600, ...overrides });

  it("stamps expireTime one hour after the logical expiry and never returns it", async () => {
    const store = new FirestoreAuthCodesStore();
    const value = entry();
    await store.set("code-1", value);
    const stored = db.read("mcp_auth_codes/code-1")!;
    expect((stored.expireTime as Date).getTime()).toBe((value.expiresAt + 3600) * 1000);
    expect(await store.get("code-1")).toEqual(value);
    expect(await store.consume("code-1")).toEqual(value);
    expect(await store.consume("code-1")).toBeUndefined();
  });

  it("also stamps codes bound to a Facebook user", async () => {
    await new FirestoreAuthCodesStore().set("code-2", entry({ fbUserId: "synthetic-user" }));
    expect(db.read("mcp_auth_codes/code-2")!.expireTime).toBeInstanceOf(Date);
  });

  it("refuses to persist a code with an invalid expiry instead of writing an undeletable record", async () => {
    await expect(new FirestoreAuthCodesStore().set("code-3", entry({ expiresAt: Number.NaN }))).rejects.toThrow("RETENTION_EXPIRY_INVALID");
    expect(db.docs.size).toBe(0);
  });
});

describe("JWT id stores", () => {
  it.each(["mcp_refresh_jti", "mcp_session_jti"])("stamps %s with expireTime one day after expiry and keeps allow-list semantics", async (collection) => {
    const store = new FirestoreJtiStore(collection);
    const expiresAt = nowSeconds() + 3600;
    await store.put("jti-1", { expiresAt, meta: { clientId: "c", fbUserId: "synthetic-user" } });
    expect((db.read(`${collection}/jti-1`)!.expireTime as Date).getTime()).toBe((expiresAt + 86_400) * 1000);
    expect(await store.has("jti-1")).toBe(true);
    expect(await store.consume("jti-1")).toBe(true);
    expect(await store.consume("jti-1")).toBe(false);
  });

  it("treats an expired record as absent even before Firestore reaps it", async () => {
    const store = new FirestoreJtiStore("mcp_session_jti");
    await store.put("jti-2", { expiresAt: nowSeconds() - 5 });
    expect(await store.has("jti-2")).toBe(false);
  });
});

describe("registered client store", () => {
  const client = (): OAuthClientInformationFull => ({ client_id: "client-1", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Synthetic" } as OAuthClientInformationFull);

  it("registers with a 90 day deadline and never hands it back to the SDK", async () => {
    const store = new FirestoreClientsStore();
    const before = Date.now();
    await store.registerClient(client());
    const deadline = (db.read("mcp_clients/client-1")!.expireTime as Date).getTime();
    expect(deadline - before).toBeGreaterThanOrEqual(90 * DAY_MS - 1000);
    expect(deadline - before).toBeLessThanOrEqual(90 * DAY_MS + 5000);
    expect(await store.getClient("client-1")).not.toHaveProperty("expireTime");
  });

  it("does not rewrite a client with a healthy deadline", async () => {
    const store = new FirestoreClientsStore();
    await store.registerClient(client());
    db.writeLog.length = 0;
    await store.getClient("client-1");
    expect(db.writeLog).toEqual([]);
  });

  it("extends a client that is under 45 days from reaping and backfills legacy clients", async () => {
    const store = new FirestoreClientsStore();
    db.seed("mcp_clients/near", { ...client(), client_id: "near", expireTime: new Date(Date.now() + 10 * DAY_MS) });
    db.seed("mcp_clients/legacy", { ...client(), client_id: "legacy", registered_at: 1 });
    await store.getClient("near");
    await store.getClient("legacy");
    for (const id of ["near", "legacy"]) {
      expect((db.read(`mcp_clients/${id}`)!.expireTime as Date).getTime() - Date.now()).toBeGreaterThan(89 * DAY_MS);
    }
  });

  it("still serves the client when the extension write fails", async () => {
    const store = new FirestoreClientsStore();
    db.seed("mcp_clients/client-2", { ...client(), client_id: "client-2" });
    db.failWritesTo = () => true;
    expect(await store.getClient("client-2")).toMatchObject({ client_id: "client-2" });
  });

  it("reports an unknown client as absent", async () => {
    expect(await new FirestoreClientsStore().getClient("missing")).toBeUndefined();
  });
});

describe("bootstrap dry-run and operations guide list the OAuth store policies", () => {
  const manifest = {
    version: 1, projectId: "lumin-staging", environment: "staging", releaseSha: "a".repeat(40), publicOrigin: "https://staging.example.com",
    serviceAccountEmail: "runtime@lumin-staging.iam.gserviceaccount.com", clientBillingOwnership: "CLIENT_OWNED", operatorAllowlist: ["100"],
    featureFlags: { writes: false, signals: false, messaging: false, workers: false },
  };

  it("includes each policy with the same bound", () => {
    const plans = new Map(dryRunProductionBootstrap(manifest).ttl.map((plan) => [plan.collectionGroup, plan]));
    for (const policy of OAUTH_STORE_TTL_POLICIES) {
      expect(plans.get(policy.collectionGroup), policy.collectionGroup).toMatchObject({ field: "expireTime", maximumDays: policy.maximumDays });
    }
  });

  it("names every collection in the operations guide", () => {
    const guide = readFileSync(path.resolve(process.cwd(), "docs/operations.md"), "utf8");
    for (const policy of OAUTH_STORE_TTL_POLICIES) expect(guide).toContain(`\`${policy.collectionGroup}\``);
  });
});

describe("registered client store keeps the registration policy on register and on read", () => {
  const UNSAFE = "https://attacker.example.com/cb";
  const SAFE = "https://claude.ai/api/mcp/auth_callback";
  const client = (id: string, redirectUris: string[]): OAuthClientInformationFull => ({ client_id: id, redirect_uris: redirectUris, client_name: "Synthetic" } as OAuthClientInformationFull);

  afterEach(() => vi.restoreAllMocks());

  it("refuses to register a client whose redirect URI fails the policy and writes nothing", async () => {
    await expect(new FirestoreClientsStore().registerClient(client("bad", [UNSAFE]))).rejects.toThrow();
    expect(db.docs.size).toBe(0);
    expect(db.writeLog).toEqual([]);
  });

  it("serves a stored client whose redirect URIs fail the policy as unknown and does not extend its deadline", async () => {
    const near = new Date(Date.now() + 10 * DAY_MS);
    db.seed("mcp_clients/legacy-bad", { ...client("legacy-bad", [UNSAFE]), expireTime: near });
    db.seed("mcp_clients/legacy-bad-nodeadline", { ...client("legacy-bad-nodeadline", [UNSAFE]) });
    db.writeLog.length = 0;
    const store = new FirestoreClientsStore();
    expect(await store.getClient("legacy-bad")).toBeUndefined();
    expect(await store.getClient("legacy-bad-nodeadline")).toBeUndefined();
    expect(db.writeLog).toEqual([]);
    expect((db.read("mcp_clients/legacy-bad")!.expireTime as Date).getTime()).toBe(near.getTime());
    expect(db.read("mcp_clients/legacy-bad-nodeadline")).not.toHaveProperty("expireTime");
  });

  it("treats a client with one failing redirect URI among acceptable ones as unknown", async () => {
    db.seed("mcp_clients/mixed", { ...client("mixed", [SAFE, UNSAFE]), expireTime: new Date(Date.now() + 80 * DAY_MS) });
    expect(await new FirestoreClientsStore().getClient("mixed")).toBeUndefined();
  });

  it("serves and extends an acceptable client, still without handing expireTime to the SDK", async () => {
    db.seed("mcp_clients/good", { ...client("good", [SAFE]), registered_at: 1, expireTime: new Date(Date.now() + 5 * DAY_MS) });
    const served = await new FirestoreClientsStore().getClient("good");
    expect(served).toMatchObject({ client_id: "good", redirect_uris: [SAFE] });
    expect(Object.keys(served!)).not.toContain("expireTime");
    expect(JSON.stringify(served)).not.toContain("expireTime");
    expect((db.read("mcp_clients/good")!.expireTime as Date).getTime() - Date.now()).toBeGreaterThan(89 * DAY_MS);
  });

  it("a rejected extension write does not fail authentication", async () => {
    db.seed("mcp_clients/good", { ...client("good", [SAFE]), expireTime: new Date(Date.now() + 5 * DAY_MS) });
    db.failWritesTo = () => true;
    await expect(new FirestoreClientsStore().getClient("good")).resolves.toMatchObject({ client_id: "good" });
  });

  it("an extension write that throws synchronously does not fail authentication either", async () => {
    db.seed("mcp_clients/good", { ...client("good", [SAFE]) });
    vi.spyOn(FakeDocRef.prototype, "update").mockImplementation(() => { throw new Error("synthetic synchronous failure"); });
    await expect(new FirestoreClientsStore().getClient("good")).resolves.toMatchObject({ client_id: "good" });
  });

  it("a client deleted between the read and the extension is not resurrected as a stub", async () => {
    db.seed("mcp_clients/gone", { ...client("gone", [SAFE]), expireTime: new Date(Date.now() + 5 * DAY_MS) });
    const original = db.commitWrite.bind(db);
    db.commitWrite = ((path: string, mode: "set" | "update", data: Record<string, unknown>, merge: boolean) => {
      db.docs.delete(path);
      return original(path, mode, data, merge);
    }) as never;
    await expect(new FirestoreClientsStore().getClient("gone")).resolves.toMatchObject({ client_id: "gone" });
    expect(db.docs.has("mcp_clients/gone")).toBe(false);
  });

  it("registration through the store keeps the policy check ahead of the write and stamps the deadline", async () => {
    const store = new FirestoreClientsStore();
    const registered = await store.registerClient(client("fresh", [SAFE]));
    expect(registered).not.toHaveProperty("expireTime");
    expect(db.read("mcp_clients/fresh")).toMatchObject({ client_id: "fresh", expireTime: expect.any(Date) });
  });
});

describe("persistence metadata is never handed to the OAuth SDK or its callers", () => {
  it("authorization codes lose expireTime on get and consume and keep every protocol field", async () => {
    const store = new FirestoreAuthCodesStore();
    const value = { clientId: "c", codeChallenge: "x", redirectUri: "https://claude.ai/api/mcp/auth_callback", redirectUriRequired: true, resource: "https://resource.example.com/mcp", fbUserId: "synthetic-user", expiresAt: nowSeconds() + 600 };
    await store.set("code-9", value);
    expect(db.read("mcp_auth_codes/code-9")).toHaveProperty("expireTime");
    const read = await store.get("code-9");
    expect(read).toEqual(value);
    expect(Object.keys(read!)).not.toContain("expireTime");
    const consumed = await store.consume("code-9");
    expect(consumed).toEqual(value);
    expect(Object.keys(consumed!)).not.toContain("expireTime");
  });

  it("JWT id entries lose expireTime on get", async () => {
    const store = new FirestoreJtiStore("mcp_refresh_jti");
    const entry = { expiresAt: nowSeconds() + 3600, meta: { kind: "code_redeemed", family: "f" } };
    await store.put("rtcode:abc", entry);
    expect(db.read("mcp_refresh_jti/rtcode:abc")).toHaveProperty("expireTime");
    const read = await store.get("rtcode:abc");
    expect(read).toEqual(entry);
    expect(Object.keys(read!)).not.toContain("expireTime");
  });

  it("the rotation tombstone written inside the consume transaction gets a deadline like every other jti record", async () => {
    const store = new FirestoreJtiStore("mcp_refresh_jti");
    await store.put("jti-live", { expiresAt: nowSeconds() + 3600 });
    const tombstone = { id: "rtrot:jti-live", entry: { expiresAt: nowSeconds() + 60, meta: { kind: "rotated" } } };
    expect(await store.consume("jti-live", { tombstone })).toBe(true);
    const stored = db.read("mcp_refresh_jti/rtrot:jti-live")!;
    expect((stored.expireTime as Date).getTime()).toBe((tombstone.entry.expiresAt + 86_400) * 1000);
    expect(await store.get("rtrot:jti-live")).toEqual(tombstone.entry);
    expect(db.read("mcp_refresh_jti/jti-live")).toBeUndefined();
  });

  it("a failed consume writes no tombstone and so no orphan deadline", async () => {
    const store = new FirestoreJtiStore("mcp_refresh_jti");
    expect(await store.consume("never-issued", { tombstone: { id: "rtrot:never-issued", entry: { expiresAt: nowSeconds() + 60 } } })).toBe(false);
    expect(db.docs.size).toBe(0);
  });
});

describe("every record the real OAuth flow writes carries a retention deadline", () => {
  const OPERATOR = "100000000000001";
  const GRACE_MS = 60_000;
  const flowClient: OAuthClientInformationFull = {
    client_id: "synthetic-flow-client", client_name: "Synthetic", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", client_id_issued_at: 1,
  } as OAuthClientInformationFull;
  type Provider = typeof import("../../src/auth/oauth-provider.js")["oauthProvider"];
  let provider: Provider;
  let reset: () => void;

  beforeEach(async () => {
    vi.stubEnv("OAUTH_SECRET", "x".repeat(64));
    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OPERATOR);
    const mod = await import("../../src/auth/oauth-provider.js");
    provider = mod.oauthProvider;
    reset = mod.resetOAuthProviderForTests;
    reset();
    provider.configure({
      authCodesStore: new FirestoreAuthCodesStore(),
      refreshJtiStore: new FirestoreJtiStore("mcp_refresh_jti"),
      resolvePendingAuth: () => ({ fbUserId: OPERATOR }),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    reset();
  });

  const seen = new Map<string, Record<string, unknown>>();
  const snapshot = () => {
    for (const path of db.docs.keys()) if (path.startsWith("mcp_")) seen.set(path, db.read(path)!);
  };

  it("stamps the code, the redemption marker, the refresh jti, the rotation tombstone and the family revocation", async () => {
    seen.clear();
    const verifier = randomBytes(32).toString("base64url");
    const redirect = vi.fn();
    await provider.authorize(
      flowClient,
      { codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256", redirectUri: flowClient.redirect_uris[0], scopes: [] },
      { redirect } as unknown as Response,
    );
    const code = new URL(redirect.mock.calls[0][1]).searchParams.get("code")!;
    snapshot();
    const tokens = await provider.exchangeAuthorizationCode(flowClient, code, verifier, flowClient.redirect_uris[0]);
    snapshot();
    await provider.exchangeRefreshToken(flowClient, tokens.refresh_token!);
    snapshot();
    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    await expect(provider.exchangeAuthorizationCode(flowClient, code, verifier, flowClient.redirect_uris[0])).rejects.toThrow();
    snapshot();

    const kinds = new Set<string>();
    expect(seen.size).toBeGreaterThanOrEqual(5);
    for (const [path, data] of seen) {
      const grace = path.startsWith("mcp_auth_codes/") ? 3_600 : 86_400;
      const expiresAt = data.expiresAt as number;
      const expireTime = data.expireTime as Date;
      expect(expireTime, path).toBeInstanceOf(Date);
      expect(expireTime.getTime(), path).toBe((expiresAt + grace) * 1000);
      const kind = (data.meta as { kind?: string } | undefined)?.kind;
      if (kind) kinds.add(kind);
    }
    expect([...kinds].sort()).toEqual(["code_redeemed", "family_revoked", "rotated"]);
    expect([...seen.keys()].some((path) => path.startsWith("mcp_auth_codes/"))).toBe(true);
  });
});

describe("no protected record can be given a TTL plan through the OAuth store policies or the bootstrap plan", () => {
  const manifest = {
    version: 1, projectId: "lumin-staging", environment: "staging", releaseSha: "a".repeat(40), publicOrigin: "https://staging.example.com",
    serviceAccountEmail: "runtime@lumin-staging.iam.gserviceaccount.com", clientBillingOwnership: "CLIENT_OWNED", operatorAllowlist: ["100"],
    featureFlags: { writes: false, signals: false, messaging: false, workers: false },
  };
  const plans = () => new Map(dryRunProductionBootstrap(manifest).ttl.map((plan) => [plan.collectionGroup, plan as { collectionGroup: string; onlyWhen?: string }]));

  it("keeps every privacy tombstone, no-resend ledger, setup phone lock and business-owner artifact out of the plan", () => {
    for (const name of ["platform_meta_privacy_subject_locks", "platform_meta_privacy_provenance", "platform_crm_no_resend", "platform_whatsapp_setup_phone_locks", "businessOwnerAttestations"]) {
      expect(NEVER_TTL_COLLECTIONS, name).toContain(name);
      expect(plans().has(name), name).toBe(false);
    }
  });

  it("allows a TTL on financial checkpoints and reserved budgets only under an explicit safe-state condition", () => {
    expect(plans().get("researchFinancialCheckpoints")).toMatchObject({ onlyWhen: "SETTLED_never_UNRESOLVED" });
    expect(plans().get("researchBudgets")).toMatchObject({ onlyWhen: "reservedCents_equals_zero" });
  });

  it("adds exactly the four OAuth collections to the plan and none of them is protected or conditional", () => {
    const added = OAUTH_STORE_TTL_POLICIES.map((policy) => policy.collectionGroup).sort();
    expect(added).toEqual(["mcp_auth_codes", "mcp_clients", "mcp_refresh_jti", "mcp_session_jti"]);
    for (const name of added) {
      expect(NEVER_TTL_COLLECTIONS).not.toContain(name);
      expect(plans().get(name)!.onlyWhen).toBeUndefined();
    }
  });
});
