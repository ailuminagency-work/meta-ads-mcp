import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);
}
const files = sourceFiles(join(root, "src")).map(path => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));
const filesMatching = (pattern: RegExp): string[] => files.filter(f => pattern.test(f.text)).map(f => f.path).sort();

describe("structural properties of the mutation boundary", () => {
  it("never passes a literal true as writesEnabled, so a deployment's writes flag cannot be bypassed in code", () => {
    expect(filesMatching(/writesEnabled\s*:\s*(?:true|!0|Boolean\(\s*1\s*\))\b/)).toEqual([]);
  });

  it("lets only the human approval router issue an approval", () => {
    expect(filesMatching(/\bissueHumanApproval\b/)).toEqual(["src/platform/approval-router.ts", "src/platform/approvals.ts"]);
  });

  it("creates approval records in exactly one place", () => {
    expect(filesMatching(/collection\s*:\s*"approvals"\s*,\s*id\s*:[^}]*\bvalue\s*:/)).toEqual(["src/platform/approvals.ts"]);
    expect(filesMatching(/\.put\(\s*"approvals"\s*,/)).toEqual([]);
  });

  it("registers no MCP tool that mentions issuing or granting an approval to the caller", () => {
    const toolRegistrations = files.filter(f => /registerTool\(/.test(f.text));
    expect(toolRegistrations.length).toBeGreaterThan(20);
    expect(toolRegistrations.filter(f => /\b(?:issueHumanApproval|inspectApprovalRequest)\b/.test(f.text)).map(f => f.path)).toEqual([]);
  });
});
