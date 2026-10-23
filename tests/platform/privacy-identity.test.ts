import {describe,it,expect} from 'vitest';
import {connectionPrivacyAppUserId} from '../../src/platform/privacy-identity.js';
import type {Connection} from '../../src/platform/models.js';
const connection:Connection={id:'connection',tenantId:'tenant',operatorId:'100',provider:'META_WHATSAPP',appId:'300',subjectId:'901',tokenType:'business_integration_system_user',authStrategy:'verified-fixture',credentialId:'credential',scopes:[],assetKeys:[],expiresAt:Date.now()+60000,revokedAt:null,verifiedAt:Date.now(),revision:1};
describe('actual provider privacy subject identity',()=>{
 it('uses actual legacy BISU subject independently of the platform operator',()=>expect(connectionPrivacyAppUserId(connection)).toBe('901'));
 it.each([undefined,'actor',''])('requires reauthorization without a numeric legacy BISU subject %s',subjectId=>expect(()=>connectionPrivacyAppUserId({...connection,subjectId})).toThrow('BISU_APP_USER_REAUTHORIZATION_REQUIRED'));
 it('preserves explicit same-app inspected identity and rejects malformed values',()=>{expect(connectionPrivacyAppUserId({...connection,metaAppUserId:'902'})).toBe('902');expect(()=>connectionPrivacyAppUserId({...connection,metaAppUserId:'actor'})).toThrow('PRIVACY_APP_USER_IDENTITY_INVALID');});
 it('does not invent independent Instagram login identity from its professional account',()=>expect(()=>connectionPrivacyAppUserId({...connection,provider:'META_INSTAGRAM_LOGIN',tokenType:'instagram'})).toThrow('INSTAGRAM_APP_USER_REAUTHORIZATION_REQUIRED'));
});
