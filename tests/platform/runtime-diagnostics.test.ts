import {describe,expect,it,vi,beforeEach,afterEach} from "vitest";
import {encryptCredential} from "../../src/platform/connections.js";
import {inspectRuntimeCompatibility} from "../../src/platform/runtime-diagnostics.js";

vi.mock("../../src/store/firestore.js",()=>({
  getFirestore:()=>({databaseId:"(default)",collection:()=>({doc:()=>({get:async()=>({exists:false})})})}),
  getFirestoreRuntimeIdentity:()=>({configuredProjectId:"lumin-meta-mcp",credentialProjectId:"lumin-meta-mcp",serviceAccountEmail:"runtime@lumin-meta-mcp.iam.gserviceaccount.com",databaseId:"(default)",emulator:false}),
}));

const principal={tenantId:"tenant",operatorId:"operator"};
const base={id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING" as const,appId:"123",keyVersion:"primary"};

beforeEach(()=>{vi.stubEnv("TOKEN_ENCRYPTION_KEY","a".repeat(64));vi.stubEnv("TOKEN_ENCRYPTION_KEY_NEXT","b".repeat(64));});
afterEach(()=>vi.unstubAllEnvs());

function repository(credential:ReturnType<typeof encryptCredential>){
  return {
    get:async(collection:string,_tenant:string,id:string)=>collection==="members"?{operatorId:"operator",tenantId:"tenant",roles:["admin"],allowedClientIds:[],revision:1,disabledAt:null}:collection==="credentials"&&id===credential.id?credential:null,
    list:async(collection:string)=>collection==="connections"?[{id:"connection",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING" as const,authStrategy:"facebook_business",credentialId:credential.id,appId:"123",tokenType:"user" as const,scopes:["ads_read"],assetKeys:[],expiresAt:null,revokedAt:null,verifiedAt:Date.now(),revision:1}]:[],
  } as never;
}

describe("runtime compatibility diagnostics",()=>{
  it("verifies identity and decrypts without writing or returning plaintext",async()=>{
    const credential=encryptCredential(base,"opaque-token");
    const result=await inspectRuntimeCompatibility(repository(credential),principal);
    expect(result.status).toBe("PASS");
    expect(result.firestore.project_binding_matches).toBe(true);
    expect(result.firestore.read_only_probe.exists).toBe(false);
    expect(result.encryption.successful_in_memory_decryptions).toBe(1);
    expect(result.encryption.database_writes_performed).toBe(0);
    expect(JSON.stringify(result)).not.toContain("opaque-token");
  });

  it("holds on an invalid encrypted credential without exposing details",async()=>{
    const credential=encryptCredential(base,"opaque-token");
    credential.payload.ciphertext="invalid";
    const result=await inspectRuntimeCompatibility(repository(credential),principal);
    expect(result.status).toBe("HOLD");
    expect(result.encryption.failed_decryptions).toBe(1);
    expect(JSON.stringify(result)).not.toContain("opaque-token");
  });

  it("fails closed for a non-administrator and a disabled member",async()=>{
    const credential=encryptCredential(base,"opaque-token");
    const repo={
      get:async(collection:string)=>collection==="members"?{tenantId:"tenant",operatorId:"operator",roles:["connection_admin"],allowedClientIds:[],revision:1,disabledAt:null}:credential,
      list:async()=>[],
    } as never;
    await expect(inspectRuntimeCompatibility(repo,principal)).rejects.toMatchObject({reason:"RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED"});
    const disabled={
      get:async(collection:string)=>collection==="members"?{tenantId:"tenant",operatorId:"operator",roles:["admin"],allowedClientIds:[],revision:1,disabledAt:Date.now()}:credential,
      list:async()=>[],
    } as never;
    await expect(inspectRuntimeCompatibility(disabled,principal)).rejects.toMatchObject({reason:"RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED"});
  });

  it("rejects a member record from another tenant before any diagnostic read",async()=>{
    const repo={
      get:async()=>({tenantId:"other-tenant",operatorId:"operator",roles:["admin"],allowedClientIds:[],revision:1,disabledAt:null}),
      list:async()=>[],
    } as never;
    await expect(inspectRuntimeCompatibility(repo,principal)).rejects.toMatchObject({reason:"RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED"});
  });
});
