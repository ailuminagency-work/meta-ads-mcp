import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { assertSafeGraphFields, buildFieldsParam } from "../../src/utils/validation.js";

describe("buildFieldsParam refuses credential fields and unrecognised syntax", () => {
  it.each([
    [["access_token"]],
    [["ACCESS_TOKEN"]],
    [["id", "access_token"]],
    [["id,name,access_token"]],
    [["page_access_token"]],
    [["business_token"]],
    [["owned_pages{access_token}"]],
    [["owned_pages{id,access_token}"]],
    [["client_pages{access_token}"]],
    [["instagram_accounts{access_token}"]],
    [["accounts{name,access_token}"]],
    [["business{owned_pages{access_token}}"]],
    [["creative{id}", "owned_pages.limit(5){name,access_token}"]],
    [["app_secret"]],
    [["appsecret_proof"]],
    [["client_secret"]],
    [["password"]],
    [["user_password_hash"]],
  ])("refuses a request for a credential: %j", (fields) => {
    expect(() => buildFieldsParam(fields, ["id"])).toThrow(McpError);
    expect(() => buildFieldsParam(fields, ["id"])).toThrow(/Requested fields are not allowed/);
  });

  it.each([
    [["owned_pages"]],
    [["client_pages"]],
    [["instagram_accounts"]],
    [["accounts"]],
    [["id", "accounts"]],
    [["business{owned_pages}"]],
    [["owned_pages{}"]],
  ])("refuses an edge that returns credentials unless its sub-fields are named: %j", (fields) => {
    expect(() => buildFieldsParam(fields, ["id"])).toThrow(/Requested fields are not allowed/);
  });

  it.each([
    [["name.fields(id)"]],
    [["owned_pages.fields(name)"]],
    [["id},{name"]],
    [["id{name"]],
    [["id}"]],
    [["{id}"]],
    [["id name"]],
    [["id;name"]],
    [["id\nname"]],
    [["id\tname"]],
    [["*"]],
    [["id,"]],
    [[""]],
    [["id,,name"]],
    [["name.limit(5"]],
    [["name.limit(5){id}x"]],
    [["name.(5)"]],
    [["name.limit(a(b))"]],
    [["name.as(alias)"]],
    [["1abc"]],
    [["na-me"]],
    [["na%6De"]],
    [["na\u0000me"]],
    [["id{a{b{c{d{e{f}}}}}}"]],
  ])("refuses syntax it does not recognise: %j", (fields) => {
    expect(() => buildFieldsParam(fields, ["id"])).toThrow(/Requested fields are not allowed/);
  });

  it("refuses an over-long or over-broad list", () => {
    expect(() => buildFieldsParam(["a".repeat(2001)], ["id"])).toThrow(/too long/);
    expect(() => buildFieldsParam(Array.from({ length: 201 }, (_, i) => `f${i}`), ["id"])).toThrow(/too many fields/);
  });

  it("does not echo what was asked for", () => {
    try {
      buildFieldsParam(["owned_pages{access_token}"], ["id"]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("owned_pages");
      expect((error as Error).message).not.toContain("access_token");
    }
  });

  it.each([
    [["id", "name"], "id,name"],
    [["creative{id}"], "creative{id}"],
    [["thumbnails{uri,is_preferred}"], "thumbnails{uri,is_preferred}"],
    [["id", "campaign{id,name}", "adset{id}"], "id,campaign{id,name},adset{id}"],
    [["preview.invalidate(false)"], "preview.invalidate(false)"],
    [["insights.date_preset(last_7d){spend,impressions}"], "insights.date_preset(last_7d){spend,impressions}"],
    [["instagram_business_account{id,username}"], "instagram_business_account{id,username}"],
    [["owned_pages{id,name}"], "owned_pages{id,name}"],
    [["accounts{id,name}"], "accounts{id,name}"],
    [["id, name"], "id, name"],
    [["actions", "cost_per_action_type", "video_30_sec_watched_actions"], "actions,cost_per_action_type,video_30_sec_watched_actions"],
  ])("passes ordinary fields through unchanged: %j", (fields, expected) => {
    expect(buildFieldsParam(fields, ["id"])).toBe(expected);
  });

  it("uses the defaults when no fields are asked for, and checks them too", () => {
    expect(buildFieldsParam(undefined, ["id", "name"])).toBe("id,name");
    expect(buildFieldsParam([], ["id", "name"])).toBe("id,name");
    expect(() => buildFieldsParam(undefined, ["id", "access_token"])).toThrow(/Requested fields are not allowed/);
  });

  it("exposes the check on its own", () => {
    expect(() => assertSafeGraphFields("id,name")).not.toThrow();
    expect(() => assertSafeGraphFields("id,access_token")).toThrow(McpError);
  });
});
