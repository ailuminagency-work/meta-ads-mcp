import { z } from "zod";

/**
 * Meta expresses every monetary field (daily_budget, lifetime_budget, bid_amount,
 * spend_cap, amount_spent, balance, min_daily_budget...) in the ad account
 * currency's minor unit, scaled by that currency's "offset". An offset of 100
 * means cents (USD 5000 = USD 50.00); an offset of 1 means the whole unit
 * (JPY 5000 = JPY 5000, KRW 5000 = KRW 5000).
 *
 * Source: Meta Marketing API "Currency codes" reference
 * (https://developers.facebook.com/docs/marketing-api/currencies), which lists
 * the offset per currency, and the Ad Set Budget limits reference
 * (https://developers.facebook.com/docs/marketing-api/adset/budget-limits/v3.3),
 * which groups CLP, COP, CRC, HUF, IDR, ISK, JPY, KRW, PYG, TWD and VND as
 * whole-unit currencies. The table was transcribed without live access to those
 * pages: a currency that is not listed is never guessed, see requireCurrencyOffset.
 */
export type CurrencyOffset = 1 | 100;

const WHOLE_UNIT = ["CLP", "COP", "CRC", "HUF", "IDR", "ISK", "JPY", "KRW", "PYG", "TWD", "VND"] as const;

const CENTS = [
  "AED", "ARS", "AUD", "BDT", "BGN", "BOB", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "DZD", "EGP",
  "EUR", "GBP", "GTQ", "HKD", "HNL", "ILS", "INR", "KES", "LKR", "MOP", "MXN", "MYR", "NGN", "NIO",
  "NOK", "NZD", "PEN", "PHP", "PKR", "PLN", "QAR", "RON", "RUB", "SAR", "SEK", "SGD", "THB", "TRY",
  "UAH", "USD", "UYU", "ZAR",
] as const;

export const CURRENCY_OFFSETS: Readonly<Record<string, CurrencyOffset>> = Object.freeze({
  ...Object.fromEntries(WHOLE_UNIT.map((code) => [code, 1 as const])),
  ...Object.fromEntries(CENTS.map((code) => [code, 100 as const])),
});

/** Absolute sanity bound on any single minor-unit amount accepted by a tool. Per-client ceilings are far lower. */
export const MAX_MINOR_UNIT_AMOUNT = 1_000_000_000;

export class UnsupportedCurrencyError extends Error {
  constructor(public readonly currency: string) {
    super(`No Meta currency offset is recorded for ${JSON.stringify(String(currency).slice(0, 8))}; refusing to guess.`);
    this.name = "UnsupportedCurrencyError";
  }
}

export function currencyOffset(currency: string | undefined | null): CurrencyOffset | undefined {
  if (typeof currency !== "string" || !Object.hasOwn(CURRENCY_OFFSETS, currency)) return undefined;
  return CURRENCY_OFFSETS[currency];
}

export function requireCurrencyOffset(currency: string): CurrencyOffset {
  const offset = currencyOffset(currency);
  if (offset === undefined) throw new UnsupportedCurrencyError(currency);
  return offset;
}

export function minorUnitDigits(currency: string): 0 | 2 {
  return requireCurrencyOffset(currency) === 100 ? 2 : 0;
}

const DECIMAL = /^(\d{1,15})(?:\.(\d{1,6}))?$/;

/**
 * Converts a major-unit amount ("50.00" USD, "5000" JPY) into the integer minor units Meta expects.
 * Strings are the lossless input form; finite non-negative numbers are accepted via their shortest
 * decimal representation. Fractions the currency cannot represent are rejected, never rounded.
 */
export function toMinorUnits(amount: string | number, currency: string): number {
  const digits = minorUnitDigits(currency);
  const text = typeof amount === "number" ? (Number.isFinite(amount) ? String(amount) : "") : amount;
  const match = DECIMAL.exec(text);
  if (!match) throw new RangeError("Amount must be a plain non-negative decimal number.");
  const [, whole, fraction = ""] = match;
  if (/[^0]/.test(fraction.slice(digits))) {
    throw new RangeError(`${currency} amounts have at most ${digits} decimal places.`);
  }
  const minor = Number(whole + fraction.slice(0, digits).padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor)) throw new RangeError("Amount is too large.");
  return minor;
}

/** Converts Meta minor units to a plain decimal string in the currency's major unit ("5000" USD -> "50.00"). */
export function fromMinorUnits(minor: string | number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const text = typeof minor === "number" ? (Number.isSafeInteger(minor) ? String(minor) : "") : minor.trim();
  if (!/^-?\d{1,18}$/.test(text)) throw new RangeError("Minor units must be an integer.");
  const negative = text.startsWith("-");
  const padded = text.replace("-", "").replace(/^0+(?=\d)/, "").padStart(digits + 1, "0");
  const body = digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return negative && /[^0.]/.test(body) ? `-${body}` : body;
}

/**
 * Canonical decimal form of a whole minor-unit amount between 1 and MAX_MINOR_UNIT_AMOUNT, for fields forwarded
 * from untyped input. Fractions, signs, exponents, hex, whitespace and leading zeros are all refused.
 */
export function normalizeMinorUnitAmount(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_MINOR_UNIT_AMOUNT ? String(value) : undefined;
  }
  if (typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= MAX_MINOR_UNIT_AMOUNT) return value;
  return undefined;
}

export function minorUnitAmount(description: string) {
  return z.number().int().min(1).max(MAX_MINOR_UNIT_AMOUNT).describe(description);
}

export const MINOR_UNIT_NOTE =
  "in the ad account currency's minor units: cents for most currencies (USD 5000 = $50.00) but whole units for JPY, KRW, TWD, VND, IDR, CLP, COP, CRC, HUF, ISK and PYG (JPY 5000 = ¥5000)";
