import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

describe("Google provider registration boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers Google tools after the legacy guard in platform mode", async () => {
    vi.stubEnv("LUMIN_PLATFORM_ENABLED", "true");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "staging-client");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "staging-secret");
    const server = createServer();
    const client = new Client({ name: "google-registration-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("google_connection_status");
      expect(names).toContain("google_ads_validate");
      expect(names.filter((name) => name.startsWith("google_"))).toHaveLength(5);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
