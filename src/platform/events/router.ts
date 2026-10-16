import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../policy.js";
import express from "express";
import { InvalidWebhook, normalizeWebhook, type AssetMapper } from "./normalize.js";
import type { EventStore, NormalizedEvent, WebhookSubscription } from "./types.js";

export interface WebhookDependencies {
  subscriptions: { get(id: string): Promise<WebhookSubscription | null> };
  secrets: { get(reference: string): Promise<string> };
  mapAsset: AssetMapper;
  store: EventStore;
  now?: () => number;
  retentionMs?: number;
  onVerifiedEvents?: (raw:Buffer,events:NormalizedEvent[],subscription:WebhookSubscription,proof:VerifiedWebhookBatch)=>Promise<void>;
}

export interface VerifiedWebhookBatch {readonly kind:"signed-meta-batch"}
const verifiedBatches=new WeakMap<VerifiedWebhookBatch,{raw:string;events:string;subscription:string}>();
const digest=(raw:Buffer)=>createHash("sha256").update(raw).digest("hex");
function mintVerifiedBatch(raw:Buffer,events:NormalizedEvent[],subscription:WebhookSubscription):VerifiedWebhookBatch{
  const proof=Object.freeze({kind:"signed-meta-batch" as const});
  verifiedBatches.set(proof,{raw:digest(raw),events:canonicalJson(events),subscription:canonicalJson(subscription)});return proof;
}
export function assertVerifiedWebhookBatch(proof:VerifiedWebhookBatch,raw:Buffer,events:NormalizedEvent[],subscription:WebhookSubscription):void{
  const binding=verifiedBatches.get(proof);
  if(!binding || binding.raw!==digest(raw) || binding.events!==canonicalJson(events) || binding.subscription!==canonicalJson(subscription))throw new InvalidWebhook("verified_signed_batch_required");
}

function matchesToken(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function validSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !/^sha256=[0-9a-fA-F]{64}$/.test(header)) return false;
  const actual = Buffer.from(header.slice(7), "hex");
  return timingSafeEqual(actual, createHmac("sha256", secret).update(raw).digest());
}

export function createMetaWebhookRouter(deps: WebhookDependencies): express.Router {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options","nosniff"); res.setHeader("X-Frame-Options","DENY"); res.setHeader("Referrer-Policy","no-referrer"); next(); });
  router.get("/:subscriptionId", async (req, res) => {
    try {
      const subscription = await deps.subscriptions.get(req.params.subscriptionId);
      if (!subscription?.enabled) { res.sendStatus(404); return; }
      const token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
      if (req.query["hub.mode"] !== "subscribe" || typeof token !== "string" || token.length > 512 || typeof challenge !== "string" || !/^[0-9]{1,200}$/.test(challenge)) { res.sendStatus(400); return; }
      if (!matchesToken(token, await deps.secrets.get(subscription.verifyTokenReference))) { res.sendStatus(403); return; }
      res.type("text/plain").send(challenge);
    } catch { res.sendStatus(503); }
  });
  router.post("/:subscriptionId", express.raw({ type: "application/json", limit: "256kb", inflate: false }), async (req, res) => {
    try {
      const subscription = await deps.subscriptions.get(req.params.subscriptionId);
      if (!subscription?.enabled) { res.sendStatus(404); return; }
      if (!Buffer.isBuffer(req.body)) { res.sendStatus(415); return; }
      const signature = req.headers["x-hub-signature-256"];
      if (typeof signature !== "string" || !validSignature(req.body, signature, await deps.secrets.get(subscription.secretReference))) { res.sendStatus(401); return; }
      const events = await normalizeWebhook(req.body, subscription, deps.mapAsset, (deps.now ?? Date.now)(), deps.retentionMs ?? 7 * 86400_000);
      const proof=mintVerifiedBatch(req.body,events,subscription);
      await deps.store.enqueue(events);
      if(deps.onVerifiedEvents)await deps.onVerifiedEvents(req.body,events,subscription,proof);
      res.sendStatus(200);
    } catch (error) { res.sendStatus(error instanceof InvalidWebhook ? 400 : 503); }
  });
  router.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.sendStatus(error.status === 413 ? 413 : error.status === 415 ? 415 : 400);
  });
  return router;
}
