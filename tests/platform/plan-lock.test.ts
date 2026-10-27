import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirestorePlatformRepository, InMemoryPlatformRepository, type Completion, type PlatformRepository, type Preparation } from "../../src/platform/repository.js";
import { PRIVACY_PROVENANCE_COLLECTION } from "../../src/platform/meta-privacy-provenance.js";
import { fakeFirestore } from "./firestore-transaction-fake.js";

beforeEach(() => vi.stubEnv("META_APP_ID", "300"));
afterEach(() => vi.unstubAllEnvs());

type Result = Completion["result"];
const stores: Array<[string, () => { repo: PlatformRepository; data?: Map<string, unknown> }]> = [
  ["in-memory repository", () => ({ repo: new InMemoryPlatformRepository() })],
  ["Firestore repository (transaction fake)", () => { const fake = fakeFirestore(); return { repo: new FirestorePlatformRepository(fake.db), data: fake.data }; }],
];

const preparation = (id: string, over: { planHash?: string; tenantId?: string; approvalId?: string } = {}): Preparation => {
  const tenantId = over.tenantId ?? "tenant", planHash = over.planHash ?? "plan-1", approvalId = over.approvalId ?? null;
  return {
    operation: { id, tenantId, clientId: "client", actorId: "actor", tool: "write", planHash, state: "PREPARED", approvalId, createdAt: 1, updatedAt: 1 },
    audit: { id: `${id}:prepared`, tenantId, clientId: "client", actorId: "actor", tool: "write", operationId: id, event: "PREPARED", timestamp: 1, assetKeys: [], planHash, approvalId },
    ...(approvalId ? { approvalId } : {}), expectedRevisionHash: "revision", now: Date.now(), expectedRecords: [],
  };
};
const completion = (p: Preparation, result: Result): Completion => ({ tenantId: p.operation.tenantId, operationId: p.operation.id, result, audit: { ...p.audit, id: `${p.operation.id}:result`, event: result, timestamp: Date.now() } });
const lockOf = (repo: PlatformRepository, planHash = "plan-1", tenantId = "tenant") => repo.get("operationPlanLocks", tenantId, planHash);

describe.each(stores)("per-plan lock in the %s", (_name, make) => {
  it("holds the plan from the moment its operation is prepared", async () => {
    const { repo } = make(), first = preparation("op-1");
    await repo.prepareOperation(first);
    expect(await lockOf(repo)).toMatchObject({ id: "plan-1", operationId: "op-1", state: "HELD", releasedAt: null });
    await expect(repo.prepareOperation(preparation("op-2"))).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
    expect(await repo.get("operations", "tenant", "op-2")).toBeNull();
    expect(await repo.get("audit", "tenant", "op-2:prepared")).toBeNull();
  });

  it.each(["UNKNOWN", "PARTIAL"] as const)("keeps the plan locked after the first attempt finishes %s", async result => {
    const { repo } = make(), first = preparation("op-1");
    await repo.prepareOperation(first);
    await repo.finishOperation(completion(first, result));
    expect((await repo.get("operations", "tenant", "op-1"))?.state).toBe(result);
    expect(await lockOf(repo)).toMatchObject({ state: "HELD", operationId: "op-1", releasedAt: null });
    await expect(repo.prepareOperation(preparation("op-2"))).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
    expect(await repo.get("operations", "tenant", "op-2")).toBeNull();
  });

  it.each(["SUCCEEDED", "FAILED"] as const)("releases the plan when the first attempt finishes %s, so the same plan can be prepared again", async result => {
    const { repo } = make(), first = preparation("op-1");
    await repo.prepareOperation(first);
    await repo.finishOperation(completion(first, result));
    expect(await lockOf(repo)).toMatchObject({ state: "RELEASED", releasedResult: result });
    const second = preparation("op-2");
    await repo.prepareOperation(second);
    expect(await lockOf(repo)).toMatchObject({ state: "HELD", operationId: "op-2", releasedAt: null });
    await repo.finishOperation(completion(second, "UNKNOWN"));
    await expect(repo.prepareOperation(preparation("op-3"))).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
  });

  it("is idempotent when the same outcome is finished twice and cannot be released by another operation", async () => {
    const { repo } = make(), first = preparation("op-1");
    await repo.prepareOperation(first);
    await repo.finishOperation(completion(first, "UNKNOWN"));
    await repo.finishOperation(completion(first, "UNKNOWN"));
    expect(await lockOf(repo)).toMatchObject({ state: "HELD", operationId: "op-1" });
    const other = preparation("op-9", { planHash: "plan-9" });
    await repo.prepareOperation(other);
    await repo.finishOperation(completion(other, "SUCCEEDED"));
    expect(await lockOf(repo)).toMatchObject({ state: "HELD", operationId: "op-1" });
    expect(await lockOf(repo, "plan-9")).toMatchObject({ state: "RELEASED" });
  });

  it("does not affect another plan or another tenant", async () => {
    const { repo } = make(), first = preparation("op-1");
    await repo.prepareOperation(first);
    await repo.finishOperation(completion(first, "UNKNOWN"));
    await repo.prepareOperation(preparation("op-2", { planHash: "plan-2" }));
    await repo.prepareOperation(preparation("op-3", { tenantId: "tenant-2" }));
    expect(await lockOf(repo, "plan-1", "tenant-2")).toMatchObject({ state: "HELD", operationId: "op-3" });
    expect(await lockOf(repo, "plan-1", "tenant")).toMatchObject({ operationId: "op-1" });
  });

  it("lets exactly one of two racing prepares take the lock", async () => {
    const { repo } = make();
    const outcomes = await Promise.allSettled([repo.prepareOperation(preparation("op-a")), repo.prepareOperation(preparation("op-b"))]);
    expect(outcomes.map(o => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = outcomes.find(o => o.status === "rejected") as PromiseRejectedResult;
    expect(String((rejected.reason as Error).message)).toMatch(/PRIOR_ATTEMPT_UNRECONCILED|ALREADY_EXISTS/);
    const winner = (await lockOf(repo))!.operationId;
    expect(["op-a", "op-b"]).toContain(winner);
    expect((await repo.get("operations", "tenant", winner === "op-a" ? "op-b" : "op-a"))).toBeNull();
  });

  it("refuses before the one-use approval is consumed, which stays unspent", async () => {
    const { repo } = make(), first = preparation("op-1");
    await repo.prepareOperation(first);
    await repo.finishOperation(completion(first, "UNKNOWN"));
    await repo.put("approvals", "tenant", "approval", { id: "approval", tenantId: "tenant", clientId: "client", actorId: "actor", approverId: "human", approverRevision: 1, planHash: "plan-1", revisionHash: "revision", expiresAt: Date.now() + 60000, consumedAt: null, operationId: null });
    await repo.put("members", "tenant", "human", { operatorId: "human", tenantId: "tenant", roles: ["approver"], allowedClientIds: ["client"], revision: 1, disabledAt: null });
    await expect(repo.prepareOperation(preparation("op-2", { approvalId: "approval" }))).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
    expect(await repo.get("approvals", "tenant", "approval")).toMatchObject({ consumedAt: null, operationId: null });
    expect(await repo.get("audit", "tenant", "op-2:prepared")).toBeNull();
  });
});

describe("Firestore lock transaction", () => {
  it("reads the lock before any write and commits it together with exactly the operation and its audit", async () => {
    const fake = fakeFirestore(), repo = new FirestorePlatformRepository(fake.db);
    await repo.prepareOperation(preparation("op-1"));
    const firstWrite = fake.calls.findIndex(call => call !== "get");
    expect(firstWrite).toBeGreaterThan(0);
    expect(fake.calls.slice(firstWrite).includes("get")).toBe(false);
    expect([...fake.data.keys()].filter(path => !path.startsWith(`${PRIVACY_PROVENANCE_COLLECTION}/`))).toHaveLength(3);
    expect(await lockOf(repo)).toMatchObject({ state: "HELD" });
    expect(await repo.get("operations", "tenant", "op-1")).toMatchObject({ state: "PREPARED" });
  });
});
