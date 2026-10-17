import {assetKey} from '../../src/platform/assets.js';
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import type {Firestore} from '@google-cloud/firestore';
import {FirestorePlatformRepository,type Collection,type Records} from '../../src/platform/repository.js';
import {privacySubjectHash} from '../../src/platform/meta-privacy-provenance.js';
import {lifecycleAppUserLockKey} from '../../src/platform/lifecycle.js';
import type {Completion} from '../../src/platform/repository.js';
import type {MetaAsset,AssetGrant,Connection,Operation} from '../../src/platform/models.js';
// Frozen output of actual fake-provider USER OAuth→human approvals→replacement
// creative→paused AD repoint. No credentials or real provider data are included.
const captured=JSON.parse(readFileSync(new URL('../fixtures/repoint-native-completion.json',import.meta.url),'utf8').replaceAll('__SYNTHETIC_CREATED_CREATIVE_KEY__',assetKey('META_MARKETING','300',{type:'CREATIVE',id:'502'}))) as {input:Completion;allAssets:MetaAsset[];allGrants:AssetGrant[];allConnections:Connection[];operation:Operation};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});function fakeFirestore(beforeGet?: () => void) {
  const data = new Map<string, unknown>();
  const calls: string[] = [];
  function snap(path: string) { return {exists:data.has(path),data:()=>structuredClone(data.get(path))}; }
  function collection(path: string) {
    return {doc:(id:string)=>doc(`${path}/${id}`),limit:()=>({path,query:true,get:async()=>{const docs=[...data.entries()].filter(([p])=>p.startsWith(`${path}/`)&&!p.slice(path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}})};
  }
  function doc(path:string) {
    return {path,collection:(name:string)=>collection(`${path}/${name}`),get:async()=>snap(path),set:async(value:unknown)=>{data.set(path,structuredClone(value));},create:async(value:unknown)=>{if(data.has(path))throw new Error("already exists");data.set(path,structuredClone(value));}};
  }
  const db = {collection,runTransaction:async(fn:(tx:unknown)=>Promise<void>)=>{
    const writes:(()=>void)[]=[];
    const tx = {get:async(ref:ReturnType<typeof doc>)=>{calls.push("get");if(writes.length)throw new Error("read after write");beforeGet?.();if((ref as unknown as {query?:boolean}).query){const docs=[...data.entries()].filter(([p])=>p.startsWith(`${ref.path}/`)&&!p.slice(ref.path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}return snap(ref.path);},create:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("create");writes.push(()=>{if(data.has(ref.path))throw new Error("already exists");data.set(ref.path,structuredClone(value));});},set:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("set");writes.push(()=>data.set(ref.path,structuredClone(value)));},update:(ref:ReturnType<typeof doc>,value:Record<string,unknown>)=>{calls.push("update");writes.push(()=>data.set(ref.path,{...(data.get(ref.path) as object),...value}));}};
    await fn(tx); writes.forEach(w=>w());
  }};
  return {db:db as unknown as Firestore,data,calls};
}
async function fixture(){const f=structuredClone(captured),fake=fakeFirestore(),repo=new FirestorePlatformRepository(fake.db),r=f.input.repointed!;vi.stubEnv('META_APP_ID','300');vi.stubEnv('TOKEN_ENCRYPTION_KEY','e'.repeat(64));vi.spyOn(Date,'now').mockReturnValue(f.input.audit.timestamp);
 for(const row of r.expectedRecords)await repo.put(row.collection as Collection,f.input.tenantId,row.id,JSON.parse(row.canonical) as Records[Collection]);for(const a of f.allAssets)await repo.put('assets',a.tenantId,a.key,a);for(const g of f.allGrants)await repo.put('grants',g.tenantId,g.id,g);for(const c of f.allConnections)await repo.put('connections',c.tenantId,c.id,c);await repo.put('operations',f.operation.tenantId,f.operation.id,f.operation);
 for(const row of r.expectedRecords.filter(e=>e.collection==='members'))await repo.put('operatorIndex','_index',row.id,{operatorId:row.id,tenantId:f.input.tenantId});return {f,fake,repo,r};}
it('real Firestore completion atomically swaps the captured approved edge, clears claim and settles exactly once',async()=>{const {f,repo,r}=await fixture(),grants=await repo.list('grants',f.input.tenantId),connections=await repo.list('connections',f.input.tenantId);await repo.finishOperation(f.input);expect(await repo.get('assets',f.input.tenantId,r.assetAfter.key)).toEqual(r.assetAfter);expect((await repo.get('assets',f.input.tenantId,r.assetAfter.key))!.creativeRepointClaim).toBeUndefined();expect(await repo.list('grants',f.input.tenantId)).toEqual(grants);expect(await repo.list('connections',f.input.tenantId)).toEqual(connections);expect((await repo.get('operations',f.input.tenantId,f.operation.id))!.state).toBe('SUCCEEDED');await repo.finishOperation(f.input);expect((await repo.list('audit',f.input.tenantId)).filter(a=>a.operationId===f.operation.id)).toHaveLength(1);});
it.each(['index','privacy','lifecycle','grant'])('real Firestore completion retains old edge/claim when %s authority changes',async attack=>{const {f,repo,r,fake}=await fixture();if(attack==='index')await repo.put('operatorIndex','_index',f.operation.actorId,{operatorId:f.operation.actorId,tenantId:'foreign'});if(attack==='privacy')fake.data.set('platform_meta_privacy_subject_locks/'+privacySubjectHash(r.connection.appId,r.connection.metaAppUserId!),{});if(attack==='lifecycle')fake.data.set('platform_lifecycle_locks/'+lifecycleAppUserLockKey(r.connection.appId,r.connection.operatorId),{});if(attack==='grant'){const g=r.grants[0];await repo.put('grants',g.tenantId,g.id,{...g,revokedAt:f.input.audit.timestamp,revision:g.revision+1});}await expect(repo.finishOperation(f.input)).rejects.toThrow();expect(await repo.get('assets',f.input.tenantId,r.assetBefore.key)).toEqual(r.assetBefore);expect(await repo.list('audit',f.input.tenantId)).toEqual([]);expect((await repo.get('operations',f.input.tenantId,f.operation.id))!.state).toBe('PREPARED');});
