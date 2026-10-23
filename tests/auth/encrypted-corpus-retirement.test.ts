import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import { encryptToken } from "../../src/auth/crypto.js";
import { ENCRYPTED_CORPUS_FAMILIES, inspectEncryptedCorpusForRetirement } from "../../src/auth/encrypted-corpus-retirement.js";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";

const ring: EncryptionKeyring = { activeKeyId: "next", keys: new Map([["old", Buffer.alloc(32, 1)], ["next", Buffer.alloc(32, 2)]]) };
const credential = { id: "credential", tenantId: "tenant", operatorId: "operator", provider: "META_MARKETING", appId: "300", envelopeVersion: 1, keyVersion: "primary" };
const credentialAad = JSON.stringify(["lumin-platform-credential", 1, credential.tenantId, credential.operatorId, credential.provider, credential.appId, credential.id]);
const pathFor = (id: string) => `platform_v1/${createHash("sha256").update(JSON.stringify(["tenants", credential.tenantId, credential.tenantId])).digest("hex")}/credentials/${createHash("sha256").update(JSON.stringify(["credentials", credential.tenantId, id])).digest("hex")}`;
const path = pathFor(credential.id);

function fakeDb(rows: Record<string, Record<string, unknown>>, brokenCollection?: string): Firestore {
  const snapshots = Object.entries(rows).map(([path, value]) => ({ ref: { path }, data: () => structuredClone(value) }));
  const get = (name: string) => ({ get: async () => {
    if (name === brokenCollection) throw new Error("synthetic permission denial");
    return { docs: snapshots.filter(row => row.ref.path.split("/").at(-2) === name) };
  } });
  return { collectionGroup: get, collection: get } as unknown as Firestore;
}

describe("encrypted corpus retirement gate", () => {
  it("covers legacy, platform and root encrypted families", () => {
    expect(ENCRYPTED_CORPUS_FAMILIES.map(f => f.collection)).toContain("credentials");
    expect(ENCRYPTED_CORPUS_FAMILIES.map(f => f.collection)).toContain("researchJobs");
    expect(ENCRYPTED_CORPUS_FAMILIES.map(f => f.collection)).toContain("platform_crm_sources");
    expect(ENCRYPTED_CORPUS_FAMILIES.length).toBeGreaterThan(20);
  });

  it("authenticates current credentials using nested crypto version, not outer schema primary", async () => {
    const row = { ...credential, payload: encryptToken("synthetic-token", credentialAad, ring) };
    const result = await inspectEncryptedCorpusForRetirement(fakeDb({ [path]: row }), ring);
    expect(result.verdict).toBe("PASS");
    expect(result.families.credentials.envelopes).toBe(1);
    expect(result.reasons.OLD_OR_UNKNOWN_KEY).toBe(0);
  });

  it("holds an old-key platform credential even when its outer version says primary", async () => {
    const oldRing = { ...ring, activeKeyId: "old" };
    const row = { ...credential, payload: encryptToken("synthetic-token", credentialAad, oldRing) };
    const result = await inspectEncryptedCorpusForRetirement(fakeDb({ [path]: row }), ring);
    expect(result.verdict).toBe("HOLD");
    expect(result.reasons.OLD_OR_UNKNOWN_KEY).toBe(1);
  });

  it("holds a copied credential whose Firestore path does not match its identity", async () => {
    const row = { ...credential, payload: encryptToken("synthetic-token", credentialAad, ring) };
    const result = await inspectEncryptedCorpusForRetirement(fakeDb({ [pathFor("different")]: row }), ring);
    expect(result.verdict).toBe("HOLD");
    expect(result.reasons.INVALID_PATH).toBe(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
  });

  it("holds malformed, omitted and unexpected envelopes", async () => {
    const result = await inspectEncryptedCorpusForRetirement(fakeDb({
      [path]: { ...credential, payload: { ciphertext: "bad" } },
      [pathFor("other")]: { ...credential, id: "other" },
      [pathFor("third")]: { ...credential, id: "third", payload: encryptToken("synthetic-token", JSON.stringify(["lumin-platform-credential", 1, credential.tenantId, credential.operatorId, credential.provider, credential.appId, "third"]), ring), extra: { ciphertext: "other", iv: "x", tag: "y" } },
    }), ring);
    expect(result.verdict).toBe("HOLD");
    expect(result.reasons.MISSING_OR_MALFORMED_PAYLOAD).toBe(2);
    expect(result.reasons.UNEXPECTED_ENCRYPTED_FIELD).toBe(1);
  });

  it("holds an opaque platform field and an incomplete collection scan", async () => {
    const rows = { "platform_v1/t/researchJobs/j": { encryptedRequest: encryptToken("synthetic", "unknown", ring) } };
    const result = await inspectEncryptedCorpusForRetirement(fakeDb(rows, "credentials"), ring);
    expect(result.verdict).toBe("HOLD");
    expect(result.reasons.UNVERIFIED_AAD).toBe(1);
    expect(result.reasons.INVENTORY_READ_FAILED).toBe(1);
  });
});
