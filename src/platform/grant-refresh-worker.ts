import type { OperationalStore } from "./operational-store.js";
import type { SupervisedLifecycleService, LifecycleCommand } from "./lifecycle.js";
import type { VerifiedWorkerAdapter } from "./operational-worker.js";
/** Internal registry-only completion of an already human-approved grant refresh.
 * Provider inspection is read-only; the one-time lifecycle command supplies
 * durable idempotency. This adapter cannot perform token/provider revocation. */
export function createSupervisedGrantRefreshWorkerAdapter(input:{id:string;store:OperationalStore;lifecycle:SupervisedLifecycleService;webhookIndexes?:{refresh(commandId:string):Promise<number>}}):VerifiedWorkerAdapter{
  return {id:input.id,verified:true,effect:"IDEMPOTENT_DELIVERY",execute:async job=>{
    const command=await input.store.get<LifecycleCommand>("lifecycle_commands",job.cursor);
    if(!command||command.tenantId!==job.tenantId||command.clientId!==job.clientId||command.action!=="REFRESH_GRANTS")return {outcome:"PERMANENT_FAILURE"};
    const bound=await input.store.transaction(async tx=>{const connection=await tx.platform("connections",job.tenantId,command.connectionId);if(!connection)return false;const assets=await Promise.all(connection.assetKeys.map(key=>tx.platform("assets",job.tenantId,key)));return assets.some(a=>a?.id===job.assetId&&a.clientId===job.clientId&&a.tenantId===job.tenantId);});
    if(!bound)return {outcome:"PERMANENT_FAILURE"};
    if(command.state==="SUCCEEDED"){try{await input.webhookIndexes?.refresh(command.id);return {outcome:"SUCCESS"};}catch{return {outcome:"PERMANENT_FAILURE"};}}
    if(command.state!=="APPROVED")return {outcome:"PERMANENT_FAILURE"};
    try{const result=await input.lifecycle.execute({tenantId:command.tenantId,operatorId:command.actorId},command.id);if(result.state!=="SUCCEEDED")return {outcome:"PERMANENT_FAILURE"};await input.webhookIndexes?.refresh(command.id);return {outcome:"SUCCESS"};}catch{return {outcome:"PERMANENT_FAILURE"};}
  }};
}
