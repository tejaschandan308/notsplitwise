import { describe, expect, it } from "vitest";
import {
  detectCurrency,
  formatMoney,
  parseAmountInput,
} from "@/lib/currency";

describe("detectCurrency", () => {
  it.each([
    ["38 usd uber", "INR", "USD"],
    ["US$ 38 uber", "INR", "USD"],
    ["40 us dollars", "INR", "USD"],
    ["€42 tapas", "INR", "EUR"],
    ["42 euros tapas", "INR", "EUR"],
    ["£12 pints", "INR", "GBP"],
    ["12 gbp pints", "INR", "GBP"],
    ["120 aed taxi", "INR", "AED"],
    ["80 dirhams", "USD", "AED"],
    ["rs 500 chai", "USD", "INR"],
    ["₹500 chai", "USD", "INR"],
    ["500 rupees chai", "EUR", "INR"],
    ["$40 taxi", "USD", "USD"],
  ] as const)("%s on a %s trip -> %s", (text, trip, expected) => {
    const result = detectCurrency(text, trip);
    expect(result.currency).toBe(expected);
    expect(result.source).toBe("capture");
  });

  it.each([
    ["$40 taxi", "INR"],
    ["40 dollars taxi", "EUR"],
    ["A$40 taxi", "INR"],
    ["50 usd and 4000 rs", "INR"],
    ["€20 or $25", "EUR"],
    ["3000 yen ramen", "INR"],
  ] as const)("%s on a %s trip needs review", (text, trip) => {
    const result = detectCurrency(text, trip);
    expect(result.currency).toBeNull();
    expect(result.mention).toBeTruthy();
  });

  it("falls back to the trip currency when nothing is named", () => {
    expect(detectCurrency("1240 airport lunch", "GBP")).toEqual({
      currency: "GBP",
      source: "default",
      mention: null,
    });
  });

  it("does not read ordinary words as currencies", () => {
    expect(detectCurrency("3 hrs boat tour, yours truly", "INR").source).toBe(
      "default",
    );
  });
});

describe("formatting", () => {
  it("formats with the currency code", () => {
    expect(formatMoney(1240, "INR")).toBe("INR 1,240");
    expect(formatMoney(124000, "INR")).toBe("INR 1,24,000");
    expect(formatMoney(22.5, "USD")).toBe("USD 22.50");
  });

  it("never turns a missing amount into zero", () => {
    expect(formatMoney(null, "EUR")).toBe("EUR amount missing");
    expect(formatMoney(null, null)).not.toMatch(/\b0\b/);
  });

  it("parses typed amounts strictly", () => {
    expect(parseAmountInput("1,240")).toBe(1240);
    expect(parseAmountInput("12.5")).toBe(12.5);
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("-5")).toBeNull();
    expect(parseAmountInput("12abc")).toBeNull();
    expect(parseAmountInput("1e999")).toBeNull();
  });
});
