import { describe, expect, it, vi } from "vitest";
import { GoogleProviderClient } from "../../../src/providers/google/client.js";

const binding = { subject: "operator-a", customerIds: ["1234567890"], searchConsoleSites: ["https://example.com/"], analyticsPropertyIds: ["345678901"] };
function fixture(response = new Response('{"results":[]}', { status: 200 })) {
  const transport = vi.fn(async () => response);
  const token = vi.fn(async () => "fixture-access-value");
  return { transport, token, client: new GoogleProviderClient(binding, token, transport) };
}

describe("Google provider boundary", () => {
  it("routes an Ads client through its server-bound manager without applying the header to Analytics", async () => {
    const transport = vi.fn(async () => new Response('{}'));
    const client = new GoogleProviderClient({ ...binding, loginCustomerIds: { "1234567890": "1111111111" } }, async () => "fixture", transport);
    await client.searchAds("1234567890", "SELECT campaign.id FROM campaign");
    expect(transport.mock.calls[0][1].headers).toMatchObject({ "login-customer-id": "1111111111" });
    await client.analytics("345678901", "2026-10-01", "2026-10-10");
    expect(transport.mock.calls[1][1].headers).not.toHaveProperty("login-customer-id");
  });
  it("rejects manager routing for an unbound account", () => {
    expect(() => new GoogleProviderClient({ ...binding, loginCustomerIds: { "2345678901": "1111111111" } }, async () => "fixture", vi.fn())).toThrow("Account not authorized");
  });
  it("rejects invalid manager IDs", () => {
    expect(() => new GoogleProviderClient({ ...binding, loginCustomerIds: { "1234567890": "../unsafe" } }, async () => "fixture", vi.fn())).toThrow("Invalid Google Ads customer ID");
  });
  it("copies manager grants before use", async () => {
    const managers = { "1234567890": "1111111111" };
    const transport = vi.fn(async () => new Response('{}'));
    const client = new GoogleProviderClient({ ...binding, loginCustomerIds: managers }, async () => "fixture", transport);
    managers["1234567890"] = "2222222222";
    await client.validateAds("1234567890", [{ campaignOperation: { create: { name: "Test", status: "PAUSED" } } }]);
    expect(transport.mock.calls[0][1].headers).toMatchObject({ "login-customer-id": "1111111111" });
  });
  it("refuses an unbound Ads account before requesting a credential", async () => {
    const { client, token, transport } = fixture();
    await expect(client.searchAds("2345678901", "SELECT campaign.id FROM campaign")).rejects.toThrow("Account not authorized");
    expect(token).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it("forces validation without accepting a caller commit switch", async () => {
    const { client, transport } = fixture();
    await client.validateAds("1234567890", [{ campaignOperation: { create: { name: "Test", status: "PAUSED" } } }]);
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://googleads.googleapis.com/v25/customers/1234567890/googleAds:mutate");
    expect(JSON.parse(String(options.body))).toMatchObject({ validateOnly: true, partialFailure: false });
    expect(options.redirect).toBe("error");
  });
  it("rejects cross-account resource references inside validation operations", async () => {
    const { client, transport } = fixture();
    await expect(client.validateAds("1234567890", [{ campaignOperation: { remove: "customers/2345678901/campaigns/123" } }])).rejects.toThrow("Cross-account reference");
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not trust later mutations to the binding source", async () => {
    const source = { ...binding, customerIds: [...binding.customerIds] };
    const transport = vi.fn();
    const client = new GoogleProviderClient(source, async () => "fixture-access-value", transport);
    source.customerIds.push("2345678901");
    await expect(client.searchAds("2345678901", "SELECT campaign.id FROM campaign")).rejects.toThrow("Account not authorized");
    expect(transport).not.toHaveBeenCalled();
  });
  it("blocks unbound Search Console and GA4 resources", async () => {
    const { client, transport } = fixture();
    await expect(client.searchConsole("https://other.example/", "2026-10-01", "2026-10-10")).rejects.toThrow("Site not authorized");
    await expect(client.analytics("123", "2026-10-01", "2026-10-10")).rejects.toThrow("Property not authorized");
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses official Search Console and GA4 endpoints", async () => {
    const one = fixture();
    await one.client.searchConsole("https://example.com/", "2026-10-01", "2026-10-10");
    expect(one.transport.mock.calls[0][0]).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query");
    const two = fixture();
    await two.client.analytics("345678901", "2026-10-01", "2026-10-10");
    expect(two.transport.mock.calls[0][0]).toBe("https://analyticsdata.googleapis.com/v1beta/properties/345678901:runReport");
  });
  it("returns sanitized errors without echoing provider response bodies", async () => {
    const { client } = fixture(new Response('secret-provider-payload', { status: 403, headers: { "request-id": "request-123" } }));
    await expect(client.searchAds("1234567890", "SELECT campaign.id FROM campaign")).rejects.toThrow(/^Google API request failed \(403\)$/);
  });
  it("rejects malformed identifiers and excessive validation operations", async () => {
    const { client, transport } = fixture();
    await expect(client.searchAds("../token", "SELECT campaign.id FROM campaign")).rejects.toThrow();
    await expect(client.validateAds("1234567890", Array.from({ length: 101 }, () => ({})))).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("requires an authenticated subject", () => {
    expect(() => new GoogleProviderClient({ ...binding, subject: "" }, async () => "fixture", vi.fn())).toThrow("Authenticated subject required");
  });
  it("does not expose token-resolver errors", async () => {
    const client = new GoogleProviderClient(binding, async () => { throw new Error("private-refresh-value"); }, vi.fn());
    await expect(client.searchAds("1234567890", "SELECT campaign.id FROM campaign")).rejects.toThrow(/^Google authorization unavailable$/);
  });
  it("rejects impossible dates before requesting a credential", async () => {
    const { client, token } = fixture();
    await expect(client.analytics("345678901", "2026-02-30", "2026-10-10")).rejects.toThrow("Invalid report date");
    expect(token).not.toHaveBeenCalled();
  });
  it("bounds provider response bytes", async () => {
    const { client } = fixture(new Response("{}", { headers: { "content-length": "2000001" } }));
    await expect(client.searchAds("1234567890", "SELECT campaign.id FROM campaign")).rejects.toThrow("Invalid or oversized Google API response");
  });
});
