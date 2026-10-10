import { amountInputHint, isCurrencyCode, isValidAmount } from "@/lib/currency";
import type { Expense } from "@/lib/types";

export type ReviewIssueField =
  | "amount"
  | "currency"
  | "paidBy"
  | "included"
  | "unmatchedNames";

export type ReviewIssue = {
  field: ReviewIssueField;
  /** Short label for lists, e.g. "Who paid?" */
  label: string;
  /** One specific correction to make. */
  message: string;
};

type ReviewableExpense = Pick<
  Expense,
  | "amount"
  | "amountInput"
  | "currency"
  | "currencyMention"
  | "paidBy"
  | "paidBySource"
  | "payerMention"
  | "included"
  | "unmatchedNames"
  | "isPersonal"
>;

/** Explains an unresolved payer from what the capture said. */
export function payerMessage(
  expense: Pick<Expense, "paidBySource" | "payerMention">,
  members: string[],
): string {
  const mention = expense.payerMention;

  if (mention) {
    const isMember = members.some(
      (member) => member.toLowerCase() === mention.trim().toLowerCase(),
    );

    return isMember
      ? `The capture mentions “${mention}” paying, but it isn’t clear. Choose who paid.`
      : `The capture says “${mention}” paid, which doesn’t match one trip member. Choose who paid.`;
  }

  return expense.paidBySource === "capture"
    ? "The capture mentions paying but doesn’t clearly say who. Choose who paid."
    : "Choose who paid.";
}

/**
 * Everything that must be true before an expense can be Ready or exported.
 * This is the only validation gate; the AI's own confidence is not used.
 */
export function getReviewIssues(
  expense: ReviewableExpense,
  members: string[],
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const memberSet = new Set(members);

  if (expense.amountInput) {
    issues.push({
      field: "amount",
      label: "Amount not valid",
      message: `“${expense.amountInput}” isn’t a valid amount. ${amountInputHint}`,
    });
  } else if (expense.amount === null) {
    issues.push({
      field: "amount",
      label: "Amount missing",
      message: "Enter the amount from the bill.",
    });
  } else if (!isValidAmount(expense.amount)) {
    issues.push({
      field: "amount",
      label: "Amount invalid",
      message: "The amount must be above zero, with up to two decimals.",
    });
  }

  if (!isCurrencyCode(expense.currency)) {
    issues.push({
      field: "currency",
      label: "Currency unclear",
      message: expense.currencyMention
        ? `The capture says “${expense.currencyMention}”. Choose which currency that was.`
        : "Choose the currency.",
    });
  }

  if (expense.paidBy === null) {
    issues.push({
      field: "paidBy",
      label: "Who paid?",
      message: payerMessage(expense, members),
    });
  } else if (!memberSet.has(expense.paidBy)) {
    issues.push({
      field: "paidBy",
      label: "Payer not on trip",
      message: `${expense.paidBy} isn’t a trip member. Choose who paid.`,
    });
  }

  for (const name of expense.unmatchedNames) {
    issues.push({
      field: "unmatchedNames",
      label: `Who is “${name}”?`,
      message: `“${name}” isn’t on this trip. Match them to a member, add them, or ignore the name.`,
    });
  }

  if (!expense.isPersonal) {
    if (expense.included.length === 0) {
      issues.push({
        field: "included",
        label: "No one sharing",
        message: "Choose who shares this expense.",
      });
    } else if (expense.included.some((name) => !memberSet.has(name))) {
      issues.push({
        field: "included",
        label: "Unknown person",
        message: "Someone sharing this isn’t a trip member. Check the people.",
      });
    }
  }

  return issues;
}

export function canMarkReady(
  expense: ReviewableExpense,
  members: string[],
): boolean {
  return getReviewIssues(expense, members).length === 0;
}
