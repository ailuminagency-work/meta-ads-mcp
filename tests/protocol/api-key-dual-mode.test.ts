import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveToken, upsertUser } from "../../src/store/meta-token-repo.js";
import { bootServer, FB_USER_ID, forgeAccessToken, INITIALIZE_BODY, mcpPost, nextClientAddress, type Harness } from "./harness.js";

const KEY = createHash("sha256").update("dual-mode-lockout-fixture").digest("hex");
const META_TOKEN = "synthetic-meta-token-".concat("x9".repeat(8));

let harness: Harness;

beforeAll(async () => {
  harness = await bootServer({ env: { DEPLOYMENT_MODE: "upstream", MCP_API_KEY: KEY } });
  await upsertUser(FB_USER_ID, { id: FB_USER_ID, name: "Synthetic Operator", email: null, pictureUrl: null });
  await saveToken({
    fbUserId: FB_USER_ID,
    name: "personal",
    accessToken: "synthetic-stored-meta-token",
    kind: "system_user",
    expiresAt: null,
    metaUserId: FB_USER_ID,
    metaUserName: "Synthetic Operator",
    setAsDefault: true,
  });
});

afterAll(async () => {
  await harness.close();
});

const from = (address: string) => ({ "x-forwarded-for": address });
const apiKeyFrom = (address: string) => ({ ...from(address), "x-api-key": KEY, "x-meta-token": META_TOKEN });

async function junkUntilLocked(address: string): Promise<number[]> {
  const seen: number[] = [];
  for (let index = 0; index < 22; index += 1) {
    seen.push((await mcpPost(harness.origin, `not-a-token-${index}`, INITIALIZE_BODY, from(address))).status);
  }
  return seen;
}

describe("dual mode (Meta OAuth plus MCP_API_KEY): the lockout belongs to the API-key credential (G1D-04)", () => {
  it("serves a valid OAuth bearer from an address that other credentials have locked out", async () => {
    const address = nextClientAddress();
    const oauth = await forgeAccessToken({ fbUserId: FB_USER_ID });
    expect((await mcpPost(harness.origin, oauth, INITIALIZE_BODY, from(address))).status).toBe(200);

    const seen = await junkUntilLocked(address);
    expect(seen.filter((code) => code === 401)).toHaveLength(20);
    expect(seen.filter((code) => code === 429)).toHaveLength(2);

    for (let call = 0; call < 5; call += 1) {
      expect((await mcpPost(harness.origin, oauth, INITIALIZE_BODY, from(address))).status).toBe(200);
    }
  });

  it("serves a valid OAuth bearer from a locked address even with a junk X-API-Key alongside it", async () => {
    const address = nextClientAddress();
    await junkUntilLocked(address);
    const oauth = await forgeAccessToken({ fbUserId: FB_USER_ID });
    const reply = await mcpPost(harness.origin, oauth, INITIALIZE_BODY, { ...from(address), "x-api-key": "junk-key" });
    expect(reply.status).toBe(200);
  });

  it("still refuses junk, expired and wrong-audience bearers from the locked address", async () => {
    const address = nextClientAddress();
    await junkUntilLocked(address);
    const expired = await forgeAccessToken({ fbUserId: FB_USER_ID, expiresInSeconds: -120 });
    const wrongAudience = await forgeAccessToken({ fbUserId: FB_USER_ID, audience: "someone-else" });

    for (const token of ["junk-bearer", expired, wrongAudience]) {
      expect((await mcpPost(harness.origin, token, INITIALIZE_BODY, from(address))).status).toBe(429);
    }
  });

  it("does not lock out a client for the failures of another address, and does not count valid OAuth requests as failures", async () => {
    const busy = nextClientAddress();
    const other = nextClientAddress();
    await junkUntilLocked(busy);
    const oauth = await forgeAccessToken({ fbUserId: FB_USER_ID });

    for (let call = 0; call < 30; call += 1) {
      expect((await mcpPost(harness.origin, oauth, INITIALIZE_BODY, from(other))).status).toBe(200);
    }
    const afterwards: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      afterwards.push((await mcpPost(harness.origin, `not-a-token-${index}`, INITIALIZE_BODY, from(other))).status);
    }
    expect(afterwards.every((code) => code === 401)).toBe(true);
  });

  it("answers a request with no credential from a locked address with the sign-in challenge, so a new OAuth client can start", async () => {
    const address = nextClientAddress();
    await junkUntilLocked(address);
    const reply = await mcpPost(harness.origin, undefined, INITIALIZE_BODY, from(address));
    expect(reply.status).toBe(401);
    expect(reply.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("refuses the valid API key from a locked address that never presented it, and serves one that did", async () => {
    const stranger = nextClientAddress();
    const regular = nextClientAddress();
    expect((await mcpPost(harness.origin, undefined, INITIALIZE_BODY, apiKeyFrom(regular))).status).toBe(200);

    await junkUntilLocked(stranger);
    await junkUntilLocked(regular);

    expect((await mcpPost(harness.origin, undefined, INITIALIZE_BODY, apiKeyFrom(stranger))).status).toBe(429);
    expect((await mcpPost(harness.origin, KEY, INITIALIZE_BODY, { ...from(stranger), "x-meta-token": META_TOKEN })).status).toBe(429);
    expect((await mcpPost(harness.origin, undefined, INITIALIZE_BODY, apiKeyFrom(regular))).status).toBe(200);
    expect((await mcpPost(harness.origin, "still-junk", INITIALIZE_BODY, from(regular))).status).toBe(429);
  });
});
