import { describe, expect, it } from "vitest";
import { buildExportText, totalsByCurrency } from "@/lib/export";
import { normalizeExpense } from "@/lib/normalize";
import { getReviewIssues } from "@/lib/review";
import { getDb } from "@/lib/db";
import {
  addDraftExpense,
  createTrip,
  getExportableExpenses,
  getExpense,
  markExpenseReady,
  NotReadyError,
  saveManualEdit,
} from "@/lib/storage";
import type { Expense } from "@/lib/types";

const members = ["Me", "Asha", "Ben"];
const noon = new Date(2026, 9, 9, 12).getTime();

function expense(overrides: Partial<Expense> = {}): Expense {
  return normalizeExpense({
    id: "x",
    tripId: "t",
    rawText: "raw",
    amount: 100,
    currency: "INR",
    currencySource: "default",
    category: null,
    note: "Lunch",
    included: members,
    paidBy: "Me",
    paidBySource: "default",
    status: "ready",
    parseStatus: "done",
    captureRevision: 1,
    createdAt: noon,
    ...overrides,
  });
}

describe("review issues gate Ready", () => {
  it.each([
    ["missing", null],
    ["negative", -5],
    ["zero", 0],
    ["non-finite", Number.POSITIVE_INFINITY],
  ])("flags a %s amount", (_label, amount) => {
    const issues = getReviewIssues(expense({ amount }), members);
    expect(issues.map((issue) => issue.field)).toContain("amount");
  });

  it("names the ambiguous currency token", () => {
    const [issue] = getReviewIssues(
      expense({ currency: null, currencyMention: "$" }),
      members,
    );
    expect(issue.field).toBe("currency");
    expect(issue.message).toContain("“$”");
  });

  it("asks who paid when the payer is unresolved", () => {
    const [issue] = getReviewIssues(
      expense({ paidBy: null, payerMention: "Dmitri" }),
      members,
    );
    expect(issue.field).toBe("paidBy");
    expect(issue.message).toContain("Dmitri");
  });

  it("lists each unresolved name", () => {
    const issues = getReviewIssues(
      expense({ unmatchedNames: ["Dmitri", "Kai"] }),
      members,
    );
    expect(issues.filter((issue) => issue.field === "unmatchedNames")).toHaveLength(2);
  });

  it("rejects people who aren't trip members", () => {
    const issues = getReviewIssues(expense({ included: ["Me", "Zed"] }), members);
    expect(issues.map((issue) => issue.field)).toContain("included");
  });

  it("refuses to mark Ready in storage while issues remain", async () => {
    const trip = await createTrip("Trip", ["Asha"]);
    const draft = await addDraftExpense(trip.id, "$40 taxi");
    await saveManualEdit(draft.id, { amount: 40 });

    const error = await markExpenseReady(draft.id).catch((err) => err);
    expect(error).toBeInstanceOf(NotReadyError);
    expect((error as NotReadyError).issues.map((issue) => issue.field)).toEqual([
      "currency",
    ]);

    await saveManualEdit(draft.id, { currency: "USD" });
    expect((await markExpenseReady(draft.id)).currency).toBe("USD");
  });
});

describe("export", () => {
  it("includes payer, amount with currency, description, people and split", () => {
    const text = buildExportText("Lisbon", [
      expense({
        amount: 38,
        currency: "USD",
        note: "Uber to hotel",
        category: "transport",
        paidBy: "Asha",
        included: ["Me", "Asha"],
      }),
    ]);
    expect(text).toContain("1. Uber to hotel (Transport), 9 Oct");
    expect(text).toContain("USD 38, paid by Asha");
    expect(text).toContain("Split equally between 2 people: Me, Asha");
    expect(text).toContain("Nothing here is sent to Splitwise");
    expect(text).not.toContain("₹");
  });

  it("describes custom splits honestly", () => {
    const text = buildExportText("Trip", [expense({ splitType: "custom" })]);
    expect(text).toContain("Custom split, shares not calculated here");
    expect(text).toContain("enter them in Splitwise");
  });

  it("is transparent about the payer of records saved before payer tracking", () => {
    const legacy = normalizeExpense({
      id: "old",
      tripId: "t",
      rawText: "500 lunch",
      amount: 500,
      note: "Lunch",
      included: members,
      status: "ready",
      parseStatus: "done",
      createdAt: noon,
    });
    const text = buildExportText("Trip", [legacy]);
    expect(text).toContain("INR 500, paid by Me (assumed; saved before payer tracking)");
  });

  it("never prints a missing amount as zero", () => {
    const text = buildExportText("Trip", [expense({ amount: null })]);
    expect(text).toContain("INR amount missing");
    expect(text).not.toMatch(/INR 0\b/);
  });

  it("totals per currency without mixing or converting", () => {
    const totals = totalsByCurrency([
      expense({ amount: 1000, currency: "INR" }),
      expense({ amount: 240, currency: "INR" }),
      expense({ amount: 22.5, currency: "EUR" }),
      expense({ amount: 99, currency: "INR", isPersonal: true, included: ["Me"] }),
    ]);
    expect(totals).toEqual([
      { currency: "INR", total: 1240 },
      { currency: "EUR", total: 22.5 },
    ]);
  });

  it("explains personal expenses paid by someone else", () => {
    const text = buildExportText("Trip", [
      expense({ isPersonal: true, included: ["Me"], paidBy: "Ben" }),
    ]);
    expect(text).toContain("I owe Ben the full amount");
  });
});

describe("a Ready expense can't become invalid and stay exportable", () => {
  async function readyExpense() {
    const trip = await createTrip("Trip", ["Asha"]);
    const draft = await addDraftExpense(trip.id, "1200 dinner");
    await saveManualEdit(draft.id, { amount: 1200 });
    await markExpenseReady(draft.id);
    return draft.id;
  }

  it("moves a Ready expense back to Drafts when its amount is cleared", async () => {
    const id = await readyExpense();

    const saved = await saveManualEdit(id, { amount: null });

    expect(saved.status).toBe("draft");
    expect(saved.amount).toBeNull();
    const stored = await getExpense(id);
    expect(stored?.status).toBe("draft");
    expect(await getExportableExpenses([id])).toEqual([]);

    // Fixing it doesn't silently re-ready it: it has to be marked again.
    await saveManualEdit(id, { amount: 1300 });
    expect((await getExpense(id))?.status).toBe("draft");
    expect((await markExpenseReady(id)).amount).toBe(1300);
  });

  it("keeps a Ready expense Ready for an edit that stays valid", async () => {
    const id = await readyExpense();
    const saved = await saveManualEdit(id, { amount: 1250, note: "Dinner" });
    expect(saved.status).toBe("ready");
    expect((await getExportableExpenses([id])).map((item) => item.amount)).toEqual([1250]);
  });

  it("re-validates at export time, whatever the stored status says", async () => {
    const id = await readyExpense();
    const second = await readyExpense();
    // A record that is Ready on disk but invalid (written by an older build
    // or another tab mid-change) is still refused.
    await getDb().expenses.update(id, { amount: null });

    const exportable = await getExportableExpenses([id, second, "deleted-id"]);
    expect(exportable.map((item) => item.id)).toEqual([second]);
  });
});
