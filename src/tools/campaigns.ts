import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import { normalizeAccountId, validateMetaId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { CAMPAIGN_DEFAULT_FIELDS } from "../meta/types/campaign.js";
import { MINOR_UNIT_NOTE, minorUnitAmount } from "../meta/currency.js";
import { platformEnabled } from "../platform/runtime.js";
import type { Campaign, MetaApiResponse } from "../meta/types/index.js";
import { READ, CREATE, UPDATE, DELETE, WRITE_WARNING } from "./_register.js";

const objectiveEnum = z.enum([
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "OUTCOME_APP_PROMOTION",
]);

const statusEnum = z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]);

const bidStrategyEnum = z.enum([
  "LOWEST_COST_WITHOUT_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
  "LOWEST_COST_WITH_MIN_ROAS",
]);

const specialAdCategoryEnum = z.enum([
  "NONE",
  "EMPLOYMENT",
  "HOUSING",
  "CREDIT",
  "FINANCIAL_PRODUCTS_SERVICES",
  "ISSUES_ELECTIONS_POLITICS",
  "ONLINE_GAMBLING_AND_GAMING",
]);

const specialAdCategoryCountrySchema = z
  .array(z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 country code, upper case"))
  .min(1)
  .max(250)
  .describe(
    'Countries the special ad category campaign targets, as ISO 3166-1 alpha-2 codes (for example ["US"]). Required by Meta whenever special_ad_categories contains anything other than NONE; not allowed with NONE.',
  );

function resolveSpecialAdCategories(
  categories: z.infer<typeof specialAdCategoryEnum>[],
  countries: string[] | undefined,
): { categories: string[]; countries: string[] | undefined } {
  const unique = [...new Set(categories)];
  const real = unique.filter((category) => category !== "NONE");
  if (real.length > 0 && real.length !== unique.length) {
    throw new Error("special_ad_categories cannot combine NONE with another category.");
  }
  const uniqueCountries = countries === undefined ? undefined : [...new Set(countries)];
  if (real.length > 0 && (uniqueCountries === undefined || uniqueCountries.length === 0)) {
    throw new Error(
      `special_ad_category_country is required when special_ad_categories contains ${real.join(", ")}: Meta rejects a special ad category campaign without the countries it targets. Pass ISO 3166-1 alpha-2 codes, for example ["US"].`,
    );
  }
  if (real.length === 0 && uniqueCountries !== undefined) {
    throw new Error("special_ad_category_country is only valid together with a special ad category other than NONE.");
  }
  return { categories: unique, countries: uniqueCountries };
}

const ADSET_BUDGET_SHARING_EXPLAINER =
  "Ad set budget sharing lets Meta move up to 20% of each ad set's daily budget to other ad sets in the same campaign when that is likely to perform better. It only works when the budget lives on the ad sets (Meta rejects it next to a campaign daily_budget or lifetime_budget, error 4834002), only with daily ad set budgets, and every ad set in the campaign must use the same bid strategy (Meta rejects enabling it without one, error 4834005). Meta recommends true.";

export function registerCampaignTools(server: McpServer): void {
  // Strict mode holds every special ad category (only NONE is created) and pins this tool's input keys to the
  // legacy manifest, so the country list is only offered where a special category can actually be sent.
  const specialCategoryCountryShape = (
    platformEnabled() ? {} : { special_ad_category_country: specialAdCategoryCountrySchema.optional() }
  ) as { special_ad_category_country: z.ZodOptional<typeof specialAdCategoryCountrySchema> };
  const specialCategoryCountryNote = platformEnabled()
    ? ""
    : " When special_ad_categories contains anything other than NONE, special_ad_category_country is required.";

  // ─── Get Campaigns ───────────────────────────────────────────
  server.registerTool(
    "ads_get_campaigns",
    {
      description:
        "Get campaigns for an ad account. Filter by status to see active, paused, or all campaigns.",
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        limit: z.number().min(1).max(100).default(25),
        status_filter: z
          .array(statusEnum)
          .optional()
          .describe("Filter by status (e.g., ['ACTIVE', 'PAUSED'])"),
        fields: z.array(z.string()).optional(),
      },
      annotations: { ...READ },
    },
    async ({ account_id, limit, status_filter, fields }) => {
      const id = normalizeAccountId(account_id);
      const fieldsParam = buildFieldsParam(fields, [...CAMPAIGN_DEFAULT_FIELDS]);
      const params: Record<string, string | number | boolean> = {
        fields: fieldsParam,
        limit,
      };

      if (status_filter && status_filter.length > 0) {
        params.filtering = JSON.stringify([
          {
            field: "effective_status",
            operator: "IN",
            value: status_filter,
          },
        ]);
      }

      const response = await metaApiClient.get<MetaApiResponse<Campaign>>(
        `/${id}/campaigns`,
        params,
      );

      const campaigns = response.data ?? [];

      const text =
        campaigns.length === 0
          ? "No campaigns found."
          : campaigns
              .map(
                (c) =>
                  `• ${c.name} (${c.id}) — ${c.status} — Objective: ${c.objective} — Budget: ${c.daily_budget ? `${c.daily_budget}/day` : c.lifetime_budget ? `${c.lifetime_budget} lifetime` : "N/A"}`,
              )
              .join("\n");

      return {
        content: [
          { type: "text", text: `Found ${campaigns.length} campaign(s):\n\n${text}` },
          { type: "text", text: JSON.stringify(campaigns, null, 2) },
        ],
      };
    },
  );

  // ─── Get Campaign Details ────────────────────────────────────
  server.registerTool(
    "ads_get_campaign_details",
    {
      description: "Get detailed information about a specific campaign.",
      inputSchema: {
        campaign_id: z.string().describe("Campaign ID"),
        fields: z.array(z.string()).optional(),
      },
      annotations: { ...READ },
    },
    async ({ campaign_id, fields }) => {
      const id = validateMetaId(campaign_id, "campaign");
      const fieldsParam = buildFieldsParam(fields, [...CAMPAIGN_DEFAULT_FIELDS]);
      const campaign = await metaApiClient.get<Campaign>(`/${id}`, {
        fields: fieldsParam,
      });

      return {
        content: [
          {
            type: "text",
            text: `Campaign: ${campaign.name}\nID: ${campaign.id}\nStatus: ${campaign.status} (effective: ${campaign.effective_status})\nObjective: ${campaign.objective}\nBuying Type: ${campaign.buying_type}\nBid Strategy: ${campaign.bid_strategy ?? "N/A"}\nDaily Budget: ${campaign.daily_budget ?? "N/A"}\nLifetime Budget: ${campaign.lifetime_budget ?? "N/A"}\nCreated: ${campaign.created_time}`,
          },
          { type: "text", text: JSON.stringify(campaign, null, 2) },
        ],
      };
    },
  );

  // ─── Create Campaign ─────────────────────────────────────────
  server.registerTool(
    "ads_create_campaign",
    {
      description: `${WRITE_WARNING}Create a new Meta advertising campaign. Uses outcome-based (ODAX) objectives. Campaigns are created in PAUSED status by default. Budget belongs at exactly one level: pass daily_budget or lifetime_budget here for a campaign budget, or omit both and set budgets on each ad set. For ad-set budgets Meta requires an explicit is_adset_budget_sharing_enabled; this tool sends false unless you pass true. Budget amounts are whole numbers of the ad account currency's minor units, not always cents.${specialCategoryCountryNote}`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        name: z.string().min(1).max(400).describe("Campaign name"),
        objective: objectiveEnum.describe(
          "Campaign objective (OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_APP_PROMOTION)",
        ),
        status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
        special_ad_categories: z
          .array(specialAdCategoryEnum)
          .default(["NONE"])
          .describe("Special ad categories (NONE, EMPLOYMENT, HOUSING, CREDIT, FINANCIAL_PRODUCTS_SERVICES, ISSUES_ELECTIONS_POLITICS, ONLINE_GAMBLING_AND_GAMING)"),
        ...specialCategoryCountryShape,
        daily_budget: minorUnitAmount(
          `Campaign daily budget ${MINOR_UNIT_NOTE}. Omit to set budgets on the ad sets instead.`,
        ).optional(),
        lifetime_budget: minorUnitAmount(
          `Campaign lifetime budget ${MINOR_UNIT_NOTE}. Omit to set budgets on the ad sets instead.`,
        ).optional(),
        is_adset_budget_sharing_enabled: z
          .boolean()
          .optional()
          .describe(`${ADSET_BUDGET_SHARING_EXPLAINER} Marketing API v24.0+ requires this whenever the campaign has no budget of its own; when omitted in that case the tool sends false.`),
        bid_strategy: bidStrategyEnum.optional(),
        buying_type: z.enum(["AUCTION", "RESERVED"]).default("AUCTION"),
      },
      annotations: { ...CREATE },
    },
    async ({
      account_id,
      name,
      objective,
      status,
      special_ad_categories,
      special_ad_category_country,
      daily_budget,
      lifetime_budget,
      is_adset_budget_sharing_enabled,
      bid_strategy,
      buying_type,
    }) => {
      const id = normalizeAccountId(account_id);
      const special = resolveSpecialAdCategories(special_ad_categories, special_ad_category_country);

      const body: Record<string, unknown> = {
        name,
        objective,
        status,
        special_ad_categories: JSON.stringify(special.categories),
        ...(special.countries ? { special_ad_category_country: JSON.stringify(special.countries) } : {}),
        buying_type,
      };

      if (daily_budget !== undefined) body.daily_budget = String(daily_budget);
      if (lifetime_budget !== undefined) body.lifetime_budget = String(lifetime_budget);
      const hasCampaignBudget = daily_budget !== undefined || lifetime_budget !== undefined;
      if (is_adset_budget_sharing_enabled === true && hasCampaignBudget) {
        throw new Error("is_adset_budget_sharing_enabled cannot be true on a campaign with its own daily_budget or lifetime_budget: Meta only shares budget between ad set budgets (error 4834002). Remove the campaign budget, or leave ad set budget sharing off.");
      }
      if (is_adset_budget_sharing_enabled !== undefined) {
        body.is_adset_budget_sharing_enabled = is_adset_budget_sharing_enabled;
      } else if (!hasCampaignBudget) {
        body.is_adset_budget_sharing_enabled = false;
      }
      if (bid_strategy) body.bid_strategy = bid_strategy;

      const result = await metaApiClient.postForm<{ id: string }>(
        `/${id}/campaigns`,
        body as Record<string, string | number | boolean>,
      );

      const budgetSharingLine = body.is_adset_budget_sharing_enabled === undefined
        ? ""
        : `\nAd set budget sharing: ${body.is_adset_budget_sharing_enabled ? "on" : "off"}`;

      return {
        content: [
          {
            type: "text",
            text: `Campaign created successfully!\nID: ${result.id}\nName: ${name}\nObjective: ${objective}\nStatus: ${status}${budgetSharingLine}`,
          },
        ],
      };
    },
  );

  // ─── Update Campaign ─────────────────────────────────────────
  server.registerTool(
    "ads_update_campaign",
    {
      description: `${WRITE_WARNING}Update an existing campaign's name, status, budget, bid strategy, or ad set budget sharing.`,
      inputSchema: {
        campaign_id: z.string().describe("Campaign ID to update"),
        name: z.string().optional(),
        status: statusEnum.optional(),
        daily_budget: minorUnitAmount(`Daily budget ${MINOR_UNIT_NOTE}`).optional(),
        lifetime_budget: minorUnitAmount(`Lifetime budget ${MINOR_UNIT_NOTE}`).optional(),
        is_adset_budget_sharing_enabled: z
          .boolean()
          .optional()
          .describe(`${ADSET_BUDGET_SHARING_EXPLAINER} On an existing campaign Meta only supports turning it off; turning it on for a running campaign is rejected (error 3858418). Omit to keep the current setting.`),
        bid_strategy: bidStrategyEnum.optional(),
      },
      annotations: { ...UPDATE },
    },
    async ({ campaign_id, name, status, daily_budget, lifetime_budget, is_adset_budget_sharing_enabled, bid_strategy }) => {
      const id = validateMetaId(campaign_id, "campaign");
      const body: Record<string, string | number | boolean> = {};
      if (name !== undefined) body.name = name;
      if (status !== undefined) body.status = status;
      if (daily_budget !== undefined) body.daily_budget = String(daily_budget);
      if (lifetime_budget !== undefined) body.lifetime_budget = String(lifetime_budget);
      if (is_adset_budget_sharing_enabled !== undefined) {
        body.is_adset_budget_sharing_enabled = is_adset_budget_sharing_enabled;
      }
      if (bid_strategy !== undefined) body.bid_strategy = bid_strategy;

      await metaApiClient.postForm<{ success: boolean }>(
        `/${id}`,
        body,
      );

      return {
        content: [
          {
            type: "text",
            text: `Campaign ${id} updated successfully.\nChanges: ${JSON.stringify(body)}`,
          },
        ],
      };
    },
  );

  // ─── Delete Campaign ─────────────────────────────────────────
  server.registerTool(
    "ads_delete_campaign",
    {
      description: `${WRITE_WARNING}Delete a campaign (soft delete — sets status to DELETED). The campaign can still be viewed but will stop serving.`,
      inputSchema: {
        campaign_id: z.string().describe("Campaign ID to delete"),
      },
      annotations: { ...DELETE },
    },
    async ({ campaign_id }) => {
      const id = validateMetaId(campaign_id, "campaign");
      await metaApiClient.postForm<{ success: boolean }>(`/${id}`, {
        status: "DELETED",
      });

      return {
        content: [
          {
            type: "text",
            text: `Campaign ${id} has been deleted (status set to DELETED).`,
          },
        ],
      };
    },
  );
}
