import { readBodyWithLimit } from "../../utils/bounded-body.js";

export interface GoogleAccountBinding {
  subject: string;
  customerIds: readonly string[];
  loginCustomerIds?: Readonly<Record<string, string>>;
  searchConsoleSites: readonly string[];
  analyticsPropertyIds: readonly string[];
}

export type GoogleTokenResolver = (subject: string, scope: string) => Promise<string>;

const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const SEARCH_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

function customerId(value: string): string {
  if (!/^\d{10}$/.test(value)) throw new Error("Invalid Google Ads customer ID");
  return value;
}

function dates(start: string, end: string): void {
  for (const date of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error("Invalid report date");
    }
  }
  if (start > end) throw new Error("Invalid report date range");
}

// Construct only from server-resolved identity and persisted account grants.
// This boundary is intentionally not registered with the Meta-authenticated MCP server.
export class GoogleProviderClient {
  private readonly subject: string;
  private readonly customers: ReadonlySet<string>;
  private readonly sites: ReadonlySet<string>;
  private readonly properties: ReadonlySet<string>;
  private readonly managers: ReadonlyMap<string, string>;

  constructor(
    binding: GoogleAccountBinding,
    private readonly token: GoogleTokenResolver,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!binding.subject.trim()) throw new Error("Authenticated subject required");
    this.subject = binding.subject;
    this.customers = new Set(binding.customerIds.map(customerId));
    this.managers = new Map(Object.entries(binding.loginCustomerIds ?? {}).map(([account, manager]) => {
      this.account(account);
      return [account, customerId(manager)] as const;
    }));
    this.sites = new Set(binding.searchConsoleSites);
    this.properties = new Set(binding.analyticsPropertyIds);
  }

  private account(id: string): string {
    customerId(id);
    if (!this.customers.has(id)) throw new Error("Account not authorized");
    return id;
  }

  private async request(url: string, scope: string, body: unknown, loginCustomerId?: string): Promise<unknown> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > 256_000) throw new Error("Google request too large");
    let credential: string;
    try {
      credential = await this.token(this.subject, scope);
    } catch {
      throw new Error("Google authorization unavailable");
    }
    if (!credential || /[\r\n]/.test(credential)) throw new Error("Google authorization unavailable");
    let response: Response;
    try {
      response = await this.transport(url, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}) },
        body: serialized,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Google API transport failed");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Google API request failed (${response.status})`);
    }
    try {
      return JSON.parse(await readBodyWithLimit(response, 2_000_000)) as unknown;
    } catch {
      throw new Error("Invalid or oversized Google API response");
    }
  }

  async searchAds(id: string, query: string, pageToken?: string): Promise<unknown> {
    this.account(id);
    if (!/^\s*SELECT\s/i.test(query) || query.length > 16_000) throw new Error("Invalid GAQL query");
    if (pageToken && pageToken.length > 4096) throw new Error("Invalid page token");
    return this.request(`https://googleads.googleapis.com/v26/customers/${id}/googleAds:search`, ADS_SCOPE, { query, ...(pageToken ? { pageToken } : {}) }, this.managers.get(id));
  }

  async validateAds(id: string, operations: readonly Record<string, unknown>[]): Promise<unknown> {
    this.account(id);
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) throw new Error("Expected 1 to 100 validation operations");
    const serialized = JSON.stringify(operations);
    for (const match of serialized.matchAll(/customers\/([^/"\\]+)\//g)) {
      if (match[1] !== id) throw new Error("Cross-account reference");
    }
    return this.request(`https://googleads.googleapis.com/v26/customers/${id}/googleAds:mutate`, ADS_SCOPE, {
      mutateOperations: JSON.parse(serialized) as unknown,
      validateOnly: true,
      partialFailure: false,
    }, this.managers.get(id));
  }

  async searchConsole(site: string, startDate: string, endDate: string): Promise<unknown> {
    if (!this.sites.has(site)) throw new Error("Site not authorized");
    dates(startDate, endDate);
    return this.request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, SEARCH_SCOPE, {
      startDate, endDate, dimensions: ["query", "page"], rowLimit: 1000,
    });
  }

  async analytics(property: string, startDate: string, endDate: string): Promise<unknown> {
    if (!/^\d+$/.test(property) || !this.properties.has(property)) throw new Error("Property not authorized");
    dates(startDate, endDate);
    return this.request(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, ANALYTICS_SCOPE, {
      dateRanges: [{ startDate, endDate }], dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }], limit: "1000",
    });
  }
}
