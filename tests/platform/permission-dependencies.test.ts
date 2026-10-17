import { describe, expect, it } from "vitest";
import { expandVerifiedPermissionDependencies } from "../../src/platform/products/permission-dependencies.js";
describe("audited permission dependencies", () => {
  it("expands recursive catalog prerequisites without mutating original scopes", () => {
    const scopes = ["catalog_management"];
    expect(expandVerifiedPermissionDependencies(scopes)).toEqual(["catalog_management", "business_management", "pages_read_engagement", "pages_show_list"]);
    expect(scopes).toEqual(["catalog_management"]);
  });
  it("keeps actual known read scopes narrow and never invents unknown requirements", () => {
    expect(expandVerifiedPermissionDependencies(["ads_read", "unreviewed_scope"])).toEqual(["ads_read", "unreviewed_scope"]);
  });
  it("does not mislabel access tiers as OAuth scopes", () => {
    const scopes = expandVerifiedPermissionDependencies(["leads_retrieval"]);
    expect(scopes).toContain("business_management");
    expect(scopes).toContain("pages_show_list");
    expect(scopes).not.toContain("Ads Management Standard Access");
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});
