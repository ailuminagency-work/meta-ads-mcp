import { vi } from "vitest";
import { BUDGET_CEILINGS_ENV } from "../../src/platform/marketing-budget-ceiling.js";

export const SYNTHETIC_CEILING_CLIENT_IDS = ["client", "c", "a", "b", "other", "foreign"] as const;

export interface SyntheticCeiling {
  currency?: string;
  daily?: string;
  lifetime?: string;
}

export function budgetCeilingDocument(clients: Record<string, SyntheticCeiling>): string {
  return JSON.stringify({
    version: 1,
    clients: Object.fromEntries(
      Object.entries(clients).map(([id, ceiling]) => [
        id,
        {
          currency: ceiling.currency ?? "USD",
          max_daily_budget: ceiling.daily ?? "10000.00",
          max_lifetime_budget: ceiling.lifetime ?? "100000.00",
        },
      ]),
    ),
  });
}

/** Generous synthetic ceilings so unrelated journeys can create budgets; ceiling behaviour has its own tests. */
export function stubBudgetCeilings(
  clients: Record<string, SyntheticCeiling> = Object.fromEntries(SYNTHETIC_CEILING_CLIENT_IDS.map((id) => [id, {}])),
): void {
  vi.stubEnv(BUDGET_CEILINGS_ENV, budgetCeilingDocument(clients));
}
