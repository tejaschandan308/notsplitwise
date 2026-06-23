import Dexie, { type Table } from "dexie";
import type { Expense, ParseStat, Trip } from "@/lib/types";

class LocalDataDb extends Dexie {
  trips!: Table<Trip, string>;
  expenses!: Table<Expense, string>;
  parseStats!: Table<ParseStat, string>;

  constructor() {
    super("log-now-split-later");

    this.version(1).stores({
      trips: "id, isActive, createdAt",
      expenses: "id, tripId, status, parseStatus, createdAt",
      parseStats: "id, expenseId, createdAt",
    });
  }
}

let db: LocalDataDb | undefined;

export function getDb(): LocalDataDb {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser.");
  }

  db ??= new LocalDataDb();

  return db;
}
