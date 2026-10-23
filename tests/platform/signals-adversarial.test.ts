import { describe, expect, it } from "vitest";
import { firstPartySignalDigest, prepareFirstPartySignal, type SignalEvidence } from "../../src/platform/signals.js";

const now = Date.now();
const scope = { tenantId: "tenant-fixture", clientId: "client-fixture", datasetId: "dataset-fixture" };
const input = { event_name: "Purchase", event_id: "event-fixture", event_time: Math.floor(now / 1000), action_source: "website", event_source_url: "https://fixture.invalid/complete", source_reference: "crm-fixture", consent_reference: "consent-fixture", user_data: { em: "person@fixture.invalid", ph: "+12065550123", external_id: "customer-fixture" }, custom_data: { currency: "USD", value: 10 } };
const evidence: SignalEvidence = { ...scope, payloadDigest: firstPartySignalDigest(input), sourceReference: input.source_reference, consentReference: input.consent_reference, eventId: input.event_id, eventTime: input.event_time, eventName: input.event_name, authorized: true, expiresAt: now + 60000 };
const resolver = { resolve: async () => evidence };

describe("independent signal source truth adversarial review", () => {
  it.each([{ expiresAt: NaN }, { expiresAt: Infinity }, { authorized: "yes" }])("rejects malformed trusted evidence %j", async override => {
    await expect(prepareFirstPartySignal(input, scope, { resolve: async () => ({ ...evidence, ...override }) as unknown as SignalEvidence }, now)).rejects.toThrow("VERIFIED_FIRST_PARTY");
  });
  it("rejects a nonfinite clock", async () => {
    await expect(prepareFirstPartySignal(input, scope, resolver, NaN)).rejects.toThrow("INVALID_SIGNAL_CLOCK");
  });
  it.each([
    { user_data: { ...input.user_data, em: "different@fixture.invalid" } },
    { user_data: { ...input.user_data, ph: "+12065550124" } },
    { user_data: { ...input.user_data, external_id: "foreign-customer" } },
    { custom_data: { ...input.custom_data, value: 100000 } },
    { custom_data: { ...input.custom_data, currency: "EUR" } },
    { action_source: "system_generated" },
    { event_source_url: "https://fixture.invalid/private-email/person@example.invalid" },
  ])("rejects substituted source data without changing the event ID %j", async replacement => {
    await expect(prepareFirstPartySignal({ ...input, ...replacement }, scope, resolver, now)).rejects.toThrow("VERIFIED_FIRST_PARTY");
  });
  it("does not allow the same consent evidence to authorize another dataset", async () => {
    await expect(prepareFirstPartySignal(input, { ...scope, datasetId: "foreign-dataset" }, resolver, now)).rejects.toThrow("VERIFIED_FIRST_PARTY");
  });
  it.each(["fbp", "fbc"])("rejects unverified raw browser identifier %s", async key => {
    await expect(prepareFirstPartySignal({ ...input, user_data: { ...input.user_data, [key]: "arbitrary-sensitive-value" } }, scope, resolver, now)).rejects.toThrow("INVALID_FIRST_PARTY");
  });
  it("canonical digest is stable across caller property order", async () => {
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    expect(firstPartySignalDigest(reordered)).toBe(firstPartySignalDigest(input));
    const result = await prepareFirstPartySignal(reordered, scope, resolver, now);
    expect(JSON.stringify(result)).not.toContain("person@fixture.invalid");
    expect(JSON.stringify(result)).not.toContain("12065550123");
  });
});
