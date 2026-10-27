import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The body signature (`x-lumin-signature`) covers the bytes, so it can only be
 * checked after they are buffered, and until then anyone who knew a profile id
 * could hold the memory and the single in-flight slot. The pre-auth signature
 * covers only what the headers declare (profile, binding, timestamp, delivery
 * and the exact Content-Length), so it is verified before a byte of the body is
 * read. The body signature is still verified afterwards and still binds the
 * content; the pre-auth signature never replaces it.
 */
export const INGRESS_PREAUTH_HEADER = "x-lumin-request-signature";

const BODY_DEADLINE_MS = 10_000;
// A header set stays acceptable for 300 s either side of its timestamp, so it can be replayed for up to 600 s.
const REPLAY_WINDOW_MS = 600_000;
const REPLAY_MAX_PER_PROFILE = 1_000;
const SIGNATURE_SHAPE = /^sha256=[a-f0-9]{64}$/;

export function ingressPreauthSignature(
  domain: string,
  profileId: string,
  binding: string,
  timestamp: string,
  delivery: string,
  contentLength: number,
  key: string,
): string {
  return (
    "sha256=" +
    createHmac("sha256", Buffer.from(key, "hex"))
      .update(`ingress-preauth-v1\n${domain}\n${profileId}\n${binding}\n${timestamp}\n${delivery}\n${contentLength}\n`)
      .digest("hex")
  );
}

/**
 * A request without the pre-auth signature can only be authenticated after its
 * body is buffered. That is refused unless the deployment is a test or
 * development run, or the operator names the exception. Unset NODE_ENV is not
 * an exception.
 */
export function legacyBodySignatureAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LUMIN_INGRESS_ALLOW_LEGACY_BODY_SIGNATURE === "true" || env.NODE_ENV === "test" || env.NODE_ENV === "development";
}

interface ReplayOptions {
  ttlMs?: number;
  maxPerProfile?: number;
  now?: () => number;
}

/**
 * Delivery ids seen on authenticated requests, per profile, for as long as the
 * header set that carried them could still be replayed. An entry is `active`
 * while its request is arriving and `settled` once it was processed; a request
 * that failed or was cut off is released so the sender can retry the same
 * delivery. The table is capped per profile: a full table evicts its oldest
 * settled entry and, when every entry is active, refuses the new delivery.
 */
export class DeliveryReplayCache {
  private readonly profiles = new Map<string, Map<string, { expiresAt: number; settled: boolean }>>();
  private readonly ttlMs: number;
  private readonly maxPerProfile: number;
  private readonly now: () => number;

  constructor(options: ReplayOptions = {}) {
    this.ttlMs = options.ttlMs ?? REPLAY_WINDOW_MS;
    this.maxPerProfile = options.maxPerProfile ?? REPLAY_MAX_PER_PROFILE;
    this.now = options.now ?? Date.now;
  }

  claim(profileId: string, deliveryId: string): boolean {
    const now = this.now();
    let entries = this.profiles.get(profileId);
    if (!entries) {
      entries = new Map();
      this.profiles.set(profileId, entries);
    }
    for (const [id, entry] of entries) {
      if (entry.expiresAt > now) break;
      entries.delete(id);
    }
    const existing = entries.get(deliveryId);
    if (existing && existing.expiresAt > now) return false;
    if (entries.size >= this.maxPerProfile) {
      const oldestSettled = [...entries].find(([, entry]) => entry.settled);
      if (!oldestSettled) return false;
      entries.delete(oldestSettled[0]);
    }
    entries.delete(deliveryId);
    entries.set(deliveryId, { expiresAt: now + this.ttlMs, settled: false });
    return true;
  }

  settle(profileId: string, deliveryId: string): void {
    const entry = this.profiles.get(profileId)?.get(deliveryId);
    if (entry) entry.settled = true;
  }

  release(profileId: string, deliveryId: string): void {
    this.profiles.get(profileId)?.delete(deliveryId);
  }

  size(profileId: string): number {
    return this.profiles.get(profileId)?.size ?? 0;
  }
}

/** Outcomes of an authenticated request that count as processed; anything else lets the sender retry the delivery. */
const processedStatus = (status: number): boolean => (status >= 200 && status < 300) || status === 400 || status === 403;

export interface IngressGateProfile {
  id: string;
  enabled: boolean;
  secretReference: string;
}

export interface IngressGateOptions<P extends IngressGateProfile> {
  domain: string;
  profiles: ReadonlyMap<string, P>;
  binding(profile: P): string;
  secret(reference: string): Promise<string>;
  maxBodyBytes: number;
  maxActive: number;
  unknownProfileStatus: 403 | 404;
  env?: () => NodeJS.ProcessEnv;
  replay?: DeliveryReplayCache;
}

function refuse(res: express.Response, status: number): void {
  res.setHeader("Connection", "close");
  res.sendStatus(status);
}

/**
 * Everything that can be decided from the headers is decided here, in this
 * order, before the body is read: profile known and enabled, header shapes and
 * timestamp window, the pre-auth signature, the declared length against the
 * cap, and only then the in-flight slot. The buffered size is capped by the
 * length the verified signature covers. The slot and the 10 s body deadline
 * are released and cleared however the request ends.
 */
export function createIngressGate<P extends IngressGateProfile>(options: IngressGateOptions<P>): express.RequestHandler {
  let active = 0;
  const environment = options.env ?? (() => process.env);
  const replay = options.replay ?? new DeliveryReplayCache();

  const admit = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
    limit: number,
    claimed?: { profileId: string; deliveryId: string },
  ): void => {
    if (active >= options.maxActive) {
      if (claimed) replay.release(claimed.profileId, claimed.deliveryId);
      refuse(res, 429);
      return;
    }
    active += 1;
    let released = false;
    const release = (completed: boolean): void => {
      if (released) return;
      released = true;
      active -= 1;
      if (!claimed) return;
      if (completed && processedStatus(res.statusCode)) replay.settle(claimed.profileId, claimed.deliveryId);
      else replay.release(claimed.profileId, claimed.deliveryId);
    };
    res.once("finish", () => release(true));
    res.once("close", () => release(false));
    const bodyDeadline = setTimeout(() => req.destroy(), BODY_DEADLINE_MS);
    bodyDeadline.unref();
    req.once("end", () => clearTimeout(bodyDeadline));
    req.once("close", () => clearTimeout(bodyDeadline));
    req.setTimeout(BODY_DEADLINE_MS, () => req.destroy());
    express.raw({ type: "application/json", limit, inflate: false })(req, res, next);
  };

  async function run(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
    const profile = options.profiles.get(String(req.params.profileId));
    if (!profile) {
      refuse(res, options.unknownProfileStatus);
      return;
    }
    if (!profile.enabled) {
      refuse(res, 403);
      return;
    }
    const timestamp = req.get("x-lumin-timestamp");
    const delivery = req.get("x-lumin-delivery");
    const signature = req.get("x-lumin-signature");
    if (
      !timestamp ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300_000 ||
      !delivery ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(delivery) ||
      !signature ||
      !SIGNATURE_SHAPE.test(signature)
    ) {
      refuse(res, 401);
      return;
    }

    const preauth = req.get(INGRESS_PREAUTH_HEADER);
    if (preauth === undefined) {
      if (!legacyBodySignatureAllowed(environment())) {
        refuse(res, 401);
        return;
      }
      admit(req, res, next, options.maxBodyBytes);
      return;
    }

    const declared = req.headers["content-length"];
    if (typeof declared !== "string") {
      refuse(res, 411);
      return;
    }
    if (!/^[1-9]\d{0,9}$/.test(declared)) {
      refuse(res, 400);
      return;
    }
    const length = Number(declared);
    if (length > options.maxBodyBytes) {
      refuse(res, 413);
      return;
    }
    if (!SIGNATURE_SHAPE.test(preauth)) {
      refuse(res, 401);
      return;
    }
    const key = await options.secret(profile.secretReference);
    if (!/^[a-f0-9]{64}$/i.test(key)) {
      refuse(res, 403);
      return;
    }
    const expected = ingressPreauthSignature(options.domain, profile.id, options.binding(profile), timestamp, delivery, length, key);
    if (!timingSafeEqual(Buffer.from(preauth), Buffer.from(expected))) {
      refuse(res, 401);
      return;
    }
    if (!replay.claim(profile.id, delivery)) {
      refuse(res, 409);
      return;
    }
    admit(req, res, next, length, { profileId: profile.id, deliveryId: delivery });
  }

  return (req, res, next) => {
    run(req, res, next).catch(() => {
      if (!res.headersSent) refuse(res, 503);
    });
  };
}
