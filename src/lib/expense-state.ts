import { getReviewIssues, type ReviewIssue } from "@/lib/review";
import type { Expense } from "@/lib/types";

export type ExpenseStateKind =
  | "reading"
  | "offline"
  | "failed"
  | "review"
  | "complete"
  | "ready"
  | "archived";

export type ExpenseState = {
  kind: ExpenseStateKind;
  label: string;
  issues: ReviewIssue[];
};

/** How an expense should be described in lists and on the review screen. */
export function getExpenseState(
  expense: Expense,
  members: string[],
  online: boolean,
): ExpenseState {
  const issues = getReviewIssues(expense, members);

  if (expense.status === "archived") {
    return { kind: "archived", label: "Archived", issues };
  }

  if (expense.status === "ready") {
    return issues.length > 0
      ? { kind: "review", label: "Needs review", issues }
      : { kind: "ready", label: "Ready", issues };
  }

  if (expense.parseStatus === "pending") {
    return online
      ? { kind: "reading", label: "Reading…", issues }
      : { kind: "offline", label: "Saved offline", issues };
  }

  if (expense.parseStatus === "failed") {
    return { kind: "failed", label: "Couldn’t read", issues };
  }

  return issues.length > 0
    ? { kind: "review", label: "Needs review", issues }
    : { kind: "complete", label: "Check & mark ready", issues };
}
