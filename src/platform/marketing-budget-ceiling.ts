import { z } from "zod";
import { PlatformDenied, type OperationPlan } from "./models.js";
import { MAX_MINOR_UNIT_AMOUNT, currencyOffset, toMinorUnits } from "../meta/currency.js";
import { platformWritesEnabled } from "./runtime.js";

/**
 * Per-client budget ceilings for strict (client-scoped, approval-gated) Marketing writes.
 *
 * Configuration is one strict JSON document in LUMIN_MARKETING_BUDGET_CEILINGS:
 *   {"version":1,"clients":{"<client_id>":{"currency":"USD","max_daily_budget":"500.00","max_lifetime_budget":"5000.00"}}}
 * Amounts are decimal strings in the currency's major unit and are converted with the Meta currency
 * offset table, so "500.00" is 50000 for USD and "500" is 500 for JPY. There is deliberately no default
 * and no wildcard: a budget-bearing write for a client without an entry is denied, and an unreadable
 * document denies every budget-bearing write instead of being ignored.
 *
 * A ceiling is compared only with an amount in the same currency. No exchange rate is ever applied.
 * At activation the account currency is observed from the provider and must equal the ceiling currency.
 * At plan time the account currency is not yet known, so the ceiling's own currency is assumed; the
 * activation check is what proves the match before any delivery is possible.
 */
export const BUDGET_CEILINGS_ENV = "LUMIN_MARKETING_BUDGET_CEILINGS";

export interface BudgetCeiling {
  currency: string;
  maxDailyMinor: number;
  maxLifetimeMinor: number;
}

export interface PlanBudget {
  field: "daily_budget" | "lifetime_budget";
  amountMinor: number;
}

const decimal = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);
const entry = z
  .object({ currency: z.string(), max_daily_budget: decimal, max_lifetime_budget: decimal })
  .strict();
const document = z
  .object({
    version: z.literal(1),
    clients: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), entry),
  })
  .strict();

const BUDGET_FIELDS = ["daily_budget", "lifetime_budget"] as const;

const SPEND_LIKE_KEY = /budget|spend_cap|spend_target|bid_/;

/** Keys the strict builders emit that look spend-related but carry no amount this ceiling compares (enums, flags, and bid_amount, which has its own absolute bound). */
const KNOWN_SPEND_LIKE_KEYS: ReadonlySet<string> = new Set([
  "bid_strategy",
  "bid_amount",
  "budget_mode",
  "is_adset_budget_sharing_enabled",
  "marketing_budget_mode",
]);

/**
 * Keys are compared the way a form encoder or Graph could read them, not as typed: Unicode-compatibility folded,
 * with whitespace, control and format characters removed, lower-cased. A bracketed or dotted path
 * (adset_budgets[0][daily_budget]) is judged by its last segment.
 */
function normalizeKey(key: string): { full: string; leaf: string } {
  const full = key.normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Z}\s]/gu, "").toLowerCase();
  const leaf = full.split(/[[\].]+/).filter(Boolean).pop() ?? full;
  return { full, leaf };
}

let cache: { raw: string; value: ReadonlyMap<string, BudgetCeiling> } | undefined;

export function loadBudgetCeilings(env: Record<string, string | undefined> = process.env): ReadonlyMap<string, BudgetCeiling> {
  const raw = env[BUDGET_CEILINGS_ENV];
  if (raw === undefined || raw.trim() === "") return new Map();
  if (cache?.raw === raw) return cache.value;
  const map = new Map<string, BudgetCeiling>();
  try {
    if (raw.length > 65536) throw new Error("too large");
    const parsed = document.parse(JSON.parse(raw));
    const rows = Object.entries(parsed.clients);
    if (rows.length > 1000) throw new Error("too many clients");
    for (const [clientId, row] of rows) {
      if (currencyOffset(row.currency) === undefined) throw new Error("unsupported currency");
      const maxDailyMinor = toMinorUnits(row.max_daily_budget, row.currency);
      const maxLifetimeMinor = toMinorUnits(row.max_lifetime_budget, row.currency);
      for (const max of [maxDailyMinor, maxLifetimeMinor]) {
        if (max < 1 || max > MAX_MINOR_UNIT_AMOUNT) throw new Error("ceiling out of range");
      }
      map.set(clientId, { currency: row.currency, maxDailyMinor, maxLifetimeMinor });
    }
  } catch {
    throw new PlatformDenied("BUDGET_CEILING_CONFIG_INVALID");
  }
  cache = { raw, value: map };
  return map;
}

export function budgetCeilingFor(clientId: string, env: Record<string, string | undefined> = process.env): BudgetCeiling {
  const ceiling = loadBudgetCeilings(env).get(clientId);
  if (!ceiling) throw new PlatformDenied("BUDGET_CEILING_NOT_CONFIGURED");
  return ceiling;
}

function amountMinor(value: unknown): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9]\d{0,15}$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new PlatformDenied("BUDGET_AMOUNT_INVALID");
  }
  return Number(text);
}

/** Every daily/lifetime budget a plan would send, wherever it is nested, including inside JSON-encoded strings. */
export function planBudgets(plan: OperationPlan): PlanBudget[] {
  const found: PlanBudget[] = [];
  let nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (++nodes > 10000 || depth > 30) throw new PlatformDenied("PLAN_TOO_COMPLEX");
    if (typeof value === "string" && /^\s*[[{]/.test(value)) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(value);
      } catch {
        throw new PlatformDenied("OPAQUE_JSON_INVALID");
      }
      visit(decoded, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const { full, leaf } = normalizeKey(key);
      const field = BUDGET_FIELDS.find((name) => name === leaf);
      if (field) found.push({ field, amountMinor: amountMinor(item) });
      else if (SPEND_LIKE_KEY.test(full) && !KNOWN_SPEND_LIKE_KEYS.has(full)) throw new PlatformDenied("BUDGET_KEY_UNRECOGNISED");
      else visit(item, depth + 1);
    }
  }
  visit(plan.parameters, 0);
  return found;
}

function assertWithin(ceiling: BudgetCeiling, budget: PlanBudget): void {
  const max = budget.field === "daily_budget" ? ceiling.maxDailyMinor : ceiling.maxLifetimeMinor;
  if (budget.amountMinor > max) throw new PlatformDenied("BUDGET_CEILING_EXCEEDED");
}

/**
 * Rejects a strict write whose budgets exceed the client's ceiling, or whose client has none.
 * Runs before any approval is consumed or provider request is built. Plans that carry no budget are unaffected.
 */
export function assertPlanWithinBudgetCeiling(
  ctx: { clientId: string },
  plan: OperationPlan,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!platformWritesEnabled()) return;
  const budgets = planBudgets(plan);
  if (budgets.length === 0) return;
  const ceiling = budgetCeilingFor(ctx.clientId, env);
  for (const budget of budgets) assertWithin(ceiling, budget);
}

/**
 * Held to the ceiling again once the provider has been read, before the exact-expectation comparison, so a
 * ceiling in one currency can never be applied to an account the provider reports in another, and an
 * observed budget above the ceiling is refused with its own reason even if the reviewed expectation differs.
 */
export function assertObservedActivationWithinBudgetCeiling(
  clientId: string,
  observed: { currency: unknown; campaignDailyBudget: unknown; adsetDailyBudget: unknown },
  env: Record<string, string | undefined> = process.env,
): void {
  const ceiling = budgetCeilingFor(clientId, env);
  if (observed.currency !== ceiling.currency) throw new PlatformDenied("BUDGET_CEILING_CURRENCY_MISMATCH");
  for (const raw of [observed.campaignDailyBudget, observed.adsetDailyBudget]) {
    const text = typeof raw === "number" ? String(raw) : raw;
    if (typeof text !== "string" || !/^\d{1,16}$/.test(text) || !Number.isSafeInteger(Number(text))) {
      throw new PlatformDenied("BUDGET_AMOUNT_INVALID");
    }
    if (Number(text) > ceiling.maxDailyMinor) throw new PlatformDenied("BUDGET_CEILING_EXCEEDED");
  }
}

/**
 * Activation compares the human-reviewed expected budgets with the ceiling before any provider read.
 * The control client then requires the provider-observed budgets and account currency to equal these
 * expectations, and holds the observed values to the ceiling as well.
 */
export function assertActivationWithinBudgetCeiling(
  clientId: string,
  expected: { currency: string; campaignDailyMinor: number; adsetDailyMinor: number },
  env: Record<string, string | undefined> = process.env,
): void {
  const ceiling = budgetCeilingFor(clientId, env);
  if (ceiling.currency !== expected.currency) throw new PlatformDenied("BUDGET_CEILING_CURRENCY_MISMATCH");
  for (const amountMinor of [expected.campaignDailyMinor, expected.adsetDailyMinor]) {
    if (amountMinor > ceiling.maxDailyMinor) throw new PlatformDenied("BUDGET_CEILING_EXCEEDED");
  }
}
