import type {MetaAsset,OperationContext} from "./models.js";
import {PlatformDenied} from "./models.js";
import type {ProductContract} from "./products/contracts.js";
export function scopedBusinessInventory(contract:ProductContract,ctx:OperationContext,targetId:string,response:unknown,registry:MetaAsset[]):unknown{
 if(contract.product!=="business"||!contract.returnedAssetType)return response;
 if(!response||typeof response!=="object"||Array.isArray(response)||!Array.isArray((response as {data?:unknown}).data))throw new PlatformDenied("BUSINESS_INVENTORY_SCHEMA_INVALID");
 const roots=registry.filter(a=>a.id===targetId&&a.type==="BUSINESS"&&a.provider===contract.provider&&a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId&&a.revokedAt===null);if(roots.length!==1)throw new PlatformDenied("BUSINESS_INVENTORY_ROOT_REQUIRED");
 const rows=(response as {data:unknown[]}).data;if(rows.length>1000)throw new PlatformDenied("BUSINESS_INVENTORY_LIMIT_REQUIRED");
 const now=Date.now(),seen=new Set<string>(),data:Array<{id:string;name?:string}>=[];
 for(const raw of rows){if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new PlatformDenied("BUSINESS_INVENTORY_SCHEMA_INVALID");const row=raw as Record<string,unknown>;if(typeof row.id!=="string"||!/^(?:act_)?\d{1,100}$/.test(row.id)||seen.has(row.id.replace(/^act_/,""))||row.name!==undefined&&(typeof row.name!=="string"||row.name.length>500))throw new PlatformDenied("BUSINESS_INVENTORY_SCHEMA_INVALID");seen.add(row.id.replace(/^act_/,""));
  const matches=registry.filter(a=>a.id.replace(/^act_/,"")===String(row.id).replace(/^act_/,"")&&a.type===contract.returnedAssetType&&a.provider===contract.provider&&a.appId===roots[0].appId&&a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId&&a.revokedAt===null&&Number.isSafeInteger(a.verifiedAt)&&a.verifiedAt>0&&a.verifiedAt<=now&&now-a.verifiedAt<=3600000&&a.parents.some(p=>p.type==="BUSINESS"&&p.id===targetId));
  if(matches.length===1)data.push({id:row.id,...(typeof row.name==="string"?{name:row.name}:{})});
 }
 return {data,withheld_rows:rows.length-data.length,inventory_status:"REGISTERED_CLIENT_CHILDREN_ONLY",complete_inventory:false,authority_change:false};
}
