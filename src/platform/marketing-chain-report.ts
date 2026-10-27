import type { MetaAsset, Operation } from "./models.js";

export type ChainOrphanReason = "CAMPAIGN_WITHOUT_AD" | "AD_SET_WITHOUT_AD" | "CREATIVE_WITHOUT_AD";

export interface ChainOrphan {
  type: "CAMPAIGN" | "AD_SET" | "CREATIVE";
  id: string;
  reason: ChainOrphanReason;
}

export interface UnresolvedChainOperation {
  id: string;
  tool: string;
  state: "UNKNOWN" | "PARTIAL";
}

export interface ChainReport {
  clientId: string;
  orphans: ChainOrphan[];
  unresolvedOperations: UnresolvedChainOperation[];
}

/**
 * Registry-only view of a stopped campaign -> ad set -> creative -> ad chain: registered objects
 * that no ad reaches yet, and strict Ads writes still awaiting reconciliation. It reads no
 * provider state and says nothing about delivery; every object these writes create is requested PAUSED.
 */
export function reportChainOrphans(clientId: string, assets: readonly MetaAsset[], operations: readonly Operation[]): ChainReport {
  const live = assets.filter((a) => a.clientId === clientId && a.provider === "META_MARKETING" && a.revokedAt === null);
  const childrenOf = (type: MetaAsset["type"], parent: MetaAsset) =>
    live.filter((candidate) => candidate.type === type && candidate.parents.some((p) => p.type === parent.type && p.id === parent.id));
  const orphans: ChainOrphan[] = [];
  for (const asset of live) {
    if (asset.type === "AD_SET" && childrenOf("AD", asset).length === 0) {
      orphans.push({ type: "AD_SET", id: asset.id, reason: "AD_SET_WITHOUT_AD" });
    } else if (asset.type === "CREATIVE" && childrenOf("AD", asset).length === 0) {
      orphans.push({ type: "CREATIVE", id: asset.id, reason: "CREATIVE_WITHOUT_AD" });
    } else if (asset.type === "CAMPAIGN" && !childrenOf("AD_SET", asset).some((adSet) => childrenOf("AD", adSet).length > 0)) {
      orphans.push({ type: "CAMPAIGN", id: asset.id, reason: "CAMPAIGN_WITHOUT_AD" });
    }
  }
  const unresolvedOperations = operations
    .filter((o): o is Operation & { state: "UNKNOWN" | "PARTIAL" } => o.clientId === clientId && o.tool.startsWith("ads_") && (o.state === "UNKNOWN" || o.state === "PARTIAL"))
    .map((o) => ({ id: o.id, tool: o.tool, state: o.state }));
  const byKey = (a: ChainOrphan, b: ChainOrphan) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`);
  return { clientId, orphans: orphans.sort(byKey), unresolvedOperations: unresolvedOperations.sort((a, b) => a.id.localeCompare(b.id)) };
}
