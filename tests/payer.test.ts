import { describe, expect, it } from "vitest";
import { applyParseResult, claimParse } from "@/lib/parse-lifecycle";
import { handleParseRequest } from "@/lib/parse-server";
import { mentionedInText, readPayerEvidence } from "@/lib/payer";
import { getReviewIssues } from "@/lib/review";
import {
  addDraftExpense,
  createTrip,
  getExpense,
  saveManualEdit,
  updateRawText,
} from "@/lib/storage";
import type { ParsedExpenseFields } from "@/lib/types";

const members = ["Me", "Asha", "Ben"];

/** Runs the real handler against a mocked model reply. */
async function parseWith(
  rawText: string,
  modelReply: Record<string, unknown>,
  tripMembers: string[] = members,
): Promise<ParsedExpenseFields> {
  const reply = JSON.stringify({
    amount: 1200,
    currencyMention: null,
    category: "food",
    note: "Dinner",
    location: null,
    included: tripMembers,
    unmatchedNames: [],
    paidBy: null,
    paidByAmbiguous: false,
    isPersonal: false,
    ...modelReply,
  });
  const result = await handleParseRequest(
    { rawText, members: tripMembers, tripCurrency: "INR" },
    async () => reply,
  );

  if (!result.body.ok) {
    throw new Error(`expected ok, got ${result.body.error}`);
  }

  return result.body.data;
}

/** Capture -> mocked model reply -> stored draft, through the real rules. */
async function captureAndParse(
  rawText: string,
  modelReply: Record<string, unknown>,
) {
  const trip = await createTrip("Test trip", ["Asha", "Ben"]);
  const draft = await addDraftExpense(trip.id, rawText);
  const data = await parseWith(rawText, modelReply, trip.members);
  const ticket = await claimParse(draft.id);
  await applyParseResult(ticket!, data);
  const saved = await getExpense(draft.id);

  return { saved: saved!, issues: getReviewIssues(saved!, trip.members) };
}

describe("payer is accepted only with an explicit payment relationship", () => {
  it("A: a name in the participant list is not a payer", async () => {
    const data = await parseWith("1200 dinner with Asha and Ben", {
      included: ["Me", "Asha", "Ben"],
      paidBy: "Ben",
    });
    expect(data.paidBy).toBeNull();
    expect(data.payerMention).toBeNull();
    // No payment wording at all: the labelled "Me" default is allowed.
    expect(data.payerUnresolved).toBe(false);

    const { saved } = await captureAndParse("1200 dinner with Asha and Ben", {
      included: ["Me", "Asha", "Ben"],
      paidBy: "Ben",
    });
    expect(saved.paidBy).toBe("Me");
    expect(saved.paidBySource).toBe("default");
  });

  it("B: 'Asha paid' with a missing model payer stays unresolved, not Me", async () => {
    const data = await parseWith("Asha paid 1200 dinner for me and Ben", {
      included: ["Me", "Ben"],
      paidBy: null,
    });
    expect(data.paidBy).toBeNull();
    expect(data.payerUnresolved).toBe(true);

    const { saved, issues } = await captureAndParse(
      "Asha paid 1200 dinner for me and Ben",
      { included: ["Me", "Ben"], paidBy: null },
    );
    expect(saved.paidBy).toBeNull();
    expect(saved.paidBySource).toBe("capture");
    expect(saved.included).toEqual(["Me", "Ben"]);
    expect(issues.map((issue) => issue.field)).toContain("paidBy");
    expect(issues.find((issue) => issue.field === "paidBy")?.message).toMatch(
      /mentions paying/,
    );
  });

  it("B variant: a model payer that contradicts the text is not accepted", async () => {
    const data = await parseWith("Asha paid 1200 dinner for me and Ben", {
      included: ["Me", "Ben"],
      paidBy: "Ben",
    });
    expect(data.paidBy).toBeNull();
    expect(data.payerUnresolved).toBe(true);
  });

  it("accepts the payer the text states", async () => {
    for (const text of [
      "Asha paid 1200 dinner for me and Ben",
      "1200 dinner, paid by Asha",
      "1200 dinner on Asha's card",
      "1200 dinner, Asha already paid",
    ]) {
      const data = await parseWith(text, { paidBy: "Asha" });
      expect(data.paidBy, text).toBe("Asha");
      expect(data.payerUnresolved, text).toBe(false);
    }
  });

  it("accepts 'I paid' and its variants as Me", async () => {
    for (const [text, written] of [
      ["I paid 500 taxi", "I"],
      ["500 taxi paid by me", "me"],
      ["500 taxi, my treat", "Me"],
    ]) {
      const data = await parseWith(text, { paidBy: written });
      expect(data.paidBy, text).toBe("Me");
    }

    const { saved, issues } = await captureAndParse("I paid 500 taxi", {
      amount: 500,
      paidBy: "I",
    });
    expect(saved.paidBy).toBe("Me");
    expect(saved.paidBySource).toBe("capture");
    expect(issues).toEqual([]);
  });

  it("keeps an unknown payer for review and an ambiguous payer unresolved", async () => {
    const unknown = await parseWith("Dmitri paid 60 for me and asha", {
      paidBy: "Dmitri",
      included: ["Me", "Asha"],
    });
    expect(unknown.paidBy).toBeNull();
    expect(unknown.payerMention).toBe("Dmitri");
    expect(unknown.payerUnresolved).toBe(true);

    const vague = await parseWith("someone paid 300 snacks", {
      paidBy: "someone",
      paidByAmbiguous: true,
    });
    expect(vague.paidBy).toBeNull();
    expect(vague.payerUnresolved).toBe(true);

    const flagged = await parseWith("asha or ben paid 300 snacks", {
      paidBy: "Asha",
    });
    expect(flagged.paidBy).toBeNull();
    expect(flagged.payerUnresolved).toBe(true);
  });

  it("does not pick one of several candidate payers", async () => {
    for (const text of [
      "Asha and Ben paid 1200 dinner",
      "me and Asha paid 1200 dinner",
      "Asha paid 600, Ben paid 600 dinner",
      "Asha paid 1200 dinner, paid by Ben",
    ]) {
      const data = await parseWith(text, { paidBy: "Asha" });
      expect(data.paidBy, text).toBeNull();
      expect(data.payerUnresolved, text).toBe(true);
    }
  });

  it("ignores a payer when the text never talks about paying", async () => {
    for (const text of ["300 snacks", "300 snacks for Ben", "lunch with Asha 400"]) {
      const data = await parseWith(text, { paidBy: "Asha" });
      expect(data.paidBy, text).toBeNull();
      expect(data.payerUnresolved, text).toBe(false);
    }
  });

  it("matches whole words, not substrings", async () => {
    const withAna = ["Me", "Ana", "Ben"];

    // "Ana" inside "banana", "Me" inside "Mehul" / "meal".
    const banana = await parseWith(
      "banana shake 200, Ben paid",
      { paidBy: "Ana" },
      withAna,
    );
    expect(banana.paidBy).toBeNull();
    expect(banana.payerUnresolved).toBe(true);

    const mehul = await parseWith("Mehul paid 300 meal", { paidBy: "me" });
    expect(mehul.paidBy).toBeNull();
    expect(mehul.payerUnresolved).toBe(true);

    // A name only ever seen inside another word is not "mentioned".
    expect(mentionedInText("Ana", "banana shake")).toBe(false);
    expect(mentionedInText("Ana", "Ana's shake")).toBe(true);
    expect(mentionedInText("$", "$40 taxi")).toBe(true);
    expect(readPayerEvidence("Benjamin paid 300", ["Ben"]).payers).toEqual([]);
  });

  it("the deterministic reader finds the stated payer only", () => {
    expect(readPayerEvidence("1200 dinner with Asha and Ben", members)).toEqual({
      mentionsPayment: false,
      payers: [],
      group: false,
      doubtful: false,
    });
    expect(
      readPayerEvidence("Asha paid 1200 dinner for me and Ben", members),
    ).toEqual({
      mentionsPayment: true,
      payers: ["Asha"],
      group: false,
      doubtful: false,
    });
  });
});

describe("payer at capture and after manual choices", () => {
  it("starts unresolved when the capture talks about paying", async () => {
    const trip = await createTrip("Test trip", ["Asha", "Ben"]);
    const paid = await addDraftExpense(trip.id, "Asha paid 1200 dinner");
    expect(paid.paidBy).toBeNull();
    expect(paid.paidBySource).toBe("capture");

    const plain = await addDraftExpense(trip.id, "1200 dinner");
    expect(plain.paidBy).toBe("Me");
    expect(plain.paidBySource).toBe("default");
  });

  it("re-evaluates the open payer when the text is corrected", async () => {
    const trip = await createTrip("Test trip", ["Asha", "Ben"]);
    const draft = await addDraftExpense(trip.id, "1200 dinner");
    const corrected = await updateRawText(draft.id, "1200 dinner, Ben paid");
    expect(corrected.paidBy).toBeNull();
  });

  it("keeps a payer chosen at capture or in Review over any AI reading", async () => {
    const trip = await createTrip("Test trip", ["Asha", "Ben"]);
    const chosen = await addDraftExpense(trip.id, "Asha paid 1200 dinner", {
      paidBy: "Ben",
    });
    const reviewed = await addDraftExpense(trip.id, "Asha paid 1200 dinner");
    await saveManualEdit(reviewed.id, { paidBy: "Ben" });

    for (const id of [chosen.id, reviewed.id]) {
      const ticket = await claimParse(id);
      await applyParseResult(ticket!, {
        ...(await parseWith("Asha paid 1200 dinner", { paidBy: "Asha" })),
      });
      const saved = await getExpense(id);
      expect(saved?.paidBy).toBe("Ben");
      expect(saved?.paidBySource).toBe("manual");
    }

    // Manual choice also survives a text correction.
    const corrected = await updateRawText(reviewed.id, "Asha paid 1300 dinner");
    expect(corrected.paidBy).toBe("Ben");
  });
});

describe("release review: payer phrases that must stay unresolved", () => {
  // The model wrongly reports a single, unambiguous payer each time.
  const wrongModel = { amount: 1200, paidBy: "Asha", paidByAmbiguous: false };

  it.each([
    "1200 dinner paid by Asha and Ben",
    "1200 dinner paid by Asha or Ben",
    "1200 dinner paid by Ben and Asha",
    "1200 dinner, Asha paid me back",
    "1200 dinner, Asha paid nothing",
    "1200 dinner, Asha didn't pay",
    "1200 dinner, Asha has not paid yet",
    "1200 dinner, Asha paid 0",
    "1200 dinner, I owe Asha",
    "1200 dinner, Asha reimbursed me",
  ])("%s -> unresolved, not exportable", async (text) => {
    const data = await parseWith(text, wrongModel);
    expect(data.paidBy).toBeNull();
    expect(data.payerUnresolved).toBe(true);

    const { saved, issues } = await captureAndParse(text, wrongModel);
    expect(saved.paidBy).toBeNull();
    expect(issues.map((issue) => issue.field)).toContain("paidBy");
  });

  it.each([
    ["Asha paid 1200 dinner", "Asha", "Asha"],
    ["1200 dinner paid by Asha", "Asha", "Asha"],
    ["1200 dinner paid by Asha for me and Ben", "Asha", "Asha"],
    ["I paid 1200 dinner", "I", "Me"],
    ["1200 dinner on Asha's card", "Asha", "Asha"],
  ])("ordinary wording still works: %s", async (text, written, expected) => {
    const data = await parseWith(text, { amount: 1200, paidBy: written });
    expect(data.paidBy).toBe(expected);
    expect(data.payerUnresolved).toBe(false);
  });

  it("keeps the labelled Me default when there is no payment wording", async () => {
    const { saved, issues } = await captureAndParse("1200 dinner with Asha and Ben", wrongModel);
    expect(saved.paidBy).toBe("Me");
    expect(saved.paidBySource).toBe("default");
    expect(issues).toEqual([]);
  });

  it("starts a repayment capture with an open payer, before any reading", async () => {
    const trip = await createTrip("Test trip", ["Asha", "Ben"]);
    const draft = await addDraftExpense(trip.id, "1200 dinner, I owe Asha");
    expect(draft.paidBy).toBeNull();
  });

  it("a manual payer still wins over doubtful wording", async () => {
    const trip = await createTrip("Test trip", ["Asha", "Ben"]);
    const draft = await addDraftExpense(trip.id, "1200 dinner, Asha paid me back");
    await saveManualEdit(draft.id, { paidBy: "Ben" });
    const ticket = await claimParse(draft.id);
    await applyParseResult(ticket!, await parseWith("1200 dinner, Asha paid me back", wrongModel));
    expect((await getExpense(draft.id))?.paidBy).toBe("Ben");
  });
});
