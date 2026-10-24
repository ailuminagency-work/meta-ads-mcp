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
const styles = `:root{color-scheme:dark;--bg:#07101d;--panel:#0e1a2c;--panel2:#12233a;--line:#223957;--text:#f3f7ff;--muted:#94a8c4;--blue:#6aa7ff;--green:#5ed59a;--amber:#f6c96d;--red:#ff8b8b}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#08111f 0%,#0b1930 52%,#07101d 100%);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1280px;margin:0 auto;padding:20px 28px 64px}.topbar{display:flex;justify-content:space-between;align-items:center;gap:24px;border-bottom:1px solid var(--line);padding:8px 0 18px}.brand{display:flex;align-items:center;gap:11px;font-weight:850;letter-spacing:-.02em}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#76adff,#3e6fe0);color:#06101e;font-weight:950}.brand span{display:block;color:var(--muted);font-size:12px;font-weight:500;letter-spacing:0}.nav{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.nav a{color:#b9c9e2;text-decoration:none;padding:8px 11px;border-radius:8px}.nav a:hover,.nav a.active{background:#172d4a;color:#fff}.nav .signout{color:#91a6c2}.layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:30px}.sidebar{padding-top:30px}.sidebar-label{color:#627b9d;text-transform:uppercase;letter-spacing:.13em;font-size:10px;font-weight:800;margin:0 12px 8px}.side-link{display:flex;align-items:center;gap:9px;color:#a9bdd8;text-decoration:none;padding:10px 12px;border-radius:9px;margin:2px 0}.side-link:hover,.side-link.active{background:#142b49;color:#fff}.side-link .dot{width:7px;height:7px;border-radius:50%;background:#638fc9}.side-link.active .dot{background:var(--blue);box-shadow:0 0 0 4px #28466d}.main{min-width:0}.hero{display:flex;justify-content:space-between;gap:36px;align-items:end;padding:42px 0 30px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:#8fb4ed;font-size:11px;font-weight:800}.hero h1{font-size:clamp(30px,5vw,48px);line-height:1.04;letter-spacing:-.04em;margin:8px 0 12px}.hero p{max-width:720px;color:var(--muted);margin:0}.hero-note{max-width:285px;border:1px solid #31527e;background:#10243f;border-radius:14px;padding:15px;color:#c9dcfa;font-size:13px}.hero-note strong{display:block;margin-bottom:4px;color:#fff}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:26px}.metric,.panel,.client-card,.health-card{border:1px solid var(--line);background:rgba(14,26,44,.9);border-radius:16px}.metric{padding:18px}.metric strong{display:block;font-size:29px;line-height:1;color:#fff}.metric span{display:block;color:var(--muted);font-size:13px;margin-top:7px}.section-head{display:flex;justify-content:space-between;align-items:end;gap:16px;margin:0 0 14px}.section-head h2{margin:0;font-size:20px}.section-head p{margin:3px 0 0;color:var(--muted);font-size:13px}.search{display:flex;gap:8px}.input,select,button{font:inherit;border-radius:9px;padding:10px 12px}.input,select{background:#091525;color:var(--text);border:1px solid #3b5278}.input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #80b6ff;outline-offset:2px}.client-list{display:grid;gap:12px}.client-card{padding:20px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px}.client-title{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.client-title h3{margin:0;font-size:19px}.client-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#9ab5da;font-size:12px}.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:700;background:#203653;color:#cfe1ff}.pill.ok{background:#123d32;color:#8df0bc}.pill.wait{background:#4a3917;color:#ffd98a}.client-summary{color:var(--muted);margin:9px 0 0}.facts{display:flex;gap:16px;flex-wrap:wrap;margin:14px 0 0;color:#b7c8df;font-size:13px}.actions{display:flex;gap:9px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.button{display:inline-block;text-align:center;background:#4d8ff5;color:#fff;border:0;text-decoration:none;font-weight:750;cursor:pointer}.button.secondary{background:#203653;color:#dceaff}.button:hover{background:#72aaff;text-decoration:none}.health-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.health-card{padding:16px}.health-card h3{font-size:14px;margin:0 0 5px}.health-card p{color:var(--muted);font-size:13px;margin:0}.health-state{display:flex;align-items:center;gap:7px;color:var(--green);font-size:12px;font-weight:800}.health-state .status-dot{width:8px;height:8px;border-radius:50%;background:currentColor}.notice{border-left:3px solid var(--amber);background:#1d2a31;color:#d9e6f7;padding:10px 12px;border-radius:7px;font-size:13px}.notice.good{border-left-color:var(--green)}.forms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.panel{padding:22px;margin-top:24px}.panel h2{margin:0 0 6px;font-size:20px}.panel>p{color:var(--muted);margin:0 0 16px}.form-card{background:#0b1729;border:1px solid #243b5d;border-radius:13px;padding:18px}.form-card h3{margin:0 0 5px}.form-card p{color:var(--muted);font-size:13px;margin:0 0 15px}.form-card form{display:grid;gap:12px}.form-card label{display:grid;gap:6px;font-weight:650;font-size:13px}.check{display:flex!important;align-items:start;gap:8px;font-weight:500!important;color:#c2d0e4}.check input{margin-top:4px}.form-card button{border:0}.empty{border:1px dashed #3d5b81;border-radius:14px;padding:28px;color:var(--muted);text-align:center}.footer{color:#7f91ad;font-size:13px;margin-top:28px;border-top:1px solid #1f2e48;padding-top:18px}.error-page{max-width:650px;margin:12vh auto;padding:26px}.error-page h1{margin-top:0}.error-page p{color:var(--muted)}@media(max-width:880px){.layout{grid-template-columns:1fr}.sidebar{display:none}.hero{padding-top:30px}}@media(max-width:640px){.shell{padding:16px 16px 42px}.topbar{align-items:flex-start;flex-direction:column}.hero{display:block}.hero-note{margin-top:20px;max-width:none}.metrics,.forms,.health-grid{grid-template-columns:1fr}.section-head{display:block}.search{margin-top:12px}.search input{min-width:0;width:100%}.client-card{grid-template-columns:1fr}.actions{justify-content:flex-start}}`;
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
      const activeConnections = connections.filter(
        (c) =>
          c.revokedAt === null &&
          (c.expiresAt === null || c.expiresAt > Date.now()),
      ).length;
      const unassignedCount = allActive.filter(
        (c) => !member.allowedClientIds.includes(c.id),
      ).length;
      const body = `<main class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">L</span><div>Lumin<span>Agency operations</span></div></div><nav class="nav"><a class="active" href="/platform/clients/">Clients</a><a href="/platform/connections/">Meta connections</a><a class="signout" href="/auth/logout">Sign out</a></nav></header><div class="layout"><aside class="sidebar" aria-label="Operations navigation"><p class="sidebar-label">Workspace</p><a class="side-link active" href="/platform/clients/"><span class="dot"></span>Client management</a><a class="side-link" href="/platform/connections/"><span class="dot"></span>Meta connections</a><p class="sidebar-label">Controls</p><a class="side-link" href="#health"><span class="dot"></span>System health</a><a class="side-link" href="#onboard"><span class="dot"></span>Onboarding</a></aside><section class="main"><section class="hero"><div><div class="eyebrow">Internal operations console</div><h1>Client management</h1><p>Manage Lumin Agency's client roster, assign approved accounts, and move each client through a controlled Meta connection workflow.</p></div><aside class="hero-note"><strong>Administrator access verified</strong><span>Tenant-scoped actions are audited and protected by a short-lived review token.</span></aside></section><section class="metrics" aria-label="Client management metrics"><div class="metric"><strong>${allActive.length}</strong><span>Active clients</span></div><div class="metric"><strong>${member.allowedClientIds.length}</strong><span>Assigned to you</span></div><div class="metric"><strong>${activeConnections}</strong><span>Active Meta connections</span></div></section><section id="health" class="panel"><div class="section-head"><div><h2>Workspace health</h2><p>Operational signals from the authorized tenant registry. No secrets or provider tokens are displayed.</p></div><span class="pill ok">● Monitoring</span></div><div class="health-grid"><article class="health-card"><div class="health-state"><span class="status-dot"></span>Registry available</div><h3>Tenant data</h3><p>${allActive.length} active client profile${allActive.length === 1 ? "" : "s"} loaded.</p></article><article class="health-card"><div class="health-state"><span class="status-dot"></span>Access controlled</div><h3>Operator scope</h3><p>${member.allowedClientIds.length} client assignment${member.allowedClientIds.length === 1 ? "" : "s"} available to this operator.</p></article><article class="health-card"><div class="health-state"><span class="status-dot"></span>No spend actions</div><h3>Advertising safety</h3><p>Client management cannot create ads, change budgets, or activate spend.</p></article></div>${unassignedCount ? '<p class="notice">' + unassignedCount + ' active client' + (unassignedCount === 1 ? '' : 's') + ' still need operator assignment before Meta connection can begin.</p>' : '<p class="notice good">All active tenant clients are assigned to this operator.</p>'}</section><section><div class="section-head"><div><h2>Client roster</h2><p>Search and operate only on active clients in your authorized Lumin tenant.</p></div><form class="search" method="get"><input class="input" name="q" value="${escapeHtml(query)}" placeholder="Search by client ID" aria-label="Search clients"><button class="button secondary" type="submit">Search</button></form></div><div class="client-list">${cards || '<div class="empty">No matching active clients. Clear the search or create a new client profile below.</div>'}</div></section><section id="onboard" class="panel"><div class="section-head"><div><h2>Onboard a client</h2><p>Start with the registry. Meta authorization happens later through consent and fresh account discovery.</p></div><span class="pill">Internal only</span></div><div class="forms"><div class="form-card"><h3>Assign existing client</h3><p>Use this when the client already exists in the tenant registry.</p>${available.length ? '<form method="post"><input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '"><input type="hidden" name="action" value="assign"><label for="assign-client">Existing client<select id="assign-client" name="clientId" required><option value="">Select a client</option>' + options + '</select></label><label class="check"><input name="confirmed" type="checkbox" value="yes" required><span>I am authorized to manage this client for Lumin.</span></label><button class="button" type="submit">Assign client</button></form>' : '<div class="empty">All active tenant clients are already assigned to you.</div>'}</div><div class="form-card"><h3>Create client profile</h3><p>Create an internal profile first. Do not guess a Meta account ID; discovery follows authorized consent.</p><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="action" value="create"><label for="new-client">Internal client identifier<input class="input" id="new-client" name="clientId" pattern="[A-Za-z0-9_-]{1,128}" placeholder="amazing-decks-seattle" required></label><label class="check"><input name="confirmed" type="checkbox" value="yes" required><span>This is an approved Lumin client. Creating a profile does not grant Meta access.</span></label><button class="button" type="submit">Create profile</button></form></div></div></section><p class="footer">Security boundary: this internal console does not display secrets, accept provider tokens, change ownership, alter billing, create ads, change budgets, or activate spend.</p></section></div></main>`;
      const renderedBody = body.replace(
        "Do not guess a Meta account ID",
        "No Meta ad account ID is needed; do not guess one",
      );
      res.type("html").send(layout("Manage clients", renderedBody));
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
