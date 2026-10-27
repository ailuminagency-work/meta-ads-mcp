import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The outbound-request inventory, kept as a test. Everything in src that can
 * reach a network or start a process is listed here with the reason it is
 * allowed. A new fetch, socket, child process or provider host that is not
 * listed fails this file, so adding one is a deliberate act with a reviewer
 * looking at this manifest rather than something a refactor does silently.
 *
 * Two kinds of destination exist:
 *   1. Fixed host: the origin is a literal in the module (graph.facebook.com
 *      and the like). The caller can choose a path and parameters, never a host.
 *   2. Influenced: the host comes from data this server did not write (a
 *      creative's picture field, an Ad Library record, a URL a user pastes).
 *      Those only go through the guarded downloaders in src/utils and
 *      src/media, which pin DNS, allow https on 443 only, re-validate every
 *      redirect, and cap size and time.
 *
 * The rules are plain functions over parsed files, so the last describe block
 * runs them over small synthetic sources to prove each one fires.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Hosts this server connects to. */
const EGRESS_HOSTS = new Set([
  "graph.facebook.com",
  "graph-video.facebook.com",
  "graph.instagram.com",
  "api.instagram.com",
  "graph.threads.com",
  "api.apify.com",
  "generativelanguage.googleapis.com",
]);

/** Hosts that appear in src as links, redirect targets or scraper input and are never contacted by the server. */
const REFERENCE_HOSTS = new Set([
  "ai.google.dev",
  "aistudio.google.com",
  "apify.com",
  "claude.ai",
  "claude.com",
  "connect.facebook.net",
  "console.apify.com",
  "developers.facebook.com",
  "docs.apify.com",
  "fb.me",
  "github.com",
  "localhost",
  "mcp.local",
  "wa.me",
  "web.facebook.com",
  "www.facebook.com",
  "www.instagram.com",
  "www.postman.com",
]);

const NETWORK_MODULES = new Set([
  "http", "https", "http2", "net", "tls", "dgram", "dns", "dns/promises", "undici", "axios", "node-fetch", "got", "ws", "cross-fetch", "superagent",
]);

/** Value imports of a network module; type-only imports reach nothing. */
const APPROVED_NETWORK_IMPORTS: Record<string, string[]> = {
  "utils/url-guard.ts": ["dns", "net"],
  "utils/safe-download.ts": ["https"],
  "utils/safe-video-download.ts": ["https"],
  "media/safe-video-download.ts": ["https"],
  "transport/http.ts": ["net"],
  "auth/client-registration-policy.ts": ["net"],
  "utils/client-ip-key.ts": ["net"],
};

/**
 * Files that own a guarded downloader. Anything that fetches a URL taken from
 * data goes through one of the three request modules.
 */
const GUARD_MODULES = ["utils/safe-download.ts", "utils/safe-video-download.ts", "media/safe-video-download.ts"];

/**
 * Fetch call sites whose destination the analysis cannot read off the code,
 * with why each is still fixed-host (or, for the one influenced site, how it
 * is confined). The count is a ceiling: a second site in the same file fails.
 */
const UNRESOLVED_FETCH_SITES: Record<string, { max: number; reason: string }> = {
  "apify/client.ts": { max: 1, reason: "url comes from buildUrl(), which is `${APIFY_BASE_URL}${path}` with the base a module constant (https://api.apify.com)" },
  "auth/meta-oauth-request.ts": { max: 1, reason: "every caller (auth/meta-oauth.ts) builds the url on the META_GRAPH constant" },
  "gemini/client.ts": { max: 1, reason: "urls are GEMINI_BASE_URL paths, and the resumable upload url is rejected unless its host is exactly generativelanguage.googleapis.com on https without userinfo or port" },
  "meta/client.ts": { max: 1, reason: "baseUrl is constructor configuration defaulting to https://graph.facebook.com; strict mode additionally asserts origin === https://graph.facebook.com before every fetch" },
  "platform/catalog-campaign-client.ts": { max: 1, reason: "the url is built by the read() helper on https://graph.facebook.com/v26.0/" },
  "platform/compatibility-observer.ts": { max: 1, reason: "boundedRead() takes graph.facebook.com/v26.0 urls only; every caller passes a literal-origin url" },
  "platform/gemini-bounded.ts": { max: 1, reason: "endpoint is the literal https://generativelanguage.googleapis.com/v1beta/models/ plus a policy model name" },
  "platform/instagram-token-continuity.ts": { max: 1, reason: "read() is called with new URL('https://graph.instagram.com/...') only" },
  "platform/lifecycle-provider.ts": { max: 1, reason: "request() is called with urls built on the literal graph.threads.com or graph.facebook.com origins" },
  "platform/oauth-instagram.ts": { max: 1, reason: "request() is called with literal api.instagram.com / graph.instagram.com urls" },
  "platform/oauth-threads.ts": { max: 1, reason: "request() is called with literal graph.threads.com urls" },
  "platform/registry-snapshot.ts": { max: 1, reason: "not a network call: `fetch` is a local callback parameter of the snapshot reader" },
  "platform/whatsapp-flow-client.ts": {
    max: 1,
    reason:
      "INFLUENCED: the Flow JSON download_url comes from a Graph response. It is fetched only when https, without userinfo or port, on *.fbcdn.net, with redirect:'error', a 15 s signal and a 64 KiB body cap. DNS is not pinned here (the host is Meta's own CDN)",
  },
};

/** Files that run a child process, and which of the two spawn APIs they use. */
const CHILD_PROCESS_FILES: Record<string, "execFile" | "spawn"> = {
  "media/ffmpeg.ts": "execFile",
  "platform/attachment-source.ts": "spawn",
  "platform/instagram-mp4-decoder.ts": "spawn",
  "platform/mp4-decoder.ts": "spawn",
  "platform/video-inspection-decoder.ts": "spawn",
};

/** Files that run a child process with the environment pinned to PATH. */
const ENV_PINNED_PROCESS_FILES = ["media/ffmpeg.ts", "platform/attachment-source.ts", "platform/video-inspection-decoder.ts"];

/**
 * Files that call a guarded downloader. `allowlist: true` means the url is
 * Meta-origin or Ad-Library data and the file must name allowedHostSuffixes
 * itself or go through media/creative-images, which defaults to Meta's CDN.
 */
const DOWNLOADER_USERS: Record<string, { allowlist: boolean; reason: string }> = {
  "media/creative-images.ts": { allowlist: true, reason: "Meta-origin creative images; defaults to Meta's CDN hosts" },
  "media/video-delivery.ts": { allowlist: true, reason: "video and poster urls; thumbnails always on the allowlist, video downloads default to it" },
  "tools/ads-library.ts": { allowlist: true, reason: "Ad Library images, host-checked per asset" },
  "tools/creative-media.ts": { allowlist: false, reason: "passes the downloader to media/creative-images, which applies the allowlist" },
  "tools/creatives.ts": { allowlist: false, reason: "USER-SUPPLIED image_url for upload to Meta: any public https host on 443, pinned DNS, no private ranges" },
  "gemini/video-analysis.ts": { allowlist: false, reason: "uses media/safe-video-download, which restricts every hop to Meta's CDN hosts unless the operator overrides the list" },
  "platform/public-research-media.ts": { allowlist: true, reason: "Apify Ad Library media, .fbcdn.net only" },
  "platform/image-inspection-client.ts": { allowlist: true, reason: "registered client images" },
  "platform/video-inspection-client.ts": { allowlist: true, reason: "registered client videos" },
  "platform/marketing-image-client.ts": { allowlist: true, reason: "registered client images" },
  "platform/marketing-video-client.ts": { allowlist: true, reason: "registered client videos" },
};

/** The legacy clients keep fetch's default redirect handling (see the test that uses this). */
const FOLLOWS_REDIRECTS = new Set(["apify/client.ts", "meta/client.ts", "platform/registry-snapshot.ts"]);

const FETCH_CALLEE = /^(globalThis\.)?fetch$|(^|\.)(fetcher|fetchImpl|fetchFn|doFetch)$|\?\?\s*(globalThis\.)?fetch\)?$/;
const FETCH_ALIAS = /^(globalThis\.)?fetch$|\?\?\s*(globalThis\.)?fetch$/;
const WATCHED_ALIAS_NAMES = /^(fetcher|fetchImpl|fetchFn|doFetch)$/;

interface Parsed {
  rel: string;
  text: string;
  sf: ts.SourceFile;
}

function parse(rel: string, text: string): Parsed {
  return { rel, text, sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true) };
}

async function listSource(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSource(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function moduleName(specifier: string): string {
  return specifier.replace(/^node:/, "");
}

function hostOf(prefix: string): string | undefined {
  return /^https:\/\/([^/?#:]+)/.exec(prefix)?.[1]?.toLowerCase();
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function walk(sf: ts.SourceFile, visit: (n: ts.Node) => void): void {
  const inner = (n: ts.Node): void => {
    visit(n);
    ts.forEachChild(n, inner);
  };
  inner(sf);
}

/** The static text a url expression starts with, followed through local bindings and module constants. */
function staticPrefix(expr: ts.Expression | undefined, bindings: Map<string, ts.Expression>, consts: Map<string, ts.Expression>, depth = 0): string | undefined {
  if (!expr || depth > 8) return undefined;
  const next = (e: ts.Expression | undefined) => staticPrefix(e, bindings, consts, depth + 1);
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return next(expr.expression);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isTemplateExpression(expr)) return expr.head.text || next(expr.templateSpans[0]?.expression);
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) return next(expr.left);
  if (ts.isNewExpression(expr) && expr.expression.getText() === "URL") {
    const [first, base] = expr.arguments ?? [];
    if (base) {
      const origin = next(base);
      if (origin && origin.startsWith("https://")) return origin;
    }
    return next(first);
  }
  if (ts.isIdentifier(expr)) {
    const init = bindings.get(expr.text) ?? consts.get(expr.text);
    return init ? next(init) : undefined;
  }
  if (ts.isElementAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const table = consts.get(expr.expression.text);
    if (table && ts.isObjectLiteralExpression(table)) {
      const values = table.properties.filter(ts.isPropertyAssignment).map((p) => next(p.initializer));
      if (values.length > 0 && values.every((v) => v?.startsWith("https://"))) return values.join("|");
    }
    return undefined;
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "toString") return next(expr.expression.expression);
  if (ts.isConditionalExpression(expr)) {
    const a = next(expr.whenTrue);
    const b = next(expr.whenFalse);
    return a && b ? `${a}|${b}` : undefined;
  }
  return undefined;
}

function bindingsAround(node: ts.Node): Map<string, ts.Expression> {
  const found = new Map<string, ts.Expression>();
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    if (!(ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isFunctionLike(cur) || ts.isCaseClause(cur))) continue;
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && !found.has(n.name.text)) found.set(n.name.text, n.initializer);
      if (ts.isFunctionLike(n) && n !== cur) return;
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(cur, visit);
  }
  return found;
}

function moduleConsts(sf: ts.SourceFile): Map<string, ts.Expression> {
  const consts = new Map<string, ts.Expression>();
  sf.forEachChild((n) => {
    if (!ts.isVariableStatement(n)) return;
    for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
  });
  return consts;
}

interface Site {
  file: string;
  line: number;
  callee: string;
  hosts: string[] | undefined;
}

function fetchSites(files: Parsed[]): Site[] {
  const out: Site[] = [];
  for (const { rel, sf } of files) {
    const consts = moduleConsts(sf);
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression.getText(sf);
      if (!FETCH_CALLEE.test(callee)) return;
      const prefix = staticPrefix(n.arguments[0], bindingsAround(n), consts);
      out.push({ file: rel, line: lineOf(sf, n), callee, hosts: prefix?.split("|").map((p) => hostOf(p) ?? `non-https:${p.slice(0, 30)}`) });
    });
  }
  return out;
}

function unknownHosts(files: Parsed[]): string[] {
  const unknown: string[] = [];
  for (const { rel, sf } of files) {
    const note = (value: string): void => {
      for (const match of value.matchAll(/\b(?:https?|wss?):\/\/([A-Za-z0-9._-]+)/g)) {
        const host = match[1].toLowerCase();
        if (!EGRESS_HOSTS.has(host) && !REFERENCE_HOSTS.has(host)) unknown.push(`${rel}: ${host}`);
      }
    };
    walk(sf, (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) note(n.text);
    });
  }
  return unknown;
}

function unexpectedNetworkImports(files: Parsed[]): string[] {
  const unexpected: string[] = [];
  for (const { rel, sf } of files) {
    const found: string[] = [];
    const add = (name: string): void => {
      if (NETWORK_MODULES.has(moduleName(name))) found.push(moduleName(name));
    };
    sf.forEachChild((n) => {
      if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier) || n.importClause?.isTypeOnly) return;
      const named = n.importClause?.namedBindings;
      const typeOnly = named && ts.isNamedImports(named) && !n.importClause?.name && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
      if (!typeOnly) add(n.moduleSpecifier.text);
    });
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0])) {
        if (n.expression.getText(sf) === "require" || n.expression.kind === ts.SyntaxKind.ImportKeyword) add(n.arguments[0].text);
      }
    });
    for (const name of found) if (!(APPROVED_NETWORK_IMPORTS[rel] ?? []).includes(name)) unexpected.push(`${rel} imports ${name}`);
  }
  return unexpected;
}

function fetchProblems(files: Parsed[]): string[] {
  const problems: string[] = [];
  const all = fetchSites(files);
  for (const s of all) {
    if (s.hosts && s.hosts.some((host) => !EGRESS_HOSTS.has(host))) problems.push(`${s.file}:${s.line} fetches ${s.hosts.join(",")}, which is not a known egress host`);
  }
  const perFile = new Map<string, number>();
  for (const s of all.filter((x) => !x.hosts)) perFile.set(s.file, (perFile.get(s.file) ?? 0) + 1);
  for (const [file, count] of perFile) {
    const approval = UNRESOLVED_FETCH_SITES[file];
    if (!approval) problems.push(`${file}: ${count} fetch call(s) to a destination the inventory cannot read; resolve it to a literal origin or list it with the reason`);
    else if (count > approval.max) problems.push(`${file}: ${count} unresolved fetch call(s), ${approval.max} approved`);
  }
  for (const { rel, sf } of files) {
    walk(sf, (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer && FETCH_ALIAS.test(n.initializer.getText(sf)) && !WATCHED_ALIAS_NAMES.test(n.name.getText(sf))) {
        problems.push(`${rel}:${lineOf(sf, n)} aliases fetch as ${n.name.getText(sf)}; name it fetcher or doFetch so the call stays visible`);
      }
      if (ts.isPropertyAssignment(n) && FETCH_ALIAS.test(n.initializer.getText(sf)) && !/^(fetcher|fetchImpl|fetchFn|doFetch|fetch)$/.test(n.name.getText(sf))) {
        problems.push(`${rel}:${lineOf(sf, n)} hands fetch to ${n.name.getText(sf)}; name it fetcher so the call stays visible`);
      }
    });
  }
  return problems;
}

function redirectOffenders(files: Parsed[]): string[] {
  const offenders: string[] = [];
  for (const { rel, sf, text } of files) {
    if (FOLLOWS_REDIRECTS.has(rel)) continue;
    walk(sf, (n) => {
      if (!ts.isCallExpression(n) || !FETCH_CALLEE.test(n.expression.getText(sf))) return;
      const options = n.arguments[1]?.getText(sf) ?? "";
      const direct = /redirect\s*:\s*["']error["']/.test(options);
      const viaVariable = /^[A-Za-z_$][\w$]*$/.test(options) && /redirect\s*:\s*["']error["']/.test(text);
      if (!direct && !viaVariable) offenders.push(`${rel}:${lineOf(sf, n)}`);
    });
  }
  return offenders;
}

function childProcessProblems(files: Parsed[]): string[] {
  const problems: string[] = [];
  const importers: string[] = [];
  for (const { rel, sf, text } of files) {
    sf.forEachChild((n) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && moduleName(n.moduleSpecifier.text) === "child_process") importers.push(rel);
    });
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression.getText(sf);
      if (/^(exec|execSync|execFileSync|spawnSync|fork)$/.test(callee)) problems.push(`${rel}:${lineOf(sf, n)} ${callee} is not allowed`);
      if (callee === "spawn" && !/shell\s*:\s*false/.test(n.arguments[2]?.getText(sf) ?? "")) problems.push(`${rel}:${lineOf(sf, n)} spawn without shell:false`);
      if ((callee === "execFile" || callee === "nodeExecFile") && /shell\s*:/.test(n.arguments.map((a) => a.getText(sf)).join(" "))) {
        problems.push(`${rel}:${lineOf(sf, n)} execFile with a shell option`);
      }
    });
    if (CHILD_PROCESS_FILES[rel] && !/protocol_whitelist/.test(text)) problems.push(`${rel} starts a media process without -protocol_whitelist`);
    if (ENV_PINNED_PROCESS_FILES.includes(rel) && !/env\s*:\s*\{\s*PATH\s*:\s*process\.env\.PATH\s*\}/.test(text)) problems.push(`${rel} lets its child process inherit the server's environment`);
  }
  for (const rel of importers) if (!CHILD_PROCESS_FILES[rel]) problems.push(`${rel} imports child_process and is not listed`);
  return problems;
}

function downloaderProblems(files: Parsed[]): string[] {
  const problems: string[] = [];
  for (const { rel, sf, text } of files) {
    if (GUARD_MODULES.includes(rel)) continue;
    let uses = false;
    walk(sf, (n) => {
      if (ts.isIdentifier(n) && (n.text === "downloadSafePublicImage" || n.text === "downloadSafePublicVideo") && !ts.isImportSpecifier(n.parent)) uses = true;
    });
    if (!uses) continue;
    const entry = DOWNLOADER_USERS[rel];
    if (!entry) problems.push(`${rel} calls a guarded downloader and is not listed in DOWNLOADER_USERS`);
    else if (entry.allowlist && !/allowedHostSuffixes|resolveAllowedMediaHostSuffixes|resolveAllowedVideoHostSuffixes/.test(text)) problems.push(`${rel} must pass allowedHostSuffixes`);
  }
  return problems;
}

let files: Parsed[];

beforeAll(async () => {
  files = await Promise.all(
    (await listSource(SRC)).map(async (full) => parse(path.relative(SRC, full).split(path.sep).join("/"), await fs.readFile(full, "utf8"))),
  );
}, 60_000);

describe("the source tree", () => {
  it("names only hosts this inventory knows", () => {
    expect(unknownHosts(files), "a new host needs an entry in EGRESS_HOSTS (contacted) or REFERENCE_HOSTS (never contacted)").toEqual([]);
    expect([...EGRESS_HOSTS].filter((host) => REFERENCE_HOSTS.has(host))).toEqual([]);
  });

  it("imports a network primitive only inside the guarded modules", () => {
    expect(unexpectedNetworkImports(files)).toEqual([]);
    for (const [rel, modules] of Object.entries(APPROVED_NETWORK_IMPORTS)) {
      const file = files.find((f) => f.rel === rel);
      expect(file, rel).toBeDefined();
      for (const name of modules) expect(file?.text, `${rel} ${name}`).toMatch(new RegExp(`from ["'](node:)?${name}["']`));
    }
  });

  it("finds the fetch sites it is meant to police", () => {
    const all = fetchSites(files);
    expect(all.length).toBeGreaterThan(60);
    expect(all.some((s) => s.file === "meta/client.ts")).toBe(true);
    expect(all.some((s) => s.file === "apify/client.ts")).toBe(true);
    for (const rel of Object.keys(UNRESOLVED_FETCH_SITES)) expect(files.some((f) => f.rel === rel), rel).toBe(true);
  });

  it("sends every fetch to a known host, or to a destination listed with the reason it is confined", () => {
    expect(fetchProblems(files)).toEqual([]);
  });

  it("refuses redirects on every fetch except the legacy clients with fixed origins", () => {
    // apify/client.ts and meta/client.ts (outside strict mode) keep fetch's default: their hosts are literal,
    // the Apify token travels in a header fetch strips on a cross-origin hop, and the Graph token sits in the
    // request's own query, which a Location header does not inherit.
    expect(redirectOffenders(files)).toEqual([]);
  });

  it("starts child processes only from the listed files, never through a shell, with media protocols restricted", () => {
    expect(childProcessProblems(files)).toEqual([]);
    const importers = files.filter((f) => /from ["'](node:)?child_process["']/.test(f.text)).map((f) => f.rel).sort();
    expect(importers).toEqual(Object.keys(CHILD_PROCESS_FILES).sort());
  });

  it("routes urls taken from data through the guarded downloaders, with an allowlist where the origin is Meta or the Ad Library", () => {
    expect(downloaderProblems(files)).toEqual([]);
  });

  it("keeps the properties of the guarded request modules", () => {
    for (const rel of GUARD_MODULES) {
      const text = files.find((f) => f.rel === rel)?.text ?? "";
      expect(text, rel).toContain("lookup: buildPinnedLookup(");
      expect(text, rel).toContain("followSafeRedirects(");
      expect(text, rel).toContain("isRedirect(");
      expect(text, rel).toContain("deadlineMs");
      expect(text, rel).toContain("maxBytes");
      expect(text, rel).toContain("setTimeout(");
    }
  });

  it("checks a redirect hop's shape and host policy before it is resolved", () => {
    const text = files.find((f) => f.rel === "utils/safe-http.ts")?.text ?? "";
    const hop = text.slice(text.indexOf("const resolveHop"));
    const shape = hop.indexOf("parseSafePublicUrl(");
    const policy = hop.indexOf("validateHop?.(");
    const dns = hop.indexOf("resolveSafePublicUrl(");
    expect(shape).toBeGreaterThan(-1);
    expect(shape).toBeLessThan(policy);
    expect(policy).toBeLessThan(dns);
  });
});

describe("the rules themselves", () => {
  const synthetic = (rel: string, text: string): Parsed[] => [parse(rel, text)];

  it("accepts a fetch to a literal origin, through a local binding or a constant", () => {
    expect(fetchProblems(synthetic("platform/a.ts", `const url = new URL("https://graph.facebook.com/v26.0/" + id); await fetch(url, { redirect: "error" });`))).toEqual([]);
    expect(fetchProblems(synthetic("platform/a.ts", `const BASE = "https://api.apify.com"; await fetch(\`\${BASE}/v2/x\`, { redirect: "error" });`))).toEqual([]);
    expect(fetchProblems(synthetic("platform/a.ts", `const HOSTS = { a: "https://graph.facebook.com", b: "https://graph.threads.com" }; const u = new URL("/x", HOSTS[p]); await fetcher(u);`))).toEqual([]);
  });

  it("flags a new raw fetch to a url that comes from data", () => {
    const problems = fetchProblems(synthetic("platform/new-thing.ts", `export async function pull(creative) { return fetch(creative.picture); }`));
    expect(problems.join("\n")).toMatch(/new-thing\.ts: 1 fetch call\(s\) to a destination the inventory cannot read/);
  });

  it("flags a new fetch through the injected fetcher, however it is reached", () => {
    for (const call of ["this.fetcher(target)", "(options.fetcher ?? fetch)(target)", "doFetch(target)", "globalThis.fetch(target)"]) {
      expect(fetchProblems(synthetic("tools/new-thing.ts", `function f(target) { return ${call}; }`)).length, call).toBeGreaterThan(0);
    }
  });

  it("flags a fetch to a literal host nobody listed", () => {
    const problems = fetchProblems(synthetic("platform/a.ts", `await fetch("https://collector.example.net/ingest", { redirect: "error" });`));
    expect(problems.join("\n")).toMatch(/collector\.example\.net, which is not a known egress host/);
  });

  it("flags a second unresolved fetch in a file that was approved for one", () => {
    const problems = fetchProblems(synthetic("platform/oauth-threads.ts", `function a(u) { return fetch(u); }\nfunction b(u) { return fetch(u); }`));
    expect(problems.join("\n")).toMatch(/2 unresolved fetch call\(s\), 1 approved/);
  });

  it("flags aliasing fetch under a name the inventory does not watch", () => {
    expect(fetchProblems(synthetic("platform/a.ts", `const go = fetch; go(url);`)).join("\n")).toMatch(/aliases fetch as go/);
    expect(fetchProblems(synthetic("platform/a.ts", `new Client({ transport: fetch });`)).join("\n")).toMatch(/hands fetch to transport/);
    expect(fetchProblems(synthetic("platform/a.ts", `const fetcher = options.fetcher ?? fetch; await fetcher(new URL("https://graph.facebook.com/x"), { redirect: "error" });`))).toEqual([]);
  });

  it("flags a host that appears in code and is on neither list", () => {
    expect(unknownHosts(synthetic("platform/a.ts", `const x = "https://exfil.example.net/collect"; const y = \`https://\${h}/\`;`))).toEqual(["platform/a.ts: exfil.example.net"]);
    expect(unknownHosts(synthetic("platform/a.ts", `const x = "https://graph.facebook.com/v26.0"; const y = "https://developers.facebook.com/docs";`))).toEqual([]);
  });

  it("flags a network primitive imported anywhere outside the guarded modules", () => {
    expect(unexpectedNetworkImports(synthetic("tools/a.ts", `import https from "node:https";`))).toEqual(["tools/a.ts imports https"]);
    expect(unexpectedNetworkImports(synthetic("tools/a.ts", `import { connect } from "node:net";`))).toEqual(["tools/a.ts imports net"]);
    expect(unexpectedNetworkImports(synthetic("tools/a.ts", `import * as undici from "undici";`))).toEqual(["tools/a.ts imports undici"]);
    expect(unexpectedNetworkImports(synthetic("tools/a.ts", `const dns = require("node:dns");`))).toEqual(["tools/a.ts imports dns"]);
    expect(unexpectedNetworkImports(synthetic("tools/a.ts", `const s = await import("node:tls");`))).toEqual(["tools/a.ts imports tls"]);
    expect(unexpectedNetworkImports(synthetic("tools/a.ts", `import type { Server } from "node:http"; import { type IncomingMessage } from "node:http";`))).toEqual([]);
    expect(unexpectedNetworkImports(synthetic("utils/safe-download.ts", `import https from "node:https";`))).toEqual([]);
  });

  it("flags a fetch that follows redirects", () => {
    expect(redirectOffenders(synthetic("platform/a.ts", `await fetch(new URL("https://graph.facebook.com/x"), { method: "GET" });`))).toEqual(["platform/a.ts:1"]);
    expect(redirectOffenders(synthetic("platform/a.ts", `await fetch(new URL("https://graph.facebook.com/x"), { redirect: "error" });`))).toEqual([]);
    expect(redirectOffenders(synthetic("apify/client.ts", `await fetch(url, { method: "GET" });`))).toEqual([]);
  });

  it("flags a child process through a shell, an unlisted process, or one that inherits the environment", () => {
    expect(childProcessProblems(synthetic("tools/a.ts", `import { exec } from "node:child_process"; exec("ls " + name);`)).join("\n")).toMatch(/exec is not allowed/);
    expect(childProcessProblems(synthetic("tools/a.ts", `import { spawn } from "node:child_process"; spawn("ffmpeg", args, { stdio: "pipe" });`)).join("\n")).toMatch(/spawn without shell:false/);
    expect(childProcessProblems(synthetic("tools/a.ts", `import { spawn } from "node:child_process"; spawn("ffmpeg", args, { shell: false });`)).join("\n")).toMatch(/imports child_process and is not listed/);
    expect(childProcessProblems(synthetic("media/ffmpeg.ts", `import { execFile } from "node:child_process"; execFile(bin, args, { shell: true });`)).join("\n")).toMatch(/execFile with a shell option/);
    expect(childProcessProblems(synthetic("media/ffmpeg.ts", `import { execFile } from "node:child_process"; const a = ["-protocol_whitelist", "file"]; execFile(bin, a, { env: process.env });`)).join("\n")).toMatch(/inherit the server's environment/);
    expect(childProcessProblems(synthetic("media/ffmpeg.ts", `import { execFile } from "node:child_process"; execFile(bin, ["-i", input], { env: { PATH: process.env.PATH } });`)).join("\n")).toMatch(/without -protocol_whitelist/);
  });

  it("flags a new caller of a guarded downloader, and an allowlisted caller that names no allowlist", () => {
    expect(downloaderProblems(synthetic("tools/new-thing.ts", `await downloadSafePublicImage(url);`)).join("\n")).toMatch(/not listed in DOWNLOADER_USERS/);
    expect(downloaderProblems(synthetic("media/creative-images.ts", `await downloadSafePublicImage(url, { maxBytes: 1 });`)).join("\n")).toMatch(/must pass allowedHostSuffixes/);
    expect(downloaderProblems(synthetic("media/creative-images.ts", `await downloadSafePublicImage(url, { allowedHostSuffixes });`))).toEqual([]);
    expect(downloaderProblems(synthetic("tools/new-thing.ts", `import { downloadSafePublicImage } from "../utils/safe-download.js";`))).toEqual([]);
  });
});
