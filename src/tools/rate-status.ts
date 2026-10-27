import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import { getAccessTokenHash } from "../auth/token-store.js";
import { READ } from "./_register.js";

// The limiter, circuit and pacer state is process-wide and every key embeds the
// owning token's hash. A multi-tenant server must only show the caller's own.
function ownedBy(tokenHash: string): (entry: { key: string }) => boolean {
  return (entry) => entry.key.split(":").includes(tokenHash);
}

/**
 * Read-only operator view of how close we are to Meta's throttles, which
 * circuits are open, and which access tier we're on. Useful both for agents
 * deciding whether to batch vs. retry and for humans investigating slowness.
 */
export function registerRateStatusTools(server: McpServer): void {
  server.registerTool(
    "ads_rate_status",
    {
      description:
        "Show the current Meta API rate-limit usage for the connected token across its accounts and use-case types, plus any open circuits and the write-pacer state. Does NOT call Meta — returns in-process state.",
      inputSchema: {},
      annotations: { ...READ },
    },
    async () => {
      const snapshot = metaApiClient.getUsageSnapshot();
      let mine: (entry: { key: string }) => boolean = () => false;
      try {
        mine = ownedBy(getAccessTokenHash());
      } catch {
        // No token resolves for this request, so there is no state of its own to show.
      }
      const usage = snapshot.usage.filter(mine);
      const circuits = snapshot.circuits.filter(mine);
      const writePacer = snapshot.writePacer.filter(mine);

      if (usage.length === 0 && circuits.length === 0 && writePacer.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No Meta API usage recorded yet for this connection.",
            },
          ],
        };
      }

      const now = Date.now();
      const lines: string[] = [];

      if (circuits.length > 0) {
        lines.push("🚨 OPEN CIRCUITS (requests blocked):");
        for (const c of circuits) {
          const sec = Math.ceil((c.openUntil - now) / 1000);
          lines.push(
            `  • ${c.key} — ${c.reason} — ${sec}s remaining — trips: ${c.tripCount}${c.lastError ? ` — last: ${c.lastError}` : ""}`,
          );
        }
        lines.push("");
      } else {
        lines.push("✓ No open circuits.");
        lines.push("");
      }

      if (usage.length > 0) {
        lines.push("Usage buckets (% of quota):");
        for (const b of usage) {
          const maxPct = Math.max(b.callCount, b.cpuTime, b.totalTime);
          const retry =
            b.estimatedTimeToRegainAccessMs > 0
              ? ` | retry-after: ${Math.round(b.estimatedTimeToRegainAccessMs / 1000)}s`
              : "";
          const tier = b.adsApiAccessTier ? ` | tier: ${b.adsApiAccessTier}` : "";
          lines.push(
            `  • [${b.kind}] ${b.key} — call:${b.callCount}% cpu:${b.cpuTime}% time:${b.totalTime}% (max ${maxPct}%)${retry}${tier}`,
          );
        }
        lines.push("");
      }

      if (writePacer.length > 0) {
        lines.push("Write pacer (Ads Management token-bucket):");
        for (const w of writePacer) {
          lines.push(
            `  • ${w.key} — ${w.tokens}/${w.capacity} tokens | ${w.rateRps} rps | tier: ${w.tier}`,
          );
        }
      }

      return {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: JSON.stringify({ usage, circuits, writePacer }, null, 2) },
        ],
      };
    },
  );
}
