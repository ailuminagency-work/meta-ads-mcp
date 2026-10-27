import { describe, expect, it } from "vitest";
import { reportChainOrphans } from "../../src/platform/marketing-chain-report.js";
import type { AssetRef, MetaAsset, Operation } from "../../src/platform/models.js";

const asset = (type: MetaAsset["type"], id: string, parents: AssetRef[], extra: Partial<MetaAsset> = {}): MetaAsset => ({
  key: `${type}-${id}`,
  type,
  id,
  parents,
  provider: "META_MARKETING",
  appId: "300",
  tenantId: "tenant",
  clientId: "client",
  verifiedAt: 1,
  revokedAt: null,
  revision: 1,
  ...extra,
});

const operation = (id: string, tool: string, state: Operation["state"], clientId = "client"): Operation => ({
  id, tenantId: "tenant", clientId, actorId: "100", tool, planHash: "h", state, approvalId: null, createdAt: 1, updatedAt: 1,
});

const campaign = asset("CAMPAIGN", "201", [{ type: "AD_ACCOUNT", id: "101" }]);
const adSet = asset("AD_SET", "301", [{ type: "CAMPAIGN", id: "201" }]);
const creative = asset("CREATIVE", "501", [{ type: "AD_ACCOUNT", id: "101" }]);
const ad = asset("AD", "401", [{ type: "AD_SET", id: "301" }, { type: "CREATIVE", id: "501" }]);

describe("reportChainOrphans", () => {
  it("reports nothing for a complete chain", () => {
    expect(reportChainOrphans("client", [campaign, adSet, creative, ad], [])).toEqual({ clientId: "client", orphans: [], unresolvedOperations: [] });
  });

  it("reports every object no ad reaches, in a stable order", () => {
    const report = reportChainOrphans("client", [creative, campaign, adSet], []);
    expect(report.orphans).toEqual([
      { type: "AD_SET", id: "301", reason: "AD_SET_WITHOUT_AD" },
      { type: "CAMPAIGN", id: "201", reason: "CAMPAIGN_WITHOUT_AD" },
      { type: "CREATIVE", id: "501", reason: "CREATIVE_WITHOUT_AD" },
    ].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)));
  });

  it("does not treat a campaign as an orphan when an ad set under it has an ad", () => {
    expect(reportChainOrphans("client", [campaign, adSet, ad], []).orphans).toEqual([]);
    expect(reportChainOrphans("client", [campaign, adSet, ad, asset("AD_SET", "302", [{ type: "CAMPAIGN", id: "201" }])], []).orphans).toEqual([
      { type: "AD_SET", id: "302", reason: "AD_SET_WITHOUT_AD" },
    ]);
  });

  it("ignores revoked assets, other clients and other providers", () => {
    const report = reportChainOrphans(
      "client",
      [asset("CAMPAIGN", "1", [], { revokedAt: 5 }), asset("AD_SET", "2", [], { clientId: "other" }), asset("CREATIVE", "3", [], { provider: "META_FACEBOOK_PAGES" })],
      [],
    );
    expect(report.orphans).toEqual([]);
  });

  it("lists only this client's unresolved strict Ads writes", () => {
    const report = reportChainOrphans("client", [], [
      operation("b", "ads_create_ad_creative", "UNKNOWN"),
      operation("a", "ads_create_ad", "PARTIAL"),
      operation("c", "ads_create_campaign", "SUCCEEDED"),
      operation("d", "ads_create_campaign", "FAILED"),
      operation("e", "ads_create_campaign", "UNKNOWN", "other"),
      operation("f", "messenger_send_text", "UNKNOWN"),
    ]);
    expect(report.unresolvedOperations).toEqual([
      { id: "a", tool: "ads_create_ad", state: "PARTIAL" },
      { id: "b", tool: "ads_create_ad_creative", state: "UNKNOWN" },
    ]);
  });
});
