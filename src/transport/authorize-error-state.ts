import type express from "express";

const MAX_STATE_LENGTH = 2048;

function withState(target: string, req: express.Request): string {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return target;
  }
  if (!url.searchParams.has("error") || url.searchParams.has("state")) return target;
  const state = req.method === "POST" ? req.body?.state : req.query?.state;
  if (typeof state !== "string" || state.length === 0 || state.length > MAX_STATE_LENGTH) return target;
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * The SDK's authorize handler reads `state` only after the request has passed
 * validation, so an error caused by validation itself (an unsupported
 * code_challenge_method, say) is redirected without it. RFC 6749 4.1.2.1 asks
 * for the client's state on every error response, so add it on the way out.
 */
export function echoStateOnAuthorizeErrors(): express.RequestHandler {
  return (req, res, next) => {
    const redirect = res.redirect.bind(res) as (status: number, url: string) => void;
    res.redirect = ((statusOrUrl: number | string, url?: string) => {
      if (typeof statusOrUrl === "number" && typeof url === "string") {
        redirect(statusOrUrl, withState(url, req));
      } else {
        redirect(302, withState(String(statusOrUrl), req));
      }
    }) as express.Response["redirect"];
    next();
  };
}
