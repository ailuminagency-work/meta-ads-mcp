import express from "express";
import type { Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { logger } from "../../src/utils/logger.js";
import { createPlatformOAuthRouter } from "../../src/platform/oauth-router.js";
import type { PlatformOAuthService } from "../../src/platform/oauth.js";

let server: Server | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

it.each([
  ["Meta consent declined", "?error=access_denied&error_description=synthetic-private-value", "PROVIDER_CONSENT_DENIED"],
  ["Meta reported error", "?error=server_error&error_description=synthetic-private-value", "PROVIDER_AUTHORIZATION_ERROR"],
  ["missing state", "?code=synthetic-private-value", "CALLBACK_STATE_MISSING"],
  ["missing code", "?state=" + "a".repeat(64), "CALLBACK_CODE_MISSING"],
  ["unexpected fields", "?state=" + "a".repeat(64) + "&code=synthetic-code&extra=synthetic-private-value", "CALLBACK_QUERY_INVALID"],
])("classifies callback HTTP 400: %s without leaking query values", async (_label, query, expectedReason) => {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  const callback = vi.fn();
  const app = express();
  app.use("/oauth", createPlatformOAuthRouter({
    publicOrigin: "https://fixture.invalid",
    getSessionOperator: async () => "synthetic-operator",
    service: { callback } as unknown as PlatformOAuthService,
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server invalid");

  const response = await fetch(
    "http://127.0.0.1:" + address.port + "/oauth/meta-readonly/callback" + query,
    { redirect: "manual" },
  );
  expect(response.status).toBe(400);
  expect(callback).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    { event: "platform_oauth_callback_query_rejected", reason: expectedReason },
    "Platform OAuth callback input rejected",
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-private-value");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-operator");
});
