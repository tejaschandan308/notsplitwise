export type Category =
  | "food"
  | "transport"
  | "stay"
  | "tickets"
  | "personal"
  | "other";

export type SplitType = "equal" | "custom";
export type Confidence = "high" | "low";
export type ExpenseStatus = "draft" | "ready" | "archived";
export type ParseStatus = "pending" | "done" | "failed";

export const CURRENCY_CODES = ["INR", "USD", "EUR", "GBP", "AED"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/**
 * Where a value came from. Used to explain values honestly in the UI and to
 * decide whether an AI result may replace them.
 * - default: the app's fast default (payer = Me, currency = trip currency)
 * - capture: read from the capture text (by the app or the AI)
 * - manual: set by the person; AI results never overwrite it
 * - legacy: stored before this field existed; shows the old interpretation
 */
export type ValueSource = "default" | "capture" | "manual" | "legacy";

/** Fields the AI may fill. Anything listed in `editedFields` is left alone. */
export type ParsedField =
  | "amount"
  | "currency"
  | "category"
  | "note"
  | "location"
  | "included"
  | "unmatchedNames"
  | "paidBy"
  | "isPersonal";

export type EditableField = ParsedField | "splitType";

export interface Trip {
  id: string;
  name: string;
  members: string[];
  isActive: boolean;
  createdAt: number;
  /** Default currency for new captures. Trips created before v2 are INR. */
  currency: CurrencyCode;
}

export interface Expense {
  id: string;
  tripId: string;
  rawText: string;
  amount: number | null;
  /**
   * Text typed into the amount box that isn't a valid amount ("12o0",
   * "1,2"). Kept so the person can correct it later from any screen; while
   * set, the expense can't be Ready and `amount` is only the previous value.
   */
  amountInput: string | null;
  /** null = not resolved yet (for example a bare "$" outside a USD trip). */
  currency: CurrencyCode | null;
  currencySource: ValueSource;
  /** The currency token found in the capture, kept to explain ambiguity. */
  currencyMention: string | null;
  /**
   * The trip's default currency when this expense was captured. Every parse
   * and retry reads the capture in this context, so changing the trip default
   * later never relabels an existing expense.
   */
  captureCurrency: CurrencyCode;
  category: Category | null;
  note: string;
  location: string | null;
  /** People sharing the expense. Not the same thing as the payer. */
  included: string[];
  peopleLocked: boolean;
  lockedIncluded: string[];
  unmatchedNames: string[];
  /** Trip member who paid. null = needs a decision before Ready. */
  paidBy: string | null;
  paidBySource: ValueSource;
  /** Payer as written in the capture when it could not be matched safely. */
  payerMention: string | null;
  splitType: SplitType;
  isPersonal: boolean;
  /** Legacy model self-report. Kept for old records; never used to validate. */
  confidence: Confidence;
  status: ExpenseStatus;
  parseStatus: ParseStatus;
  /** Increments whenever rawText changes. Parse results carry the revision. */
  captureRevision: number;
  /** Token of the parse request allowed to write. null = none in flight. */
  parseRequestId: string | null;
  parseStartedAt: number | null;
  parseAttempts: number;
  /** Short, user-facing reason for the last failed parse. */
  parseError: string | null;
  /** Fields the person changed by hand. AI results skip these. */
  editedFields: EditableField[];
  createdAt: number;
  updatedAt: number;
}

export interface ParseStat {
  id: string;
  expenseId: string;
  fieldsChanged: string[];
  createdAt: number;
}

/** What the server returns after reading a capture. Already sanitised. */
export interface ParsedExpenseFields {
  amount: number | null;
  currency: CurrencyCode | null;
  currencyMention: string | null;
  category: Category | null;
  note: string;
  location: string | null;
  included: string[];
  unmatchedNames: string[];
  /** Matched trip member who explicitly paid, or null. */
  paidBy: string | null;
  /** Payer named in the capture but unknown or ambiguous. */
  payerMention: string | null;
  /**
   * The capture talks about paying but no single payer could be confirmed
   * from the text. The draft then waits for a person to choose, instead of
   * defaulting to "Me". Missing (older server) means false.
   */
  payerUnresolved: boolean;
  isPersonal: boolean;
}

export type ParseErrorCode =
  | "invalid_input"
  | "ai_not_configured"
  | "ai_unavailable"
  | "unreadable";

export type ParseResponse =
  | { ok: true; data: ParsedExpenseFields }
  | { ok: false; error: ParseErrorCode };
