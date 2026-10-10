import type { ParsedExpenseFields, ParseResponse } from "@/lib/types";

/** A parse result with sensible defaults; override what a test cares about. */
export function parsed(
  overrides: Partial<ParsedExpenseFields> = {},
): ParsedExpenseFields {
  return {
    amount: 1200,
    currency: "INR",
    currencyMention: null,
    category: "food",
    note: "Dinner",
    location: null,
    included: ["Me", "Asha", "Ben"],
    unmatchedNames: [],
    paidBy: null,
    payerMention: null,
    payerUnresolved: false,
    isPersonal: false,
    ...overrides,
  };
}

type Deferred = {
  resolve: (body: ParseResponse) => void;
  reject: (error: unknown) => void;
  requestBody: () => Record<string, unknown>;
};

/**
 * A fake fetch whose responses the test releases by hand, in any order, to
 * simulate slow or racing parse requests.
 */
export function controlledFetch() {
  const calls: Deferred[] = [];

  const fetchImpl = (_input: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({
        resolve: (body) =>
          resolve(
            new Response(JSON.stringify(body), {
              headers: { "Content-Type": "application/json" },
            }),
          ),
        reject,
        requestBody: () => JSON.parse(String(init?.body ?? "{}")),
      });
    });

  return { fetchImpl, calls };
}

/** Lets pending promise callbacks (IndexedDB, fetch) run. */
export async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
