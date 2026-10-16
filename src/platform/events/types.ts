export type EventProduct = "leads" | "pages" | "instagram" | "messenger" | "whatsapp";

export interface WebhookSubscription {
  id: string;
  appId: string;
  enabled: boolean;
  products: EventProduct[];
  secretReference: string;
  verifyTokenReference: string;
}

export interface AssetBinding {
  tenantId: string;
  clientId: string;
  assetId: string;
  product: EventProduct;
}

export interface NormalizedEvent extends AssetBinding {
  id: string;
  subscriptionId: string;
  appId: string;
  kind: string;
  occurredAt: number;
  receivedAt: number;
  expiresAt: number;
  provenance: { provider: "meta"; object: string; field: string; payloadDigest: string };
  references: { leadId?: string; formId?: string; adId?: string; campaignId?: string; adsetId?: string; messageId?: string };
  encryptedPayload?: { reference: string; expiresAt: number };
}

export interface StoredEvent {
  event: NormalizedEvent;
  status: "pending" | "processing" | "retry" | "delivered" | "dead_letter";
  attempts: number;
  nextAttemptAt: number;
  leaseToken?: string;
  leaseUntil?: number;
  lastErrorCode?: "adapter_failed";
}

export interface ClaimedEvent { record: StoredEvent; leaseToken: string }
export interface EventStore {
  due(scope: AssetBinding, now: number, limit: number): Promise<string[]>;
  enqueue(events: NormalizedEvent[]): Promise<{ inserted: number; duplicates: number }>;
  claim(scope: AssetBinding, id: string, now: number, leaseMs: number): Promise<ClaimedEvent | null>;
  finish(scope: AssetBinding, id: string, leaseToken: string, now: number, outcome: "delivered" | "retry" | "dead_letter", nextAttemptAt?: number, adapterId?: string): Promise<boolean>;
  replay(scope: AssetBinding, id: string, now: number): Promise<boolean>;
  checkpoint(scope: AssetBinding, adapterId: string): Promise<string | null>;
}

export interface EventAdapter {
  id: string;
  deliver(event: NormalizedEvent, context: { idempotencyKey: string }): Promise<void>;
}

export function scopeKey(scope: AssetBinding): string {
  return JSON.stringify([scope.tenantId, scope.clientId, scope.product, scope.assetId]);
}
