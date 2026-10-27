import { describe, it, expect, vi } from "vitest";
import {
  hasNextPage,
  getAfterCursor,
  collectAllPages,
} from "../../src/meta/paginator.js";
import type { MetaApiResponse } from "../../src/meta/types/common.js";

describe("hasNextPage", () => {
  it("returns false when paging is undefined", () => {
    expect(hasNextPage(undefined)).toBe(false);
  });

  it("returns false when paging has no next or cursors", () => {
    expect(hasNextPage({})).toBe(false);
  });

  it("returns true when paging has next URL", () => {
    expect(hasNextPage({ next: "https://graph.facebook.com/next" })).toBe(
      true,
    );
  });

  it("returns true when paging has after cursor", () => {
    expect(
      hasNextPage({ cursors: { after: "abc123" } }),
    ).toBe(true);
  });

  it("returns false when cursors exist but after is undefined", () => {
    expect(hasNextPage({ cursors: {} })).toBe(false);
  });
});

describe("getAfterCursor", () => {
  it("returns undefined when paging is undefined", () => {
    expect(getAfterCursor(undefined)).toBeUndefined();
  });

  it("returns undefined when cursors are missing", () => {
    expect(getAfterCursor({})).toBeUndefined();
  });

  it("returns the after cursor value", () => {
    expect(getAfterCursor({ cursors: { after: "cursor123" } })).toBe(
      "cursor123",
    );
  });
});

describe("collectAllPages", () => {
  it("returns first page data when no more pages", async () => {
    const firstPage: MetaApiResponse<{ id: string }> = {
      data: [{ id: "1" }, { id: "2" }],
    };

    const result = await collectAllPages(firstPage, vi.fn());
    expect(result).toEqual([{ id: "1" }, { id: "2" }]);
  });

  describe("a response that never ends", () => {
    const first: MetaApiResponse<{ id: string }> = { data: [{ id: "1" }], paging: { cursors: { after: "c1" } } };

    it("stops when the server hands back a cursor it already gave", async () => {
      const fetchPage = vi.fn(async () => ({ data: [], paging: { cursors: { after: "c1" } } }));
      await expect(collectAllPages(first, fetchPage)).resolves.toEqual([{ id: "1" }]);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it("stops when two cursors point at each other", async () => {
      const fetchPage = vi.fn(async (after: string) => ({ data: [], paging: { cursors: { after: after === "c1" ? "c2" : "c1" } } }));
      await collectAllPages(first, fetchPage);
      expect(fetchPage.mock.calls.map((call) => call[0])).toEqual(["c1", "c2"]);
    });

    it("stops after a bounded number of pages even when every page is new and empty", async () => {
      let n = 0;
      const fetchPage = vi.fn(async () => ({ data: [], paging: { cursors: { after: `c${++n + 1}` } } }));
      await collectAllPages(first, fetchPage, 5000);
      expect(fetchPage.mock.calls.length).toBe(1000);
    });

    it("tolerates a page that arrives without data", async () => {
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ paging: { cursors: { after: "c2" } } })
        .mockResolvedValueOnce({ data: [{ id: "2" }] });
      await expect(collectAllPages(first, fetchPage)).resolves.toEqual([{ id: "1" }, { id: "2" }]);
    });

    it("still keeps going through empty pages that lead somewhere", async () => {
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ data: [], paging: { cursors: { after: "c2" } } })
        .mockResolvedValueOnce({ data: [{ id: "2" }] });
      await expect(collectAllPages(first, fetchPage)).resolves.toEqual([{ id: "1" }, { id: "2" }]);
    });
  });

  it("collects data from multiple pages", async () => {
    const firstPage: MetaApiResponse<{ id: string }> = {
      data: [{ id: "1" }],
      paging: { cursors: { after: "cursor1" } },
    };

    const fetchPage = vi.fn().mockResolvedValueOnce({
      data: [{ id: "2" }],
      paging: { cursors: { after: "cursor2" } },
    }).mockResolvedValueOnce({
      data: [{ id: "3" }],
    });

    const result = await collectAllPages(firstPage, fetchPage);
    expect(result).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenCalledWith("cursor1");
    expect(fetchPage).toHaveBeenCalledWith("cursor2");
  });

  it("respects maxItems limit", async () => {
    const firstPage: MetaApiResponse<{ id: string }> = {
      data: [{ id: "1" }, { id: "2" }],
      paging: { cursors: { after: "cursor1" } },
    };

    const fetchPage = vi.fn().mockResolvedValue({
      data: [{ id: "3" }, { id: "4" }],
    });

    const result = await collectAllPages(firstPage, fetchPage, 3);
    expect(result).toHaveLength(3);
    expect(result).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  it("stops when no after cursor is available", async () => {
    const firstPage: MetaApiResponse<{ id: string }> = {
      data: [{ id: "1" }],
      paging: { cursors: {} },
    };

    const fetchPage = vi.fn();
    const result = await collectAllPages(firstPage, fetchPage);
    expect(result).toEqual([{ id: "1" }]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("handles empty first page", async () => {
    const firstPage: MetaApiResponse<{ id: string }> = {
      data: [],
    };

    const result = await collectAllPages(firstPage, vi.fn());
    expect(result).toEqual([]);
  });
});
