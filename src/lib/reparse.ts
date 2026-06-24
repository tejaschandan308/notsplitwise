import {
  listExpenses,
  updateExpense,
} from "@/lib/storage";
import type { ParsedExpenseFields, Trip } from "@/lib/types";

type ParseResponse = {
  ok: boolean;
  data: ParsedExpenseFields;
  error?: string;
};

let isReparsing = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function markParseFailed(id: string): Promise<void> {
  try {
    await updateExpense(id, { parseStatus: "failed" });
  } catch {
    // Leave the item for a later pass if IndexedDB is briefly unavailable.
  }
}

export async function reparsePendingDrafts(trip: Trip): Promise<void> {
  if (isReparsing || typeof navigator === "undefined" || !navigator.onLine) {
    return;
  }

  isReparsing = true;

  try {
    const drafts = await listExpenses(trip.id, "draft");
    const reparsable = drafts.filter(
      (expense) =>
        expense.parseStatus === "failed" || expense.parseStatus === "pending",
    );

    for (const expense of reparsable) {
      if (!navigator.onLine) {
        break;
      }

      try {
        const response = await fetch("/api/parse", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rawText: expense.rawText,
            members: trip.members,
          }),
        });
        const result = (await response.json()) as ParseResponse;

        if (result.ok) {
          await updateExpense(expense.id, {
            ...result.data,
            parseStatus: "done",
          });
        } else {
          await markParseFailed(expense.id);
        }
      } catch {
        await markParseFailed(expense.id);
      }

      await delay(150);
    }
  } catch {
    // Re-parse is opportunistic; the inbox should never fail because of it.
  } finally {
    isReparsing = false;
  }
}
