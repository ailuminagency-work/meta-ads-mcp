import { platformEnabled } from "./platform/runtime.js";
import { installLegacyGuard } from "./platform/legacy-guard.js";
import { LEGACY_MANIFEST } from "./platform/legacy-manifest.js";
import { registerPlatformTools } from "./platform/tools.js";
import { PLATFORM_SERVER_INSTRUCTIONS } from "./platform/instructions.js";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";
import { SERVER_INSTRUCTIONS } from "./skills/instructions.js";
import { registerSkillPrompts } from "./skills/prompts.js";
import { registerSkillResources } from "./skills/resources.js";
import { logger } from "./utils/logger.js";

/**
 * Read from package.json rather than kept in step by hand: the two had already
 * drifted. `rootDir: src` rules out importing the file, so it is read at
 * startup, once, and a failure falls back rather than taking the server down.
 */
let cachedVersion: string | undefined;

function serverVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version)) {
      cachedVersion = version;
      return version;
    }
  } catch {
    // fall through
  }
  logger.warn({ event: "server_version_unknown" }, "Could not read the version from package.json");
  cachedVersion = "0.0.0";
  return cachedVersion;
}

/**
 * Create a new MCP server instance with all Meta Ads tools registered.
 *
 * In stateless HTTP mode, a new server is created per request.
 * In stdio mode, a single server is used for the session.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "meta-ads-mcp",
      version: serverVersion(),
    },
    { instructions: platformEnabled()?PLATFORM_SERVER_INSTRUCTIONS:SERVER_INSTRUCTIONS },
  );

  platformEnabled();
  const finishLegacyRegistration = installLegacyGuard(server);
  registerAllTools(server);
  finishLegacyRegistration();
  if (platformEnabled()) registerPlatformTools(server,new Set(LEGACY_MANIFEST.map(t=>t.name)));
  if (process.env.DEPLOYMENT_MODE === "agency" && process.env.AGENCY_WRITES_ENABLED !== "true") {
    const tools = (server as unknown as { _registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean }; disable(): void }> })._registeredTools;
    for (const [name, tool] of Object.entries(tools)) {
      if(platformEnabled()&&name==="ads_update_ad_url_tags")continue;
      if(name==="meta_discover_signal_assets"||name==="meta_prepare_app_promotion_access"||name==="meta_plan_ad_tracking_change"||name==="meta_plan_paused_ads"||name==="meta_prepare_action"||name==="meta_prepare_publication"||name==="meta_discover_ad_assets"||name==="meta_lookup_ad_targeting"||name==="meta_observe_ads_compatibility"||name==="meta_observe_account_owner")continue;
      if (tool.annotations?.readOnlyHint !== true || name === "ads_analyze_video" || name.startsWith("ads_library_")) tool.disable();
    }
  }
  registerSkillPrompts(server);
  registerSkillResources(server);

  return server;
}
