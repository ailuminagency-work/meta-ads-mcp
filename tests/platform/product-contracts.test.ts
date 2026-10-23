import {WHATSAPP_ANALYTICS_CONTRACTS} from "../../src/platform/whatsapp-analytics-contracts.js";
import {MetaGraphClient} from "../../src/platform/clients.js";
import {WHATSAPP_PHONE_CONTRACTS} from "../../src/platform/whatsapp-phone-contracts.js";
import {WHATSAPP_TEMPLATE_CONTRACTS} from "../../src/platform/whatsapp-template-contracts.js";
import {WHATSAPP_FLOW_CONTRACTS} from "../../src/platform/whatsapp-flow-contracts.js";
import {WHATSAPP_SUBSCRIPTION_CONTRACTS} from "../../src/platform/whatsapp-subscription-contracts.js";
import { describe, expect, it } from "vitest";
import { PRODUCT_CONTRACTS, validateProductContracts, type ProductContract } from "../../src/platform/products/contracts.js";
import { resolveAuthorizedAssets } from "../../src/platform/assets.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import type { MetaAsset, OperationContext } from "../../src/platform/models.js";

const executable = PRODUCT_CONTRACTS.find(contract => contract.tool === "messenger_send_text")!;
function modified(change: Partial<ProductContract>): ProductContract { return { ...executable, ...change }; }

describe("product contract trust boundaries", () => {
  it("registers each reviewed dedicated WhatsApp contract exactly once and rejects generic bypass",async()=>{
    for(const definitions of [WHATSAPP_PHONE_CONTRACTS,WHATSAPP_TEMPLATE_CONTRACTS,WHATSAPP_FLOW_CONTRACTS,WHATSAPP_SUBSCRIPTION_CONTRACTS,WHATSAPP_ANALYTICS_CONTRACTS])for(const definition of definitions){
      const matches=PRODUCT_CONTRACTS.filter(c=>c.tool===definition.tool);expect(matches).toHaveLength(1);expect(matches[0]!.verified).toBe(true);
      await expect(new MetaGraphClient("META_WHATSAPP",async()=>{throw new Error("network must never execute");}).request(matches[0]!,"1",{})).rejects.toThrow("DEDICATED_WHATSAPP_");
    }
  });
  it("bounds catalog reads to admin-scoped metadata without feed credentials or schedules", () => {
    for (const tool of ["catalog_list_products", "catalog_list_product_sets", "catalog_list_product_feeds"]) {
      const contract = PRODUCT_CONTRACTS.find(c => c.tool === tool)!;
      expect(contract.verified).toBe(true);
      expect(contract.requiredScopes).toEqual(["catalog_management", "business_management", "pages_read_engagement", "pages_show_list"]);
      expect(contract.requiredTasks).toEqual(["MANAGE"]);
      expect(contract.tokenTypes).toEqual(["user"]);
      expect(contract.allowedInputKeys).toEqual([]);
      expect(contract.responseFields?.some(field => /schedule|url|password|filter/.test(field))).toBe(false);
      expect(contract.fixedQuery?.fields).not.toMatch(/schedule|url|password|filter/);
    }
  });
  it("bounds client-owned Business reads to reviewed metadata and user-token requirements", () => {
    for (const tool of ["business_get", "business_list_users", "business_list_system_users"]) {
      const contract = PRODUCT_CONTRACTS.find(c => c.tool === tool)!;
      expect(contract.verified).toBe(true);
      expect(contract.requiredScopes).toEqual(["business_management", "pages_read_engagement", "pages_show_list"]);
      expect(contract.tokenTypes).toEqual(["user"]);
      expect(contract.allowedInputKeys).toEqual([]);
      expect(contract.fixedQuery?.fields).not.toContain("email");
      expect(contract.responseFields?.some(field => /email|token|finance/.test(field))).toBe(false);
      expect(contract.manualRequirements.join(" ")).toContain("not an agency-wide business");
    }
    expect(PRODUCT_CONTRACTS.find(c => c.tool === "business_list_client_pages")!.verified).toBe(true);
  });
  it("keeps verified Pixel signal dispatch reference-only and Dataset mapping unresolved",()=>{
    const pixel=PRODUCT_CONTRACTS.find(c=>c.tool==="signals_send_pixel_events")!,dataset=PRODUCT_CONTRACTS.find(c=>c.tool==="signals_send_events")!;
    expect(pixel.verified).toBe(true);expect(pixel.assetType).toBe("PIXEL");expect(pixel.allowedInputKeys).toEqual(["source_reference","consent_reference"]);expect(pixel.responseFields).toEqual(["events_received"]);expect(pixel.tokenTypes).toEqual(["system_user"]);expect(pixel.requiredScopes).toEqual(["ads_management","pages_read_engagement","ads_read","pages_show_list"]);expect(dataset.verified).toBe(false);expect(dataset.assetType).toBe("DATASET");
  });
  it("limits lead reads to registered metadata without contact field expansion",()=>{
    const lead=PRODUCT_CONTRACTS.find(c=>c.tool==="leads_get_lead")!;expect(lead.verified).toBe(true);expect(lead.assetType).toBe("LEAD");expect(lead.fixedQuery).toEqual({fields:"id,created_time"});expect(lead.responseFields).toEqual(["id","created_time"]);expect(lead.allowedInputKeys).toEqual([]);expect(lead.requiredScopes).toContain("leads_retrieval");expect(lead.manualRequirements.join(" ")).toContain("LEAD_FORM, PAGE and AD_ACCOUNT");
  });
  it("verifies WhatsApp reads with scoped tokens and exact safe metadata fields", () => {
    const reads = PRODUCT_CONTRACTS.filter(c => WHATSAPP_PHONE_CONTRACTS.some(definition=>definition.tool===c.tool) && c.method==="GET");
    expect(reads.map(c => c.tool).sort()).toEqual(["whatsapp_platform_get_phone", "whatsapp_platform_get_profile", "whatsapp_platform_list_phones"]);
    for (const c of reads) {
      expect(c.requiredScopes).toEqual(c.tool === "whatsapp_platform_get_profile" ? ["whatsapp_business_management", "whatsapp_business_messaging"] : ["whatsapp_business_management"]);
      expect(c.tokenTypes).toEqual(["business_integration_system_user"]);
      expect(c.operationClasses).toEqual(["READ"]);
      expect(c.allowedInputKeys).toEqual([]);
      expect(c.manualRequirements.join(" ")).toContain("WhatsApp Account and Messaging Account dual assignment");
    }
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

it.each(["pages_create_videos","pages_get_video_status"])("actual central video contract is verified: %s",tool=>{const matches=PRODUCT_CONTRACTS.filter(c=>c.tool===tool);expect(matches).toHaveLength(1);expect(matches[0].verified).toBe(true);});
