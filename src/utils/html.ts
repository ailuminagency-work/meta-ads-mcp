/**
 * `&` must be replaced first, or the ampersands introduced by the later
 * replacements get escaped again and render as literal entity text.
 */
export function escapeHtml(raw: unknown): string {
  let value: string;
  if (typeof raw === "string") {
    value = raw;
  } else if (raw === null || raw === undefined) {
    value = "";
  } else {
    try {
      value = String(raw);
    } catch {
      value = "";
    }
  }

  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
