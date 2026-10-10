import { type BrowserContext, expect, type Page, test as base } from "@playwright/test";

type StoredExpense = {
  id: string;
  rawText: string;
  amount: number | null;
  amountInput?: string | null;
  note: string;
  status: string;
  parseStatus: string;
};

/**
 * A fake reader for /api/parse: the first number is the amount, the rest is
 * the note, everyone shares, nobody is named as payer. Synthetic and local.
 */
async function mockParse(context: BrowserContext): Promise<void> {
  await context.route("**/api/parse", async (route) => {
    const body = route.request().postDataJSON() as {
      rawText: string;
      members: string[];
      tripCurrency: string;
    };
    const amount = Number(body.rawText.match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);

    await route.fulfill({
      json: {
        ok: true,
        data: {
          amount: Number.isFinite(amount) ? amount : null,
          currency: body.tripCurrency,
          currencyMention: null,
          category: "food",
          note: body.rawText.replace(/\d+(?:\.\d+)?/, "").trim(),
          location: null,
          included: body.members,
          unmatchedNames: [],
          paidBy: null,
          payerMention: null,
          payerUnresolved: false,
          isPersonal: false,
        },
      },
    });
  });
}

/**
 * Lets a test make IndexedDB writes fail, like a full or blocked disk.
 * `window.__failWrites = true` makes every put/add throw.
 */
async function installWriteFailureSwitch(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const flags = window as unknown as { __failWrites?: boolean };
    for (const method of ["put", "add"] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
        if (flags.__failWrites) {
          throw new DOMException("Simulated storage failure", "QuotaExceededError");
        }
        return original.apply(this, args);
      } as typeof original;
    }
  });
}

export const test = base.extend({
  context: async ({ context }, provide) => {
    await mockParse(context);
    await installWriteFailureSwitch(context);
    await provide(context);
  },
});

export { expect };

/** Reads every stored expense straight from IndexedDB. */
export async function storedExpenses(page: Page): Promise<StoredExpense[]> {
  return page.evaluate(
    () =>
      new Promise<StoredExpense[]>((resolve, reject) => {
        const open = indexedDB.open("log-now-split-later");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result
            .transaction("expenses", "readonly")
            .objectStore("expenses")
            .getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result as StoredExpense[]);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

export async function storedExpense(page: Page, id: string): Promise<StoredExpense | undefined> {
  return (await storedExpenses(page)).find((expense) => expense.id === id);
}

/** Writes fields into a stored expense directly, like another writer would. */
export async function patchStoredExpense(
  page: Page,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ id, patch }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("log-now-split-later");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("expenses", "readwrite");
          const store = tx.objectStore("expenses");
          const get = store.get(id);
          get.onsuccess = () => store.put({ ...get.result, ...patch });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { id, patch },
  );
}

export async function startTrip(page: Page): Promise<void> {
  await page.goto("/trip/new");
  await page.fill("#trip-name", "E2E trip");
  for (const name of ["Asha", "Ben"]) {
    await page.fill("#trip-person", name);
    await page.press("#trip-person", "Enter");
  }
  await page.getByRole("button", { name: "Start trip" }).click();
  await page.waitForURL("**/capture");
}

/** Saves a capture and waits until the (mocked) reading has been applied. */
export async function captureDraft(page: Page, text: string): Promise<string> {
  if (!page.url().endsWith("/capture")) await page.goto("/capture");
  await page.fill("#capture-text", text);
  await page.getByRole("button", { name: "Save expense" }).click();

  let id = "";
  await expect
    .poll(async () => {
      const match = (await storedExpenses(page)).find(
        (expense) => expense.rawText === text && expense.parseStatus === "done",
      );
      id = match?.id ?? "";
      return id;
    })
    .not.toBe("");

  return id;
}

export async function makeReady(page: Page, text: string): Promise<string> {
  const id = await captureDraft(page, text);
  await page.goto(`/review/${id}`);
  await page.getByRole("button", { name: "Mark ready", exact: true }).click();
  await page.waitForURL(/\/inbox/);
  await expect.poll(async () => (await storedExpense(page, id))?.status).toBe("ready");

  return id;
}
