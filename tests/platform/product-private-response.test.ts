import { describe, expect, it } from "vitest";
import { normalizeProductResponse } from "../../src/platform/product-private-response.js";
const response = { id: "mid_123", created_time: "2026-10-16T12:00:00+0000", from: { id: "111" }, to: { data: [{ id: "222" }] }, message: "Please send a quote for the deck." };
describe("bounded private inbox response", () => {
  it("retains authorized message text and scoped IDs without usernames", () => {
    const output = normalizeProductResponse("messenger_get_message", response, response.id, ["222"]);
    expect(output.message).toBe(response.message);
    expect(output.message_truncated).toBe(false);
    expect(output.from).toEqual({ id: "111" });
  });
  it("bounds UTF-8 text without splitting emoji", () => {
    const output = normalizeProductResponse("instagram_login_get_message", { ...response, message: "😀".repeat(501) }, response.id, ["222"]);
    expect(Buffer.byteLength(output.message as string)).toBe(2000);
    expect(output.message_truncated).toBe(true);
    expect((output.message as string).endsWith("😀")).toBe(true);
  });
  it("redacts credential-shaped message content before output", () => {
    const syntheticCredential = "EAA" + "x".repeat(40);
    const output = normalizeProductResponse("instagram_get_message", { ...response, message: `token ${syntheticCredential} and api_key=synthetic-not-real` }, response.id, ["222"]);
    expect(output.message).not.toContain(syntheticCredential);
    expect(output.message).not.toContain("synthetic-not-real");
    expect(output.message_credentials_redacted).toBe(true);
  });
  it.each([
    { ...response, extra: "raw" }, { ...response, from: { id: "111", username: "private" } },
    { ...response, to: { data: Array.from({ length: 21 }, () => ({ id: "222" })) } },
    { ...response, message: { text: "unreviewed" } }, { ...response, created_time: "invalid" },
  ])("rejects unsupported private response %#", value => {
    expect(() => normalizeProductResponse("messenger_get_message", value)).toThrow();
  });
  it("does not change unrelated product projections", () => {
    expect(normalizeProductResponse("threads_get_post", { id: "10" })).toEqual({ id: "10" });
  });
});
