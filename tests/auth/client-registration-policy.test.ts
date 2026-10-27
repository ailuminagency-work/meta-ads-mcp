import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedAppHosts,
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
  "Claude (callback on claude.com)": ["https://claude.com/api/mcp/auth_callback"],
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

  it("accepts the ChatGPT callbacks only once the operator opts chatgpt.com in", () => {
    const chatgpt = [
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector/oauth/synthetic-callback-id",
    ];
    for (const uri of chatgpt) expect(checkRedirectUri(uri).ok, uri).toBe(false);

    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "chatgpt.com");
    for (const uri of chatgpt) expect(checkRedirectUri(uri), uri).toEqual({ ok: true });
  });

  it("accepts only the two ChatGPT connector callback shapes when that preset is on, and not a Custom GPT action callback", () => {
    vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", "true");
    for (const uri of [
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector/oauth/synthetic-callback_ID-01",
    ]) {
      expect(checkRedirectUri(uri), uri).toEqual({ ok: true });
    }
    for (const uri of [
      "https://chatgpt.com/aip/g-0123456789abcdef/oauth/callback",
      "https://chat.openai.com/aip/g-0123456789abcdef/oauth/callback",
      "https://chatgpt.com/connector_platform_oauth_redirect/",
      "https://chatgpt.com/connector_platform_oauth_redirect?x=1",
      "https://chatgpt.com/connector/oauth/",
      "https://chatgpt.com/connector/oauth/a/b",
      "https://chatgpt.com/connector/oauth/a?b=c",
      "https://chatgpt.com/connector/oauth/%2e%2e",
      "https://chatgpt.com/Connector/oauth/abc",
      "https://www.chatgpt.com/connector/oauth/abc",
      "https://chatgpt.com.evil.example/connector/oauth/abc",
      `https://chatgpt.com/connector/oauth/${"a".repeat(129)}`,
    ]) {
      expect(checkRedirectUri(uri).ok, uri).toBe(false);
    }
  });

  it("keeps the ChatGPT preset off unless the value is exactly true", () => {
    for (const value of ["", "TRUE", "1", "yes", "false", "true ", " true", "true\n"]) {
      vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", value);
      const verdict = checkRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect");
      expect(verdict.ok, JSON.stringify(value)).toBe(false);
    }
    vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", "true");
    expect(checkRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toEqual({ ok: true });
  });

  it("accepts an exact operator-listed https URI and nothing near it", () => {
    vi.stubEnv(
      "OAUTH_EXTRA_ALLOWED_REDIRECT_URIS",
      "https://platform.openai.com/apps-manage/oauth, http://insecure.example/cb,https://other.example/*",
    );
    expect(checkRedirectUri("https://platform.openai.com/apps-manage/oauth")).toEqual({ ok: true });
    for (const uri of [
      "https://platform.openai.com/apps-manage/oauth/",
      "https://platform.openai.com/apps-manage/oauth2",
      "https://platform.openai.com/apps-manage",
      "https://platform.openai.com/",
      "https://other.example/cb",
      "http://insecure.example/cb",
    ]) {
      expect(checkRedirectUri(uri).ok, uri).toBe(false);
    }
  });

  it("does not let an exact URI entry widen the pinned Claude callback or the structural checks", () => {
    vi.stubEnv(
      "OAUTH_EXTRA_ALLOWED_REDIRECT_URIS",
      "https://claude.ai/other,https://example.com:8443/cb,https://user@example.com/cb,https://example.com/a#frag",
    );
    for (const uri of [
      "https://claude.ai/other",
      "https://example.com:8443/cb",
      "https://user@example.com/cb",
      "https://example.com/a#frag",
    ]) {
      expect(checkRedirectUri(uri).ok, uri).toBe(false);
    }
  });

  it("a stored ChatGPT client stays usable under the preset and is refused without it", () => {
    const stored = ["https://chatgpt.com/connector_platform_oauth_redirect"];
    expect(checkRedirectUris(stored).ok).toBe(false);
    vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", "true");
    expect(checkRedirectUris(stored)).toEqual({ ok: true });
  });

  it("reads the authority from the :// that follows the scheme, so a later :// in the query or path cannot move it (G1P-01, G1P-02)", () => {
    vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", "true");
    for (const uri of [
      "https:/chatgpt.com/aip/g-SYNTHETIC/oauth/callback?x=://chatgpt.com/connector_platform_oauth_redirect",
      "https:chatgpt.com/aip/g-SYNTH/oauth/callback/://chatgpt.com/connector/oauth/zz",
      "https:/chatgpt.com/anything?x=://chatgpt.com/connector/oauth/abc",
      "https:/@chatgpt.com/aip/g-S/oauth/callback?x=://chatgpt.com/connector/oauth/abc",
      "https:/claude.ai/x?y=://claude.ai/api/mcp/auth_callback",
      "https:claude.com/x?y=://claude.com/api/mcp/auth_callback",
      "https:/claude.ai/api/mcp/auth_callback?y=://claude.ai/api/mcp/auth_callback",
    ]) {
      expect(checkRedirectUri(uri).ok, uri).toBe(false);
    }
  });

  it("refuses default-port, empty-port and upper-case spellings of an https redirect (G1P-03)", () => {
    vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", "true");
    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_URIS", "https://a.example:443/cb,https://a.example/cb");
    for (const uri of [
      "https://chatgpt.com:443/connector_platform_oauth_redirect",
      "https://chatgpt.com:/connector_platform_oauth_redirect",
      "https://CHATGPT.COM/connector/oauth/abc",
      "HTTPS://chatgpt.com/connector_platform_oauth_redirect",
      "https://Claude.ai/api/mcp/auth_callback",
      "https://a.example:443/cb",
    ]) {
      expect(checkRedirectUri(uri).ok, uri).toBe(false);
    }
    expect(checkRedirectUri("https://a.example/cb")).toEqual({ ok: true });
  });

  it("accepts a 128-character callback id and the exact lower-case claude.ai callback", () => {
    vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", "true");
    expect(checkRedirectUri(`https://chatgpt.com/connector/oauth/${"a".repeat(128)}`)).toEqual({ ok: true });
    expect(checkRedirectUri("https://claude.ai/api/mcp/auth_callback")).toEqual({ ok: true });
  });

  it("lets a listed chatgpt.com host override the narrow preset, which is why the operator is warned (G1P-06)", () => {
    vi.stubEnv("OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS", "true");
    expect(checkRedirectUri("https://chatgpt.com/aip/g-S/oauth/callback").ok).toBe(false);
    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "chatgpt.com");
    expect(checkRedirectUri("https://chatgpt.com/aip/g-S/oauth/callback")).toEqual({ ok: true });
  });

  it("accepts a mixed registration when every URI is acceptable", () => {
    expect(
      checkRedirectUris(["http://127.0.0.1:33418/", "vscode://vscode.github-authentication/did-authenticate"]),
    ).toEqual({ ok: true });
  });

  it("does not trust hosts outside the defaults until the operator names them", () => {
    expect(checkRedirectUri("https://vscode.dev/redirect").ok).toBe(false);
    expect(allowedRedirectHosts()).toEqual(["claude.ai", "claude.com"]);

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
    expect(allowedRedirectHosts()).toEqual(["claude.ai", "claude.com", "ok.example"]);
  });
});

describe("client registration redirect policy: custom-scheme application hosts (G1R-07)", () => {
  // UNVERIFIED against the real clients: these are the hosts the earlier tests assumed.
  it("lists the built-in application hosts per scheme", () => {
    expect(allowedAppHosts("cursor")).toEqual(["anysphere.cursor-retrieval", "anysphere.cursor-mcp"]);
    expect(allowedAppHosts("vscode")).toEqual(["vscode.github-authentication"]);
    expect(allowedAppHosts("vscode-insiders")).toEqual(["vscode.github-authentication"]);
    expect(allowedAppHosts("myapp")).toEqual([]);
  });

  it.each([
    ["an application host nobody listed, on vscode", "vscode://attacker.publisher/cb"],
    ["an application host nobody listed, on cursor", "cursor://attacker.publisher/cb"],
    ["an application host nobody listed, on vscode-insiders", "vscode-insiders://attacker.publisher/cb"],
    ["a vscode host on the cursor scheme", "cursor://vscode.github-authentication/oauth/callback"],
    ["a cursor host on the vscode scheme", "vscode://anysphere.cursor-retrieval/oauth/callback"],
    ["a listed host with a port", "cursor://anysphere.cursor-retrieval:8080/oauth/callback"],
    ["a listed host as a prefix of another", "cursor://anysphere.cursor-retrieval.evil.example/oauth/callback"],
    ["a listed host as a suffix of another", "cursor://evil.anysphere.cursor-retrieval/oauth/callback"],
    ["a listed host in upper case", "cursor://ANYSPHERE.cursor-retrieval/oauth/callback"],
    ["no application host", "cursor:///oauth/callback"],
    ["no authority", "cursor:oauth/callback"],
    ["user information", "cursor://evil@anysphere.cursor-retrieval/oauth/callback"],
  ])("refuses %s", (_label, uri) => {
    expect(checkRedirectUri(uri).ok, uri).toBe(false);
  });

  it("accepts any path and query on a listed host", () => {
    for (const uri of [
      "cursor://anysphere.cursor-retrieval/oauth/user-lumin/callback",
      "cursor://anysphere.cursor-mcp/oauth/callback?x=1",
      "vscode://vscode.github-authentication/did-authenticate",
      "vscode-insiders://vscode.github-authentication/did-authenticate",
    ]) {
      expect(checkRedirectUri(uri), uri).toEqual({ ok: true });
    }
  });

  it("adds hosts from OAUTH_EXTRA_ALLOWED_APP_HOSTS for the three custom schemes only", () => {
    vi.stubEnv("OAUTH_EXTRA_ALLOWED_APP_HOSTS", "ms-vscode.mcp-helper, Other.Publisher-ext");
    expect(allowedAppHosts("vscode")).toEqual(["vscode.github-authentication", "ms-vscode.mcp-helper", "other.publisher-ext"]);
    expect(checkRedirectUri("vscode://ms-vscode.mcp-helper/callback")).toEqual({ ok: true });
    expect(checkRedirectUri("vscode-insiders://other.publisher-ext/callback")).toEqual({ ok: true });
    expect(checkRedirectUri("cursor://ms-vscode.mcp-helper/callback")).toEqual({ ok: true });
    expect(checkRedirectUri("vscode://attacker.publisher/callback").ok).toBe(false);
    expect(checkRedirectUri("myapp://ms-vscode.mcp-helper/callback").ok).toBe(false);
  });

  it("ignores operator entries that are not plain application host names", () => {
    vi.stubEnv(
      "OAUTH_EXTRA_ALLOWED_APP_HOSTS",
      "*,a/b,host:80,vscode://x.y,..,-bad,bad-,with space,,fine.ext",
    );
    expect(allowedAppHosts("vscode")).toEqual(["vscode.github-authentication", "fine.ext"]);
  });

  it("does not let the redirect-host variable open a custom scheme host", () => {
    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "attacker.publisher");
    expect(checkRedirectUri("vscode://attacker.publisher/cb").ok).toBe(false);
  });

  it("keeps loopback open on any port and path", () => {
    expect(checkRedirectUri("http://127.0.0.1:65535/any/path?x=1")).toEqual({ ok: true });
    expect(checkRedirectUri("http://localhost:1/cb")).toEqual({ ok: true });
  });
});

describe("client registration redirect policy: hostile registrations", () => {
  const HOSTILE: Array<[string, string]> = [
    ["attacker origin", "https://evil.example/cb"],
    ["attacker origin on a lookalike of an allowed host", "https://claude.ai.evil.example/cb"],
    ["allowed host as a subdomain prefix", "https://evilclaude.ai/cb"],
    ["another path on claude.ai", "https://claude.ai/anything/the/attacker/likes?next=x"],
    ["another path on claude.com", "https://claude.com/api/mcp/other_callback"],
    ["the callback path with a query", "https://claude.ai/api/mcp/auth_callback?next=https://evil.example"],
    ["the callback path with an empty query", "https://claude.ai/api/mcp/auth_callback?"],
    ["the callback path with a trailing slash", "https://claude.ai/api/mcp/auth_callback/"],
    ["the callback path in another case", "https://claude.ai/API/MCP/auth_callback"],
    ["the callback path percent-encoded", "https://claude.ai/api/mcp/auth%5Fcallback"],
    ["the callback path reached through dot segments", "https://claude.ai/api/x/../mcp/auth_callback"],
    ["a Custom GPT callback on chatgpt.com", "https://chatgpt.com/aip/g-SYNTHETIC-GPT/oauth/callback"],
    ["lookalike of claude.com", "https://claude.com.evil.example/x"],
    ["claude.com as a subdomain prefix", "https://evilclaude.com/x"],
    ["subdomain of claude.com", "https://attacker.claude.com/x"],
    ["plain http on claude.com", "http://claude.com/x"],
    ["explicit port on claude.com", "https://claude.com:8443/x"],
    ["userinfo in front of claude.com", "https://evil.example@claude.com/x"],
    ["trailing-dot claude.com", "https://claude.com./x"],
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

  it("pins the default hosts to the callback path even when the operator also lists them", () => {
    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "claude.ai,chatgpt.com");
    expect(checkRedirectUri("https://claude.ai/anything/else").ok).toBe(false);
    expect(checkRedirectUri("https://claude.ai/api/mcp/auth_callback")).toEqual({ ok: true });
  });

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
