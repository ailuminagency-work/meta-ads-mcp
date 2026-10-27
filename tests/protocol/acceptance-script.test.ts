import { spawn } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SERVER_URL, bootServer, completeOAuthFlow, type Harness } from "./harness.js";

const SCRIPT = fileURLToPath(new URL("../../scripts/mcp-acceptance.mjs", import.meta.url));

interface ScriptRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runScript(env: Record<string, string>): Promise<ScriptRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

interface JsonReport {
  summary: Record<string, number>;
  rows: { id: string; check: string; result: string; detail: string }[];
  requests: { method: string; path: string; status: number }[];
  rpcMethods: string[];
}

const result = (report: JsonReport, id: string): string | undefined => report.rows.find((row) => row.id === id)?.result;

let booted: Harness | undefined;
let stub: Server | undefined;

afterEach(async () => {
  if (booted) {
    expect(booted.upstream.blocked).toEqual([]);
    await booted.close();
    booted = undefined;
  }
  if (stub) {
    await new Promise<void>((resolve) => stub!.close(() => resolve()));
    stub = undefined;
  }
});

describe("scripts/mcp-acceptance.mjs against the in-process server", () => {
  it("passes against a read-only agency server using only read operations and never prints the token", async () => {
    booted = await bootServer();
    const flow = await completeOAuthFlow(booted.origin);
    const token = flow.tokens.access_token;
    booted.upstream.reset();
    booted.requests.length = 0;

    const run = await runScript({
      BASE_URL: booted.origin,
      EXPECTED_ORIGIN: SERVER_URL,
      MCP_BEARER_TOKEN: token,
      READ_TOOL: "ads_get_account_info",
      READ_TOOL_ARGS: '{"account_id":"101"}',
      EXPECT_READ_ONLY: "true",
      OUTPUT: "json",
    });

    expect(run.stderr).toBe("");
    expect(run.code, run.stdout).toBe(0);
    expect(run.stdout).not.toContain(token);
    expect(run.stdout).not.toContain(flow.tokens.refresh_token);
    const report = JSON.parse(run.stdout) as JsonReport;

    for (const id of ["META-1", "META-2", "META-3", "META-4", "META-5", "AUTH-1", "AUTH-2", "MCP-1", "MCP-2", "MCP-3", "MCP-4", "MCP-5", "MCP-7", "MCP-8", "NET-1"]) {
      expect(result(report, id), `${id}: ${report.rows.find((row) => row.id === id)?.detail}`).toBe("PASS");
    }
    expect(report.summary.FAIL ?? 0).toBe(0);

    const calls = report.rpcMethods.filter((method) => method.startsWith("tools/call"));
    expect(calls).toEqual(["tools/call:ads_get_account_info"]);
    expect(new Set(report.requests.map((entry) => entry.method))).toEqual(new Set(["GET", "POST", "OPTIONS"]));

    const served = booted.requests;
    expect(served.filter((entry) => entry.method === "POST").every((entry) => entry.path === "/mcp")).toBe(true);
    for (const path of ["/register", "/token", "/authorize", "/revoke", "/auth/meta"]) {
      expect(served.some((entry) => entry.path === path), path).toBe(false);
    }
    const graph = booted.upstream.graphCalls();
    expect(graph.map((call) => call.method)).toEqual(["GET"]);
  });

  it("prints a sanitized table by default and reports the standing gaps as WARN, not PASS", async () => {
    booted = await bootServer();
    const flow = await completeOAuthFlow(booted.origin);
    const run = await runScript({
      BASE_URL: booted.origin,
      EXPECTED_ORIGIN: SERVER_URL,
      MCP_BEARER_TOKEN: flow.tokens.access_token,
      READ_TOOL: "ads_get_account_info",
      READ_TOOL_ARGS: '{"account_id":"101"}',
    });
    expect(run.code, run.stdout).toBe(0);
    expect(run.stdout).not.toContain(flow.tokens.access_token);
    expect(run.stdout).toMatch(/^ID\s+CHECK\s+RESULT\s+DETAIL/m);
    expect(run.stdout).toMatch(/Summary: \d+ PASS/);
    expect(run.stdout).toMatch(/META-6\s.*WARN/);
    expect(run.stdout).toMatch(/MCP-6\s.*WARN/);
    expect(run.stdout).toMatch(/CORS-claude\.ai\s.*WARN/);
  });

  it("skips the authenticated rows when no token is supplied and still checks the public surface", async () => {
    booted = await bootServer();
    const run = await runScript({ BASE_URL: booted.origin, EXPECTED_ORIGIN: SERVER_URL, OUTPUT: "json" });
    expect(run.code, run.stdout).toBe(0);
    const report = JSON.parse(run.stdout) as JsonReport;
    expect(result(report, "META-1")).toBe("PASS");
    expect(result(report, "AUTH-1")).toBe("PASS");
    expect(result(report, "MCP-1")).toBe("SKIP");
    expect(report.rpcMethods.some((method) => method.startsWith("tools/call"))).toBe(false);
  });

  it("fails and exits 1 for an invalid token without echoing it", async () => {
    booted = await bootServer();
    const bogus = "synthetic-invalid-bearer-credential";
    const run = await runScript({ BASE_URL: booted.origin, EXPECTED_ORIGIN: SERVER_URL, MCP_BEARER_TOKEN: bogus, OUTPUT: "json" });
    expect(run.code).toBe(1);
    expect(run.stdout).not.toContain(bogus);
    expect(result(JSON.parse(run.stdout) as JsonReport, "MCP-1")).toBe("FAIL");
  });

  it("refuses to call a tool that is not annotated read-only, even when the server lists it", async () => {
    booted = await bootServer({ writes: true, platform: true });
    const flow = await completeOAuthFlow(booted.origin);
    booted.upstream.reset();
    const run = await runScript({
      BASE_URL: booted.origin,
      EXPECTED_ORIGIN: SERVER_URL,
      MCP_BEARER_TOKEN: flow.tokens.access_token,
      READ_TOOL: "ads_create_campaign",
      READ_TOOL_ARGS: "{}",
      EXPECT_READ_ONLY: "true",
      OUTPUT: "json",
    });
    expect(run.code).toBe(1);
    const report = JSON.parse(run.stdout) as JsonReport;
    expect(result(report, "MCP-5")).toBe("FAIL");
    expect(result(report, "MCP-4")).toBe("FAIL");
    expect(report.rpcMethods.some((method) => method.startsWith("tools/call"))).toBe(false);
    expect(booted.upstream.graphCalls()).toHaveLength(0);
  });

  it("redacts the bearer token and JWT-shaped strings that a server echoes back", async () => {
    const token = "synthetic-echoed-bearer-credential-0123456789";
    const segment = (value: string): string => Buffer.from(value).toString("base64url");
    const jwtLike = [segment('{"alg":"HS256"}'), segment('{"synthetic":true,"purpose":"redaction-check"}'), segment("synthetic-signature-bytes")].join(".");
    stub = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const origin = `http://127.0.0.1:${(stub!.address() as AddressInfo).port}`;
        const json = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.url?.startsWith("/.well-known/oauth-protected-resource")) return json(200, { resource: `${origin}/mcp`, authorization_servers: [`${origin}/`] });
        if (req.url?.startsWith("/.well-known/oauth-authorization-server")) {
          return json(200, { issuer: `${origin}/`, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, code_challenge_methods_supported: ["S256"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
        }
        const rpc = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        if (rpc.method === "initialize") return json(200, { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "stub" }, capabilities: { tools: {} } } });
        if (rpc.method === "tools/list") {
          return json(200, { jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "ads_get_ad_accounts", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] } });
        }
        if (rpc.method === "tools/call") {
          return json(200, { jsonrpc: "2.0", id: rpc.id, result: { isError: true, content: [{ type: "text", text: `upstream rejected Bearer ${token} and ${jwtLike} at ?access_token=${token}` }] } });
        }
        res.writeHead(rpc.method ? 202 : 404).end();
      });
    });
    await new Promise<void>((resolve) => stub!.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    const run = await runScript({ BASE_URL: origin, MCP_BEARER_TOKEN: token, OUTPUT: "json" });
    expect(run.stdout).not.toContain(token);
    expect(run.stdout).not.toContain(jwtLike);
    expect(run.stdout).toContain("[REDACTED");
    expect(result(JSON.parse(run.stdout) as JsonReport, "MCP-5")).toBe("FAIL");
  });

  it.each([
    ["no BASE_URL", {}, /BASE_URL is required/],
    ["credentials in BASE_URL", { BASE_URL: "https://user:pw@example.invalid" }, /must not contain credentials/],
    ["a path in BASE_URL", { BASE_URL: "https://example.invalid/mcp" }, /origin without a path/],
    ["whitespace in the token", { BASE_URL: "https://example.invalid", MCP_BEARER_TOKEN: "two words" }, /must not contain whitespace/],
    ["non-object tool arguments", { BASE_URL: "https://example.invalid", READ_TOOL_ARGS: "[1]" }, /must be a JSON object/],
  ])("exits 2 with a usage message for %s", async (_label, env, message) => {
    const run = await runScript(env as Record<string, string>);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(message);
    expect(run.stdout).toBe("");
  });
});
