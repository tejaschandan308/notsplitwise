import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { closeDbForTests, DB_NAME, getDb } from "@/lib/db";
import { parseExpense } from "@/lib/parse-client";
import { applyParseResult, claimParse } from "@/lib/parse-lifecycle";
import { getActiveTrip, getExpense, listExpenses } from "@/lib/storage";
import { controlledFetch, parsed, settle } from "./helpers";

const now = new Date(2026, 6, 1, 12).getTime();

/** Writes records exactly as the v1 app stored them. */
async function seedV1Database() {
  const v1 = new Dexie(DB_NAME);
  v1.version(1).stores({
    trips: "id, isActive, createdAt",
    expenses: "id, tripId, status, parseStatus, createdAt",
    parseStats: "id, expenseId, createdAt",
  });
  await v1.open();

  const base = {
    tripId: "trip-1",
    category: null,
    note: "",
    location: null,
    included: ["Me", "Aman", "Neha"],
    peopleLocked: false,
    lockedIncluded: [],
    unmatchedNames: [],
    splitType: "equal",
    isPersonal: false,
    confidence: "high",
    createdAt: now,
    updatedAt: now,
  };

  await v1.table("trips").add({
    id: "trip-1",
    name: "Goa",
    members: ["Me", "Aman", "Neha"],
    isActive: true,
    createdAt: now,
  });
  await v1.table("expenses").bulkAdd([
    {
      ...base,
      id: "ready-1",
      rawText: "1240 airport lunch",
      amount: 1240,
      category: "food",
      note: "Airport lunch",
      status: "ready",
      parseStatus: "done",
    },
    {
      // Typed by hand in Review while the parse never finished.
      ...base,
      id: "pending-edited",
      rawText: "dinner 2400",
      amount: 2400,
      note: "Dinner by the beach",
      status: "draft",
      parseStatus: "pending",
      confidence: "low",
    },
    {
      ...base,
      id: "archived-custom",
      rawText: "boat 800 custom",
      amount: 800,
      splitType: "custom",
      status: "archived",
      parseStatus: "done",
    },
  ]);
  await v1.table("parseStats").add({
    id: "stat-1",
    expenseId: "ready-1",
    fieldsChanged: ["amount"],
    createdAt: now,
  });
  v1.close();
}

describe("Dexie v1 -> current migration", () => {
  it("keeps every existing record and value", async () => {
    await seedV1Database();
    closeDbForTests();

    const trip = await getActiveTrip();
    expect(trip?.name).toBe("Goa");
    expect(trip?.currency).toBe("INR");
    expect(getDb().verno).toBe(3);

    const all = await listExpenses("trip-1");
    expect(all.map((expense) => expense.id).sort()).toEqual([
      "archived-custom",
      "pending-edited",
      "ready-1",
    ]);

    const ready = await getExpense("ready-1");
    expect(ready).toMatchObject({
      rawText: "1240 airport lunch",
      amount: 1240,
      note: "Airport lunch",
      status: "ready",
      // The old app's interpretation, labelled as such.
      currency: "INR",
      currencySource: "legacy",
      paidBy: "Me",
      paidBySource: "legacy",
      captureRevision: 1,
    });

    const archived = await getExpense("archived-custom");
    expect(archived?.splitType).toBe("custom");
    expect(archived?.status).toBe("archived");

    expect(await getDb().parseStats.count()).toBe(1);
  });

  it("protects hand-typed values on old unfinished drafts from a later parse", async () => {
    await seedV1Database();
    closeDbForTests();

    const before = await getExpense("pending-edited");
    expect(before?.editedFields).toEqual(
      expect.arrayContaining(["amount", "note"]),
    );

    const ticket = await claimParse("pending-edited");
    expect(ticket).not.toBeNull();
    await applyParseResult(ticket!, parsed({ amount: 1, note: "Wrong" }));

    const after = await getExpense("pending-edited");
    expect(after?.amount).toBe(2400);
    expect(after?.note).toBe("Dinner by the beach");
    expect(after?.parseStatus).toBe("done");
  });
});

/** v1 drafts whose people were changed in the old Review screen. */
async function seedV1PeopleDrafts() {
  const v1 = new Dexie(DB_NAME);
  v1.version(1).stores({
    trips: "id, isActive, createdAt",
    expenses: "id, tripId, status, parseStatus, createdAt",
    parseStats: "id, expenseId, createdAt",
  });
  await v1.open();

  const base = {
    tripId: "trip-1",
    amount: null,
    category: null,
    note: "",
    location: null,
    // The old Review screen saved people without setting peopleLocked.
    peopleLocked: false,
    lockedIncluded: [],
    unmatchedNames: [],
    splitType: "equal",
    isPersonal: false,
    confidence: "low",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  await v1.table("trips").add({
    id: "trip-1",
    name: "Goa",
    members: ["Me", "Aman", "Neha"],
    isActive: true,
    createdAt: now,
  });
  await v1.table("expenses").bulkAdd([
    {
      ...base,
      id: "pending-reduced",
      rawText: "2400 dinner with everyone",
      included: ["Me", "Aman"],
      parseStatus: "pending",
    },
    {
      ...base,
      id: "failed-reduced",
      rawText: "600 snacks",
      included: ["Me", "Neha"],
      parseStatus: "failed",
    },
    {
      ...base,
      id: "pending-unknown",
      rawText: "900 boat me aman dmitri",
      included: ["Me", "Aman"],
      unmatchedNames: ["Dmitri"],
      parseStatus: "pending",
    },
    {
      ...base,
      id: "ready-reduced",
      rawText: "300 chai",
      amount: 300,
      included: ["Me", "Aman"],
      status: "ready",
      parseStatus: "done",
    },
  ]);
  v1.close();
}

describe("v1 drafts with people changed by hand", () => {
  it("keeps a reduced participant list through a late parse", async () => {
    await seedV1PeopleDrafts();
    closeDbForTests();

    const before = await getExpense("pending-reduced");
    expect(before?.peopleLocked).toBe(false);
    expect(before?.editedFields).toContain("included");

    const ticket = await claimParse("pending-reduced");
    const outcome = await applyParseResult(
      ticket!,
      parsed({ amount: 2400, included: ["Me", "Aman", "Neha"] }),
    );

    expect(outcome.applied).toBe(true);
    const after = await getExpense("pending-reduced");
    expect(after?.included).toEqual(["Me", "Aman"]);
    // Untouched fields still take the reading.
    expect(after?.amount).toBe(2400);
    expect(after?.parseStatus).toBe("done");
  });

  it("keeps a reduced list on a failed draft through a retry", async () => {
    await seedV1PeopleDrafts();
    closeDbForTests();

    const { fetchImpl, calls } = controlledFetch();
    const run = parseExpense("failed-reduced", { force: true, fetchImpl });
    for (let i = 0; i < 50 && calls.length < 1; i += 1) await settle(1);
    calls[0].resolve({
      ok: true,
      data: parsed({ amount: 600, included: ["Me", "Aman", "Neha"], isPersonal: false }),
    });

    expect(await run).toBe("applied");
    expect((await getExpense("failed-reduced"))?.included).toEqual(["Me", "Neha"]);
  });

  it("keeps an unknown name waiting for a decision", async () => {
    await seedV1PeopleDrafts();
    closeDbForTests();

    const ticket = await claimParse("pending-unknown");
    await applyParseResult(
      ticket!,
      parsed({ amount: 900, included: ["Me", "Aman", "Neha"], unmatchedNames: [] }),
    );

    const after = await getExpense("pending-unknown");
    expect(after?.included).toEqual(["Me", "Aman"]);
    expect(after?.unmatchedNames).toEqual(["Dmitri"]);
  });

  it("leaves old Ready records exactly as they were", async () => {
    await seedV1PeopleDrafts();
    closeDbForTests();

    const ready = await getExpense("ready-reduced");
    expect(ready).toMatchObject({
      status: "ready",
      amount: 300,
      included: ["Me", "Aman"],
      editedFields: [],
      captureCurrency: "INR",
    });
    expect(await claimParse("ready-reduced")).toBeNull();
  });

  it("repairs v1 drafts already migrated by an earlier v2 build", async () => {
    // What the earlier v2 upgrade wrote: no people protection, no context.
    const v2 = new Dexie(DB_NAME);
    v2.version(2).stores({
      trips: "id, isActive, createdAt",
      expenses: "id, tripId, status, parseStatus, createdAt",
      parseStats: "id, expenseId, createdAt",
    });
    await v2.open();
    await v2.table("trips").add({
      id: "trip-1",
      name: "Goa",
      members: ["Me", "Aman", "Neha"],
      isActive: true,
      createdAt: now,
      currency: "INR",
    });
    await v2.table("expenses").add({
      id: "migrated-pending",
      tripId: "trip-1",
      rawText: "2400 dinner with everyone",
      amount: 2400,
      currency: "INR",
      currencySource: "legacy",
      currencyMention: null,
      category: null,
      note: "",
      location: null,
      included: ["Me", "Aman"],
      peopleLocked: false,
      lockedIncluded: [],
      unmatchedNames: [],
      paidBy: "Me",
      paidBySource: "legacy",
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
      editedFields: ["amount"],
      createdAt: now,
      updatedAt: now,
    });
    v2.close();
    closeDbForTests();

    const repaired = await getExpense("migrated-pending");
    expect(repaired?.editedFields).toEqual(
      expect.arrayContaining(["amount", "included"]),
    );
    expect(repaired?.captureCurrency).toBe("INR");

    const ticket = await claimParse("migrated-pending");
    await applyParseResult(ticket!, parsed({ amount: 1, included: ["Me", "Aman", "Neha"] }));
    const after = await getExpense("migrated-pending");
    expect(after?.included).toEqual(["Me", "Aman"]);
    expect(after?.amount).toBe(2400);
  });
});
