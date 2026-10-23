import type { AssetBinding, EventAdapter, EventStore, NormalizedEvent } from "./types.js";

export class EventWorker {
  constructor(private readonly store: EventStore, private readonly adapter: EventAdapter, private readonly authorize: (event: NormalizedEvent) => Promise<boolean>, private readonly now: () => number = Date.now) {}

  async deliver(scope: AssetBinding, id: string): Promise<"unavailable" | "delivered" | "retry" | "dead_letter" | "lease_lost"> {
    const claim = await this.store.claim(scope, id, this.now(), 60_000);
    if (!claim) return "unavailable";
    let outcome: "delivered" | "retry" | "dead_letter" = "delivered";
    try {
      if (!await this.authorize(claim.record.event)) outcome = "dead_letter";
      else await this.adapter.deliver(claim.record.event, { idempotencyKey: `${this.adapter.id}:${claim.record.event.id}` });
    }
    catch { outcome = claim.record.attempts >= 5 ? "dead_letter" : "retry"; }
    const now = this.now();
    const next = now + Math.min(3600_000, 1000 * 2 ** claim.record.attempts);
    const saved = await this.store.finish(scope, id, claim.leaseToken, now, outcome, next, this.adapter.id);
    return saved ? outcome : "lease_lost";
  }
}
