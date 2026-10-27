import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const directory = path.resolve(__dirname, "../../.github/workflows");

type Permissions = Record<string, string>;

interface Job {
  name: string;
  permissions: Permissions | null;
  text: string;
  calls: string | null;
}

interface Workflow {
  file: string;
  permissions: Permissions | null;
  jobs: Job[];
}

function entries(lines: string[], start: number, indent: number): Permissions {
  const result: Permissions = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const leading = line.length - line.trimStart().length;
    if (leading < indent) break;
    const match = /^\s*([a-z-]+):\s*([a-z-]+)\s*(?:#.*)?$/.exec(line);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

/** The workflows are regular enough for an indentation parser, and no YAML library is a dependency. */
function parse(file: string): Workflow {
  const lines = readFileSync(path.join(directory, file), "utf8").replace(/\r\n/g, "\n").split("\n");
  const workflow: Workflow = { file, permissions: null, jobs: [] };
  const topPermissions = lines.findIndex((line) => /^permissions:\s*$/.test(line));
  if (topPermissions >= 0) workflow.permissions = entries(lines, topPermissions, 2);
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const starts: Array<{ name: string; at: number }> = [];
  for (let index = jobsAt + 1; index < lines.length; index += 1) {
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[index]);
    if (match) starts.push({ name: match[1], at: index });
  }
  starts.forEach((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1].at : lines.length;
    const body = lines.slice(start.at + 1, end);
    const permissionsAt = body.findIndex((line) => /^ {4}permissions:\s*$/.test(line));
    const calls = body.map((line) => /^ {4}uses:\s*(\S+)/.exec(line)?.[1]).find(Boolean) ?? null;
    workflow.jobs.push({
      name: start.name,
      permissions: permissionsAt >= 0 ? entries(body, permissionsAt, 6) : null,
      text: body.filter((line) => !line.trim().startsWith("#")).join("\n"),
      calls: calls ?? null,
    });
  });
  return workflow;
}

const workflows = readdirSync(directory)
  .filter((file) => file.endsWith(".yml"))
  .map(parse);

const effective = (workflow: Workflow, job: Job): Permissions => job.permissions ?? workflow.permissions ?? {};
const runsRepositoryCode = (job: Job): boolean => /\bnpm (ci|test|run|install)\b|\bnpx\b/.test(job.text);
const elevated = (permissions: Permissions): string[] =>
  Object.entries(permissions)
    .filter(([name, level]) => level === "write" && name !== "contents")
    .map(([name]) => name);

describe("workflow permissions are least privilege (G3-06)", () => {
  it("finds the three workflows and their jobs", () => {
    expect(workflows.map((workflow) => workflow.file).sort()).toEqual(["ci.yml", "deploy.yml", "publish.yml"]);
    const deploy = workflows.find((workflow) => workflow.file === "deploy.yml")!;
    expect(deploy.jobs.map((job) => job.name)).toEqual(["preflight", "deploy", "release", "publish"]);
  });

  it.each(workflows.map((workflow) => [workflow.file, workflow] as const))("%s grants nothing but read access at the workflow level", (_file, workflow) => {
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  // `npm publish` runs the package's prepublishOnly script (build and tests), so this one job executes repository
  // code while it holds the publish token. It may hold packages: write and nothing else; splitting it into a build
  // job and a publish job needs pinned artifact actions, which this repository does not use yet.
  const PUBLISHES_THROUGH_NPM_HOOKS = "publish.yml:npm";

  it.each(workflows.flatMap((workflow) => workflow.jobs.map((job) => [`${workflow.file}:${job.name}`, workflow, job] as const)))(
    "%s: a job that runs repository code (npm ci, tests, builds) holds no write permission",
    (label, workflow, job) => {
      if (!runsRepositoryCode(job)) return;
      const permissions = effective(workflow, job);
      expect(elevated(permissions)).toEqual(label === PUBLISHES_THROUGH_NPM_HOOKS ? ["packages"] : []);
      expect(permissions.contents ?? "none").not.toBe("write");
    },
  );

  it("grants id-token: write only to the one job that authenticates to GCP, and that job runs no npm", () => {
    const holders = workflows.flatMap((workflow) =>
      workflow.jobs.filter((job) => effective(workflow, job)["id-token"] === "write").map((job) => `${workflow.file}:${job.name}`),
    );
    expect(holders).toEqual(["deploy.yml:deploy"]);
    const deploy = workflows.find((workflow) => workflow.file === "deploy.yml")!.jobs.find((job) => job.name === "deploy")!;
    expect(deploy.text).toContain("google-github-actions/auth@");
    expect(runsRepositoryCode(deploy)).toBe(false);
  });

  it("grants packages: write only to the jobs that publish, none of which is a preflight", () => {
    const holders = workflows.flatMap((workflow) =>
      workflow.jobs.filter((job) => effective(workflow, job).packages === "write").map((job) => `${workflow.file}:${job.name}`),
    );
    expect(holders.sort()).toEqual(["deploy.yml:publish", "publish.yml:ghcr", "publish.yml:npm"]);
  });

  it("grants no attestations permission that no step uses", () => {
    for (const workflow of workflows) {
      for (const job of workflow.jobs) {
        if (effective(workflow, job).attestations === "write") expect(job.text).toMatch(/actions\/attest/);
      }
    }
  });

  it("never lets a calling job grant more than the workflow it calls can use", () => {
    const publish = workflows.find((workflow) => workflow.file === "publish.yml")!;
    const usable = new Set(publish.jobs.flatMap((job) => elevated(effective(publish, job))));
    const caller = workflows.find((workflow) => workflow.file === "deploy.yml")!.jobs.find((job) => job.calls === "./.github/workflows/publish.yml")!;
    for (const name of elevated(caller.permissions ?? {})) expect(usable.has(name)).toBe(true);
  });

  it("does not leave the job token in .git/config of jobs that install and run repository code", () => {
    for (const workflow of workflows.filter((candidate) => candidate.file !== "ci.yml")) {
      for (const job of workflow.jobs.filter(runsRepositoryCode)) {
        expect(job.text, `${workflow.file}:${job.name}`).toContain("persist-credentials: false");
      }
    }
  });

  it("keeps every third-party action pinned to a full commit SHA", () => {
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".yml"))) {
      const uses = [...readFileSync(path.join(directory, file), "utf8").matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
      for (const reference of uses.filter((value) => !value.startsWith("./"))) {
        expect(reference, `${file}: ${reference}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
