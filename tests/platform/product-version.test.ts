import {it,expect,vi,afterEach} from 'vitest';
import {productVersion} from '../../src/platform/product-version.js';
afterEach(()=>vi.unstubAllEnvs());
it('keeps independently reviewed product versions separate',()=>{vi.stubEnv('META_API_VERSION','v26.0');vi.stubEnv('INSTAGRAM_API_VERSION','v26.0');vi.stubEnv('THREADS_API_VERSION','v1.0');expect(productVersion('META_MARKETING')).toBe('v26.0');expect(productVersion('META_INSTAGRAM_LOGIN')).toBe('v26.0');expect(productVersion('META_THREADS')).toBe('v1.0');});
it.each([['META_MARKETING','META_API_VERSION','v25.0','GRAPH_PRODUCT_VERSION_UNVERIFIED'],['META_THREADS','THREADS_API_VERSION','v26.0','THREADS_PRODUCT_VERSION_UNVERIFIED'],['META_INSTAGRAM_LOGIN','INSTAGRAM_API_VERSION','v25.0','INSTAGRAM_PRODUCT_VERSION_UNVERIFIED']] as const)('fails closed on unsupported %s version',(provider,key,value,reason)=>{vi.stubEnv(key,value);expect(()=>productVersion(provider)).toThrow(reason);});
it('does not reflect malformed configured values',()=>{vi.stubEnv('META_API_VERSION','synthetic-private-configuration');expect(()=>productVersion('META_MARKETING')).toThrow(/^PRODUCT_VERSION_CONFIGURATION_INVALID$/);});
