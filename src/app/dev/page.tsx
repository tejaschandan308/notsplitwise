"use client";

import { useEffect, useState } from "react";
import {
  addDraftExpense,
  createTrip,
  deleteExpense,
  getActiveTrip,
  listExpenses,
  listTrips,
  updateExpense,
} from "@/lib/storage";
import type { Expense, Trip } from "@/lib/types";

type DevState = {
  activeTrip?: Trip;
  trips: Trip[];
  expenses: Expense[];
  lastExpenseId?: string;
  log: string[];
};

const initialState: DevState = {
  trips: [],
  expenses: [],
  log: [],
};

// TEMPORARY DEV VERIFICATION PAGE: remove before release.
export default function DevPage() {
  const [state, setState] = useState<DevState>(initialState);

  async function refresh(nextLog?: string): Promise<void> {
    const activeTrip = await getActiveTrip();
    const trips = await listTrips();
    const expenses = activeTrip ? await listExpenses(activeTrip.id) : [];

    setState((current) => ({
      ...current,
      activeTrip,
      trips,
      expenses,
      log: nextLog ? [nextLog, ...current.log] : current.log,
    }));
  }

  useEffect(() => {
    let ignore = false;

    async function loadState(): Promise<void> {
      const activeTrip = await getActiveTrip();
      const trips = await listTrips();
      const expenses = activeTrip ? await listExpenses(activeTrip.id) : [];

      if (!ignore) {
        setState((current) => ({
          ...current,
          activeTrip,
          trips,
          expenses,
          log: ["Loaded IndexedDB state.", ...current.log],
        }));
      }
    }

    loadState();

    return () => {
      ignore = true;
    };
  }, []);

  async function handleCreateTrip(): Promise<void> {
    const trip = await createTrip("Goa Trip", ["Aman", "Neha", "Rohan"]);
    setState((current) => ({ ...current, lastExpenseId: undefined }));
    await refresh(`Created trip ${trip.id}.`);
  }

  async function handleShowActiveTrip(): Promise<void> {
    await refresh("Loaded active trip.");
  }

  async function handleAddDraftExpense(): Promise<void> {
    const activeTrip = await getActiveTrip();

    if (!activeTrip) {
      await refresh("Create a trip before adding an expense.");
      return;
    }

    const expense = await addDraftExpense(activeTrip.id, "1240 airport lunch");
    setState((current) => ({ ...current, lastExpenseId: expense.id }));
    await refresh(`Added draft expense ${expense.id}.`);
  }

  async function handleListExpenses(): Promise<void> {
    await refresh("Listed expenses.");
  }

  async function handleUpdateExpense(): Promise<void> {
    const expense = state.lastExpenseId
      ? state.expenses.find((item) => item.id === state.lastExpenseId)
      : state.expenses[0];

    if (!expense) {
      await refresh("Add an expense before updating.");
      return;
    }

    await updateExpense(expense.id, {
      amount: 1240,
      location: "Airport",
      status: "ready",
    });
    setState((current) => ({ ...current, lastExpenseId: expense.id }));
    await refresh(`Updated expense ${expense.id}.`);
  }

  async function handleDeleteExpense(): Promise<void> {
    const expense = state.lastExpenseId
      ? state.expenses.find((item) => item.id === state.lastExpenseId)
      : state.expenses[0];

    if (!expense) {
      await refresh("No expense to delete.");
      return;
    }

    await deleteExpense(expense.id);
    setState((current) => ({ ...current, lastExpenseId: undefined }));
    await refresh(`Deleted expense ${expense.id}.`);
  }

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-semibold">Local Data Dev</h1>
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={handleCreateTrip}>
          Create sample trip
        </button>
        <button type="button" onClick={handleShowActiveTrip}>
          Show active trip
        </button>
        <button type="button" onClick={handleAddDraftExpense}>
          Add draft expense
        </button>
        <button type="button" onClick={handleListExpenses}>
          List expenses
        </button>
        <button type="button" onClick={handleUpdateExpense}>
          Update expense
        </button>
        <button type="button" onClick={handleDeleteExpense}>
          Delete expense
        </button>
      </div>
      <pre className="mt-6 overflow-auto rounded border p-4 text-xs">
        {JSON.stringify(state, null, 2)}
      </pre>
    </main>
  );
}
