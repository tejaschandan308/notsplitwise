import type { Page } from "@playwright/test";
import { expect, makeReady, startTrip, storedExpense, test } from "./fixtures";

function mainNavInbox(page: Page) {
  return page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Inbox/ });
}

function failWrites(page: Page, value: boolean) {
  return page.evaluate((on) => {
    (window as unknown as { __failWrites: boolean }).__failWrites = on;
  }, value);
}

async function exportAllReady(page: Page): Promise<string> {
  await page.goto("/inbox?tab=ready");
  await page.getByRole("checkbox", { name: /^Select all/ }).check();
  await page.getByRole("button", { name: "Export" }).click();
  const text = await page.locator("#export-text").inputValue();
  await page.keyboard.press("Escape");
  return text;
}

/** Ready 1200 dinner, with an amount edit (and optionally a note) that failed to save. */
async function failedEditThenLeave(page: Page, opts: { note?: string } = {}) {
  await startTrip(page);
  const dinner = await makeReady(page, "1200 dinner");
  await page.goto(`/review/${dinner}`);

  await failWrites(page, true);
  await page.fill("#review-amount", "1300");
  if (opts.note) {
    await page.fill("#review-note", opts.note);
    await page.locator("#review-note").blur();
  }
  await expect(page.getByText("Your last change didn’t save.")).toBeVisible();
  await mainNavInbox(page).click();
  await page.waitForURL(/\/inbox/);

  return dinner;
}

const earlierNotice = (page: Page) => page.getByText("A change from earlier wasn’t saved.");

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test.describe("a newer saved correction always beats an older unsaved one", () => {
  test("failed 1300, then 1400 saved: 1300 can't be restored; Done and export use 1400", async ({ page }) => {
    const dinner = await failedEditThenLeave(page);
    await failWrites(page, false);

    await page.goto(`/review/${dinner}`);
    await expect(earlierNotice(page)).toBeVisible();

    await page.fill("#review-amount", "1400");
    await expect.poll(async () => (await storedExpense(page, dinner))?.amount).toBe(1400);
    await expect(page.getByText("All changes saved")).toBeVisible();
    // The older 1300 is no longer offered.
    await expect(earlierNotice(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save it now" })).toHaveCount(0);

    // Not offered again on a fresh load either.
    await page.reload();
    await expect(page.locator("#review-amount")).toHaveValue("1400");
    await expect(earlierNotice(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/\/inbox/);
    expect(await storedExpense(page, dinner)).toMatchObject({ status: "ready", amount: 1400 });
    const text = await exportAllReady(page);
    expect(text).toContain("INR 1,400");
    expect(text).not.toContain("1,300");
  });

  test("amount corrected, other field recovered: the newer amount stays", async ({ page }) => {
    const dinner = await failedEditThenLeave(page, { note: "Team dinner" });
    await failWrites(page, false);

    await page.goto(`/review/${dinner}`);
    await expect(earlierNotice(page)).toBeVisible();
    await expect(page.getByText(/Your edit to the amount, description/)).toBeVisible();

    await page.fill("#review-amount", "1400");
    await expect.poll(async () => (await storedExpense(page, dinner))?.amount).toBe(1400);
    // Only the description is still waiting.
    await expect(page.getByText(/Your edit to the description didn’t reach storage/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("p[role='alert']")).toContainText("A change didn’t save");

    await page.getByRole("button", { name: "Save it now" }).click();
    await expect(earlierNotice(page)).toHaveCount(0);
    await expect
      .poll(async () => storedExpense(page, dinner))
      .toMatchObject({ amount: 1400, note: "Team dinner", status: "ready" });

    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/\/inbox/);
    const text = await exportAllReady(page);
    expect(text).toContain("Team dinner");
    expect(text).toContain("INR 1,400");
    expect(text).not.toContain("1,300");
  });

  test("a newer correction that also fails keeps recovery and blocks Ready and export", async ({ page }) => {
    const dinner = await failedEditThenLeave(page);

    // Storage is still failing when Review is reopened.
    await page.getByRole("tab", { name: /Ready/ }).click();
    await page.getByRole("link", { name: /dinner/ }).click();
    await expect(earlierNotice(page)).toBeVisible();
    await page.fill("#review-amount", "1400");
    await expect(page.getByText("Your last change didn’t save.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("p[role='alert']")).toContainText("A change didn’t save");
    expect(await storedExpense(page, dinner)).toMatchObject({ status: "ready", amount: 1200 });

    // Not exportable at the stored 1200.
    await mainNavInbox(page).click();
    await page.getByRole("tab", { name: /Ready/ }).click();
    await expect(page.getByText("Unsaved change on this device")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Select dinner/ })).toBeDisabled();

    // Storage works again: the newest change (1400) is the one offered.
    await failWrites(page, false);
    await page.getByRole("link", { name: /dinner/ }).click();
    await expect(earlierNotice(page)).toBeVisible();
    await page.getByRole("button", { name: "Save it now" }).click();
    await expect
      .poll(async () => storedExpense(page, dinner))
      .toMatchObject({ status: "ready", amount: 1400 });
    await expect(page.locator("#review-amount")).toHaveValue("1400");

    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/\/inbox/);
    expect(await exportAllReady(page)).toContain("INR 1,400");
  });
});
