import { createHash } from "node:crypto";
import type { AssetRef, MetaAsset, OperationContext } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { PlatformRepository } from "./repository.js";

export function assetKey(provider: string, appId: string, ref: AssetRef): string { return createHash("sha256").update(JSON.stringify([provider, appId, ref.type, ref.id.replace(/^act_/, "")])).digest("hex"); }
export async function resolveAuthorizedAssets(repo: PlatformRepository, ctx: OperationContext, refs: AssetRef[], now = Date.now(), maximumAge = 60 * 60_000): Promise<MetaAsset[]> {
  if(!Number.isFinite(maximumAge) || maximumAge <= 0 || maximumAge > 60 * 60_000) throw new PlatformDenied("ASSET_FRESHNESS_POLICY_INVALID");
  const all = await repo.list("assets", ctx.principal.tenantId);
  const output = new Map<string, MetaAsset>();
  const visiting = new Set<string>();
  async function visit(ref: AssetRef, depth: number): Promise<void> {
    if(depth > 20) throw new PlatformDenied("ASSET_PARENT_DEPTH_EXCEEDED");
    const matches = all.filter(a => a.provider === ctx.provider && a.type === ref.type && a.id.replace(/^act_/, "") === ref.id.replace(/^act_/, ""));
    if(matches.length !== 1) throw new PlatformDenied("ASSET_UNREGISTERED_OR_AMBIGUOUS");
    const a = matches[0];
    if(a.tenantId !== ctx.principal.tenantId || a.clientId !== ctx.clientId || a.revokedAt !== null || a.verifiedAt > now || a.verifiedAt <= 0 || now-a.verifiedAt > maximumAge) throw new PlatformDenied("ASSET_ACCESS_REQUIRED");
    const roots = ["BUSINESS", "AD_ACCOUNT", "PAGE", "INSTAGRAM_ACCOUNT", "DATASET", "PIXEL", "CATALOG", "WABA", "WHATSAPP_ACCOUNT", "MESSAGING_ACCOUNT", "THREADS_ACCOUNT", "APP"];
    if(!a.parents.length && !roots.includes(a.type)) throw new PlatformDenied("ASSET_PARENT_REQUIRED");
    if(a.provider === "META_WHATSAPP" && a.type === "MESSAGING_ACCOUNT" && !a.parents.some(p=>p.type === "WHATSAPP_ACCOUNT")) throw new PlatformDenied("WHATSAPP_DUAL_ACCOUNT_GRANTS_REQUIRED");
    if(a.provider === "META_WHATSAPP" && a.type === "WHATSAPP_PHONE" && (!a.parents.some(p=>p.type === "WHATSAPP_ACCOUNT") || !a.parents.some(p=>p.type === "MESSAGING_ACCOUNT"))) throw new PlatformDenied("WHATSAPP_DUAL_ACCOUNT_GRANTS_REQUIRED");
    if(visiting.has(a.key)) throw new PlatformDenied("ASSET_PARENT_CYCLE");
    if(output.has(a.key)) return;
    visiting.add(a.key);
    for(const parent of a.parents) {
      const parentMatches = all.filter(p => p.provider === a.provider && p.type === parent.type && p.id.replace(/^act_/, "") === parent.id.replace(/^act_/, ""));
      if(parentMatches.length !== 1 || parentMatches[0].appId !== a.appId) throw new PlatformDenied("ASSET_PARENT_APP_MISMATCH");
      await visit(parent, depth + 1);
    }
    visiting.delete(a.key); output.set(a.key, a);
  }
  for(const ref of refs) await visit(ref, 0);
  const resolved=[...output.values()];
  if(ctx.tool === "leads_get_lead"){
    for(const ref of refs.filter(r=>r.type === "LEAD")){const lead=resolved.find(a=>a.type === "LEAD" && a.id === ref.id),form=resolved.find(a=>a.type === "LEAD_FORM" && lead?.parents.some(p=>p.type === "LEAD_FORM" && p.id === a.id));
      const closure=new Map<string,MetaAsset>();const walk=(a:MetaAsset):void=>{if(closure.has(a.key))return;closure.set(a.key,a);for(const parent of a.parents){const found=resolved.find(p=>p.type===parent.type && p.id.replace(/^act_/, "")===parent.id.replace(/^act_/, ""));if(found)walk(found);}};if(lead)walk(lead);
      if(!lead || !form || lead.parents.filter(p=>p.type === "LEAD_FORM").length!==1 || form.parents.filter(p=>p.type === "PAGE").length!==1 || [...closure.values()].filter(a=>a.type === "PAGE").length!==1 || [...closure.values()].filter(a=>a.type === "AD_ACCOUNT").length!==1)throw new PlatformDenied("LEAD_FORM_PAGE_ADVERTISER_PROVENANCE_REQUIRED");
    }
  }
  return resolved;
}
