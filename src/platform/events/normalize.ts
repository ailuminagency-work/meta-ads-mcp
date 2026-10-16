import { createHash } from "node:crypto";
import { z } from "zod";
import type { AssetBinding, EventProduct, NormalizedEvent, WebhookSubscription } from "./types.js";

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const record = z.record(z.string(), z.unknown());
const envelope = z.object({
  object: z.enum(["page", "instagram", "whatsapp_business_account"]),
  entry: z.array(z.object({
    id,
    time: z.number().int().nonnegative().optional(),
    changes: z.array(z.object({ field: z.string().min(1).max(100), value: record }).strict()).max(100).optional(),
    messaging: z.array(record).max(100).optional(),
  }).strict()).min(1).max(100),
}).strict();

export class InvalidWebhook extends Error {}
export type AssetMapper = (subscription: WebhookSubscription, product: EventProduct, assetId: string) => Promise<AssetBinding | null>;

function reference(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : undefined;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function validateComplexity(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++count > 10000 || current.depth > 32) throw new InvalidWebhook("payload_complexity_limit");
    if (current.value && typeof current.value === "object") {
      for (const item of Object.values(current.value)) pending.push({ value: item, depth: current.depth + 1 });
    }
  }
}

export async function normalizeWebhook(raw: Buffer, subscription: WebhookSubscription, mapAsset: AssetMapper, now: number, retentionMs: number): Promise<NormalizedEvent[]> {
  if (!Number.isFinite(now) || !Number.isFinite(retentionMs) || retentionMs < 1000 || retentionMs > 30 * 86400_000 || raw.length > 256 * 1024) throw new InvalidWebhook("invalid_event_limits");
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw new InvalidWebhook("invalid_json"); }
  validateComplexity(parsed);
  const result = envelope.safeParse(parsed);
  if (!result.success) throw new InvalidWebhook("invalid_schema_or_unsupported_product");
  const body = result.data;
  const digest = createHash("sha256").update(raw).digest("hex");
  const output: NormalizedEvent[] = [];
  for (const entry of body.entry) {
    const candidates: { product: EventProduct; asset: string; parentAsset?: string; field: string; value: Record<string, unknown>; index: string }[] = [];
    for (const [index, change] of (entry.changes ?? []).entries()) {
      const product: EventProduct = body.object === "whatsapp_business_account" ? "whatsapp" : body.object === "instagram" ? "instagram" : change.field === "leadgen" ? "leads" : "pages";
      if (product === "leads" && (!reference(change.value.leadgen_id) || !reference(change.value.form_id))) throw new InvalidWebhook("invalid_lead_schema");
      if (product === "whatsapp") {
        if (change.field !== "messages") throw new InvalidWebhook("unsupported_whatsapp_field");
        const metadata = change.value.metadata as Record<string, unknown> | undefined;
        if (!reference(metadata?.phone_number_id)) throw new InvalidWebhook("invalid_whatsapp_metadata");
        const messages = change.value.messages, statuses = change.value.statuses;
        if (messages !== undefined && (!Array.isArray(messages) || messages.length > 100)) throw new InvalidWebhook("invalid_whatsapp_messages");
        if (statuses !== undefined && (!Array.isArray(statuses) || statuses.length > 100)) throw new InvalidWebhook("invalid_whatsapp_statuses");
        const records = [...(Array.isArray(messages) ? messages.map(value => ({ value, kind: "message" })) : []), ...(Array.isArray(statuses) ? statuses.map(value => ({ value, kind: "status" })) : [])];
        if (!records.length) throw new InvalidWebhook("empty_whatsapp_change");
        records.forEach(({value, kind}, child) => {
          if (!value || typeof value !== "object" || !reference((value as Record<string, unknown>).id)) throw new InvalidWebhook("invalid_whatsapp_event");
          const item = value as Record<string, unknown>;
          if (kind === "status" && !["sent", "delivered", "read", "failed"].includes(String(item.status))) throw new InvalidWebhook("unsupported_whatsapp_status");
          candidates.push({ product, asset: metadata!.phone_number_id as string, parentAsset: entry.id, field: kind === "status" ? `status.${item.status}` : "message", value: { message: { mid: item.id } }, index: `change:${index}:${child}` });
        });
      } else {
        if (product === "instagram" && !["comments", "mentions", "live_comments", "story_insights"].includes(change.field)) throw new InvalidWebhook("unsupported_instagram_field");
        if (product === "pages" && !["feed", "mention", "comments", "ratings", "videos"].includes(change.field)) throw new InvalidWebhook("unsupported_page_field");
        if (product === "pages" && change.field === "feed" && (!reference(change.value.item) || !reference(change.value.verb))) throw new InvalidWebhook("invalid_page_feed_schema");
        if (product === "instagram" && ["comments", "live_comments"].includes(change.field) && !reference(change.value.id)) throw new InvalidWebhook("invalid_instagram_comment_schema");
        candidates.push({ product, asset: entry.id, field: change.field, value: change.value, index: `change:${index}` });
      }
    }
    for (const [index, message] of (entry.messaging ?? []).entries()) {
      if (body.object === "whatsapp_business_account") throw new InvalidWebhook("invalid_messaging_envelope");
      const recipient = message.recipient as Record<string, unknown> | undefined;
      if (!recipient || recipient.id !== entry.id) throw new InvalidWebhook("foreign_recipient");
      if (!["message", "postback", "delivery", "read"].some(key => message[key] && typeof message[key] === "object")) throw new InvalidWebhook("unsupported_messaging_event");
      candidates.push({ product: body.object === "instagram" ? "instagram" : "messenger", asset: entry.id, field: "messaging", value: message, index: `message:${index}` });
    }
    if (!candidates.length) throw new InvalidWebhook("empty_entry");
    for (const candidate of candidates) {
      if (!subscription.products.includes(candidate.product)) throw new InvalidWebhook("unsubscribed_product");
      const binding = await mapAsset(subscription, candidate.product, candidate.asset);
      if (!binding || binding.assetId !== candidate.asset || binding.product !== candidate.product || !binding.tenantId || !binding.clientId) throw new InvalidWebhook("unmapped_asset");
      if (candidate.parentAsset) {
        const parent = await mapAsset(subscription, candidate.product, candidate.parentAsset);
        if (!parent || parent.assetId !== candidate.parentAsset || parent.product !== binding.product || parent.tenantId !== binding.tenantId || parent.clientId !== binding.clientId) throw new InvalidWebhook("foreign_parent_asset");
      }
      const value = candidate.value;
      const message = value.message as Record<string, unknown> | undefined;
      const refs = {
        leadId: reference(value.leadgen_id), formId: reference(value.form_id), adId: reference(value.ad_id),
        campaignId: reference(value.campaign_id), adsetId: reference(value.adset_id), messageId: reference(message?.mid),
      };
      const stable = refs.leadId ? `lead:${refs.leadId}` : refs.messageId ? `message:${refs.messageId}` : createHash("sha256").update(canonical({ time: entry.time ?? null, value: candidate.value })).digest("hex");
      const eventId = createHash("sha256").update(JSON.stringify([subscription.id, subscription.appId, binding.tenantId, binding.clientId, candidate.product, candidate.asset, candidate.field, stable])).digest("hex");
      output.push({ ...binding, id: eventId, subscriptionId: subscription.id, appId: subscription.appId,
        kind: candidate.field, occurredAt: entry.time === undefined ? now : entry.time * 1000,
        receivedAt: now, expiresAt: now + retentionMs,
        provenance: { provider: "meta", object: body.object, field: candidate.field, payloadDigest: digest },
        references: Object.fromEntries(Object.entries(refs).filter(([, value]) => value !== undefined)),
      });
      if (output.length > 100) throw new InvalidWebhook("too_many_events");
    }
  }
  return output;
}
