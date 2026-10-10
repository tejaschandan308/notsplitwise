import Dexie, { type Table } from "dexie";
import {
  normalizeExpense,
  normalizeTrip,
  repairLegacyDraft,
} from "@/lib/normalize";
import type { Expense, ParseStat, Trip } from "@/lib/types";

// The database name is user data's home. Never rename it.
export const DB_NAME = "log-now-split-later";

class LocalDataDb extends Dexie {
  trips!: Table<Trip, string>;
  expenses!: Table<Expense, string>;
  parseStats!: Table<ParseStat, string>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      trips: "id, isActive, createdAt",
      expenses: "id, tripId, status, parseStatus, createdAt",
      parseStats: "id, expenseId, createdAt",
    });

    // v2: payer, currency, capture revision and field provenance. Indexes are
    // unchanged; the upgrade only fills new fields on existing records and
    // keeps every existing value (see normalize.ts for the legacy rules).
    this.version(2)
      .stores({
        trips: "id, isActive, createdAt",
        expenses: "id, tripId, status, parseStatus, createdAt",
        parseStats: "id, expenseId, createdAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table("trips")
          .toCollection()
          .modify((trip: Record<string, unknown>) => {
            Object.assign(trip, normalizeTrip(trip));
          });
        await tx
          .table("expenses")
          .toCollection()
          .modify((expense: Record<string, unknown>) => {
            Object.assign(expense, normalizeExpense(expense));
          });
      });

    // v3: each expense keeps the trip default it was captured under
    // (`captureCurrency`), and old v1 drafts get their saved people protected
    // (see normalize.ts). Indexes are unchanged; existing values are kept.
    this.version(3)
      .stores({
        trips: "id, isActive, createdAt",
        expenses: "id, tripId, status, parseStatus, createdAt",
        parseStats: "id, expenseId, createdAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table("expenses")
          .toCollection()
          .modify((expense: Record<string, unknown>) => {
            Object.assign(expense, repairLegacyDraft(normalizeExpense(expense)));
          });
      });
  }
}

let db: LocalDataDb | undefined;

export function getDb(): LocalDataDb {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is only available in the browser.");
  }

  db ??= new LocalDataDb();

  return db;
}

/** Test helper: drop the cached connection so a fresh one can be opened. */
export function closeDbForTests(): void {
  db?.close();
  db = undefined;
}
