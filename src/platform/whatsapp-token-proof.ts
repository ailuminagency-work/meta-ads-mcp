import {z} from "zod";
import {PlatformDenied,type Connection} from "./models.js";
import {canonicalJson} from "./policy.js";
const id=z.string().regex(/^\d{1,32}$/);
/** Caller supplies its fixed-host, rate-limited, current-permit checked READ transport. */
export async function verifyWhatsAppBisuProof(input:{connection:Connection;messagingAccountId:string;requiredScopes:readonly string[];token:string;appSecret:string;read(path:string,query:Record<string,string>,bearer?:string):Promise<unknown>}):Promise<void>{
 const c=input.connection;if(c.provider!=="META_WHATSAPP"||c.tokenType!=="business_integration_system_user"||!c.subjectId||!c.clientBusinessId||!input.appSecret||/[|\s\x00-\x1f\x7f]/.test(input.appSecret))throw new PlatformDenied("WHATSAPP_BISU_PROOF_REQUIRED");
 const debug=z.object({data:z.object({is_valid:z.literal(true),app_id:z.union([id,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),user_id:id,scopes:z.array(z.string()).max(100),granular_scopes:z.array(z.object({scope:z.string(),target_ids:z.array(id).max(100)})).max(100)})}).parse(await input.read("/debug_token",{input_token:input.token},`${c.appId}|${input.appSecret}`)).data;
 if(String(debug.app_id)!==c.appId||debug.user_id!==c.subjectId||new Set(debug.scopes).size!==debug.scopes.length||canonicalJson([...debug.scopes].sort())!==canonicalJson([...c.scopes].sort())||input.requiredScopes.some(scope=>!debug.granular_scopes.some(grant=>grant.scope===scope&&grant.target_ids.includes(input.messagingAccountId))))throw new PlatformDenied("WHATSAPP_BISU_ACTUAL_GRANT_REQUIRED");
 const me=z.object({id,client_business_id:id}).parse(await input.read("/me",{fields:"client_business_id"}));if(me.id!==c.subjectId||me.client_business_id!==c.clientBusinessId)throw new PlatformDenied("WHATSAPP_BISU_ACTUAL_BUSINESS_REQUIRED");
}
