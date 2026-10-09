#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolveDeploymentMode, validateAgencyEnvironment } from "./transport/deployment-config.js";
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
    await startWaitingTransport(port);
    return;
  }
  if (mode === "agency") {
    const cleanup = materializeGoogleCredentials();
    process.once("exit", cleanup);
    validateAgencyEnvironment();
  }
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

main().catch((error) => {
  logger.fatal({ error }, "Failed to start server");
  process.exit(1);
});
