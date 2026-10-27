import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { getFirestore } from "./firestore.js";
import { clientExpireTime, clientNeedsExtension, withoutExpireTime } from "./retention.js";
import { logger } from "../utils/logger.js";
import {
  assertRegistrableRedirectUris,
  boundedClientName,
  checkRedirectUris,
} from "../auth/client-registration-policy.js";

const COLLECTION = "mcp_clients";

// Registration issues crypto.randomUUID(). Any other client_id, such as "a/b/c"
// or "..", is not one of ours and must not become a document path.
const CLIENT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isClientIdShape(clientId: unknown): clientId is string {
  return typeof clientId === "string" && CLIENT_ID_SHAPE.test(clientId);
}

// A client stored before the registration policy existed may still carry a
// redirect URI the policy now rejects. Treating it as unknown keeps such a
// client from receiving authorization codes.
function usableClient(
  client: OAuthClientInformationFull | undefined,
): OAuthClientInformationFull | undefined {
  if (!client) return undefined;
  const verdict = checkRedirectUris(client.redirect_uris);
  if (verdict.ok) return client;
  logger.warn(
    { clientId: client.client_id, reason: verdict.reason },
    "Ignoring OAuth client whose redirect URIs violate the registration policy",
  );
  return undefined;
}

function withBoundedName(client: OAuthClientInformationFull): OAuthClientInformationFull {
  const name = boundedClientName(client.client_name);
  return name === client.client_name ? client : { ...client, client_name: name };
}

/**
 * Stamp the registration timestamp on the doc so an operator can later
 * audit / clean up clients that haven't been used in N days (CODE-B8).
 * Stored alongside the original client info — the SDK ignores the
 * extra field on read.
 */
interface StoredClient extends OAuthClientInformationFull {
  registered_at?: number;
  expireTime?: Date;
}

export class FirestoreClientsStore implements OAuthRegisteredClientsStore {
  private get collection() {
    return getFirestore().collection(COLLECTION);
  }

  async getClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | undefined> {
    if (!isClientIdShape(clientId)) return undefined;
    const ref = this.collection.doc(clientId);
    const snap = await ref.get();
    if (!snap.exists) return undefined;
    const stored = snap.data() as StoredClient;
    const client = usableClient(withoutExpireTime(stored) as OAuthClientInformationFull);
    if (client && clientNeedsExtension(stored.expireTime)) {
      // update() fails on a missing document, so a client deleted since the
      // read is never resurrected as a stub. The deadline is bookkeeping:
      // failing to extend it must not fail the authentication in progress.
      try {
        await ref.update({ expireTime: clientExpireTime() });
      } catch {
        logger.warn({ clientId }, "Could not extend the retention deadline of an OAuth client");
      }
    }
    return client;
  }

  async registerClient(
    submitted: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    assertRegistrableRedirectUris(submitted.redirect_uris);
    if (!isClientIdShape(submitted.client_id)) throw new Error("Refusing to register a client_id of an unexpected shape");
    const client = withBoundedName(submitted);
    const stored: StoredClient = {
      ...client,
      registered_at: Math.floor(Date.now() / 1000),
      expireTime: clientExpireTime(),
    };
    await this.collection.doc(client.client_id).set(stored);
    logger.info(
      { clientId: client.client_id, clientName: client.client_name },
      "Registered OAuth client",
    );
    return client;
  }
}

export class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private static MAX = 100;
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | undefined> {
    return usableClient(this.clients.get(clientId));
  }

  async registerClient(
    submitted: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    assertRegistrableRedirectUris(submitted.redirect_uris);
    const client = withBoundedName(submitted);
    if (
      this.clients.size >= InMemoryClientsStore.MAX &&
      !this.clients.has(client.client_id)
    ) {
      throw new Error("Maximum number of registered clients reached");
    }
    this.clients.set(client.client_id, client);
    return client;
  }
}
