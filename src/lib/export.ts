import type { Category, Expense } from "@/lib/types";

const categoryLabels: Record<Category, string> = {
  food: "Food",
  transport: "Transport",
  stay: "Stay",
  tickets: "Tickets",
  personal: "Personal",
  other: "Other",
};

function formatAmount(amount: number): string {
  if (Number.isInteger(amount)) {
    return amount.toString();
  }

  return amount.toFixed(2).replace(/\.?0+$/, "");
}

function getDescription(expense: Expense): string {
  if (expense.note.trim()) {
    return expense.note.trim();
  }

  if (expense.location?.trim()) {
    return expense.location.trim();
  }

  return "Expense";
}

function getSplitText(expense: Expense): string {
  if (expense.isPersonal) {
    return "Personal (not shared)";
  }

  const names = expense.included.join(", ");

  if (expense.splitType === "custom") {
    return `Split custom: ${names} (enter amounts in Splitwise)`;
  }

  return `Split equally: ${names}`;
}

export function buildExportText(
  tripName: string,
  expenses: Expense[],
): string {
  const lines = [...expenses]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((expense, index) => {
      const categorySegment = expense.category
        ? ` — ${categoryLabels[expense.category]}`
        : "";

      return `${index + 1}. ₹${formatAmount(expense.amount ?? 0)} — ${getDescription(expense)}${categorySegment} — ${getSplitText(expense)}`;
    });

  return `${tripName} — Ready to add to Splitwise\n\n${lines.join("\n")}`;
}
