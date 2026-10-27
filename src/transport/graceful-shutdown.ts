import type { Server } from "node:http";
import { logger } from "../utils/logger.js";

const DEFAULT_GRACE_MS = 25_000;

interface ShutdownOptions {
  graceMs?: number;
  signals?: NodeJS.Signals[];
  signalSource?: Pick<NodeJS.Process, "on" | "off">;
  exit?: (code: number) => void;
}

/**
 * Stop taking new connections on SIGTERM/SIGINT and give in-flight requests
 * time to finish. Without this a redeploy ends the process mid-request, which
 * for multi-step writes (bulk ads, clone) can leave resources created on Meta
 * that the caller never hears about. A second signal exits immediately.
 *
 * The platform still has to leave a window between SIGTERM and SIGKILL (on
 * Railway: RAILWAY_DEPLOYMENT_DRAINING_SECONDS); this only uses that window.
 */
export function installGracefulShutdown(server: Server, options: ShutdownOptions = {}): () => void {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const signals = options.signals ?? ["SIGTERM", "SIGINT"];
  const source = options.signalSource ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn({ signal }, "Second shutdown signal; exiting now");
      exit(1);
      return;
    }
    shuttingDown = true;
    logger.info({ signal, graceMs }, "Shutting down: no new connections, waiting for in-flight requests");

    const forced = setTimeout(() => {
      logger.warn({ graceMs }, "Grace period elapsed; closing remaining connections");
      server.closeAllConnections();
      exit(1);
    }, graceMs);
    forced.unref();

    server.close((error) => {
      clearTimeout(forced);
      if (error) {
        logger.error({ err: error }, "Error while closing the HTTP server");
        exit(1);
        return;
      }
      logger.info("HTTP server closed cleanly");
      exit(0);
    });
    // Idle keep-alive sockets would otherwise hold close() open until the grace period ends.
    server.closeIdleConnections();
  };

  for (const signal of signals) source.on(signal, onSignal);
  return () => {
    for (const signal of signals) source.off(signal, onSignal);
  };
}
