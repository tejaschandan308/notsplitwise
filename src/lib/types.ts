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

export interface Trip {
  id: string;
  name: string;
  members: string[];
  isActive: boolean;
  createdAt: number;
}

export interface Expense {
  id: string;
  tripId: string;
  rawText: string;
  amount: number | null;
  category: Category | null;
  note: string;
  location: string | null;
  included: string[];
  splitType: SplitType;
  isPersonal: boolean;
  confidence: Confidence;
  status: ExpenseStatus;
  parseStatus: ParseStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ParseStat {
  id: string;
  expenseId: string;
  fieldsChanged: string[];
  createdAt: number;
}

export type ParsedExpenseFields = Pick<
  Expense,
  | "amount"
  | "category"
  | "note"
  | "location"
  | "included"
  | "splitType"
  | "isPersonal"
  | "confidence"
>;
