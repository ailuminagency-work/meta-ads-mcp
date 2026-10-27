import {TRACKING_CHANGE_TOOLS} from "../../src/platform/tracking-change-tools.js";
import {PAUSED_AD_BATCH_TOOLS} from "../../src/platform/paused-ad-batch-tools.js";
import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import {RESEARCH_JOB_TOOLS} from "../../src/platform/research-tools.js";
import {WORKFLOW_TOOL_NAMES} from "../../src/platform/workflow-tools.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { metaApiClient } from "../../src/meta/client.js";
import { productRateController } from "../../src/platform/clients.js";

// A throttle code (4, 17, 32, 613, 429) blocks the bucket and trips the circuit for the shared test token; each scenario starts clean.
const resetProviderThrottles = (): void => {
  metaApiClient.resetForTests();
  for (const field of ["states", "apps", "appBlocks"]) (productRateController as unknown as Record<string, Map<string, unknown>>)[field].clear();
};
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
  resetProviderThrottles();
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



type Responder = (init: RequestInit | undefined) => Response | Promise<Response>;
const J = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
/** The same recorded Graph responses are used for the strict legacy write path and the generic product path; both must end the operation the same way. */
const SCENARIOS: Array<[string, Responder, "FAILED" | "UNKNOWN"]> = [
  ["400 code 100 (rejected)", () => J(400, { error: { code: 100, message: "Invalid parameter" } }), "FAILED"],
  ["400 code 1 (unknown error)", () => J(400, { error: { code: 1 } }), "UNKNOWN"],
  ["400 code 4 + is_transient", () => J(400, { error: { code: 4, is_transient: true } }), "UNKNOWN"],
  ["400 code 100 + is_transient", () => J(400, { error: { code: 100, is_transient: true } }), "UNKNOWN"],
  ["400 code 100 + is_transient false", () => J(400, { error: { code: 100, is_transient: false } }), "FAILED"],
  ["400 code 17 (user limit)", () => J(400, { error: { code: 17 } }), "FAILED"],
  ["403 code 200 (permission)", () => J(403, { error: { code: 200 } }), "FAILED"],
  ["429 code 4", () => J(429, { error: { code: 4 } }), "UNKNOWN"],
  ["500 code 1", () => J(500, { error: { code: 1 } }), "UNKNOWN"],
  ["400 non-JSON body", () => J(400, "oops"), "UNKNOWN"],
];
const LOCK = { FAILED: "RELEASED", UNKNOWN: "HELD" } as const;
describe("failure outcome of a provider write on the product client path", () => {
  it.each(SCENARIOS)("%s", async (label, respond, expected) => {
    const {repo,asset,connection,grant}=await fixture(),contract=PRODUCT_CONTRACTS.find(c=>c.tool==="signals_send_pixel_events")!,now=Date.now();
    vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED","true");vi.stubEnv("AGENCY_WRITES_ENABLED","true");
    await repo.put("members","tenant","operator",{tenantId:"tenant",operatorId:"operator",roles:["writer"],allowedClientIds:["client-a"],revision:1,disabledAt:null});
    const pixel:MetaAsset={...asset,key:"pixel",type:"PIXEL",provider:"META_MARKETING"};
    const capiConnection:Connection={...connection,id:"capi",provider:"META_MARKETING",tokenType:"system_user",assetKeys:[pixel.key],scopes:[...contract.requiredScopes],eligibility:contract.manualRequirements.map(requirement=>({requirement,verified:true,source:contract.documentation[0],checkedAt:now-1000,expiresAt:now+60_000}))};
    await repo.put("assets","tenant",pixel.key,pixel);await repo.put("connections","tenant",capiConnection.id,capiConnection);await repo.put("grants","tenant","capi-grant",{...grant,id:"capi-grant",assetKey:pixel.key,connectionId:capiConnection.id,capabilities:[contract.id],actions:["WRITE_NON_FINANCIAL"]});
    await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"fixture-platform-access"));
    await establishManualEligibilityFixture(repo,"tenant","client-a",capiConnection.id);
    const raw:FirstPartySignalInput={source_reference:"source",consent_reference:"consent",event_name:"Lead",event_id:"event-1",event_time:Math.floor(now/1000),action_source:"website",event_source_url:"https://example.invalid/lead",user_data:{em:"private@example.invalid"}};
    const evidence:SignalEvidence={tenantId:"tenant",clientId:"client-a",datasetId:"101",payloadDigest:firstPartySignalDigest(raw),sourceReference:"source",consentReference:"consent",eventId:raw.event_id,eventName:raw.event_name,eventTime:raw.event_time,authorized:true,expiresAt:now+60_000};
    configureFirstPartySignalRuntime({store:new InMemorySignalDispatchStore(),source:{resolve:async()=>({raw,evidence})}});
    const posts:string[]=[];
    fetcher.mockImplementation(async(url:RequestInfo|URL,init?:RequestInit)=>{if(init?.method&&init.method!=="GET"){posts.push(init.method+" "+new URL(String(url)).pathname);return respond(init);}return new Response(JSON.stringify({events_received:1}),{status:200});});
    await withClient(async client=>{
      const response=await call(client,contract.tool,{client_id:"client-a",asset_id:"101",source_reference:"source",consent_reference:"consent"});
      const requests=await repo.list("approvalRequests","tenant"),approvals=await repo.list("approvals","tenant");
      const ops=(await repo.list("operations","tenant")).map(o=>o.state),locks=(await (repo as any).list("operationPlanLocks","tenant")).map((x:any)=>x.state);expect({ label, operation: ops, lock: locks }).toEqual({ label, operation: [expected], lock: [LOCK[expected]] });
    });
    expect(posts.length).toBe(1);
  });
});
