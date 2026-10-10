import type { Page } from "@playwright/test";
import { expect, makeReady, startTrip, storedExpense, test } from "./fixtures";

/** The main bottom navigation (phones), not the Review header link. */
function mainNavInbox(page: Page) {
  return page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Inbox/ });
}

function failWrites(page: Page, value: boolean) {
  return page.evaluate((on) => {
    (window as unknown as { __failWrites: boolean }).__failWrites = on;
  }, value);
}

/** Selects every exportable Ready expense and returns the export text. */
async function exportAllReady(page: Page): Promise<string> {
  await page.goto("/inbox?tab=ready");
  await page.getByRole("checkbox", { name: /^Select all/ }).check();
  await page.getByRole("button", { name: "Export" }).click();
  const text = await page.locator("#export-text").inputValue();
  await page.keyboard.press("Escape");
  return text;
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test.describe("leaving Review never keeps a stale exportable amount", () => {
  test("Ready -> invalid edit -> bottom navigation -> export, then recovery", async ({ page }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");
    await makeReady(page, "300 taxi");
    await page.goto(`/review/${dinner}`);

    await page.fill("#review-amount", "12o0");
    await mainNavInbox(page).click();
    await page.waitForURL(/\/inbox/);

    await expect
      .poll(async () => storedExpense(page, dinner))
      .toMatchObject({ status: "draft", amount: 1200, amountInput: "12o0" });

    // Not exportable at the old 1200: only the taxi goes out.
    const text = await exportAllReady(page);
    expect(text).toContain("taxi");
    expect(text).not.toContain("dinner");
    expect(text).not.toContain("1,200");

    // The Drafts list says what's wrong.
    await page.goto("/inbox");
    await expect(page.getByText(/To fix: Amount not valid/)).toBeVisible();

    // The typed text is still there to correct.
    await page.goto(`/review/${dinner}`);
    await expect(page.locator("#review-amount")).toHaveValue("12o0");
    await page.fill("#review-amount", "1250");
    await expect.poll(async () => (await storedExpense(page, dinner))?.amountInput ?? null).toBeNull();
    // It must be marked ready again explicitly.
    expect((await storedExpense(page, dinner))?.status).toBe("draft");
    await page.getByRole("button", { name: "Mark ready", exact: true }).click();
    await page.waitForURL(/\/inbox/);

    expect(await exportAllReady(page)).toContain("INR 1,250");
  });

  test("browser Back keeps the invalid text; discarding needs Mark ready again", async ({ page }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");

    // Open Review by client-side navigation so Back is an in-app history step.
    await page.goto("/inbox?tab=ready");
    await page.getByRole("link", { name: /dinner/ }).click();
    await page.waitForURL(new RegExp(`/review/${dinner}$`));

    await page.fill("#review-amount", "12o0");
    await page.goBack();
    await page.waitForURL(/\/inbox/);

    await expect
      .poll(async () => storedExpense(page, dinner))
      .toMatchObject({ status: "draft", amountInput: "12o0" });
    await page.goto("/inbox?tab=ready");
    await expect(page.getByRole("checkbox", { name: /^Select dinner/ })).toHaveCount(0);

    await page.goto(`/review/${dinner}`);
    await expect(page.locator("#review-amount")).toHaveValue("12o0");
    await page.getByRole("button", { name: /^Discard “12o0”, keep INR 1,200/ }).click();
    await expect(page.locator("#review-amount")).toHaveValue("1200");
    await expect
      .poll(async () => storedExpense(page, dinner))
      .toMatchObject({ status: "draft", amount: 1200, amountInput: null });

    await page.getByRole("button", { name: "Mark ready", exact: true }).click();
    await page.waitForURL(/\/inbox/);
    expect((await storedExpense(page, dinner))?.status).toBe("ready");
  });

  test("browser Back straight after typing, across a full page load, never leaves the old amount exportable", async ({ page }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");
    await page.goto(`/review/${dinner}`);

    await page.fill("#review-amount", "12o0");
    await page.goBack();
    await page.waitForURL(/\/inbox/);

    // Either the save finished (stored as unresolved text) or it was cut off
    // (kept in the write-ahead copy). In both cases it isn't exportable.
    await page.goto("/inbox?tab=ready");
    const checkbox = page.getByRole("checkbox", { name: /^Select dinner/ });
    if ((await checkbox.count()) > 0) await expect(checkbox).toBeDisabled();

    await page.goto(`/review/${dinner}`);
    const notice = page.getByText("A change from earlier wasn’t saved.");
    if (await notice.isVisible()) {
      await page.getByRole("button", { name: "Save it now" }).click();
    }
    await expect(page.locator("#review-amount")).toHaveValue("12o0");
  });

  test("a failed save survives navigation and can be saved later", async ({ page }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");
    await makeReady(page, "300 taxi");
    await page.goto(`/review/${dinner}`);

    await failWrites(page, true);
    await page.fill("#review-amount", "1300");
    await expect(page.getByText("Your last change didn’t save.")).toBeVisible();
    await mainNavInbox(page).click();
    await page.waitForURL(/\/inbox/);

    // Stored is still Ready at 1200, but the unsaved 1300 keeps it out.
    expect(await storedExpense(page, dinner)).toMatchObject({ status: "ready", amount: 1200 });
    await page.getByRole("tab", { name: /Ready/ }).click();
    await expect(page.getByText("Unsaved change on this device")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Select dinner/ })).toBeDisabled();
    await page.getByRole("checkbox", { name: /^Select all/ }).check();
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.locator("#export-text")).not.toHaveValue(/dinner/);
    await page.keyboard.press("Escape");

    // Storage works again: the change is offered on the next visit.
    await failWrites(page, false);
    await page.getByRole("link", { name: /dinner/ }).click();
    await expect(page.getByText("A change from earlier wasn’t saved.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("p[role='alert']")).toContainText("A change didn’t save");

    await page.getByRole("button", { name: "Save it now" }).click();
    await expect(page.getByText("A change from earlier wasn’t saved.")).toHaveCount(0);
    await expect
      .poll(async () => storedExpense(page, dinner))
      .toMatchObject({ status: "ready", amount: 1300 });
    expect(await exportAllReady(page)).toContain("INR 1,300");
  });

  test("a failed save can be explicitly discarded", async ({ page }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");
    await page.goto(`/review/${dinner}`);

    await failWrites(page, true);
    await page.fill("#review-amount", "1300");
    await expect(page.getByText("Your last change didn’t save.")).toBeVisible();
    await failWrites(page, false);
    await page.getByRole("button", { name: "Discard change" }).click();

    await expect(page.locator("#review-amount")).toHaveValue("1200");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/\/inbox/);
    expect(await exportAllReady(page)).toContain("INR 1,200");
  });
});

test.describe("amount separators", () => {
  test("a decimal comma edit keeps its value; ambiguous input is refused", async ({ page }) => {
    await startTrip(page);
    const coffee = await makeReady(page, "12.50 coffee");
    await page.goto(`/review/${coffee}`);
    await expect(page.locator("#review-amount")).toHaveValue("12.5");

    await page.fill("#review-amount", "12,50");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/\/inbox/);
    expect(await storedExpense(page, coffee)).toMatchObject({ status: "ready", amount: 12.5 });
    expect(await exportAllReady(page)).toContain("INR 12.50");

    await page.goto(`/review/${coffee}`);
    await expect(page.locator("#review-amount")).toHaveValue("12.5");
    await page.fill("#review-amount", "1,2");
    await expect(page.locator("#review-amount-hint")).toContainText("like 1240, 1,240, 12.50 or 12,50");
    await page.getByRole("button", { name: /^(Done|Mark ready)/ }).click();
    await expect(page.locator("p[role='alert']")).toContainText("The amount isn’t valid yet");
    await expect
      .poll(async () => storedExpense(page, coffee))
      .toMatchObject({ status: "draft", amount: 12.5, amountInput: "1,2" });
  });

  test("ordinary input still works: 1,240 and 1240.5", async ({ page }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");
    await page.goto(`/review/${dinner}`);

    await page.fill("#review-amount", "1,240");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/\/inbox/);
    expect(await storedExpense(page, dinner)).toMatchObject({ status: "ready", amount: 1240 });

    await page.goto(`/review/${dinner}`);
    await page.fill("#review-amount", "1240.5");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/\/inbox/);
    expect(await storedExpense(page, dinner)).toMatchObject({ status: "ready", amount: 1240.5 });
    expect(await exportAllReady(page)).toContain("INR 1,240.50");
  });
});
