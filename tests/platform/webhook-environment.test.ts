import {afterEach,describe,expect,it,vi} from "vitest";
import type {Firestore} from "@google-cloud/firestore";
import {createEnvironmentWebhookDependencies,initializeEnvironmentWebhooks,webhookAssetIndexKey} from "../../src/platform/events/environment.js";
import {configurePlatformWebhooks,hasPlatformWebhookConfiguration} from "../../src/platform/events/runtime.js";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import type {MetaAsset} from "../../src/platform/models.js";
const now=1_800_000_000_000,subscription={id:"s",appId:"123",enabled:true,products:["messenger" as const],secretReference:"META_APP_SECRET",verifyTokenReference:"META_WEBHOOK_VERIFY_TOKEN"};
const env={META_APP_ID:"123",META_WEBHOOK_SUBSCRIPTIONS_JSON:JSON.stringify([subscription]),META_APP_SECRET:"synthetic-private-secret",META_WEBHOOK_VERIFY_TOKEN:"synthetic-private-verify"};
afterEach(()=>{configurePlatformWebhooks(undefined);vi.restoreAllMocks();});
async function fixture(){
  const repo=new InMemoryPlatformRepository(),reads:string[]=[],index:Record<string,unknown>={tenantId:"t",clientId:"c",assetKey:"page",appId:"123",product:"messenger",assetId:"456",provider:"META_MESSENGER",verifiedAt:now-1000,expiresAt:now+60_000,revokedAt:null};
  const db={collection:(name:string)=>({doc:(id:string)=>({get:async()=>{reads.push(`${name}/${id}`);return {exists:true,data:()=>structuredClone(index)};}})})} as unknown as Firestore;
  const asset:MetaAsset={key:"page",id:"456",type:"PAGE",tenantId:"t",clientId:"c",provider:"META_MESSENGER",appId:"123",parents:[],verifiedAt:now-1000,revokedAt:null,revision:1};
  await repo.put("tenants","t","t",{id:"t",status:"ACTIVE",migrationState:"READY",policyRevision:1,registryRevision:1});await repo.put("clients","t","c",{id:"c",tenantId:"t",status:"ACTIVE",revision:1,verifiedBusinessIds:[]});await repo.put("assets","t","page",asset);
  const deps=createEnvironmentWebhookDependencies(env,db,repo,()=>now),sub=(await deps.subscriptions.get("s"))!;
  return {repo,db,index,reads,asset,deps,sub};
}
describe("server-owned environment webhook host",()=>{
  it.each([undefined,"999","not-an-app-id"])("rejects missing or mismatched configured Meta app identity %j",async appId=>{
    const f=await fixture();expect(()=>createEnvironmentWebhookDependencies({...env,META_APP_ID:appId},f.db,f.repo)).toThrow("CONFIGURED_APP_BINDING");expect(f.reads).toEqual([]);
  });
  it("binds Instagram Login subscriptions to the separately configured Instagram app ID",async()=>{
    const f=await fixture(),ig={...subscription,appId:"777",products:["instagram"],secretReference:"INSTAGRAM_APP_SECRET",verifyTokenReference:"INSTAGRAM_WEBHOOK_VERIFY_TOKEN"},candidate={...env,META_WEBHOOK_SUBSCRIPTIONS_JSON:JSON.stringify([ig]),INSTAGRAM_APP_ID:"777",INSTAGRAM_APP_SECRET:"synthetic-ig-secret",INSTAGRAM_WEBHOOK_VERIFY_TOKEN:"synthetic-ig-verify"};
    expect(()=>createEnvironmentWebhookDependencies(candidate,f.db,f.repo)).not.toThrow();expect(()=>createEnvironmentWebhookDependencies({...candidate,INSTAGRAM_APP_ID:"123"},f.db,f.repo)).toThrow("CONFIGURED_APP_BINDING");expect(()=>createEnvironmentWebhookDependencies({...candidate,INSTAGRAM_APP_ID:undefined},f.db,f.repo)).toThrow("CONFIGURED_APP_BINDING");
  });
  it("uses one global hashed index lookup then only the indexed tenant's registered assets",async()=>{
    const f=await fixture(),list=vi.spyOn(f.repo,"list");expect(await f.deps.mapAsset(f.sub,"messenger","456")).toEqual({tenantId:"t",clientId:"c",product:"messenger",assetId:"456"});
    expect(f.reads).toEqual([`platform_webhook_asset_index/${webhookAssetIndexKey("123","messenger","456")}`]);expect(list.mock.calls.every(args=>args[1]==="t")).toBe(true);expect(f.reads[0]).not.toContain("456");
  });
  it("exposes only configured secret references and never includes secret values in configuration errors",async()=>{
    const f=await fixture();expect(await f.deps.secrets.get("META_APP_SECRET")).toBe(env.META_APP_SECRET);await expect(f.deps.secrets.get("UNRELATED_KEY")).rejects.toThrow("REFERENCE_DENIED");
    let error:unknown;try{createEnvironmentWebhookDependencies({...env,META_WEBHOOK_SUBSCRIPTIONS_JSON:JSON.stringify([{...subscription,access_token:env.META_APP_SECRET}])},f.db,f.repo);}catch(e){error=e;}
    expect(String(error)).toContain("CONFIGURATION_INVALID");expect(String(error)).not.toContain(env.META_APP_SECRET);expect(JSON.stringify(await f.deps.subscriptions.get("s"))).not.toContain(env.META_APP_SECRET);
  });
  it.each(["bad-json","threads","inline-secret","missing-secret","duplicate-id","wrong-secret-product"])("rejects %s configuration without live access",async attack=>{
    const f=await fixture(),candidate={...env};
    if(attack==="bad-json")candidate.META_WEBHOOK_SUBSCRIPTIONS_JSON="{";
    if(attack==="threads")candidate.META_WEBHOOK_SUBSCRIPTIONS_JSON=JSON.stringify([{...subscription,products:["threads"]}]);
    if(attack==="inline-secret")candidate.META_WEBHOOK_SUBSCRIPTIONS_JSON=JSON.stringify([{...subscription,secretReference:"synthetic-inline-secret"}]);
    if(attack==="missing-secret")candidate.META_APP_SECRET="";
    if(attack==="duplicate-id")candidate.META_WEBHOOK_SUBSCRIPTIONS_JSON=JSON.stringify([subscription,subscription]);
    if(attack==="wrong-secret-product")candidate.META_WEBHOOK_SUBSCRIPTIONS_JSON=JSON.stringify([{...subscription,secretReference:"INSTAGRAM_APP_SECRET",verifyTokenReference:"INSTAGRAM_WEBHOOK_VERIFY_TOKEN"}]);
    expect(()=>createEnvironmentWebhookDependencies(candidate,f.db,f.repo)).toThrow();expect(f.reads).toEqual([]);
  });
  it.each(["cross-client","wrong-app","wrong-provider","future-index","stale-index","expired-index","revoked-index","future-asset","stale-asset","revoked-asset","disabled-client"])("denies %s indexed ownership evidence",async attack=>{
    const f=await fixture();
    if(attack==="cross-client")f.index.clientId="other";if(attack==="wrong-app")f.index.appId="999";if(attack==="wrong-provider")f.index.provider="META_FACEBOOK_PAGES";if(attack==="future-index")f.index.verifiedAt=now+1;if(attack==="stale-index")f.index.verifiedAt=now-60*60_000;if(attack==="expired-index")f.index.expiresAt=now;if(attack==="revoked-index")f.index.revokedAt=now;
    if(attack==="future-asset")await f.repo.put("assets","t","page",{...f.asset,verifiedAt:now+1});if(attack==="stale-asset")await f.repo.put("assets","t","page",{...f.asset,verifiedAt:now-61*60_000});if(attack==="revoked-asset")await f.repo.put("assets","t","page",{...f.asset,revokedAt:now});if(attack==="disabled-client"){const client=(await f.repo.get("clients","t","c"))!;await f.repo.put("clients","t","c",{...client,status:"DISABLED"});}
    await expect(f.deps.mapAsset(f.sub,"messenger","456")).rejects.toThrow();
  });
  it("rejects forged subscription descriptors before reading index or assets",async()=>{
    const f=await fixture();await expect(f.deps.mapAsset({...f.sub,appId:"999"},"messenger","456")).rejects.toThrow("SUBSCRIPTION_BINDING");expect(f.reads).toEqual([]);
  });
  it.each(["cross-client","future","wrong-app"])("revalidates %s parent evidence after exact global routing",async attack=>{
    const f=await fixture();await f.repo.put("assets","t","page",{...f.asset,parents:[{type:"APP",id:"123"}]});
    await f.repo.put("assets","t","app",{...f.asset,key:"app",id:"123",type:"APP",parents:[],clientId:attack==="cross-client"?"other":"c",appId:attack==="wrong-app"?"999":"123",verifiedAt:attack==="future"?now+1:now-1000});
    await expect(f.deps.mapAsset(f.sub,"messenger","456")).rejects.toThrow();expect(f.reads).toHaveLength(1);
  });
  it("does not infer a tenant when the global index document is missing",async()=>{
    const f=await fixture(),db={collection:()=>({doc:()=>({get:async()=>({exists:false})})})} as unknown as Firestore,list=vi.spyOn(f.repo,"list");
    const deps=createEnvironmentWebhookDependencies(env,db,f.repo,()=>now);expect(await deps.mapAsset(f.sub,"messenger","456")).toBeNull();expect(list).not.toHaveBeenCalled();
  });
  it("requires both runtime flags and preserves injected configuration without explicit JSON",async()=>{
    expect(initializeEnvironmentWebhooks({env:{LUMIN_PLATFORM_ENABLED:"false",LUMIN_PLATFORM_WEBHOOKS_ENABLED:"true"}})).toBe(false);
    const f=await fixture();configurePlatformWebhooks(f.deps);expect(initializeEnvironmentWebhooks({env:{LUMIN_PLATFORM_ENABLED:"true",LUMIN_PLATFORM_WEBHOOKS_ENABLED:"true"}})).toBe(false);expect(hasPlatformWebhookConfiguration()).toBe(true);
    expect(initializeEnvironmentWebhooks({env:{...env,LUMIN_PLATFORM_ENABLED:"true",LUMIN_PLATFORM_WEBHOOKS_ENABLED:"true"},firestore:f.db,repository:f.repo})).toBe(true);expect(f.reads).toEqual([]);
  });
  it("fails closed when enabled without explicit server configuration",()=>{
    expect(()=>initializeEnvironmentWebhooks({env:{LUMIN_PLATFORM_ENABLED:"true",LUMIN_PLATFORM_WEBHOOKS_ENABLED:"true"}})).toThrow("CONFIGURATION_REQUIRED");expect(()=>initializeEnvironmentWebhooks({env:{LUMIN_PLATFORM_ENABLED:"true",LUMIN_PLATFORM_WEBHOOKS_ENABLED:"invalid"}})).toThrow("FEATURE_FLAG");
    expect(()=>initializeEnvironmentWebhooks({env:{LUMIN_PLATFORM_ENABLED:"true",LUMIN_PLATFORM_WEBHOOKS_ENABLED:"true",META_WEBHOOK_SUBSCRIPTIONS_JSON:"{"}})).toThrow("CONFIGURATION_INVALID");
  });
});
