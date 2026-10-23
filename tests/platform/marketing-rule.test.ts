import {describe,it,expect} from 'vitest';
import {marketingRuleBody,validateMarketingRuleInput} from '../../src/platform/marketing-rule-contract.js';
describe('disabled static pause rule contract',()=>{
 const input={name:'Review only',ad_ids:['120246671040730037','9007199254740993'],impressions_threshold:10000};
 it('preserves exact integer literals without floating-point coercion and binds disabled static scheduling',()=>{const b=marketingRuleBody(input);expect(b.status).toBe('DISABLED');expect(b.evaluation_spec).toContain('120246671040730037,9007199254740993');expect(b.schedule_spec).toBe('{"schedule_type":"DAILY"}');expect(b.execution_spec).toBe('{"execution_type":"PAUSE"}');expect(b.evaluation_spec).toContain('LAST_7_DAYS');expect(b.evaluation_spec).not.toContain('entity_type');});
 for(const patch of [{ad_ids:[]},{ad_ids:['01']},{ad_ids:['1','1']},{ad_ids:[9007199254740993]},{ad_ids:['1],"evil":true']},{impressions_threshold:NaN},{impressions_threshold:0},{status:'ACTIVE'},{execution_spec:{}},{name:'x\n'},{name:'   '},{name:'sk-proj-abcdefghijklmnopqrstuvwxyz123456'}])it('rejects unreviewed or malformed inputs '+JSON.stringify(patch),()=>expect(()=>validateMarketingRuleInput({...input,...patch})).toThrow());
});
