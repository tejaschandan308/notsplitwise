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
import type { Expense, ParsedExpenseFields, Trip } from "@/lib/types";

type ParseApiResponse = {
  ok: boolean;
  data: ParsedExpenseFields;
  error?: string;
};

type ExampleParse = {
  input: string;
  output: ParseApiResponse;
};

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

const demoMembers = ["Me", "Aman", "Neha", "Rohan"];
const parseExamples = [
  "1240 airport lunch, me Aman Neha, not Rohan",
  "3200 hotel night 1",
  "450 cab to airport, just me",
  "uber 280",
  "dinner at beach shack 1850",
  "2k groceries",
  "tickets for the fort everyone 600",
  "my own coffee 180",
  "petrol 1500 me and aman",
  "snacks",
  "splitting the airbnb 12000 across all of us",
  "990 lunch only aman and neha not me",
  "boat ride 800 for me aman neha rohan",
  "random gibberish xkcd",
];

// TEMPORARY DEV VERIFICATION PAGE: remove before release.
export default function DevPage() {
  const [state, setState] = useState<DevState>(initialState);
  const [parseInput, setParseInput] = useState(parseExamples[0]);
  const [parseResult, setParseResult] = useState<ParseApiResponse | null>(null);
  const [exampleResults, setExampleResults] = useState<ExampleParse[]>([]);
  const [parseStatus, setParseStatus] = useState("");

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

  async function parseExpense(rawText: string): Promise<ParseApiResponse> {
    const response = await fetch("/api/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rawText,
        members: demoMembers,
      }),
    });

    return response.json() as Promise<ParseApiResponse>;
  }

  async function handleParse(): Promise<void> {
    setParseStatus("Parsing...");
    const result = await parseExpense(parseInput);
    setParseResult(result);
    setParseStatus(result.ok ? "Parsed." : `Fallback: ${result.error}`);
  }

  async function handleRunExamples(): Promise<void> {
    setParseStatus("Running examples...");
    const results: ExampleParse[] = [];

    for (const input of parseExamples) {
      results.push({
        input,
        output: await parseExpense(input),
      });
    }

    setExampleResults(results);
    setParseStatus("Examples complete.");
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

      <section className="mt-10 border-t pt-6">
        <h2 className="text-xl font-semibold">Parse Tester</h2>
        <p className="mt-2 text-sm">
          Members: {JSON.stringify(demoMembers)}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-w-0 flex-1 rounded border px-3 py-2"
            type="text"
            value={parseInput}
            onChange={(event) => setParseInput(event.target.value)}
          />
          <button type="button" onClick={handleParse}>
            Parse
          </button>
          <button type="button" onClick={handleRunExamples}>
            Run all examples
          </button>
        </div>
        {parseStatus ? <p className="mt-3 text-sm">{parseStatus}</p> : null}
        {parseResult ? (
          <pre className="mt-4 overflow-auto rounded border p-4 text-xs">
            {JSON.stringify(parseResult, null, 2)}
          </pre>
        ) : null}
        {exampleResults.length > 0 ? (
          <div className="mt-6 space-y-4">
            {exampleResults.map((example) => (
              <article key={example.input} className="rounded border p-4">
                <h3 className="font-medium">{example.input}</h3>
                <pre className="mt-2 overflow-auto text-xs">
                  {JSON.stringify(example.output, null, 2)}
                </pre>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
