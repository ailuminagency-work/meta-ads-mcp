import {it,expect} from "vitest";
import {validateLegacyUrlTags} from "../../src/platform/legacy-url-tags.js";
import {buildStrictLegacyWritePlan} from "../../src/platform/legacy-write.js";
it("canonicalizes bounded literal UTM values deterministically",()=>{expect(validateLegacyUrlTags("utm_source=meta&utm_campaign=Spring%20Decks")).toBe("utm_campaign=Spring+Decks&utm_source=meta");expect(validateLegacyUrlTags("")).toBe("");});
it.each(["utm_source=meta&utm_source=other","access_token=x","utm_campaign={{campaign.id}}","utm_source=x#fragment","utm_source=%0A","utm_campaign=","utm_campaign=https%3A%2F%2Fforeign.example"]) ("denies opaque tracking expressions %s",value=>expect(()=>validateLegacyUrlTags(value)).toThrow());
it("includes exact tags only in separately approved new creative body",()=>{const plan=buildStrictLegacyWritePlan("ads_create_ad_creative",{account_id:"101",name:"Reviewed",page_id:"201",image_hash:"a".repeat(32),link_url:"https://client.example/",url_tags:"utm_source=meta"});expect((plan.parameters.legacy_write_step as {body:Record<string,unknown>}).body.url_tags).toBe("utm_source=meta");expect(plan.createOrCopy).toBe(true);});
