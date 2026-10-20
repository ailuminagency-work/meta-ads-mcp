import { describe, it, expect } from "vitest";
import { escapeHtml } from "../../src/utils/html.js";

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#x27;");
  });

  it("coerces non-string values before escaping", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(true)).toBe("true");
    expect(escapeHtml(["<"])).toBe("&lt;");
    expect(escapeHtml({ value: "tag" })).toBe("[object Object]");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtml("ByAds_Black_GlobalCom")).toBe("ByAds_Black_GlobalCom");
    expect(escapeHtml("Agencia Ñandú — 100% ✅")).toBe("Agencia Ñandú — 100% ✅");
    expect(escapeHtml("")).toBe("");
  });
});
