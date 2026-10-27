/**
 * Meta's CDN hosts. Media URLs come out of creatives, Ad Library datasets and
 * Graph fields that an advertiser (or whoever controls a page) can set to any
 * address, so without this list the server would fetch whatever they point at.
 * A leading dot matches the domain and every subdomain, never a look-alike.
 */
export const META_MEDIA_HOST_SUFFIXES: readonly string[] = [".fbcdn.net", ".facebook.com", ".cdninstagram.com"];

/**
 * The allowlist for Meta-origin images and videos. Override with
 * VIDEO_ALLOWED_HOST_SUFFIXES (comma-separated, each entry starting with a dot);
 * the variable keeps its original name and now governs images as well.
 */
export function resolveAllowedMediaHostSuffixes(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.VIDEO_ALLOWED_HOST_SUFFIXES?.trim();
  if (!raw) return [...META_MEDIA_HOST_SUFFIXES];
  const suffixes = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 1 && s.startsWith("."));
  return suffixes.length > 0 ? suffixes : [...META_MEDIA_HOST_SUFFIXES];
}
