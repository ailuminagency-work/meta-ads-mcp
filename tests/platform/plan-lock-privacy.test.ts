import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirestorePlatformRepository, InMemoryPlatformRepository, type Completion, type PlatformRepository, type Preparation } from "../../src/platform/repository.js";
import { PRIVACY_OWNED_COLLECTIONS, PRIVACY_PROVENANCE_COLLECTION, type PrivacyProvenance } from "../../src/platform/meta-privacy-provenance.js";
import { fakeFirestore } from "./firestore-transaction-fake.js";

beforeEach(() => vi.stubEnv("META_APP_ID", "300"));
afterEach(() => vi.unstubAllEnvs());

/** The app-scoped user id Meta's data deletion is about. Whatever stores it must be erasable by that request. */
const actorId = "900000000000001", clientId = "client-with-a-name", tool = "ads_create_campaign";
const preparation = (id: string): Preparation => ({
  operation: { id, tenantId: "tenant", clientId, actorId, tool, planHash: "plan-1", state: "PREPARED", approvalId: null, createdAt: 1, updatedAt: 1 },
  audit: { id: `${id}:prepared`, tenantId: "tenant", clientId, actorId, tool, operationId: id, event: "PREPARED", timestamp: 1, assetKeys: [], planHash: "plan-1", approvalId: null },
  expectedRevisionHash: "revision", now: Date.now(), expectedRecords: [],
});
const completion = (p: Preparation, result: Completion["result"]): Completion => ({ tenantId: "tenant", operationId: p.operation.id, result, audit: { ...p.audit, id: `${p.operation.id}:result`, event: result, timestamp: Date.now() } });

const stores: Array<[string, () => { repo: PlatformRepository; data?: Map<string, unknown> }]> = [
  ["in-memory repository", () => ({ repo: new InMemoryPlatformRepository() })],
  ["Firestore repository (transaction fake)", () => { const fake = fakeFirestore(); return { repo: new FirestorePlatformRepository(fake.db), data: fake.data }; }],
];

describe.each(stores)("the plan lock in the %s", (_name, make) => {
  it.each(["HELD", "SUCCEEDED", "FAILED"] as const)("names no person, client or tool while %s", async state => {
    const { repo } = make(), first = preparation("op-1");
    await repo.prepareOperation(first);
    if (state !== "HELD") await repo.finishOperation(completion(first, state));
    const lock = await repo.get("operationPlanLocks", "tenant", "plan-1");
    expect(lock).toMatchObject({ operationId: "op-1", state: state === "HELD" ? "HELD" : "RELEASED" });
    expect(Object.keys(lock!).sort()).toEqual(["createdAt", "id", "operationId", "releasedAt", "releasedResult", "state", "tenantId"]);
    const stored = JSON.stringify(lock);
    for (const personal of [actorId, clientId, tool]) expect(stored).not.toContain(personal);
  });
});

describe("Meta data deletion can reach every record that holds the app-scoped user id", () => {
  const collectionOf = (path: string) => path.split("/")[2];

  it("every platform document that carries the actor id is a privacy-owned collection with provenance written in the same transaction", async () => {
    const fake = fakeFirestore(), repo = new FirestorePlatformRepository(fake.db), first = preparation("op-1");
    await repo.prepareOperation(first);
    await repo.finishOperation(completion(first, "UNKNOWN"));
    const provenanceTargets = new Set([...fake.data].filter(([path]) => path.startsWith(`${PRIVACY_PROVENANCE_COLLECTION}/`)).map(([, row]) => (row as PrivacyProvenance).targetPath));
    const carriers = [...fake.data].filter(([path, row]) => path.startsWith("platform_v1/") && JSON.stringify(row).includes(actorId)).map(([path]) => path);
    expect(carriers.map(collectionOf).sort()).toEqual(["audit", "audit", "operations"]);
    for (const path of carriers) {
      expect(PRIVACY_OWNED_COLLECTIONS, path).toContain(collectionOf(path));
      expect(provenanceTargets.has(path), path).toBe(true);
    }
    expect([...fake.data.keys()].some(path => collectionOf(path) === "operationPlanLocks")).toBe(true);
    expect(carriers.some(path => collectionOf(path) === "operationPlanLocks")).toBe(false);
  });
});
