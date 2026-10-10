import { CURRENCY_CODES, type CurrencyCode } from "@/lib/types";

export const currencyNames: Record<CurrencyCode, string> = {
  INR: "Indian rupee",
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
  AED: "UAE dirham",
};

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return (
    typeof value === "string" &&
    (CURRENCY_CODES as readonly string[]).includes(value)
  );
}

const explicitPatterns: Array<[CurrencyCode, RegExp]> = [
  ["INR", /₹|\binr\b|\brs\.?(?=\s|\d|$)|\brupees?\b/i],
  ["USD", /\busd\b|\bus\s?\$|\bus\s+dollars?\b/i],
  ["EUR", /€|\beur\b|\beuros?\b/i],
  ["GBP", /£|\bgbp\b|\bpounds?\s+sterling\b|\bquid\b|\d\s*pounds?\b|\bpounds?\s*\d/i],
  ["AED", /\baed\b|\bdirhams?\b|\bdhs\b/i],
];

// A dollar sign or the word "dollar" without a country qualifier.
const bareDollarPattern = /(?<![a-z])\$|(?<!\bus\s)\bdollars?\b/i;
const qualifiedDollarPattern = /\b(?:us|a|au|c|ca|s|sg|hk|nz)\s?\$/gi;

// Currencies we recognise but do not support in this iteration.
const unsupportedPattern =
  /¥|฿|₩|\b(?:jpy|thb|sgd|aud|cad|nzd|hkd|chf|cny|myr|idr|lkr|npr|yen|baht|ringgit|rupiah)\b|\b(?:a|au|c|ca|s|sg|hk|nz)\$/i;

export type CurrencyDetection = {
  /** Resolved currency, or null when the capture needs a decision. */
  currency: CurrencyCode | null;
  /** "capture" when the text named a currency, "default" when it did not. */
  source: "capture" | "default";
  /** The currency token(s) as written, kept for the review prompt. */
  mention: string | null;
};

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);

  return match ? match[0].trim() : null;
}

/**
 * Reads a currency from the capture without the AI.
 * - One explicit currency (USD, €, rupees ...) wins over the trip default.
 * - A bare "$" is USD only on a USD trip; elsewhere it needs review.
 * - Conflicting or unsupported currencies need review.
 * - Nothing mentioned: the trip default applies.
 */
export function detectCurrency(
  rawText: string,
  tripCurrency: CurrencyCode,
): CurrencyDetection {
  const text = rawText.normalize("NFKC");
  const found = new Map<CurrencyCode, string>();

  for (const [code, pattern] of explicitPatterns) {
    const mention = firstMatch(text, pattern);

    if (mention) {
      found.set(code, mention);
    }
  }

  const unsupported = firstMatch(text, unsupportedPattern);
  const withoutQualified = text.replace(qualifiedDollarPattern, " ");
  const bareDollar = firstMatch(withoutQualified, bareDollarPattern);

  if (unsupported) {
    return { currency: null, source: "capture", mention: unsupported };
  }

  if (found.size > 1) {
    return {
      currency: null,
      source: "capture",
      mention: [...found.values()].join(" / "),
    };
  }

  if (found.size === 1) {
    const [[code, mention]] = [...found.entries()];

    if (bareDollar && code !== "USD") {
      return {
        currency: null,
        source: "capture",
        mention: `${mention} / ${bareDollar}`,
      };
    }

    return { currency: code, source: "capture", mention };
  }

  if (bareDollar) {
    return tripCurrency === "USD"
      ? { currency: "USD", source: "capture", mention: bareDollar }
      : { currency: null, source: "capture", mention: bareDollar };
  }

  return { currency: tripCurrency, source: "default", mention: null };
}

function numberFormatter(currency: CurrencyCode | null, amount: number) {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;

  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  });
}

/** "1,240" or "22.50". Never formats a missing amount as zero. */
export function formatAmountNumber(
  amount: number | null,
  currency: CurrencyCode | null,
): string | null {
  if (amount === null || !Number.isFinite(amount)) {
    return null;
  }

  return numberFormatter(currency, amount).format(amount);
}

/** "INR 1,240", "USD 22.50". Unknown parts are spelled out, never zeroed. */
export function formatMoney(
  amount: number | null,
  currency: CurrencyCode | null,
): string {
  const number = formatAmountNumber(amount, currency);
  const code = currency ?? "???";

  if (number === null) {
    return `${code} amount missing`;
  }

  return `${code} ${number}`;
}

/** Largest amount accepted from a person or the AI. */
export const MAX_AMOUNT = 100_000_000;

// Accepted ways of writing an amount. Anything else is refused rather than
// guessed, so a separator is never silently dropped ("12,50" is not 1250).
// - 1240, 12.5, 12.50, 12. and .5: a dot is the decimal point.
const dotDecimal = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;
// - 12,50: a comma followed by exactly two digits is a decimal comma (as on
//   keyboards set to many European languages).
const commaDecimal = /^\d+,\d{2}$/;
// - 1,240 / 12,345.50: comma thousands groups.
const thousandsGroups = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
// - 1,00,000 / 12,34,567.50: Indian lakh/crore groups.
const lakhGroups = /^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,2})?$/;

export const amountInputHint =
  "Use a number above zero with up to two decimals, like 1240, 1,240, 12.50 or 12,50.";

/**
 * Parses what a person typed into the amount box. Returns null for anything
 * that isn't one of the accepted forms above, including ambiguous ones like
 * "1,2", "1.200" (three decimals) or "1 200", and for zero or amounts above
 * MAX_AMOUNT.
 */
export function parseAmountInput(text: string): number | null {
  const input = text.trim();
  let normalized: string;

  if (dotDecimal.test(input)) {
    normalized = input;
  } else if (commaDecimal.test(input)) {
    normalized = input.replace(",", ".");
  } else if (thousandsGroups.test(input) || lakhGroups.test(input)) {
    normalized = input.replace(/,/g, "");
  } else {
    return null;
  }

  const value = Number(normalized);

  return isValidAmount(value) ? value : null;
}

/** Positive, finite, at most MAX_AMOUNT, and at most two decimals. */
export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_AMOUNT &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
  );
}

export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}
