import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoney, isValidAmount, parseAmountInput } from "@/lib/currency";
import { buildExportText } from "@/lib/export";
import { applyParseResult, claimParse } from "@/lib/parse-lifecycle";
import { getReviewIssues } from "@/lib/review";
import {
  addDraftExpense,
  createTrip,
  getExpense,
  getExportableExpenses,
  markExpenseReady,
  NotReadyError,
  saveManualEdit,
} from "@/lib/storage";
import {
  discardUnsavedEdit,
  forgetUnsavedEdit,
  hasUnsavedDifferences,
  readUnsavedEdits,
  rememberUnsavedEdit,
  supersededFields,
  unsavedDifferences,
} from "@/lib/unsaved-edits";
import { parsed } from "./helpers";

describe("amount input never guesses a separator", () => {
  it.each([
    ["1240", 1240],
    ["  1240 ", 1240],
    ["12.5", 12.5],
    ["12.50", 12.5],
    ["12.", 12],
    [".5", 0.5],
    // Decimal comma: exactly two digits after a single comma.
    ["12,50", 12.5],
    ["0,99", 0.99],
    ["12,34", 12.34],
    // Thousands groups.
    ["1,240", 1240],
    ["12,345.50", 12345.5],
    ["1,234,567", 1234567],
    // Indian lakh groups.
    ["1,00,000", 100000],
    ["12,34,567.25", 1234567.25],
  ])("accepts %s as %s", (text, value) => {
    expect(parseAmountInput(text)).toBe(value);
  });

  it.each([
    // Ambiguous or malformed separators.
    "1,2",
    "12,5",
    "12,500.5.5",
    "1.200",
    "1.200,50",
    "1 200",
    "1,,200",
    ",50",
    "1,2345",
    "12.345",
    // Not an amount.
    "",
    "oops",
    "12o0",
    "0",
    "0.00",
    "0,00",
    "-5",
    "1e3",
    "100000001",
  ])("rejects %j", (text) => {
    expect(parseAmountInput(text)).toBeNull();
  });

  it("does not turn 12,50 into 1250", () => {
    expect(parseAmountInput("12,50")).not.toBe(1250);
    expect(formatMoney(parseAmountInput("12,50"), "EUR")).toBe("EUR 12.50");
  });

  it("validates precision the same way storage, display and export use it", () => {
    expect(isValidAmount(12.5)).toBe(true);
    expect(isValidAmount(0.1 + 0.2)).toBe(true); // float for 0.30
    expect(isValidAmount(12.001)).toBe(false);
    expect(isValidAmount(12.345)).toBe(false);
    expect(isValidAmount(100_000_001)).toBe(false);
    expect(isValidAmount(0)).toBe(false);
  });
});

describe("amount text that isn't valid is kept and blocks Ready", () => {
  async function readyExpense(amount = 1200) {
    const trip = await createTrip("Trip", ["Asha"]);
    const draft = await addDraftExpense(trip.id, `${amount} dinner`);
    await saveManualEdit(draft.id, { amount });
    await markExpenseReady(draft.id);
    return { trip, id: draft.id };
  }

  it("moves a Ready expense to Drafts and keeps the typed text", async () => {
    const { trip, id } = await readyExpense();

    const saved = await saveManualEdit(id, { amountInput: "12o0" });

    expect(saved).toMatchObject({ status: "draft", amount: 1200, amountInput: "12o0" });
    const issues = getReviewIssues(saved, trip.members);
    expect(issues.map((issue) => issue.label)).toContain("Amount not valid");
    expect(issues[0].message).toContain("“12o0”");
    expect(await getExportableExpenses([id])).toEqual([]);
    await expect(markExpenseReady(id)).rejects.toBeInstanceOf(NotReadyError);
  });

  it("needs an explicit Mark ready after a correction", async () => {
    const { id } = await readyExpense();
    await saveManualEdit(id, { amountInput: "12o0" });

    const fixed = await saveManualEdit(id, { amount: 1250, amountInput: null });
    expect(fixed).toMatchObject({ status: "draft", amount: 1250, amountInput: null });

    expect((await markExpenseReady(id)).amount).toBe(1250);
    expect((await getExportableExpenses([id])).map((item) => item.amount)).toEqual([1250]);
  });

  it("can be discarded, keeping the previous amount but not re-readying it", async () => {
    const { id } = await readyExpense();
    await saveManualEdit(id, { amountInput: "1,2" });

    const discarded = await saveManualEdit(id, { amountInput: null });
    expect(discarded).toMatchObject({ status: "draft", amount: 1200, amountInput: null });
  });

  it("protects the typed text from a late AI result", async () => {
    const trip = await createTrip("Trip", ["Asha"]);
    const draft = await addDraftExpense(trip.id, "1200 dinner");
    await saveManualEdit(draft.id, { amountInput: "12o0" });

    const ticket = await claimParse(draft.id);
    await applyParseResult(ticket!, parsed({ amount: 999 }));

    expect(await getExpense(draft.id)).toMatchObject({ amount: null, amountInput: "12o0" });
  });

  it("a decimal-comma edit is stored and exported at its real value", async () => {
    const trip = await createTrip("Trip", ["Asha"], "EUR");
    const draft = await addDraftExpense(trip.id, "12.50 coffee");
    await saveManualEdit(draft.id, { amount: parseAmountInput("12,50"), note: "Coffee" });
    const ready = await markExpenseReady(draft.id);

    expect(ready.amount).toBe(12.5);
    expect(buildExportText("Trip", [ready])).toContain("EUR 12.50");
  });
});

describe("write-ahead copy of unsaved edits", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    });
  });

  it("forgets a change only once that exact value is saved", () => {
    rememberUnsavedEdit("a", { amount: 1 });
    rememberUnsavedEdit("a", { amount: 12, note: "Dinner" });

    // An older save finishing must not drop the newer value still in flight.
    forgetUnsavedEdit("a", { amount: 1 });
    expect(readUnsavedEdits().a).toEqual({ amount: 12, note: "Dinner" });

    forgetUnsavedEdit("a", { amount: 12 });
    expect(readUnsavedEdits().a).toEqual({ note: "Dinner" });

    discardUnsavedEdit("a");
    expect(readUnsavedEdits().a).toBeUndefined();
  });

  it("treats the amount and its unfinished text as one field", () => {
    rememberUnsavedEdit("c", { amount: 1300, amountInput: null, note: "Team dinner" });

    // Newer unfinished text replaces the older amount, not just its own key.
    rememberUnsavedEdit("c", { amountInput: "14o0" });
    expect(readUnsavedEdits().c).toEqual({ note: "Team dinner", amountInput: "14o0" });

    // And a newer amount replaces older unfinished text.
    rememberUnsavedEdit("c", { amount: 1400 });
    expect(readUnsavedEdits().c).toEqual({ note: "Team dinner", amount: 1400 });
    expect(supersededFields({ note: "x" })).toEqual(["note"]);
  });

  it("only reports changes the stored expense doesn't already have", async () => {
    const trip = await createTrip("Trip", ["Asha"]);
    const draft = await addDraftExpense(trip.id, "1200 dinner");
    const stored = await saveManualEdit(draft.id, { amount: 1200 });

    expect(hasUnsavedDifferences(stored, { amount: 1200 })).toBe(false);
    expect(unsavedDifferences(stored, { amount: 1300, amountInput: null })).toEqual({ amount: 1300 });
    expect(hasUnsavedDifferences(stored, undefined)).toBe(false);
  });

  it("survives a broken localStorage without throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => rememberUnsavedEdit("b", { amount: 5 })).not.toThrow();
    expect(readUnsavedEdits()).toEqual({});
  });
});
