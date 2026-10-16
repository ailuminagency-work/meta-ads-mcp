import { assertNoCredentialShapedString } from "./input-safety.js";
import { createHash } from "node:crypto";
import type { Connection, Provider } from "./models.js";
import { PlatformDenied } from "./models.js";
import { assertExecutionPermit, claimMutationStep, getExecutionScope, revalidateExecutionPermit, withConnectionCredential } from "./execution.js";
import { canonicalJson, classifyPlan } from "./policy.js";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { unsafeIpReason } from "../utils/url-guard.js";
import { assertPreparedSignal, revalidatePreparedSignal, type PreparedSignal } from "./signals.js";
import type { MessagingExecution, MessagingRequest } from "./messaging-policy.js";
import type { ProductContract } from "./products/contracts.js";
import { resolveMetaApiVersion, assertMetaApiVersion } from "../meta/api-version.js";

const HOSTS: Record<Provider, string> = {
  META_MARKETING: "https://graph.facebook.com", META_FACEBOOK_PAGES: "https://graph.facebook.com",
  META_INSTAGRAM_FACEBOOK_LOGIN: "https://graph.facebook.com", META_INSTAGRAM_LOGIN: "https://graph.instagram.com",
  META_MESSENGER: "https://graph.facebook.com", META_WHATSAPP: "https://graph.facebook.com",
  META_THREADS: "https://graph.threads.com", META_BUSINESS: "https://graph.facebook.com",
};
export function productVersion(provider: Provider): string {
  if (provider === "META_THREADS") {
    return assertMetaApiVersion(process.env.THREADS_API_VERSION ?? "v1.0");
  }
  if (provider === "META_INSTAGRAM_LOGIN") {
    if (!process.env.INSTAGRAM_API_VERSION) throw new PlatformDenied("INSTAGRAM_API_VERSION_VERIFICATION_REQUIRED");
    return assertMetaApiVersion(process.env.INSTAGRAM_API_VERSION);
  }
  return resolveMetaApiVersion();
}
export class ProductApiError extends Error {
  constructor(readonly provider: Provider, readonly status: number, readonly code: number | null, readonly requestId: string | null) { super(`PROVIDER_REQUEST_FAILED:${provider}:HTTP_${status}:CODE_${code ?? "UNKNOWN"}`); }
}
const SECRET_KEYS = /^(access_token|refresh_token|appsecret_proof|client_secret|app_secret|encryptedToken|encrypted_token|credential|credentials|authorization)$/i;
export function sanitizeProviderResponse(value: unknown, depth = 0): unknown {
  if (depth > 25) throw new PlatformDenied("PROVIDER_RESPONSE_TOO_DEEP");
  if (typeof value === "string") return value.replace(/([?&](?:access_token|appsecret_proof|client_secret)=)[^&#\s]*/gi, "$1[REDACTED]").replace(/EAA[A-Za-z0-9]{20,}/g, "[REDACTED]");
  if (Array.isArray(value)) return value.map(v => sanitizeProviderResponse(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEYS.test(k)).map(([k,v]) => [k, sanitizeProviderResponse(v, depth + 1)]));
}
interface ProjectionNode { leaf?: boolean; children: Map<string, ProjectionNode> }
export function projectProviderResponse(value: unknown, contract: ProductContract): unknown {
  if (!contract.responseFields?.length) throw new PlatformDenied("RESPONSE_PROJECTION_REQUIRED");
  const root: ProjectionNode = { children: new Map() };
  for (const field of contract.responseFields) {
    const parts = field.split(".");
    if (parts.length > 10 || parts.some(p => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || SECRET_KEYS.test(p) || ["__proto__", "constructor", "prototype"].includes(p))) throw new PlatformDenied("INVALID_RESPONSE_PROJECTION");
    if (parts.includes("paging") && (!contract.pagination || !/^(?:[A-Za-z_]+\.)*paging\.cursors\.(before|after)$/.test(field))) continue;
    let cursor = root;
    for (const part of parts) {
      if (!cursor.children.has(part)) cursor.children.set(part, { children: new Map() });
      cursor = cursor.children.get(part)!;
    }
    cursor.leaf = true;
  }
  let nodes = 0;
  const project = (source: unknown, node: ProjectionNode, depth: number): unknown => {
    if (++nodes > 10000 || depth > 25) throw new PlatformDenied("PROVIDER_RESPONSE_TOO_COMPLEX");
    if (node.leaf) return !source || typeof source !== "object" ? sanitizeProviderResponse(source) : undefined;
    if (Array.isArray(source)) return source.map(item => project(item, node, depth + 1));
    if (!source || typeof source !== "object") return undefined;
    const output: Record<string, unknown> = {};
    for (const [key, child] of node.children) {
      if (!Object.hasOwn(source, key)) continue;
      const projected = project((source as Record<string, unknown>)[key], child, depth + 1);
      if (projected !== undefined) output[key] = projected;
    }
    return output;
  };
  const output = project(value, root, 0);
  if (!output || typeof output !== "object" || Array.isArray(output) || Object.keys(output).length === 0) throw new PlatformDenied("PROVIDER_RESPONSE_SCHEMA_INVALID");
  return output;
}
interface RateState { blockedUntil: number; failures: number; lastStatus: number; updatedAt: number }
export class ProductRateController {
  private states = new Map<string, RateState>();
  check(key: string, now = Date.now()): void { if ((this.states.get(key)?.blockedUntil ?? 0) > now) throw new PlatformDenied("PRODUCT_RATE_LIMIT_OR_CIRCUIT_OPEN"); }
  observe(key: string, response: Response, code: number | null, now = Date.now()): void {
    const previous = this.states.get(key);
    const throttled = response.status === 429 || [4,17,32,613,80000,80001,80002,80003,80004,80005,80006,80008,80009,80014].includes(code ?? -1);
    const retry = response.headers.get("retry-after");
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
    const date = retry ? Date.parse(retry) : NaN;
    const wait = seconds !== null ? seconds * 1000 : Number.isFinite(date) ? Math.max(0,date-now) : 60_000;
    const failures = response.status >= 500 ? (previous?.failures ?? 0) + 1 : 0;
    this.states.set(key, { blockedUntil: Math.max(previous?.blockedUntil ?? 0, throttled ? now + (Number.isFinite(wait) ? Math.max(wait,1000) : 60_000) : failures >= 3 ? now + 60_000 : 0), failures, lastStatus: response.status, updatedAt: now });
  }
  snapshot(): Record<string, RateState> { return Object.fromEntries([...this.states].map(([key,state]) => [key,{...state}])); }
}
export const productRateController = new ProductRateController();
type MessagingPolicyVerifier = (scope:MessagingExecution,input:MessagingRequest)=>Promise<{messagingAccountId?:string}>;
let verifyMessagingPolicy:MessagingPolicyVerifier=async()=>{throw new PlatformDenied("MESSAGING_POLICY_RUNTIME_REQUIRED");};
export function configureMessagingPolicyVerifier(verifier:MessagingPolicyVerifier|undefined):void{verifyMessagingPolicy=verifier??(async()=>{throw new PlatformDenied("MESSAGING_POLICY_RUNTIME_REQUIRED");});verifyWindow=verifier?async(_provider,assetId,recipient)=>{await verifier(getExecutionScope(),{assetId,recipient,mode:"text"});return true;}:async()=>false;}
type WindowVerifier = (provider: Provider, assetId: string, recipientId: string) => Promise<boolean>;
let verifyWindow: WindowVerifier = async () => false;
export function configureMessagingWindowVerifier(verifier: WindowVerifier): void { verifyWindow = verifier; }
export function validateContractParameters(contract: ProductContract, parameters: Record<string, unknown>): void {
  for (const key of Object.keys(parameters)) if (!contract.allowedInputKeys.includes(key) || SECRET_KEYS.test(key) || ["fields","batch","path","auto_publish_text"].includes(key)) throw new PlatformDenied("UNSUPPORTED_ENDPOINT_PARAMETER");
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20) throw new PlatformDenied("INPUT_TOO_DEEP");
    assertNoCredentialShapedString(value);
    if (Array.isArray(value)) { value.forEach(v => visit(v,depth+1)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key,v] of Object.entries(value)) { if (SECRET_KEYS.test(key) || ["__proto__","constructor","prototype","auto_publish_text"].includes(key)) throw new PlatformDenied("UNSAFE_ENDPOINT_PARAMETER"); visit(v,depth+1); }
  };
  canonicalJson(parameters);
  visit(parameters,0);
  if ("url" in parameters) {
    if (typeof parameters.url !== "string") throw new PlatformDenied("INVALID_PUBLIC_MEDIA_URL");
    const media = new URL(parameters.url);
    if (media.protocol !== "https:" || media.username || media.password || media.searchParams.has("access_token")) throw new PlatformDenied("INVALID_PUBLIC_MEDIA_URL");
  }
  if (contract.tool === "messenger_send_text") {
    const recipient = parameters.recipient as Record<string,unknown> | undefined;
    const message = parameters.message as Record<string,unknown> | undefined;
    if (!recipient || Object.keys(recipient).join() !== "id" || typeof recipient.id !== "string" || !/^\d{1,100}$/.test(recipient.id) || !message || Object.keys(message).join() !== "text" || typeof message.text !== "string" || message.text.trim().length < 1 || message.text.length > 2000) throw new PlatformDenied("LUMIN_TEXT_RESPONSE_POLICY_REQUIRED");
  }
  if (contract.tool === "whatsapp_platform_send_message") {
    if(typeof parameters.to !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(parameters.to) || typeof parameters.text !== "string" || !parameters.text.trim() || parameters.text.length>2000)throw new PlatformDenied("LUMIN_WHATSAPP_TEXT_SCHEMA_REQUIRED");
  }
  if (contract.tool === "pages_create_feed") {
    const message = parameters.message, link = parameters.link;
    if ((message !== undefined && (typeof message !== "string" || !message.trim() || message.length > 10000 || /@\[[^\]]+\]/.test(message))) || (link !== undefined && (typeof link !== "string" || !link)) || (message === undefined && link === undefined) || (parameters.published !== undefined && typeof parameters.published !== "boolean")) throw new PlatformDenied("LUMIN_PAGE_POST_SCHEMA_REQUIRED");
    if (link !== undefined) {
      let url: URL;
      try { url = new URL(link as string); } catch { throw new PlatformDenied("LUMIN_PAGE_LINK_POLICY_REQUIRED"); }
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || !hostname.includes(".") || unsafeIpReason(hostname) || /(?:^|\.)(localhost|local|internal)$/i.test(hostname) || [...url.searchParams.keys()].some(key => /token|secret|password|credential|authorization/i.test(key))) throw new PlatformDenied("LUMIN_PAGE_LINK_POLICY_REQUIRED");
    }
  }
}
export function contractPlanParameters(contract: ProductContract, assetId: string, input: Record<string,unknown>): Record<string,unknown> {
  return structuredClone({asset_id:assetId,input,endpointContract:{id:contract.id,tool:contract.tool,provider:contract.provider,method:contract.method,path:contract.path,assetType:contract.assetType,fixedQuery:contract.fixedQuery ?? {},fixedBody:contract.tool === "messenger_send_text" ? {messaging_type:"RESPONSE"} : contract.tool === "whatsapp_platform_send_message" ? {messaging_product:"whatsapp",recipient_type:"individual",type:"text",preview_url:false,messaging_account_source:"authorized_client_parent"} : {},requiredScopes:contract.requiredScopes,tokenTypes:contract.tokenTypes,operationClasses:contract.operationClasses,requiredTasks:contract.requiredTasks ?? [],manualRequirements:contract.manualRequirements,responseFields:contract.responseFields ?? [],pagination:contract.pagination ?? false,requiresMessagingWindow:contract.requiresMessagingWindow ?? false,createOrCopy:contract.createOrCopy ?? false}});
}
export function isOfficialEligibilitySource(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && ((url.hostname === "developers.facebook.com" && /^\/(docs|documentation)\//.test(url.pathname)) || (url.hostname === "www.postman.com" && url.pathname.startsWith("/meta/")));
  } catch { return false; }
}
export function assertContractEligibility(contract: ProductContract, connection: Connection, now=Date.now()): void {
  // Source URLs constrain trusted stored attestations; a public documentation
  // URL alone never proves the app's approval or the client's current consent.
  const maximumAge = contract.operationClasses.some(c => c !== "READ") ? 300000 : 3600000;
  for (const requirement of contract.manualRequirements) if (!connection.eligibility?.some(e => e.requirement === requirement && e.verified === true && isOfficialEligibilitySource(e.source) && Number.isFinite(e.checkedAt) && e.checkedAt > 0 && e.checkedAt <= now && Number.isFinite(e.expiresAt) && e.expiresAt > now && now-e.checkedAt <= maximumAge)) throw new PlatformDenied("PRODUCT_ELIGIBILITY_UNVERIFIED");
}
export function signalPlanParameters(contract:ProductContract,assetId:string,input:Record<string,unknown>,event:Record<string,unknown>):Record<string,unknown>{return {...contractPlanParameters(contract,assetId,input),prepared_event:structuredClone(event)};}
export class MetaGraphClient {
  constructor(readonly provider: Provider, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 30_000) {}
  async request(contract: ProductContract, assetId: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    if(contract.tool === "signals_send_pixel_events")throw new PlatformDenied("DEDICATED_FIRST_PARTY_SIGNAL_REQUIRED");
    return this.perform(contract,assetId,parameters);
  }
  async requestPreparedSignal(contract:ProductContract,assetId:string,input:Record<string,unknown>,prepared:PreparedSignal):Promise<unknown>{
    if(contract.tool!=="signals_send_pixel_events")throw new PlatformDenied("DEDICATED_SIGNAL_CONTRACT_REQUIRED");
    return this.perform(contract,assetId,input,prepared);
  }
  private async perform(contract: ProductContract, assetId: string, parameters: Record<string, unknown>, prepared?:PreparedSignal): Promise<unknown> {
    contract = structuredClone(contract);
    parameters = structuredClone(parameters);
    if (!contract.verified) throw new PlatformDenied("ENDPOINT_CONTRACT_OR_ELIGIBILITY_UNVERIFIED");
    if (!contract.responseFields?.length) throw new PlatformDenied("RESPONSE_PROJECTION_REQUIRED");
    if (contract.provider !== this.provider) throw new PlatformDenied("PROVIDER_CONTRACT_MISMATCH");
    validateContractParameters(contract,parameters);
    const permit = assertExecutionPermit({provider: this.provider, mutation: contract.method !== "GET", tool: contract.tool});
    const scope = getExecutionScope();
    if(prepared)assertPreparedSignal(prepared,{tenantId:scope.context.principal.tenantId,clientId:scope.context.clientId,datasetId:assetId});
    const preparedEvent=prepared?structuredClone(prepared.event):undefined;
    if (scope.plan.capability !== contract.id || canonicalJson(scope.plan.parameters) !== canonicalJson(preparedEvent?signalPlanParameters(contract,assetId,parameters,preparedEvent):contractPlanParameters(contract,assetId,parameters))) throw new PlatformDenied("APPROVED_ENDPOINT_PLAN_MISMATCH");
    if (canonicalJson(scope.plan.requiredScopes) !== canonicalJson(contract.requiredScopes) || canonicalJson(scope.plan.tokenTypes) !== canonicalJson(contract.tokenTypes) || canonicalJson(scope.plan.requiredTasks ?? []) !== canonicalJson(contract.requiredTasks ?? []) || !contract.operationClasses.every(c => scope.plan.classes.includes(c))) throw new PlatformDenied("APPROVED_ENDPOINT_CONTRACT_MISMATCH");
    if (canonicalJson(scope.plan.classes) !== canonicalJson(classifyPlan({ ...scope.plan, classes: contract.operationClasses })) || (scope.plan.createOrCopy ?? false) !== (contract.createOrCopy ?? false)) throw new PlatformDenied("APPROVED_ENDPOINT_CONTRACT_MISMATCH");
    assertContractEligibility(contract,scope.snapshot.connection);
    if (!scope.snapshot.assets.some(a => a.id === assetId && a.type === contract.assetType && a.provider === this.provider)) throw new PlatformDenied("ENDPOINT_ASSET_NOT_AUTHORIZED");
    for (const [key, type] of Object.entries(contract.assetInputKeys ?? {})) {
      const id = parameters[key];
      if (id === undefined) continue;
      if (typeof id !== "string" || !scope.snapshot.assets.some(a => a.type === type && a.provider === this.provider && a.id.replace(/^act_/, "") === id.replace(/^act_/, ""))) throw new PlatformDenied("INDIRECT_ENDPOINT_ASSET_NOT_AUTHORIZED");
    }
    let messagingAccountId:string|undefined;
    if(contract.tool === "whatsapp_platform_send_message"){
      const policy=await verifyMessagingPolicy(scope,{assetId,recipient:String(parameters.to),mode:"text"});
      const phone=scope.snapshot.assets.find(a=>a.type==="WHATSAPP_PHONE" && a.id===assetId);
      const parent=scope.snapshot.assets.find(a=>a.type==="MESSAGING_ACCOUNT" && a.id===policy.messagingAccountId);
      if(!phone || !parent || !phone.parents.some(p=>p.type==="MESSAGING_ACCOUNT" && p.id===parent.id))throw new PlatformDenied("VERIFIED_CLIENT_MESSAGING_ACCOUNT_REQUIRED");
      messagingAccountId=parent.id;
    } else if (contract.requiresMessagingWindow) {
      const recipient = parameters.recipient;
      const id = recipient && typeof recipient === "object" && "id" in recipient ? String(recipient.id) : "";
      if (!id || !await verifyWindow(this.provider,assetId,id)) throw new PlatformDenied("VERIFIED_RECIPIENT_AND_MESSAGING_WINDOW_REQUIRED");
    }
    if (!/^[A-Za-z0-9_:-]{1,200}$/.test(assetId)) throw new PlatformDenied("INVALID_ASSET_ID");
    const path = contract.path.replace("{asset_id}",encodeURIComponent(assetId));
    if (!path.startsWith("/") || /[?#]|\.\.|\{/.test(path)) throw new PlatformDenied("INVALID_ENDPOINT_CONTRACT");
    const url = new URL(`/${productVersion(this.provider)}${path}`,HOSTS[this.provider]);
    if (contract.method === "GET") for (const [k,v] of Object.entries(parameters)) url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    for (const [key,value] of Object.entries(contract.fixedQuery ?? {})) url.searchParams.set(key,value);
    await revalidateExecutionPermit(permit);
    return withConnectionCredential(permit,async token => {
      assertContractEligibility(contract,scope.snapshot.connection);
      const bucket = createHash("sha256").update(JSON.stringify([this.provider,scope.snapshot.connection.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
      productRateController.check(bucket);
      await revalidateExecutionPermit(permit);
      if(contract.tool === "whatsapp_platform_send_message"){
        const current=await verifyMessagingPolicy(scope,{assetId,recipient:String(parameters.to),mode:"text"});
        if(current.messagingAccountId!==messagingAccountId)throw new PlatformDenied("MESSAGING_POLICY_CHANGED");
      }else if(contract.requiresMessagingWindow){
        const recipient=parameters.recipient as {id?:string};
        if(!await verifyWindow(this.provider,assetId,String(recipient?.id ?? "")))throw new PlatformDenied("MESSAGING_WINDOW_CHANGED");
      }
      if(prepared)await revalidatePreparedSignal(prepared,{tenantId:scope.context.principal.tenantId,clientId:scope.context.clientId,datasetId:assetId});
      productRateController.check(bucket);
      assertContractEligibility(contract,scope.snapshot.connection);
      if (contract.method !== "GET") claimMutationStep(permit);
      const bodyParameters=preparedEvent?{data:[preparedEvent]}:contract.tool === "whatsapp_platform_send_message"?{messaging_product:"whatsapp",recipient_type:"individual",to:parameters.to,type:"text",text:{body:parameters.text,preview_url:false},messaging_account_id:messagingAccountId}:{...parameters,...(contract.tool === "messenger_send_text" ? {messaging_type:"RESPONSE"} : {})};
      let response: Response;
      try { response = await this.fetcher(url,{method:contract.method,redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(contract.method !== "GET" ? {body:JSON.stringify(bodyParameters)} : {})}); }
      catch { throw new ProductApiError(this.provider,0,null,null); }
      if (response.status === 429) productRateController.observe(bucket,response,null);
      const text = await readBodyWithLimit(response,2_000_000);
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new ProductApiError(this.provider,response.status,null,null); }
      const error = body && typeof body === "object" && "error" in body ? body.error as {code?:unknown} : null;
      const code = error && typeof error.code === "number" ? error.code : null;
      productRateController.observe(bucket,response,code);
      const requestId = response.headers.get("x-fb-trace-id")?.slice(0,128) ?? null;
      if (!response.ok || error) throw new ProductApiError(this.provider,response.status,code,requestId);
      return projectProviderResponse(body,contract);
    });
  }
}
export class MarketingApiClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_MARKETING",fetcher); } }
export class InstagramClient extends MetaGraphClient { constructor(provider: "META_INSTAGRAM_LOGIN" | "META_INSTAGRAM_FACEBOOK_LOGIN",fetcher?: typeof fetch) { super(provider,fetcher); } }
export class ThreadsClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_THREADS",fetcher); } }
export class WhatsAppClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_WHATSAPP",fetcher); } }
export class MessengerClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_MESSENGER",fetcher); } }
