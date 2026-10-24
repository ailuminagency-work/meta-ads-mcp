import express from 'express';
import type {Server} from 'node:http';
import {afterEach,expect,it} from 'vitest';
import {InMemoryPlatformRepository} from '../../src/platform/repository.js';
import {createClientManagementRouter} from '../../src/platform/client-management-router.js';
import {clientManagementHash,manageClient} from '../../src/platform/client-management.js';
import {PlatformDenied} from '../../src/platform/models.js';

const origin='https://synthetic-management.invalid';
let server:Server|undefined;
afterEach(async()=>{if(server?.listening)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;});
async function fixture(role:'admin'|'reader'='admin'){
  const repo=new InMemoryPlatformRepository();
  const principal={tenantId:'tenant',operatorId:'100'};
  await repo.put('operatorIndex','_index','100',principal);
  await repo.put('tenants','tenant','tenant',{id:'tenant',status:'ACTIVE',migrationState:'READY',policyRevision:1,registryRevision:1});
  await repo.put('members','tenant','100',{...principal,roles:[role],allowedClientIds:['lumin-internal-staging'],revision:1,disabledAt:null});
  await repo.put('clients','tenant','lumin-internal-staging',{id:'lumin-internal-staging',tenantId:'tenant',status:'ACTIVE',revision:1,verifiedBusinessIds:[]});
  await repo.put('clients','tenant','amazing-decks-seattle',{id:'amazing-decks-seattle',tenantId:'tenant',status:'ACTIVE',revision:1,verifiedBusinessIds:[]});
  await repo.put('clients','other-tenant','foreign-client',{id:'foreign-client',tenantId:'other-tenant',status:'ACTIVE',revision:1,verifiedBusinessIds:[]});
  const app=express();
  app.use('/platform/clients',createClientManagementRouter({
    origin,csrfSecret:'synthetic-review-secret-material'.repeat(2),repo,
    resolveSession:async req=>req.get('x-synthetic-session')==='human'?principal:null
  }));
  server=app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server!.once('listening',r));
  const a=server.address();if(!a||typeof a==='string')throw new Error('no server port');
  return {repo,principal,url:'http://127.0.0.1:'+a.port+'/platform/clients/'};
}
async function openReview(url:string){
  const r=await fetch(url,{headers:{'x-synthetic-session':'human'}}),html=await r.text();
  const csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1]??'';
  const cookie=r.headers.get('set-cookie')?.split(';')[0]??'';
  return {r,html,csrf,cookie};
}
const post=(f:{url:string},csrf:string,cookie:string,action:'assign'|'create',clientId:string,extra:Record<string,string>={},postOrigin=origin)=>
  fetch(f.url,{method:'POST',headers:{origin:postOrigin,cookie,'x-synthetic-session':'human','content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({csrf,action,clientId,confirmed:'yes',...extra})});

it('renders a real admin page with only same-tenant existing clients and separate create/assign actions',async()=>{
  const f=await fixture(),{r,html}=await openReview(f.url);
  expect(r.status).toBe(200);
  expect(html).toContain('amazing-decks-seattle');
  expect(html).toContain('lumin-internal-staging');
  expect(html).not.toContain('foreign-client');
  expect(html).toContain('No Meta ad account ID is needed');
  expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(r.headers.get('cache-control')).toBe('no-store');
});
it('assigns existing client without creating roots, credentials or grants and resists replay',async()=>{
  const f=await fixture(),{csrf,cookie}=await openReview(f.url);
  const first=await post(f,csrf,cookie,'assign','amazing-decks-seattle');
  expect(first.status).toBe(200);
  const m=(await f.repo.get('members','tenant','100'))!;
  expect(m.allowedClientIds).toEqual(['lumin-internal-staging','amazing-decks-seattle']);
  expect(m.revision).toBe(2);
  expect(await f.repo.list('grants','tenant')).toEqual([]);
  expect(await f.repo.list('credentials','tenant')).toEqual([]);
  expect(await f.repo.list('assets','tenant')).toEqual([]);
  expect((await post(f,csrf,cookie,'assign','amazing-decks-seattle')).status).toBe(403);
});
it('creates a client identity without any guessed Meta asset root',async()=>{
  const f=await fixture(),{csrf,cookie}=await openReview(f.url);
  expect((await post(f,csrf,cookie,'create','future-client')).status).toBe(200);
  const c=await f.repo.get('clients','tenant','future-client');
  expect(c).toEqual({id:'future-client',tenantId:'tenant',status:'ACTIVE',revision:1,verifiedBusinessIds:[]});
  expect((await f.repo.get('members','tenant','100'))?.allowedClientIds).toContain('future-client');
  expect(await f.repo.list('assets','tenant')).toEqual([]);
});
it.each(['wrong-origin','unconfirmed','extra-field','changed-member','foreign-client','duplicate-client'])('fails closed for %s',async mode=>{
  const f=await fixture(),{csrf,cookie}=await openReview(f.url);
  if(mode==='changed-member'){
    const member=(await f.repo.get('members','tenant','100'))!;
    await f.repo.put('members','tenant','100',{...member,revision:2});
  }
  const clientId=mode==='foreign-client'?'foreign-client':mode==='duplicate-client'?'lumin-internal-staging':'amazing-decks-seattle';
  const extra=mode==='unconfirmed'?{confirmed:'no'}:mode==='extra-field'?{access_token:'forbidden'}:{};
  const response=await post(f,csrf,cookie,'assign',clientId,extra,mode==='wrong-origin'?'https://attacker.invalid':origin);
  expect(response.status).toBe(403);
  expect((await f.repo.get('members','tenant','100'))?.allowedClientIds).toEqual(['lumin-internal-staging']);
});
it('requires active tenant admin and refuses unauthenticated access',async()=>{
  const f=await fixture('reader');
  expect((await fetch(f.url)).status).toBe(403);
  expect((await fetch(f.url,{headers:{'x-synthetic-session':'human'}})).status).toBe(403);
});
it('rejects direct assignment to an unregistered client without a browser session',async()=>{
  const f=await fixture(),member=(await f.repo.get('members','tenant','100'))!;
  await expect(manageClient(f.repo,f.principal,'assign','unknown-client',clientManagementHash(member)))
    .rejects.toBeInstanceOf(PlatformDenied);
});
