import { getDb } from "@/lib/db";
import type { Expense, ExpenseStatus, ParseStat, Trip } from "@/lib/types";

function createId(): string {
  return crypto.randomUUID();
}

function toTitleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) =>
      word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : "",
    )
    .join(" ");
}

function cleanMembers(otherMembers: string[]): string[] {
  const seen = new Set(["me"]);
  const members = ["Me"];

  for (const member of otherMembers) {
    const name = toTitleCase(member);
    const key = name.toLowerCase();

    if (!name || key === "me" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    members.push(name);
  }

  return members;
}

export async function createTrip(
  name: string,
  otherMembers: string[],
): Promise<Trip> {
  const db = getDb();
  const now = Date.now();
  const trip: Trip = {
    id: createId(),
    name: name.trim(),
    members: cleanMembers(otherMembers),
    isActive: true,
    createdAt: now,
  };

  await db.transaction("rw", db.trips, async () => {
    await db.trips.toCollection().modify({ isActive: false });
    await db.trips.add(trip);
  });

  return trip;
}

export async function getActiveTrip(): Promise<Trip | undefined> {
  return getDb()
    .trips.filter((trip) => trip.isActive)
    .first();
}

export async function listTrips(): Promise<Trip[]> {
  return getDb().trips.orderBy("createdAt").reverse().toArray();
}

export async function setActiveTrip(tripId: string): Promise<void> {
  const db = getDb();

  await db.transaction("rw", db.trips, async () => {
    const trip = await db.trips.get(tripId);

    if (!trip) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    await db.trips.toCollection().modify({ isActive: false });
    await db.trips.update(tripId, { isActive: true });
  });
}

export async function addTripMember(
  tripId: string,
  name: string,
): Promise<Trip> {
  const db = getDb();
  const memberName = toTitleCase(name);

  if (!memberName || memberName.toLowerCase() === "me") {
    const trip = await db.trips.get(tripId);

    if (!trip) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    return trip;
  }

  return db.transaction("rw", db.trips, async () => {
    const trip = await db.trips.get(tripId);

    if (!trip) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    const alreadyExists = trip.members.some(
      (member) => member.toLowerCase() === memberName.toLowerCase(),
    );

    if (alreadyExists) {
      return trip;
    }

    const updatedTrip: Trip = {
      ...trip,
      members: [...trip.members, memberName],
    };

    await db.trips.put(updatedTrip);

    return updatedTrip;
  });
}

export async function addDraftExpense(
  tripId: string,
  rawText: string,
  options?: {
    included?: string[];
    peopleLocked?: boolean;
  },
): Promise<Expense> {
  const db = getDb();
  const trip = await db.trips.get(tripId);

  if (!trip) {
    throw new Error(`Trip not found: ${tripId}`);
  }

  const now = Date.now();
  const expense: Expense = {
    id: createId(),
    tripId,
    rawText,
    amount: null,
    category: null,
    note: "",
    location: null,
    included: options?.included
      ? [...options.included]
      : [...trip.members],
    ...(options?.peopleLocked ? { peopleLocked: true } : {}),
    unmatchedNames: [],
    splitType: "equal",
    isPersonal: false,
    confidence: "low",
    status: "draft",
    parseStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };

  await db.expenses.add(expense);

  return expense;
}

export async function getExpense(id: string): Promise<Expense | undefined> {
  return getDb().expenses.get(id);
}

export async function updateExpense(
  id: string,
  changes: Partial<Expense>,
): Promise<void> {
  await getDb().expenses.update(id, {
    ...changes,
    updatedAt: Date.now(),
  });
}

export async function setExpenseStatus(
  id: string,
  status: ExpenseStatus,
): Promise<void> {
  await getDb().expenses.update(id, {
    status,
    updatedAt: Date.now(),
  });
}

export async function listExpenses(
  tripId: string,
  status?: ExpenseStatus,
): Promise<Expense[]> {
  const expenses = await getDb()
    .expenses.where("tripId")
    .equals(tripId)
    .filter((expense) => !status || expense.status === status)
    .toArray();

  return expenses.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteExpense(id: string): Promise<void> {
  await getDb().expenses.delete(id);
}

export async function addParseStat(
  expenseId: string,
  fieldsChanged: string[],
): Promise<void> {
  const parseStat: ParseStat = {
    id: createId(),
    expenseId,
    fieldsChanged: [...fieldsChanged],
    createdAt: Date.now(),
  };

  await getDb().parseStats.add(parseStat);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }

  return navigator.storage.persist();
}
