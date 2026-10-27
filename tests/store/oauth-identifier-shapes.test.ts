import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createFirestoreDouble, type FirestoreDouble } from "./firestore-double.js";

const selected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => selected.db,
  isFirestoreEnabled: () => true,
}));

import { FirestoreAuthCodesStore, type AuthCodeEntry } from "../../src/store/persistent-auth-codes.js";
import { FirestoreClientsStore } from "../../src/store/persistent-clients-store.js";

let double: FirestoreDouble;

beforeEach(() => {
  double = createFirestoreDouble();
  selected.db = double.db;
});

const HOSTILE_IDS = [
  "a/b/c",
  "a/b",
  "..",
  ".",
  "../mcp_clients/victim",
  "mcp_auth_codes/../mcp_clients/x",
  "__x__",
  "__name__",
  "",
  " ",
  "a b",
  "a\u0000b",
  "%2e%2e",
  "x".repeat(2000),
];

function entry(overrides: Partial<AuthCodeEntry> = {}): AuthCodeEntry {
  return {
    clientId: randomUUID(),
    codeChallenge: "c".repeat(43),
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    fbUserId: "100000000000001",
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

function client(id: string): OAuthClientInformationFull {
  return {
    client_id: id,
    client_name: "Synthetic client",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: 1,
  };
}

describe("FirestoreAuthCodesStore only addresses documents for codes this server could have issued", () => {
  const WRONG_SHAPES = [
    ...HOSTILE_IDS,
    "g".repeat(64),
    "A".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
    `${"a".repeat(62)}/b`,
  ];

  it.each(WRONG_SHAPES.map((id) => [JSON.stringify(id.slice(0, 40)), id]))(
    "treats %s as unknown on get, consume and delete without touching Firestore",
    async (_label, code) => {
      const store = new FirestoreAuthCodesStore();
      expect(await store.get(code)).toBeUndefined();
      expect(await store.consume(code)).toBeUndefined();
      await expect(store.delete(code)).resolves.toBeUndefined();
      expect(double.touched).toEqual([]);
    },
  );

  it.each(WRONG_SHAPES.map((id) => [JSON.stringify(id.slice(0, 40)), id]))(
    "refuses to store a code shaped like %s",
    async (_label, code) => {
      await expect(new FirestoreAuthCodesStore().set(code, entry())).rejects.toThrow(/authorization code/);
      expect(double.touched).toEqual([]);
      expect(double.data.size).toBe(0);
    },
  );

  it("still stores, reads and consumes a code of the shape the server issues", async () => {
    const store = new FirestoreAuthCodesStore();
    const code = randomBytes(32).toString("hex");
    await store.set(code, entry());
    expect(await store.get(code)).toMatchObject({ fbUserId: "100000000000001" });
    expect(await store.consume(code)).toMatchObject({ fbUserId: "100000000000001" });
    expect(await store.consume(code)).toBeUndefined();
  });
});

describe("FirestoreClientsStore only addresses documents for client ids registration issues", () => {
  const WRONG_SHAPES = [
    ...HOSTILE_IDS,
    "test-client",
    randomUUID().toUpperCase(),
    randomUUID().replace(/-/g, ""),
    `${randomUUID()}/x`,
    `${randomUUID()}x`,
  ];

  it.each(WRONG_SHAPES.map((id) => [JSON.stringify(id.slice(0, 40)), id]))(
    "treats %s as an unknown client without touching Firestore",
    async (_label, id) => {
      expect(await new FirestoreClientsStore().getClient(id)).toBeUndefined();
      expect(double.touched).toEqual([]);
    },
  );

  it.each(WRONG_SHAPES.map((id) => [JSON.stringify(id.slice(0, 40)), id]))(
    "refuses to register a client id shaped like %s",
    async (_label, id) => {
      await expect(new FirestoreClientsStore().registerClient!(client(id))).rejects.toThrow(/client_id/);
      expect(double.touched).toEqual([]);
      expect(double.data.size).toBe(0);
    },
  );

  it("still registers and reads a client whose id is a UUID", async () => {
    const store = new FirestoreClientsStore();
    const id = randomUUID();
    await store.registerClient!(client(id));
    expect(await store.getClient(id)).toMatchObject({ client_id: id });
  });
});
