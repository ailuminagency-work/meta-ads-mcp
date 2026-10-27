import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import { normalizeAccountId, truncateResponse, validateMetaId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { RULE_DEFAULT_FIELDS } from "../meta/types/rule.js";
import type { AdRule, AdRuleHistory, MetaApiResponse } from "../meta/types/index.js";
import { READ, CREATE, UPDATE, DELETE, WRITE_WARNING } from "./_register.js";
import { fenceBlock, fencedJsonBlock, untrustedJson, untrustedText } from "../media/content-blocks.js";

const executionTypeEnum = z.enum([
  "PAUSE", "UNPAUSE", "CHANGE_BUDGET", "CHANGE_BID",
  "ROTATE", "NOTIFICATION",
]);

const ALLOWED_EXECUTION_TYPES: ReadonlySet<string> = new Set(["PAUSE", "ROTATE", "NOTIFICATION"]);
const SPEND_EXECUTION_TYPES: ReadonlySet<string> = new Set(["UNPAUSE", "CHANGE_BUDGET", "CHANGE_BID"]);
const SPEND_OPTION_FIELD = /budget|bid|spend/i;
const SPEND_OPTION_OPERATORS: ReadonlySet<string> = new Set(["INCREASE_BY", "DECREASE_BY"]);

const AUTONOMOUS_SPEND_REFUSAL =
  "Autonomous spend-changing rules are not permitted in this release: UNPAUSE, CHANGE_BUDGET and CHANGE_BID rules, and execution_options that change a budget, bid or spend, can start delivery or raise spend repeatedly on Meta's schedule with no human approval and no ceiling. Build objects through the approved paused-build path instead. PAUSE, ROTATE and NOTIFICATION rules are still allowed.";

interface ExecutionSpecInput {
  execution_type: unknown;
  execution_options?: Array<{ field: string; value: string | number; operator?: string }>;
}

/**
 * Fail-closed allowlist, applied before any request: the schema's enum is only the first line, so the handler
 * re-checks the exact value (a spelling variant of a refused type is refused as such, anything else unknown is
 * refused) and rebuilds the spec from the known keys so nothing else rides along to Meta.
 */
function checkedExecutionSpec(spec: ExecutionSpecInput): Record<string, unknown> {
  const type = spec.execution_type;
  if (typeof type !== "string" || !ALLOWED_EXECUTION_TYPES.has(type)) {
    if (typeof type === "string" && SPEND_EXECUTION_TYPES.has(type.trim().toUpperCase())) {
      throw new Error(AUTONOMOUS_SPEND_REFUSAL);
    }
    throw new Error(
      `Unsupported execution_type ${JSON.stringify(typeof type === "string" ? type.slice(0, 40) : typeof type)}. Allowed: PAUSE, ROTATE, NOTIFICATION.`,
    );
  }
  const options = spec.execution_options;
  if (options?.some((o) => SPEND_OPTION_FIELD.test(o.field) || SPEND_OPTION_OPERATORS.has(String(o.operator ?? "").trim().toUpperCase()))) {
    throw new Error(AUTONOMOUS_SPEND_REFUSAL);
  }
  return { execution_type: type, ...(options ? { execution_options: options } : {}) };
}

/**
 * Enabling is the one status change that can start a rule that already exists on Meta, so the rule's current
 * execution_type is read first and must be exactly an allowed one; a failed or empty read refuses. Disabling
 * never reads: it stays an unconditional kill switch.
 */
async function assertRuleSafeToEnable(ruleId: string): Promise<void> {
  const refused = (why: string) =>
    new Error(`Autonomous spend-changing rules are not permitted in this release, and rule ${ruleId} ${why}, so it will not be enabled. Only PAUSE, ROTATE and NOTIFICATION rules can be enabled.`);
  let current: { execution_spec?: { execution_type?: unknown } | null };
  try {
    current = await metaApiClient.get<typeof current>(`/${ruleId}`, { fields: "execution_spec,status" });
  } catch {
    throw refused("could not be read to confirm what it does");
  }
  const type = current?.execution_spec?.execution_type;
  if (typeof type !== "string" || !ALLOWED_EXECUTION_TYPES.has(type)) {
    throw refused(`is not confirmed to be a PAUSE, ROTATE or NOTIFICATION rule (current execution_type: ${typeof type === "string" ? JSON.stringify(type.slice(0, 40)) : "not reported"})`);
  }
}

const scheduleTypeEnum = z.enum([
  "CUSTOM", "SEMI_HOURLY", "HOURLY", "DAILY", "WEEKLY",
]);

export function registerRuleTools(server: McpServer): void {
  // ─── Get Ad Rules ─────────────────────────────────────────────
  server.registerTool(
    "ads_get_ad_rules",
    {
      description:
        "List automated rules for an ad account. Shows rules that auto-pause, adjust budgets, or send notifications based on performance.",
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        limit: z.number().min(1).max(100).default(25),
        fields: z.array(z.string()).optional(),
      },
      annotations: { ...READ },
    },
    async ({ account_id, limit, fields }) => {
      const id = normalizeAccountId(account_id);
      const fieldsParam = buildFieldsParam(fields, [...RULE_DEFAULT_FIELDS]);

      const response = await metaApiClient.get<MetaApiResponse<AdRule>>(
        `/${id}/adrules_library`,
        { fields: fieldsParam, limit },
      );
      const rules = response.data ?? [];

      const text =
        rules.length === 0
          ? "No automated rules found."
          : fenceBlock(
              rules.map(
                (r) =>
                  `• ${untrustedText(r.name) || "Unnamed"} (${untrustedText(r.id, 40)}) — Status: ${untrustedText(r.status, 40)} — Action: ${untrustedText(r.execution_spec?.execution_type, 60) || "N/A"}`,
              ),
            );

      return {
        content: [
          { type: "text", text: `Found ${rules.length} rule(s):\n\n${text}` },
          { type: "text", text: fencedJsonBlock(rules) },
        ],
      };
    },
  );

  // ─── Create Ad Rule ───────────────────────────────────────────
  server.registerTool(
    "ads_create_ad_rule",
    {
      description: `${WRITE_WARNING}Create an automated rule. Allowed actions: PAUSE, ROTATE and NOTIFICATION (examples: pause ad sets when CPL > $20, notify when CTR < 1%). UNPAUSE, CHANGE_BUDGET and CHANGE_BID are refused: autonomous spend-changing rules are not permitted in this release.`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        name: z.string().min(1).describe("Rule name"),
        evaluation_spec: z
          .object({
            evaluation_type: z.enum(["TRIGGER", "SCHEDULE"]).describe("TRIGGER for real-time, SCHEDULE for periodic"),
            filters: z
              .array(
                z.object({
                  field: z.string().describe("Metric field (e.g., cost_per_action_type, ctr, impressions)"),
                  value: z.union([z.string(), z.number()]).describe("Threshold value"),
                  operator: z.enum(["GREATER_THAN", "LESS_THAN", "EQUAL", "NOT_EQUAL", "IN_RANGE", "NOT_IN_RANGE"])
                    .describe("Comparison operator"),
                }),
              )
              .describe("Conditions that trigger the rule"),
          })
          .describe("When to evaluate the rule"),
        execution_spec: z
          .object({
            execution_type: executionTypeEnum.describe("Action to take when conditions are met"),
            execution_options: z
              .array(
                z.object({
                  field: z.string(),
                  value: z.union([z.string(), z.number()]),
                  operator: z.enum(["EQUAL", "INCREASE_BY", "DECREASE_BY"]).optional(),
                }),
              )
              .optional()
              .describe("Options for ROTATE/NOTIFICATION execution types. Options that change a budget, bid or spend are refused."),
          })
          .describe("What to do when triggered"),
        schedule_spec: z
          .object({
            schedule_type: scheduleTypeEnum.describe("How often to evaluate"),
          })
          .optional(),
      },
      annotations: { ...CREATE },
    },
    async ({ account_id, name, evaluation_spec, execution_spec, schedule_spec }) => {
      const checkedExecution = checkedExecutionSpec(execution_spec);
      const id = normalizeAccountId(account_id);

      const body: Record<string, string | number | boolean> = {
        name,
        evaluation_spec: JSON.stringify(evaluation_spec),
        execution_spec: JSON.stringify(checkedExecution),
      };

      if (schedule_spec) {
        body.schedule_spec = JSON.stringify(schedule_spec);
      }

      const result = await metaApiClient.postForm<{ id: string }>(
        `/${id}/adrules_library`,
        body,
      );

      return {
        content: [
          {
            type: "text",
            text: `Automated rule created!\nID: ${result.id}\nName: ${name}\nAction: ${execution_spec.execution_type}\nEval: ${evaluation_spec.evaluation_type}`,
          },
        ],
      };
    },
  );

  // ─── Get Rule Details ─────────────────────────────────────────
  server.registerTool(
    "ads_get_rule_details",
    {
      description:
        "Get detailed information about an automated rule and its execution history.",
      inputSchema: {
        rule_id: z.string().describe("Rule ID"),
        fields: z.array(z.string()).optional(),
        include_history: z.boolean().default(false).describe("Include rule execution history"),
      },
      annotations: { ...READ },
    },
    async ({ rule_id, fields, include_history }) => {
      const id = validateMetaId(rule_id, "rule");
      const fieldsParam = buildFieldsParam(fields, [...RULE_DEFAULT_FIELDS]);

      const rule = await metaApiClient.get<AdRule>(
        `/${id}`,
        { fields: fieldsParam },
      );

      const content: Array<{ type: "text"; text: string }> = [
        {
          type: "text",
          text: fenceBlock([
            `Rule: ${untrustedText(rule.name) || "Unnamed"} (${untrustedText(rule.id, 40)})`,
            `Status: ${untrustedText(rule.status, 40)}`,
            `Action: ${untrustedText(rule.execution_spec?.execution_type, 60) || "N/A"}`,
          ]),
        },
        { type: "text", text: fencedJsonBlock(rule) },
      ];

      if (include_history) {
        const historyResponse = await metaApiClient.get<MetaApiResponse<AdRuleHistory>>(
          `/${id}/history`,
          { limit: 50 },
        );
        const history = historyResponse.data ?? [];

        if (history.length > 0) {
          const historyText = fenceBlock([truncateResponse(untrustedJson(history))]);
          content.push({
            type: "text",
            text: `Execution History (${history.length} entries):\n${historyText}`,
          });
        }
      }

      return { content };
    },
  );

  // ─── Update Ad Rule ───────────────────────────────────────────
  server.registerTool(
    "ads_update_ad_rule",
    {
      description: `${WRITE_WARNING}Update an existing automated rule's name, status, or specs. UNPAUSE, CHANGE_BUDGET and CHANGE_BID are refused as the new execution_type, and a rule can be enabled only after it is read and confirmed to be a PAUSE, ROTATE or NOTIFICATION rule: autonomous spend-changing rules are not permitted in this release. Disabling is always allowed.`,
      inputSchema: {
        rule_id: z.string().describe("Rule ID to update"),
        name: z.string().optional().describe("New name"),
        status: z.enum(["ENABLED", "DISABLED"]).optional().describe("Enable or disable the rule"),
        evaluation_spec: z
          .object({
            evaluation_type: z.enum(["TRIGGER", "SCHEDULE"]),
            filters: z.array(
              z.object({
                field: z.string(),
                value: z.union([z.string(), z.number()]),
                operator: z.string(),
              }),
            ),
          })
          .optional(),
        execution_spec: z
          .object({
            execution_type: executionTypeEnum,
            execution_options: z
              .array(
                z.object({
                  field: z.string(),
                  value: z.union([z.string(), z.number()]),
                  operator: z.string().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      },
      annotations: { ...UPDATE },
    },
    async ({ rule_id, name, status, evaluation_spec, execution_spec }) => {
      const checkedExecution = execution_spec ? checkedExecutionSpec(execution_spec) : undefined;
      const id = validateMetaId(rule_id, "rule");
      if (status === "ENABLED") await assertRuleSafeToEnable(id);
      const body: Record<string, string | number | boolean> = {};
      if (name) body.name = name;
      if (status) body.status = status;
      if (evaluation_spec) body.evaluation_spec = JSON.stringify(evaluation_spec);
      if (checkedExecution) body.execution_spec = JSON.stringify(checkedExecution);

      await metaApiClient.postForm<{ success: boolean }>(`/${id}`, body);

      return {
        content: [
          { type: "text", text: `Rule ${id} updated successfully.` },
        ],
      };
    },
  );

  // ─── Delete Ad Rule ───────────────────────────────────────────
  server.registerTool(
    "ads_delete_ad_rule",
    {
      description: `${WRITE_WARNING}Delete an automated rule.`,
      inputSchema: {
        rule_id: z.string().describe("Rule ID to delete"),
      },
      annotations: { ...DELETE },
    },
    async ({ rule_id }) => {
      const id = validateMetaId(rule_id, "rule");
      await metaApiClient.delete<{ success: boolean }>(`/${id}`);

      return {
        content: [
          { type: "text", text: `Rule ${id} deleted successfully.` },
        ],
      };
    },
  );
}
