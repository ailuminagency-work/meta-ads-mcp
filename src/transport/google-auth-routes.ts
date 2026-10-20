import type express from "express";
import { buildGoogleAuthorizeUrl, exchangeGoogleCode, fetchGoogleIdentity, loadGoogleOAuthConfig } from "../auth/google-oauth.js";
import { generateOAuthStateNonce, signOAuthState, verifyOAuthState } from "../auth/oauth-state.js";
import { getSession } from "../auth/session.js";
import { getGoogleTokenRepo } from "../store/google-token-repo-singleton.js";
import { safeReturnTo } from "./auth-routes.js";
import { CONNECTIONS_PATH } from "./html-pages.js";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-google_oauth_state" : "google_oauth_state";

function error(res: express.Response, status: number, message: string): void {
  res.status(status).type("html").send(`<!doctype html><html><body><h1>Google connection error</h1><p>${message}</p></body></html>`);
}

export function mountGoogleAuthRoutes(app: express.Express, opts: { serverUrl: URL }): void {
  app.get("/auth/google", async (req, res) => {
    const session = await getSession(req);
    if (!session) return error(res, 401, "Sign in before connecting Google.");
    let config;
    try { config = loadGoogleOAuthConfig(opts.serverUrl); } catch { return error(res, 503, "Google OAuth is not configured."); }
    if (!config) return error(res, 503, "Google OAuth is not configured.");
    const returnTo = safeReturnTo(req.query.return, CONNECTIONS_PATH);
    const nonce = generateOAuthStateNonce();
    const state = await signOAuthState({ returnTo, nonce });
    res.cookie(COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/" });
    res.redirect(302, buildGoogleAuthorizeUrl(config, state));
  });

  app.get("/auth/google/callback", async (req, res) => {
    const session = await getSession(req);
    const cookies = (req as express.Request & { cookies?: Record<string, string> }).cookies;
    const nonce = cookies?.[COOKIE] ?? null;
    res.clearCookie(COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
    if (!session || !nonce || typeof req.query.state !== "string") return error(res, 400, "Google authorization state is invalid or expired.");
    const state = await verifyOAuthState(req.query.state, nonce);
    if (!state) return error(res, 400, "Google authorization state is invalid or expired.");
    if (typeof req.query.error === "string") return error(res, 400, "Google authorization was not completed.");
    if (typeof req.query.code !== "string") return error(res, 400, "Google authorization code is missing.");
    let config;
    try { config = loadGoogleOAuthConfig(opts.serverUrl); } catch { return error(res, 503, "Google OAuth is not configured."); }
    if (!config) return error(res, 503, "Google OAuth is not configured.");
    try {
      const tokens = await exchangeGoogleCode(config, req.query.code);
      const identity = await fetchGoogleIdentity(tokens.accessToken);
      const repo = getGoogleTokenRepo();
      const existing = await repo.getGrant(session.fbUserId);
      await repo.saveGrant({ userId: session.fbUserId, tokens, googleSubject: identity.subject, email: identity.email, existingRefreshToken: existing ? undefined : null });
      res.redirect(302, state.returnTo);
    } catch {
      error(res, 502, "Google connection failed. No credential was saved.");
    }
  });

  app.post("/auth/google/disconnect", async (req, res) => {
    const session = await getSession(req);
    if (!session) return error(res, 401, "Sign in before disconnecting Google.");
    await getGoogleTokenRepo().deleteGrant(session.fbUserId);
    res.redirect(303, CONNECTIONS_PATH);
  });
}
