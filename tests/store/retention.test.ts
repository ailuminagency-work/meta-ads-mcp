import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVACY_PROVENANCE_COLLECTION } from "../../src/platform/meta-privacy-provenance.js";
import { dryRunProductionBootstrap, PRIVACY_RETENTION_INVARIANTS } from "../../src/platform/production-bootstrap.js";
import {
  authCodeExpireTime,
  AUTH_CODE_GRACE_SECONDS,
  CLIENT_EXTENSION_THRESHOLD_DAYS,
  CLIENT_IDLE_RETENTION_DAYS,
  clientExpireTime,
  clientNeedsExtension,
  CONDITIONAL_TTL_COLLECTIONS,
  expireTimeAfter,
  JTI_GRACE_SECONDS,
  jtiExpireTime,
  NEVER_TTL_COLLECTIONS,
  OAUTH_STORE_TTL_POLICIES,
  withoutExpireTime,
} from "../../src/store/retention.js";

const DAY_MS = 86_400_000;
const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const manifest = {
  version: 1, projectId: "lumin-staging", environment: "staging", releaseSha: "a".repeat(40), publicOrigin: "https://staging.example.com",
  serviceAccountEmail: "runtime@lumin-staging.iam.gserviceaccount.com", clientBillingOwnership: "CLIENT_OWNED", operatorAllowlist: ["100"],
  featureFlags: { writes: false, signals: false, messaging: false, workers: false },
};

describe("OAuth store expireTime derivation", () => {
  it("never expires a record before its logical expiry", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    expect(authCodeExpireTime({ expiresAt }).getTime()).toBe((expiresAt + AUTH_CODE_GRACE_SECONDS) * 1000);
    expect(jtiExpireTime({ expiresAt }).getTime()).toBe((expiresAt + JTI_GRACE_SECONDS) * 1000);
    expect(authCodeExpireTime({ expiresAt }).getTime()).toBeGreaterThan(expiresAt * 1000);
    expect(jtiExpireTime({ expiresAt }).getTime()).toBeGreaterThan(expiresAt * 1000);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])("refuses an invalid logical expiry %s instead of writing a bogus deadline", (value) => {
    expect(() => expireTimeAfter(value, 3600)).toThrow("RETENTION_EXPIRY_INVALID");
    expect(() => authCodeExpireTime({ expiresAt: value })).toThrow("RETENTION_EXPIRY_INVALID");
    expect(() => jtiExpireTime({ expiresAt: value })).toThrow("RETENTION_EXPIRY_INVALID");
  });

  it("refuses a negative grace", () => {
    expect(() => expireTimeAfter(1_800_000_000, -1)).toThrow("RETENTION_EXPIRY_INVALID");
  });

  it("gives an idle client 90 days and extends it only when under 45 days remain", () => {
    const now = Date.now();
    expect(clientExpireTime(now).getTime() - now).toBe(CLIENT_IDLE_RETENTION_DAYS * DAY_MS);
    expect(clientNeedsExtension(undefined, now)).toBe(true);
    expect(clientNeedsExtension(null, now)).toBe(true);
    expect(clientNeedsExtension(new Date(now + 89 * DAY_MS), now)).toBe(false);
    expect(clientNeedsExtension(new Date(now + (CLIENT_EXTENSION_THRESHOLD_DAYS - 1) * DAY_MS), now)).toBe(true);
    expect(clientNeedsExtension({ toDate: () => new Date(now + 60 * DAY_MS) }, now)).toBe(false);
    expect(clientNeedsExtension(new Date(Number.NaN), now)).toBe(true);
  });

  it("keeps persistence metadata out of protocol objects", () => {
    const stored = { client_id: "c", registered_at: 1, expireTime: new Date() };
    expect(withoutExpireTime(stored)).toEqual({ client_id: "c", registered_at: 1 });
  });
});

describe("OAuth store TTL policy table", () => {
  const byGroup = new Map(OAUTH_STORE_TTL_POLICIES.map((policy) => [policy.collectionGroup, policy]));

  it("covers each persisted OAuth collection exactly once, all on expireTime", () => {
    expect([...byGroup.keys()].sort()).toEqual(["mcp_auth_codes", "mcp_clients", "mcp_refresh_jti", "mcp_session_jti"]);
    expect(OAUTH_STORE_TTL_POLICIES).toHaveLength(4);
    for (const policy of OAUTH_STORE_TTL_POLICIES) expect(policy.field).toBe("expireTime");
  });

  it("bounds the maximum retention by the real credential lifetimes plus the grace", () => {
    expect(byGroup.get("mcp_auth_codes")!.maximumDays).toBeCloseTo((600 + AUTH_CODE_GRACE_SECONDS) / 86_400, 10);
    expect(byGroup.get("mcp_refresh_jti")!.maximumDays).toBe(31);
    expect(byGroup.get("mcp_session_jti")!.maximumDays).toBe(31);
    expect(byGroup.get("mcp_clients")!.maximumDays).toBe(90);
  });

  it("is recomputed whenever a credential lifetime changes", () => {
    expect(source("src/auth/oauth-provider.ts")).toContain("const REFRESH_TTL_SECONDS = 30 * 24 * 3600;");
    expect(source("src/auth/oauth-provider.ts")).toContain("expiresAt: Math.floor(Date.now() / 1000) + 600,");
    expect(source("src/auth/session.ts")).toContain("const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;");
    expect(CLIENT_IDLE_RETENTION_DAYS).toBeGreaterThan(30);
  });

  it("keeps an idle client record at least twice as long as the 30 day refresh lifetime", () => {
    expect(CLIENT_IDLE_RETENTION_DAYS * 86_400).toBeGreaterThan(30 * 86_400 * 2);
  });
});

describe("records that carry privacy tombstones or financial checkpoints are never deletable by TTL", () => {
  const result = dryRunProductionBootstrap(manifest);
  const plans = new Map(result.ttl.map((plan) => [plan.collectionGroup, plan as { collectionGroup: string; onlyWhen?: string }]));

  it("lists no TTL for any protected collection", () => {
    for (const collection of NEVER_TTL_COLLECTIONS) expect(plans.has(collection), collection).toBe(false);
  });

  it("allows TTL on the conditional collections only with an explicit safe-state condition", () => {
    for (const collection of CONDITIONAL_TTL_COLLECTIONS) {
      const plan = plans.get(collection);
      expect(plan, collection).toBeDefined();
      expect(plan!.onlyWhen, collection).toBeTruthy();
    }
  });

  it("names the privacy provenance collection from the source constant", () => {
    expect(NEVER_TTL_COLLECTIONS).toContain(PRIVACY_PROVENANCE_COLLECTION);
  });

  it("keeps the documented invariants aligned with the protected list", () => {
    const invariants = PRIVACY_RETENTION_INVARIANTS.join(" ");
    expect(invariants).toContain("platform_crm_no_resend");
    expect(invariants).toContain("WhatsApp setup phone locks");
    expect(invariants).toContain("privacy subject locks");
  });

  it("does not list a protected collection among the OAuth store policies", () => {
    for (const policy of OAUTH_STORE_TTL_POLICIES) expect(NEVER_TTL_COLLECTIONS).not.toContain(policy.collectionGroup);
  });
});
