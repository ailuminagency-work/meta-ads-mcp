import {readFile} from 'node:fs/promises';
import {afterEach,it,expect,vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../../src/server.js';
import {LEGACY_MANIFEST} from '../../src/platform/legacy-manifest.js';
afterEach(()=>vi.unstubAllEnvs());
it.each([false,true])('actual SDK inventory matches generated source and preserves baseline registrations (platform=%s)',async enabled=>{
 vi.stubEnv('LUMIN_PLATFORM_ENABLED',String(enabled));const server=createServer(),client=new Client({name:'inventory-acceptance',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{const listed=await client.listTools(),names=listed.tools.map(t=>t.name);expect(new Set(names).size).toBe(names.length);const baseline=LEGACY_MANIFEST.map(t=>t.name);for(const name of baseline)expect(names).toContain(name);if(!enabled){expect(names.sort()).toEqual(baseline.sort());return;}const inventory=JSON.parse(await readFile(new URL('../../docs/generated-tool-inventory.json',import.meta.url),'utf8')) as {summary:{registeredTools:number};legacy:{tool:string}[];products:{tool:string;registered:boolean}[];control:string[];workflows:string[]};const expected=[...inventory.legacy.map(t=>t.tool),...inventory.products.filter(t=>t.registered).map(t=>t.tool),...inventory.control,...inventory.workflows];expect(names.sort()).toEqual(expected.sort());expect(names).toHaveLength(inventory.summary.registeredTools);expect(listed.tools.filter(t=>['marketing_inspect_video','marketing_inspect_creative_video','ads_get_video_media','ads_analyze_video'].includes(t.name)).every(t=>t.annotations?.readOnlyHint===true)).toBe(true);
 }finally{await client.close();await server.close();}
});
