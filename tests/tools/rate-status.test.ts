import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRateStatusTools } from "../../src/tools/rate-status.js";
import { metaApiClient } from "../../src/meta/client.js";
import { hashToken } from "../../src/auth/token-store.js";
import { cleanupTestToken, createMockMcpServer, setupTestToken } from "../setup.js";

const MINE = hashToken("test-access-token");
const OTHER = hashToken("another-tenants-token");

function usage(tokenHash: string, account: string) {
  return {
    key: `acc:${tokenHash}:${account}`,
    kind: "acc",
    callCount: 10,
    cpuTime: 1,
    totalTime: 2,
    estimatedTimeToRegainAccessMs: 0,
    adsApiAccessTier: "development_access",
  };
}

async function callTool(): Promise<string> {
  const server = createMockMcpServer();
  registerRateStatusTools(server as never);
  const result = (await server._registeredTools[0].handler({})) as {
    content: Array<{ type: string; text: string }>;
  };
  return result.content.map((c) => c.text).join("\n");
}

describe("ads_rate_status", () => {
  beforeEach(() => setupTestToken());
  afterEach(() => {
    cleanupTestToken();
    vi.restoreAllMocks();
  });

  it("returns only the caller's own buckets, circuits and pacer state", async () => {
    vi.spyOn(metaApiClient, "getUsageSnapshot").mockReturnValue({
      usage: [usage(MINE, "act_111"), usage(OTHER, "act_999")],
      circuits: [
        { key: `${MINE}:act_111:ads_management`, reason: "throttle", openUntil: Date.now() + 5000, tripCount: 1, lastError: "mine" },
        { key: `${OTHER}:act_999:ads_management`, reason: "throttle", openUntil: Date.now() + 5000, tripCount: 1, lastError: "theirs" },
      ],
      writePacer: [
        { key: `${MINE}:act_111`, tokens: 5, capacity: 10, rateRps: 0.6, tier: "development_access" },
        { key: `${OTHER}:act_999`, tokens: 5, capacity: 10, rateRps: 0.6, tier: "development_access" },
      ],
    } as never);

    const text = await callTool();
    expect(text).toContain("act_111");
    expect(text).toContain("mine");
    expect(text).not.toContain("act_999");
    expect(text).not.toContain(OTHER);
    expect(text).not.toContain("theirs");
  });

  it("shows nothing when only other tenants have recorded usage", async () => {
    vi.spyOn(metaApiClient, "getUsageSnapshot").mockReturnValue({
      usage: [usage(OTHER, "act_999")],
      circuits: [],
      writePacer: [],
    } as never);

    const text = await callTool();
    expect(text).toContain("No Meta API usage recorded yet for this connection.");
    expect(text).not.toContain("act_999");
  });

  it("shows nothing instead of throwing when no token resolves for the request", async () => {
    cleanupTestToken();
    vi.spyOn(metaApiClient, "getUsageSnapshot").mockReturnValue({
      usage: [usage(OTHER, "act_999")],
      circuits: [],
      writePacer: [],
    } as never);

    const text = await callTool();
    expect(text).not.toContain("act_999");
  });
});
