import { PlatformDenied } from "./models.js";

/** Reject accidental credentials before provider transmission or human review. */
export function assertNoCredentialShapedString(value:unknown):void {
  if(typeof value === "string" && /(?:EAA[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:access_token|refresh_token|client_secret|app_secret|authorization)\s*[:=]\s*\S{8,})/i.test(value))throw new PlatformDenied("CREDENTIAL_SHAPED_CONTENT_REJECTED");
}
