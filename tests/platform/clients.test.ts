import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import {loadManualEligibilityEvidence} from "../../src/platform/manual-eligibility.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaGraphClient, ProductRateController, assertContractEligibility, configureMessagingWindowVerifier, contractPlanParameters, productVersion, projectProviderResponse, validateContractParameters } from "../../src/platform/clients.js";
import { PRODUCT_CONTRACTS, type ProductContract } from "../../src/platform/products/contracts.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { authorizeOperation, getExecutionScope, runWithExecutionPermit } from "../../src/platform/execution.js";
import { encryptCredential } from "../../src/platform/connections.js";
import { canonicalPlanHash, classifyPlan, revisionHash } from "../../src/platform/policy.js";
import type { AssetGrant, AuthorizationSnapshot, Connection, MetaAsset, OperationContext, OperationPlan } from "../../src/platform/models.js";

const profile = PRODUCT_CONTRACTS.find(c => c.tool === "threads_get_profile")!;
const messaging = PRODUCT_CONTRACTS.find(c => c.tool === "messenger_send_text")!;
const input = { recipient: { id: "456" }, message: { text: "Synthetic response" } };
beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 2).toString("hex")));
afterEach(() => { vi.unstubAllEnvs(); configureMessagingWindowVerifier(async () => false); });

async function fixture(contract: ProductContract, parameters: Record<string, unknown> = {}, clientId = "client-test", connectionId = "connection-test", token = "synthetic-client-fixture", eligibilityLifetimeMs=3600000) {
  const now = Date.now(), repo = new InMemoryPlatformRepository();
  const ctx: OperationContext = { principal: { operatorId: "operator-test", tenantId: "tenant-test" }, clientId, tool: contract.tool, provider: contract.provider, requestId: "request-test" };
  const tenant = { id: "tenant-test", status: "ACTIVE" as const, policyRevision: 1, registryRevision: 1, migrationState: "READY" as const };
  const member = { operatorId: "operator-test", tenantId: tenant.id, roles: ["admin"], allowedClientIds: [clientId], revision: 1, disabledAt: null };
  const client = { id: clientId, tenantId: tenant.id, status: "ACTIVE" as const, revision: 1, verifiedBusinessIds: [] };
  const asset: MetaAsset = { key: "asset-test", id: "123", type: contract.assetType, tenantId: tenant.id, clientId, provider: contract.provider, appId: "app-test", parents: [], verifiedAt: now - 1, revokedAt: null, revision: 1 };
  let connection: Connection = { subjectId:asset.id,id: connectionId, tenantId: tenant.id, operatorId: member.operatorId, provider: contract.provider, authStrategy: "fixture", credentialId: "credential-test", appId: "app-test", tokenType: contract.tokenTypes[0], scopes: contract.requiredScopes, assetKeys: [asset.key], expiresAt: now + 3600000, revokedAt: null, verifiedAt: now - 1, revision: 1, eligibility: contract.manualRequirements.map(requirement => ({ requirement, source: "https://developers.facebook.com/docs/fixture", checkedAt: now - 1, expiresAt: now + eligibilityLifetimeMs, verified: true })) };
  const plan: OperationPlan = { parameters: contractPlanParameters(contract, asset.id, parameters), assets: [{ type: asset.type, id: asset.id }], classes: contract.operationClasses, capability: contract.id, requiredScopes: contract.requiredScopes, tokenTypes: contract.tokenTypes, requiredTasks: contract.requiredTasks ?? [], createOrCopy: contract.createOrCopy ?? false };
  plan.classes = classifyPlan(plan);
  const grant: AssetGrant = { id: "grant-test", tenantId: tenant.id, clientId, assetKey: asset.key, connectionId, capabilities: [contract.id], actions: plan.classes, tasks: contract.requiredTasks ?? [], verifiedAt: now - 1, expiresAt: now + 3600000, revokedAt: null, revision: 1 };
  await repo.put("tenants", tenant.id, tenant.id, tenant);
  await repo.put("members", tenant.id, member.operatorId, member);
await repo.put("operatorIndex","_index",member.operatorId,{operatorId:member.operatorId,tenantId:tenant.id});
  await repo.put("clients", tenant.id, clientId, client);
  await repo.put("assets", tenant.id, asset.key, asset);
  await repo.put("connections", tenant.id, connectionId, connection);
  await repo.put("grants", tenant.id, grant.id, grant);
  await repo.put("credentials", tenant.id, connection.credentialId, encryptCredential({ id: connection.credentialId, tenantId: tenant.id, operatorId: member.operatorId, provider: contract.provider, appId: connection.appId, keyVersion: "primary" }, token));
  if(contract.eligibilityPolicies){if(eligibilityLifetimeMs!==3600000){connection={...connection,expiresAt:now+eligibilityLifetimeMs};await repo.put("connections",tenant.id,connectionId,connection);}await establishManualEligibilityFixture(repo,tenant.id,clientId,connectionId);connection=(await repo.get("connections",tenant.id,connectionId))!;}
  const manualEligibilityEvidence=await loadManualEligibilityEvidence(repo,ctx,connection,contract.eligibilityRequirements);
  const mutation = plan.classes.some(c => c !== "READ");
  if (mutation) {
    const snapshot: AuthorizationSnapshot = { tenant, member, client, assets: [asset], connection, grants: [grant],manualEligibilityEvidence };
    await repo.put("approvals", tenant.id, "approval-test", { id: "approval-test", tenantId: tenant.id, clientId, actorId: member.operatorId, approverId: member.operatorId, approverRevision: member.revision, planHash: canonicalPlanHash(ctx, plan), revisionHash: revisionHash(snapshot), expiresAt: now + 60000, consumedAt: null, operationId: null });
  }
  const permit = await authorizeOperation(repo, ctx, plan, { writesEnabled: mutation, ...(mutation ? { approvalId: "approval-test" } : {}) });
  return { repo, permit, connection, asset, plan };
}

describe("product client egress boundary", () => {
  it("denies grant revocation while the final messaging policy lookup is pending",async()=>{const {permit,repo}=await fixture(messaging,input,"window-revoked-client","window-revoked-connection","synthetic-window-revoked");let checks=0;configureMessagingWindowVerifier(async()=>{if(++checks===2){const g=(await repo.get("grants","tenant-test","grant-test"))!;await repo.put("grants","tenant-test","grant-test",{...g,revokedAt:Date.now(),revision:2});}return {validUntil:Date.now()+60000};});const fetcher=vi.fn(async()=>new Response('{"message_id":"must-not-send"}'));await expect(runWithExecutionPermit(permit,()=>new MetaGraphClient(messaging.provider,fetcher).request(messaging,"123",input))).rejects.toThrow("AUTHORIZATION_CHANGED");expect(fetcher).not.toHaveBeenCalled();});

  it("rejects a window deadline crossed during the final asynchronous verifier",async()=>{
    const started=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValue(started);
    try{const {permit}=await fixture(messaging,input,"window-deadline-client","window-deadline-connection","synthetic-window-deadline");let checks=0;
      configureMessagingWindowVerifier(async()=>{if(++checks===2)clock.mockReturnValue(started+11);return {validUntil:started+10};});
      const fetcher=vi.fn(async()=>new Response('{"message_id":"must-not-send"}'));
      await expect(runWithExecutionPermit(permit,()=>new MetaGraphClient(messaging.provider,fetcher).request(messaging,"123",input))).rejects.toThrow("MESSAGING_WINDOW_EXPIRED_BEFORE_EGRESS");expect(fetcher).not.toHaveBeenCalled();
    }finally{clock.mockRestore();}
  });

  it("rechecks eligibility that expires during the final awaited messaging check",async()=>{
    const started=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValue(started);
    try{
      const {permit}=await fixture(messaging,input,"eligibility-client","eligibility-connection","synthetic-final-eligibility",10);
      let checks=0;configureMessagingWindowVerifier(async()=>{if(++checks===2)clock.mockReturnValue(started+11);return true;});
      const fetcher=vi.fn(async()=>new Response('{"message_id":"must-not-send"}'));
      await expect(runWithExecutionPermit(permit,()=>new MetaGraphClient(messaging.provider,fetcher).request(messaging,"123",input))).rejects.toThrow(/ELIGIBILITY|EXPIRED/);
      expect(checks).toBe(2);expect(fetcher).not.toHaveBeenCalled();
    }finally{clock.mockRestore();}
  });
  it("honors a concurrent429 cooldown imposed during final asynchronous validation",async()=>{
    const token="synthetic-concurrent-final-cooldown",a=await fixture(messaging,input,"delayed-client","delayed-connection",token),b=await fixture(messaging,input,"throttler-client","throttler-connection",token);
    let release!:()=>void,arrived!:()=>void;const blocked=new Promise<void>(r=>{release=r;}),waiting=new Promise<void>(r=>{arrived=r;});let checks=0;
    configureMessagingWindowVerifier(async()=>{if(getExecutionScope().context.clientId==="delayed-client"&&++checks===2){arrived();await blocked;}return true;});
    const delayedFetch=vi.fn(async()=>new Response('{"message_id":"must-not-send"}'));
    const pending=runWithExecutionPermit(a.permit,()=>new MetaGraphClient(messaging.provider,delayedFetch).request(messaging,"123",input));
    const denied=expect(pending).rejects.toThrow("CIRCUIT_OPEN");
    await waiting;
    const throttledFetch=vi.fn(async()=>new Response('{"error":{"code":4}}',{status:429,headers:{"retry-after":"60"}}));
    try{await expect(runWithExecutionPermit(b.permit,()=>new MetaGraphClient(messaging.provider,throttledFetch).request(messaging,"123",input))).rejects.toThrow("HTTP_429");}finally{release();}
    await denied;expect(delayedFetch).not.toHaveBeenCalled();expect(throttledFetch).toHaveBeenCalledOnce();
  });
  it("uses verified Threads host/version and projects only approved scalar fields", async () => {
    vi.stubEnv("THREADS_API_VERSION", undefined);
    const { permit } = await fixture(profile);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "123", name: "fixture", email: "private", access_token: "private", name_extra: "private", nested: { private: true } })));
    const result = await runWithExecutionPermit(permit, () => new MetaGraphClient(profile.provider, fetcher).request(profile, "123"));
    expect(new URL(String(fetcher.mock.calls[0][0])).origin).toBe("https://graph.threads.com");
    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe("/v1.0/123");
    expect(result).toEqual({ id: "123", name: "fixture" });
    expect(productVersion("META_THREADS")).toBe("v1.0");
  });
  it("rejects modified endpoint, target, input, scopes and tasks before fetch", async () => {
    const { permit } = await fixture(profile);
    const fetcher = vi.fn(async () => new Response("{}")), client = new MetaGraphClient(profile.provider, fetcher);
    for (const contract of [{ ...profile, path: "/me" }, { ...profile, requiredScopes: ["different"] }, { ...profile, requiredTasks: ["MANAGE"] }, { ...profile, fixedQuery: { fields: "email" } }]) {
      await expect(runWithExecutionPermit(permit, () => client.request(contract, "123"))).rejects.toThrow("PLAN_MISMATCH");
    }
    await expect(runWithExecutionPermit(permit, () => client.request(profile, "999"))).rejects.toThrow("PLAN_MISMATCH");
    await expect(runWithExecutionPermit(permit, () => client.request(profile, "123", { fields: "email" }))).rejects.toThrow("UNSUPPORTED_ENDPOINT_PARAMETER");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("revalidates revoked grants and stale or absent eligibility before egress", async () => {
    const { permit, repo, connection } = await fixture(profile);
    const fetcher = vi.fn(async () => new Response("{}"));
    await repo.put("connections", connection.tenantId, connection.id, { ...connection, revokedAt: Date.now() });
    await expect(runWithExecutionPermit(permit, () => new MetaGraphClient(profile.provider, fetcher).request(profile, "123"))).rejects.toThrow("AUTHORIZATION_CHANGED");
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => assertContractEligibility(profile, { ...connection, eligibility: [] })).toThrow("ELIGIBILITY");
    expect(() => assertContractEligibility(profile, { ...connection, eligibility: connection.eligibility!.map(e => ({ ...e, checkedAt: Date.now() - 3600001 })) })).toThrow("ELIGIBILITY");
  });
  it("limits streamed response bytes while reading", async () => {
    const { permit } = await fixture(profile);
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_100_000)); controller.enqueue(new Uint8Array(1_100_000)); }, cancel() { cancelled = true; } });
    const fetcher = vi.fn(async () => new Response(body));
    await expect(runWithExecutionPermit(permit, () => new MetaGraphClient(profile.provider, fetcher).request(profile, "123"))).rejects.toThrow("body too large");
    expect(cancelled).toBe(true);
  });
  it("allows exactly one approved mutation and never reuses its approval step", async () => {
    configureMessagingWindowVerifier(async () => true);
    const { permit } = await fixture(messaging, input);
    const fetcher = vi.fn(async () => new Response('{"message_id":"mid.fixture","recipient_id":"456"}'));
    const client = new MetaGraphClient(messaging.provider, fetcher);
    await expect(runWithExecutionPermit(permit, () => client.request(messaging, "123", { ...input, message: { text: "different" } }))).rejects.toThrow("PLAN_MISMATCH");
    expect(await runWithExecutionPermit(permit, () => client.request(messaging, "123", input))).toEqual({ recipient_id: "456", message_id: "mid.fixture" });
    await expect(runWithExecutionPermit(permit, () => client.request(messaging, "123", input))).rejects.toThrow("MUTATION_STEP");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messaging_type).toBe("RESPONSE");
  });
  it("shares provider cooldown across client/connection aliases for the same token/app", async () => {
    const token = "synthetic-rate-identity-fixture";
    const a = await fixture(profile, {}, "client-a", "alias-a", token);
    const b = await fixture(profile, {}, "client-b", "alias-b", token);
    const throttled = vi.fn(async () => new Response('{"error":{"code":4}}', { status: 429, headers: { "retry-after": "172800" } }));
    await expect(runWithExecutionPermit(a.permit, () => new MetaGraphClient(profile.provider, throttled).request(profile, "123"))).rejects.toThrow("HTTP_429");
    const fetcher = vi.fn(async () => new Response("{}"));
    await expect(runWithExecutionPermit(b.permit, () => new MetaGraphClient(profile.provider, fetcher).request(profile, "123"))).rejects.toThrow("CIRCUIT_OPEN");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("snapshots caller parameters across async window verification", async () => {
    const parameters = structuredClone(input);
    const { permit } = await fixture(messaging, parameters);
    let allow: (value: boolean) => void = () => {};
    let windowChecks=0;
    configureMessagingWindowVerifier(() => ++windowChecks === 1 ? new Promise(resolve => { allow = resolve; }) : Promise.resolve(true));
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(JSON.parse(String(options?.body)).message.text).toBe("Synthetic response");
      return new Response('{"message_id":"fixture"}');
    });
    const pending = runWithExecutionPermit(permit, () => new MetaGraphClient(messaging.provider, fetcher).request(messaging, "123", parameters));
    parameters.message.text = "unapproved mutation";
    allow(true);
    await expect(pending).resolves.toEqual({ message_id: "fixture" });
  });
});

it("never shortens concurrent Retry-After or caps it at one day", () => {
  const rate = new ProductRateController();
  rate.observe("fixture", new Response("", { status: 429, headers: { "retry-after": "172800" } }), null, 1000);
  rate.observe("fixture", new Response("{}"), null, 2000);
  rate.observe("fixture", new Response("", { status: 429, headers: { "retry-after": "1" } }), null, 3000);
  expect(() => rate.check("fixture", 1000 + 86400000)).toThrow();
  expect(() => rate.check("fixture", 1000 + 172800000)).not.toThrow();
});

it("rejects unsupported Messenger payload shapes, tags and oversized local text", () => {
  expect(() => validateContractParameters(messaging, input)).not.toThrow();
  for (const parameters of [{ ...input, recipient: { id: 456 } }, { ...input, recipient: { id: "456", extra: true } }, { ...input, message: { attachment: {} } }, { ...input, message: { text: "x".repeat(2001) } }, { ...input, messaging_type: "MESSAGE_TAG" }, { ...input, tag: "HUMAN_AGENT" }]) expect(() => validateContractParameters(messaging, parameters)).toThrow();
});

it("returns pagination cursors only when explicitly verified and drops nested extras", () => {
  const contract = PRODUCT_CONTRACTS.find(c => c.tool === "threads_list_threads")!;
  const raw = { data: [{ id: "id", media_type: "TEXT_POST", message: "private", id_extra: "private" }], paging: { cursors: { before: "b", after: "a", secret: "private" }, next: "https://private.invalid/?access_token=private" } };
  expect(projectProviderResponse(raw, contract)).toEqual({ data: [{ id: "id", media_type: "TEXT_POST" }], paging: { cursors: { before: "b", after: "a" } } });
  expect(projectProviderResponse(raw, { ...contract, pagination: false })).toEqual({ data: [{ id: "id", media_type: "TEXT_POST" }] });
  expect(projectProviderResponse({ id: { private: true }, name: "okay" }, profile)).toEqual({ name: "okay" });
  expect(() => projectProviderResponse({ id: ["unexpected"], name: ["private"] }, profile)).toThrow("PROVIDER_RESPONSE_SCHEMA_INVALID");
  for (const malformed of [null,[],123,"ok",{}]) expect(() => projectProviderResponse(malformed,profile)).toThrow("PROVIDER_RESPONSE_SCHEMA_INVALID");
});

it("binds durable human eligibility to its original reviewed source and timestamps", async () => {
  const { connection,repo } = await fixture(messaging, input);
  const proof={clientId:"client-test",evidence:await loadManualEligibilityEvidence(repo,{principal:{tenantId:"tenant-test",operatorId:"operator-test"},clientId:"client-test",provider:messaging.provider,tool:messaging.tool,requestId:"synthetic"},connection,messaging.eligibilityRequirements)};
  const now = Date.now();
  expect(() => assertContractEligibility(messaging, { ...connection, eligibility: connection.eligibility!.map(e => ({ ...e, source: "https://attacker.invalid/docs" })) }, now,proof)).toThrow("ELIGIBILITY");
  expect(() => assertContractEligibility(messaging, { ...connection, eligibility: connection.eligibility!.map(e => ({ ...e, checkedAt: now - 300001 })) }, now,proof)).toThrow("ELIGIBILITY");
  expect(() => assertContractEligibility(messaging, connection, now,proof)).not.toThrow();
});

it("validates Page feed schema and rejects indirect mentions and unsafe links", () => {
  const contract = PRODUCT_CONTRACTS.find(c => c.tool === "pages_create_feed")!;
  expect(() => validateContractParameters(contract, { message: "Synthetic post", published: false })).not.toThrow();
  expect(() => validateContractParameters(contract, { link: "https://fixture.invalid/article" })).not.toThrow();
  for (const parameters of [{}, { message: { text: "bad" } }, { message: "" }, { link: 123 }, { message: "Post", published: "false" }, { message: "Hello @[123456:foreign]" }, { link: "http://fixture.invalid/" }, { link: "https://fixture.invalid/?access_token=private" }, { link: "https://127.0.0.1/" }]) expect(() => validateContractParameters(contract, parameters)).toThrow();
});

it("rejects known credential-shaped content before approval or publication",()=>{for(const text of ["EAA"+"a".repeat(60),"access_token="+"x".repeat(30),"sk-proj-"+"a".repeat(40)])expect(()=>validateContractParameters(messaging,{recipient:{id:"456"},message:{text}})).toThrow("CREDENTIAL_SHAPED");});
