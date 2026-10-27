import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createServer } from "../../src/server.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import { LEGACY_MIGRATED_READ_TOOLS, LEGACY_MIGRATED_WORKFLOW_TOOLS, LEGACY_MIGRATED_WRITE_TOOLS } from "../../src/platform/legacy-implementation.js";
import {
  BASELINE_WRITE_TOOLS, PRODUCT_MUTATING_TOOLS, READ_ONLY_AGENCY_KEPT_PREPARATION_TOOLS, READ_ONLY_AGENCY_EXCLUDED_READ_TOOLS, READ_ONLY_AGENCY_TOOLS, STRICT_ANNOTATION_DRIFT,
  classificationProblems, type ClassificationInputs, type RegisteredToolFact,
} from "./tool-classification.fixture.js";

afterEach(() => vi.unstubAllEnvs());

type ToolTable = Record<string, { annotations?: { readOnlyHint?: boolean }; enabled?: boolean }>;
function registered(env: Record<string, string>): RegisteredToolFact[] {
  for (const [name, value] of Object.entries({ TOKEN_ENCRYPTION_KEY: "a".repeat(64), META_API_VERSION: "v26.0", META_APP_ID: "300", ...env })) vi.stubEnv(name, value);
  const table = (createServer() as unknown as { _registeredTools: ToolTable })._registeredTools;
  vi.unstubAllEnvs();
  return Object.entries(table).map(([name, tool]) => ({ name, readOnlyHint: tool.annotations?.readOnlyHint, enabled: tool.enabled !== false }));
}
const BASELINE_ENV = { DEPLOYMENT_MODE: "legacy", LUMIN_PLATFORM_ENABLED: "false" };
const STRICT_ENV = { DEPLOYMENT_MODE: "legacy", LUMIN_PLATFORM_ENABLED: "true" };
const AGENCY_READ_ONLY = { DEPLOYMENT_MODE: "agency", AGENCY_WRITES_ENABLED: "false", LUMIN_PLATFORM_WRITES_ENABLED: "false" };

function inputs(): ClassificationInputs {
  return {
    registered: registered(STRICT_ENV), baseline: registered(BASELINE_ENV),
    contractClasses: Object.fromEntries(PRODUCT_CONTRACTS.map(c => [c.tool, c.operationClasses])),
    migratedWrites: LEGACY_MIGRATED_WRITE_TOOLS, migratedWorkflows: LEGACY_MIGRATED_WORKFLOW_TOOLS, migratedReads: LEGACY_MIGRATED_READ_TOOLS,
  };
}

describe("every registered tool carries a reviewed mutation classification", () => {
  it("classifies exactly the tools the strict build registers, and every classification still holds", () => {
    const input = inputs();
    expect(input.registered).toHaveLength(371);
    expect(classificationProblems(input)).toEqual([]);
  });

  it("agrees with the generated inventory about how many tools exist", () => {
    const inventory = JSON.parse(readFileSync(new URL("../../docs/generated-tool-inventory.json", import.meta.url), "utf8")) as { summary: { registeredTools: number } };
    expect(inputs().registered).toHaveLength(inventory.summary.registeredTools);
  });

  it("exposes exactly the reviewed read set in a read-only agency deployment without the platform", () => {
    const enabled = registered({ ...BASELINE_ENV, ...AGENCY_READ_ONLY }).filter(t => t.enabled).map(t => t.name).sort();
    expect(enabled).toEqual([...READ_ONLY_AGENCY_TOOLS].sort());
    expect(READ_ONLY_AGENCY_EXCLUDED_READ_TOOLS.every(name => !enabled.includes(name))).toBe(true);
  });

  it("exposes only read-annotated tools plus the six evidence and enrollment tools in a read-only strict agency deployment", () => {
    const enabled = registered({ ...STRICT_ENV, ...AGENCY_READ_ONLY }).filter(t => t.enabled);
    const notRead = enabled.filter(t => t.readOnlyHint !== true).map(t => t.name).sort();
    expect(notRead).toEqual([...READ_ONLY_AGENCY_KEPT_PREPARATION_TOOLS].sort());
    const names = enabled.map(t => t.name);
    for (const name of [...BASELINE_WRITE_TOOLS, ...Object.keys(PRODUCT_MUTATING_TOOLS)]) {
      if (STRICT_ANNOTATION_DRIFT[name] === true) continue;
      expect(names, `${name} must not be enabled`).not.toContain(name);
    }
  });
});

describe("the guard fails when a tool is added, reclassified or changed without a reviewed entry", () => {
  const base = (): ClassificationInputs => inputs();
  const clone = (input: ClassificationInputs): ClassificationInputs => ({ ...input, registered: input.registered.map(t => ({ ...t })), contractClasses: structuredClone(input.contractClasses) as ClassificationInputs["contractClasses"] });

  it("reports a newly registered tool that nobody classified", () => {
    const input = clone(base());
    input.registered = [...input.registered, { name: "meta_activate_everything", readOnlyHint: false, enabled: true }];
    expect(classificationProblems(input)).toEqual(["UNCLASSIFIED_TOOL meta_activate_everything"]);
  });

  it("reports a classification whose tool no longer exists", () => {
    const input = clone(base());
    input.registered = input.registered.filter(t => t.name !== "pages_create_feed");
    expect(classificationProblems(input)).toContain("STALE_CLASSIFICATION pages_create_feed");
  });

  it("reports a mutating tool that is annotated read-only", () => {
    const input = clone(base());
    input.registered.find(t => t.name === "pages_delete_post")!.readOnlyHint = true;
    expect(classificationProblems(input)).toEqual(expect.arrayContaining([expect.stringContaining("ANNOTATION_MISMATCH pages_delete_post")]));
  });

  it("reports a read tool that was annotated as a write without review", () => {
    const input = clone(base());
    input.registered.find(t => t.name === "ads_get_insights")!.readOnlyHint = false;
    expect(classificationProblems(input)).toEqual(expect.arrayContaining([expect.stringContaining("ANNOTATION_MISMATCH ads_get_insights")]));
  });

  it("reports a contract that gained an operation class", () => {
    const input = clone(base());
    (input.contractClasses as Record<string, string[]>).pages_create_feed = ["WRITE_CONTENT", "WRITE_BUDGET"];
    const problems = classificationProblems(input);
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining("PRODUCT_CLASSES_CHANGED pages_create_feed"), "SPEND_CAPABLE_PRODUCT_SET_CHANGED marketing_activate_ad,pages_create_feed"]));
  });

  it("reports a mutating contract downgraded to READ", () => {
    const input = clone(base());
    (input.contractClasses as Record<string, string[]>).pages_delete_post = ["READ"];
    expect(classificationProblems(input)).toContain("PRODUCT_READ_STATUS_CHANGED pages_delete_post");
  });

  it("reports a second tool that can start delivery or change a budget", () => {
    const input = clone(base());
    (input.contractClasses as Record<string, string[]>).whatsapp_platform_send_message = ["ACTIVATE_SPEND"];
    expect(classificationProblems(input)).toContain("SPEND_CAPABLE_PRODUCT_SET_CHANGED marketing_activate_ad,whatsapp_platform_send_message");
  });

  it("reports a held baseline write that became executable in the strict build", () => {
    const input = clone(base());
    input.migratedWrites = [...input.migratedWrites, "ads_update_spend_cap"];
    const problems = classificationProblems(input);
    expect(problems).toEqual(expect.arrayContaining(["HELD_WRITE_NOW_EXECUTABLE ads_update_spend_cap", expect.stringContaining("STRICT_WRITE_SUBSET_CHANGED ads_update_spend_cap")]));
  });

  it("reports a strict annotation change that nobody reviewed", () => {
    const input = clone(base());
    input.baseline.find(t => t.name === "ads_get_insights")!.readOnlyHint = false;
    expect(classificationProblems(input)).toContain("UNREVIEWED_ANNOTATION_DRIFT ads_get_insights");
  });
});
