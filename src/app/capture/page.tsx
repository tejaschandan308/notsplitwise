"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { Button } from "@/components/button";
import { FieldHint, inputClasses, selectClasses } from "@/components/field";
import { MemberPill } from "@/components/member-pill";
import { TopBar, useActiveTrip } from "@/components/top-bar";
import { formatMoney } from "@/lib/currency";
import { describeExpense } from "@/lib/export";
import { getExpenseState } from "@/lib/expense-state";
import { useLiveQuery, useOnline } from "@/lib/hooks";
import { parseErrorMessage, parseExpense } from "@/lib/parse-client";
import { mentionsPayment } from "@/lib/payer";
import {
  addDraftExpense,
  addTripMember,
  getExpense,
  requestPersistentStorage,
} from "@/lib/storage";
import type { Trip } from "@/lib/types";

const persistRequestedKey = "log-now:persistent-storage-requested";

function requestPersistenceOnce(): void {
  try {
    if (window.localStorage.getItem(persistRequestedKey) === "true") return;
    window.localStorage.setItem(persistRequestedKey, "true");
  } catch {
    return;
  }

  void requestPersistentStorage().catch(() => undefined);
}

function LastSaved({ id, trip }: { id: string; trip: Trip }) {
  const online = useOnline();
  const { data: expense, isLoading } = useLiveQuery(() => getExpense(id), [id]);

  if (isLoading) return null;

  if (!expense) {
    return <p className="text-sm text-ink-2">The last capture was deleted.</p>;
  }

  const state = getExpenseState(expense, trip.members, online);
  let detail: string;

  switch (state.kind) {
    case "reading":
      detail = "AI is reading it. Keep capturing.";
      break;
    case "offline":
      detail = "Offline: AI reads it when you reconnect.";
      break;
    case "failed":
      detail = parseErrorMessage(expense.parseError);
      break;
    case "review":
      detail = `Read as ${formatMoney(expense.amount, expense.currency)}. To check: ${state.issues
        .map((issue) => issue.label)
        .join(", ")}.`;
      break;
    default:
      detail = `Read as ${formatMoney(expense.amount, expense.currency)} · ${describeExpense(expense)}.`;
  }

  return (
    <div className="rise-in flex min-h-11 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[0.6875rem] text-accent-ink"
      >
        ✓
      </span>
      <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 text-ink-2">
        <span className="font-semibold text-ink">Saved on this device.</span>{" "}
        {detail}
      </p>
      <Link
        className="flex min-h-11 shrink-0 items-center rounded-control px-2 text-sm font-semibold text-accent underline-offset-4 hover:underline"
        href={`/review/${expense.id}`}
      >
        Review
      </Link>
    </div>
  );
}

export default function CapturePage() {
  const router = useRouter();
  const formId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const memberInputRef = useRef<HTMLInputElement>(null);
  const { data: trip, isLoading } = useActiveTrip();
  const [rawText, setRawText] = useState("");
  // null = untouched: everyone by default, and the AI may narrow it.
  const [selected, setSelected] = useState<string[] | null>(null);
  // null = untouched: Me by default, unless the note says who paid.
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [memberMessage, setMemberMessage] = useState("");

  useEffect(() => {
    if (!isLoading && !trip) {
      router.replace("/trip/new");
    }
  }, [isLoading, trip, router]);

  useEffect(() => {
    if (isAddingMember) memberInputRef.current?.focus();
  }, [isAddingMember]);

  if (!trip) {
    return (
      <AppShell>
        <p className="pt-24 text-center text-sm text-ink-3" role="status">
          Loading…
        </p>
      </AppShell>
    );
  }

  const members = trip.members;
  const effectiveSelection = selected ?? members;
  const notePaysSomeone = mentionsPayment(rawText);
  const allSelected = members.every((member) => effectiveSelection.includes(member));

  function toggleMember(member: string): void {
    const base = selected ?? members;

    setSelected(
      base.includes(member)
        ? base.filter((name) => name !== member)
        : members.filter((name) => name === member || base.includes(name)),
    );
  }

  function toggleEveryone(): void {
    setSelected(allSelected ? members.filter((member) => member === "Me") : [...members]);
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!trip || !memberName.trim()) {
      setMemberMessage("Type a name first.");
      return;
    }

    try {
      const updated = await addTripMember(trip.id, memberName);
      const added = updated.members.filter((member) => !members.includes(member));

      if (added.length === 0) {
        setMemberMessage("They’re already on this trip.");
        return;
      }

      if (selected) setSelected([...selected, ...added]);
      setMemberName("");
      setMemberMessage("");
      setIsAddingMember(false);
      inputRef.current?.focus();
    } catch {
      setMemberMessage("Couldn’t add them. Try again.");
    }
  }

  async function handleSave(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();

    const capture = rawText.trim();

    if (!trip || isSaving) return;

    if (!capture) {
      setError("Type what you spent first.");
      inputRef.current?.focus();
      return;
    }

    if (selected && selected.length === 0) {
      setError("Choose at least one person, or tap Everyone.");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const draft = await addDraftExpense(trip.id, capture, {
        lockedIncluded: selected ?? undefined,
        paidBy: paidBy ?? undefined,
      });

      setRawText("");
      setSelected(null);
      setPaidBy(null);
      setLastSavedId(draft.id);
      requestPersistenceOnce();
      // Saved first; the AI reads it in the background.
      void parseExpense(draft.id).catch(() => undefined);
    } catch {
      setError("Couldn’t save on this device. Your text is still here; try again.");
    } finally {
      setIsSaving(false);
      inputRef.current?.focus();
    }
  }

  return (
    <AppShell
      actionBar={
        <div>
          <div aria-live="polite">
            {lastSavedId ? <LastSaved id={lastSavedId} trip={trip} /> : null}
          </div>
          <div className="flex items-center gap-3">
            <Button
              className="w-full md:w-auto md:min-w-48"
              disabled={isSaving}
              form={formId}
              size="lg"
              type="submit"
            >
              {isSaving ? "Saving…" : "Save expense"}
            </Button>
            <p className="hidden text-xs text-ink-3 md:block">
              or press <kbd className="font-sans font-semibold">Ctrl</kbd> +{" "}
              <kbd className="font-sans font-semibold">Enter</kbd>
            </p>
          </div>
        </div>
      }
    >
      <TopBar
        actions={
          <button
            aria-expanded={isAddingMember}
            aria-label="Add a person to this trip"
            className="flex size-11 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
            title="Add a person to this trip"
            type="button"
            onClick={() => {
              setMemberMessage("");
              setIsAddingMember((value) => !value);
            }}
          >
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
              <path
                d="M14.5 19.5v-1.25a4.25 4.25 0 0 0-4.25-4.25H6.5a4.25 4.25 0 0 0-4.25 4.25v1.25M8.38 10a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM18.5 7v6M15.5 10h6"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              />
            </svg>
          </button>
        }
      />

      {isAddingMember ? (
        <form
          aria-label="Add a person to this trip"
          className="rise-in mb-5 rounded-xl border border-rule bg-surface p-3"
          onSubmit={handleAddMember}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsAddingMember(false);
              inputRef.current?.focus();
            }
          }}
        >
          <label className="mb-1.5 block text-sm font-semibold" htmlFor="new-member">
            Add someone to {trip.name}
          </label>
          <div className="flex gap-2">
            <input
              ref={memberInputRef}
              autoCapitalize="words"
              autoComplete="off"
              className={`${inputClasses} min-w-0 flex-1`}
              id="new-member"
              maxLength={40}
              placeholder="Name"
              value={memberName}
              onChange={(event) => {
                setMemberName(event.target.value);
                setMemberMessage("");
              }}
            />
            <Button className="min-h-12" type="submit" variant="secondary">
              Add
            </Button>
          </div>
          {memberMessage ? <FieldHint tone="warn">{memberMessage}</FieldHint> : null}
        </form>
      ) : null}

      <form id={formId} noValidate onSubmit={handleSave}>
        <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="capture-text">
          What did you spend?
        </label>
        <textarea
          ref={inputRef}
          aria-describedby="capture-hint"
          autoFocus
          className={`${inputClasses} field-sizing-content block max-h-64 min-h-28 resize-none py-3 text-lg leading-7`}
          enterKeyHint="enter"
          id="capture-text"
          maxLength={600}
          placeholder="1240 lunch at the airport, Asha paid, me + Ben"
          value={rawText}
          onChange={(event) => {
            setRawText(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void handleSave();
            }
          }}
        />
        <FieldHint id="capture-hint">
          Type it, or use the dictation mic on your keyboard. Amount, what, and
          who is plenty; fix details later.
        </FieldHint>

        <fieldset className="mt-6">
          <legend className="mb-2 flex w-full items-baseline justify-between gap-3 text-sm font-semibold text-ink">
            Shared with
            <span className="text-xs font-normal text-ink-3">
              {selected ? "Your choice is kept" : "Everyone, unless the note says"}
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <MemberPill
                key={member}
                name={member}
                selected={effectiveSelection.includes(member)}
                onClick={() => toggleMember(member)}
              />
            ))}
            <button
              className="min-h-11 rounded-full px-3 text-sm font-semibold text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink"
              type="button"
              onClick={toggleEveryone}
            >
              {allSelected ? "Just me" : "Everyone"}
            </button>
          </div>
        </fieldset>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="text-sm font-semibold text-ink" htmlFor="capture-payer">
            Paid by
          </label>
          <select
            aria-describedby="capture-payer-hint"
            className={`${selectClasses} min-h-11 max-w-xs text-[0.9375rem]`}
            id="capture-payer"
            value={paidBy ?? ""}
            onChange={(event) => setPaidBy(event.target.value || null)}
          >
            <option value="">
              {notePaysSomeone ? "From the note" : members.includes("Me") ? "Me (default)" : "Not set"}
            </option>
            {members
              .filter((member) => notePaysSomeone || paidBy === "Me" || member !== "Me")
              .map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
          </select>
          <span className="text-xs text-ink-3" id="capture-payer-hint">
            {paidBy
              ? "Kept as chosen"
              : notePaysSomeone
                ? "Confirmed when the note is read"
                : "Or write “Asha paid” in the note"}
          </span>
        </div>

        {error ? (
          <p className="mt-4 text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </AppShell>
  );
}
