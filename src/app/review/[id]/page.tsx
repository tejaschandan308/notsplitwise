"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { Button } from "@/components/button";
import { Chip } from "@/components/chip";
import {
  FieldHint,
  FieldLabel,
  inputClasses,
  Notice,
  SectionHeading,
  selectClasses,
} from "@/components/field";
import { MemberPill } from "@/components/member-pill";
import { StatusBadge } from "@/components/status-badge";
import { TopBar } from "@/components/top-bar";
import { amountInputHint, currencyNames, formatMoney, parseAmountInput } from "@/lib/currency";
import { categoryLabels } from "@/lib/export";
import { getExpenseState } from "@/lib/expense-state";
import { useLiveQuery, useOnline } from "@/lib/hooks";
import { parseErrorMessage, parseExpense } from "@/lib/parse-client";
import { payerMessage, type ReviewIssueField } from "@/lib/review";
import {
  addParseStat,
  addTripMember,
  deleteExpense,
  ExpenseNotFoundError,
  getExpense,
  getTrip,
  type ManualChanges,
  markExpenseReady,
  moveExpenseToDrafts,
  NotReadyError,
  saveManualEdit,
  updateRawText,
} from "@/lib/storage";
import {
  type Category,
  CURRENCY_CODES,
  type CurrencyCode,
  type Expense,
  type Trip,
} from "@/lib/types";
import {
  discardUnsavedEdit,
  forgetUnsavedEdit,
  readUnsavedEdits,
  rememberUnsavedEdit,
  supersededFields,
  unsavedDifferences,
  useUnsavedEdits,
} from "@/lib/unsaved-edits";

type TextField = "amount" | "note" | "location";
type SaveState = "idle" | "saving" | "saved" | "error";
type SettleResult = "ok" | "invalid-amount" | "failed";

const fieldNames: Partial<Record<keyof ManualChanges, string>> = {
  amount: "amount",
  amountInput: "amount",
  currency: "currency",
  category: "category",
  note: "description",
  location: "place",
  included: "people",
  unmatchedNames: "names to check",
  paidBy: "payer",
  isPersonal: "personal setting",
  splitType: "split",
};

function describeChanges(changes: ManualChanges): string {
  return [...new Set(Object.keys(changes).map((key) => fieldNames[key as keyof ManualChanges] ?? key))].join(", ");
}

/** The remembered changes for `fields` that storage doesn't have yet. */
function recoverable(
  stored: Expense,
  remembered: ManualChanges | undefined,
  fields: Array<keyof ManualChanges>,
): ManualChanges | null {
  const differences = unsavedDifferences(stored, remembered);
  const picked: ManualChanges = {};

  for (const key of fields) {
    if (key in differences) Object.assign(picked, { [key]: differences[key] });
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

function withoutKeys(current: ManualChanges, keys: ManualChanges): ManualChanges {
  const next: ManualChanges = { ...current };
  for (const key of Object.keys(keys) as Array<keyof ManualChanges>) delete next[key];
  return next;
}

const issueTargets: Record<ReviewIssueField, string> = {
  amount: "review-amount",
  currency: "review-currency",
  paidBy: "review-payer",
  included: "review-people",
  unmatchedNames: "review-unmatched",
};

function focusTarget(id: string): void {
  const element = document.getElementById(id);
  element?.scrollIntoView({ block: "center", behavior: "smooth" });
  (
    element?.matches("input, select, textarea, button")
      ? element
      : element?.querySelector<HTMLElement>("button, input, select")
  )?.focus({ preventScroll: true });
}

function withoutSavedKeys(current: ManualChanges, saved: ManualChanges): ManualChanges {
  const next: ManualChanges = { ...current };

  for (const key of Object.keys(saved) as Array<keyof ManualChanges>) {
    if (next[key] === saved[key]) delete next[key];
  }

  return next;
}

function currencyHint(expense: Expense, trip: Trip): { text: string; tone: "neutral" | "warn" } {
  if (expense.currency === null) {
    return {
      text: expense.currencyMention
        ? `The capture says “${expense.currencyMention}”. Choose which currency it was.`
        : "Choose the currency.",
      tone: "warn",
    };
  }

  switch (expense.currencySource) {
    case "legacy":
      return { text: "Assumed INR: saved before currencies were tracked. Check the capture.", tone: "neutral" };
    case "capture":
      return { text: `From the capture (“${expense.currencyMention}”).`, tone: "neutral" };
    case "manual":
      return { text: "Set by you.", tone: "neutral" };
    default:
      return {
        text:
          expense.captureCurrency === trip.currency
            ? `Trip default (${expense.captureCurrency}).`
            : `Trip default when captured (${expense.captureCurrency}).`,
        tone: "neutral",
      };
  }
}

function payerHint(expense: Expense, members: string[]): string {
  if (expense.paidBy === null) {
    return payerMessage(expense, members);
  }

  switch (expense.paidBySource) {
    case "legacy":
      return "Assumed you paid: saved before payer tracking.";
    case "capture":
      return "From the capture.";
    case "manual":
      return "Set by you.";
    default:
      return "Default. Change it if someone else paid.";
  }
}

function ReviewForm({ stored, trip }: { stored: Expense; trip: Trip }) {
  const router = useRouter();
  const online = useOnline();
  const id = stored.id;
  const [optimistic, setOptimistic] = useState<ManualChanges>({});
  const [failed, setFailed] = useState<ManualChanges | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [editing, setEditing] = useState<Partial<Record<TextField, string>>>({});
  const [rawDraft, setRawDraft] = useState<string | null>(null);
  const [rawError, setRawError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<null | "ready" | "done" | "delete" | "retry" | "drafts">(null);
  const timers = useRef<Partial<Record<TextField, number>>>({});
  const pending = useRef<ManualChanges>({});
  // Saves still running, and changes whose save failed. Refs so that Mark
  // ready / Done see the latest values, not the ones from their render.
  const inFlight = useRef(new Set<Promise<boolean>>());
  const failedRef = useRef<ManualChanges | null>(null);
  // Fields with a change from an earlier visit that never reached storage
  // (the save failed, or the page was left or closed mid-save). Only the
  // field names are fixed on open. Any edit made in this visit supersedes
  // the older change for that field (amount and unfinished amount text count
  // as one), and the values offered are always read from the current
  // write-ahead copy and storage, never from a snapshot.
  const [earlierFields, setEarlierFields] = useState<Array<keyof ManualChanges>>(
    () => Object.keys(unsavedDifferences(stored, readUnsavedEdits()[stored.id])) as Array<keyof ManualChanges>,
  );
  const remembered = useUnsavedEdits()[stored.id];
  const earlier = recoverable(stored, remembered, earlierFields);

  const expense: Expense = { ...stored, ...optimistic };
  const state = getExpenseState(expense, trip.members, online);
  const isDraft = expense.status === "draft";
  const members = trip.members;
  const amountText =
    editing.amount ?? expense.amountInput ?? (expense.amount === null ? "" : String(expense.amount));
  // Amount text that isn't valid is saved as `amountInput`, which keeps the
  // expense out of Ready; the stored amount is only the previous value.
  const amountInvalid = amountText.trim() !== "" && parseAmountInput(amountText) === null;

  // Write anything still waiting in a debounce when the screen closes.
  useEffect(() => {
    const pendingChanges = pending;
    const pendingTimers = timers;

    return () => {
      Object.values(pendingTimers.current).forEach((timer) => window.clearTimeout(timer));
      const changes = pendingChanges.current;
      if (Object.keys(changes).length > 0) {
        // Already remembered in the write-ahead copy; it stays there if this
        // last save fails, so the change can be recovered later.
        void saveManualEdit(id, changes)
          .then(() => forgetUnsavedEdit(id, changes))
          .catch(() => undefined);
      }
    };
  }, [id]);

  function updateFailed(next: (current: ManualChanges | null) => ManualChanges | null): void {
    const value = next(failedRef.current);
    failedRef.current = value && Object.keys(value).length > 0 ? value : null;
    setFailed(failedRef.current);
  }

  /** A newer edit replaces any older unsaved change to the same field. */
  function remember(changes: ManualChanges): void {
    const replaced = supersededFields(changes);
    setEarlierFields((fields) => fields.filter((field) => !replaced.includes(field)));
    rememberUnsavedEdit(id, changes);
  }

  function save(changes: ManualChanges): Promise<boolean> {
    const wasReady = stored.status === "ready";
    remember(changes);
    const run = (async () => {
      setOptimistic((current) => ({ ...current, ...changes }));
      setSaveState("saving");

      try {
        const saved = await saveManualEdit(id, changes);
        forgetUnsavedEdit(id, changes);
        setOptimistic((current) => withoutSavedKeys(current, changes));
        updateFailed((current) => (current ? withoutSavedKeys(current, changes) : null));
        setSaveState(failedRef.current ? "error" : "saved");

        if (wasReady && saved.status === "draft") {
          setActionError("Moved back to Drafts: something needs fixing before it can be exported.");
        }

        return true;
      } catch (error) {
        if (error instanceof ExpenseNotFoundError) {
          discardUnsavedEdit(id);
          router.replace("/inbox");
          return false;
        }

        // The write-ahead copy keeps these changes even if the person leaves.
        updateFailed((current) => ({ ...current, ...changes }));
        setSaveState("error");
        return false;
      }
    })();

    inFlight.current.add(run);
    void run.finally(() => inFlight.current.delete(run));

    return run;
  }

  async function flushText(): Promise<boolean> {
    Object.values(timers.current).forEach((timer) => window.clearTimeout(timer));
    timers.current = {};
    const changes = pending.current;
    pending.current = {};

    return Object.keys(changes).length > 0 ? save(changes) : true;
  }

  /**
   * Before Done or Mark ready: nothing typed may be lost or replaced by an
   * older value. Refuses while the amount box holds something that isn't a
   * valid amount, then writes pending text, waits for every save still
   * running and refuses while any change failed to save, including ones from
   * an earlier visit that weren't saved or discarded yet.
   */
  async function settleEdits(): Promise<SettleResult> {
    if (amountInvalid) {
      return "invalid-amount";
    }

    await flushText();

    while (inFlight.current.size > 0) {
      await Promise.allSettled([...inFlight.current]);
    }

    return failedRef.current || earlier ? "failed" : "ok";
  }

  function explainUnsettled(result: Exclude<SettleResult, "ok">): void {
    if (result === "invalid-amount") {
      setActionError("The amount isn’t valid yet. Fix it, or discard it to keep the previous amount.");
      focusTarget("review-amount");
    } else {
      setActionError("A change didn’t save. Save it or discard it first.");
    }
  }

  /** Drops changes whose save failed in this visit, by explicit choice. */
  function discardFailed(): void {
    const dropped = failedRef.current ?? {};
    updateFailed(() => null);
    // Only the failed values; other remembered changes stay.
    forgetUnsavedEdit(id, dropped);
    setOptimistic((current) => withoutKeys(current, dropped));
    if ("amount" in dropped || "amountInput" in dropped) {
      setEditing((current) => {
        const next = { ...current };
        delete next.amount;
        return next;
      });
    }
    setSaveState("idle");
    setActionError("");
  }

  async function saveEarlier(): Promise<void> {
    // Re-read at click time: only fields still unresolved, current values.
    const current = recoverable(stored, readUnsavedEdits()[id], earlierFields);
    if (!current) return;
    if (await save(current)) setActionError("");
  }

  function discardEarlier(): void {
    const current = recoverable(stored, readUnsavedEdits()[id], earlierFields);
    if (current) forgetUnsavedEdit(id, current);
    setEarlierFields([]);
    setActionError("");
  }

  /** Throws away amount text that isn't valid, keeping the stored amount. */
  function discardAmountText(): void {
    setEditing((current) => {
      const next = { ...current };
      delete next.amount;
      return next;
    });
    delete pending.current.amountInput;
    void save({ amountInput: null });
  }

  function queueText(field: TextField, value: string): void {
    setEditing((current) => ({ ...current, [field]: value }));
    setActionError("");

    let change: ManualChanges;

    if (field === "amount") {
      const amount = parseAmountInput(value);
      // Saved right away, valid or not, so no way of leaving the screen can
      // lose it. Text that isn't valid is kept as `amountInput` and blocks
      // Ready; the previous amount is never used in its place.
      change =
        value.trim() && amount === null
          ? { amountInput: value }
          : { amount, amountInput: null };
      pending.current = { ...pending.current, ...change };
      void flushText();
      return;
    } else if (field === "note") {
      change = { note: value };
    } else {
      change = { location: value.trim() ? value : null };
    }

    pending.current = { ...pending.current, ...change };
    remember(change);
    setOptimistic((current) => ({ ...current, ...change }));
    window.clearTimeout(timers.current[field]);
    timers.current[field] = window.setTimeout(() => void flushText(), 450);
  }

  async function finishText(field: TextField): Promise<void> {
    await flushText();
    const value = editing[field];

    // Keep an invalid amount on screen so it can be corrected.
    if (field === "amount" && value && value.trim() && parseAmountInput(value) === null) {
      return;
    }

    setEditing((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function textValue(field: TextField): string {
    if (editing[field] !== undefined) return editing[field] as string;
    if (field === "amount") return amountText;
    if (field === "note") return expense.note;
    return expense.location ?? "";
  }

  async function saveRawText(): Promise<void> {
    const text = rawDraft?.trim() ?? "";

    if (!text) {
      setRawError("The capture can’t be empty.");
      return;
    }

    try {
      await flushText();
      await updateRawText(id, text);
      setRawDraft(null);
      setRawError("");
      void parseExpense(id).catch(() => undefined);
    } catch {
      setRawError("Couldn’t save the text. It’s still here; try again.");
    }
  }

  async function retryReading(): Promise<void> {
    setBusy("retry");
    setActionError("");

    try {
      const result = await parseExpense(id, { force: true });
      if (result === "offline") setActionError("You’re offline. It will be read when you reconnect.");
    } finally {
      setBusy(null);
    }
  }

  async function markReady(): Promise<void> {
    setBusy("ready");
    setActionError("");

    try {
      const settled = await settleEdits();

      if (settled !== "ok") {
        explainUnsettled(settled);
        return;
      }

      const ready = await markExpenseReady(id);

      if (stored.parseStatus === "done") {
        await addParseStat(id, ready.editedFields).catch(() => undefined);
      }

      router.push("/inbox");
    } catch (error) {
      if (error instanceof NotReadyError) {
        setActionError(`Still to fix: ${error.issues.map((issue) => issue.label).join(", ")}.`);
        focusTarget(issueTargets[error.issues[0].field]);
      } else {
        setActionError("Couldn’t mark it ready. Your changes are kept; try again.");
      }
    } finally {
      setBusy((current) => (current === "ready" ? null : current));
    }
  }

  async function finish(): Promise<void> {
    setBusy("done");
    setActionError("");

    try {
      const settled = await settleEdits();

      if (settled !== "ok") {
        explainUnsettled(settled);
        return;
      }

      router.push(expense.status === "ready" ? "/inbox?tab=ready" : "/inbox");
    } finally {
      setBusy((current) => (current === "done" ? null : current));
    }
  }

  /**
   * The header back link stops on a known problem so it can be fixed now.
   * Other ways out (bottom navigation, browser Back) can't be stopped
   * reliably; for those the problem is already saved (`amountInput`) or kept
   * in the write-ahead copy, and the expense stays out of Ready and export.
   */
  function guardBack(event: { preventDefault: () => void }): void {
    if (amountInvalid || failedRef.current || earlier) {
      event.preventDefault();
      explainUnsettled(amountInvalid ? "invalid-amount" : "failed");
    }
  }

  async function moveToDrafts(): Promise<void> {
    setBusy("drafts");
    try {
      await moveExpenseToDrafts(id);
    } catch {
      setActionError("Couldn’t move it back to drafts. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(): Promise<void> {
    setBusy("delete");
    try {
      await deleteExpense(id);
      discardUnsavedEdit(id);
      router.push("/inbox");
    } catch {
      setActionError("Couldn’t delete it. Try again.");
      setBusy(null);
    }
  }

  async function addPersonToTrip(name: string, as: "payer" | "member"): Promise<void> {
    try {
      const updated = await addTripMember(trip.id, name);
      const added =
        updated.members.find((member) => member.toLowerCase() === name.trim().toLowerCase()) ??
        name.trim();

      if (as === "payer") {
        await save({ paidBy: added });
      } else {
        await save({
          included: expense.included.includes(added) ? expense.included : [...expense.included, added],
          unmatchedNames: expense.unmatchedNames.filter((item) => item !== name),
        });
      }
    } catch {
      setActionError(`Couldn’t add ${name} to the trip. Try again.`);
    }
  }

  function togglePerson(member: string): void {
    const next = expense.included.includes(member)
      ? expense.included.filter((name) => name !== member)
      : members.filter((name) => name === member || expense.included.includes(name));
    void save({ included: next });
  }

  function setPersonal(personal: boolean): void {
    void save(
      personal
        ? { isPersonal: true, included: members.includes("Me") ? ["Me"] : expense.included }
        : { isPersonal: false },
    );
  }

  const cHint = currencyHint(expense, trip);
  const issues = state.issues;

  return (
    <AppShell
      actionBar={
        <div className="flex flex-col gap-1.5">
          {actionError ? (
            <p className="text-sm font-medium text-danger" role="alert">
              {actionError}
            </p>
          ) : null}
          {isDraft ? (
            <Button
              className="w-full md:w-auto md:min-w-56"
              disabled={busy !== null}
              size="lg"
              onClick={() => void markReady()}
            >
              {busy === "ready"
                ? "Checking…"
                : issues.length > 0
                  ? `Mark ready (${issues.length} to fix)`
                  : "Mark ready"}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                className="flex-1 md:flex-none md:min-w-40"
                disabled={busy !== null}
                size="lg"
                onClick={() => void finish()}
              >
                {busy === "done" ? "Saving…" : "Done"}
              </Button>
              <Button
                className="flex-1 md:flex-none"
                disabled={busy !== null}
                size="lg"
                variant="secondary"
                onClick={() => void moveToDrafts()}
              >
                Back to drafts
              </Button>
            </div>
          )}
        </div>
      }
    >
      <TopBar
        back={{
          href: isDraft ? "/inbox" : "/inbox?tab=ready",
          label: "Inbox",
          onNavigate: guardBack,
        }}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Review expense</h1>
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="text-xs text-ink-3">
            {amountInvalid
              ? "Amount not saved"
              : saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "All changes saved"
                  : ""}
          </span>
          <StatusBadge kind={state.kind} label={state.label} />
        </div>
      </div>

      {saveState === "error" && failed ? (
        <Notice className="mb-5" tone="danger">
          <p className="font-semibold">Your last change didn’t save.</p>
          <p>
            It’s still shown here and kept on this device until it saves. Check that site
            storage is available, then retry, or discard it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void save(failed)}>
              Retry saving
            </Button>
            <Button size="sm" variant="ghost" onClick={discardFailed}>
              Discard change
            </Button>
          </div>
        </Notice>
      ) : null}

      {earlier && !failed ? (
        <Notice className="mb-5" tone="danger">
          <p className="font-semibold">A change from earlier wasn’t saved.</p>
          <p>
            Your edit to the {describeChanges(earlier)} didn’t reach storage before you left.
            Until you save or discard it, this expense can’t be marked ready or exported.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void saveEarlier()}>
              Save it now
            </Button>
            <Button size="sm" variant="ghost" onClick={discardEarlier}>
              Discard it
            </Button>
          </div>
        </Notice>
      ) : null}

      {isDraft && state.kind === "reading" ? (
        <Notice className="mb-5">
          <span aria-hidden="true" className="pulse-dot mr-2 inline-block size-1.5 rounded-full bg-ink-2 align-middle" />
          AI is still reading this. Anything you change here is kept.
        </Notice>
      ) : null}
      {isDraft && state.kind === "offline" ? (
        <Notice className="mb-5">Saved on this device. AI will read it when you’re back online, or fill it in now.</Notice>
      ) : null}
      {isDraft && state.kind === "failed" ? (
        <Notice className="mb-5" tone="danger">
          <p>{parseErrorMessage(expense.parseError)}</p>
          {expense.parseError !== "ai_not_configured" ? (
            <Button
              className="mt-2"
              disabled={busy === "retry"}
              size="sm"
              variant="secondary"
              onClick={() => void retryReading()}
            >
              {busy === "retry" ? "Reading…" : "Retry reading"}
            </Button>
          ) : null}
        </Notice>
      ) : null}

      <section aria-labelledby="raw-heading" className="mb-7">
        <SectionHeading
          aside={
            isDraft && rawDraft === null ? (
              <button
                className="-my-2 min-h-11 rounded-control px-2 text-xs font-semibold text-accent hover:bg-sunken"
                type="button"
                onClick={() => setRawDraft(expense.rawText)}
              >
                Correct text
              </button>
            ) : null
          }
          id="raw-heading"
        >
          You wrote
        </SectionHeading>
        {rawDraft === null ? (
          <blockquote className="rounded-control bg-sunken px-3.5 py-3 font-mono text-[0.875rem] leading-6 break-words whitespace-pre-wrap text-ink">
            {expense.rawText}
          </blockquote>
        ) : (
          <div>
            <label className="sr-only" htmlFor="review-raw">
              Capture text
            </label>
            <textarea
              autoFocus
              className={`${inputClasses} field-sizing-content min-h-24 resize-none py-3 font-mono text-[0.9375rem]`}
              id="review-raw"
              maxLength={600}
              value={rawDraft}
              onChange={(event) => {
                setRawDraft(event.target.value);
                setRawError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRawDraft(null);
              }}
            />
            <FieldHint tone={rawError ? "danger" : "neutral"}>
              {rawError || "AI reads it again. Anything you changed by hand below is kept."}
            </FieldHint>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void saveRawText()}>
                Save and re-read
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRawDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      {issues.length > 0 ? (
        <Notice className="mb-7" tone="warn">
          <h2 className="font-semibold">
            {issues.length === 1 ? "1 thing to fix" : `${issues.length} things to fix`}
          </h2>
          <ul className="mt-1">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.label}`}>
                <button
                  className="-mx-1 flex min-h-11 w-full items-start gap-2.5 rounded-control px-1 py-1.5 text-left hover:bg-warn/10"
                  type="button"
                  onClick={() => focusTarget(issueTargets[issue.field])}
                >
                  <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-warn" />
                  <span>
                    <span className="font-semibold">{issue.label}</span>{" "}
                    <span className="text-ink-2">{issue.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <section aria-labelledby="money-heading" className="mb-7">
        <SectionHeading id="money-heading">Amount</SectionHeading>
        <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2">
          <div>
            <label className="sr-only" htmlFor="review-currency">
              Currency
            </label>
            <select
              aria-describedby="review-currency-hint"
              aria-invalid={expense.currency === null}
              className={`${selectClasses} min-h-14 font-semibold ${expense.currency === null ? "border-warn" : ""}`}
              id="review-currency"
              value={expense.currency ?? ""}
              onChange={(event) =>
                event.target.value && void save({ currency: event.target.value as CurrencyCode })
              }
            >
              {expense.currency === null ? <option value="">Choose…</option> : null}
              {CURRENCY_CODES.map((code) => (
                <option key={code} title={currencyNames[code]} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="sr-only" htmlFor="review-amount">
              Amount
            </label>
            <input
              aria-describedby="review-currency-hint review-amount-hint"
              aria-invalid={amountInvalid || expense.amount === null}
              autoComplete="off"
              className={`${inputClasses} min-h-14 text-2xl font-semibold ${amountInvalid ? "border-danger" : ""}`}
              id="review-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onBlur={() => void finishText("amount")}
              onChange={(event) => queueText("amount", event.target.value)}
            />
          </div>
        </div>
        <FieldHint id="review-currency-hint" tone={cHint.tone}>
          {cHint.text}
        </FieldHint>
        {amountInvalid ? (
          <div>
            <FieldHint id="review-amount-hint" tone="danger">
              {amountInputHint} Until then this expense can’t be marked ready or exported.
            </FieldHint>
            <Button className="-ml-3 mt-1" size="sm" variant="ghost" onClick={discardAmountText}>
              {expense.amount === null
                ? `Discard “${amountText}”`
                : `Discard “${amountText}”, keep ${formatMoney(expense.amount, expense.currency)}`}
            </Button>
          </div>
        ) : null}

        <div className="mt-5">
          <FieldLabel htmlFor="review-payer">Paid by</FieldLabel>
          <select
            aria-describedby="review-payer-hint"
            aria-invalid={expense.paidBy === null}
            className={`${selectClasses} sm:max-w-xs ${expense.paidBy === null ? "border-warn" : ""}`}
            id="review-payer"
            value={expense.paidBy ?? ""}
            onChange={(event) => event.target.value && void save({ paidBy: event.target.value })}
          >
            {expense.paidBy === null || !members.includes(expense.paidBy) ? (
              <option value="">Choose who paid…</option>
            ) : null}
            {members.map((member) => (
              <option key={member} value={member}>
                {member}
              </option>
            ))}
          </select>
          <FieldHint id="review-payer-hint" tone={expense.paidBy === null ? "warn" : "neutral"}>
            {payerHint(expense, members)}
          </FieldHint>
          {expense.paidBy === null &&
          expense.payerMention &&
          !/\s(or|and|&)\s|\//i.test(expense.payerMention) &&
          !members.some((member) => member.toLowerCase() === expense.payerMention?.trim().toLowerCase()) ? (
            <Button
              className="mt-2"
              size="sm"
              variant="secondary"
              onClick={() => void addPersonToTrip(expense.payerMention as string, "payer")}
            >
              Add “{expense.payerMention}” to trip as payer
            </Button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="details-heading" className="mb-7">
        <SectionHeading id="details-heading">Details</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="review-note">Description</FieldLabel>
            <input
              autoComplete="off"
              className={inputClasses}
              id="review-note"
              maxLength={80}
              placeholder="What was it for?"
              value={textValue("note")}
              onBlur={() => void finishText("note")}
              onChange={(event) => queueText("note", event.target.value)}
            />
          </div>
          <div>
            <FieldLabel hint="Optional" htmlFor="review-location">
              Place
            </FieldLabel>
            <input
              autoComplete="off"
              className={inputClasses}
              id="review-location"
              maxLength={60}
              placeholder="Where?"
              value={textValue("location")}
              onBlur={() => void finishText("location")}
              onChange={(event) => queueText("location", event.target.value)}
            />
          </div>
        </div>
        <div className="mt-5" role="group" aria-labelledby="review-category-label">
          <FieldLabel id="review-category-label">Category</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(categoryLabels) as Category[]).map((value) => (
              <Chip
                key={value}
                label={categoryLabels[value]}
                selected={expense.category === value}
                onClick={() => void save({ category: expense.category === value ? null : value })}
              />
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="people-heading" className="mb-7" id="review-people">
        <SectionHeading
          aside={expense.isPersonal ? "Just you" : `${expense.included.length} of ${members.length}`}
          id="people-heading"
        >
          Shared by
        </SectionHeading>

        <button
          aria-checked={expense.isPersonal}
          className="mb-4 flex min-h-12 w-full items-center justify-between gap-4 rounded-control border border-rule bg-surface px-3.5 text-left"
          role="switch"
          type="button"
          onClick={() => setPersonal(!expense.isPersonal)}
        >
          <span>
            <span className="block text-[0.9375rem] font-semibold">Personal expense</span>
            <span className="block text-xs text-ink-3">Only for me, not shared</span>
          </span>
          <span
            aria-hidden="true"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${expense.isPersonal ? "bg-accent" : "bg-rule-strong"}`}
          >
            <span
              className={`absolute top-1 left-1 size-5 rounded-full bg-surface shadow transition-transform ${expense.isPersonal ? "translate-x-5" : ""}`}
            />
          </span>
        </button>

        {!expense.isPersonal ? (
          <>
            <div aria-label="People sharing this expense" className="flex flex-wrap gap-2" role="group">
              {members.map((member) => (
                <MemberPill
                  key={member}
                  name={member}
                  selected={expense.included.includes(member)}
                  onClick={() => togglePerson(member)}
                />
              ))}
            </div>
            {expense.paidBy && !expense.included.includes(expense.paidBy) ? (
              <FieldHint>
                {expense.paidBy} paid but isn’t sharing, so they’re owed the full amount.
              </FieldHint>
            ) : null}
          </>
        ) : null}

        {expense.unmatchedNames.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3" id="review-unmatched">
            {expense.unmatchedNames.map((name) => (
              <div key={name} className="rounded-control border border-warn/40 bg-warn-soft px-3.5 py-3">
                <p className="text-sm font-semibold text-ink">
                  “{name}” isn’t on this trip. Who is it?
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {members.map((member) => (
                    <Button
                      key={member}
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void save({
                          included: expense.included.includes(member)
                            ? expense.included
                            : [...expense.included, member],
                          unmatchedNames: expense.unmatchedNames.filter((item) => item !== name),
                        })
                      }
                    >
                      {member}
                    </Button>
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => void addPersonToTrip(name, "member")}>
                    Add {name} to trip
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void save({ unmatchedNames: expense.unmatchedNames.filter((item) => item !== name) })
                    }
                  >
                    Not a person, ignore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {!expense.isPersonal ? (
        <section aria-labelledby="split-heading" className="mb-7">
          <SectionHeading id="split-heading">Split</SectionHeading>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Split type">
            <Chip
              label="Equal"
              selected={expense.splitType === "equal"}
              onClick={() => void save({ splitType: "equal" })}
            />
            <Chip
              label="Custom, enter later"
              selected={expense.splitType === "custom"}
              onClick={() => void save({ splitType: "custom" })}
            />
          </div>
          <FieldHint>
            {expense.splitType === "custom"
              ? "Shares aren’t calculated here. The export marks it as a custom split so you can enter each share in Splitwise."
              : `Split equally between ${expense.included.length} ${expense.included.length === 1 ? "person" : "people"}.`}
          </FieldHint>
        </section>
      ) : null}

      <section className="border-t border-rule pt-4">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
            <p className="mr-2 text-sm font-semibold">Delete this expense for good?</p>
            <Button disabled={busy === "delete"} size="sm" variant="danger" onClick={() => void remove()}>
              {busy === "delete" ? "Deleting…" : "Delete"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <Button className="-ml-3" size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete expense
          </Button>
        )}
      </section>
    </AppShell>
  );
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: stored, isLoading } = useLiveQuery(() => getExpense(id), [id]);
  const tripId = stored?.tripId;
  const { data: trip } = useLiveQuery(
    async () => (tripId ? getTrip(tripId) : undefined),
    [tripId],
  );

  if (!isLoading && !stored) {
    return (
      <AppShell>
        <TopBar back={{ href: "/inbox", label: "Inbox" }} />
        <h1 className="text-2xl font-semibold">Expense not found</h1>
        <p className="mt-2 text-sm text-ink-2">
          It may have been deleted, or it was saved in a different browser.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
          href="/inbox"
        >
          Back to inbox
        </Link>
      </AppShell>
    );
  }

  if (!stored || !trip) {
    return (
      <AppShell>
        <p className="pt-24 text-center text-sm text-ink-3" role="status">
          Loading…
        </p>
      </AppShell>
    );
  }

  return <ReviewForm key={stored.id} stored={stored} trip={trip} />;
}
