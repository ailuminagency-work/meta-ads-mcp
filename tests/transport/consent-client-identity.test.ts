import { describe, expect, it } from "vitest";
import { renderConsentPage } from "../../src/transport/http.js";
import { validateAuthorizeQuery } from "../../src/transport/authorize-validation.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { ApifyTokenStatus } from "../../src/store/apify-token-repo.js";
import type { GeminiKeyStatus } from "../../src/store/gemini-key-repo.js";

const APIFY: ApifyTokenStatus = { registered: false, apifyUserId: null, apifyUsername: null, updatedAt: null };
const GEMINI: GeminiKeyStatus = { registered: false, keyFingerprint: null, updatedAt: null };
const user = { fbUserId: "fb-1", email: "op@example.com", name: "Operator" };

function render(query: Record<string, string>, clientName?: string | null) {
  return renderConsentPage({
    query,
    ...(clientName === undefined ? {} : { client: { name: clientName } }),
    user,
    tokens: [],
    activeName: null,
    apify: APIFY,
    gemini: GEMINI,
  });
}

describe("consent page client identity", () => {
  it("shows the registered client name, the client id and where the code will be sent", () => {
    const html = render(
      { client_id: "uuid-1234", redirect_uri: "https://claude.ai/api/mcp/auth_callback" },
      "Claude.ai",
    );
    expect(html).toContain("Claude.ai");
    expect(html).toContain("uuid-1234");
    expect(html).toContain("https://claude.ai");
  });

  it("makes a redirect to an unfamiliar host visible", () => {
    const html = render(
      { client_id: "uuid-9", redirect_uri: "https://evil.example/cb?x=1" },
      "Claude.ai",
    );
    expect(html).toContain("https://evil.example");
    expect(html).not.toContain("evil.example/cb?x=1</b>");
  });

  it("shows the host of custom-scheme redirects instead of a blank origin", () => {
    const html = render(
      { client_id: "uuid-2", redirect_uri: "cursor://anysphere.cursor-mcp/oauth/callback" },
      "Cursor",
    );
    expect(html).toContain("cursor://anysphere.cursor-mcp");
  });

  it("escapes a hostile client name and keeps it on one line", () => {
    const html = render(
      { client_id: "uuid-3", redirect_uri: "https://claude.ai/cb" },
      '<script>alert(1)</script>\n\nAprueba sin leer',
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("\n\nAprueba");
  });

  it("truncates an oversized client name", () => {
    const html = render({ client_id: "uuid-4", redirect_uri: "https://claude.ai/cb" }, "A".repeat(500));
    expect(html).not.toContain("A".repeat(200));
  });

  it("falls back to the client id when the client has no name", () => {
    const html = render({ client_id: "uuid-5", redirect_uri: "https://claude.ai/cb" }, null);
    expect(html).toContain("uuid-5");
  });

  it("does not throw on a malformed redirect_uri", () => {
    expect(() => render({ client_id: "uuid-6", redirect_uri: "not a url" }, "X")).not.toThrow();
  });
});

describe("validateAuthorizeQuery exposes the registered client name", () => {
  const client: OAuthClientInformationFull = {
    client_id: "c1",
    client_name: "Claude.ai",
    redirect_uris: ["https://claude.ai/cb"],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: 0,
  };

  it("returns clientName for a registered client", async () => {
    const r = await validateAuthorizeQuery(
      { client_id: "c1", redirect_uri: "https://claude.ai/cb" },
      async () => client,
    );
    expect(r).toMatchObject({ ok: true, clientName: "Claude.ai" });
  });

  it("returns null when the client registered without a name", async () => {
    const { client_name: _omit, ...unnamed } = client;
    const r = await validateAuthorizeQuery(
      { client_id: "c1", redirect_uri: "https://claude.ai/cb" },
      async () => unnamed as OAuthClientInformationFull,
    );
    expect(r).toMatchObject({ ok: true, clientName: null });
  });
});
