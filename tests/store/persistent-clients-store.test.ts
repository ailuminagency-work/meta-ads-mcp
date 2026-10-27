import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createFirestoreDouble, type FirestoreDouble } from "./firestore-double.js";

const selected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => selected.db,
  isFirestoreEnabled: () => true,
}));

import {
  FirestoreClientsStore,
  InMemoryClientsStore,
} from "../../src/store/persistent-clients-store.js";
import { InvalidRedirectUriError } from "../../src/auth/client-registration-policy.js";

const uuidFor = (name: string): string => {
  const h = createHash("sha256").update(name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

function client(id: string, redirectUris: string[]): OAuthClientInformationFull {
  return {
    client_id: id,
    client_name: "Synthetic client",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: 1,
  };
}

let double: FirestoreDouble;

beforeEach(() => {
  double = createFirestoreDouble();
  selected.db = double.db;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const stores = [
  ["FirestoreClientsStore", () => new FirestoreClientsStore()],
  ["InMemoryClientsStore", () => new InMemoryClientsStore()],
] as const;

describe.each(stores)("%s redirect policy", (_name, create) => {
  it("rejects a client that registers an attacker redirect and does not store it", async () => {
    const store = create();
    const attacker = client(uuidFor("attacker-client"), ["https://evil.example/cb"]);

    const failure = await store.registerClient!(attacker).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidRedirectUriError);
    expect(failure).toBeInstanceOf(OAuthError);
    expect((failure as InvalidRedirectUriError).errorCode).toBe("invalid_redirect_uri");
    expect(await store.getClient(uuidFor("attacker-client"))).toBeUndefined();
    expect([...double.data.keys()].some((path) => path.includes(uuidFor("attacker-client")))).toBe(false);
  });

  it("rejects the whole registration when one of several redirects is hostile", async () => {
    const store = create();
    await expect(
      store.registerClient!(
        client(uuidFor("mixed"), ["https://claude.ai/api/mcp/auth_callback", "http://evil.example/cb"]),
      ),
    ).rejects.toBeInstanceOf(InvalidRedirectUriError);
    expect(await store.getClient(uuidFor("mixed"))).toBeUndefined();
  });

  it("rejects registrations with no redirect URI at all", async () => {
    const store = create();
    await expect(store.registerClient!(client(uuidFor("empty"), []))).rejects.toBeInstanceOf(InvalidRedirectUriError);
  });

  it("registers and returns a client with allowlisted redirects", async () => {
    const store = create();
    const legitimate = client(uuidFor("claude-client"), ["https://claude.ai/api/mcp/auth_callback"]);
    expect(await store.registerClient!(legitimate)).toEqual(legitimate);
    expect(await store.getClient(uuidFor("claude-client"))).toMatchObject({
      client_id: uuidFor("claude-client"),
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
  });

  it("honours operator-added redirect hosts", async () => {
    const store = create();
    const custom = client(uuidFor("custom-host"), ["https://tools.agency.example/oauth/callback"]);
    await expect(store.registerClient!(custom)).rejects.toBeInstanceOf(InvalidRedirectUriError);

    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "tools.agency.example");
    await expect(store.registerClient!(custom)).resolves.toMatchObject({ client_id: uuidFor("custom-host") });
  });
});

describe("clients registered before the policy existed", () => {
  it("FirestoreClientsStore treats a stored client with a hostile redirect as unknown", async () => {
    double.data.set(`mcp_clients/${uuidFor("legacy-evil")}`, {
      ...client(uuidFor("legacy-evil"), ["https://evil.example/cb"]),
      registered_at: 1,
    });
    double.data.set(`mcp_clients/${uuidFor("legacy-good")}`, {
      ...client(uuidFor("legacy-good"), ["https://claude.ai/api/mcp/auth_callback"]),
      registered_at: 1,
    });
    double.data.set(`mcp_clients/${uuidFor("legacy-custom-gpt")}`, {
      ...client(uuidFor("legacy-custom-gpt"), ["https://chatgpt.com/aip/g-SYNTHETIC-GPT/oauth/callback"]),
      registered_at: 1,
    });
    const store = new FirestoreClientsStore();

    expect(await store.getClient(uuidFor("legacy-evil"))).toBeUndefined();
    expect(await store.getClient(uuidFor("legacy-custom-gpt"))).toBeUndefined();
    expect(await store.getClient(uuidFor("legacy-good"))).toMatchObject({ client_id: uuidFor("legacy-good") });
  });

  it("InMemoryClientsStore stops serving a client whose redirect host is no longer allowed", async () => {
    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "tools.agency.example");
    const store = new InMemoryClientsStore();
    await store.registerClient!(client(uuidFor("temporary"), ["https://tools.agency.example/cb"]));
    expect(await store.getClient(uuidFor("temporary"))).toBeDefined();

    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "");
    expect(await store.getClient(uuidFor("temporary"))).toBeUndefined();
  });
});

describe.each(stores)("%s client name", (_name, create) => {
  it("keeps a long client name to 100 characters, stored and returned", async () => {
    const store = create();
    const submitted = { ...client(uuidFor("long-name"), ["http://127.0.0.1:38123/cb"]), client_name: "N".repeat(90_000) };

    const registered = await store.registerClient!(submitted);

    expect(Array.from(registered.client_name ?? "")).toHaveLength(100);
    expect(Array.from((await store.getClient(uuidFor("long-name")))?.client_name ?? "")).toHaveLength(100);
    expect(submitted.client_name).toHaveLength(90_000);
  });

  it("does not split a character when it cuts", async () => {
    const store = create();
    const registered = await store.registerClient!({
      ...client(uuidFor("emoji-name"), ["http://127.0.0.1:38123/cb"]),
      client_name: "\u{1F600}".repeat(150),
    });

    expect(Array.from(registered.client_name ?? "")).toHaveLength(100);
    expect(registered.client_name).not.toMatch(/[\ud800-\udbff]$/);
  });

  it("leaves a short or missing name alone", async () => {
    const store = create();
    expect((await store.registerClient!(client(uuidFor("short-name"), ["http://127.0.0.1:38123/cb"]))).client_name).toBe(
      "Synthetic client",
    );
    const nameless = { ...client(uuidFor("no-name"), ["http://127.0.0.1:38123/cb"]) } as Partial<OAuthClientInformationFull>;
    delete nameless.client_name;
    expect((await store.registerClient!(nameless as OAuthClientInformationFull)).client_name).toBeUndefined();
  });
});
