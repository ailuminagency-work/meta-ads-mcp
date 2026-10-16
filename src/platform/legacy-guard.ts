import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PlatformDenied } from "./models.js";
import { platformEnabled } from "./runtime.js";
import { LEGACY_MANIFEST, LEGACY_MIGRATION_HOLD, validateLegacyManifest } from "./legacy-manifest.js";
import { executeStrictLegacyRead, LEGACY_CORE_READ_TOOLS, legacyClientSchema } from "./legacy-read.js";
import { executeStrictLegacyWrite, LEGACY_CORE_WRITE_TOOLS, legacyApprovalSchema } from "./legacy-write.js";

const installed = new WeakSet<McpServer>();
export function installLegacyGuard(server: McpServer): () => void {
  if(installed.has(server)) throw new PlatformDenied("LEGACY_GUARD_ALREADY_INSTALLED");
  validateLegacyManifest();
  installed.add(server);
  const original = server.registerTool;
  const seen = new Set<string>();
  const manifest = new Map(LEGACY_MANIFEST.map(entry => [entry.name,entry]));
  const wrapped = ((name: string, config: unknown, callback: unknown) => {
    if(typeof name !== "string" || typeof callback !== "function" || !config || typeof config !== "object") throw new PlatformDenied("LEGACY_REGISTRATION_INVALID");
    const entry = manifest.get(name);
    const settings = config as {inputSchema?: unknown;annotations?:{readOnlyHint?:boolean};description?:string};
    if(platformEnabled()) {
      if(!entry || seen.has(name)) throw new PlatformDenied("LEGACY_TOOL_MANIFEST_REQUIRED");
      const keys = settings.inputSchema && typeof settings.inputSchema === "object" ? Object.keys(settings.inputSchema).sort() : [];
      if(JSON.stringify(keys) !== JSON.stringify([...entry.inputKeys].sort()) || (settings.annotations?.readOnlyHint === true) !== entry.baselineReadOnlyHint) throw new PlatformDenied("LEGACY_TOOL_CONTRACT_DRIFT");
    }
    seen.add(name);
    const guarded = function(this: unknown,...args: unknown[]): unknown {
      if(platformEnabled()) {
        if(!entry) throw new PlatformDenied("LEGACY_TOOL_MANIFEST_REQUIRED");
        if(LEGACY_CORE_READ_TOOLS.includes(name)||LEGACY_CORE_WRITE_TOOLS.includes(name)) {
          const input=args[0];
          if(!input||typeof input!=="object"||Array.isArray(input))throw new PlatformDenied("CLIENT_CONTEXT_REQUIRED");
          return LEGACY_CORE_WRITE_TOOLS.includes(name)?executeStrictLegacyWrite(name,input as Record<string,unknown>):executeStrictLegacyRead(name,input as Record<string,unknown>);
        }
        throw new PlatformDenied(LEGACY_MIGRATION_HOLD);
      }
      return Reflect.apply(callback,this,args);
    };
    const nextConfig = platformEnabled() ? {...settings,
      ...(LEGACY_CORE_READ_TOOLS.includes(name)||LEGACY_CORE_WRITE_TOOLS.includes(name)?{inputSchema:{...(settings.inputSchema as Record<string,unknown>),client_id:legacyClientSchema,...(LEGACY_CORE_WRITE_TOOLS.includes(name)?{approval_id:legacyApprovalSchema}:{})}}:{}),
      description:`${LEGACY_CORE_WRITE_TOOLS.includes(name)?"Strict minimal PAUSED creation only: verified client ownership/billing, registered reference closure, current write eligibility and one-time human approval required. Complex inputs HOLD.":LEGACY_CORE_READ_TOOLS.includes(name)?"Strict client-scoped READ adapter: registered assets, current eligibility and selected credential required; bounded projection only.":LEGACY_MIGRATION_HOLD}\n${settings.description ?? ""}`} : config;
    return Reflect.apply(original,server,[name,nextConfig,guarded]);
  }) as McpServer["registerTool"];
  server.registerTool = wrapped;
  let finalized = false;
  return () => {
    if(finalized) return;
    if(platformEnabled() && (seen.size !== LEGACY_MANIFEST.length || LEGACY_MANIFEST.some(entry => !seen.has(entry.name)))) throw new PlatformDenied("LEGACY_TOOL_COVERAGE_INCOMPLETE");
    finalized = true;
    server.registerTool = original;
    installed.delete(server);
  };
}
