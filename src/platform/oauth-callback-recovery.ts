/**
 * Human-safe callback recovery. These are alternative legitimate operator
 * actions, never alternate credentials or routes around Meta consent.
 *
 * No raw query values, OAuth codes, state, cookies, tokens or provider errors
 * may be embedded in the result. All advice is static and tied to a bounded
 * internal classification.
 */
export const CALLBACK_RECOVERY = {
  SESSION_REQUIRED: {
    title: "Lumin sign-in expired",
    explanation: "Your Lumin operator session is no longer available. Sign in again before making a new connection.",
    action: "Sign in and restart Connect Meta",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  PROVIDER_CONSENT_DENIED: {
    title: "Meta permission was not approved",
    explanation: "Meta did not grant the requested access. An authorized account owner can restart the connection and approve only the intended permissions.",
    action: "Review and restart Meta consent",
    actionPath: "/platform/connections/",
    actor: "account_owner",
  },
  PROVIDER_AUTHORIZATION_ERROR: {
    title: "Meta could not complete authorization",
    explanation: "Meta returned an authorization failure instead of a usable code. Start a fresh connection; if Meta requires verification, complete it there.",
    action: "Start a fresh authorization",
    actionPath: "/platform/connections/",
    actor: "account_owner",
  },
  CALLBACK_PROFILE_INVALID: {
    title: "Connection profile was not recognized",
    explanation: "Do not use an edited or old callback link. Return to the official Lumin connection page to select a supported profile.",
    action: "Return to connection selection",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_STATE_MISSING: {
    title: "Authorization session identifier is missing",
    explanation: "This callback cannot be trusted without its original state. Start again from Lumin; never paste or reuse the old callback URL.",
    action: "Create a fresh signed connection",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_STATE_INVALID: {
    title: "Authorization session identifier is invalid",
    explanation: "Lumin rejected an invalid or altered OAuth state. The old callback must not be resumed.",
    action: "Restart from the official Lumin page",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_STATE_DUPLICATED: {
    title: "Duplicate authorization state",
    explanation: "The callback contains ambiguous state parameters. For safety, Lumin cannot select one.",
    action: "Start a new connection",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_CODE_MISSING: {
    title: "Meta did not provide an authorization code",
    explanation: "The connection cannot complete without a new single-use authorization code from Meta.",
    action: "Begin fresh Meta authorization",
    actionPath: "/platform/connections/",
    actor: "account_owner",
  },
  CALLBACK_CODE_INVALID: {
    title: "Authorization code was rejected before exchange",
    explanation: "The code is malformed or outside the supported limits. Do not reuse or copy an old code.",
    action: "Begin a new authorized connection",
    actionPath: "/platform/connections/",
    actor: "account_owner",
  },
  CALLBACK_CODE_DUPLICATED: {
    title: "Duplicate authorization codes",
    explanation: "The callback contained multiple code parameters. Lumin will not guess which code is valid.",
    action: "Restart securely",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_AMBIGUOUS_RESULT: {
    title: "Meta authorization result is inconsistent",
    explanation: "A callback cannot both report an error and supply a successful code. Lumin will reject the ambiguous response.",
    action: "Restart from Lumin",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_QUERY_INVALID: {
    title: "Meta callback parameters need attention",
    explanation: "The received callback does not match the approved response format. Restart once; continued failures need a provider compatibility review.",
    action: "Restart the connection",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_COOKIE_MISSING: {
    title: "Browser connection session is missing",
    explanation: "This browser no longer holds the short-lived session that started the connection. Use the same browser and a new Lumin connection request.",
    action: "Return and start a new browser session",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_COOKIE_INVALID: {
    title: "Browser connection session is invalid",
    explanation: "The browser session is damaged or does not match the expected format. Lumin will not accept or reconstruct it.",
    action: "Create a new connection request",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CALLBACK_NONCE_INVALID: {
    title: "Browser connection nonce is invalid",
    explanation: "The session proof is malformed or missing. A fresh signed connection is required.",
    action: "Restart securely",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  CONNECTION_CHALLENGE_INVALID: {
    title: "Connection expired or was already used",
    explanation: "The one-use Meta connection challenge is expired, replayed or inconsistent. Do not reuse an old callback.",
    action: "Start a fresh signed authorization",
    actionPath: "/platform/connections/",
    actor: "operator",
  },
  AUTHORIZATION_SCOPE_REVIEW: {
    title: "Meta permissions require administrator review",
    explanation: "The returned credential does not match Lumin's reviewed permission profile. Lumin will not silently accept additional management powers.",
    action: "Return to connection management",
    actionPath: "/platform/connections/",
    actor: "engineer",
  },
  AUTHORIZATION_ASSET_REVIEW: {
    title: "Client or business access needs review",
    explanation: "Verify your account ownership and explicit client asset grants. Lumin cannot switch to another identity to work around a denial.",
    action: "Return to connection management",
    actionPath: "/platform/connections/",
    actor: "agency_operator",
  },
  PROVIDER_RESPONSE_REVIEW: {
    title: "Provider response needs investigation",
    explanation: "The expected Meta token or permission response contract was not met. Repeated consent attempts may not help; request technical review.",
    action: "Return to connection management",
    actionPath: "/platform/connections/",
    actor: "engineer",
  },
  CALLBACK_SERVICE_REVIEW: {
    title: "Connection needs technical review",
    explanation: "Lumin could not securely finish this connection. No new access has been granted through this attempt.",
    action: "Return to connection management",
    actionPath: "/platform/connections/",
    actor: "engineer",
  },
} as const;

export type CallbackRecoveryCode = keyof typeof CALLBACK_RECOVERY;

const VALID_STATE = /^[a-f0-9]{64}$/;
const VALID_PROFILE = /^[A-Za-z0-9_-]{1,128}$/;

/** Use only structure and allowlisted Meta error identifiers, never raw text. */
export function classifyCallbackQuery(query:unknown, profileId:string):CallbackRecoveryCode|null {
  if (!VALID_PROFILE.test(profileId)) return "CALLBACK_PROFILE_INVALID";
  if (!query || typeof query !== "object" || Array.isArray(query)) return "CALLBACK_QUERY_INVALID";
  const q=query as Record<string,unknown>;
  const has=(key:string)=>Object.hasOwn(q,key);
  if (has("error")) {
    if (has("code") || Array.isArray(q.error)) return "CALLBACK_AMBIGUOUS_RESULT";
    return q.error === "access_denied" ? "PROVIDER_CONSENT_DENIED" : "PROVIDER_AUTHORIZATION_ERROR";
  }
  if (!has("state")) return "CALLBACK_STATE_MISSING";
  if (Array.isArray(q.state)) return "CALLBACK_STATE_DUPLICATED";
  if (typeof q.state !== "string" || !VALID_STATE.test(q.state)) return "CALLBACK_STATE_INVALID";
  if (!has("code")) return "CALLBACK_CODE_MISSING";
  if (Array.isArray(q.code)) return "CALLBACK_CODE_DUPLICATED";
  if (typeof q.code !== "string" || !q.code.length || q.code.length > 4096) return "CALLBACK_CODE_INVALID";
  if (Object.keys(q).some(key=>key!=="code"&&key!=="state")) return "CALLBACK_QUERY_INVALID";
  return null;
}

/** The callback router alone decides whether a service exception is trusted. */
export function classifyCallbackServiceFailure(verifiedReason:string):CallbackRecoveryCode {
  if (verifiedReason==="CONNECTION_CHALLENGE_EXPIRED_REPLAYED_OR_MISMATCHED" ||
      verifiedReason==="CONNECTION_CHALLENGE_MISSING" ||
      verifiedReason==="INVALID_CONNECTION_CHALLENGE_LOOKUP") return "CONNECTION_CHALLENGE_INVALID";
  if (verifiedReason==="FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED" ||
      verifiedReason==="FACEBOOK_ACTUAL_GRANTED_PERMISSIONS_REQUIRED" ||
      verifiedReason==="FACEBOOK_INCREMENTAL_SCOPE_PROFILE_REQUIRED") return "AUTHORIZATION_SCOPE_REVIEW";
  if (verifiedReason==="REGISTERED_CLIENT_ROOTS_REQUIRED" ||
      verifiedReason==="CLIENT_CONNECTION_ADMIN_REQUIRED" ||
      verifiedReason==="FACEBOOK_GRAPH_PERMISSION_DENIED") return "AUTHORIZATION_ASSET_REVIEW";
  if (verifiedReason.startsWith("FACEBOOK_OAUTH_") &&
      (verifiedReason.endsWith("_RESPONSE_INVALID") ||
        verifiedReason==="FACEBOOK_OAUTH_RESPONSE_SCHEMA_INVALID")) return "PROVIDER_RESPONSE_REVIEW";
  return "CALLBACK_SERVICE_REVIEW";
}

/** No interpolation of untrusted values into user-facing HTML. */
export function renderCallbackRecoveryHtml(code:CallbackRecoveryCode):string {
  const action=CALLBACK_RECOVERY[code];
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Lumin connection needs attention</title></head>"+
    "<body><main><h1>"+action.title+"</h1><p>"+action.explanation+"</p>"+
    "<p><a href=\""+action.actionPath+"\">"+action.action+"</a></p>"+
    "<p>Do not copy authorization links, session cookies or access tokens into support messages.</p></main></body></html>";
}
