import { PlatformDenied } from "./models.js";

const CREDENTIAL_SHAPE = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:access_token|refresh_token|client_secret|app_secret|authorization)\s*[:=]\s*\S{8,})/i;
const META_TOKEN_SHAPE = /EAA[A-Za-z0-9]{20,}/gi;

/** A hex digest that happens to contain "eaa" is not a Meta token; real tokens are base62 and always carry a non-hex letter. */
function looksLikeMetaToken(value: string): boolean {
  for (const match of value.matchAll(META_TOKEN_SHAPE)) {
    if (/[G-Zg-z]/.test(match[0].slice(3))) return true;
  }
  return false;
}

/** Reject accidental credentials before provider transmission or human review. */
export function assertNoCredentialShapedString(value:unknown):void {
  if(typeof value === "string" && (CREDENTIAL_SHAPE.test(value) || looksLikeMetaToken(value)))throw new PlatformDenied("CREDENTIAL_SHAPED_CONTENT_REJECTED");
}
