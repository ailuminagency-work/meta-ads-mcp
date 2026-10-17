import { EventWorker } from "./events/worker.js";
import type { AssetBinding,EventProduct } from "./events/types.js";
import type { VerifiedWorkerAdapter } from "./operational-worker.js";
/** Deployment wiring must supply a reviewed durable-idempotency adapter inside
 * EventWorker. The external delivery key remains adapter:event, not job lease. */
export function createEventConsumerWorkerAdapter(input:{id:string;product:EventProduct;worker:EventWorker;verifiedIdempotentDelivery:true;hasDelivered?:(scope:AssetBinding,eventId:string)=>Promise<boolean>}):VerifiedWorkerAdapter{
  if(input.verifiedIdempotentDelivery!==true||!input.id)throw new Error("VERIFIED_IDEMPOTENT_EVENT_DELIVERY_REQUIRED");
  return {id:input.id,verified:true,effect:"IDEMPOTENT_DELIVERY",execute:async job=>{const scope={tenantId:job.tenantId,clientId:job.clientId,assetId:job.assetId,product:input.product};if(await input.hasDelivered?.(scope,job.cursor))return {outcome:"SUCCESS"};const outcome=await input.worker.deliver(scope,job.cursor);return {outcome:outcome==="delivered"?"SUCCESS":outcome==="dead_letter"?"PERMANENT_FAILURE":"RETRY"};}};
}
