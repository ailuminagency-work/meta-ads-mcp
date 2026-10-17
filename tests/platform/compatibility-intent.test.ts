import {describe,it,expect} from "vitest";
import {compatibilityIntentHash} from "../../src/platform/compatibility-intent.js";
import type {OperationContext,OperationPlan} from "../../src/platform/models.js";
const ctx:OperationContext={principal:{tenantId:"tenant",operatorId:"actor"},clientId:"client",provider:"META_MARKETING",tool:"ads_create_ad_set",requestId:"request"};
const connection={id:"connection",appId:"app",provider:"META_MARKETING" as const,operatorId:"actor",tenantId:"tenant"};
const plan:OperationPlan={capability:"legacy.ads_create_ad_set",assets:[{type:"AD_ACCOUNT",id:"101"},{type:"CAMPAIGN",id:"201"}],classes:["WRITE_BUDGET"],requiredScopes:["ads_management","ads_read"],tokenTypes:["user"],parameters:{legacy_write_step:{path:"act_101/adsets",body:{status:"PAUSED",daily_budget:2000,campaign_id:"201",optimization_goal:"LINK_CLICKS"}}}};
describe("exact compatibility intent",()=>{
 it("ignores request, approval and prior observation identifiers",()=>{expect(compatibilityIntentHash({...ctx,requestId:"other"},{...plan,parameters:{...plan.parameters,approval_id:"other",eligibility:[{bindingHash:"old"}]}},connection)).toBe(compatibilityIntentHash(ctx,plan,connection));});
 it("normalizes order of reference and scope sets",()=>{expect(compatibilityIntentHash(ctx,{...plan,assets:[...plan.assets].reverse(),requiredScopes:[...plan.requiredScopes].reverse()},connection)).toBe(compatibilityIntentHash(ctx,plan,connection));});
 it.each(["tenant","client","actor","tool","provider","connection","app","body","refs","scopes"])("binds %s",field=>{
  const context=structuredClone(ctx),intent=structuredClone(plan),selected={...connection};
  if(field==="tenant")context.principal.tenantId="foreign";if(field==="client")context.clientId="foreign";if(field==="actor")context.principal.operatorId="foreign";if(field==="tool")context.tool="ads_update_ad_set";if(field==="provider")context.provider="META_BUSINESS";if(field==="connection")selected.id="other";if(field==="app")selected.appId="other";if(field==="body")(intent.parameters.legacy_write_step as {body:Record<string,unknown>}).body.daily_budget=3000;if(field==="refs")intent.assets[1].id="202";if(field==="scopes")intent.requiredScopes.push("business_management");
  expect(compatibilityIntentHash(context,intent,selected)).not.toBe(compatibilityIntentHash(ctx,plan,connection));
 });
});
