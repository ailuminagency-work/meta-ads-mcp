import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import {readFile} from 'node:fs/promises';
import {AttachmentEnrollmentService} from '../../src/platform/attachment-enrollment.js';

import {productMediaDigest} from '../../src/platform/product-media.js';
import {it,expect,vi,afterEach} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../../src/server.js';
import {requestContext} from '../../src/auth/token-store.js';
import {configurePlatformRepository} from '../../src/platform/runtime.js';
import {InMemoryPlatformRepository} from '../../src/platform/repository.js';
import {PRODUCT_CONTRACTS} from '../../src/platform/products/contracts.js';
import {issueHumanApproval} from '../../src/platform/approvals.js';
import {encryptCredential} from '../../src/platform/connections.js';
import {MessagingPolicyService,InMemoryMessagingPolicyStore} from '../../src/platform/messaging-policy.js';
import {configureMessagingPolicyVerifier} from '../../src/platform/clients.js';
afterEach(()=>{configurePlatformRepository(undefined);configureMessagingPolicyVerifier(undefined);vi.unstubAllGlobals();vi.unstubAllEnvs();});
it.each([["messenger_send_audio","success"],["messenger_send_audio","disabled-during-window"],["messenger_send_file","success"],["messenger_send_file","disabled-during-window"]])('native approved %s / %s uses trusted inbound window and exact typed body',async(tool,mode)=>{
 for(const[k,v]of Object.entries({DEPLOYMENT_MODE:'legacy',LUMIN_PLATFORM_ENABLED:'true',LUMIN_PLATFORM_WRITES_ENABLED:'true',AGENCY_WRITES_ENABLED:'true',LUMIN_MESSENGER_ATTACHMENTS_ENABLED:'true',META_APP_ID:'300',TOKEN_ENCRYPTION_KEY:'e'.repeat(64)}))vi.stubEnv(k,v);
 const repo=new InMemoryPlatformRepository(),now=Date.now(),contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool)!;configurePlatformRepository(repo);
 await repo.put('tenants','t','t',{id:'t',status:'ACTIVE',migrationState:'READY',registryRevision:1,policyRevision:1});
 for(const[id,roles]of [['actor',['writer','reader','admin']],['human',['approver']]] as const)await repo.put('members','t',id,{operatorId:id,tenantId:'t',roles:[...roles,...(id==='actor'?['approver']:[])],allowedClientIds:['c'],revision:1,disabledAt:null});
 await repo.put('operatorIndex','_index','actor',{operatorId:'actor',tenantId:'t'});await repo.put('operatorIndex','_index','human',{operatorId:'human',tenantId:'t'});
 await repo.put('clients','t','c',{id:'c',tenantId:'t',status:'ACTIVE',revision:1,verifiedBusinessIds:[]});
 await repo.put('assets','t','page',{key:'page',id:'123',type:'PAGE',provider:'META_MESSENGER',tenantId:'t',clientId:'c',appId:'300',parents:[],verifiedAt:now,revokedAt:null,revision:1});
 await repo.put('connections','t','connection',{id:'connection',tenantId:'t',operatorId:'actor',provider:'META_MESSENGER',appId:'300',credentialId:'credential',subjectId:'123',tokenType:'page',authStrategy:'fixture',scopes:contract.requiredScopes,assetKeys:['page'],expiresAt:now+3600000,revokedAt:null,verifiedAt:now,revision:1,eligibility:[...new Set([...contract.manualRequirements,...(contract.eligibilityRequirements??[])])].map(requirement=>({requirement,source:contract.documentation[0],verified:true,checkedAt:now,expiresAt:now+300000}))});
 await repo.put('grants','t','grant',{id:'grant',tenantId:'t',clientId:'c',assetKey:'page',connectionId:'connection',capabilities:[contract.id],actions:['READ','WRITE_MESSAGING'],tasks:['MESSAGE'],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1});
 await repo.put('credentials','t','credential',encryptCredential({id:'credential',tenantId:'t',operatorId:'actor',provider:'META_MESSENGER',appId:'300',keyVersion:'primary'},'synthetic-messenger-token'));
 await establishManualEligibilityFixture(repo,'t','c','connection');
 const service=new MessagingPolicyService(new InMemoryMessagingPolicyStore(),Buffer.alloc(32,1));await service.recordTrustedInbound(service.scope({tenantId:'t',clientId:'c',provider:'META_MESSENGER',appId:'300',assetId:'123'},'456'),{eventId:'a'.repeat(64),occurredAt:now-1000,receivedAt:now,verified:true,source:'meta_signed_webhook'});configureMessagingPolicyVerifier(async(scope,input)=>{const proof=await service.verifyExecution(scope,input);if(mode==='disabled-during-window')vi.stubEnv('LUMIN_MESSENGER_ATTACHMENTS_ENABLED','false');return proof;});


 const purpose=tool==='messenger_send_audio'?'facebook_messaging_audio':'facebook_messaging_file',bytes=tool==='messenger_send_audio'?await readFile(new URL('../fixtures/video/messenger-tone-1s.mp3',import.meta.url)):Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'),digest=productMediaDigest(bytes),videoUrl='https://assets.example.test/'+digest+(tool==='messenger_send_audio'?'.mp3':'.pdf'),media=new AttachmentEnrollmentService(repo),proposal=await media.stage({id:'synthetic-adapter',tenantId:'t',clientId:'c',operatorId:'actor',accountId:'123',connectionId:'connection',appId:'300',provider:'META_MESSENGER',purpose},'delivery1',{bytes,url:videoUrl,sourceReference:digest,immutable:true,rights:{tenantId:'t',clientId:'c',provider:'META_MESSENGER',appId:'300',granted:true,purpose,contentDigest:digest,checkedAt:now,expiresAt:now+299000,source:'approved_attachment_adapter'}}),enrolled=await media.enroll({tenantId:'t',operatorId:'actor'},proposal.proposalId,proposal.planHash),sourceId=(await repo.get('assets','t',enrolled.assetKey))!.id;
 const input={recipient:{id:'456'},source_media_id:sourceId,attachment_url:videoUrl};
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(String(url)).toBe('https://graph.facebook.com/v26.0/123/messages');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-messenger-token');const body=JSON.parse(String(init?.body));expect(body.recipient).toEqual({id:'456'});if(tool==='messenger_sender_action')expect(body).toEqual(input);else expect(body.messaging_type).toBe('RESPONSE');expect(body.message).toEqual({attachment:{type:tool==='messenger_send_audio'?'audio':'file',payload:{url:videoUrl}}});return new Response(JSON.stringify({recipient_id:'456',...(tool==='messenger_sender_action'?{}:{message_id:'mid.synthetic'})}));});vi.stubGlobal('fetch',fetcher);
 const server=createServer(),client=new Client({name:'synthetic-messenger',version:'1'}),[ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(ct),server.connect(st)]);const call=(name:string,args:Record<string,unknown>)=>requestContext.run({fbUserId:'actor'},()=>client.callTool({name,arguments:args}));
 try{const prepared=await call('meta_prepare_action',{client_id:'c',tool,asset_id:'123',input});expect(prepared.isError,JSON.stringify(prepared.content)).not.toBe(true);const data=JSON.parse((prepared.content as {text:string}[])[0].text),approval_id=await issueHumanApproval(repo,{tenantId:'t',operatorId:'human'},data.request_id);const result=await call(tool,{client_id:'c',asset_id:'123',input,approval_id});expect(result.isError,JSON.stringify(result.content)).toBe(mode==='success'?undefined:true);expect(fetcher).toHaveBeenCalledTimes(mode==='success'?1:0);const replay=await call(tool,{client_id:'c',asset_id:'123',input,approval_id});expect(replay.isError).toBe(true);expect(fetcher).toHaveBeenCalledTimes(mode==='success'?1:0);expect(JSON.stringify(await repo.list('operations','t'))).not.toContain('Choose');}finally{await client.close();await server.close();}
},45000);

vi.setConfig({testTimeout:45000});
