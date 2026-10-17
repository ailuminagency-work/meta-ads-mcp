import {PlatformDenied,type MetaAsset} from "./models.js";
export const PAGE_POST_EDIT_PREFLIGHT=Object.freeze({fields:"id,application,from",requiresCreatedOperation:true});
export function assertPagePostEditAsset(targetId:string,assets:MetaAsset[]):{pageId:string;appId:string}{
 const rows=assets.filter(a=>a.id===targetId&&a.type==="POST"&&a.provider==="META_FACEBOOK_PAGES");
 if(rows.length!==1)throw new PlatformDenied("PAGE_APP_CREATED_POST_REQUIRED");const post=rows[0]!;
 const parents=post.parents.filter(p=>p.type==="PAGE"),pages=assets.filter(a=>a.type==="PAGE"&&a.provider===post.provider&&parents.some(p=>p.id===a.id));
 if(!post.createdFromOperationId||parents.length!==1||pages.length!==1||post.id.split("_")[0]!==pages[0]!.id||!/^[0-9]{1,32}_[0-9]{1,32}$/.test(post.id)||pages[0]!.appId!==post.appId||pages[0]!.clientId!==post.clientId||pages[0]!.tenantId!==post.tenantId)throw new PlatformDenied("PAGE_APP_CREATED_POST_REQUIRED");
 return {pageId:pages[0]!.id,appId:post.appId};
}
export function assertPagePostEditResponse(value:unknown,postId:string,pageId:string,appId:string):void{
 const row=value as {id?:unknown;application?:{id?:unknown};from?:{id?:unknown}};
 if(!row||row.id!==postId||row.application?.id!==appId||row.from?.id!==pageId)throw new PlatformDenied("PAGE_POST_APP_OWNERSHIP_UNVERIFIED");
}
export function validatePagePostEditInput(input:Record<string,unknown>):void{
 if(Object.keys(input).length!==1||typeof input.message!=="string"||!input.message.trim()||Buffer.byteLength(input.message,"utf8")>10000||/@\[[^\]]*\]/.test(input.message)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.message))throw new PlatformDenied("PAGE_POST_EDIT_MESSAGE_SCHEMA_REQUIRED");
}
