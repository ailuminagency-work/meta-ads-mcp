import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestContext } from "../../src/auth/token-store.js";
import { readPageLeadForms } from "../../src/meta/page-lead-forms.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const run = (page = "123") => requestContext.run({ fbUserId: "100", accessToken: "synthetic-user" }, () => readPageLeadForms(page, 10, ["id", "name"]));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe("request-scoped Page form reads", () => {
  it("derives and verifies the exact Page token without returning it or paging URLs", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ id: "123", access_token: "synthetic-page" }))
      .mockResolvedValueOnce(reply({ id: "123" }))
      .mockResolvedValueOnce(reply({ data: [{ id: "456", name: "Form", access_token: "synthetic-page" }], paging: { next: "secret" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await run()).toEqual({ data: [{ id: "456", name: "Form" }] });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [raw, init] of fetcher.mock.calls) { expect(String(raw)).not.toContain("token="); expect(init.method).toBe("GET"); expect(init.redirect).toBe("error"); }
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer synthetic-user");
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe("Bearer synthetic-page");
    expect(requestContext.getStore()).toBeUndefined();
  });
  it("rejects global credential fallback", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "synthetic-global"); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readPageLeadForms("123", 10, ["id"])).rejects.toThrow("AUTHENTICATED_OPERATOR_REQUIRED"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("cannot bypass platform connection policy", async () => {
    vi.stubEnv("LUMIN_PLATFORM_ENABLED", "true"); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(run()).rejects.toThrow("PLATFORM_CONNECTION_REQUIRED"); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ id: "999", access_token: "synthetic-page" }, { id: "123" }])("rejects unusable Page credentials", async response => {
    const fetcher = vi.fn().mockResolvedValue(reply(response)); vi.stubGlobal("fetch", fetcher);
    await expect(run()).rejects.toThrow("PAGE_TOKEN_UNAVAILABLE"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects a token belonging to another Page before requesting forms", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ id: "123", access_token: "synthetic-page" })).mockResolvedValueOnce(reply({ id: "999" })); vi.stubGlobal("fetch", fetcher);
    await expect(run()).rejects.toThrow("IDENTITY_MISMATCH"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([[190,"TOKEN_REJECTED"],[200,"PERMISSION_DENIED"],[10,"PERMISSION_DENIED"]])("sanitizes provider error %s", async (code, category) => {
    const fetcher = vi.fn().mockResolvedValue(reply({ error: { code, message: "synthetic-user sensitive" } }, 400)); vi.stubGlobal("fetch", fetcher);
    await expect(run()).rejects.toThrow(`PAGE_READ_${category}`); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("sanitizes network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic-user sensitive")));
    await expect(run()).rejects.toThrow(/^PAGE_READ_UNAVAILABLE$/);
  });
  it("rejects credential-bearing requested fields without egress", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(requestContext.run({ fbUserId: "100", accessToken: "synthetic-user" }, () => readPageLeadForms("123", 10, ["access_token"]))).rejects.toThrow("INVALID_INPUT"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("isolates simultaneous callers and Page tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(async (raw: URL, init: RequestInit) => {
      const token = new Headers(init.headers).get("Authorization"); const path = raw.pathname;
      if (path.endsWith("/me")) return reply({ id: token === "Bearer synthetic-page-123" ? "123" : "456" });
      if (path.endsWith("/leadgen_forms")) { expect(token).toBe(`Bearer synthetic-page-${path.split("/")[2]}`); return reply({ data: [] }); }
      const id = path.split("/")[2]; return reply({ id, access_token: `synthetic-page-${id}` });
    }));
    await Promise.all([run("123"), requestContext.run({ fbUserId: "200", accessToken: "synthetic-other-user" }, () => readPageLeadForms("456", 10, ["id"]))]);
  });
  it("strips unknown nested fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ id: "123", access_token: "synthetic-page" })).mockResolvedValueOnce(reply({ id: "123" })).mockResolvedValueOnce(reply({ data: [{ questions: [{ key: "name", access_token: "other-secret" }], privacy_policy: { url: "https://example.test/privacy", paging: "other-secret" } }] })));
    const value = await requestContext.run({ fbUserId: "100", accessToken: "synthetic-user" }, () => readPageLeadForms("123", 10, ["questions", "privacy_policy"]));
    expect(value).toEqual({ data: [{ questions: [{ key: "name" }], privacy_policy: { url: "https://example.test/privacy" } }] });
  });
  it.each([null, { name: { access_token: "secret" } }, { questions: "not-an-array" }])("rejects malformed form rows", async row => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ id: "123", access_token: "synthetic-page" })).mockResolvedValueOnce(reply({ id: "123" })).mockResolvedValueOnce(reply({ data: [row] })));
    await expect(run()).rejects.toThrow("PAGE_READ_UNAVAILABLE");
  });
  it("rejects a known credential echoed in a permitted field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ id: "123", access_token: "synthetic-page" })).mockResolvedValueOnce(reply({ id: "123" })).mockResolvedValueOnce(reply({ data: [{ name: "synthetic-page" }] })));
    await expect(run()).rejects.toThrow("UNSAFE_RESPONSE");
  });
  it("stops subsequent calls after provider throttling without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ error: { code: 4, message: "sensitive" } }, 429)); vi.stubGlobal("fetch", fetcher);
    const call = () => requestContext.run({ fbUserId: "300", accessToken: "synthetic-throttle-user" }, () => readPageLeadForms("123", 10, ["id"]));
    await expect(call()).rejects.toThrow("PROVIDER_REJECTED");
    await expect(call()).rejects.toThrow("THROTTLED"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("honors a non-JSON 429 response before parsing", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Too many requests", { status: 429 })); vi.stubGlobal("fetch", fetcher);
    const call = () => requestContext.run({ fbUserId: "400", accessToken: "synthetic-nonjson-throttle-user" }, () => readPageLeadForms("123", 10, ["id"]));
    await expect(call()).rejects.toThrow("UNAVAILABLE"); await expect(call()).rejects.toThrow("THROTTLED"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("sends an appsecret_proof computed from the token each call uses when the app secret is set", async () => {
    vi.stubEnv("META_APP_SECRET", "synthetic-app-secret-not-real");
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ id: "123", access_token: "synthetic-page" })).mockResolvedValueOnce(reply({ id: "123" })).mockResolvedValueOnce(reply({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    await run();
    const proof = (token: string) => createHmac("sha256", "synthetic-app-secret-not-real").update(token).digest("hex");
    const seen = fetcher.mock.calls.map(([raw]) => new URL(String(raw)).searchParams.get("appsecret_proof"));
    expect(seen).toEqual([proof("synthetic-user"), proof("synthetic-page"), proof("synthetic-page")]);
  });
  it("sends no appsecret_proof when no app secret is configured", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ id: "123", access_token: "synthetic-page" })).mockResolvedValueOnce(reply({ id: "123" })).mockResolvedValueOnce(reply({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    await run();
    for (const [raw] of fetcher.mock.calls) expect(new URL(String(raw)).searchParams.has("appsecret_proof")).toBe(false);
  });
});
