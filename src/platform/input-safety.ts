import { PlatformDenied } from "./models.js";

/** Meta tokens always start with an upper-case "EAA"; a lower-case "eaa" inside a hex digest is not one. */
const META_TOKEN_SHAPE = /EAA[A-Za-z0-9]{20,}/;
const CREDENTIAL_SHAPE = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:access_token|refresh_token|client_secret|app_secret|authorization)\s*[:=]\s*\S{8,})/i;

/** Reject accidental credentials before provider transmission or human review. */
export function assertNoCredentialShapedString(value:unknown):void {
  if(typeof value === "string" && (META_TOKEN_SHAPE.test(value) || CREDENTIAL_SHAPE.test(value)))throw new PlatformDenied("CREDENTIAL_SHAPED_CONTENT_REJECTED");
}
