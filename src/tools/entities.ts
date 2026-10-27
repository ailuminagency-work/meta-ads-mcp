import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import { normalizeAccountId, validateMetaId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { CAMPAIGN_DEFAULT_FIELDS } from "../meta/types/campaign.js";
import { ADSET_DEFAULT_FIELDS } from "../meta/types/adset.js";
import { AD_DEFAULT_FIELDS } from "../meta/types/ad.js";
import type {
  Ad,
  AdSet,
  Campaign,
  MetaApiResponse,
} from "../meta/types/index.js";
import { READ, UPDATE, TOGGLE, WRITE_WARNING } from "./_register.js";
import { MAX_MINOR_UNIT_AMOUNT, normalizeMinorUnitAmount } from "../meta/currency.js";

const entityTypeEnum = z.enum(["campaign", "ad_set", "ad"]);
const statusEnum = z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]);

type EntityType = "campaign" | "ad_set" | "ad";

const ENDPOINT_BY_ENTITY: Record<EntityType, string> = {
  campaign: "campaigns",
  ad_set: "adsets",
  ad: "ads",
};

const DEFAULT_FIELDS: Record<EntityType, readonly string[]> = {
  campaign: CAMPAIGN_DEFAULT_FIELDS,
  ad_set: ADSET_DEFAULT_FIELDS,
  ad: AD_DEFAULT_FIELDS,
};

const VALIDATE_KIND: Record<EntityType, "campaign" | "adset" | "ad"> = {
  campaign: "campaign",
  ad_set: "adset",
  ad: "ad",
};

type AnyEntity = Campaign | AdSet | Ad;

/**
 * Generic entity tools that mirror Meta's official MCP vocabulary.
 *
 * These coexist with the entity-specific tools (`ads_get_campaigns`,
 * `ads_update_ad_set`, etc.). Both are valid — agents can use whichever
 * matches their pattern. The generic versions are thin dispatchers.
 */
export function registerEntityTools(server: McpServer): void {
  // ─── Get Ad Entities ─────────────────────────────────────────
  server.registerTool(
    "ads_get_ad_entities",
    {
      description:
        "Generic getter for campaigns, ad sets, or ads under a parent. Use entity_type to choose. parent_id is the ad account ID for campaigns, the campaign ID for ad sets, the ad set ID (or campaign/account) for ads. Mirrors the official Meta MCP vocabulary; equivalent to ads_get_campaigns / ads_get_ad_sets / ads_get_ads.",
      inputSchema: {
        entity_type: entityTypeEnum.describe(
          "Which entity to list: 'campaign', 'ad_set', or 'ad'",
        ),
        parent_id: z.string().describe(
          "Account ID for campaigns, campaign ID for ad_sets, ad_set/campaign/account ID for ads",
        ),
        limit: z.number().min(1).max(100).default(25),
        status_filter: z.array(statusEnum).optional(),
        fields: z.array(z.string()).optional(),
      },
      annotations: { ...READ },
    },
    async ({ entity_type, parent_id, limit, status_filter, fields }) => {
      const endpoint = ENDPOINT_BY_ENTITY[entity_type];
      const parentPath = resolveParentPath(entity_type, parent_id);

      const fieldsParam = buildFieldsParam(fields, [...DEFAULT_FIELDS[entity_type]]);
      const params: Record<string, string | number | boolean> = {
        fields: fieldsParam,
        limit,
      };

      if (status_filter && status_filter.length > 0) {
        params.filtering = JSON.stringify([
          { field: "effective_status", operator: "IN", value: status_filter },
        ]);
      }

      const response = await metaApiClient.get<MetaApiResponse<AnyEntity>>(
        `/${parentPath}/${endpoint}`,
        params,
      );
      const items = response.data ?? [];

      return {
        content: [
          {
            type: "text",
            text: `Found ${items.length} ${entity_type}(s).`,
          },
          { type: "text", text: JSON.stringify(items, null, 2) },
        ],
      };
    },
  );

  // ─── Update Entity ───────────────────────────────────────────
  server.registerTool(
    "ads_update_entity",
    {
      description: `${WRITE_WARNING}Generic updater for a campaign, ad set, or ad. Pass the changes in 'updates'. Mirrors the official Meta MCP vocabulary; equivalent to ads_update_campaign / ads_update_ad_set / ads_update_ad. Only the fields you pass are sent to Meta — omitted fields keep their current value.`,
      inputSchema: {
        entity_type: entityTypeEnum.describe(
          "Which entity to update: 'campaign', 'ad_set', or 'ad'",
        ),
        entity_id: z.string().describe("ID of the entity to update"),
        updates: z
          .record(z.string(), z.unknown())
          .describe(
            "Fields to update (e.g. { name, status, daily_budget }). See entity-specific update tools for valid keys per type. Complex fields (targeting, creative, evaluation_spec) are JSON-encoded automatically. Money fields (daily_budget, lifetime_budget, bid_amount and the spend-cap/target variants) must be whole minor-unit amounts from 1 to 1000000000; spend_cap, spend_cap_action, account_spend_limit and budget_remaining are refused.",
          ),
      },
      annotations: { ...UPDATE },
    },
    async ({ entity_type, entity_id, updates }) => {
      const id = validateMetaId(entity_id, VALIDATE_KIND[entity_type]);
      const body = encodeUpdatesBody(updates);

      await metaApiClient.postForm<{ success: boolean }>(`/${id}`, body);

      return {
        content: [
          {
            type: "text",
            text: `${entity_type} ${id} updated.\nChanges: ${JSON.stringify(body)}`,
          },
        ],
      };
    },
  );

  // ─── Activate / Toggle Entity Status ─────────────────────────
  server.registerTool(
    "ads_activate_entity",
    {
      description: `${WRITE_WARNING}Toggle the status of a campaign, ad set, or ad. Use status='ACTIVE' to start delivery, 'PAUSED' to stop, 'ARCHIVED' to retire. For deletion use ads_delete_campaign / ads_delete_ad_set / ads_delete_ad. Mirrors the official Meta MCP vocabulary.`,
      inputSchema: {
        entity_type: entityTypeEnum,
        entity_id: z.string().describe("ID of the entity"),
        status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).describe("New status"),
      },
      annotations: { ...TOGGLE },
    },
    async ({ entity_type, entity_id, status }) => {
      const id = validateMetaId(entity_id, VALIDATE_KIND[entity_type]);
      await metaApiClient.postForm<{ success: boolean }>(`/${id}`, { status });

      return {
        content: [
          {
            type: "text",
            text: `${entity_type} ${id} status set to ${status}.`,
          },
        ],
      };
    },
  );
}

const AMOUNT_FIELDS: ReadonlySet<string> = new Set([
  "daily_budget",
  "lifetime_budget",
  "bid_amount",
  "bid_cap",
  "daily_spend_cap",
  "lifetime_spend_cap",
  "daily_min_spend_target",
  "lifetime_min_spend_target",
]);

const SPEND_CAP_REFUSAL =
  "cannot be written through ads_update_entity: removing or raising a spend cap requires the strict financial gate (ads_update_spend_cap can only lower an account cap).";

const REFUSED_FIELDS: ReadonlyMap<string, string> = new Map([
  ["spend_cap", SPEND_CAP_REFUSAL],
  ["spend_cap_action", SPEND_CAP_REFUSAL],
  ["account_spend_limit", SPEND_CAP_REFUSAL],
  ["budget_remaining", "is a read-only Meta field and cannot be written."],
]);

/**
 * Money fields reach Meta unvalidated through `updates`, however deeply they are nested or whether they
 * arrive inside an already JSON-encoded string, so every one is checked before anything is sent.
 * Returns the canonical value for an amount field and undefined for anything else.
 */
function checkMoneyField(key: string, value: unknown, path: string, depth: number): string | undefined {
  const lower = key.toLowerCase();
  const refusal = REFUSED_FIELDS.get(lower);
  if (refusal) throw new Error(`${path} ${refusal}`);
  if (AMOUNT_FIELDS.has(lower)) {
    if (value === undefined || value === null) return undefined;
    const amount = normalizeMinorUnitAmount(value);
    if (amount === undefined) {
      throw new Error(
        `${path} must be a whole number of the ad account currency's minor units between 1 and ${MAX_MINOR_UNIT_AMOUNT}, with no sign, fraction, exponent or leading zeros.`,
      );
    }
    return amount;
  }
  checkNestedMoney(value, path, depth);
  return undefined;
}

function checkNestedMoney(value: unknown, path: string, depth: number): void {
  if (depth > 10) throw new Error(`${path} is nested too deeply to check for money fields.`);
  if (typeof value === "string") {
    if (!/^\s*[[{]/.test(value)) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      return;
    }
    checkNestedMoney(decoded, path, depth + 1);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkNestedMoney(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) checkMoneyField(key, item, `${path}.${key}`, depth + 1);
}

/**
 * Encode update fields into Meta's form body, JSON-encoding any nested objects.
 */
function encodeUpdatesBody(
  updates: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const body: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(updates)) {
    const amount = checkMoneyField(key, value, `updates.${key}`, 0);
    if (value === undefined || value === null) continue;
    if (amount !== undefined) {
      body[key] = amount;
    } else if (typeof value === "object") {
      body[key] = JSON.stringify(value);
    } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      body[key] = value;
    }
  }
  return body;
}

/**
 * Resolve the parent path for `ads_get_ad_entities` by entity_type.
 *
 * - campaign: parent is always an account
 * - ad_set:   parent is always a campaign
 * - ad:       parent can be an ad set, a campaign, OR an account — accept all three
 *             and detect the account form by the `act_` prefix or numeric-only.
 */
function resolveParentPath(entity_type: EntityType, parent_id: string): string {
  if (entity_type === "campaign") {
    return normalizeAccountId(parent_id);
  }
  if (entity_type === "ad_set") {
    return validateMetaId(parent_id, "campaign");
  }
  // entity_type === "ad" — parent can be ad_set / campaign / account
  if (parent_id.startsWith("act_")) {
    return normalizeAccountId(parent_id);
  }
  return validateMetaId(parent_id, "ad_set, campaign, or account");
}
