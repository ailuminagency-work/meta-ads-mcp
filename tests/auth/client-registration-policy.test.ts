import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedRedirectHosts,
  assertRegistrableRedirectUris,
  checkRedirectUri,
  checkRedirectUris,
  InvalidRedirectUriError,
} from "../../src/auth/client-registration-policy.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const LEGITIMATE_REDIRECTS: Record<string, string[]> = {
  "Claude (web and mobile)": ["https://claude.ai/api/mcp/auth_callback"],
  ChatGPT: [
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector/oauth/synthetic-callback-id",
  ],
  "Claude Code and other CLIs (ephemeral loopback port)": [
    "http://localhost:54321/callback",
    "http://127.0.0.1:38123/oauth/callback",
    "http://[::1]:8976/callback",
  ],
  Cursor: [
    "cursor://anysphere.cursor-retrieval/oauth/user-lumin/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
  ],
  "VS Code": [
    "http://127.0.0.1:33418/",
    "vscode://vscode.github-authentication/did-authenticate",
    "vscode-insiders://vscode.github-authentication/did-authenticate",
  ],
};

describe("client registration redirect policy: legitimate clients", () => {
  for (const [client, uris] of Object.entries(LEGITIMATE_REDIRECTS)) {
    it(`accepts the redirect shapes ${client} registers`, () => {
      for (const uri of uris) {
        expect(checkRedirectUri(uri), uri).toEqual({ ok: true });
      }
      expect(() => assertRegistrableRedirectUris(uris)).not.toThrow();
    });
  }

  it("accepts a mixed registration when every URI is acceptable", () => {
    expect(
      checkRedirectUris(["http://127.0.0.1:33418/", "vscode://vscode.github-authentication/did-authenticate"]),
    ).toEqual({ ok: true });
  });

  it("does not trust hosts outside the defaults until the operator names them", () => {
    expect(checkRedirectUri("https://vscode.dev/redirect").ok).toBe(false);
    expect(allowedRedirectHosts()).toEqual(["claude.ai", "chatgpt.com"]);

    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "vscode.dev, Insiders.VSCode.dev");
    expect(checkRedirectUri("https://vscode.dev/redirect")).toEqual({ ok: true });
    expect(checkRedirectUri("https://insiders.vscode.dev/redirect")).toEqual({ ok: true });
    expect(checkRedirectUri("https://evil.vscode.dev.example/redirect").ok).toBe(false);
    expect(checkRedirectUri("https://sub.vscode.dev/redirect").ok).toBe(false);
  });

  it("ignores operator entries that are not exact DNS host names", () => {
    vi.stubEnv(
      "OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS",
      "*.example.com,https://scheme.example,host.example:8443,192.0.2.7,path.example/x,,ok.example",
    );
    expect(allowedRedirectHosts()).toEqual(["claude.ai", "chatgpt.com", "ok.example"]);
  });
});

describe("client registration redirect policy: hostile registrations", () => {
  const HOSTILE: Array<[string, string]> = [
    ["attacker origin", "https://evil.example/cb"],
    ["attacker origin on a lookalike of an allowed host", "https://claude.ai.evil.example/cb"],
    ["allowed host as a subdomain prefix", "https://evilclaude.ai/cb"],
    ["allowed host only in the path", "https://evil.example/https://claude.ai/cb"],
    ["allowed host only in the query", "https://evil.example/cb?next=https://claude.ai/"],
    ["userinfo naming an allowed host", "https://claude.ai@evil.example/cb"],
    ["userinfo in front of an allowed host", "https://evil.example@claude.ai/cb"],
    ["backslash host confusion", "https://evil.example\\@claude.ai/cb"],
    ["subdomain of an allowed host", "https://attacker.claude.ai/cb"],
    ["trailing-dot host", "https://claude.ai./cb"],
    ["explicit port on an allowed host", "https://claude.ai:8443/cb"],
    ["percent-encoded host", "https://claude%2eai/cb"],
    ["extra slashes before the host", "https:///claude.ai/cb"],
    ["scheme without authority", "https:claude.ai/cb"],
    ["plain http on an allowed host", "http://claude.ai/cb"],
    ["plain http on a remote host", "http://evil.example/cb"],
    ["loopback lookalike", "http://localhost.evil.example/cb"],
    ["loopback as a subdomain label", "http://127.0.0.1.evil.example/cb"],
    ["abbreviated loopback address", "http://127.1/cb"],
    ["hex loopback address", "http://0x7f.1/cb"],
    ["decimal loopback address", "http://2130706433/cb"],
    ["non-loopback private address", "http://192.168.1.10:8080/cb"],
    ["fragment", "https://claude.ai/cb#access_token=x"],
    ["empty fragment", "https://claude.ai/cb#"],
    ["wildcard host", "https://*.claude.ai/cb"],
    ["wildcard path", "https://claude.ai/*"],
    ["javascript URI", "javascript:alert(1)"],
    ["data URI", "data:text/html,<script>alert(1)</script>"],
    ["file URI", "file:///etc/passwd"],
    ["ftp URI", "ftp://claude.ai/cb"],
    ["unknown custom scheme", "myapp://callback"],
    ["lookalike custom scheme", "cursor-evil://anysphere.cursor-retrieval/oauth/callback"],
    ["custom scheme without an authority", "cursor:oauth/callback"],
    ["custom scheme with userinfo", "cursor://user@anysphere.cursor-retrieval/oauth/callback"],
    ["custom scheme with a fragment", "cursor://anysphere.cursor-retrieval/oauth/callback#x"],
    ["whitespace inside the URI", "https://claude.ai/cb x"],
    ["control character", "https://claude.ai/cb\r\nSet-Cookie: x=y"],
    ["malformed", "not a url"],
    ["empty", ""],
    ["relative", "/callback"],
    ["protocol-relative", "//evil.example/cb"],
  ];

  for (const [label, uri] of HOSTILE) {
    it(`rejects ${label}`, () => {
      expect(checkRedirectUri(uri).ok, uri).toBe(false);
    });
  }

  it("rejects non-string entries", () => {
    for (const value of [null, undefined, 42, {}, ["https://claude.ai/cb"]]) {
      expect(checkRedirectUri(value).ok).toBe(false);
    }
  });

  it("rejects the whole registration when any single URI is unacceptable", () => {
    expect(() =>
      assertRegistrableRedirectUris(["https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"]),
    ).toThrow(InvalidRedirectUriError);
  });

  it("rejects an empty or oversized redirect list", () => {
    expect(checkRedirectUris([]).ok).toBe(false);
    expect(checkRedirectUris(undefined).ok).toBe(false);
    expect(checkRedirectUris("https://claude.ai/cb").ok).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `http://localhost:${3000 + i}/cb`);
    expect(checkRedirectUris(eleven).ok).toBe(false);
    expect(checkRedirectUris(eleven.slice(0, 10))).toEqual({ ok: true });
  });

  it("rejects an oversized URI", () => {
    expect(checkRedirectUri(`https://claude.ai/${"a".repeat(2100)}`).ok).toBe(false);
  });

  it("reports an RFC 7591 invalid_redirect_uri error without echoing the submitted URI", () => {
    try {
      assertRegistrableRedirectUris(["https://evil.example/cb?secret=1"]);
      expect.unreachable("registration should have been rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRedirectUriError);
      const body = (error as InvalidRedirectUriError).toResponseObject();
      expect(body.error).toBe("invalid_redirect_uri");
      expect(JSON.stringify(body)).not.toContain("evil.example");
      expect(JSON.stringify(body)).not.toContain("secret=1");
    }
  });
});
