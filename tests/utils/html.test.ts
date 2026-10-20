import { describe, it, expect } from "vitest";
import { escapeHtml } from "../../src/utils/html.js";

describe("escapeHtml", () => {
  it("handles numbers", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});
