#!/usr/bin/env node

import { parseArgs } from "node:util";
import {
  describeDeployment,
  resolveDeploymentMode,
  validateAgencyEnvironment,
  validatePlatformConfiguration,
  validateVideoConcurrency,
} from "./transport/deployment-config.js";
import { startWaitingTransport } from "./transport/waiting.js";
import { materializeGoogleCredentials } from "./transport/google-credentials.js";
import { logger } from "./utils/logger.js";

const { values } = parseArgs({
  options: {
    transport: {
      type: "string",
      short: "t",
      default: "http",
    },
    port: {
      type: "string",
      short: "p",
      default: process.env.PORT ?? "3000",
    },
  },
  strict: false,
});

const transport = values.transport ?? "http";
const port = parseInt(String(values.port ?? "3000"), 10);

async function main(): Promise<void> {
  const mode = resolveDeploymentMode();
  if (mode === "awaiting_credentials") {
    if (transport !== "http") throw new Error("Credential-waiting mode requires HTTP transport");
    logger.info(describeDeployment(mode), "Deployment configuration");
    await startWaitingTransport(port);
    return;
  }
  validateVideoConcurrency();
  if (mode === "agency") {
    const cleanup = materializeGoogleCredentials();
    process.once("exit", cleanup);
    validateAgencyEnvironment();
    await validatePlatformConfiguration();
  }
  logger.info(describeDeployment(mode), "Deployment configuration");
  const { createServer } = await import("./server.js");
  logger.info(
    { transport, port: transport === "http" ? port : undefined },
    "Starting Meta Ads MCP server",
  );

  if (transport === "stdio") {
    const server = createServer();
    const { startStdioTransport } = await import("./transport/stdio.js");
    await startStdioTransport(server);
  } else {
    const { startHttpTransport } = await import("./transport/http.js");
    await startHttpTransport(createServer, port);
  }
}

main().catch((error: unknown) => {
  // Pino serializes a bare Error inconsistently across transports (Railway
  // previously showed this as `error:{}`). Keep startup diagnostics useful
  // while limiting the payload to safe, non-secret fields. Validation errors
  // in this path contain only configuration names and sanitized reasons.
  const startupError = error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) };
  logger.fatal({ startupError }, "Failed to start server");
  process.exit(1);
});
