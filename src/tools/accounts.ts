import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import { normalizeAccountId, validateMetaId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import {
  AD_ACCOUNT_DEFAULT_FIELDS,
  AD_ACCOUNT_DETAIL_FIELDS,
  PAGE_DEFAULT_FIELDS,
} from "../meta/types/account.js";
import type {
  AdAccount,
  Page,
  MetaApiResponse,
} from "../meta/types/index.js";
import { READ } from "./_register.js";
import { fenceBlock, fencedJsonBlock, untrustedText } from "../media/content-blocks.js";

export function registerAccountTools(server: McpServer): void {
  // ─── Get Ad Accounts ─────────────────────────────────────────
  server.registerTool(
    "ads_get_ad_accounts",
    {
      description:
        "Get all ad accounts accessible by the authenticated user. Returns account names, IDs, status, currency, and spend information.",
      inputSchema: {
        user_id: z
          .string()
          .default("me")
          .describe("User ID or 'me' for the authenticated user"),
        limit: z
          .number()
          .min(1)
          .max(500)
          .default(100)
          .describe("Maximum number of accounts to return"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Fields to include (defaults to standard set)"),
      },
      annotations: { ...READ },
    },
    async ({ user_id, limit, fields }) => {
      const userPath = user_id === "me" ? "me" : validateMetaId(user_id, "user");
      const fieldsParam = buildFieldsParam(
        fields,
        [...AD_ACCOUNT_DEFAULT_FIELDS],
      );

      const response = await metaApiClient.get<MetaApiResponse<AdAccount>>(
        `/${userPath}/adaccounts`,
        { fields: fieldsParam, limit },
      );

      const accounts = response.data ?? [];

      const text = accounts.length === 0
        ? "No ad accounts found for this user."
        : fenceBlock(
            accounts.map(
              (a) =>
                `• ${untrustedText(a.name) || "N/A"} (${untrustedText(a.account_id ?? a.id, 40) || "N/A"}) — Status: ${a.account_status === undefined ? "NOT_RETURNED" : a.account_status === 1 ? "ACTIVE" : `META_STATUS_${untrustedText(a.account_status, 20)}`} — Currency: ${untrustedText(a.currency, 10) || "N/A"} — Spent: ${untrustedText(a.amount_spent, 30) || "N/A"}`,
            ),
          );

      return {
        content: [
          { type: "text", text: `Found ${accounts.length} ad account(s):\n\n${text}` },
          { type: "text", text: fencedJsonBlock(accounts) },
        ],
      };
    },
  );

  // ─── Get Account Info ────────────────────────────────────────
  server.registerTool(
    "ads_get_account_info",
    {
      description:
        "Get detailed information about a specific ad account including spend, balance, capabilities, and business details.",
      inputSchema: {
        account_id: z
          .string()
          .describe("Ad account ID (with or without 'act_' prefix)"),
      },
      annotations: { ...READ },
    },
    async ({ account_id }) => {
      const id = normalizeAccountId(account_id);
      const fieldsParam = [...AD_ACCOUNT_DETAIL_FIELDS].join(",");

      const account = await metaApiClient.get<AdAccount>(`/${id}`, {
        fields: fieldsParam,
      });

      return {
        content: [
          {
            type: "text",
            text: fenceBlock([
              `Account: ${untrustedText(account.name) || "N/A"} (${untrustedText(account.account_id, 40)})`,
              `Status: ${account.account_status === 1 ? "ACTIVE" : "DISABLED"}`,
              `Currency: ${untrustedText(account.currency, 10)}`,
              `Timezone: ${untrustedText(account.timezone_name, 60)}`,
              `Spent: ${untrustedText(account.amount_spent, 30) || "N/A"}`,
              `Balance: ${untrustedText(account.balance, 30) || "N/A"}`,
              `Spend Cap: ${untrustedText(account.spend_cap, 30) || "None"}`,
            ]),
          },
          { type: "text", text: fencedJsonBlock(account) },
        ],
      };
    },
  );

  // ─── Get Pages For Business ──────────────────────────────────
  server.registerTool(
    "ads_get_pages_for_business",
    {
      description:
        "Get Facebook Pages associated with an ad account or the authenticated user. Pages are required for creating ad creatives.",
      inputSchema: {
        account_id: z
          .string()
          .optional()
          .describe(
            "Ad account ID to get associated pages. Omit to get user's own pages.",
          ),
      },
      annotations: { ...READ },
    },
    async ({ account_id }) => {
      const fieldsParam = [...PAGE_DEFAULT_FIELDS].join(",");

      let pages: Page[];

      if (account_id) {
        const id = normalizeAccountId(account_id);
        // Try promoted_pages first, then owned_pages
        try {
          const response = await metaApiClient.get<MetaApiResponse<Page>>(
            `/${id}/promote_pages`,
            { fields: fieldsParam },
          );
          pages = response.data ?? [];
        } catch {
          const response = await metaApiClient.get<MetaApiResponse<Page>>(
            `/${id}/owned_pages`,
            { fields: fieldsParam },
          );
          pages = response.data ?? [];
        }
      } else {
        const response = await metaApiClient.get<MetaApiResponse<Page>>(
          "/me/accounts",
          { fields: fieldsParam },
        );
        pages = response.data ?? [];
      }

      const text =
        pages.length === 0
          ? "No pages found."
          : fenceBlock(
              pages.map(
                (p) => `• ${untrustedText(p.name) || "Unnamed"} (ID: ${untrustedText(p.id, 40)}) — Category: ${untrustedText(p.category, 100) || "N/A"}`,
              ),
            );

      return {
        content: [
          { type: "text", text: `Found ${pages.length} page(s):\n\n${text}` },
          { type: "text", text: fencedJsonBlock(pages) },
        ],
      };
    },
  );
}
