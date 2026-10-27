import type { MetaApiResponse, Paging } from "./types/common.js";

/** Pages one collection may take, however small the pages are; maxItems still bounds the rows. */
const MAX_PAGES = 1000;

/**
 * Helper to handle cursor-based pagination from the Meta Graph API.
 */
export function hasNextPage(paging?: Paging): boolean {
  return !!paging?.next || !!paging?.cursors?.after;
}

export function getAfterCursor(paging?: Paging): string | undefined {
  return paging?.cursors?.after;
}

/**
 * Collect all pages from a paginated Meta API response.
 * Uses a callback to fetch subsequent pages.
 *
 * @param firstPage - The initial API response
 * @param fetchPage - Function to fetch the next page given an "after" cursor
 * @param maxItems - Maximum total items to collect (default: 1000)
 */
export async function collectAllPages<T>(
  firstPage: MetaApiResponse<T>,
  fetchPage: (after: string) => Promise<MetaApiResponse<T>>,
  maxItems = 1000,
): Promise<T[]> {
  const items: T[] = [...firstPage.data];

  // A cursor the server hands back twice, or a run of empty pages, would keep
  // this loop calling Graph for as long as the response says there is more.
  const seenCursors = new Set<string>();
  let paging = firstPage.paging;
  while (items.length < maxItems && hasNextPage(paging) && seenCursors.size < MAX_PAGES) {
    const after = getAfterCursor(paging);
    if (!after || seenCursors.has(after)) break;
    seenCursors.add(after);

    const nextPage = await fetchPage(after);
    if (Array.isArray(nextPage?.data)) items.push(...nextPage.data);
    paging = nextPage?.paging;
  }

  return items.slice(0, maxItems);
}
