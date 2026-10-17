import {randomUUID} from "node:crypto";
import {Router,type Request} from "express";
import type {PlatformPrincipal} from "./models.js";
import {PlatformDenied} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {MARKETING_PREVIEW_TOOL,validateMarketingPreviewInput,marketingPreviewsEnabled,renderPrivateAdPreview} from "./marketing-preview-contract.js";
import {MarketingPreviewClient} from "./marketing-preview-client.js";
import {authorizeOperation,runWithExecutionPermit,finishOperation,type ExecutionPermit} from "./execution.js";
import {contractPlanParameters} from "./clients.js";
/** The final-response dependency must inspect the sealed READ permit's exact
 * current authority after the audit await. No caller can supply this callback. */
export function createMarketingPreviewRouter(options:{repo:PlatformRepository;resolveSession(req:Request):Promise<PlatformPrincipal|null>;assertReadResponseCurrent(permit:ExecutionPermit):Promise<void>;fetcher?:typeof fetch}):Router{
 const router=Router();router.get("/:client/:ad/:format",async(req,res)=>{res.set({"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-src https://www.facebook.com; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"});let permit:ExecutionPermit|undefined,finished=false;try{
  if(!marketingPreviewsEnabled())throw new PlatformDenied("EXISTING_AD_PREVIEW_DISABLED");const clientId=String(req.params.client),adId=String(req.params.ad),input={ad_format:String(req.params.format)};if(!/^[a-zA-Z0-9_-]{1,128}$/.test(clientId)||!/^[1-9]\d{0,31}$/.test(adId))throw new PlatformDenied("EXISTING_AD_PREVIEW_SCOPE_REQUIRED");validateMarketingPreviewInput(input);const principal=await options.resolveSession(req),resolved=principal?await options.repo.resolvePrincipal(principal.operatorId):null;if(!principal||!resolved||resolved.operatorId!==principal.operatorId||resolved.tenantId!==principal.tenantId)throw new PlatformDenied("AUTHENTICATED_PREVIEW_OPERATOR_REQUIRED");const contract=PRODUCT_CONTRACTS.find(c=>c.tool===MARKETING_PREVIEW_TOOL);if(!contract?.verified)throw new PlatformDenied("EXISTING_AD_PREVIEW_CONTRACT_REQUIRED");const context={principal,clientId,provider:contract.provider,tool:contract.tool,requestId:randomUUID()};
  permit=await authorizeOperation(options.repo,context,{parameters:contractPlanParameters(contract,adId,input),assets:[{type:"AD",id:adId}],classes:["READ"],capability:contract.id,requiredScopes:contract.requiredScopes,tokenTypes:contract.tokenTypes},{writesEnabled:false});const selected=permit,source=await runWithExecutionPermit(selected,()=>new MarketingPreviewClient({fetcher:options.fetcher}).inspectForBrowser(contract,adId,input));await finishOperation(selected,"SUCCEEDED");finished=true;await options.assertReadResponseCurrent(selected);if(!marketingPreviewsEnabled())throw new PlatformDenied("EXISTING_AD_PREVIEW_DISABLED");res.type("html").send(renderPrivateAdPreview(source));
 }catch{if(permit&&!finished){try{await finishOperation(permit,"FAILED");}catch{/* Keep the response closed if durable completion also failed. */}}res.status(404).type("text").send("This private ad preview is unavailable. Reopen it from your authorized client after checking Meta access.");}});return router;
}
