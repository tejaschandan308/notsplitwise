import { getDb } from "@/lib/db";
import { normalizeExpense, normalizeTrip } from "@/lib/normalize";
import { mentionsPayment } from "@/lib/payer";
import type {
  CurrencyCode,
  EditableField,
  Expense,
  ParsedExpenseFields,
} from "@/lib/types";

/**
 * The one rule for AI parse results, shared by the first parse after capture
 * and every retry:
 *
 * 1. `claimParse` atomically stamps the draft with a fresh request token for
 *    its current capture revision. A second claim while a recent request is
 *    in flight is refused, so one revision is not parsed twice in parallel.
 * 2. `applyParseResult` re-reads the record inside a write transaction and
 *    only writes if the record still exists, is still a draft, has the same
 *    capture revision and still carries this request's token. Fields the
 *    person edited by hand are never overwritten.
 * 3. `failParse` / `releaseParse` follow the same checks, so a stale failure
 *    can't flip a newer result to "failed".
 */

/** After this long a claimed request is considered abandoned. */
export const PARSE_STALE_MS = 45_000;

export type ParseTicket = {
  expenseId: string;
  requestId: string;
  revision: number;
  rawText: string;
  members: string[];
  /**
   * The default currency this capture is read in: the trip default when the
   * expense was captured, not whatever the trip default is now.
   */
  defaultCurrency: CurrencyCode;
};

export type ApplyOutcome =
  | { applied: true; expense: Expense }
  | {
      applied: false;
      reason: "deleted" | "not-draft" | "revision-changed" | "superseded";
    };

function createRequestId(): string {
  return crypto.randomUUID();
}

export async function claimParse(
  expenseId: string,
  options: { force?: boolean; now?: number } = {},
): Promise<ParseTicket | null> {
  const db = getDb();
  const now = options.now ?? Date.now();

  return db.transaction("rw", db.expenses, db.trips, async () => {
    const stored = await db.expenses.get(expenseId);

    if (!stored) {
      return null;
    }

    const expense = normalizeExpense(stored);

    if (expense.status !== "draft") {
      return null;
    }

    if (!options.force && expense.parseStatus === "done") {
      return null;
    }

    const inFlight =
      expense.parseRequestId !== null &&
      expense.parseStartedAt !== null &&
      now - expense.parseStartedAt < PARSE_STALE_MS;

    if (inFlight && !options.force) {
      return null;
    }

    const storedTrip = await db.trips.get(expense.tripId);

    if (!storedTrip) {
      return null;
    }

    const trip = normalizeTrip(storedTrip);
    const requestId = createRequestId();

    await db.expenses.put({
      ...expense,
      parseStatus: "pending",
      parseRequestId: requestId,
      parseStartedAt: now,
      parseAttempts: expense.parseAttempts + 1,
      parseError: null,
    });

    return {
      expenseId,
      requestId,
      revision: expense.captureRevision,
      rawText: expense.rawText,
      members: [...trip.members],
      defaultCurrency: expense.captureCurrency,
    };
  });
}

type CheckResult =
  | { ok: true; expense: Expense }
  | { ok: false; reason: Extract<ApplyOutcome, { applied: false }>["reason"] };

async function loadForTicket(ticket: ParseTicket): Promise<CheckResult> {
  const stored = await getDb().expenses.get(ticket.expenseId);

  if (!stored) {
    return { ok: false, reason: "deleted" };
  }

  const expense = normalizeExpense(stored);

  if (expense.status !== "draft") {
    return { ok: false, reason: "not-draft" };
  }

  if (expense.captureRevision !== ticket.revision) {
    return { ok: false, reason: "revision-changed" };
  }

  if (expense.parseRequestId !== ticket.requestId) {
    return { ok: false, reason: "superseded" };
  }

  return { ok: true, expense };
}

/** Pure merge of a parse result into a draft, respecting manual edits. */
export function mergeParsedFields(
  expense: Expense,
  data: ParsedExpenseFields,
  members: string[],
): Expense {
  const edited = new Set<EditableField>(expense.editedFields);
  const next: Expense = { ...expense };
  const peopleFixed = expense.peopleLocked || edited.has("included");

  if (!edited.has("amount")) next.amount = data.amount;
  if (!edited.has("category")) next.category = data.category;
  if (!edited.has("note") && data.note.trim()) next.note = data.note;
  if (!edited.has("location")) next.location = data.location;

  if (!edited.has("currency")) {
    next.currency = data.currency;
    next.currencyMention = data.currencyMention;
    next.currencySource = data.currencyMention ? "capture" : "default";
  }

  // The person chose people explicitly: the AI may not change them, and a
  // personal flag from the AI would contradict that choice. Names already
  // waiting for a decision stay listed if the person saved that list.
  if (peopleFixed) {
    if (!edited.has("unmatchedNames")) next.unmatchedNames = [];
  } else {
    const personal = edited.has("isPersonal")
      ? expense.isPersonal
      : data.isPersonal;

    next.isPersonal = personal;
    next.included =
      personal && members.includes("Me") ? ["Me"] : [...data.included];
    next.unmatchedNames = personal ? [] : [...data.unmatchedNames];
  }

  if (!edited.has("paidBy")) {
    if (data.paidBy) {
      next.paidBy = data.paidBy;
      next.payerMention = null;
      next.paidBySource = "capture";
    } else if (
      data.payerMention ||
      data.payerUnresolved === true ||
      mentionsPayment(expense.rawText)
    ) {
      // The capture talks about who paid but it couldn't be confirmed:
      // leave it for the person instead of assuming "Me". The text check
      // also covers a reply from a server without `payerUnresolved`.
      next.paidBy = null;
      next.payerMention = data.payerMention;
      next.paidBySource = "capture";
    } else {
      next.paidBy = members.includes("Me") ? "Me" : null;
      next.payerMention = null;
      next.paidBySource = "default";
    }
  }

  return next;
}

export async function applyParseResult(
  ticket: ParseTicket,
  data: ParsedExpenseFields,
): Promise<ApplyOutcome> {
  const db = getDb();

  return db.transaction("rw", db.expenses, async () => {
    const check = await loadForTicket(ticket);

    if (!check.ok) {
      return { applied: false, reason: check.reason };
    }

    const merged: Expense = {
      ...mergeParsedFields(check.expense, data, ticket.members),
      parseStatus: "done",
      parseRequestId: null,
      parseStartedAt: null,
      parseError: null,
      updatedAt: Date.now(),
    };

    await db.expenses.put(merged);

    return { applied: true, expense: merged };
  });
}

/** Marks the draft failed, unless a newer request or edit owns it now. */
export async function failParse(
  ticket: ParseTicket,
  errorCode: string,
): Promise<boolean> {
  const db = getDb();

  return db.transaction("rw", db.expenses, async () => {
    const check = await loadForTicket(ticket);

    if (!check.ok) {
      return false;
    }

    await db.expenses.put({
      ...check.expense,
      parseStatus: "failed",
      parseRequestId: null,
      parseStartedAt: null,
      parseError: errorCode,
      updatedAt: Date.now(),
    });

    return true;
  });
}

/**
 * The request never reached the server (offline). Put the draft back in the
 * queue without counting an attempt, so it is read on reconnect.
 */
export async function releaseParse(ticket: ParseTicket): Promise<boolean> {
  const db = getDb();

  return db.transaction("rw", db.expenses, async () => {
    const check = await loadForTicket(ticket);

    if (!check.ok) {
      return false;
    }

    await db.expenses.put({
      ...check.expense,
      parseStatus: "pending",
      parseRequestId: null,
      parseStartedAt: null,
      parseAttempts: Math.max(0, check.expense.parseAttempts - 1),
      updatedAt: Date.now(),
    });

    return true;
  });
}
