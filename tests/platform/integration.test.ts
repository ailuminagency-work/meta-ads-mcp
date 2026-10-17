import {TRACKING_CHANGE_TOOLS} from "../../src/platform/tracking-change-tools.js";
import {PAUSED_AD_BATCH_TOOLS} from "../../src/platform/paused-ad-batch-tools.js";
import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import {RESEARCH_JOB_TOOLS} from "../../src/platform/research-tools.js";
import {WORKFLOW_TOOL_NAMES} from "../../src/platform/workflow-tools.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import { LEGACY_MANIFEST } from "../../src/platform/legacy-manifest.js";
import { encryptCredential } from "../../src/platform/connections.js";
import type { AssetGrant, Connection, MetaAsset } from "../../src/platform/models.js";
import { configureFirstPartySignalRuntime } from "../../src/platform/signals-runtime.js";
import { InMemorySignalDispatchStore } from "../../src/platform/signals-dispatch.js";
import { firstPartySignalDigest, type FirstPartySignalInput, type SignalEvidence } from "../../src/platform/signals.js";

const selected = PRODUCT_CONTRACTS.find(contract => contract.tool === "threads_get_profile")!;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("DEPLOYMENT_MODE", "legacy"); vi.stubEnv("LUMIN_PLATFORM_ENABLED", "false");
  vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "false"); vi.stubEnv("AGENCY_WRITES_ENABLED", "false");
  fetcher = vi.fn(async () => { throw new Error("External network is prohibited in integration fixtures"); });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { configurePlatformRepository(undefined); configureFirstPartySignalRuntime(undefined); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const server = createServer(); const client = new Client({ name: "platform-fixture", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try { return await work(client); } finally { await client.close(); await server.close(); }
}
async function fixture() {
  vi.stubEnv("LUMIN_PLATFORM_ENABLED", "true");
  const now = Date.now(); const repo = new InMemoryPlatformRepository(); configurePlatformRepository(repo);
  await repo.put("tenants", "tenant", "tenant", { id: "tenant", status: "ACTIVE", migrationState: "READY", registryRevision: 1, policyRevision: 1 });
  await repo.put("members", "tenant", "operator", { tenantId: "tenant", operatorId: "operator", roles: ["reader"], allowedClientIds: ["client-a"], revision: 1, disabledAt: null });
  await repo.put("operatorIndex", "_index", "operator", { tenantId: "tenant", operatorId: "operator" });
  await repo.put("clients", "tenant", "client-a", { tenantId: "tenant", id: "client-a", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  const asset: MetaAsset = { key: "threads-account", type: "THREADS_ACCOUNT", id: "101", tenantId: "tenant", clientId: "client-a", provider: "META_THREADS", appId: "app", parents: [], verifiedAt: now - 1000, revokedAt: null, revision: 1 };
  const connection: Connection = { subjectId:asset.id,id: "threads-connection", tenantId: "tenant", operatorId: "operator", provider: "META_THREADS", appId: "app", credentialId: "credential", authStrategy: "threads", tokenType: "threads", scopes: ["threads_basic"], assetKeys: [asset.key], expiresAt: now + 60_000, revokedAt: null, verifiedAt: now - 1000, revision: 1, eligibility: selected.manualRequirements.map(requirement => ({ requirement, verified: true, source: selected.documentation[0], checkedAt: now - 1000, expiresAt: now + 60_000 })) };
  const grant: AssetGrant = { id: "grant", tenantId: "tenant", clientId: "client-a", assetKey: asset.key, connectionId: connection.id, capabilities: [selected.id], actions: ["READ"], tasks: [], verifiedAt: now - 1000, expiresAt: now + 60_000, revokedAt: null, revision: 1 };
  await repo.put("assets", "tenant", asset.key, asset); await repo.put("connections", "tenant", connection.id, connection); await repo.put("grants", "tenant", grant.id, grant);
  await repo.put("credentials", "tenant", "credential", encryptCredential({ id: "credential", tenantId: "tenant", operatorId: "operator", provider: "META_THREADS", appId: "app", keyVersion: "primary" }, "fixture-platform-access"));
 await establishManualEligibilityFixture(repo,"tenant","client-a",connection.id);
  return { repo, asset, connection, grant };
}
function call(client: Client, name: string, args: Record<string, unknown>, operator = "operator") {
  return requestContext.run({ accessToken: "unused-legacy-fixture", fbUserId: operator }, () => client.callTool({ name, arguments: args }));
}

describe("native MCP platform registration and invocation", () => {
  it.each(["unchanged","withdrawal","expiry","digest","source-substitution","offline-consolidated","offline-unconsolidated","offline-foreign"])("enforces fresh branded CAPI source at actual native guarded callback: %s",async mode=>{
    const {repo,asset,connection,grant}=await fixture(),contract=PRODUCT_CONTRACTS.find(c=>c.tool==="signals_send_pixel_events")!,now=Date.now();
    vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED","true");vi.stubEnv("AGENCY_WRITES_ENABLED","true");
    await repo.put("members","tenant","operator",{tenantId:"tenant",operatorId:"operator",roles:["writer"],allowedClientIds:["client-a"],revision:1,disabledAt:null});
    const pixel:MetaAsset={...asset,key:"pixel",type:"PIXEL",provider:"META_MARKETING"};
    const capiConnection:Connection={...connection,id:"capi",provider:"META_MARKETING",tokenType:"system_user",assetKeys:[pixel.key],scopes:[...contract.requiredScopes],eligibility:contract.manualRequirements.map(requirement=>({requirement,verified:true,source:contract.documentation[0],checkedAt:now-1000,expiresAt:now+60_000}))};
    await repo.put("assets","tenant",pixel.key,pixel);await repo.put("connections","tenant",capiConnection.id,capiConnection);await repo.put("grants","tenant","capi-grant",{...grant,id:"capi-grant",assetKey:pixel.key,connectionId:capiConnection.id,capabilities:[contract.id],actions:["WRITE_NON_FINANCIAL"]});
    await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"fixture-platform-access"));
    await establishManualEligibilityFixture(repo,"tenant","client-a",capiConnection.id);
    const raw:FirstPartySignalInput={source_reference:"source",consent_reference:"consent",event_name:"Lead",event_id:"event-1",event_time:Math.floor(now/1000),action_source:mode.startsWith("offline-")?"physical_store":"website",event_source_url:"https://example.invalid/lead",user_data:{em:"private@example.invalid"}};
    const evidence:SignalEvidence={tenantId:"tenant",clientId:"client-a",datasetId:"101",payloadDigest:firstPartySignalDigest(raw),sourceReference:"source",consentReference:"consent",eventId:raw.event_id,eventName:raw.event_name,eventTime:raw.event_time,authorized:true,expiresAt:now+60_000};let reads=0;
    configureFirstPartySignalRuntime({store:new InMemorySignalDispatchStore(),source:{resolve:async()=>{reads++;if(reads===3){if(mode==="withdrawal")evidence.authorized=false;if(mode==="expiry")evidence.expiresAt=Date.now()-1;if(mode==="digest")raw.user_data.em="substituted@example.invalid";if(mode==="source-substitution"){raw.source_reference="other";evidence.sourceReference="other";evidence.payloadDigest=firstPartySignalDigest(raw);}}return {raw,evidence};}}});
    fetcher.mockImplementation(async(url:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==="GET"){expect(new URL(String(url)).searchParams.get("fields")).toBe("id,is_consolidated_container");return new Response(JSON.stringify({id:mode==="offline-foreign"?"999":"101",is_consolidated_container:mode==="offline-consolidated"}));}return new Response(JSON.stringify({events_received:1,access_token:"not-returnable"}),{status:200});});
    await withClient(async client=>{
      const response=await call(client,contract.tool,{client_id:"client-a",asset_id:"101",source_reference:"source",consent_reference:"consent"});expect(response.isError,JSON.stringify(response.content)).not.toBe(true);
      expect(JSON.stringify(response.content)).toContain(["unchanged","offline-consolidated"].includes(mode)?"ACCEPTED":"UNKNOWN");expect(JSON.stringify(response.content)).not.toContain("private@example.invalid");expect(JSON.stringify(response.content)).not.toContain("not-returnable");
    });
    expect(reads).toBe(mode==="offline-consolidated"?4:3);expect(fetcher).toHaveBeenCalledTimes(mode==="offline-consolidated"?2:mode.startsWith("offline-")||mode==="unchanged"?1:0);if(["offline-unconsolidated","offline-foreign"].includes(mode))expect(fetcher.mock.calls.every(call=>call[1]?.method==="GET")).toBe(true);
  });
  it("preserves the exact 142-tool baseline when the feature is disabled", async () => {
    await withClient(async client => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(142);
      expect(tools.map(tool => tool.name).sort()).toEqual(LEGACY_MANIFEST.map(tool => tool.name).sort());
      expect(tools.some(tool => tool.name.startsWith("meta_"))).toBe(false);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("publishes an exact strict inventory and preserves truthful mutation annotations", async () => {
    await fixture();
    await withClient(async client => {
      const { tools } = await client.listTools();
      const expected = new Set([...LEGACY_MANIFEST.map(tool => tool.name), ...PRODUCT_CONTRACTS.filter(contract => contract.product !== "oembed" || contract.verified).map(contract => contract.tool), "meta_list_assets", "meta_list_connections", "meta_list_capabilities", "meta_list_manual_actions", "meta_admin_get_status", "meta_prepare_action", "meta_get_action_status",...WORKFLOW_TOOL_NAMES,...RESEARCH_JOB_TOOLS,...PAUSED_AD_BATCH_TOOLS,...TRACKING_CHANGE_TOOLS]);
      expect(expected.size).toBe(LEGACY_MANIFEST.length+PRODUCT_CONTRACTS.filter(c=>c.product!=="oembed"||c.verified).length+7+WORKFLOW_TOOL_NAMES.length+RESEARCH_JOB_TOOLS.length+PAUSED_AD_BATCH_TOOLS.length+TRACKING_CHANGE_TOOLS.length);
      expect(tools.map(tool => tool.name).sort()).toEqual([...expected].sort());
      expect(tools.find(tool => tool.name === "pages_create_feed")?.annotations?.readOnlyHint).toBe(false);
      expect(tools.find(tool => tool.name === "pages_delete_post")?.annotations?.destructiveHint).toBe(true);
      expect(tools.find(tool => tool.name === selected.tool)?.annotations?.readOnlyHint).toBe(true);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses migrated native legacy calls without explicit client isolation", async () => {
    await fixture();
    await withClient(async client => {
      const response = await call(client, "ads_get_ad_creatives", {account_id:"act_101",ad_id:"202"});
      expect(response.isError).toBe(true); expect(JSON.stringify(response.content)).toContain("client_id");
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("invokes the real guarded callback with operator context and projects provider output", async () => {
    const { repo } = await fixture();
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ id: "101", username: "fixture-account", access_token: "not-returnable", message: "private customer text", other: { credential: "not-returnable" } }), { status: 200 }));
    await withClient(async client => {
      const response = await call(client, selected.tool, { client_id: "client-a", asset_id: "101" });
      expect(response.isError,JSON.stringify(response.content)).not.toBe(true);
      const output = JSON.stringify(response.content);
      expect(output).toContain("fixture-account"); expect(output).not.toContain("not-returnable"); expect(output).not.toContain("private customer text");
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://graph.threads.com/v1.0/101"); expect(options.redirect).toBe("error");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer fixture-platform-access");
    expect(await repo.list("audit", "tenant")).toEqual([]); expect(await repo.list("operations", "tenant")).toEqual([]);
  });
  it.each(["anonymous", "unknown-operator", "cross-client", "raw-id", "fields-injection", "hold-contract"])("blocks %s before any external request", async attack => {
    await fixture();
    await withClient(async client => {
      const name = attack === "hold-contract" ? "business_get" : selected.tool;
      const args = { client_id: attack === "cross-client" ? "client-b" : "client-a", asset_id: attack === "raw-id" ? "999" : "101", ...(attack === "fields-injection" ? { input: { fields: "access_token" } } : {}) };
      const response = attack === "anonymous" ? await client.callTool({ name, arguments: args }) : await call(client, name, args, attack === "unknown-operator" ? "unknown" : "operator");
      expect(response.isError).toBe(true); expect(JSON.stringify(response.content)).not.toContain("fixture-platform-access");
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([null, true, [], { access_token: "not-returnable" }, { id: ["unexpected-shape"] }])("fails closed on semantically malformed HTTP success: %j", async body => {
    const { repo } = await fixture();
    fetcher.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
    await withClient(async client => {
      const response = await call(client, selected.tool, { client_id: "client-a", asset_id: "101" });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response.content)).toContain("PROVIDER_RESPONSE_SCHEMA_INVALID");
      expect(JSON.stringify(response.content)).not.toContain("DURABLE_COMPLETION_PENDING");
      expect(JSON.stringify(response.content)).not.toContain("not-returnable");
    });
    expect(await repo.list("operations", "tenant")).toEqual([]);
  });
  it("native capability inspection uses dry-run checks and does not return the credential envelope", async () => {
    const { repo } = await fixture();
    await withClient(async client => {
      const response = await call(client, "meta_list_capabilities", { client_id: "client-a" });
      expect(response.isError,JSON.stringify(response.content)).not.toBe(true);
      const content = response.content as Array<{ type: string; text: string }>;
      const capabilities = JSON.parse(content[0].text) as Array<{ tool: string; status: string; grantedPermissions: string[] }>;
      expect(capabilities.find(capability => capability.tool === selected.tool)?.status).toBe("AVAILABLE");
      expect(JSON.stringify(content)).not.toContain("ciphertext"); expect(JSON.stringify(content)).not.toContain("fixture-platform-access");
    });
    expect(fetcher).not.toHaveBeenCalled(); expect(await repo.list("operations", "tenant")).toEqual([]);
  });
});
