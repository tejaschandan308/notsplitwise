import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { closeDbForTests, DB_NAME } from "@/lib/db";
import { parseExpense, reparsePendingDrafts } from "@/lib/parse-client";
import { applyParseResult, claimParse } from "@/lib/parse-lifecycle";
import { handleParseRequest } from "@/lib/parse-server";
import {
  addDraftExpense,
  createTrip,
  getExpense,
  saveManualEdit,
  setTripCurrency,
  updateRawText,
} from "@/lib/storage";
import { controlledFetch, settle } from "./helpers";

/**
 * A fake /api/parse that runs the real server handler with a mocked model,
 * so the currency the client sends is the one actually used.
 */
function serverFetch(modelReply: Record<string, unknown> = {}) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    bodies.push(body);
    const result = await handleParseRequest(body, async () =>
      JSON.stringify({
        amount: 10,
        currencyMention: null,
        category: "transport",
        note: "Taxi",
        location: null,
        included: body.members,
        unmatchedNames: [],
        paidBy: null,
        paidByAmbiguous: false,
        isPersonal: false,
        ...modelReply,
      }),
    );
    return new Response(JSON.stringify(result.body), { status: result.status });
  });

  return { fetchImpl, bodies };
}

describe("an expense keeps the currency default it was captured under", () => {
  it("EUR capture, trip switched to USD while offline, read on reconnect: stays EUR", async () => {
    const trip = await createTrip("Lisbon", ["Asha"], "EUR");
    vi.stubGlobal("navigator", { onLine: false });
    const draft = await addDraftExpense(trip.id, "10 taxi");
    expect(draft.currency).toBe("EUR");
    expect(draft.captureCurrency).toBe("EUR");
    expect(await parseExpense(draft.id)).toBe("offline");

    await setTripCurrency(trip.id, "USD");
    vi.stubGlobal("navigator", { onLine: true });
    const { fetchImpl, bodies } = serverFetch();
    await reparsePendingDrafts({ fetchImpl });

    expect(bodies[0].tripCurrency).toBe("EUR");
    const saved = await getExpense(draft.id);
    expect(saved?.parseStatus).toBe("done");
    expect(saved?.currency).toBe("EUR");
    expect(saved?.currencySource).toBe("default");
  });

  it("trip default changed while the first read is in flight: stays EUR", async () => {
    const trip = await createTrip("Lisbon", ["Asha"], "EUR");
    const draft = await addDraftExpense(trip.id, "10 taxi");
    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense(draft.id, { fetchImpl });
    for (let i = 0; i < 50 && calls.length < 1; i += 1) await settle(1);

    await setTripCurrency(trip.id, "USD");
    expect(calls[0].requestBody().tripCurrency).toBe("EUR");
    const reply = await handleParseRequest(
      calls[0].requestBody(),
      async () => '{"amount": 10, "included": ["Me"], "note": "Taxi"}',
    );
    calls[0].resolve(reply.body);

    expect(await run).toBe("applied");
    expect((await getExpense(draft.id))?.currency).toBe("EUR");
  });

  it("trip default changed before a manual retry of a failed read: stays EUR", async () => {
    const trip = await createTrip("Lisbon", ["Asha"], "EUR");
    const draft = await addDraftExpense(trip.id, "10 taxi");
    const failing = vi.fn(async () => new Response('{"ok":false,"error":"ai_unavailable"}', { status: 502 }));
    expect(await parseExpense(draft.id, { fetchImpl: failing })).toBe("failed");

    await setTripCurrency(trip.id, "USD");
    const { fetchImpl, bodies } = serverFetch();
    expect(await parseExpense(draft.id, { force: true, fetchImpl })).toBe("applied");

    expect(bodies[0].tripCurrency).toBe("EUR");
    expect((await getExpense(draft.id))?.currency).toBe("EUR");
  });

  it("an explicit foreign currency wins over both old and new defaults", async () => {
    const trip = await createTrip("Lisbon", ["Asha"], "EUR");
    const draft = await addDraftExpense(trip.id, "10 gbp taxi");
    await setTripCurrency(trip.id, "USD");
    const { fetchImpl } = serverFetch({ currencyMention: "gbp" });
    await parseExpense(draft.id, { fetchImpl });

    const saved = await getExpense(draft.id);
    expect(saved?.currency).toBe("GBP");
    expect(saved?.currencySource).toBe("capture");
  });

  it("a bare $ is judged by the default at capture, not the new one", async () => {
    // Captured on a EUR trip: "$" is ambiguous and must stay a review item,
    // even though the trip is USD by the time it is read.
    const eurTrip = await createTrip("Lisbon", ["Asha"], "EUR");
    const eurDraft = await addDraftExpense(eurTrip.id, "$10 taxi");
    expect(eurDraft.currency).toBeNull();
    await setTripCurrency(eurTrip.id, "USD");
    await parseExpense(eurDraft.id, { fetchImpl: serverFetch({ currencyMention: "$" }).fetchImpl });
    const eurSaved = await getExpense(eurDraft.id);
    expect(eurSaved?.currency).toBeNull();
    expect(eurSaved?.currencyMention).toBe("$");

    // Captured on a USD trip: "$" is USD and stays USD after a switch to EUR.
    const usdTrip = await createTrip("NYC", ["Asha"], "USD");
    const usdDraft = await addDraftExpense(usdTrip.id, "$10 taxi");
    await setTripCurrency(usdTrip.id, "EUR");
    await parseExpense(usdDraft.id, { fetchImpl: serverFetch({ currencyMention: "$" }).fetchImpl });
    expect((await getExpense(usdDraft.id))?.currency).toBe("USD");
  });

  it("a manual currency survives a default change, a retry and a text correction", async () => {
    const trip = await createTrip("Lisbon", ["Asha"], "EUR");
    const draft = await addDraftExpense(trip.id, "10 taxi");
    await saveManualEdit(draft.id, { currency: "GBP" });
    await setTripCurrency(trip.id, "USD");
    await parseExpense(draft.id, { fetchImpl: serverFetch().fetchImpl });
    await updateRawText(draft.id, "12 taxi");
    await parseExpense(draft.id, { fetchImpl: serverFetch().fetchImpl });

    const saved = await getExpense(draft.id);
    expect(saved?.currency).toBe("GBP");
    expect(saved?.currencySource).toBe("manual");
  });

  it("a text correction is read in the capture's context", async () => {
    const trip = await createTrip("Lisbon", ["Asha"], "EUR");
    const draft = await addDraftExpense(trip.id, "10 taxi");
    await setTripCurrency(trip.id, "USD");
    const corrected = await updateRawText(draft.id, "12 taxi");
    expect(corrected.currency).toBe("EUR");
    expect(corrected.captureCurrency).toBe("EUR");
  });
});

describe("records stored before captureCurrency existed", () => {
  async function seedV2(expenses: Array<Record<string, unknown>>, tripCurrency: string) {
    const v2 = new Dexie(DB_NAME);
    v2.version(2).stores({
      trips: "id, isActive, createdAt",
      expenses: "id, tripId, status, parseStatus, createdAt",
      parseStats: "id, expenseId, createdAt",
    });
    await v2.open();
    await v2.table("trips").add({
      id: "trip-1",
      name: "Lisbon",
      members: ["Me", "Asha"],
      isActive: true,
      createdAt: 1,
      currency: tripCurrency,
    });
    await v2.table("expenses").bulkAdd(
      expenses.map((expense) => ({
        tripId: "trip-1",
        amount: null,
        currencyMention: null,
        category: null,
        note: "",
        location: null,
        included: ["Me", "Asha"],
        peopleLocked: false,
        lockedIncluded: [],
        unmatchedNames: [],
        paidBy: "Me",
        paidBySource: "default",
        payerMention: null,
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
        editedFields: [],
        createdAt: 1,
        updatedAt: 1,
        ...expense,
      })),
    );
    v2.close();
    closeDbForTests();
  }

  it("takes the context from the stored default currency, not the trip's current one", async () => {
    // Captured as EUR by default; the trip has since been switched to USD.
    await seedV2(
      [{ id: "eur-default", rawText: "10 taxi", currency: "EUR", currencySource: "default" }],
      "USD",
    );
    const before = await getExpense("eur-default");
    expect(before?.captureCurrency).toBe("EUR");

    const { fetchImpl, bodies } = serverFetch();
    await parseExpense("eur-default", { fetchImpl });
    expect(bodies[0].tripCurrency).toBe("EUR");
    expect((await getExpense("eur-default"))?.currency).toBe("EUR");
  });

  it("keeps an unresolved bare $ unresolved", async () => {
    await seedV2(
      [{ id: "bare", rawText: "$10 taxi", currency: null, currencySource: "capture", currencyMention: "$" }],
      "USD",
    );
    await parseExpense("bare", { fetchImpl: serverFetch({ currencyMention: "$" }).fetchImpl });
    expect((await getExpense("bare"))?.currency).toBeNull();
  });

  it("reads legacy INR records as INR, whatever the trip says now", async () => {
    await seedV2(
      [
        {
          id: "legacy-ready",
          rawText: "1240 lunch",
          amount: 1240,
          currency: "INR",
          currencySource: "legacy",
          paidBySource: "legacy",
          status: "ready",
          parseStatus: "done",
        },
        {
          id: "legacy-draft",
          rawText: "900 dinner",
          currency: "INR",
          currencySource: "legacy",
          paidBySource: "legacy",
        },
      ],
      "EUR",
    );

    const ready = await getExpense("legacy-ready");
    expect(ready).toMatchObject({ currency: "INR", currencySource: "legacy", captureCurrency: "INR", status: "ready" });

    const { fetchImpl, bodies } = serverFetch({ amount: 900 });
    await parseExpense("legacy-draft", { fetchImpl });
    expect(bodies[0].tripCurrency).toBe("INR");
    expect((await getExpense("legacy-draft"))?.currency).toBe("INR");
  });

  it("pins the inferred context so later edits can't move it", async () => {
    await seedV2(
      [{ id: "eur-default", rawText: "10 taxi", currency: "EUR", currencySource: "default" }],
      "USD",
    );
    const ticket = await claimParse("eur-default");
    await applyParseResult(ticket!, {
      amount: 10,
      currency: null,
      currencyMention: "$",
      category: null,
      note: "",
      location: null,
      included: ["Me"],
      unmatchedNames: [],
      paidBy: null,
      payerMention: null,
      payerUnresolved: false,
      isPersonal: false,
    });
    // Currency changed by the result, but the capture context did not.
    expect((await getExpense("eur-default"))?.captureCurrency).toBe("EUR");
  });
});
