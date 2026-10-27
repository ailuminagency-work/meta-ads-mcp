import { describe, expect, it } from "vitest";
import {
  CURRENCY_OFFSETS,
  MAX_MINOR_UNIT_AMOUNT,
  UnsupportedCurrencyError,
  currencyOffset,
  fromMinorUnits,
  minorUnitAmount,
  minorUnitDigits,
  normalizeMinorUnitAmount,
  requireCurrencyOffset,
  toMinorUnits,
} from "../../src/meta/currency.js";

describe("Meta currency offsets", () => {
  it("records whole-unit (offset 1) currencies exactly", () => {
    const wholeUnit = Object.entries(CURRENCY_OFFSETS)
      .filter(([, offset]) => offset === 1)
      .map(([code]) => code)
      .sort();
    expect(wholeUnit).toEqual(["CLP", "COP", "CRC", "HUF", "IDR", "ISK", "JPY", "KRW", "PYG", "TWD", "VND"]);
  });

  it.each(["USD", "EUR", "GBP", "CAD", "AUD", "BRL", "INR", "MXN"])("treats %s as cents (offset 100)", (code) => {
    expect(currencyOffset(code)).toBe(100);
    expect(minorUnitDigits(code)).toBe(2);
  });

  it.each(["JPY", "KRW", "TWD", "VND"])("treats %s as whole units (offset 1)", (code) => {
    expect(currencyOffset(code)).toBe(1);
    expect(minorUnitDigits(code)).toBe(0);
  });

  it("never guesses for unknown, lower-case or prototype-named currencies", () => {
    for (const code of ["XTS", "usd", "", "constructor", "__proto__", "toString"]) {
      expect(currencyOffset(code)).toBeUndefined();
      expect(() => requireCurrencyOffset(code)).toThrow(UnsupportedCurrencyError);
    }
    expect(currencyOffset(undefined)).toBeUndefined();
    expect(currencyOffset(null)).toBeUndefined();
  });

  it("is frozen so a caller cannot rewrite an offset at runtime", () => {
    expect(Object.isFrozen(CURRENCY_OFFSETS)).toBe(true);
  });
});

describe("toMinorUnits", () => {
  it("scales cents currencies by 100 and whole-unit currencies by 1", () => {
    expect(toMinorUnits("50", "USD")).toBe(5000);
    expect(toMinorUnits("50.25", "USD")).toBe(5025);
    expect(toMinorUnits("0.07", "EUR")).toBe(7);
    expect(toMinorUnits("5000", "JPY")).toBe(5000);
    expect(toMinorUnits(5000, "KRW")).toBe(5000);
    expect(toMinorUnits(19.99, "USD")).toBe(1999);
  });

  it("accepts trailing zero fractions only when the currency can represent the value", () => {
    expect(toMinorUnits("500.00", "JPY")).toBe(500);
    expect(toMinorUnits("10.5", "USD")).toBe(1050);
    expect(() => toMinorUnits("500.5", "JPY")).toThrow(RangeError);
    expect(() => toMinorUnits("10.505", "USD")).toThrow(RangeError);
  });

  it.each(["", "-1", "1e3", "NaN", "Infinity", "1,000", " 5", "5 ", "0x10", "1.", ".5"])("rejects %j", (value) => {
    expect(() => toMinorUnits(value, "USD")).toThrow(RangeError);
  });

  it("rejects non-finite numbers and amounts beyond a safe integer", () => {
    expect(() => toMinorUnits(Number.NaN, "USD")).toThrow(RangeError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY, "USD")).toThrow(RangeError);
    expect(() => toMinorUnits(1e21, "USD")).toThrow(RangeError);
    expect(() => toMinorUnits("999999999999999", "USD")).toThrow(RangeError);
  });

  it("refuses a currency without a recorded offset", () => {
    expect(() => toMinorUnits("5", "XTS")).toThrow(UnsupportedCurrencyError);
  });
});

describe("fromMinorUnits", () => {
  it("renders cents currencies with two decimals and whole-unit currencies with none", () => {
    expect(fromMinorUnits(5000, "USD")).toBe("50.00");
    expect(fromMinorUnits("5", "USD")).toBe("0.05");
    expect(fromMinorUnits(0, "USD")).toBe("0.00");
    expect(fromMinorUnits("100000", "EUR")).toBe("1000.00");
    expect(fromMinorUnits(5000, "JPY")).toBe("5000");
    expect(fromMinorUnits("0", "KRW")).toBe("0");
  });

  it("keeps the sign and never prints negative zero", () => {
    expect(fromMinorUnits(-500, "USD")).toBe("-5.00");
    expect(fromMinorUnits(-7, "TWD")).toBe("-7");
    expect(fromMinorUnits("-0", "USD")).toBe("0.00");
  });

  it("round-trips with toMinorUnits for every recorded currency", () => {
    for (const code of Object.keys(CURRENCY_OFFSETS)) {
      for (const minor of [0, 1, 99, 100, 123456, 1_000_000_000]) {
        expect(toMinorUnits(fromMinorUnits(minor, code), code), `${code} ${minor}`).toBe(minor);
      }
    }
  });

  it.each(["", "1.5", "abc", "1e3", "12345678901234567890"])("rejects %j", (value) => {
    expect(() => fromMinorUnits(value, "USD")).toThrow(RangeError);
  });

  it("rejects an unsafe integer number", () => {
    expect(() => fromMinorUnits(Number.MAX_SAFE_INTEGER + 2, "USD")).toThrow(RangeError);
  });
});

describe("normalizeMinorUnitAmount", () => {
  it("returns the canonical decimal form of whole amounts in range", () => {
    expect(normalizeMinorUnitAmount(1)).toBe("1");
    expect(normalizeMinorUnitAmount(5000)).toBe("5000");
    expect(normalizeMinorUnitAmount("5000")).toBe("5000");
    expect(normalizeMinorUnitAmount(MAX_MINOR_UNIT_AMOUNT)).toBe("1000000000");
    expect(normalizeMinorUnitAmount("1000000000")).toBe("1000000000");
  });

  it.each([0, -1, 1.5, MAX_MINOR_UNIT_AMOUNT + 1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2, "0", "-1", "1.5", "1e3", "0x10", "007", "+5", " 5", "5 ", "", "abc", "1000000001", "99999999999999999999", true, null, undefined, {}, []])(
    "refuses %s",
    (value) => {
      expect(normalizeMinorUnitAmount(value)).toBeUndefined();
    },
  );
});

describe("minorUnitAmount schema", () => {
  const schema = minorUnitAmount("test");

  it("accepts whole positive amounts up to the absolute ceiling", () => {
    expect(schema.safeParse(1).success).toBe(true);
    expect(schema.safeParse(MAX_MINOR_UNIT_AMOUNT).success).toBe(true);
  });

  it.each([0, -1, 1.5, MAX_MINOR_UNIT_AMOUNT + 1, Number.NaN, Number.POSITIVE_INFINITY, "5000"])("rejects %j", (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
