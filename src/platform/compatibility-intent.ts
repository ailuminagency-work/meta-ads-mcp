import {createHash} from "node:crypto";
import type {Connection,OperationContext,OperationPlan} from "./models.js";
import {canonicalJson} from "./policy.js";

/** Relationship observations authorize one exact typed intent, never every use of an asset. */
export function compatibilityIntentHash(ctx:OperationContext,plan:OperationPlan,connection:Pick<Connection,"id"|"appId"|"provider"|"operatorId"|"tenantId">):string {
  return createHash("sha256").update(canonicalJson({
    version:1,tenantId:ctx.principal.tenantId,clientId:ctx.clientId,actorId:ctx.principal.operatorId,
    provider:ctx.provider,tool:ctx.tool,connection:{id:connection.id,appId:connection.appId,provider:connection.provider,operatorId:connection.operatorId,tenantId:connection.tenantId},
    capability:plan.capability,...(plan.parameters.expected_creative_fingerprint!==undefined?{expectedCreativeFingerprint:plan.parameters.expected_creative_fingerprint,expectedUrlTags:plan.parameters.expected_url_tags}:{}),step:plan.parameters.legacy_write_step,...(plan.parameters.expected_original_creative_id?{expectedOriginalCreativeId:plan.parameters.expected_original_creative_id}:{}),
    assets:plan.assets.map(a=>({type:a.type,id:a.id})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))),
    requiredScopes:[...plan.requiredScopes].sort(),tokenTypes:[...plan.tokenTypes].sort(),
    requiredTasks:[...(plan.requiredTasks??[])].sort(),requiredAssetTasks:(plan.requiredAssetTasks??[]).map(r=>({asset:r.asset,tasks:[...r.tasks].sort()})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))),
  })).digest("hex");
}
