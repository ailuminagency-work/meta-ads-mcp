#!/usr/bin/env node
// Read-only MCP connector acceptance probe. Dependency-free (Node 18+).
//
//   BASE_URL=https://staging.example MCP_BEARER_TOKEN=... node scripts/mcp-acceptance.mjs
//
// It never registers a client, never runs an OAuth flow, never calls a tool that
// is not annotated readOnlyHint, and never prints the bearer token.
//
// Environment
//   BASE_URL            required. Origin of the server under test (no path, no credentials).
//   MCP_BEARER_TOKEN    required for the authenticated checks. Without it those rows are SKIP.
//   READ_TOOL           read tool to call once (default ads_get_ad_accounts).
//   READ_TOOL_ARGS      JSON object of arguments for READ_TOOL (default {}).
//   EXPECTED_ORIGIN     origin the server should advertise (default: BASE_URL origin).
//   CORS_ORIGINS        comma separated origins for the CORS rows
//                       (default https://claude.ai,https://chatgpt.com).
//   EXPECT_READ_ONLY    "true" turns a listed non-read-only tool into a FAIL (default: WARN).
//   OUTPUT              "table" (default) or "json".
//
// Exit code: 0 when no row is FAIL, 1 when any row is FAIL, 2 on a usage error.

const REQUEST_TIMEOUT_MS = 20_000;
const CLIENT_INFO = { name: "lumin-mcp-acceptance", version: "1.0.0" };
const MUTATING_WORDS = new Set([
  "create", "update", "delete", "activate", "upload", "register", "deregister", "publish", "deprecate",
  "share", "unshare", "hide", "reply", "clone", "bulk", "verify", "request", "run", "send", "remove",
]);

const rows = [];
const requestLog = [];
let secrets = [];

function usage(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function redact(text) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[REDACTED]");
  }
  return out
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[REDACTED-JWT]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/EAA[A-Za-z0-9]{20,}/g, "[REDACTED-META-TOKEN]")
    .replace(/([?&](?:access_token|token|code|client_secret)=)[^&\s"']+/gi, "$1[REDACTED]");
}

function record(id, check, result, detail = "") {
  rows.push({ id, check, result, detail: redact(detail).replace(/\s+/g, " ").slice(0, 160) });
}

const baseEnv = process.env.BASE_URL?.trim();
if (!baseEnv) usage("BASE_URL is required, for example BASE_URL=https://staging.example node scripts/mcp-acceptance.mjs");
let base;
try {
  base = new URL(baseEnv);
} catch {
  usage("BASE_URL is not a valid URL");
}
if (!["http:", "https:"].includes(base.protocol)) usage("BASE_URL must be http or https");
if (base.username || base.password || base.search || base.hash) usage("BASE_URL must not contain credentials, a query string or a fragment");
if (base.pathname !== "/" && base.pathname !== "") usage("BASE_URL must be an origin without a path");

const token = process.env.MCP_BEARER_TOKEN?.trim() || "";
secrets = [token];
if (token && /\s/.test(token)) usage("MCP_BEARER_TOKEN must not contain whitespace");

const expectedOrigin = (process.env.EXPECTED_ORIGIN?.trim() || base.origin).replace(/\/$/, "");
const readTool = process.env.READ_TOOL?.trim() || "ads_get_ad_accounts";
let readToolArgs = {};
if (process.env.READ_TOOL_ARGS?.trim()) {
  try {
    readToolArgs = JSON.parse(process.env.READ_TOOL_ARGS);
  } catch {
    usage("READ_TOOL_ARGS is not valid JSON");
  }
  if (!readToolArgs || typeof readToolArgs !== "object" || Array.isArray(readToolArgs)) usage("READ_TOOL_ARGS must be a JSON object");
}
const corsOrigins = (process.env.CORS_ORIGINS?.trim() || "https://claude.ai,https://chatgpt.com").split(",").map((value) => value.trim()).filter(Boolean);
const expectReadOnly = process.env.EXPECT_READ_ONLY === "true";
const output = process.env.OUTPUT === "json" ? "json" : "table";

function rebase(url) {
  const parsed = new URL(url, base);
  return parsed.origin === expectedOrigin ? new URL(parsed.pathname + parsed.search, base) : parsed;
}

async function send(method, url, { headers = {}, body, bearer = false } = {}) {
  const target = url instanceof URL ? url : new URL(url, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const merged = { ...headers };
  if (bearer) merged.authorization = `Bearer ${token}`;
  try {
    const response = await fetch(target, { method, headers: merged, body, redirect: "manual", signal: controller.signal });
    const text = await response.text();
    requestLog.push({ method, path: target.pathname, status: response.status });
    return { ok: true, status: response.status, headers: response.headers, text };
  } catch (error) {
    requestLog.push({ method, path: target.pathname, status: 0 });
    return { ok: false, status: 0, headers: new Headers(), text: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseRpc(reply) {
  const type = reply.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    const data = reply.text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    return data.length ? parseJson(data[data.length - 1]) : undefined;
  }
  return parseJson(reply.text);
}

const rpcMethodsSent = [];
async function rpc(body, extraHeaders = {}) {
  rpcMethodsSent.push(body.method === "tools/call" ? `tools/call:${body.params?.name}` : body.method);
  const reply = await send("POST", new URL("/mcp", base), {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...extraHeaders },
    body: JSON.stringify(body),
    bearer: Boolean(token),
  });
  return { ...reply, json: parseRpc(reply) };
}

function hasMutatingWord(name) {
  return name.split("_").some((word) => MUTATING_WORDS.has(word));
}

async function metadataChecks() {
  const prmUrl = new URL("/.well-known/oauth-protected-resource/mcp", base);
  const prmReply = await send("GET", prmUrl);
  const prm = prmReply.status === 200 ? parseJson(prmReply.text) : undefined;
  if (!prm) {
    record("META-1", "RFC 9728 protected resource metadata", "FAIL", `GET ${prmUrl.pathname} -> ${prmReply.status || prmReply.error}`);
    return undefined;
  }
  const resourceOk = prm.resource === `${expectedOrigin}/mcp`;
  const servers = Array.isArray(prm.authorization_servers) ? prm.authorization_servers : [];
  record(
    "META-1",
    "RFC 9728 PRM names <origin>/mcp and an authorization server",
    resourceOk && servers.length > 0 ? "PASS" : "FAIL",
    `resource=${prm.resource} authorization_servers=${servers.length}`,
  );
  if (!servers.length) return undefined;

  const issuer = String(servers[0]);
  const asUrl = rebase(new URL("/.well-known/oauth-authorization-server", issuer).href);
  const asReply = await send("GET", asUrl);
  const meta = asReply.status === 200 ? parseJson(asReply.text) : undefined;
  if (!meta) {
    record("META-2", "RFC 8414 authorization server metadata", "FAIL", `GET ${asUrl.pathname} -> ${asReply.status || asReply.error}`);
    return undefined;
  }
  record("META-2", "AS metadata issuer equals the advertised authorization server", meta.issuer === issuer ? "PASS" : "FAIL", `issuer=${meta.issuer}`);

  const methods = Array.isArray(meta.code_challenge_methods_supported) ? meta.code_challenge_methods_supported : [];
  record(
    "META-3",
    "PKCE: S256 advertised and plain not advertised",
    methods.includes("S256") && !methods.includes("plain") ? "PASS" : "FAIL",
    `code_challenge_methods_supported=${JSON.stringify(methods)}`,
  );

  const endpoints = ["authorization_endpoint", "token_endpoint", "registration_endpoint"].map((key) => [key, meta[key]]);
  const missing = endpoints.filter(([, value]) => typeof value !== "string").map(([key]) => key);
  const insecure = endpoints.filter(([, value]) => typeof value === "string" && new URL(value).protocol !== "https:" && base.protocol === "https:").map(([key]) => key);
  record(
    "META-4",
    "authorization, token and registration endpoints are advertised over https",
    missing.length === 0 && insecure.length === 0 ? "PASS" : "FAIL",
    missing.length ? `missing ${missing.join(",")}` : insecure.length ? `not https: ${insecure.join(",")}` : "all present",
  );

  const grants = Array.isArray(meta.grant_types_supported) ? meta.grant_types_supported : [];
  const authMethods = Array.isArray(meta.token_endpoint_auth_methods_supported) ? meta.token_endpoint_auth_methods_supported : [];
  record(
    "META-5",
    "authorization_code + refresh_token grants, public clients (none)",
    grants.includes("authorization_code") && grants.includes("refresh_token") && authMethods.includes("none") ? "PASS" : "FAIL",
    `grants=${JSON.stringify(grants)} auth=${JSON.stringify(authMethods)}`,
  );

  record(
    "META-6",
    "RFC 9207 iss parameter advertised",
    meta.authorization_response_iss_parameter_supported === true ? "PASS" : "WARN",
    meta.authorization_response_iss_parameter_supported === true ? "advertised" : "not advertised (SHOULD in newer MCP revisions)",
  );
  record(
    "META-7",
    "Client ID Metadata Documents advertised",
    meta.client_id_metadata_document_supported === true ? "PASS" : "WARN",
    meta.client_id_metadata_document_supported === true ? "advertised" : "not advertised (dynamic client registration is the only path)",
  );
  return meta;
}

async function challengeChecks() {
  const prmUrl = `${expectedOrigin}/.well-known/oauth-protected-resource/mcp`;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: CLIENT_INFO } });
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  rpcMethodsSent.push("initialize(unauthenticated)");
  const anonymous = await send("POST", new URL("/mcp", base), { headers, body });
  const challenge = anonymous.headers.get("www-authenticate") ?? "";
  record(
    "AUTH-1",
    "unauthenticated POST /mcp: 401 + WWW-Authenticate resource_metadata (PRM URL)",
    anonymous.status === 401 && /^Bearer\b/i.test(challenge) && challenge.includes(`resource_metadata="${prmUrl}"`) ? "PASS" : "FAIL",
    `status=${anonymous.status} challenge=${challenge || "(none)"}`,
  );

  rpcMethodsSent.push("initialize(invalid token)");
  const garbage = await send("POST", new URL("/mcp", base), { headers: { ...headers, authorization: "Bearer not-a-real-token" }, body });
  record("AUTH-2", "an invalid bearer token is rejected with 401", garbage.status === 401 ? "PASS" : "FAIL", `status=${garbage.status}`);
}

async function mcpChecks() {
  if (!token) {
    for (const id of ["MCP-1", "MCP-2", "MCP-3", "MCP-4", "MCP-5", "MCP-6", "MCP-7", "MCP-8"]) record(id, "authenticated check", "SKIP", "MCP_BEARER_TOKEN not set");
    return;
  }
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: CLIENT_INFO } });
  const result = init.json?.result;
  record(
    "MCP-1",
    "initialize returns protocolVersion, serverInfo and tools capability",
    init.status === 200 && typeof result?.protocolVersion === "string" && result?.serverInfo?.name && result?.capabilities?.tools ? "PASS" : "FAIL",
    init.status === 200 ? `protocolVersion=${result?.protocolVersion} server=${result?.serverInfo?.name}` : `status=${init.status}${init.error ? ` ${init.error}` : ""}`,
  );
  if (init.status !== 200) {
    for (const id of ["MCP-2", "MCP-3", "MCP-4", "MCP-5", "MCP-6", "MCP-7", "MCP-8"]) record(id, "authenticated check", "SKIP", "initialize failed");
    return;
  }

  const initialized = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  record("MCP-2", "notifications/initialized is acknowledged with 202", initialized.status === 202 ? "PASS" : "FAIL", `status=${initialized.status}`);

  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = Array.isArray(list.json?.result?.tools) ? list.json.result.tools : [];
  const wellFormed = tools.length > 0 && tools.every((tool) => typeof tool.name === "string" && tool.inputSchema && typeof tool.inputSchema === "object");
  record("MCP-3", "tools/list returns well-formed tools", list.status === 200 && wellFormed ? "PASS" : "FAIL", `status=${list.status} tools=${tools.length}`);

  const nonReadOnly = tools.filter((tool) => tool.annotations?.readOnlyHint !== true).map((tool) => tool.name);
  const mutatingNamesReadOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true && hasMutatingWord(tool.name)).map((tool) => tool.name);
  const surfaceResult = nonReadOnly.length === 0 && mutatingNamesReadOnly.length === 0 ? "PASS" : expectReadOnly ? "FAIL" : "WARN";
  record(
    "MCP-4",
    "tool surface is read-only (readOnlyHint on every tool, no mutating verbs)",
    surfaceResult,
    `non-read-only listed: ${nonReadOnly.length}${nonReadOnly.length ? ` (${nonReadOnly.slice(0, 4).join(",")}${nonReadOnly.length > 4 ? ",..." : ""})` : ""}; mutating-looking read-only names: ${mutatingNamesReadOnly.length}`,
  );

  const target = tools.find((tool) => tool.name === readTool);
  if (!target) {
    record("MCP-5", `named read tool ${readTool} is listed`, "FAIL", "not in tools/list; set READ_TOOL to a listed read-only tool");
  } else if (target.annotations?.readOnlyHint !== true || hasMutatingWord(target.name)) {
    record("MCP-5", `named read tool ${readTool} is annotated read-only`, "FAIL", "refusing to call a tool that is not annotated readOnlyHint=true");
  } else {
    const call = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: readTool, arguments: readToolArgs } });
    const isError = call.json?.result?.isError === true || call.json?.error !== undefined;
    const text = (call.json?.result?.content ?? []).map((part) => part?.text ?? "").join(" ") || JSON.stringify(call.json?.error ?? call.text);
    record(
      "MCP-5",
      `read tool ${readTool} returns data`,
      call.status === 200 && !isError ? "PASS" : "FAIL",
      call.status === 200 && !isError ? `${text.length} characters returned (content not printed)` : `status=${call.status} ${text}`,
    );
  }

  const get = await send("GET", new URL("/mcp", base), { headers: { accept: "text/event-stream" }, bearer: true });
  record("MCP-6", "GET /mcp is 405 (no SSE stream) and carries Allow", get.status === 405 ? (get.headers.get("allow") ? "PASS" : "WARN") : "FAIL", `status=${get.status} allow=${get.headers.get("allow") ?? "(none)"}`);

  const badVersion = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list" }, { "mcp-protocol-version": "1999-01-01" });
  record("MCP-7", "unsupported MCP-Protocol-Version header is rejected with 400", badVersion.status === 400 ? "PASS" : "FAIL", `status=${badVersion.status}`);

  const override = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/list" }, { "x-meta-token": "acceptance-probe-not-a-token" });
  record(
    "MCP-8",
    "X-Meta-Token override is refused with 403 (agency mode)",
    override.status === 403 ? "PASS" : "WARN",
    override.status === 403 ? "refused" : `status=${override.status}: header override is accepted, so this is not agency mode`,
  );
}

async function transportChecks() {
  const health = await send("GET", new URL("/health", base));
  record("NET-1", "/health answers 200", health.status === 200 ? "PASS" : "FAIL", `status=${health.status}${health.error ? ` ${health.error}` : ""}`);

  if (base.protocol === "https:") {
    const hsts = health.headers.get("strict-transport-security");
    record("NET-2", "HSTS is sent over https", hsts ? "PASS" : "WARN", hsts ?? "(none)");
  } else {
    record("NET-2", "HSTS is sent over https", "SKIP", "BASE_URL is not https");
  }

  for (const origin of corsOrigins) {
    const pre = await send("OPTIONS", new URL("/mcp", base), {
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,mcp-protocol-version" },
    });
    const allowOrigin = pre.headers.get("access-control-allow-origin");
    const allowHeaders = (pre.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    const expose = (pre.headers.get("access-control-expose-headers") ?? "").toLowerCase();
    const missing = ["authorization", "content-type", "mcp-protocol-version"].filter((name) => !allowHeaders.split(",").map((part) => part.trim()).includes(name));
    record(
      `CORS-${origin.replace(/^https?:\/\//, "")}`,
      `browser preflight from ${origin} (informational)`,
      allowOrigin === origin && missing.length === 0 && expose.includes("www-authenticate") ? "PASS" : "WARN",
      `allow-origin=${allowOrigin ?? "(none)"} missing-allow-headers=${missing.join(",") || "none"} expose-www-authenticate=${expose.includes("www-authenticate")}`,
    );
  }
}

function render() {
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] ?? 0) + 1 }), {});
  if (output === "json") {
    process.stdout.write(
      `${JSON.stringify({ baseUrl: base.origin, summary: counts, rows, requests: requestLog, rpcMethods: rpcMethodsSent }, null, 2)}\n`,
    );
    return;
  }
  const width = (key, min) => Math.max(min, ...rows.map((row) => row[key].length));
  const idWidth = width("id", 2);
  const checkWidth = Math.min(86, width("check", 5));
  const resultWidth = 6;
  const line = (id, check, result, detail) =>
    `${id.padEnd(idWidth)}  ${check.slice(0, checkWidth).padEnd(checkWidth)}  ${result.padEnd(resultWidth)}  ${detail}`;
  const out = [`MCP acceptance (read-only) against ${base.origin}`, "", line("ID", "CHECK", "RESULT", "DETAIL"), line("-".repeat(idWidth), "-".repeat(checkWidth), "-".repeat(resultWidth), "-".repeat(6))];
  for (const row of rows) out.push(line(row.id, row.check, row.result, row.detail));
  out.push("", `Summary: ${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(", ")}`);
  out.push(`Requests made: ${requestLog.length} (${[...new Set(requestLog.map((entry) => entry.method))].join(", ")}); JSON-RPC methods: ${rpcMethodsSent.join(", ")}`);
  process.stdout.write(`${out.join("\n")}\n`);
}

await metadataChecks();
await challengeChecks();
await mcpChecks();
await transportChecks();
render();
process.exitCode = rows.some((row) => row.result === "FAIL") ? 1 : 0;
