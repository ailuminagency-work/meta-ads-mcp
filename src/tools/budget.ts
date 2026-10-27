import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import { validateMetaId } from "../utils/format.js";
import { MAX_MINOR_UNIT_AMOUNT, MINOR_UNIT_NOTE } from "../meta/currency.js";
import { CREATE, WRITE_WARNING } from "./_register.js";

function assertBudgetValue(value: string, type: "ABSOLUTE" | "MULTIPLIER"): void {
  const valid =
    type === "ABSOLUTE"
      ? /^[1-9]\d{0,9}$/.test(value) && Number(value) <= MAX_MINOR_UNIT_AMOUNT
      : /^(?:0\.\d{1,4}|[1-9]\d{0,5}(?:\.\d{1,4})?)$/.test(value) && Number(value) > 0;
  if (!valid) {
    throw new Error(
      type === "ABSOLUTE"
        ? `budget_value must be a whole number of minor units between 1 and ${MAX_MINOR_UNIT_AMOUNT} for ABSOLUTE schedules. Got: ${JSON.stringify(value).slice(0, 40)}`
        : `budget_value must be a positive decimal multiplier for MULTIPLIER schedules. Got: ${JSON.stringify(value).slice(0, 40)}`,
    );
  }
}

export function registerBudgetTools(server: McpServer): void {
  // ─── Create Budget Schedule ──────────────────────────────────
  server.registerTool(
    "ads_create_budget_schedule",
    {
      description: `${WRITE_WARNING}Schedule a temporary budget increase for a campaign during high-demand periods (e.g., Black Friday, product launches).`,
      inputSchema: {
        campaign_id: z.string().describe("Campaign ID"),
        budget_value: z
          .string()
          .describe(`Positive number. ABSOLUTE: a whole number of minor units ${MINOR_UNIT_NOTE}. MULTIPLIER: the multiplier value.`),
        budget_value_type: z
          .enum(["ABSOLUTE", "MULTIPLIER"])
          .describe("ABSOLUTE = set exact budget in the account currency's minor units, MULTIPLIER = multiply current budget"),
        time_start: z.string().describe("ISO 8601 start time for the budget increase"),
        time_end: z.string().describe("ISO 8601 end time for the budget increase"),
      },
      annotations: { ...CREATE },
    },
    async ({ campaign_id, budget_value, budget_value_type, time_start, time_end }) => {
      const id = validateMetaId(campaign_id, "campaign");
      assertBudgetValue(budget_value, budget_value_type);
      const result = await metaApiClient.postForm<{ id: string }>(
        `/${id}/budget_schedules`,
        {
          budget_value,
          budget_value_type,
          time_start,
          time_end,
        },
      );

      return {
        content: [
          {
            type: "text",
            text: `Budget schedule created!\nID: ${result.id}\nCampaign: ${id}\nValue: ${budget_value} (${budget_value_type})\nPeriod: ${time_start} → ${time_end}`,
          },
        ],
      };
    },
  );
}
