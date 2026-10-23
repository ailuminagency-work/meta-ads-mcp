import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import {validCreatedProductId} from "../../src/platform/product-identifiers.js";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createServer} from "../../src/server.js";
import {requestContext} from "../../src/auth/token-store.js";
import {configurePlatformRepository} from "../../src/platform/runtime.js";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {PRODUCT_CONTRACTS} from "../../src/platform/products/contracts.js";
import {issueHumanApproval} from "../../src/platform/approvals.js";
import {encryptCredential} from "../../src/platform/connections.js";
import {assertInstagramCommentMedia,assertInstagramCommentState,validateInstagramCommentInput} from "../../src/platform/instagram-comments.js";
import type {MetaAsset,Provider} from "../../src/platform/models.js";
beforeEach(()=>{for(const [k,v]of Object.entries({DEPLOYMENT_MODE:"legacy",LUMIN_PLATFORM_ENABLED:"true",LUMIN_PLATFORM_WRITES_ENABLED:"true",AGENCY_WRITES_ENABLED:"true",TOKEN_ENCRYPTION_KEY:"e".repeat(64),INSTAGRAM_API_VERSION:"v26.0"}))vi.stubEnv(k,v);});
afterEach(()=>{configurePlatformRepository(undefined);vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function fixture(provider:Provider,mode="success"){
 const login=provider==="META_INSTAGRAM_LOGIN",tool=login?"instagram_login_reply_comment":"instagram_reply_comment",contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool)!,repo=new InMemoryPlatformRepository(),now=Date.now();configurePlatformRepository(repo);
 await repo.put("tenants","t","t",{id:"t",status:"ACTIVE",migrationState:"READY",registryRevision:1,policyRevision:1});
 for(const [id,roles]of [["actor",["writer","reader","admin"]],["human",["approver"]]] as const){await repo.put("members","t",id,{operatorId:id,tenantId:"t",roles:[...roles],allowedClientIds:["c"],revision:1,disabledAt:null});await repo.put("operatorIndex","_index",id,{operatorId:id,tenantId:"t"});}
 await repo.put("clients","t","c",{id:"c",tenantId:"t",status:"ACTIVE",revision:1,verifiedBusinessIds:[]});
 const base={provider,appId:"300",tenantId:"t",clientId:"c",verifiedAt:now,revokedAt:null,revision:1};
 const capabilities=PRODUCT_CONTRACTS.filter(c=>c.provider===provider&&["list_comments","reply_comment","hide_comment","delete_comment"].some(suffix=>c.tool.endsWith(suffix))).map(c=>c.id);
 const assets:MetaAsset[]=[{...base,key:"account",id:"101",type:"INSTAGRAM_ACCOUNT",parents:[]},{...base,key:"media",id:"555",type:"MEDIA",parents:[{type:"INSTAGRAM_ACCOUNT",id:"101"}]},{...base,key:"comment",id:"777",type:"COMMENT",parents:[{type:"MEDIA",id:"555"}]}];
 for(const a of assets){await repo.put("assets","t",a.key,a);await repo.put("grants","t",`g-${a.key}`,{id:`g-${a.key}`,tenantId:"t",clientId:"c",assetKey:a.key,connectionId:"connection",capabilities,actions:["READ","WRITE_CONTENT","DELETE"],tasks:[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1});}
 await repo.put("connections","t","connection",{id:"connection",tenantId:"t",operatorId:"actor",provider,appId:"300",credentialId:"credential",subjectId:login?"101":"999",tokenType:login?"instagram":"user",...(login?{metaAppUserId:"901"}:{}),authStrategy:"fixture",scopes:contract.requiredScopes,assetKeys:assets.map(a=>a.key),expiresAt:now+3600000,revokedAt:null,verifiedAt:now,revision:1,eligibility:contract.manualRequirements.map(requirement=>({requirement,source:contract.documentation[0],verified:true,checkedAt:now,expiresAt:now+300000}))});
 await repo.put("credentials","t","credential",encryptCredential({id:"credential",tenantId:"t",operatorId:"actor",provider,appId:"300",keyVersion:"primary"},"synthetic-comment-token"));
 await establishManualEligibilityFixture(repo,"t","c","connection");
 const fetcher=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{const url=new URL(String(input));expect(url.hostname).toBe(login?"graph.instagram.com":"graph.facebook.com");expect(new Headers(options?.headers).get("authorization")).toBe("Bearer synthetic-comment-token");
 if(url.pathname==="/v26.0/555/comments")return new Response(JSON.stringify({data:[{id:"777",timestamp:new Date().toISOString(),text:"Private client comment "+"🙂".repeat(1000),from:{id:"excluded-author"}}],paging:{next:"https://excluded.invalid"}}));
 if(url.pathname==="/v26.0/555"){expect(options?.method).toBe("GET");return new Response(JSON.stringify({id:"555",media_type:mode==="video"?"VIDEO":"IMAGE",owner:{id:mode==="foreign"?"999":"101"}}));}
 if(url.pathname==="/v26.0/777"){expect(options?.method).toBe("GET");if(mode==="revoked"){const c=(await repo.get("connections","t","connection"))!;await repo.put("connections","t","connection",{...c,revokedAt:Date.now(),revision:2});}return new Response(JSON.stringify({id:"777",hidden:mode==="hidden",media:{id:"555"},...(mode==="nested"?{parent_id:"666"}:{})}));}
 if(url.pathname==="/v26.0/888"){if(options?.method==="GET")return new Response(JSON.stringify({id:"888",hidden:false,parent_id:"777",media:{id:"555"}}));if(options?.method==="POST")expect(JSON.parse(String(options.body))).toEqual({hide:true});return new Response('{"success":true}');}
 if(url.pathname==="/v26.0/777/replies"){expect(options?.method).toBe("POST");expect(JSON.parse(String(options?.body))).toEqual({message:"Reviewed reply"});if(mode==="unknown")throw new Error("synthetic unknown");return new Response(JSON.stringify({id:mode==="bad-id"?"../foreign":"888"}));}throw new Error("unexpected fixture request");});vi.stubGlobal("fetch",fetcher);return {repo,tool,fetcher};
}
async function journey(provider:Provider,mode="success",moderation?:"hide"|"delete"){
 const f=await fixture(provider,mode),server=createServer(),client=new Client({name:"comment-test",version:"1"}),[ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(ct),server.connect(st)]);
 const call=(name:string,args:Record<string,unknown>)=>requestContext.run({fbUserId:"actor"},()=>client.callTool({name,arguments:args}));
 try{const prepared=await call("meta_prepare_action",{client_id:"c",tool:f.tool,asset_id:"777",input:{message:"Reviewed reply"}});expect(prepared.isError,JSON.stringify(prepared.content)).not.toBe(true);const data=JSON.parse((prepared.content as {text:string}[])[0]!.text),approval=await issueHumanApproval(f.repo,{tenantId:"t",operatorId:"human"},data.request_id);const result=await call(f.tool,{client_id:"c",asset_id:"777",input:{message:"Reviewed reply"},approval_id:approval});if(mode==="read"){const listed=await call(f.tool.replace("reply_comment","list_comments"),{client_id:"c",asset_id:"555",input:{}});expect(listed.isError,JSON.stringify(listed.content)).not.toBe(true);const body=JSON.parse((listed.content as {text:string}[])[0]!.text);expect(body.complete_inventory).toBe(false);expect(body.data[0].text_truncated).toBe(true);expect(Buffer.byteLength(body.data[0].text)).toBeLessThanOrEqual(2000);expect(JSON.stringify(body)).not.toContain("excluded-author");expect(JSON.stringify(await f.repo.list("assets","t"))).not.toContain("Private client comment");}
 if(moderation){expect(result.isError).not.toBe(true);const tool=f.tool.replace("reply_comment",moderation+"_comment"),input=moderation==="hide"?{hide:true}:{},prepare=await call("meta_prepare_action",{client_id:"c",tool,asset_id:"888",input});expect(prepare.isError,JSON.stringify(prepare.content)).not.toBe(true);const request=JSON.parse((prepare.content as {text:string}[])[0]!.text),approval_id=await issueHumanApproval(f.repo,{tenantId:"t",operatorId:"human"},request.request_id),changed=await call(tool,{client_id:"c",asset_id:"888",input,approval_id});expect(changed.isError,JSON.stringify(changed.content)).not.toBe(true);}return {f,result};}finally{await client.close();await server.close();}
}
describe("native approved Instagram comment replies",()=>{
 it.each(["META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN"] as Provider[])("checks owner/state and atomically registers reply for %s",async provider=>{const {f,result}=await journey(provider);expect(result.isError,JSON.stringify(result.content)).not.toBe(true);const reply=(await f.repo.list("assets","t")).find(a=>a.id==="888");expect(reply?.type).toBe("COMMENT");expect(reply?.provider).toBe(provider);expect(reply?.parents).toEqual([{type:"COMMENT",id:"777"}]);expect(f.fetcher).toHaveBeenCalledTimes(3);});
 it.each(["META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN"] as Provider[])("returns bounded authorized private comment text for %s",async provider=>{const {f}=await journey(provider,"read");expect(f.fetcher).toHaveBeenCalledTimes(5);});
 it.each(["hide","delete"] as const)("separately approves %s on the newly registered reply",async action=>{const {f}=await journey("META_INSTAGRAM_LOGIN","success",action);expect(f.fetcher).toHaveBeenCalledTimes(6);});
 it.each(["video","foreign","hidden","nested","revoked","unknown","bad-id"])("fails closed without fabricated child for %s",async mode=>{const {f,result}=await journey("META_INSTAGRAM_LOGIN",mode);expect(result.isError).toBe(true);expect((await f.repo.list("assets","t")).some(a=>a.id==="888")).toBe(false);expect(f.fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(["unknown","bad-id"].includes(mode)?1:0);});
 it("rejects forged cross-provider and unrelated COMMENT completion contracts",()=>{
  const contract=PRODUCT_CONTRACTS.find(c=>c.tool==="instagram_reply_comment")!;
  expect(validCreatedProductId(contract,"888","777")).toBe(true);
  for(const forged of [{...contract,provider:"META_THREADS" as const},{...contract,tool:"unrelated_reply"},{...contract,path:"/{asset_id}/comments"},{...contract,method:"GET" as const}])expect(validCreatedProductId(forged,"888","777")).toBe(false);
  for(const id of [undefined,"../other","888/other",123])expect(validCreatedProductId(contract,id,"777")).toBe(false);
 });
 it("rejects schema and mismatched provider state",()=>{expect(()=>validateInstagramCommentInput("instagram_reply_comment",{message:"ok",recipient:"other"})).toThrow();expect(()=>assertInstagramCommentMedia({id:"555",media_type:"IMAGE",owner:{id:"other"}},"555","101")).toThrow();expect(()=>assertInstagramCommentState("instagram_reply_comment",{id:"777",hidden:false,media:{id:"other"}},"777","555")).toThrow();});
});
