import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationPlan } from "../../src/platform/models.js";

vi.mock("../../src/platform/approvals.js", () => ({ inspectApprovalRequest: vi.fn(), issueHumanApproval: vi.fn() }));
const { inspectApprovalRequest } = await import("../../src/platform/approvals.js");
const { createApprovalRouter, updateSendsPausedNote } = await import("../../src/platform/approval-router.js");

const principal = { tenantId: "tenant", operatorId: "human" };
const requestId = "11111111-2222-3333-4444-555555555555";
const plan = (over: Partial<OperationPlan>): OperationPlan => ({ parameters: {}, assets: [], classes: ["WRITE_AD_CONFIGURATION"], capability: "legacy.ads_update_campaign", requiredScopes: [], tokenTypes: ["user"], ...over });
const update = plan({ parameters: { status: "PAUSED", legacy_write_step: { path: "/201", body: { status: "PAUSED", daily_budget: "2500" } } }, classes: ["WRITE_AD_CONFIGURATION", "WRITE_BUDGET"] });
const create = plan({ createOrCopy: true, parameters: { status: "PAUSED", legacy_write_step: { path: "/act_101/campaigns", body: { status: "PAUSED", daily_budget: "2500" } } } });
const post = plan({ capability: "pages.create.feed", classes: ["WRITE_CONTENT"], parameters: { asset_id: "123", input: { message: "x" } } });
const activation = plan({ capability: "marketing.activate.ad", classes: ["ACTIVATE_SPEND"], parameters: { asset_id: "401", input: { expected_adset_daily_budget: 1000 } } });

let server: Server | undefined;
beforeEach(() => vi.clearAllMocks());
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });

async function page(shown: OperationPlan): Promise<string> {
  vi.mocked(inspectApprovalRequest).mockResolvedValue({ request: { planHash: "h".repeat(64), expiresAt: Date.now() + 60000 }, ctx: { clientId: "client", tool: "ads_update_campaign", principal: { operatorId: "actor" } }, plan: shown, snapshot: { assets: [] }, approverRevision: 1 } as never);
  const app = express();
  app.use("/platform/approvals", createApprovalRouter({ repo: {} as never, origin: "https://fixture.invalid", csrfSecret: "synthetic-csrf-secret-".repeat(3), resolveSession: async () => principal }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/platform/approvals/${requestId}`);
  expect(response.status).toBe(200);
  return response.text();
}

describe("the approval page says in plain language when approving a change also pauses it", () => {
  it("tells the approver that an update to a live entity will pause it", async () => {
    const html = await page(update);
    expect(html).toContain("This change also sets the status to PAUSED");
    expect(html).toContain("If the campaign, ad set or ad is live now, approving this will pause it");
    expect(html.indexOf("also sets the status to PAUSED")).toBeLessThan(html.indexOf("<pre>"));
    expect(html).toContain("&quot;daily_budget&quot;: &quot;2500&quot;");
  });

  it.each([["a create, which is PAUSED by definition", create], ["a content post", post], ["an activation", activation]])("adds no note for %s", async (_label, shown) => {
    expect(await page(shown)).not.toContain("also sets the status to PAUSED");
  });

  it("derives the note only from a non-create plan whose provider body status is exactly PAUSED", () => {
    expect(updateSendsPausedNote(update)).not.toBe("");
    expect(updateSendsPausedNote(plan({ parameters: { legacy_write_step: { path: "/201", body: { status: "ACTIVE" } } } }))).toBe("");
    expect(updateSendsPausedNote(plan({ parameters: { legacy_write_step: { path: "/201", body: { name: "x" } } } }))).toBe("");
    expect(updateSendsPausedNote(create)).toBe("");
  });
});
