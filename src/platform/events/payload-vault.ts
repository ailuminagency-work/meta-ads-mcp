import { createCipheriv, randomBytes, randomUUID } from "node:crypto";

export interface EncryptedPayloadBackend {
  put(reference: string, record: { ciphertext: string; nonce: string; tag: string; expiresAt: number; keyVersion: string }): Promise<void>;
}

export class EncryptedPayloadVault {
  constructor(private readonly backend: EncryptedPayloadBackend, private readonly key: Buffer, private readonly keyVersion: string) {
    if (key.length !== 32 || !keyVersion) throw new Error("invalid_payload_encryption_config");
  }
  async put(raw: Buffer, bindingDigest: string, expiresAt: number): Promise<{ reference: string; expiresAt: number }> {
    if (!/^[a-f0-9]{64}$/.test(bindingDigest) || raw.length > 256 * 1024 || !Number.isFinite(expiresAt)) throw new Error("invalid_payload_request");
    const reference = randomUUID(), nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`${reference}:${bindingDigest}:${expiresAt}:${this.keyVersion}`));
    const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
    await this.backend.put(reference, { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), expiresAt, keyVersion: this.keyVersion });
    return { reference, expiresAt };
  }
}
