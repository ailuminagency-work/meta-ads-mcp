// Prints what the in-process server actually does for behaviours where it
// differs from the MCP authorization / OAuth specifications. It asserts nothing
// and exits 0: these are findings to triage, not regressions to gate on.
//
//   LOG_LEVEL=fatal npx tsx tests/protocol/known-deviations.probe.ts
import { createHash } from "node:crypto";
import {
  Browser,
  CLAUDE_CLIENT_METADATA,
  CLAUDE_REDIRECT,
  INITIALIZE_BODY,
  MCP_RESOURCE,
  authorizeQuery,
  bootServer,
  completeOAuthFlow,
  createMetaLoginState,
  mcpPost,
  nextClientAddress,
  obtainAuthorizationCode,
  pkcePair,
  registerClient,
  tokenRequest,
  type RegisteredClient,
} from "./harness.js";

const lines: string[] = [];
const report = (id: string, spec: string, observed: string): void => {
  lines.push(`${id}  ${spec}\n      observed: ${observed}`);
};

const h = await bootServer();
try {
  const insecureRedirect = await registerClient(h.origin, { ...CLAUDE_CLIENT_METADATA, redirect_uris: ["http://attacker.example/callback"] });
  report("D1", "MCP authorization, communication security: redirect URIs must be localhost or HTTPS", `DCR of http://attacker.example/callback -> HTTP ${insecureRedirect.status}`);
  const userinfo = await registerClient(h.origin, { ...CLAUDE_CLIENT_METADATA, redirect_uris: ["https://user:pw@claude.ai/cb"] });
  const custom = await registerClient(h.origin, { ...CLAUDE_CLIENT_METADATA, redirect_uris: ["ftp://files.example/cb"] });
  report("D1b", "same, other shapes", `https://user:pw@claude.ai/cb -> HTTP ${userinfo.status}; ftp://files.example/cb -> HTTP ${custom.status}`);

  const client = (await registerClient(h.origin, CLAUDE_CLIENT_METADATA)).body as unknown as RegisteredClient;
  const browser = new Browser(h.origin);
  await createMetaLoginState(browser);
  const { challenge } = pkcePair();
  const errorRedirect = await browser.postForm("/authorize", {
    client_id: client.client_id,
    redirect_uri: CLAUDE_REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "plain",
    state: "caller-state",
    resource: MCP_RESOURCE,
    token: "personal",
  });
  const errorLocation = new URL(errorRedirect.headers.get("location") ?? "http://none.invalid/");
  report("D2", "RFC 6749 section 4.1.2.1: error redirect must echo state", `error=${errorLocation.searchParams.get("error")} state=${errorLocation.searchParams.get("state") ?? "(absent)"}`);

  const flow = await completeOAuthFlow(h.origin);
  const get = await fetch(h.origin + "/mcp", { headers: { authorization: `Bearer ${flow.tokens.access_token}`, accept: "text/event-stream" } });
  report("D3", "RFC 9110 section 15.5.6: a 405 response must carry Allow", `GET /mcp -> ${get.status}, Allow=${get.headers.get("allow") ?? "(absent)"}`);

  const preflight = await fetch(h.origin + "/mcp", {
    method: "OPTIONS",
    headers: { origin: "https://claude.ai", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,mcp-protocol-version" },
  });
  const unauthenticated = await fetch(h.origin + "/mcp", { method: "POST", headers: { origin: "https://claude.ai", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  report(
    "D4",
    "Streamable HTTP: browser clients send MCP-Protocol-Version and must read WWW-Authenticate",
    `allow-headers=[${preflight.headers.get("access-control-allow-headers")}] expose-headers on 401=${unauthenticated.headers.get("access-control-expose-headers") ?? "(absent)"}`,
  );
  const chatgpt = await fetch(h.origin + "/mcp", { method: "OPTIONS", headers: { origin: "https://chatgpt.com", "access-control-request-method": "POST" } });
  report("D4b", "default CORS allowlist (CORS_ALLOWED_ORIGINS unset)", `preflight from https://chatgpt.com -> allow-origin=${chatgpt.headers.get("access-control-allow-origin") ?? "(absent)"}`);

  const issued = await obtainAuthorizationCode(h.origin);
  const meta = (await (await fetch(h.origin + "/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
  report("D5", "RFC 9207 issuer identification (newer MCP revisions)", `authorization_response_iss_parameter_supported=${String(meta.authorization_response_iss_parameter_supported)}; metadata advertises client_id_metadata_document_supported=${String(meta.client_id_metadata_document_supported)}`);

  const wrongVerifier = await tokenRequest(h.origin, { grant_type: "authorization_code", client_id: issued.client.client_id, code: issued.code, code_verifier: createHash("sha256").update("x").digest("base64url"), redirect_uri: issued.redirectUri, resource: MCP_RESOURCE });
  const rightVerifier = await tokenRequest(h.origin, { grant_type: "authorization_code", client_id: issued.client.client_id, code: issued.code, code_verifier: issued.verifier, redirect_uri: issued.redirectUri, resource: MCP_RESOURCE });
  report("D6", "OAuth 2.1: a code that failed verification should not stay redeemable", `wrong verifier -> ${wrongVerifier.status}; then correct verifier on the same code -> ${rightVerifier.status}`);

  const replay = await tokenRequest(h.origin, { grant_type: "authorization_code", client_id: issued.client.client_id, code: issued.code, code_verifier: issued.verifier, redirect_uri: issued.redirectUri, resource: MCP_RESOURCE });
  const firstToken = (rightVerifier.body as { access_token?: string }).access_token;
  const stillValid = firstToken ? (await mcpPost(h.origin, firstToken, INITIALIZE_BODY)).status : 0;
  report("D7", "RFC 6749 section 4.1.2: replay should revoke tokens already issued from the code", `replay -> ${replay.status}; access token from the first redemption afterwards -> HTTP ${stillValid}`);

  const badJson = await mcpPost(h.origin, flow.tokens.access_token, "{not json");
  report("D8", "JSON-RPC: malformed JSON should yield a -32700 parse error", `HTTP ${badJson.status} content-type=${badJson.headers.get("content-type")}`);

  const foreign = await obtainAuthorizationCode(h.origin, { resource: "https://other.example.com/mcp" });
  const foreignToken = await tokenRequest(h.origin, { grant_type: "authorization_code", client_id: foreign.client.client_id, code: foreign.code, code_verifier: foreign.verifier, redirect_uri: foreign.redirectUri, resource: "https://other.example.com/mcp" });
  report("D9", "RFC 8707 section 2: unknown resource should be refused with invalid_target", `/token for resource=https://other.example.com/mcp -> HTTP ${foreignToken.status}`);

  const hostile = await mcpPost(h.origin, flow.tokens.access_token, INITIALIZE_BODY, { origin: "https://attacker.example", host: "rebound.attacker.example" });
  report("D11", "MCP Streamable HTTP: servers must validate Origin (DNS rebinding); bearer token is required either way", `authenticated POST with Origin: https://attacker.example and Host: rebound.attacker.example -> HTTP ${hostile.status}`);

  const loopback = await registerClient(h.origin, { client_name: "Native", redirect_uris: ["http://127.0.0.1:53682/callback"], token_endpoint_auth_method: "none" }, nextClientAddress());
  const portChanged = await new Browser(h.origin).get(
    "/authorize?" + authorizeQuery({ clientId: String(loopback.body.client_id), redirectUri: "http://127.0.0.1:61000/callback", challenge }),
  );
  report("D10", "RFC 8252 section 7.3: loopback redirects may vary the port (SDK supports it; GET /authorize does not)", `registered :53682, requested :61000 -> HTTP ${portChanged.status}`);
} finally {
  await h.close();
}

process.stdout.write(`Observed deviations from the MCP authorization / OAuth specifications (informational)\n\n${lines.join("\n")}\n`);
process.exit(0);
