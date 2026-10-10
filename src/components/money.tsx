import { formatAmountNumber } from "@/lib/currency";
import type { CurrencyCode } from "@/lib/types";

/** Amount in ink with its currency code. Missing parts are said, not zeroed. */
export function Money({
  amount,
  currency,
  size = "md",
}: {
  amount: number | null;
  currency: CurrencyCode | null;
  size?: "md" | "lg";
}) {
  const number = formatAmountNumber(amount, currency);
  const numberClass =
    size === "lg" ? "text-2xl font-semibold" : "text-lg font-semibold";

  if (number === null) {
    return (
      <span className="text-[0.9375rem] font-medium text-ink-3 italic">
        No amount yet
      </span>
    );
  }

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={`text-xs font-semibold tracking-wide ${
          currency ? "text-ink-2" : "text-warn"
        }`}
      >
        {currency ?? "???"}
      </span>
      <span className={`${numberClass} text-ink`}>{number}</span>
    </span>
  );
}
