import { isCurrencyCode } from "@/lib/currency";
import type {
  Category,
  CurrencyCode,
  EditableField,
  Expense,
  ExpenseStatus,
  ParseStatus,
  SplitType,
  Trip,
  ValueSource,
} from "@/lib/types";

type StoredRecord = Record<string, unknown>;

const valueSources: ValueSource[] = ["default", "capture", "manual", "legacy"];
const statuses: ExpenseStatus[] = ["draft", "ready", "archived"];
const parseStatuses: ParseStatus[] = ["pending", "done", "failed"];
const categories: Category[] = [
  "food",
  "transport",
  "stay",
  "tickets",
  "personal",
  "other",
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function oneOf<T extends string>(value: unknown, options: T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

export function normalizeTrip(input: object): Trip {
  const raw = input as StoredRecord;

  return {
    id: String(raw.id),
    name: typeof raw.name === "string" ? raw.name : "Trip",
    members: stringArray(raw.members),
    isActive: raw.isActive === true,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    currency: isCurrencyCode(raw.currency) ? raw.currency : "INR",
  };
}

/**
 * Records saved before v2 have no payer, currency or revision fields. The old
 * app always meant "I paid" and "rupees", so those are kept as-is and marked
 * `legacy` so the UI can say they were assumed, not recovered.
 *
 * Old drafts that were still pending/failed could only have non-default
 * values if the person typed them in Review, so those are marked as manual to
 * protect them from a later AI retry.
 *
 * People are protected too. The old Review screen let people change who
 * shares without setting `peopleLocked`, and the old schema can't tell a
 * deliberate "everyone" from the untouched default. Keeping the saved list
 * is safer than letting a late AI result silently change an existing split.
 * Unknown names still listed on the draft are kept for review the same way.
 */
function legacyEditedFields(raw: StoredRecord): EditableField[] {
  const parseStatus = raw.parseStatus;

  if (raw.status !== "draft" || parseStatus === "done") {
    return [];
  }

  const edited: EditableField[] = ["included"];

  if (raw.amount !== null && raw.amount !== undefined) edited.push("amount");
  if (raw.category !== null && raw.category !== undefined) {
    edited.push("category");
  }
  if (typeof raw.note === "string" && raw.note.trim()) edited.push("note");
  if (typeof raw.location === "string" && raw.location.trim()) {
    edited.push("location");
  }
  if (stringArray(raw.unmatchedNames).length > 0) edited.push("unmatchedNames");
  if (raw.isPersonal === true) edited.push("isPersonal");
  if (raw.splitType === "custom") edited.push("splitType");

  return edited;
}

/**
 * Drafts migrated from v1 by an earlier build of v2 didn't get the people
 * protection above. They are recognisable because nothing has replaced their
 * `legacy` payer or currency yet. Adds the missing protection; never removes
 * any. Used by the v3 upgrade.
 */
export function repairLegacyDraft(expense: Expense): Expense {
  const fromV1 =
    expense.paidBySource === "legacy" || expense.currencySource === "legacy";

  if (!fromV1) {
    return expense;
  }

  const legacy = legacyEditedFields(expense as unknown as StoredRecord);
  const edited = new Set<EditableField>([...expense.editedFields, ...legacy]);

  return edited.size === expense.editedFields.length
    ? expense
    : { ...expense, editedFields: [...edited] };
}

/**
 * The trip default an expense was captured under. Records from before this
 * field existed get it from their own stored values, never from the trip's
 * current setting:
 * - v1 records: INR, the only currency the old app knew.
 * - later records: the stored currency. For a "default" currency that is
 *   exactly the default at capture. For an explicit or manual currency the
 *   context doesn't change the result. A bare "$" left unresolved means the
 *   default wasn't USD, so INR reproduces the same reading.
 */
function captureCurrencyOf(raw: StoredRecord, legacy: boolean): CurrencyCode {
  if (isCurrencyCode(raw.captureCurrency)) {
    return raw.captureCurrency;
  }

  if (legacy || raw.currencySource === "legacy") {
    return "INR";
  }

  return isCurrencyCode(raw.currency) ? raw.currency : "INR";
}

export function isLegacyExpense(input: object): boolean {
  const raw = input as StoredRecord;

  return typeof raw.captureRevision !== "number";
}

export function normalizeExpense(input: object): Expense {
  const raw = input as StoredRecord;
  const legacy = isLegacyExpense(raw);
  const editedFields = legacy
    ? legacyEditedFields(raw)
    : (stringArray(raw.editedFields) as EditableField[]);

  return {
    id: String(raw.id),
    tripId: String(raw.tripId),
    rawText: typeof raw.rawText === "string" ? raw.rawText : "",
    amount: numberOrNull(raw.amount),
    amountInput:
      typeof raw.amountInput === "string" && raw.amountInput.trim()
        ? raw.amountInput
        : null,
    currency: legacy
      ? isCurrencyCode(raw.currency)
        ? raw.currency
        : "INR"
      : isCurrencyCode(raw.currency)
        ? raw.currency
        : null,
    currencySource: legacy
      ? "legacy"
      : oneOf(raw.currencySource, valueSources, "default"),
    currencyMention:
      typeof raw.currencyMention === "string" ? raw.currencyMention : null,
    captureCurrency: captureCurrencyOf(raw, legacy),
    category: categories.includes(raw.category as Category)
      ? (raw.category as Category)
      : null,
    note: typeof raw.note === "string" ? raw.note : "",
    location: typeof raw.location === "string" ? raw.location : null,
    included: stringArray(raw.included),
    peopleLocked: raw.peopleLocked === true,
    lockedIncluded: stringArray(raw.lockedIncluded),
    unmatchedNames: stringArray(raw.unmatchedNames),
    paidBy: legacy
      ? "Me"
      : typeof raw.paidBy === "string"
        ? raw.paidBy
        : null,
    paidBySource: legacy
      ? "legacy"
      : oneOf(raw.paidBySource, valueSources, "default"),
    payerMention:
      typeof raw.payerMention === "string" ? raw.payerMention : null,
    splitType: oneOf<SplitType>(raw.splitType, ["equal", "custom"], "equal"),
    isPersonal: raw.isPersonal === true,
    confidence: raw.confidence === "high" ? "high" : "low",
    status: oneOf(raw.status, statuses, "draft"),
    parseStatus: oneOf(raw.parseStatus, parseStatuses, "pending"),
    captureRevision: legacy ? 1 : (raw.captureRevision as number),
    parseRequestId:
      typeof raw.parseRequestId === "string" ? raw.parseRequestId : null,
    parseStartedAt: numberOrNull(raw.parseStartedAt),
    parseAttempts:
      typeof raw.parseAttempts === "number" ? raw.parseAttempts : 0,
    parseError: typeof raw.parseError === "string" ? raw.parseError : null,
    editedFields,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}
