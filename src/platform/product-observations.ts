import { randomUUID } from "node:crypto";
import { authorizeOperation, getExecutionScope, revalidateExecutionPermit, runWithExecutionPermit, type ExecutionPermit } from "./execution.js";
import type { PlatformRepository, Collection, ControlCommit } from "./repository.js";
import type { ProductContract } from "./products/contracts.js";
import { PlatformDenied, type AuthorizationSnapshot, type MetaAsset } from "./models.js";
import { canonicalJson } from "./policy.js";
import { deriveProductAssetEvidence, deriveProductReplyObservations } from "./product-evidence.js";

export async function recordProductObservation(repo: PlatformRepository, permit: ExecutionPermit, contract: ProductContract, targetId: string, response: unknown): Promise<void> {
  if (!contract.assetEvidenceUpdate || !["META_THREADS", "META_INSTAGRAM_LOGIN", "META_INSTAGRAM_FACEBOOK_LOGIN"].includes(contract.provider) || contract.method !== "GET" || !contract.verified) throw new PlatformDenied("VERIFIED_OBSERVATION_CONTRACT_REQUIRED");
  const scope = getExecutionScope();
  if (scope.context.tool !== contract.tool || scope.plan.capability !== contract.id || permit.context.requestId !== scope.context.requestId || permit.connectionId !== scope.snapshot.connection.id) throw new PlatformDenied("OBSERVATION_PERMIT_MISMATCH");
  await revalidateExecutionPermit(permit);
  const target = scope.snapshot.assets.find(asset => asset.id === targetId && asset.type === contract.assetType && asset.provider === contract.provider);
  if (!target) throw new PlatformDenied("OBSERVATION_TARGET_UNVERIFIED");
  const expected = new Map<string, { collection: Collection; id: string; canonical: string }>();
  const add = (collection: Collection, id: string, value: unknown): void => {
    const key = `${collection}:${id}`, canonical = canonicalJson(value), previous = expected.get(key);
    if (previous && previous.canonical !== canonical) throw new PlatformDenied("OBSERVATION_AUTHORIZATION_CHANGED");
    expected.set(key, { collection, id, canonical });
  };
  const include = (snapshot: AuthorizationSnapshot): void => {
    add("tenants", snapshot.tenant.id, snapshot.tenant); add("members", snapshot.member.operatorId, snapshot.member);
    add("clients", snapshot.client.id, snapshot.client); add("connections", snapshot.connection.id, snapshot.connection);
    for (const asset of snapshot.assets) add("assets", asset.key, asset);
    for (const grant of snapshot.grants) add("grants", grant.id, grant);
  };
  include(scope.snapshot);
  const writes: ControlCommit["writes"] = [];
  const now = Date.now();
  if (["threads_container", "instagram_container"].includes(contract.assetEvidenceUpdate)) {
    const patch = deriveProductAssetEvidence(contract, target, response, scope.snapshot.assets, now);
    if (!patch) throw new PlatformDenied("OBSERVATION_RESPONSE_UNVERIFIED");
    writes.push({ collection: "assets", id: target.key, value: { ...target, ...patch, revision: target.revision + 1 }, createOnly: false });
  } else {
    const data = (response as { data?: unknown })?.data;
    if (!Array.isArray(data) || data.length > 1000) throw new PlatformDenied("OBSERVATION_RESPONSE_UNVERIFIED");
    const ids = new Set(data.map(row => typeof row === "object" && row !== null ? (row as { id?: unknown }).id : undefined));
    const registry = (await repo.list("assets", scope.context.principal.tenantId)).filter(asset => ids.has(asset.id) && asset.type === "POST" && asset.provider === contract.provider && asset.appId === target.appId && asset.clientId === scope.context.clientId && asset.tenantId === scope.context.principal.tenantId);
    if (registry.length > 100) throw new PlatformDenied("OBSERVATION_BATCH_TOO_LARGE");
    const authorized = new Map<string, MetaAsset>(scope.snapshot.assets.map(asset => [asset.key, asset]));
    const childPermits: ExecutionPermit[] = [];
    for (const candidate of registry) {
      if (candidate.id === targetId) continue;
      let childPermit: ExecutionPermit;
      try {
        childPermit = await authorizeOperation(repo, scope.context, { ...scope.plan, assets: [...scope.plan.assets, { type: "POST", id: candidate.id }] }, { writesEnabled: false, selectedConnectionId: permit.connectionId });
      } catch (error) {
        if (!(error instanceof PlatformDenied)) throw error;
        // An ungranted/stale/revoked child is not observed and receives no new authority.
        continue;
      }
      const childScope = runWithExecutionPermit(childPermit, () => getExecutionScope());
      include(childScope.snapshot);
      for (const asset of childScope.snapshot.assets) authorized.set(asset.key, asset);
      childPermits.push(childPermit);
    }
    const observations = deriveProductReplyObservations(contract, target, response, [...authorized.values()], now);
    if (observations.length > 100) throw new PlatformDenied("OBSERVATION_BATCH_TOO_LARGE");
    for (const observation of observations) {
      const asset = authorized.get(observation.assetKey);
      if (!asset || asset.revision !== observation.expectedRevision) throw new PlatformDenied("OBSERVATION_AUTHORIZATION_CHANGED");
      writes.push({ collection: "assets", id: asset.key, value: { ...asset, ...observation.patch, revision: asset.revision + 1 }, createOnly: false });
    }
    for (const childPermit of childPermits) await revalidateExecutionPermit(childPermit);
  }
  if (!writes.length) return;
  if (expected.size > 300) throw new PlatformDenied("OBSERVATION_SNAPSHOT_TOO_LARGE");
  await revalidateExecutionPermit(permit);
  await repo.commitControlPlane({ tenantId: scope.context.principal.tenantId, expected: [...expected.values()], writes, audit: { id: randomUUID(), tenantId: scope.context.principal.tenantId, clientId: scope.context.clientId, actorId: scope.context.principal.operatorId, event: "ASSET_OBSERVED", timestamp: now, subjectId: target.key, planHash: permit.planHash } });
}
