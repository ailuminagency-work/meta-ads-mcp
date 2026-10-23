export type MetaAuthFailure = "configuration" | "provider" | "unavailable" | "invalid-response";

export class MetaOAuthRequestError extends Error {
  constructor(readonly stage: string, readonly kind: MetaAuthFailure, readonly providerCode?: number) {
    super(`Meta authentication failed (${stage}: ${kind})`);
    this.name = "MetaOAuthRequestError";
  }
}

export async function requestMetaAuth(url: URL, stage: string): Promise<Record<string, unknown>> {
  let response: Response;
  let body: unknown;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Authorization codes are single-use: never automatically retry an exchange.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new MetaOAuthRequestError(stage, "unavailable"));
      }, 15_000);
    });
    [response, body] = await Promise.race([
      (async (): Promise<[Response, unknown]> => {
        const reply = await fetch(url.toString(), {signal: controller.signal, redirect: "error"});
        return [reply, await reply.json()];
      })(),
      deadline,
    ]);
  } catch {
    throw new MetaOAuthRequestError(stage, "unavailable");
  } finally {
    clearTimeout(timer);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MetaOAuthRequestError(stage, "invalid-response");
  }
  const result = body as Record<string, unknown>;
  if (!response.ok || result.error) {
    const error = result.error && typeof result.error === "object" ? result.error as Record<string, unknown> : {};
    const message = typeof error.message === "string" ? error.message : "";
    const configuration = /client secret|app(?:lication)? secret/i.test(message);
    throw new MetaOAuthRequestError(stage, configuration ? "configuration" : response.status >= 500 || response.status === 429 ? "unavailable" : "provider", typeof error.code === "number" ? error.code : undefined);
  }
  return result;
}

export function requireMetaAccessToken(body: Record<string, unknown>, stage: string): string {
  if (typeof body.access_token !== "string" || !body.access_token.trim() || /\s/.test(body.access_token)) {
    throw new MetaOAuthRequestError(stage, "invalid-response");
  }
  if (body.expires_in !== undefined && (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0)) {
    throw new MetaOAuthRequestError(stage, "invalid-response");
  }
  return body.access_token;
}
