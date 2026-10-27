import { describe, expect, it } from "vitest";
import { singleLine } from "../../src/utils/single-line.js";

describe("singleLine", () => {
  it("collapses control characters, line separators and whitespace into one line", () => {
    expect(singleLine("a\r\nb c d\t\te", 80)).toBe("a b c d e");
  });

  it("truncates to the bound and marks the cut", () => {
    expect(singleLine("x".repeat(50), 10)).toBe("x".repeat(10) + "…");
  });

  it("fences off runs of hyphens", () => {
    expect(singleLine("before --- after", 80)).toBe("before -- after");
  });

  it("removes bidi controls, zero-width characters, the byte order mark and tag characters", () => {
    const hidden = [
      "‮",
      "‬",
      "⁦",
      "⁩",
      "​",
      "‌",
      "‍",
      "‎",
      "‏",
      "⁠",
      "﻿",
      "­",
      String.fromCodePoint(0xe0041),
    ];
    const spoof = `Clau${hidden.join("")}de ${hidden.join("")}Desktop`;
    const flat = singleLine(spoof, 80);
    expect(flat).toBe("Claude Desktop");
    for (const char of hidden) expect(flat.includes(char)).toBe(false);
  });

  it("leaves ordinary non-ASCII text alone", () => {
    expect(singleLine("Campaña de verano — 日本語 ✓", 80)).toBe("Campaña de verano — 日本語 ✓");
  });

  it("returns an empty string for nothing", () => {
    expect(singleLine(null, 10)).toBe("");
    expect(singleLine("​‮", 10)).toBe("");
  });
});
