import { describe, expect, it, vi } from "vitest";
import { parseExpense, reparsePendingDrafts } from "@/lib/parse-client";
import {
  addDraftExpense,
  archiveExpenses,
  createTrip,
  getExpense,
  listExpenses,
  markExpenseReady,
  NotReadyError,
  saveManualEdit,
} from "@/lib/storage";
import { controlledFetch, parsed } from "./helpers";

describe("local save survives AI failure and offline mode", () => {
  it("saves the draft before and without any network call", async () => {
    const trip = await createTrip("Test trip", ["Asha"]);
    const fetchImpl = vi.fn();
    vi.stubGlobal("navigator", { onLine: false });

    const draft = await addDraftExpense(trip.id, "45 usd museum, me + asha");
    const result = await parseExpense(draft.id, { fetchImpl });

    expect(result).toBe("offline");
    expect(fetchImpl).not.toHaveBeenCalled();
    const saved = await getExpense(draft.id);
    expect(saved?.rawText).toBe("45 usd museum, me + asha");
    expect(saved?.parseStatus).toBe("pending");
    // Read locally, without AI.
    expect(saved?.currency).toBe("USD");
    expect(saved?.paidBy).toBe("Me");
    expect(saved?.paidBySource).toBe("default");
  });

  it("returns a dropped connection to the queue and reads it on reconnect", async () => {
    const trip = await createTrip("Test trip", ["Asha"]);
    const draft = await addDraftExpense(trip.id, "900 dinner");
    const failing = vi.fn(async () => {
      vi.stubGlobal("navigator", { onLine: false });
      throw new TypeError("Failed to fetch");
    });

    expect(await parseExpense(draft.id, { fetchImpl: failing })).toBe("offline");
    let saved = await getExpense(draft.id);
    expect(saved?.parseStatus).toBe("pending");
    expect(saved?.parseAttempts).toBe(0);

    vi.stubGlobal("navigator", { onLine: true });
    const { fetchImpl, calls } = controlledFetch();
    const sweep = reparsePendingDrafts({ fetchImpl });
    for (let i = 0; i < 50 && calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    calls[0].resolve({ ok: true, data: parsed({ amount: 900 }) });
    await sweep;

    saved = await getExpense(draft.id);
    expect(saved?.parseStatus).toBe("done");
    expect(saved?.amount).toBe(900);
  });

  it("keeps a failed draft recoverable and manually completable", async () => {
    const trip = await createTrip("Test trip", ["Asha"]);
    const draft = await addDraftExpense(trip.id, "dinner 2400 everyone");
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    for (let i = 0; i < 50 && calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    calls[0].resolve({ ok: false, error: "ai_unavailable" });

    expect(await run).toBe("failed");
    const failed = await getExpense(draft.id);
    expect(failed?.parseStatus).toBe("failed");
    expect(failed?.parseError).toBe("ai_unavailable");
    expect(failed?.rawText).toBe("dinner 2400 everyone");
    expect(failed?.amount).toBeNull();

    await expect(markExpenseReady(draft.id)).rejects.toBeInstanceOf(
      NotReadyError,
    );
    await saveManualEdit(draft.id, { amount: 2400, note: "Dinner" });
    const ready = await markExpenseReady(draft.id);
    expect(ready.status).toBe("ready");
    expect(ready.amount).toBe(2400);
  });

  it("stops automatic retries after the attempt limit", async () => {
    const trip = await createTrip("Test trip", ["Asha"]);
    await addDraftExpense(trip.id, "taxi 300");
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "ai_unavailable" })),
    );

    for (let i = 0; i < 5; i += 1) {
      await reparsePendingDrafts({ fetchImpl });
    }

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [draft] = await listExpenses(trip.id, "draft");
    expect(draft.parseStatus).toBe("failed");
  });

  it("does not auto-retry when the server has no AI configured", async () => {
    const trip = await createTrip("Test trip", ["Asha"]);
    await addDraftExpense(trip.id, "taxi 300");
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "ai_not_configured" })),
    );

    await reparsePendingDrafts({ fetchImpl });
    await reparsePendingDrafts({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("archive is all-or-nothing and only touches Ready expenses", async () => {
    const trip = await createTrip("Test trip", ["Asha"]);
    const a = await addDraftExpense(trip.id, "100 a");
    const b = await addDraftExpense(trip.id, "200 b");
    await saveManualEdit(a.id, { amount: 100 });
    await markExpenseReady(a.id);

    expect(await archiveExpenses([a.id, b.id, "missing-id"])).toBe(1);
    expect((await getExpense(a.id))?.status).toBe("archived");
    expect((await getExpense(b.id))?.status).toBe("draft");
  });
});
