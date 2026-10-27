import { currencyOffset, fromMinorUnits } from "../meta/currency.js";

/**
 * Normalize a Meta ad account ID to always include the 'act_' prefix.
 *
 * Validates that the id is purely numeric (optionally with the act_ prefix)
 * before normalizing. Rejects anything containing path-traversal characters,
 * URL components, or whitespace so it can't be smuggled into the path of a
 * subsequent fetch to Meta. CODE-A5 audit finding.
 */
export function normalizeAccountId(id: string): string {
  if (typeof id !== "string" || !/^(act_)?\d{1,30}$/.test(id)) {
    throw new Error(
      `Invalid Meta account_id: must be numeric, optionally prefixed with "act_". Got: ${JSON.stringify(id).slice(0, 80)}`,
    );
  }
  return id.startsWith("act_") ? id : `act_${id}`;
}

/**
 * Validate a Meta resource ID before it is interpolated into a Graph API
 * path. Accepts the three formats Meta uses for path segments:
 *   - Plain numeric id: `1234567890` (campaign, adset, ad, creative, page,
 *     business, audience, rule, pixel, study, lead form, video, user…).
 *   - Ad account id: `act_1234567890` (insights/reports `object_id`).
 *   - Post or comment id: `1234567890_9876543210` — Meta's
 *     `effective_object_story_id` and per-page comment ids embed the page
 *     id and the post/comment id separated by an underscore.
 *
 * Reject anything else so a crafted id can't smuggle path traversal,
 * query strings, or whitespace into the URL of a subsequent fetch.
 *
 * Use at the boundary of any tool that takes an id from a caller and
 * forwards it into a Meta API path or a rate-limiter bucket key. Throws
 * with a clear error so the agent can report a meaningful failure rather
 * than letting a malformed id leak into a path segment or bucket name.
 */
export function validateMetaId(id: string, kind = "id"): string {
  if (typeof id !== "string" || !/^(act_\d{1,30}|\d{1,30}(_\d{1,30})?)$/.test(id)) {
    throw new Error(
      `Invalid Meta ${kind}: must be numeric, "act_<numeric>" (account), or "<numeric>_<numeric>" (post/comment) — the three formats are mutually exclusive. Got: ${JSON.stringify(id).slice(0, 80)}`,
    );
  }
  return id;
}

/**
 * Format a Meta amount (the ad account currency's minor units) for display.
 * The currency must be the account's own; when it is missing or has no
 * recorded offset the raw minor units are shown and labelled, never scaled
 * as if they were USD cents.
 */
export function formatBudget(
  minorUnits: number | string,
  currency?: string,
): string {
  const raw = typeof minorUnits === "string" ? minorUnits.trim() : minorUnits;
  if (typeof raw === "number" ? !Number.isSafeInteger(raw) : !/^-?\d{1,18}$/.test(raw)) {
    return `${String(minorUnits)} (unreadable amount)`;
  }
  if (currencyOffset(currency) === undefined) {
    return `${raw} (minor units; ${currency ? `offset for ${currency} unknown` : "currency unknown"})`;
  }
  return `${fromMinorUnits(raw, currency as string)} ${currency}`;
}

/**
 * Truncate a string if it exceeds maxLength, appending a note.
 */
export function truncateResponse(
  text: string,
  maxLength = 50000,
): string {
  if (text.length <= maxLength) return text;
  return (
    text.slice(0, maxLength) +
    "\n\n... [Response truncated. Use more specific filters or narrower date ranges to reduce data.]"
  );
}
