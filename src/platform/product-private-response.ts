import { PlatformDenied } from "./models.js";

const INBOX_TOOLS = new Set(["messenger_get_message", "instagram_get_message", "instagram_login_get_message"]);
function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformDenied("INBOX_RESPONSE_SCHEMA_INVALID");
  return value as Record<string, unknown>;
}
function scopedId(value: unknown, messageId = false): string {
  if (typeof value !== "string" || !(messageId ? /^[A-Za-z0-9_:$\.\-=]{1,200}$/ : /^\d{1,100}$/).test(value)) throw new PlatformDenied("INBOX_ID_SCHEMA_INVALID");
  return value;
}
export function redactCredentials(text: string): string {
  return text
    .replace(/\bEAA[A-Za-z0-9]{20,}\b/g, "[credential redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[credential redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi, "Bearer [credential redacted]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|app[_-]?secret|refresh[_-]?token|password)\s*[:=]\s*[^\s,;]{4,}/gi, "[credential redacted]");
}

/** Host must call this after the reviewed leaf projection and before tool output; never persist text. */
export function normalizeProductResponse(tool: string, value: unknown, expectedId?: string, authorizedAccountIds?: readonly string[]): Record<string, unknown> {
  const response = plain(value);
  if (!INBOX_TOOLS.has(tool)) return response;
  if (expectedId !== undefined && response.id !== expectedId) throw new PlatformDenied("INBOX_RESPONSE_ID_MISMATCH");
  if (Object.keys(response).some(key => !["id", "created_time", "from", "to", "message"].includes(key))) throw new PlatformDenied("INBOX_RESPONSE_SCHEMA_INVALID");
  const from = plain(response.from), to = plain(response.to);
  if (Object.keys(from).join() !== "id" || Object.keys(to).join() !== "data" || !Array.isArray(to.data) || !to.data.length || to.data.length > 20 || typeof response.created_time !== "string" || response.created_time.length > 64 || !Number.isFinite(Date.parse(response.created_time)) || typeof response.message !== "string") throw new PlatformDenied("INBOX_RESPONSE_SCHEMA_INVALID");
  const recipients = to.data.map(item => {
    const recipient = plain(item);
    if (Object.keys(recipient).join() !== "id") throw new PlatformDenied("INBOX_RESPONSE_SCHEMA_INVALID");
    return { id: scopedId(recipient.id) };
  });
  const senderId = scopedId(from.id);
  if (!authorizedAccountIds || authorizedAccountIds.length !== 1 || !(authorizedAccountIds[0] === senderId || recipients.some(recipient => recipient.id === authorizedAccountIds[0]))) throw new PlatformDenied("INBOX_PARTICIPANT_PROVENANCE_REQUIRED");
  const redacted = redactCredentials(response.message);
  let excerpt = "";
  let bytes = 0;
  for (const character of redacted) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 2000) break;
    excerpt += character;
    bytes += size;
  }
  return { id: scopedId(response.id, true), created_time: response.created_time, from: { id: senderId }, to: { data: recipients }, message: excerpt, message_truncated: excerpt.length < redacted.length, message_credentials_redacted: redacted !== response.message };
}
