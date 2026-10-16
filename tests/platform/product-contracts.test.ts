import { describe, expect, it } from "vitest";
import { PRODUCT_CONTRACTS, validateProductContracts, type ProductContract } from "../../src/platform/products/contracts.js";
import { resolveAuthorizedAssets } from "../../src/platform/assets.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import type { MetaAsset, OperationContext } from "../../src/platform/models.js";

const executable = PRODUCT_CONTRACTS.find(contract => contract.tool === "messenger_send_text")!;
function modified(change: Partial<ProductContract>): ProductContract { return { ...executable, ...change }; }

describe("product contract trust boundaries", () => {
  it("keeps verified Pixel signal dispatch reference-only and Dataset mapping unresolved",()=>{
    const pixel=PRODUCT_CONTRACTS.find(c=>c.tool==="signals_send_pixel_events")!,dataset=PRODUCT_CONTRACTS.find(c=>c.tool==="signals_send_events")!;
    expect(pixel.verified).toBe(true);expect(pixel.assetType).toBe("PIXEL");expect(pixel.allowedInputKeys).toEqual(["source_reference","consent_reference"]);expect(pixel.responseFields).toEqual(["events_received"]);expect(pixel.tokenTypes).toEqual(["system_user"]);expect(pixel.requiredScopes).toEqual(["ads_management","pages_read_engagement","ads_read"]);expect(dataset.verified).toBe(false);expect(dataset.assetType).toBe("DATASET");
  });
  it("limits lead reads to registered metadata without contact field expansion",()=>{
    const lead=PRODUCT_CONTRACTS.find(c=>c.tool==="leads_get_lead")!;expect(lead.verified).toBe(true);expect(lead.assetType).toBe("LEAD");expect(lead.fixedQuery).toEqual({fields:"id,created_time"});expect(lead.responseFields).toEqual(["id","created_time"]);expect(lead.allowedInputKeys).toEqual([]);expect(lead.requiredScopes).toContain("leads_retrieval");expect(lead.manualRequirements.join(" ")).toContain("LEAD_FORM, PAGE and AD_ACCOUNT");
  });
  it("verifies WhatsApp reads with scoped tokens and exact safe metadata fields", () => {
    const reads = PRODUCT_CONTRACTS.filter(c => c.product === "whatsapp" && c.verified && c.method === "GET");
    expect(reads.map(c => c.tool).sort()).toEqual(["whatsapp_platform_get_phone", "whatsapp_platform_list_phones", "whatsapp_platform_list_templates"]);
    for (const c of reads) {
      expect(c.requiredScopes).toEqual(["whatsapp_business_management"]);
      expect(c.tokenTypes).toEqual(["system_user", "business_integration_system_user"]);
      expect(c.operationClasses).toEqual(["READ"]);
      expect(c.allowedInputKeys).toEqual([]);
      expect(c.manualRequirements.join(" ")).toContain("both the client-owned WhatsApp account");
    }
    expect(reads.find(c=>c.tool === "whatsapp_platform_list_templates")?.fixedQuery).toEqual({fields:"name,category,status"});
    expect(reads.filter(c=>c.assetType !== "WHATSAPP_PHONE").every(c=>c.assetType === "MESSAGING_ACCOUNT")).toBe(true);
  });
  it.each(["valid", "missing-waac", "missing-messaging", "cross-client-waac", "stale-messaging", "foreign-app-messaging"])("checks WhatsApp phone with %s dual-account evidence", async mode => {
    const repo = new InMemoryPlatformRepository(); const now = Date.now();
    const ctx: OperationContext = {principal:{tenantId:"t",operatorId:"o"},clientId:"c",provider:"META_WHATSAPP",tool:"whatsapp_platform_get_phone",requestId:"r"};
    const base: MetaAsset = {key:"waac",id:"1",type:"WHATSAPP_ACCOUNT",tenantId:"t",clientId:"c",provider:"META_WHATSAPP",appId:"a",parents:[],verifiedAt:now-1000,revokedAt:null,revision:1};
    const waac: MetaAsset = {...base,clientId:mode === "cross-client-waac" ? "other" : "c"};
    const messaging: MetaAsset = {...base,key:"messaging",id:"2",type:"MESSAGING_ACCOUNT",parents:[{type:"WHATSAPP_ACCOUNT",id:"1"}],verifiedAt:mode === "stale-messaging" ? now-61*60_000 : now-1000,appId:mode === "foreign-app-messaging" ? "foreign" : "a"};
    const phone: MetaAsset = {...base,key:"phone",id:"3",type:"WHATSAPP_PHONE",parents:[...(mode === "missing-waac" ? [] : [{type:"WHATSAPP_ACCOUNT" as const,id:"1"}]),...(mode === "missing-messaging" ? [] : [{type:"MESSAGING_ACCOUNT" as const,id:"2"}])]};
    for (const asset of [waac,messaging,phone]) await repo.put("assets","t",asset.key,asset);
    if (mode === "valid") {
      expect((await resolveAuthorizedAssets(repo,ctx,[{type:"WHATSAPP_PHONE",id:"3"}],now)).map(a=>a.key).sort()).toEqual(["messaging","phone","waac"]);
      return;
    }
    await expect(resolveAuthorizedAssets(repo,ctx,[{type:"WHATSAPP_PHONE",id:"3"}],now)).rejects.toThrow(/WHATSAPP_DUAL_ACCOUNT_GRANTS_REQUIRED|ASSET_ACCESS_REQUIRED|ASSET_PARENT_APP_MISMATCH/);
  });
  it("rejects collisions which could replace the reviewed operation", () => {
    expect(() => validateProductContracts([executable, { ...executable, id: "different" }])).toThrow("Duplicate");
    expect(() => validateProductContracts([executable, { ...executable, tool: "different_tool" }])).toThrow("Duplicate");
  });
  it("does not allow missing evidence to become executable", () => {
    expect(() => validateProductContracts([modified({ requiredScopes: [] })])).toThrow("evidence");
    expect(() => validateProductContracts([modified({ tokenTypes: [] })])).toThrow("evidence");
    expect(() => validateProductContracts([modified({ documentation: ["https://example.com/guide"] })])).toThrow("Primary");
    expect(() => validateProductContracts([modified({ verified: false })])).toThrow("precise reason");
  });
  it("rejects path injection and unrestricted secret projections", () => {
    for (const path of ["https://attacker.invalid/", "/../me", "/me?access_token=x"]) {
      expect(() => validateProductContracts([modified({ path })])).toThrow("path");
    }
    for (const key of ["access_token", "appsecret_proof", "fields", "url", "auto_publish_text"]) {
      expect(() => validateProductContracts([modified({ allowedInputKeys: [key] })])).toThrow("Unsafe");
    }
  });
  it("limits fixed projection to the reviewed Instagram conversation contract", () => {
    const messages = PRODUCT_CONTRACTS.find(contract => contract.tool === "instagram_login_get_messages")!;
    expect(() => validateProductContracts([messages])).not.toThrow();
    for (const fixedQuery of [{ fields: "access_token" }, { access_token: "fake" }, { fields: "messages{from,message}" }]) {
      expect(() => validateProductContracts([{ ...messages, fixedQuery }])).toThrow("projection");
    }
    expect(() => validateProductContracts([modified({ fixedQuery: { fields: "messages" } })])).toThrow("projection");
  });
  it("requires explicit safe response leaf projections for every executable contract", () => {
    for (const contract of PRODUCT_CONTRACTS.filter(contract => contract.verified)) {
      expect(contract.responseFields?.length).toBeGreaterThan(0);
      expect(contract.responseFields?.some(field => /access_token|secret|payload|\.next|\.previous/.test(field))).toBe(false);
      expect(() => validateProductContracts([{ ...contract, responseFields: undefined }])).toThrow("response projection");
      expect(() => validateProductContracts([{ ...contract, responseFields: ["data.access_token"] }])).toThrow("projection");
    }
  });
  it("returns paging cursors only for a verified paginated list and never full paging URLs", () => {
    const paginated = PRODUCT_CONTRACTS.find(contract => contract.tool === "threads_list_threads")!;
    expect(paginated.responseFields).toContain("paging.cursors.after");
    expect(() => validateProductContracts([{ ...paginated, pagination: false }])).toThrow("pagination");
    for (const contract of PRODUCT_CONTRACTS.filter(contract => !contract.pagination)) expect(contract.responseFields?.some(field => field.startsWith("paging.")) ?? false).toBe(false);
    expect(() => validateProductContracts([{ ...paginated, responseFields: [...paginated.responseFields!, "paging.next"] }])).toThrow("projection");
  });
  it("cannot mislabel a messaging mutation as a read or omit window validation", () => {
    expect(() => validateProductContracts([modified({ operationClasses: ["READ"] })])).toThrow("READ");
    expect(() => validateProductContracts([modified({ requiresMessagingWindow: false })])).toThrow("window");
  });
  it("represents every requested product without claiming missing evidence means unsupported", () => {
    const products = new Set(PRODUCT_CONTRACTS.map(contract => contract.product));
    for (const product of ["business", "pages", "instagram", "messenger", "threads", "leads", "signals", "catalog", "oembed", "whatsapp"]) expect(products.has(product)).toBe(true);
    const unresolved = PRODUCT_CONTRACTS.filter(contract => !contract.verified);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every(contract => contract.unverifiedReason?.startsWith("UNVERIFIED:"))).toBe(true);
    expect(unresolved.every(contract => contract.allowedInputKeys.length === 0)).toBe(true);
  });
  it("keeps Instagram authorization providers distinct", () => {
    expect(PRODUCT_CONTRACTS.find(contract => contract.tool === "instagram_get_profile")?.provider).toBe("META_INSTAGRAM_FACEBOOK_LOGIN");
    expect(PRODUCT_CONTRACTS.find(contract => contract.tool === "instagram_login_profile")?.provider).toBe("META_INSTAGRAM_LOGIN");
    expect(PRODUCT_CONTRACTS.filter(contract => contract.provider === "META_THREADS").every(contract => contract.tokenTypes.every(type => type === "threads"))).toBe(true);
  });
});
