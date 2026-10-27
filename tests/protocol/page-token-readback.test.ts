import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, forgeAccessToken, FB_USER_ID, toolText, bootServer, type Harness } from "./harness.js";
import { saveToken, upsertUser } from "../../src/store/meta-token-repo.js";

vi.mock("../../src/utils/logger.js", () => {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => logger };
  return { logger };
});

const PAGE_TOKEN = "SYNTH-PAGE-ACCESS-TOKEN-LONG-LIVED";
const NODE = "123456789012345";

async function boot(options: { platform?: boolean }): Promise<Harness> {
  const h = await bootServer(options);
  await upsertUser(FB_USER_ID, { id: FB_USER_ID, name: "n", email: null, pictureUrl: null });
  await saveToken({ fbUserId: FB_USER_ID, name: "personal", accessToken: "SYNTH-USER-TOKEN", kind: "system_user", expiresAt: null, metaUserId: FB_USER_ID, metaUserName: "n", setAsDefault: true });
  h.upstream.setHandler((call) => {
    const path = call.url.pathname.replace(/^\/v\d+\.\d+/, "");
    const fields = call.url.searchParams.get("fields") ?? "";
    // Meta documents GET /{page-id}?fields=access_token as returning the Page token to a user token that manages the Page.
    if (call.method === "GET" && /^\/\d+$/.test(path) && /token/.test(fields)) {
      return { body: { id: path.slice(1), name: "Some Page", access_token: PAGE_TOKEN, owned_pages: { data: [{ id: "1", access_token: PAGE_TOKEN }] } } };
    }
    if (call.method === "GET" && /^\/\d+$/.test(path)) return { body: { id: path.slice(1), name: "Some Node", status: "ACTIVE" } };
    return undefined;
  });
  return h;
}

const READ_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["ads_get_ad_set_details", { ad_set_id: NODE }],
  ["ads_get_campaign_details", { campaign_id: NODE }],
  ["ads_get_ad_details", { ad_id: NODE }],
];

describe("baseline mode: a read-only bearer cannot read Page tokens through caller-chosen fields", () => {
  let h: Harness;
  beforeAll(async () => { h = await boot({}); });
  afterAll(async () => { await h.close(); });

  it.each(READ_TOOLS)("%s refuses credential fields and sends nothing upstream", async (tool, args) => {
    const bearer = await forgeAccessToken({ fbUserId: FB_USER_ID });
    for (const fields of [["access_token"], ["id", "owned_pages{access_token}"], ["client_pages"], ["name.fields(access_token)"]]) {
      h.upstream.calls.length = 0;
      const reply = await callTool(h.origin, bearer, tool, { ...args, fields }, 7);
      const text = toolText(reply);
      expect(text, `${tool} ${JSON.stringify(fields)}`).not.toContain(PAGE_TOKEN);
      expect(text).toMatch(/Requested fields are not allowed/);
      expect(h.upstream.calls.filter((c) => c.url.pathname.endsWith(`/${NODE}`)), `${tool} ${JSON.stringify(fields)}`).toHaveLength(0);
    }
  });

  it.each(READ_TOOLS)("%s still returns ordinary fields", async (tool, args) => {
    const bearer = await forgeAccessToken({ fbUserId: FB_USER_ID });
    h.upstream.calls.length = 0;
    const reply = await callTool(h.origin, bearer, tool, { ...args, fields: ["id", "name"] }, 8);
    expect(toolText(reply)).toContain("Some Node");
    expect(h.upstream.calls.filter((c) => c.url.pathname.endsWith(`/${NODE}`)).length).toBeGreaterThan(0);
  });
});

describe("strict mode control: the same request never reaches a Page token either", () => {
  let h: Harness;
  beforeAll(async () => { h = await boot({ platform: true }); });
  afterAll(async () => { await h.close(); });

  it("ads_get_ad_set_details with fields=access_token returns no token", async () => {
    const bearer = await forgeAccessToken({ fbUserId: FB_USER_ID });
    const reply = await callTool(h.origin, bearer, "ads_get_ad_set_details", { ad_set_id: NODE, fields: ["access_token"] }, 9);
    expect(toolText(reply)).not.toContain(PAGE_TOKEN);
  });
});
