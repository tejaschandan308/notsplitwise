import { describe, expect, it, vi } from "vitest";
import { parseExpense, reparsePendingDrafts } from "@/lib/parse-client";
import { PARSE_STALE_MS } from "@/lib/parse-lifecycle";
import {
  addDraftExpense,
  archiveExpenses,
  createTrip,
  deleteExpense,
  getExpense,
  markExpenseReady,
  saveManualEdit,
  updateRawText,
} from "@/lib/storage";
import { controlledFetch, parsed, settle } from "./helpers";

async function waitForCalls(calls: unknown[], count: number) {
  for (let i = 0; i < 50 && calls.length < count; i += 1) {
    await settle(1);
  }
  expect(calls.length).toBe(count);
}

async function setup(rawText = "1200 dinner") {
  const trip = await createTrip("Test trip", ["Asha", "Ben"]);
  const draft = await addDraftExpense(trip.id, rawText);
  return { trip, draft };
}

describe("slow parse results never overwrite newer state", () => {
  it("keeps manual edits made while the parse was in flight", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    await saveManualEdit(draft.id, { amount: 500, paidBy: "Asha" });
    calls[0].resolve({
      ok: true,
      data: parsed({ amount: 999, paidBy: "Ben", note: "Team dinner" }),
    });

    expect(await run).toBe("applied");
    const saved = await getExpense(draft.id);
    expect(saved?.amount).toBe(500);
    expect(saved?.paidBy).toBe("Asha");
    expect(saved?.paidBySource).toBe("manual");
    // Fields the person didn't touch still take the AI's reading.
    expect(saved?.note).toBe("Team dinner");
    expect(saved?.parseStatus).toBe("done");
  });

  it("discards a result that arrives after the expense was marked Ready", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    await saveManualEdit(draft.id, { amount: 800 });
    await markExpenseReady(draft.id);
    calls[0].resolve({ ok: true, data: parsed({ amount: 1, note: "Wrong" }) });

    expect(await run).toBe("discarded");
    const saved = await getExpense(draft.id);
    expect(saved?.status).toBe("ready");
    expect(saved?.amount).toBe(800);
    expect(saved?.note).toBe("");
  });

  it("discards a result that arrives after archive", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    await saveManualEdit(draft.id, { amount: 800 });
    await markExpenseReady(draft.id);
    await archiveExpenses([draft.id]);
    calls[0].resolve({ ok: true, data: parsed({ amount: 1 }) });

    expect(await run).toBe("discarded");
    const saved = await getExpense(draft.id);
    expect(saved?.status).toBe("archived");
    expect(saved?.amount).toBe(800);
  });

  it("does not resurrect a deleted expense", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    await deleteExpense(draft.id);
    calls[0].resolve({ ok: true, data: parsed() });

    expect(await run).toBe("discarded");
    expect(await getExpense(draft.id)).toBeUndefined();
  });

  it("does not let a failure arriving after deletion recreate anything", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    await deleteExpense(draft.id);
    calls[0].resolve({ ok: false, error: "ai_unavailable" });

    expect(await run).toBe("failed");
    expect(await getExpense(draft.id)).toBeUndefined();
  });

  it("discards a result for raw text that has since been corrected", async () => {
    const { draft } = await setup("1200 dinner");
    const { fetchImpl, calls } = controlledFetch();
    const first = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    await updateRawText(draft.id, "2100 dinner");
    calls[0].resolve({ ok: true, data: parsed({ amount: 1200 }) });
    expect(await first).toBe("discarded");

    const second = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 2);
    expect(calls[1].requestBody().rawText).toBe("2100 dinner");
    calls[1].resolve({ ok: true, data: parsed({ amount: 2100 }) });
    expect(await second).toBe("applied");

    const saved = await getExpense(draft.id);
    expect(saved?.amount).toBe(2100);
    expect(saved?.captureRevision).toBe(2);
  });
});

describe("initial parse and retry", () => {
  it("does not start a duplicate parse of the same revision", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const initial = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    // The reconnect/focus sweep and a second direct call both back off.
    await reparsePendingDrafts({ fetchImpl });
    expect(await parseExpense(draft.id, { fetchImpl })).toBe("skipped");
    expect(calls.length).toBe(1);

    calls[0].resolve({ ok: true, data: parsed({ amount: 1200 }) });
    expect(await initial).toBe("applied");
  });

  it("a forced retry supersedes the initial request, whichever answers first", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const initial = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    const retry = parseExpense(draft.id, { fetchImpl, force: true });
    await waitForCalls(calls, 2);

    // The older request answers last with different data: it must lose.
    calls[1].resolve({ ok: true, data: parsed({ amount: 2222 }) });
    expect(await retry).toBe("applied");
    calls[0].resolve({ ok: true, data: parsed({ amount: 1111 }) });
    expect(await initial).toBe("discarded");

    expect((await getExpense(draft.id))?.amount).toBe(2222);
  });

  it("an old request failing late does not mark a newer result as failed", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    const initial = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);
    const retry = parseExpense(draft.id, { fetchImpl, force: true });
    await waitForCalls(calls, 2);

    calls[1].resolve({ ok: true, data: parsed({ amount: 50 }) });
    await retry;
    calls[0].resolve({ ok: false, error: "ai_unavailable" });
    await initial;

    const saved = await getExpense(draft.id);
    expect(saved?.parseStatus).toBe("done");
    expect(saved?.amount).toBe(50);
  });

  it("an abandoned claim can be taken over after it goes stale", async () => {
    const { draft } = await setup();
    const { fetchImpl, calls } = controlledFetch();
    void parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(
      () => realNow() + PARSE_STALE_MS + 1,
    );
    const takeover = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 2);
    calls[1].resolve({ ok: true, data: parsed({ amount: 75 }) });
    expect(await takeover).toBe("applied");
    vi.restoreAllMocks();
  });
});

describe("explicit participant selection", () => {
  it("wins over conflicting model output", async () => {
    const trip = await createTrip("Test trip", ["Asha", "Ben", "Chen"]);
    const draft = await addDraftExpense(trip.id, "600 lunch everyone dmitri", {
      lockedIncluded: ["Me", "Asha"],
    });
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);

    calls[0].resolve({
      ok: true,
      data: parsed({
        included: ["Me", "Asha", "Ben", "Chen"],
        unmatchedNames: ["Dmitri"],
        isPersonal: true,
      }),
    });
    await run;

    const saved = await getExpense(draft.id);
    expect(saved?.included).toEqual(["Me", "Asha"]);
    expect(saved?.unmatchedNames).toEqual([]);
    expect(saved?.isPersonal).toBe(false);
    expect(saved?.peopleLocked).toBe(true);
  });

  it("a payer chosen at capture wins over the model's payer", async () => {
    const trip = await createTrip("Test trip", ["Asha", "Ben"]);
    const draft = await addDraftExpense(trip.id, "Ben paid 300 taxi", {
      paidBy: "Asha",
    });
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    await waitForCalls(calls, 1);
    calls[0].resolve({ ok: true, data: parsed({ paidBy: "Ben" }) });
    await run;

    expect((await getExpense(draft.id))?.paidBy).toBe("Asha");
  });
});
