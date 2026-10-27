// Every control character (C0, DEL and C1, which includes NEL U+0085) and the Unicode line and paragraph separators: anything a line-splitting reader could take for a line break.
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;
/**
 * Format characters render as nothing or reorder what is around them: bidi
 * overrides, zero-width spaces and joiners, the byte order mark, Unicode tag
 * characters. None belongs in a one-line label, and each can hide or disguise text.
 */
const FORMAT_CHARS = /\p{Cf}/gu;
/** Three or more hyphens are how this server fences untrusted content; inside it they are just text. */
const FENCE_RUN = /-{3,}/g;

/**
 * One bounded line out of untrusted text (advertiser copy, a model's answer):
 * control characters and line separators collapse to spaces, so the text can
 * never break out of the line it is rendered on. The result is data for the
 * agent, never framing.
 */
export function singleLine(value: string | null | undefined, max: number): string {
  if (!value) return "";
  // Sanitize a bounded prefix only: each replace over a multi-megabyte string
  // would allocate another copy of it just for the slice below to discard.
  const cut = value.length > max * 4;
  const head = cut ? value.slice(0, max * 4) : value;
  const flat = head
    .replace(FORMAT_CHARS, "")
    .replace(CONTROL_CHARS, " ")
    .replace(FENCE_RUN, "--")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length > max) return flat.slice(0, max) + "…";
  // The prefix may have been all whitespace; say so rather than render an empty field.
  return cut ? flat + "…" : flat;
}
