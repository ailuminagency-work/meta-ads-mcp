import { z } from "zod";
import { hashToken, requestContext } from "../auth/token-store.js";
import { platformEnabled } from "../platform/runtime.js";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { resolveMetaApiVersion } from "./api-version.js";
import { LEAD_FORM_DEFAULT_FIELDS, type LeadForm } from "./types/lead.js";
import { RateLimiter } from "./rate-limiter.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { metaAppSecretProof } from "./client.js";
import { classifyMetaError } from "./errors.js";
import type { MetaApiError } from "./types/common.js";

const rateLimiter = new RateLimiter();
const circuitBreaker = new CircuitBreaker();
const formSchema = z.object({
  id: z.string().regex(/^\d+$/).optional(), name: z.string().optional(), status: z.string().optional(),
  leads_count: z.number().nonnegative().optional(), locale: z.string().optional(), created_time: z.string().optional(),
  questions: z.array(z.object({ key: z.string().optional(), label: z.string().optional(), type: z.string().optional() })).optional(),
  privacy_policy: z.object({ url: z.string().optional(), link_text: z.string().optional() }).optional(),
  follow_up_action_url: z.string().optional(),
});

class PageReadError extends Error {}

export async function readPageLeadForms(pageId: string, limit: number, fields: string[]): Promise<{ data: LeadForm[] }> {
  if (platformEnabled()) throw new PageReadError("PAGE_READ_PLATFORM_CONNECTION_REQUIRED");
  const context = requestContext.getStore();
  if (!context?.fbUserId || !context.accessToken) throw new PageReadError("PAGE_READ_AUTHENTICATED_OPERATOR_REQUIRED");
  if (!/^\d+$/.test(pageId) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !fields.length || fields.some(field => !(LEAD_FORM_DEFAULT_FIELDS as readonly string[]).includes(field))) {
    throw new PageReadError("PAGE_READ_INVALID_INPUT");
  }
  const signal = AbortSignal.timeout(30_000);
  try {
    const version = resolveMetaApiVersion();
    const read = async (path: string, token: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
      const scope = { tokenHash: hashToken(token), type: "page_lead_read" };
      circuitBreaker.assertClosed(scope);
      if (rateLimiter.getThrottleDelay(scope) > 0) throw new PageReadError("PAGE_READ_THROTTLED");
      const url = new URL(`https://graph.facebook.com/${version}/${path}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const proof = metaAppSecretProof(token);
      if (proof) url.searchParams.set("appsecret_proof", proof);
      const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal });
      rateLimiter.updateFromHeaders(response.headers, scope);
      const retry = response.headers.get("retry-after");
      const retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
      if (Number.isFinite(retryMs) && retryMs > 0) rateLimiter.markRetryAfter(scope, scope.type, retryMs);
      if (response.status === 429) rateLimiter.markRetryAfter(scope, scope.type, Number.isFinite(retryMs) && retryMs > 0 ? retryMs : 60_000);
      const body = JSON.parse(await readBodyWithLimit(response, 1024 * 1024)) as Record<string, unknown>;
      if (!response.ok || body.error) {
        if (body.error && typeof body.error === "object") {
          const classification = classifyMetaError(body.error as MetaApiError);
          if (classification.throttled) {
            rateLimiter.markRetryAfter(scope, scope.type, classification.retryAfterMs ?? 60_000);
            circuitBreaker.trip(scope, classification);
          }
        }
        const code = (body.error as { code?: number } | undefined)?.code;
        throw new PageReadError(code === 190 ? "PAGE_READ_TOKEN_REJECTED" : code === 10 || code === 200 ? "PAGE_READ_PERMISSION_DENIED" : "PAGE_READ_PROVIDER_REJECTED");
      }
      return body;
    };
    const page = await read(pageId, context.accessToken, { fields: "id,access_token" });
    if (page.id !== pageId || typeof page.access_token !== "string" || !page.access_token || /\s/.test(page.access_token)) {
      throw new PageReadError("PAGE_READ_PAGE_TOKEN_UNAVAILABLE");
    }
    const identity = await read("me", page.access_token, { fields: "id" });
    if (identity.id !== pageId) throw new PageReadError("PAGE_READ_IDENTITY_MISMATCH");
    const result = await read(`${pageId}/leadgen_forms`, page.access_token, { fields: fields.join(","), limit: String(limit) });
    if (!Array.isArray(result.data)) throw new PageReadError("PAGE_READ_INVALID_RESPONSE");
    // Paging URLs and unrequested fields can contain credentials; never return them.
    const data = result.data.map((row: unknown) => {
      const safe = formSchema.parse(row);
      return Object.fromEntries(fields.filter(field => Object.hasOwn(safe, field)).map(field => [field, safe[field as keyof typeof safe]])) as unknown as LeadForm;
    });
    const serialized = JSON.stringify(data);
    if (serialized.includes(page.access_token) || serialized.includes(context.accessToken) || /EAA[A-Za-z0-9]{20,}|access_token=/i.test(serialized)) throw new PageReadError("PAGE_READ_UNSAFE_RESPONSE");
    return { data };
  } catch (error) {
    if (error instanceof PageReadError) throw error;
    throw new PageReadError(signal.aborted ? "PAGE_READ_TIMEOUT" : "PAGE_READ_UNAVAILABLE");
  }
}
