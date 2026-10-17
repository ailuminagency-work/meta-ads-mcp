import {describe,expect,it} from "vitest";
import {applyProductTaskRequirements} from "../../src/platform/product-task-requirements.js";
import {PRODUCT_CONTRACTS} from "../../src/platform/products/contracts.js";
import type {MetaAsset,OperationPlan} from "../../src/platform/models.js";
const contract=PRODUCT_CONTRACTS.find(c=>c.tool==="instagram_create_container")!;
const page:MetaAsset={key:"page",id:"10",type:"PAGE",provider:"META_INSTAGRAM_FACEBOOK_LOGIN",appId:"app",tenantId:"t",clientId:"c",parents:[],verifiedAt:Date.now(),revokedAt:null,revision:1};
const account:MetaAsset={...page,key:"ig",id:"20",type:"INSTAGRAM_ACCOUNT",parents:[{type:"PAGE",id:"10"}]};
const plan=():OperationPlan=>({parameters:{},assets:[{type:"INSTAGRAM_ACCOUNT",id:"20"}],classes:["WRITE_CONTENT"],capability:contract.id,requiredScopes:contract.requiredScopes,tokenTypes:contract.tokenTypes,requiredTasks:["CREATE_CONTENT"]});
describe("reviewed product task authority",()=>{
 it("requires literal CREATE_CONTENT only on exact linked Page, never fabricates it on IG or source media",()=>{const result=applyProductTaskRequirements(plan(),contract,[page,account]);expect(result.requiredTasks).toBeUndefined();expect(result.requiredAssetTasks).toEqual([{asset:{type:"PAGE",id:"10"},tasks:["CREATE_CONTENT"]}]);});
 it.each([[],[account],[page,{...page,key:"other",id:"11"},account],[page,{...account,clientId:"foreign"}],[page,{...account,appId:"foreign"}]].map(assets=>[assets] as const))("denies absent, ambiguous or foreign linked Page %j",assets=>{expect(()=>applyProductTaskRequirements(plan(),contract,assets)).toThrow("EXACT_LINKED_PAGE_TASK_AUTHORITY_REQUIRED");});
 it("does not accept undocumented task aliases or scope extension",()=>{expect(()=>applyProductTaskRequirements(plan(),{...contract,requiredTasks:["PROFILE_PLUS_CREATE_CONTENT"]},[page,account])).toThrow("UNREVIEWED_PRODUCT_TASK_SCOPE");});
});
