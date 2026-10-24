import express from "express";
import cookieParser from "cookie-parser";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { PlatformPrincipal } from "./models.js";
import type { PlatformRepository } from "./repository.js";
import { clientManagementHash, manageClient } from "./client-management.js";

const originCookie = "__Host-lumin-client-management";
const styles = `:root{color-scheme:dark;--bg:#09111f;--panel:#101c2f;--line:#263a59;--text:#edf4ff;--muted:#9aacc5;--blue:#5d9bff;--green:#60d39b;--amber:#f4c76b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0%,#15345d 0,#09111f 38%);color:var(--text);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1180px;margin:0 auto;padding:28px 22px 60px}.topbar{display:flex;justify-content:space-between;align-items:center;gap:20px;border-bottom:1px solid var(--line);padding-bottom:18px}.brand{font-weight:800}.brand span{display:block;color:var(--muted);font-size:12px;font-weight:500}.nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.nav a,.link{color:#b8d4ff;text-decoration:none}.nav a:hover,.link:hover{text-decoration:underline}.hero{display:flex;justify-content:space-between;gap:36px;align-items:end;padding:42px 0 30px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:#8fb4ed;font-size:11px;font-weight:800}.hero h1{font-size:clamp(30px,5vw,48px);line-height:1.04;margin:8px 0 12px}.hero p{max-width:700px;color:var(--muted);margin:0}.hero-note{max-width:260px;border:1px solid #31527e;background:#10223c;border-radius:14px;padding:14px;color:#c9dcfa;font-size:13px}.hero-note strong{display:block;margin-bottom:4px;color:#fff}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:26px}.metric,.panel,.client-card{border:1px solid var(--line);background:rgba(16,28,47,.88);border-radius:16px}.metric{padding:18px}.metric strong{display:block;font-size:29px;line-height:1;color:#fff}.metric span{display:block;color:var(--muted);font-size:13px;margin-top:7px}.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:end;margin:0 0 14px}.toolbar h2{margin:0;font-size:20px}.toolbar p{margin:3px 0 0;color:var(--muted);font-size:13px}.search{display:flex;gap:8px}.input,select,button{font:inherit;border-radius:9px;padding:10px 12px}.input,select{background:#0b1628;color:var(--text);border:1px solid #3b5278}.input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #80b6ff;outline-offset:2px}.client-list{display:grid;gap:12px}.client-card{padding:20px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px}.client-title{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.client-title h3{margin:0;font-size:19px}.client-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#9ab5da;font-size:12px}.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:700;background:#203653;color:#cfe1ff}.pill.ok{background:#123d32;color:#8df0bc}.pill.wait{background:#4a3917;color:#ffd98a}.client-summary{color:var(--muted);margin:9px 0 0}.facts{display:flex;gap:16px;flex-wrap:wrap;margin:14px 0 0;color:#b7c8df;font-size:13px}.actions{display:flex;gap:9px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.button{display:inline-block;text-align:center;background:#4d8ff5;color:#fff;border:0;text-decoration:none;font-weight:750;cursor:pointer}.button.secondary{background:#203653;color:#dceaff}.button:hover{background:#72aaff;text-decoration:none}.forms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.panel{padding:22px;margin-top:24px}.panel h2{margin:0 0 6px;font-size:20px}.panel>p{color:var(--muted);margin:0 0 16px}.form-card{background:#0d192c;border:1px solid #243b5d;border-radius:13px;padding:18px}.form-card h3{margin:0 0 5px}.form-card p{color:var(--muted);font-size:13px;margin:0 0 15px}.form-card form{display:grid;gap:12px}.form-card label{display:grid;gap:6px;font-weight:650;font-size:13px}.check{display:flex!important;align-items:start;gap:8px;font-weight:500!important;color:#c2d0e4}.check input{margin-top:4px}.form-card button{border:0}.empty{border:1px dashed #3d5b81;border-radius:14px;padding:28px;color:var(--muted);text-align:center}.footer{color:#7f91ad;font-size:13px;margin-top:28px;border-top:1px solid #1f2e48;padding-top:18px}.error-page{max-width:650px;margin:12vh auto;padding:26px}.error-page h1{margin-top:0}.error-page p{color:var(--muted)}@media(max-width:760px){.hero{display:block}.hero-note{margin-top:20px;max-width:none}.metrics,.forms{grid-template-columns:1fr}.toolbar{display:block}.search{margin-top:12px}.search input{min-width:0;width:100%}.client-card{grid-template-columns:1fr}.actions{justify-content:flex-start}.shell{padding:20px 16px 42px}}`;
const styleHash = createHash("sha256").update(styles).digest("base64");
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const equal = (a: string, b: string) =>
  /^[A-Za-z0-9._-]{1,3000}$/.test(a) &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const reviewSchema = z
  .object({
    principal: z
      .object({ tenantId: z.string(), operatorId: z.string() })
      .strict(),
    memberHash: z.string().regex(/^[a-f0-9]{64}$/),
    expires: z.number().int().positive(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
function layout(title: string, body: string) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escapeHtml(title) +
    " · Lumin</title><style>" +
    styles +
    "</style></head><body>" +
    body +
    "</body></html>"
  );
}

export function createClientManagementRouter(deps: {
  origin: string;
  csrfSecret: string;
  repo: PlatformRepository;
  resolveSession(req: express.Request): Promise<PlatformPrincipal | null>;
}) {
  if (
    new URL(deps.origin).origin !== deps.origin ||
    new URL(deps.origin).protocol !== "https:" ||
    deps.csrfSecret.length < 32
  )
    throw new Error("CLIENT_MANAGEMENT_ORIGIN_REQUIRED");
  const router = express.Router();
  const sign = (payload: string) =>
    createHmac("sha256", deps.csrfSecret).update(payload).digest("hex");
  router.use(cookieParser());
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'sha256-" +
        styleHash +
        "'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  const access = async (req: express.Request) => {
    const principal = await deps.resolveSession(req);
    if (!principal) throw new Error("no session");
    const [trusted, tenant, member] = await Promise.all([
      deps.repo.resolvePrincipal(principal.operatorId),
      deps.repo.get("tenants", principal.tenantId, principal.tenantId),
      deps.repo.get("members", principal.tenantId, principal.operatorId),
    ]);
    if (
      !trusted ||
      clientManagementHash(trusted) !== clientManagementHash(principal) ||
      !tenant ||
      tenant.status !== "ACTIVE" ||
      tenant.migrationState !== "READY" ||
      !member ||
      member.tenantId !== principal.tenantId ||
      member.operatorId !== principal.operatorId ||
      member.disabledAt !== null ||
      !member.roles.includes("admin")
    )
      throw new Error("not admin");
    return { principal, member };
  };
  const makeProof = (
    principal: PlatformPrincipal,
    member: {
      operatorId: string;
      tenantId: string;
      roles: string[];
      allowedClientIds: string[];
      revision: number;
      disabledAt: number | null;
    },
  ) => {
    const payload = Buffer.from(
      JSON.stringify({
        principal,
        memberHash: clientManagementHash(member),
        expires: Date.now() + 300000,
        nonce: randomBytes(32).toString("hex"),
      }),
    ).toString("base64url");
    return payload + "." + sign(payload);
  };
  router.get("/", async (req, res) => {
    try {
      const { principal, member } = await access(req);
      const [allClients, connections, assets, grants] = await Promise.all([
        deps.repo.list("clients", principal.tenantId),
        deps.repo.list("connections", principal.tenantId),
        deps.repo.list("assets", principal.tenantId),
        deps.repo.list("grants", principal.tenantId),
      ]);
      const q =
        typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const clients = allClients
        .filter(
          (c) =>
            c.tenantId === principal.tenantId &&
            c.status === "ACTIVE" &&
            (!q || c.id.toLowerCase().includes(q)),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 100);
      const allActive = allClients.filter(
        (c) => c.tenantId === principal.tenantId && c.status === "ACTIVE",
      );
      const available = clients.filter(
        (c) => !member.allowedClientIds.includes(c.id),
      );
      const csrf = makeProof(principal, member);
      res.cookie(originCookie, csrf, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 300000,
      });
      const statusFor = (clientId: string) => {
        const keys = new Set(
          assets
            .filter((a) => a.clientId === clientId && a.revokedAt === null)
            .map((a) => a.key),
        );
        const connected = connections.some(
          (c) =>
            c.revokedAt === null &&
            (c.expiresAt === null || c.expiresAt > Date.now()) &&
            c.assetKeys.some((k) => keys.has(k)),
        );
        return {
          connected,
          assets: keys.size,
          grants: grants.filter(
            (g) => g.clientId === clientId && g.revokedAt === null,
          ).length,
        };
      };
      const cards = clients
        .map((c) => {
          const s = statusFor(c.id),
            assigned = member.allowedClientIds.includes(c.id),
            label = c.id.replace(/[-_]/g, " "),
            state = s.connected
              ? "Connected"
              : assigned
                ? "Ready to connect"
                : "Not assigned",
            pill = s.connected ? "ok" : assigned ? "wait" : "";
          return (
            '<article class="client-card"><div><div class="client-title"><h3>' +
            escapeHtml(label) +
            '</h3><span class="pill ' +
            pill +
            '">' +
            (s.connected ? "● " : "") +
            state +
            '</span></div><div class="client-id">' +
            escapeHtml(c.id) +
            '</div><p class="client-summary">' +
            (s.connected
              ? "A valid active Meta connection is recorded for this client."
              : assigned
                ? "This client is assigned to you and can begin the Meta consent flow."
                : "This client exists in the tenant but is not assigned to your operator.") +
            '</p><div class="facts"><span>Assets: ' +
            s.assets +
            "</span><span>Verified grants: " +
            s.grants +
            "</span><span>" +
            (assigned ? "Assigned to you" : "Tenant client") +
            '</span></div></div><div class="actions">' +
            (assigned
              ? '<a class="button" href="/platform/connections/?client_id=' +
                encodeURIComponent(c.id) +
                '">' +
                (s.connected ? "View connection" : "Connect in Meta") +
                "</a>"
              : '<span class="pill">Assignment required</span>') +
            "</div></article>"
          );
        })
        .join("");
      const options = available
        .map(
          (c) =>
            '<option value="' +
            escapeHtml(c.id) +
            '">' +
            escapeHtml(c.id.replace(/[-_]/g, " ")) +
            "</option>",
        )
        .join("");
      const query = typeof req.query.q === "string" ? req.query.q : "";
      const body =
        '<main class="shell"><header class="topbar"><div class="brand">Lumin<span>Agency control plane</span></div><nav class="nav"><a href="/platform/connections/">Meta connections</a><a href="/auth/logout">Sign out</a></nav></header><section class="hero"><div><div class="eyebrow">Client administration</div><h1>Manage your clients</h1><p>Keep your agency roster organized, assign approved clients to operators, and start secure Meta connections from one place. Client ownership, billing, credentials, and advertising permissions remain separate controls.</p></div><aside class="hero-note"><strong>Administrator access verified</strong>Changes are tenant-scoped, audited, and protected by a short-lived review token.</aside></section><section class="metrics"><div class="metric"><strong>' +
        allActive.length +
        '</strong><span>Active tenant clients</span></div><div class="metric"><strong>' +
        member.allowedClientIds.length +
        '</strong><span>Assigned to your operator</span></div><div class="metric"><strong>' +
        connections.filter(
          (c) =>
            c.revokedAt === null &&
            (c.expiresAt === null || c.expiresAt > Date.now()),
        ).length +
        '</strong><span>Active connections</span></div></section><section><div class="toolbar"><div><h2>Client roster</h2><p>Only active clients in your authorized Lumin tenant are shown.</p></div><form class="search" method="get"><input class="input" name="q" value="' +
        escapeHtml(query) +
        '" placeholder="Search clients" aria-label="Search clients"><button class="button secondary" type="submit">Search</button></form></div><div class="client-list">' +
        (cards ||
          '<div class="empty">No matching active clients. Clear the search or create a new client profile below.</div>') +
        '</div></section><section class="panel"><h2>Onboard a client</h2><p>Choose the workflow that matches the registry state. Neither action grants Meta access or creates advertising permissions.</p><div class="forms"><div class="form-card"><h3>Assign existing client</h3><p>Use this when the client already exists in the authorized tenant registry.</p>' +
        (available.length
          ? '<form method="post"><input type="hidden" name="csrf" value="' +
            escapeHtml(csrf) +
            '"><input type="hidden" name="action" value="assign"><label for="assign-client">Existing client<select id="assign-client" name="clientId" required><option value="">Select a client</option>' +
            options +
            '</select></label><label class="check"><input name="confirmed" type="checkbox" value="yes" required><span>I am authorized to manage this client for Lumin.</span></label><button class="button" type="submit">Assign client</button></form>'
          : '<div class="empty">All active tenant clients are already assigned to you.</div>') +
        '</div><div class="form-card"><h3>Create client profile</h3><p>Create an internal profile first. No Meta ad account ID is needed now; the real account is discovered only after authorized consent.</p><form method="post"><input type="hidden" name="csrf" value="' +
        escapeHtml(csrf) +
        '"><input type="hidden" name="action" value="create"><label for="new-client">Internal client identifier<input class="input" id="new-client" name="clientId" pattern="[A-Za-z0-9_-]{1,128}" placeholder="amazing-decks-seattle" required></label><label class="check"><input name="confirmed" type="checkbox" value="yes" required><span>This is an approved client of our agency. Creating a profile does not prove Meta access.</span></label><button class="button" type="submit">Create profile</button></form></div></div></section><p class="footer">Security boundary: this portal does not display secrets, accept provider tokens, change client ownership, alter billing, create ads, change budgets, or activate spend.</p></main>';
      res.type("html").send(layout("Manage clients", body));
    } catch {
      res
        .status(403)
        .type("html")
        .send(
          layout(
            "Access required",
            '<main class="error-page"><div class="eyebrow">Client administration</div><h1>Administrator access required</h1><p>This area is limited to an authorized Lumin tenant administrator. No client, credential, Meta permission, or advertising setting was changed.</p><p><a class="link" href="/platform/connections/">Return to Meta connections</a></p></main>',
          ),
        );
    }
  });
  router.post(
    "/",
    express.urlencoded({ extended: false, limit: "8kb" }),
    async (req, res) => {
      try {
        const { principal, member } = await access(req);
        const body = z
          .object({
            csrf: z.string().max(3000),
            action: z.enum(["create", "assign"]),
            clientId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
            confirmed: z.literal("yes"),
          })
          .strict()
          .parse(req.body);
        const stored = req.cookies?.[originCookie];
        if (
          req.get("origin") !== deps.origin ||
          typeof stored !== "string" ||
          !equal(stored, body.csrf)
        )
          throw new Error("origin or cookie");
        const [payload, signature, ...extra] = body.csrf.split(".");
        if (
          !payload ||
          !signature ||
          extra.length ||
          !equal(signature, sign(payload))
        )
          throw new Error("signature");
        const review = reviewSchema.parse(
          JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        );
        if (
          review.expires <= Date.now() ||
          review.expires > Date.now() + 300000 ||
          clientManagementHash(review.principal) !==
            clientManagementHash(principal) ||
          review.memberHash !== clientManagementHash(member)
        )
          throw new Error("stale review");
        await manageClient(
          deps.repo,
          principal,
          body.action,
          body.clientId,
          review.memberHash,
        );
        res.clearCookie(originCookie, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
        });
        const verb =
          body.action === "assign" ? "assigned to your operator" : "created";
        res
          .type("html")
          .send(
            layout(
              "Client updated",
              '<main class="error-page"><div class="eyebrow">Client administration</div><h1>Client ' +
                verb +
                "</h1><p><strong>" +
                escapeHtml(body.clientId) +
                '</strong> is now ready for the next step. No Meta access, credentials, grants, ownership, billing, or spending permission was created.</p><p><a class="button" href="/platform/connections/?client_id=' +
                encodeURIComponent(body.clientId) +
                '">Continue to Meta connections</a></p><p><a class="link" href="/platform/clients/">Return to client roster</a></p></main>',
            ),
          );
      } catch {
        res
          .status(403)
          .type("html")
          .send(
            layout(
              "Client not changed",
              '<main class="error-page"><div class="eyebrow">Request rejected</div><h1>Client was not changed</h1><p>The review expired, the session changed, the client is invalid, or the requested action is not authorized. Refresh the roster and try again.</p><p><a class="link" href="/platform/clients/">Return to client roster</a></p></main>',
            ),
          );
      }
    },
  );
  return router;
}
