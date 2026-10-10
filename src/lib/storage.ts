import { detectCurrency } from "@/lib/currency";
import { getDb } from "@/lib/db";
import { normalizeExpense, normalizeTrip } from "@/lib/normalize";
import { initialPayer } from "@/lib/payer";
import { getReviewIssues, type ReviewIssue } from "@/lib/review";
import type {
  CurrencyCode,
  EditableField,
  Expense,
  ExpenseStatus,
  ParseStat,
  Trip,
} from "@/lib/types";

function createId(): string {
  return crypto.randomUUID();
}

export function toTitleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) =>
      word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : "",
    )
    .join(" ");
}

function cleanMembers(otherMembers: string[]): string[] {
  const seen = new Set(["me"]);
  const members = ["Me"];

  for (const member of otherMembers) {
    const name = toTitleCase(member);
    const key = name.toLowerCase();

    if (!name || key === "me" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    members.push(name);
  }

  return members;
}

export class ExpenseNotFoundError extends Error {
  constructor(id: string) {
    super(`Expense not found: ${id}`);
    this.name = "ExpenseNotFoundError";
  }
}

export class NotReadyError extends Error {
  issues: ReviewIssue[];

  constructor(issues: ReviewIssue[]) {
    super(issues.map((issue) => issue.label).join(", "));
    this.name = "NotReadyError";
    this.issues = issues;
  }
}

/* Trips ------------------------------------------------------------------ */

export async function createTrip(
  name: string,
  otherMembers: string[],
  currency: CurrencyCode = "INR",
): Promise<Trip> {
  const db = getDb();
  const trip: Trip = {
    id: createId(),
    name: name.trim(),
    members: cleanMembers(otherMembers),
    isActive: true,
    createdAt: Date.now(),
    currency,
  };

  await db.transaction("rw", db.trips, async () => {
    await db.trips.toCollection().modify({ isActive: false });
    await db.trips.add(trip);
  });

  return trip;
}

export async function getActiveTrip(): Promise<Trip | undefined> {
  const trip = await getDb()
    .trips.filter((item) => item.isActive)
    .first();

  return trip ? normalizeTrip(trip) : undefined;
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  const trip = await getDb().trips.get(id);

  return trip ? normalizeTrip(trip) : undefined;
}

export async function listTrips(): Promise<Trip[]> {
  const trips = await getDb().trips.orderBy("createdAt").reverse().toArray();

  return trips.map(normalizeTrip);
}

export async function setActiveTrip(tripId: string): Promise<void> {
  const db = getDb();

  await db.transaction("rw", db.trips, async () => {
    const trip = await db.trips.get(tripId);

    if (!trip) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    await db.trips.toCollection().modify({ isActive: false });
    await db.trips.update(tripId, { isActive: true });
  });
}

/**
 * Changes the default for future captures only. Existing expenses keep the
 * default they were captured under (`Expense.captureCurrency`).
 */
export async function setTripCurrency(
  tripId: string,
  currency: CurrencyCode,
): Promise<void> {
  await getDb().trips.update(tripId, { currency });
}

export async function addTripMember(
  tripId: string,
  name: string,
): Promise<Trip> {
  const db = getDb();
  const memberName = toTitleCase(name);

  return db.transaction("rw", db.trips, async () => {
    const stored = await db.trips.get(tripId);

    if (!stored) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    const trip = normalizeTrip(stored);
    const alreadyExists =
      !memberName ||
      trip.members.some(
        (member) => member.toLowerCase() === memberName.toLowerCase(),
      );

    if (alreadyExists) {
      return trip;
    }

    const updatedTrip: Trip = {
      ...trip,
      members: [...trip.members, memberName],
    };

    await db.trips.put(updatedTrip);

    return updatedTrip;
  });
}

/* Expenses --------------------------------------------------------------- */

export type DraftOptions = {
  /** People chosen on the capture screen. Locks them against AI guesses. */
  lockedIncluded?: string[];
  /** Payer chosen on the capture screen. Locks it against AI guesses. */
  paidBy?: string;
};

/**
 * Saves the capture locally in one write, before any network call. The
 * currency is read deterministically from the text so an explicit "USD"
 * is kept even if the AI never runs, and the trip default in force now is
 * stored with the expense for every later reading of it.
 */
export async function addDraftExpense(
  tripId: string,
  rawText: string,
  options: DraftOptions = {},
): Promise<Expense> {
  const db = getDb();
  const stored = await db.trips.get(tripId);

  if (!stored) {
    throw new Error(`Trip not found: ${tripId}`);
  }

  const trip = normalizeTrip(stored);
  const now = Date.now();
  const currency = detectCurrency(rawText, trip.currency);
  const locked = options.lockedIncluded
    ? trip.members.filter((member) => options.lockedIncluded?.includes(member))
    : null;
  const peopleLocked = locked !== null && locked.length > 0;
  const payerChosen =
    options.paidBy !== undefined && trip.members.includes(options.paidBy);
  const editedFields: EditableField[] = [];

  if (peopleLocked) editedFields.push("included");
  if (payerChosen) editedFields.push("paidBy");

  const expense: Expense = {
    id: createId(),
    tripId,
    rawText,
    amount: null,
    amountInput: null,
    currency: currency.currency,
    currencySource: currency.source,
    currencyMention: currency.mention,
    captureCurrency: trip.currency,
    category: null,
    note: "",
    location: null,
    included: peopleLocked && locked ? locked : [...trip.members],
    peopleLocked,
    lockedIncluded: peopleLocked && locked ? locked : [],
    unmatchedNames: [],
    ...(payerChosen
      ? {
          paidBy: options.paidBy as string,
          paidBySource: "manual" as const,
          payerMention: null,
        }
      : initialPayer(rawText, trip.members)),
    splitType: "equal",
    isPersonal: false,
    confidence: "low",
    status: "draft",
    parseStatus: "pending",
    captureRevision: 1,
    parseRequestId: null,
    parseStartedAt: null,
    parseAttempts: 0,
    parseError: null,
    editedFields,
    createdAt: now,
    updatedAt: now,
  };

  await db.expenses.add(expense);

  return expense;
}

export async function getExpense(id: string): Promise<Expense | undefined> {
  const expense = await getDb().expenses.get(id);

  return expense ? normalizeExpense(expense) : undefined;
}

export type ManualChanges = Partial<
  Pick<
    Expense,
    | "amount"
    | "amountInput"
    | "currency"
    | "category"
    | "note"
    | "location"
    | "included"
    | "unmatchedNames"
    | "paidBy"
    | "isPersonal"
    | "splitType"
  >
>;

/**
 * Saves edits made by the person. Each changed field is recorded as manual so
 * a parse result that arrives later can't overwrite it.
 *
 * A Ready expense must stay valid: if an edit leaves it with something to fix
 * (for example the amount was cleared), it moves back to Drafts in the same
 * write, so it can't be selected or exported until it is marked ready again.
 */
export async function saveManualEdit(
  id: string,
  changes: ManualChanges,
): Promise<Expense> {
  const db = getDb();

  return db.transaction("rw", db.expenses, db.trips, async () => {
    const stored = await db.expenses.get(id);

    if (!stored) {
      throw new ExpenseNotFoundError(id);
    }

    const expense = normalizeExpense(stored);
    const edited = new Set<EditableField>(expense.editedFields);
    const next: Expense = { ...expense, ...changes, updatedAt: Date.now() };

    for (const key of Object.keys(changes) as Array<keyof ManualChanges>) {
      // Unfinished amount text still means the person is setting the amount.
      edited.add(key === "amountInput" ? "amount" : key);
    }

    if ("included" in changes) {
      next.peopleLocked = true;
      next.lockedIncluded = [...(changes.included ?? [])];
    }

    if ("currency" in changes) {
      next.currencySource = "manual";
    }

    if ("paidBy" in changes) {
      next.paidBySource = "manual";
      next.payerMention = changes.paidBy ? null : expense.payerMention;
    }

    next.editedFields = [...edited];

    if (next.status === "ready") {
      const storedTrip = await db.trips.get(next.tripId);
      const members = storedTrip ? normalizeTrip(storedTrip).members : [];

      if (getReviewIssues(next, members).length > 0) {
        next.status = "draft";
      }
    }

    await db.expenses.put(next);

    return next;
  });
}

/**
 * Corrects the raw capture. Bumps the revision so any in-flight parse of the
 * old text is discarded, and queues a fresh parse. Manual edits are kept.
 * The corrected text is read with the currency default the expense was
 * captured under, not the trip's current default.
 */
export async function updateRawText(
  id: string,
  rawText: string,
): Promise<Expense> {
  const db = getDb();

  return db.transaction("rw", db.expenses, db.trips, async () => {
    const stored = await db.expenses.get(id);

    if (!stored) {
      throw new ExpenseNotFoundError(id);
    }

    const expense = normalizeExpense(stored);
    const storedTrip = await db.trips.get(expense.tripId);
    const members = storedTrip ? normalizeTrip(storedTrip).members : [];
    const next: Expense = {
      ...expense,
      rawText,
      captureRevision: expense.captureRevision + 1,
      parseStatus: "pending",
      parseRequestId: null,
      parseStartedAt: null,
      parseAttempts: 0,
      parseError: null,
      updatedAt: Date.now(),
    };

    if (!expense.editedFields.includes("currency")) {
      const currency = detectCurrency(rawText, expense.captureCurrency);
      next.currency = currency.currency;
      next.currencySource = currency.source;
      next.currencyMention = currency.mention;
    }

    // A payer read from the old text no longer applies.
    if (!expense.editedFields.includes("paidBy")) {
      Object.assign(next, initialPayer(rawText, members));
    }

    await db.expenses.put(next);

    return next;
  });
}

/** Validates against the stored record, then marks Ready in one transaction. */
export async function markExpenseReady(id: string): Promise<Expense> {
  const db = getDb();

  return db.transaction("rw", db.expenses, db.trips, async () => {
    const stored = await db.expenses.get(id);

    if (!stored) {
      throw new ExpenseNotFoundError(id);
    }

    const expense = normalizeExpense(stored);
    const storedTrip = await db.trips.get(expense.tripId);
    const members = storedTrip ? normalizeTrip(storedTrip).members : [];
    const issues = getReviewIssues(expense, members);

    if (issues.length > 0) {
      throw new NotReadyError(issues);
    }

    const next: Expense = {
      ...expense,
      status: "ready",
      parseRequestId: null,
      parseStartedAt: null,
      updatedAt: Date.now(),
    };

    await db.expenses.put(next);

    return next;
  });
}

export async function moveExpenseToDrafts(id: string): Promise<void> {
  await setExpenseStatus(id, "draft");
}

export async function setExpenseStatus(
  id: string,
  status: ExpenseStatus,
): Promise<void> {
  const updated = await getDb().expenses.update(id, {
    status,
    updatedAt: Date.now(),
  });

  if (updated === 0) {
    throw new ExpenseNotFoundError(id);
  }
}

/**
 * Re-reads the given expenses and returns, in the same order, only those that
 * are still Ready and pass validation now. Export uses this at copy time so
 * a record changed elsewhere (another tab, a later edit) is never exported
 * from a stale selection.
 */
export async function getExportableExpenses(ids: string[]): Promise<Expense[]> {
  const db = getDb();

  return db.transaction("r", db.expenses, db.trips, async () => {
    const records = await db.expenses.bulkGet(ids);
    const expenses = records
      .filter((record): record is Expense => Boolean(record))
      .map(normalizeExpense)
      .filter((expense) => expense.status === "ready");
    const tripIds = [...new Set(expenses.map((expense) => expense.tripId))];
    const trips = await db.trips.bulkGet(tripIds);
    const membersByTrip = new Map(
      trips
        .filter((trip): trip is Trip => Boolean(trip))
        .map((trip) => [trip.id, normalizeTrip(trip).members]),
    );

    return expenses.filter(
      (expense) =>
        getReviewIssues(expense, membersByTrip.get(expense.tripId) ?? [])
          .length === 0,
    );
  });
}

/** Archives exactly the given Ready expenses, all or nothing. */
export async function archiveExpenses(ids: string[]): Promise<number> {
  const db = getDb();

  return db.transaction("rw", db.expenses, async () => {
    const records = await db.expenses.bulkGet(ids);
    const now = Date.now();
    const toArchive = records
      .filter((record): record is Expense => Boolean(record))
      .map(normalizeExpense)
      .filter((expense) => expense.status === "ready")
      .map((expense) => ({
        ...expense,
        status: "archived" as const,
        updatedAt: now,
      }));

    await db.expenses.bulkPut(toArchive);

    return toArchive.length;
  });
}

export async function listExpenses(
  tripId: string,
  status?: ExpenseStatus,
): Promise<Expense[]> {
  const expenses = await getDb()
    .expenses.where("tripId")
    .equals(tripId)
    .filter((expense) => !status || expense.status === status)
    .toArray();

  return expenses
    .map(normalizeExpense)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteExpense(id: string): Promise<void> {
  await getDb().expenses.delete(id);
}

export async function addParseStat(
  expenseId: string,
  fieldsChanged: string[],
): Promise<void> {
  const parseStat: ParseStat = {
    id: createId(),
    expenseId,
    fieldsChanged: [...fieldsChanged],
    createdAt: Date.now(),
  };

  await getDb().parseStats.add(parseStat);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }

  return navigator.storage.persist();
}
