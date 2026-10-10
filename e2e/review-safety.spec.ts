import {
  captureDraft,
  expect,
  makeReady,
  patchStoredExpense,
  startTrip,
  storedExpense,
  test,
} from "./fixtures";

test.describe("Review never marks or keeps a stale amount", () => {
  test("invalid amount text blocks Mark ready, keeps the text and focuses the field", async ({ page }) => {
    await startTrip(page);
    const id = await captureDraft(page, "1200 dinner");
    await page.goto(`/review/${id}`);

    const amount = page.locator("#review-amount");
    await expect(amount).toHaveValue("1200");
    await amount.fill("oops");
    await page.getByRole("button", { name: /^Mark ready/ }).click();

    await expect(page.locator("p[role='alert']")).toContainText("The amount isn’t valid yet");
    await expect(amount).toBeFocused();
    await expect(amount).toHaveValue("oops");
    await expect(page).toHaveURL(new RegExp(`/review/${id}$`));
    // The old 1200 was not marked ready in place of the edit; the typed text
    // is kept with the expense.
    expect(await storedExpense(page, id)).toMatchObject({
      status: "draft",
      amount: 1200,
      amountInput: "oops",
    });

    await amount.fill("1300");
    await page.getByRole("button", { name: /^Mark ready/ }).click();
    await page.waitForURL(/\/inbox/);
    expect(await storedExpense(page, id)).toMatchObject({ status: "ready", amount: 1300 });
  });

  test("invalid amount text on a Ready expense blocks Done / Mark ready and the back link", async ({ page }) => {
    await startTrip(page);
    const id = await makeReady(page, "1200 dinner");
    await page.goto(`/review/${id}`);

    const amount = page.locator("#review-amount");
    await amount.fill("12o0");
    // Saving the text moves it to Drafts, so the action may already read
    // Mark ready instead of Done; both must refuse.
    await page.getByRole("button", { name: /^(Done|Mark ready)/ }).click();
    await expect(page.locator("p[role='alert']")).toContainText("The amount isn’t valid yet");
    await expect(amount).toBeFocused();

    await page.locator("header").getByRole("link", { name: "Inbox" }).click();
    await expect(page).toHaveURL(new RegExp(`/review/${id}$`));
    await expect(amount).toHaveValue("12o0");
    await expect
      .poll(async () => storedExpense(page, id))
      .toMatchObject({ status: "draft", amount: 1200, amountInput: "12o0" });
  });

  test("a failed save blocks Mark ready until it is saved", async ({ page }) => {
    await startTrip(page);
    const id = await captureDraft(page, "1200 dinner");
    await page.goto(`/review/${id}`);
    await expect(page.locator("#review-amount")).toHaveValue("1200");

    await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = true));
    await page.fill("#review-note", "Team dinner");
    await page.locator("#review-note").blur();
    await expect(page.getByText("Your last change didn’t save.")).toBeVisible();

    // Storage works again, but the earlier edit is still unsaved.
    await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = false));
    await page.getByRole("button", { name: /^Mark ready/ }).click();
    await expect(page.locator("p[role='alert']")).toContainText("A change didn’t save");
    await expect(page).toHaveURL(new RegExp(`/review/${id}$`));
    expect(await storedExpense(page, id)).toMatchObject({ status: "draft", note: "dinner" });

    await page.getByRole("button", { name: "Retry saving" }).click();
    await expect(page.getByText("All changes saved")).toBeVisible();
    await page.getByRole("button", { name: /^Mark ready/ }).click();
    await page.waitForURL(/\/inbox/);
    expect(await storedExpense(page, id)).toMatchObject({ status: "ready", note: "Team dinner" });
  });

  test("clearing the amount of a Ready expense moves it back to Drafts", async ({ page }) => {
    await startTrip(page);
    const id = await makeReady(page, "1200 dinner");
    await page.goto(`/review/${id}`);

    await page.fill("#review-amount", "");
    await expect.poll(async () => (await storedExpense(page, id))?.status).toBe("draft");
    await expect(page.locator("p[role='alert']")).toContainText("Moved back to Drafts");
    await expect(page.getByRole("button", { name: /^Mark ready \(1 to fix\)/ })).toBeVisible();
  });
});

test.describe("Export only includes expenses that are still valid", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("a selected Ready expense invalidated in another tab is dropped from export", async ({ page, context }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");
    await makeReady(page, "300 taxi");

    await page.goto("/inbox?tab=ready");
    await page.getByRole("checkbox", { name: /^Select dinner/ }).check();
    await page.getByRole("checkbox", { name: /^Select taxi/ }).check();
    await expect(page.getByText("2 selected")).toBeVisible();

    const other = await context.newPage();
    await other.goto(`/review/${dinner}`);
    await other.fill("#review-amount", "");
    await expect.poll(async () => (await storedExpense(other, dinner))?.status).toBe("draft");

    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Export 1 expense");
    await expect(page.locator("#export-text")).not.toHaveValue(/dinner/);

    await dialog.getByRole("button", { name: "Copy text" }).click();
    await expect(dialog).toContainText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("taxi");
    expect(copied).not.toContain("dinner");
  });

  test("an expense invalidated while the export dialog is open is left out and not copied", async ({ page, context }) => {
    await startTrip(page);
    const dinner = await makeReady(page, "1200 dinner");
    await makeReady(page, "300 taxi");

    await page.goto("/inbox?tab=ready");
    await page.getByRole("checkbox", { name: /^Select all/ }).check();
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Export 2 expenses");

    // Another writer leaves the record marked Ready but invalid, without the
    // app's change notifications, so the open dialog still shows old text.
    // Copy must re-check storage instead of trusting the selection.
    const other = await context.newPage();
    await other.goto("/inbox");
    await patchStoredExpense(other, dinner, { amount: null });
    await expect(page.locator("#export-text")).toHaveValue(/dinner/);

    await dialog.getByRole("button", { name: "Copy text" }).click();
    await expect(dialog).toContainText("Nothing was copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain("dinner");

    await expect(dialog).toContainText("Export 1 expense");
    await expect(page.locator("#export-text")).not.toHaveValue(/dinner/);
    await expect(dialog).toContainText("1 expense was left out");
    await dialog.getByRole("button", { name: "Copy text" }).click();
    await expect(dialog).toContainText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("taxi");
    expect(copied).not.toContain("dinner");
  });
});

test("the temporary /dev screen is not served in production", async ({ page }) => {
  const response = await page.goto("/dev");
  expect(response?.status()).toBe(404);
});
