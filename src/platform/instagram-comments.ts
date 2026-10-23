import {redactCredentials} from "./product-private-response.js";
import {PlatformDenied,type MetaAsset} from "./models.js";
import type {ProductContract} from "./products/contracts.js";

export const INSTAGRAM_COMMENT_SOURCE="https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment";
export const INSTAGRAM_COMMENT_PREFLIGHT=Object.freeze({mediaFields:"id,media_type,owner",commentFields:"id,hidden,parent_id,media",mediaType:"IMAGE"});
export const INSTAGRAM_COMMENT_CONTRACTS:readonly ProductContract[]=Object.freeze(([false,true] as const).flatMap(login=>(["list_comments","reply_comment","hide_comment","delete_comment"] as const).map(action=>{
 const tool=`instagram_${login?"login_":""}${action}`,read=action==="list_comments",reply=action==="reply_comment",remove=action==="delete_comment";
 return {id:tool.replaceAll("_","."),tool,provider:login?"META_INSTAGRAM_LOGIN":"META_INSTAGRAM_FACEBOOK_LOGIN",product:"instagram",title:tool.replaceAll("_"," "),method:read?"GET":remove?"DELETE":"POST",path:read?"/{asset_id}/comments":reply?"/{asset_id}/replies":"/{asset_id}",assetType:read?"MEDIA":"COMMENT",operationClasses:[read?"READ":remove?"DELETE":"WRITE_CONTENT"],requiredScopes:login?["instagram_business_basic","instagram_business_manage_comments"]:["instagram_basic","instagram_manage_comments","pages_read_engagement","ads_management","ads_read"],tokenTypes:login?["instagram"]:["user"],allowedInputKeys:reply?["message"]:action==="hide_comment"?["hide"]:[],...(read?{privateResponse:"client_comments" as const}:{}),responseFields:read?["data.id","data.timestamp","data.text"]:reply?["id"]:["success"],...(reply?{createdAssetType:"COMMENT" as const}:{}),documentation:[INSTAGRAM_COMMENT_SOURCE,"https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies","https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media","https://developers.facebook.com/documentation/instagram-platform/comment-moderation"],verified:true,manualRequirements:[
 "External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.",
 "Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.",
 "Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.",
 "Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.",
 "Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry."
 ]} as ProductContract;
})));
export const INSTAGRAM_COMMENT_TOOLS=INSTAGRAM_COMMENT_CONTRACTS.map(c=>c.tool);
export function validateInstagramCommentInput(tool:string,input:Record<string,unknown>):void{
 const keys=Object.keys(input);
 if(tool.endsWith("reply_comment")){if(keys.length!==1||keys[0]!=="message"||typeof input.message!=="string"||!input.message.trim()||Buffer.byteLength(input.message,"utf8")>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.message))throw new PlatformDenied("INSTAGRAM_COMMENT_REPLY_SCHEMA_REQUIRED");}
 else if(tool.endsWith("hide_comment")){if(keys.length!==1||keys[0]!=="hide"||typeof input.hide!=="boolean")throw new PlatformDenied("INSTAGRAM_COMMENT_HIDE_SCHEMA_REQUIRED");}
 else if(keys.length)throw new PlatformDenied("INSTAGRAM_COMMENT_EMPTY_SCHEMA_REQUIRED");
}
export function resolveInstagramCommentContext(contract:ProductContract,targetId:string,assets:MetaAsset[]):{mediaId:string;accountId:string;parentCommentId?:string}{
 const target=assets.find(a=>a.id===targetId&&a.type===contract.assetType&&a.provider===contract.provider);
 if(!target)throw new PlatformDenied("INSTAGRAM_COMMENT_TARGET_REQUIRED");
 const seen=new Set<string>();
 const findMedia=(asset:MetaAsset):MetaAsset=>{
  if(seen.size>=25||seen.has(asset.key))throw new PlatformDenied("INSTAGRAM_COMMENT_PARENT_CYCLE");seen.add(asset.key);
  if(asset.type==="MEDIA")return asset;
  const parents=asset.parents.filter(p=>p.type==="MEDIA"||p.type==="COMMENT");if(parents.length!==1)throw new PlatformDenied("INSTAGRAM_COMMENT_MEDIA_REQUIRED");
  const rows=assets.filter(a=>a.id===parents[0]!.id&&a.type===parents[0]!.type&&a.provider===contract.provider);if(rows.length!==1||rows[0]!.tenantId!==target.tenantId||rows[0]!.clientId!==target.clientId||rows[0]!.appId!==target.appId)throw new PlatformDenied("INSTAGRAM_COMMENT_PROVENANCE_MISMATCH");return findMedia(rows[0]!);
 };
 const media=findMedia(target);
 if(media.mediaEvidence||media.productKind==="instagram_container")throw new PlatformDenied("INSTAGRAM_COMMENT_MEDIA_REQUIRED");
 const accounts=assets.filter(a=>a.type==="INSTAGRAM_ACCOUNT"&&a.provider===contract.provider&&media.parents.some(p=>p.type==="INSTAGRAM_ACCOUNT"&&p.id===a.id));
 if(accounts.length!==1)throw new PlatformDenied("INSTAGRAM_COMMENT_ACCOUNT_REQUIRED");
 for(const a of [media,accounts[0]!])if(a.appId!==target.appId||a.tenantId!==target.tenantId||a.clientId!==target.clientId)throw new PlatformDenied("INSTAGRAM_COMMENT_PROVENANCE_MISMATCH");
 return {mediaId:media.id,accountId:accounts[0]!.id,...(target.type==="COMMENT"&&target.parents.some(p=>p.type==="COMMENT")?{parentCommentId:target.parents.find(p=>p.type==="COMMENT")!.id}:{})};
}
export function assertInstagramCommentMedia(value:unknown,mediaId:string,accountId:string):void{
 const row=value as {id?:unknown;media_type?:unknown;owner?:{id?:unknown}};
 if(!row||row.id!==mediaId||row.media_type!=="IMAGE"||!row.owner||row.owner.id!==accountId)throw new PlatformDenied("INSTAGRAM_OWNED_IMAGE_REQUIRED");
}
export function assertInstagramCommentState(tool:string,value:unknown,commentId:string,mediaId:string,parentCommentId?:string):void{
 const row=value as {id?:unknown;hidden?:unknown;parent_id?:unknown;media?:{id?:unknown}};
 if(!row||row.id!==commentId||row.media?.id!==mediaId||typeof row.hidden!=="boolean")throw new PlatformDenied("INSTAGRAM_COMMENT_STATE_UNVERIFIED");
 if(parentCommentId===undefined?row.parent_id!==undefined:row.parent_id!==parentCommentId)throw new PlatformDenied("INSTAGRAM_COMMENT_PARENT_STATE_MISMATCH");
 if(tool.endsWith("reply_comment")&&(row.hidden||row.parent_id!==undefined))throw new PlatformDenied("INSTAGRAM_VISIBLE_TOP_LEVEL_COMMENT_REQUIRED");
}

export function normalizeInstagramCommentResponse(tool:string,value:unknown):unknown{
 if(!["instagram_list_comments","instagram_login_list_comments"].includes(tool))return value;
 const response=value as {data?:unknown};if(!response||!Array.isArray(response.data)||response.data.length>100)throw new PlatformDenied("INSTAGRAM_COMMENT_RESPONSE_SCHEMA_REQUIRED");
 let budget=64000;const seen=new Set<string>();const data=response.data.map(value=>{
  const row=value as {id?:unknown;timestamp?:unknown;text?:unknown};if(!row||typeof row.id!=="string"||!/^\d{1,32}$/.test(row.id)||seen.has(row.id)||typeof row.timestamp!=="string"||row.timestamp.length>64||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(row.timestamp)||!Number.isFinite(Date.parse(row.timestamp))||Date.parse(row.timestamp)>Date.now()+60000||typeof row.text!=="string"||row.text.length>10000)throw new PlatformDenied("INSTAGRAM_COMMENT_RESPONSE_SCHEMA_REQUIRED");seen.add(row.id);
  const clean=redactCredentials(row.text);let text="",bytes=0;for(const char of clean){const next=Buffer.byteLength(char);if(bytes+next>Math.min(2000,budget))break;text+=char;bytes+=next;}budget-=bytes;
  return {id:row.id,timestamp:row.timestamp,text,text_truncated:text.length<clean.length,credentials_redacted:clean!==row.text};
 });return {data,complete_inventory:false,privacy:"AUTHORIZED_CLIENT_OUTPUT_ONLY_NO_PERSISTENCE",limitations:"Current provider response page only; author identities and profiles are excluded. Text excerpts are capped at 2000 UTF-8 bytes each and 64 KiB aggregate. Returned comment IDs do not enroll assets or grant mutation access."};
}
