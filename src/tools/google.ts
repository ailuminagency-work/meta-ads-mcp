import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadGoogleOAuthConfig, refreshGoogleAccessToken } from "../auth/google-oauth.js";
import { resolveTenantId } from "../auth/tenant.js";
import { GoogleProviderClient } from "../providers/google/client.js";
import { getGoogleTokenRepo } from "../store/google-token-repo-singleton.js";
import { READ } from "./_register.js";

function serverUrl(): URL {
  const raw = process.env.SERVER_URL?.trim() || "http://localhost:3000";
  return new URL(raw);
}

async function providerForCurrentTenant() {
  const tenant = resolveTenantId({ feature: "Google" });
  const repo = getGoogleTokenRepo();
  const grant = await repo.getGrant(tenant);
  if (!grant) throw new Error("Google is not connected for this tenant");
  const config = loadGoogleOAuthConfig(serverUrl());
  if (!config) throw new Error("Google OAuth is not configured");
  const client = new GoogleProviderClient(
    {
      subject: tenant,
      customerIds: grant.customerIds,
      loginCustomerIds: grant.loginCustomerIds,
      searchConsoleSites: grant.searchConsoleSites,
      analyticsPropertyIds: grant.analyticsPropertyIds,
    },
    (subject, scope) => repo.getAccessToken(subject, scope, (refreshToken) => refreshGoogleAccessToken(config, refreshToken)),
  );
  return { tenant, repo, grant, client };
}

export function registerGoogleTools(server: McpServer): void {
  server.registerTool("google_connection_status", {
    description: "Show the current tenant's Google connection and verified resource bindings. Access tokens and refresh tokens are never returned.",
    inputSchema: {},
    annotations: { ...READ },
  }, async () => {
    const tenant = resolveTenantId({ feature: "Google" });
    const summary = await getGoogleTokenRepo().getSummary(tenant);
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  });

  server.registerTool("google_ads_search", {
    description: "Run a bounded read-only Google Ads GAQL report against a verified, tenant-bound customer account.",
    inputSchema: {
      customer_id: z.string().regex(/^\d{10}$/),
      query: z.string().regex(/^\s*SELECT\s/i).max(16_000),
      page_token: z.string().max(4096).optional(),
    },
    annotations: { ...READ },
  }, async ({ customer_id, query, page_token }) => {
    const { client } = await providerForCurrentTenant();
    const result = await client.searchAds(customer_id, query, page_token);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.registerTool("google_ads_validate", {
    description: "Validate 1–100 Google Ads mutate operations with validateOnly=true. This never commits a change or activates advertising.",
    inputSchema: {
      customer_id: z.string().regex(/^\d{10}$/),
      operations: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    },
    annotations: { ...READ },
  }, async ({ customer_id, operations }) => {
    const { client } = await providerForCurrentTenant();
    const result = await client.validateAds(customer_id, operations);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.registerTool("google_search_console_query", {
    description: "Run a bounded read-only Search Console Search Analytics query against a verified, tenant-bound site.",
    inputSchema: {
      site: z.string().url(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    annotations: { ...READ },
  }, async ({ site, start_date, end_date }) => {
    const { client } = await providerForCurrentTenant();
    const result = await client.searchConsole(site, start_date, end_date);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.registerTool("google_analytics_report", {
    description: "Run a bounded read-only GA4 report against a verified, tenant-bound property.",
    inputSchema: {
      property_id: z.string().regex(/^\d+$/),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    annotations: { ...READ },
  }, async ({ property_id, start_date, end_date }) => {
    const { client } = await providerForCurrentTenant();
    const result = await client.analytics(property_id, start_date, end_date);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
}
