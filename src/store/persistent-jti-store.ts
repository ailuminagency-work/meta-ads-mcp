import {commitLegacyPersonalWrite} from "./legacy-privacy-write.js";
import { getFirestore } from "./firestore.js";

/**
 * Allow-list / revocation store for JWT IDs (jti). The model is "must
 * be present in the store to be valid": when issuing a token we record
 * its jti, and when verifying we check it. To revoke a token we simply
 * delete the jti — the next verification will fail.
 *
 * Each entry carries an absolute expiresAt (unix seconds) so we can
 * lazily skip expired records. A TTL index in Firestore (configured
 * out of band) reaps them; the in-memory impl evicts on read.
 */
export interface JtiEntry {
  expiresAt: number;
  /** Optional metadata: e.g. fb_user_id, client_id, kind. Never the secret. */
  meta?: Record<string, string | number | boolean | null>;
}

export interface ConsumeOptions {
  /**
   * Written in the same atomic step as the removal, and only when the removal
   * succeeds. Lets a caller tell "rotated a moment ago" from "never valid"
   * without a window between the two writes.
   */
  tombstone?: { id: string; entry: JtiEntry };
}

export interface JtiStore {
  put(jti: string, entry: JtiEntry): Promise<void>;
  /** Returns true if the jti exists and is not expired. */
  has(jti: string): Promise<boolean>;
  /** The stored entry, or undefined when it is missing or expired. */
  get(jti: string): Promise<JtiEntry | undefined>;
  /**
   * Atomically: returns true and removes the jti if it existed (and is
   * not expired); returns false otherwise. Used by refresh-token rotation
   * to avoid races where two concurrent exchanges both pass a non-atomic
   * has() check before either delete() lands.
   */
  consume(jti: string, options?: ConsumeOptions): Promise<boolean>;
  delete(jti: string): Promise<void>;
}

export class FirestoreJtiStore implements JtiStore {
  constructor(private readonly collectionName: string) {}

  private get collection() {
    return getFirestore().collection(this.collectionName);
  }

  async put(jti: string, entry: JtiEntry): Promise<void> {
    if(typeof entry.meta?.fbUserId==="string")await commitLegacyPersonalWrite(getFirestore(),entry.meta.fbUserId,this.collection.doc(jti),entry);else await this.collection.doc(jti).set(entry);
  }

  async has(jti: string): Promise<boolean> {
    const snap = await this.collection.doc(jti).get();
    if (!snap.exists) return false;
    const data = snap.data() as JtiEntry;
    if (data.expiresAt < Math.floor(Date.now() / 1000)) {
      // Lazy clean-up of expired records on read.
      await snap.ref.delete().catch(() => {});
      return false;
    }
    return true;
  }

  async get(jti: string): Promise<JtiEntry | undefined> {
    const snap = await this.collection.doc(jti).get();
    if (!snap.exists) return undefined;
    const data = snap.data() as JtiEntry;
    return data.expiresAt < Math.floor(Date.now() / 1000) ? undefined : data;
  }

  async consume(jti: string, options?: ConsumeOptions): Promise<boolean> {
    const ref = this.collection.doc(jti);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const data = snap.data() as JtiEntry;
      if (data.expiresAt < Math.floor(Date.now() / 1000)) {
        tx.delete(ref);
        return false;
      }
      tx.delete(ref);
      if (options?.tombstone) tx.set(this.collection.doc(options.tombstone.id), options.tombstone.entry);
      return true;
    });
  }

  async delete(jti: string): Promise<void> {
    await this.collection.doc(jti).delete();
  }
}

export class InMemoryJtiStore implements JtiStore {
  private map = new Map<string, JtiEntry>();

  async put(jti: string, entry: JtiEntry): Promise<void> {
    this.map.set(jti, entry);
  }

  async has(jti: string): Promise<boolean> {
    const entry = this.map.get(jti);
    if (!entry) return false;
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
      this.map.delete(jti);
      return false;
    }
    return true;
  }

  async get(jti: string): Promise<JtiEntry | undefined> {
    const entry = this.map.get(jti);
    if (!entry) return undefined;
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
      this.map.delete(jti);
      return undefined;
    }
    return entry;
  }

  async consume(jti: string, options?: ConsumeOptions): Promise<boolean> {
    // JS event loop is single-threaded so this is atomic by construction.
    const entry = this.map.get(jti);
    if (!entry) return false;
    this.map.delete(jti);
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) return false;
    if (options?.tombstone) this.map.set(options.tombstone.id, options.tombstone.entry);
    return true;
  }

  async delete(jti: string): Promise<void> {
    this.map.delete(jti);
  }
}
