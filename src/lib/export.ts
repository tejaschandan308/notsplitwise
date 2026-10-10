import { formatMoney, isValidAmount } from "@/lib/currency";
import type { Category, CurrencyCode, Expense } from "@/lib/types";

export const categoryLabels: Record<Category, string> = {
  food: "Food",
  transport: "Transport",
  stay: "Stay",
  tickets: "Tickets",
  personal: "Personal",
  other: "Other",
};

export function describeExpense(expense: Expense): string {
  return (
    expense.note.trim() ||
    expense.location?.trim() ||
    expense.rawText.trim() ||
    "Expense"
  );
}

export function payerText(expense: Expense): string {
  if (!expense.paidBy) {
    return "payer not set";
  }

  if (expense.paidBySource === "legacy") {
    return `paid by ${expense.paidBy} (assumed; saved before payer tracking)`;
  }

  return `paid by ${expense.paidBy}`;
}

export function splitText(expense: Expense): string {
  if (expense.isPersonal) {
    return expense.paidBy && expense.paidBy !== "Me"
      ? `For Me only: I owe ${expense.paidBy} the full amount`
      : "Personal, not shared (nothing to enter)";
  }

  const names = expense.included.join(", ");
  const count = expense.included.length;

  if (expense.splitType === "custom") {
    return `Custom split, shares not calculated here; enter them in Splitwise. Between: ${names}`;
  }

  return `Split equally between ${count} ${count === 1 ? "person" : "people"}: ${names}`;
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Per-currency totals of valid amounts. Currencies are never mixed. */
export function totalsByCurrency(
  expenses: Expense[],
): Array<{ currency: CurrencyCode; total: number }> {
  const totals = new Map<CurrencyCode, number>();

  for (const expense of expenses) {
    if (expense.isPersonal && (!expense.paidBy || expense.paidBy === "Me")) {
      continue;
    }

    if (expense.currency && isValidAmount(expense.amount)) {
      totals.set(
        expense.currency,
        Math.round(((totals.get(expense.currency) ?? 0) + expense.amount) * 100) /
          100,
      );
    }
  }

  return [...totals.entries()].map(([currency, total]) => ({
    currency,
    total,
  }));
}

export function buildExportText(tripName: string, expenses: Expense[]): string {
  const sorted = [...expenses].sort((a, b) => a.createdAt - b.createdAt);
  const blocks = sorted.map((expense, index) => {
    const category = expense.category
      ? ` (${categoryLabels[expense.category]})`
      : "";

    return [
      `${index + 1}. ${describeExpense(expense)}${category}, ${shortDate(expense.createdAt)}`,
      `   ${formatMoney(expense.amount, expense.currency)}, ${payerText(expense)}`,
      `   ${splitText(expense)}`,
    ].join("\n");
  });
  const totals = totalsByCurrency(sorted);
  const totalLine =
    totals.length > 0
      ? `\n\nShared totals by currency (not converted): ${totals
          .map(({ currency, total }) => formatMoney(total, currency))
          .join(" · ")}`
      : "";

  return [
    `${tripName}: expenses to enter in Splitwise`,
    "Reference for manual entry. Nothing here is sent to Splitwise.",
    "",
    blocks.join("\n\n"),
  ]
    .join("\n")
    .concat(totalLine);
}
