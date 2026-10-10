import {
  applyParseResult,
  claimParse,
  failParse,
  releaseParse,
} from "@/lib/parse-lifecycle";
import { getActiveTrip, listExpenses } from "@/lib/storage";
import type { ParseResponse } from "@/lib/types";

/** Client gives up before a claim goes stale (see PARSE_STALE_MS). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Automatic retries stop here; the Retry button always works. */
export const MAX_AUTO_ATTEMPTS = 3;

export type ParseRunResult =
  | "applied"
  | "discarded"
  | "failed"
  | "offline"
  | "skipped";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Short, user-facing copy for stored parse error codes. */
export function parseErrorMessage(code: string | null): string {
  switch (code) {
    case "ai_not_configured":
      return "AI reading isn’t set up on this server. Fill it in by hand.";
    case "invalid_input":
      return "This capture couldn’t be sent for reading. Fill it in by hand.";
    case "unreadable":
      return "The AI couldn’t make sense of this one. Fill it in by hand or retry.";
    case "timeout":
      return "Reading took too long. Retry, or fill it in by hand.";
    default:
      return "Couldn’t read this automatically. Retry, or fill it in by hand.";
  }
}

/**
 * Sends one draft to the AI and applies the result through the shared rule.
 * Safe to call from anywhere and any number of times: duplicate calls for
 * the same revision are refused by the claim, and late answers are dropped.
 */
export async function parseExpense(
  expenseId: string,
  options: { force?: boolean; fetchImpl?: FetchLike } = {},
): Promise<ParseRunResult> {
  if (isOffline()) {
    return "offline";
  }

  const ticket = await claimParse(expenseId, { force: options.force });

  if (!ticket) {
    return "skipped";
  }

  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  let response: Response;

  try {
    response = await fetchImpl("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: ticket.rawText,
        members: ticket.members,
        tripCurrency: ticket.defaultCurrency,
      }),
      signal:
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          : undefined,
    });
  } catch (error) {
    if (isOffline()) {
      await releaseParse(ticket);
      return "offline";
    }

    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    await failParse(ticket, timedOut ? "timeout" : "ai_unavailable");
    return "failed";
  }

  let result: ParseResponse;

  try {
    result = (await response.json()) as ParseResponse;
  } catch {
    await failParse(ticket, "ai_unavailable");
    return "failed";
  }

  if (!result || result.ok !== true) {
    const code =
      result && result.ok === false ? result.error : "ai_unavailable";
    await failParse(ticket, code);
    return "failed";
  }

  const outcome = await applyParseResult(ticket, result.data);

  return outcome.applied ? "applied" : "discarded";
}

let sweeping = false;

/**
 * Re-reads drafts still waiting for the AI: pending ones, and failed ones
 * that haven't used up their automatic attempts. Runs on load, reconnect
 * and focus. Never throws.
 */
export async function reparsePendingDrafts(
  options: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  if (sweeping || isOffline()) {
    return;
  }

  sweeping = true;

  try {
    const trip = await getActiveTrip();

    if (!trip) {
      return;
    }

    const drafts = await listExpenses(trip.id, "draft");
    const queue = drafts
      .filter(
        (expense) =>
          expense.parseStatus === "pending" ||
          (expense.parseStatus === "failed" &&
            expense.parseAttempts < MAX_AUTO_ATTEMPTS &&
            expense.parseError !== "ai_not_configured" &&
            expense.parseError !== "invalid_input"),
      )
      .reverse();

    for (const expense of queue) {
      if (isOffline()) {
        break;
      }

      await parseExpense(expense.id, { fetchImpl: options.fetchImpl });
    }
  } catch {
    // Opportunistic: a failed sweep must never break a screen.
  } finally {
    sweeping = false;
  }
}
