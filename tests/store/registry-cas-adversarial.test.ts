import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlatformDenied, type AssetGrant, type Client, type Connection, type MetaAsset } from "../../src/platform/models.js";
import { FirestorePlatformRepository, InMemoryPlatformRepository, type ControlCommit } from "../../src/platform/repository.js";
import { ENVS, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";
import { dumpTenant, seedRegistry, TENANT_A, TENANT_B, trustedReassociation, type Registry } from "../fixtures/crypto/registry-fixture.js";

type Repo = InMemoryPlatformRepository | FirestorePlatformRepository;

const kinds: Array<{ name: string; make: () => { repo: Repo; db?: FakeFirestore } }> = [
  { name: "in-memory", make: () => ({ repo: new InMemoryPlatformRepository() }) },
  { name: "firestore", make: () => { const db = new FakeFirestore(); return { repo: new FirestorePlatformRepository(db as never), db }; } },
];

beforeEach(() => useKeyEnv(ENVS.k1Only));
afterEach(() => restoreKeyEnv());

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PlatformDenied) return error.reason;
    throw error;
  }
  return "NOT_REJECTED";
}

const clone = <T>(value: T): T => structuredClone(value);
const write = (commit: ControlCommit, collection: string) => commit.writes.find((row) => row.collection === collection)!;

describe.each(kinds)("client-asset reassociation isolation on the $name repository", ({ make }) => {
  let repo: Repo;
  let db: FakeFirestore | undefined;
  let a: Registry;
  let b: Registry;

  beforeEach(async () => {
    ({ repo, db } = make());
    a = await seedRegistry(repo as never, TENANT_A);
    b = await seedRegistry(repo as never, TENANT_B);
  });

  async function expectRejectedWithoutChange(commit: ControlCommit, accepted: RegExp | string): Promise<string> {
    const beforeA = await dumpTenant(repo, TENANT_A.tenantId);
    const beforeB = await dumpTenant(repo, TENANT_B.tenantId);
    const reason = await reasonOf(repo.commitControlPlane(commit));
    expect(reason, `rejected with ${reason}`).toMatch(accepted instanceof RegExp ? accepted : new RegExp(`^${accepted}$`));
    expect(await dumpTenant(repo, TENANT_A.tenantId)).toEqual(beforeA);
    expect(await dumpTenant(repo, TENANT_B.tenantId)).toEqual(beforeB);
    return reason;
  }

  it("commits one exact reassociation for the owning tenant and never touches the other tenant", async () => {
    const beforeB = await dumpTenant(repo, TENANT_B.tenantId);
    const { commit } = await trustedReassociation(repo as never, a, "audit-ok");
    await repo.commitControlPlane(commit);
    expect((await repo.list("assets", TENANT_A.tenantId))[0].clientId).toBe(TENANT_A.targetClientId);
    expect(await dumpTenant(repo, TENANT_B.tenantId)).toEqual(beforeB);
  });

  describe("cross-tenant substitution", () => {
    it("rejects writes carrying another tenant's records", async () => {
      const { commit } = await trustedReassociation(repo as never, a, "audit-x1");
      write(commit, "assets").value = clone(b.asset);
      await expectRejectedWithoutChange(commit, "INVALID_CONTROL_WRITE");
    });

    it("rejects a commit whose audit names a different tenant than the records it changes", async () => {
      const { commit } = await trustedReassociation(repo as never, a, "audit-x2");
      commit.audit.tenantId = TENANT_B.tenantId;
      await expectRejectedWithoutChange(commit, "INVALID_CONTROL_COMMIT");
    });

    it("rejects tenant B's operator acting on tenant A even when it supplies a fabricated member snapshot", async () => {
      const { commit } = await trustedReassociation(repo as never, a, "audit-x3");
      commit.audit.actorId = TENANT_B.operatorId;
      const memberRow = commit.expected.find((row) => row.collection === "members")!;
      memberRow.id = TENANT_B.operatorId;
      memberRow.canonical = JSON.stringify({ ...b.member, tenantId: TENANT_A.tenantId });
      await expectRejectedWithoutChange(commit, /^(CLIENT_ASSET_REASSOCIATION_[A-Z_]+|CONTROL_(AUTHORIZATION|OPERATOR_INDEX)_CHANGED)$/);
    });

    it("rejects an expected snapshot copied from the other tenant (identical asset key, foreign state)", async () => {
      expect(b.asset.key).not.toBe(a.asset.key);
      const { commit } = await trustedReassociation(repo as never, a, "audit-x4");
      const assetRow = commit.expected.find((row) => row.collection === "assets")!;
      assetRow.canonical = JSON.stringify({ ...b.asset, key: a.asset.key });
      await expectRejectedWithoutChange(commit, /^CLIENT_ASSET_REASSOCIATION_[A-Z_]+$/);
    });

    it("rejects a target client belonging to another tenant", async () => {
      const foreignTarget: Client = { ...b.targetClient, tenantId: TENANT_B.tenantId };
      await expect(trustedReassociation(repo as never, a, "audit-x5", { targetClient: foreignTarget })).rejects.toMatchObject({ reason: "CLIENT_ASSET_REASSOCIATION_CLIENT_SCOPE_INVALID" });
    });

    it("rejects a connection from another tenant being repointed", async () => {
      const { commit } = await trustedReassociation(repo as never, a, "audit-x6");
      (write(commit, "connections").value as Connection).tenantId = TENANT_B.tenantId;
      await expectRejectedWithoutChange(commit, /^(INVALID_CONTROL_WRITE|CLIENT_ASSET_REASSOCIATION_[A-Z_]+)$/);
    });
  });

  describe("client isolation", () => {
    it("rejects a target the operator is not a member of", async () => {
      const outsider: Client = { ...a.targetClient, id: "client-outsider" };
      await repo.put("clients" as never, TENANT_A.tenantId, outsider.id, outsider as never);
      await expect(trustedReassociation(repo as never, a, "audit-c1", { targetClient: outsider })).rejects.toMatchObject({ reason: "CLIENT_ASSET_REASSOCIATION_CLIENT_SCOPE_INVALID" });
    });

    it("rejects an operator without a connection-management role, a disabled operator and a disabled client", async () => {
      for (const [label, member, client] of [
        ["reader-only", { ...a.member, roles: ["reader"] }, a.targetClient],
        ["disabled operator", { ...a.member, disabledAt: Date.now() - 1 }, a.targetClient],
        ["disabled target client", a.member, { ...a.targetClient, status: "DISABLED" as const }],
      ] as const) {
        await expect(trustedReassociation(repo as never, a, `audit-c2-${label}`, { member, targetClient: client }), label).rejects.toBeInstanceOf(PlatformDenied);
      }
    });

    it("rejects a target client that has not been verified for the account's owning business", async () => {
      const unverified: Client = { ...a.targetClient, verifiedBusinessIds: [] };
      await expect(trustedReassociation(repo as never, a, "audit-c3", { targetClient: unverified })).rejects.toMatchObject({ reason: "CLIENT_ASSET_REASSOCIATION_CLIENT_SCOPE_INVALID" });
    });

    it("rejects moving an asset whose grant belongs to a different client than the asset", async () => {
      const split = { ...a, grant: { ...a.grant, clientId: "client-elsewhere" } };
      await expect(trustedReassociation(repo as never, split, "audit-c4")).rejects.toMatchObject({ reason: "CLIENT_ASSET_REASSOCIATION_OLD_CLIENT_INVALID" });
    });
  });

  describe("tampering after preparation is re-validated inside the transaction", () => {
    const cases: Array<[string, (commit: ControlCommit) => void, RegExp | string]> = [
      ["an extra credentials write", (c) => { c.writes.push({ collection: "credentials", id: "credential", value: { tenantId: TENANT_A.tenantId } as never, createOnly: false }); }, "CLIENT_ASSET_REASSOCIATION_EXACT_SCOPE_REQUIRED"],
      ["a widened grant action", (c) => { (write(c, "grants").value as AssetGrant).actions = ["READ", "WRITE_BUDGET"]; }, "CLIENT_ASSET_REASSOCIATION_GRANT_SCOPE_INVALID"],
      ["an extra grant capability", (c) => { (write(c, "grants").value as AssetGrant).capabilities.push("legacy.ads_create_campaign"); }, "CLIENT_ASSET_REASSOCIATION_GRANT_SCOPE_INVALID"],
      ["a grant outliving the provider evidence", (c) => { (write(c, "grants").value as AssetGrant).expiresAt += 3_000_000; }, "CLIENT_ASSET_REASSOCIATION_GRANT_SCOPE_INVALID"],
      ["a skipped asset revision", (c) => { (write(c, "assets").value as MetaAsset).revision += 1; }, "CLIENT_ASSET_REASSOCIATION_ASSET_SCOPE_INVALID"],
      ["a changed owning business", (c) => { (write(c, "assets").value as MetaAsset).ownerBusinessId = "999"; }, "CLIENT_ASSET_REASSOCIATION_ASSET_SCOPE_INVALID"],
      ["a self-asserted billing ownership", (c) => { (write(c, "assets").value as MetaAsset).billingOwnershipVerified = true; }, "CLIENT_ASSET_REASSOCIATION_ASSET_SCOPE_INVALID"],
      ["a swapped credential", (c) => { (write(c, "connections").value as Connection).credentialId = "credential-other"; }, "CLIENT_ASSET_REASSOCIATION_CONNECTION_SCOPE_INVALID"],
      ["a different operator on the connection", (c) => { (write(c, "connections").value as Connection).operatorId = "777"; }, "CLIENT_ASSET_REASSOCIATION_CONNECTION_SCOPE_INVALID"],
      ["an extended connection asset list", (c) => { (write(c, "connections").value as Connection).assetKeys.push("foreign-asset-key"); }, "CLIENT_ASSET_REASSOCIATION_CONNECTION_SCOPE_INVALID"],
      ["an audit timestamp in the future", (c) => { c.audit.timestamp = Date.now() + 60_000; }, "CLIENT_ASSET_REASSOCIATION_ACTOR_INVALID"],
    ];
    it.each(cases)("rejects %s and leaves every record unchanged", async (_label, mutate, reason) => {
      const { commit } = await trustedReassociation(repo as never, a, `audit-t-${_label.replace(/\W+/g, "-")}`);
      mutate(commit);
      await expectRejectedWithoutChange(commit, reason);
    });
  });

  describe("stale revisions", () => {
    const stale: Array<[string, (registry: Registry) => Promise<void>]> = [
      ["tenant", async (r) => repo.put("tenants" as never, TENANT_A.tenantId, TENANT_A.tenantId, { ...r.tenant, registryRevision: 2 } as never)],
      ["member", async (r) => repo.put("members" as never, TENANT_A.tenantId, TENANT_A.operatorId, { ...r.member, revision: r.member.revision + 1 } as never)],
      ["old client", async (r) => repo.put("clients" as never, TENANT_A.tenantId, r.oldClient.id, { ...r.oldClient, revision: 2 } as never)],
      ["target client", async (r) => repo.put("clients" as never, TENANT_A.tenantId, r.targetClient.id, { ...r.targetClient, revision: 2 } as never)],
      ["asset", async (r) => repo.put("assets" as never, TENANT_A.tenantId, r.asset.key, { ...r.asset, revision: r.asset.revision + 1 } as never)],
      ["connection", async (r) => repo.put("connections" as never, TENANT_A.tenantId, r.connection.id, { ...r.connection, revision: r.connection.revision + 1 } as never)],
      ["grant", async (r) => repo.put("grants" as never, TENANT_A.tenantId, r.grant.id, { ...r.grant, revision: r.grant.revision + 1 } as never)],
    ];
    it.each(stale)("rejects a commit prepared before the %s record changed", async (_label, change) => {
      const { commit } = await trustedReassociation(repo as never, a, `audit-s-${_label.replace(/\W+/g, "-")}`);
      await change(a);
      const beforeA = await dumpTenant(repo, TENANT_A.tenantId);
      expect(await reasonOf(repo.commitControlPlane(commit))).toBe("CONTROL_AUTHORIZATION_CHANGED");
      expect(await dumpTenant(repo, TENANT_A.tenantId)).toEqual(beforeA);
    });

    it("rejects a replay of an already committed reassociation without a second mutation", async () => {
      const { commit } = await trustedReassociation(repo as never, a, "audit-replay");
      await repo.commitControlPlane(commit);
      const after = await dumpTenant(repo, TENANT_A.tenantId);
      expect(["CONTROL_AUTHORIZATION_CHANGED", "CONTROL_AUDIT_ALREADY_EXISTS"]).toContain(await reasonOf(repo.commitControlPlane(commit)));
      expect(await dumpTenant(repo, TENANT_A.tenantId)).toEqual(after);
    });

    it("rejects reuse of a consumed discovery proposal under a fresh audit id", async () => {
      const first = await trustedReassociation(repo as never, a, "audit-p1");
      await repo.commitControlPlane(first.commit);
      const reused = clone(first.commit);
      reused.audit.id = "audit-p2";
      const after = await dumpTenant(repo, TENANT_A.tenantId);
      expect(await reasonOf(repo.commitControlPlane(reused))).toBe("CONTROL_AUTHORIZATION_CHANGED");
      expect(await dumpTenant(repo, TENANT_A.tenantId)).toEqual(after);
    });
  });
});

describe("concurrent writers and partial transaction failure on the Firestore repository", () => {
  let db: FakeFirestore;
  let repo: FirestorePlatformRepository;
  let a: Registry;

  beforeEach(async () => {
    db = new FakeFirestore();
    repo = new FirestorePlatformRepository(db as never);
    a = await seedRegistry(repo as never, TENANT_A);
    await seedRegistry(repo as never, TENANT_B);
  });

  it("lets exactly one of two identical concurrent commits win", async () => {
    const { commit } = await trustedReassociation(repo as never, a, "audit-race-1");
    const results = await Promise.allSettled([repo.commitControlPlane(commit), repo.commitControlPlane(clone(commit))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["CONTROL_AUDIT_ALREADY_EXISTS", "CONTROL_AUTHORIZATION_CHANGED"]).toContain((rejected.reason as PlatformDenied).reason);
    expect([...db.docs.keys()].filter((path) => path.includes("/controlAudit/"))).toHaveLength(1);
  });

  it("never splits one asset between two clients when two different targets race", async () => {
    const other: Client = { ...a.targetClient, id: "client-c" };
    await repo.put("clients", TENANT_A.tenantId, other.id, other);
    const widened = { ...a.member, allowedClientIds: [...a.member.allowedClientIds, other.id], revision: a.member.revision + 1 };
    await repo.put("members", TENANT_A.tenantId, TENANT_A.operatorId, widened);
    const registry = { ...a, member: widened };
    const toB = (await trustedReassociation(repo as never, registry, "audit-race-b", { targetClient: a.targetClient })).commit;
    const toC = (await trustedReassociation(repo as never, registry, "audit-race-c", { targetClient: other })).commit;

    const results = await Promise.allSettled([repo.commitControlPlane(toB), repo.commitControlPlane(toC)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as PlatformDenied).reason).toBe("CONTROL_AUTHORIZATION_CHANGED");

    const [asset] = await repo.list("assets", TENANT_A.tenantId);
    const [grant] = await repo.list("grants", TENANT_A.tenantId);
    expect(asset.clientId).toBe(grant.clientId);
    expect(["client-b", "client-c"]).toContain(asset.clientId);
    expect(asset.revision).toBe(a.asset.revision + 1);
    expect(grant.revision).toBe(a.grant.revision + 1);
  });

  it("re-reads and rejects when another writer changes a record between the read and the commit", async () => {
    const { commit } = await trustedReassociation(repo as never, a, "audit-race-3");
    const assetPath = [...db.docs.keys()].find((path) => path.includes("/assets/"))!;
    let injected = 0;
    db.beforeCommit = (paths) => {
      if (injected || !paths.some((path) => path.includes("/assets/"))) return;
      injected++;
      const current = db.read(assetPath)!;
      db.seed(assetPath, { ...current, revision: (current.revision as number) + 1, verifiedAt: Date.now() });
    };
    expect(await reasonOf(repo.commitControlPlane(commit))).toBe("CONTROL_AUTHORIZATION_CHANGED");
    expect(injected).toBe(1);
    expect((await repo.list("assets", TENANT_A.tenantId))[0]).toMatchObject({ clientId: TENANT_A.oldClientId, revision: a.asset.revision + 1 });
    expect([...db.docs.keys()].some((path) => path.includes("/controlAudit/"))).toBe(false);
  });

  it("applies none of the writes when the transaction fails part-way, and the same commit succeeds on retry", async () => {
    const { commit } = await trustedReassociation(repo as never, a, "audit-partial");
    const before = await dumpTenant(repo, TENANT_A.tenantId);
    db.failWritesTo = (path) => path.includes("/grants/");
    await expect(repo.commitControlPlane(commit)).rejects.toThrow("injected write failure");
    expect(await dumpTenant(repo, TENANT_A.tenantId)).toEqual({ ...before, discoveryProposals: before.discoveryProposals });
    expect([...db.docs.keys()].some((path) => path.includes("/controlAudit/"))).toBe(false);

    db.failWritesTo = undefined;
    await repo.commitControlPlane(commit);
    const [asset] = await repo.list("assets", TENANT_A.tenantId);
    const [grant] = await repo.list("grants", TENANT_A.tenantId);
    expect([asset.clientId, grant.clientId]).toEqual([TENANT_A.targetClientId, TENANT_A.targetClientId]);
  });

  it("fails closed instead of truncating a registry listing above the 1000 record bound", async () => {
    for (let index = 0; index < 1001; index++) {
      await repo.put("grants", TENANT_A.tenantId, `bulk-${index}`, { ...a.grant, id: `bulk-${index}`, revokedAt: index === 0 ? Date.now() : null });
    }
    expect(await reasonOf(repo.list("grants", TENANT_A.tenantId))).toBe("REGISTRY_LIMIT_REQUIRES_PAGINATION");
    expect((await repo.list("grants", TENANT_B.tenantId)).length).toBe(1);
  });

  it("leaves the audit record absent when the audit write itself fails", async () => {
    const { commit } = await trustedReassociation(repo as never, a, "audit-no-audit");
    const before = await dumpTenant(repo, TENANT_A.tenantId);
    db.failWritesTo = (path) => path.includes("/controlAudit/");
    await expect(repo.commitControlPlane(commit)).rejects.toThrow("injected write failure");
    expect(await dumpTenant(repo, TENANT_A.tenantId)).toEqual(before);
  });
});
