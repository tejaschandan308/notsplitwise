"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { Button } from "@/components/button";
import { Chip } from "@/components/chip";
import { MemberPill } from "@/components/member-pill";
import { TopBar } from "@/components/top-bar";
import {
  addParseStat,
  addTripMember,
  deleteExpense,
  getActiveTrip,
  listExpenses,
  setExpenseStatus,
  updateExpense,
} from "@/lib/storage";
import type { Category, Expense, SplitType, Trip } from "@/lib/types";

type ReviewSnapshot = {
  amount: number | null;
  category: Category | null;
  note: string;
  location: string | null;
  included: string[];
  isPersonal: boolean;
  splitType: SplitType;
};

const categoryOptions: Array<{ label: string; value: Category }> = [
  { label: "Food", value: "food" },
  { label: "Transport", value: "transport" },
  { label: "Stay", value: "stay" },
  { label: "Tickets", value: "tickets" },
  { label: "Personal", value: "personal" },
  { label: "Other", value: "other" },
];

function sameSet(first: string[], second: string[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  const secondSet = new Set(second);

  return first.every((item) => secondSet.has(item));
}

function buildChangedFields(
  original: ReviewSnapshot,
  current: ReviewSnapshot,
): string[] {
  const fieldsChanged: string[] = [];

  if (original.amount !== current.amount) fieldsChanged.push("amount");
  if (original.category !== current.category) fieldsChanged.push("category");
  if (original.note !== current.note) fieldsChanged.push("note");
  if ((original.location ?? "") !== (current.location ?? "")) {
    fieldsChanged.push("location");
  }
  if (!sameSet(original.included, current.included)) {
    fieldsChanged.push("included");
  }
  if (original.isPersonal !== current.isPersonal) {
    fieldsChanged.push("isPersonal");
  }
  if (original.splitType !== current.splitType) {
    fieldsChanged.push("splitType");
  }

  return fieldsChanged;
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const originalSnapshot = useRef<ReviewSnapshot | null>(null);
  const originalParseStatus = useRef<Expense["parseStatus"] | null>(null);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [included, setIncluded] = useState<string[]>([]);
  const [unmatchedNames, setUnmatchedNames] = useState<string[]>([]);
  const [isPersonal, setIsPersonal] = useState(false);
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [validationMessage, setValidationMessage] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const expenseId = params.id;

  function currentAmount(): number | null {
    if (!amountText.trim()) {
      return null;
    }

    const parsed = Number(amountText);

    return Number.isFinite(parsed) ? parsed : null;
  }

  async function persist(changes: Partial<Expense>): Promise<void> {
    if (!expense) {
      return;
    }

    setExpense((current) => (current ? { ...current, ...changes } : current));
    await updateExpense(expense.id, changes);
  }

  useEffect(() => {
    let ignore = false;

    async function loadReview(): Promise<void> {
      const activeTrip = await getActiveTrip();

      if (!activeTrip) {
        if (!ignore) {
          setNotFound(true);
          setIsLoading(false);
        }
        return;
      }

      const expenses = await listExpenses(activeTrip.id);
      const foundExpense = expenses.find((item) => item.id === expenseId);

      if (!foundExpense) {
        if (!ignore) {
          setTrip(activeTrip);
          setNotFound(true);
          setIsLoading(false);
        }
        return;
      }

      if (!ignore) {
        setTrip(activeTrip);
        setExpense(foundExpense);
        setAmountText(foundExpense.amount?.toString() ?? "");
        setNote(foundExpense.note);
        setLocation(foundExpense.location ?? "");
        setCategory(foundExpense.category);
        setIncluded([...foundExpense.included]);
        setUnmatchedNames([...(foundExpense.unmatchedNames ?? [])]);
        setIsPersonal(foundExpense.isPersonal);
        setSplitType(foundExpense.splitType);
        originalSnapshot.current = {
          amount: foundExpense.amount,
          category: foundExpense.category,
          note: foundExpense.note,
          location: foundExpense.location,
          included: [...foundExpense.included],
          isPersonal: foundExpense.isPersonal,
          splitType: foundExpense.splitType,
        };
        originalParseStatus.current = foundExpense.parseStatus;
        setIsLoading(false);
      }
    }

    loadReview();

    return () => {
      ignore = true;
    };
  }, [expenseId]);

  async function handleAmountChange(value: string): Promise<void> {
    const parsedAmount = value.trim() ? Number(value) : null;

    setAmountText(value);
    setValidationMessage("");
    await persist({
      amount:
        parsedAmount !== null && Number.isFinite(parsedAmount)
          ? parsedAmount
          : null,
    });
  }

  async function handleNoteChange(value: string): Promise<void> {
    setNote(value);
    await persist({ note: value });
  }

  async function handleLocationChange(value: string): Promise<void> {
    setLocation(value);
    await persist({ location: value.trim() ? value : null });
  }

  async function handleCategoryChange(value: Category): Promise<void> {
    setCategory(value);
    await persist({ category: value });
  }

  async function handleIncludedToggle(member: string): Promise<void> {
    const nextIncluded = included.includes(member)
      ? included.filter((item) => item !== member)
      : [...included, member];

    setIncluded(nextIncluded);
    setValidationMessage("");
    await persist({ included: nextIncluded });
  }

  async function updateIncludedAndUnmatched(
    nextIncluded: string[],
    nextUnmatched: string[],
  ): Promise<void> {
    setIncluded(nextIncluded);
    setUnmatchedNames(nextUnmatched);
    setValidationMessage("");
    await persist({
      included: nextIncluded,
      unmatchedNames: nextUnmatched,
    });
  }

  async function mapUnmatchedName(name: string, member: string): Promise<void> {
    const nextIncluded = included.includes(member) ? included : [...included, member];
    const nextUnmatched = unmatchedNames.filter((item) => item !== name);

    await updateIncludedAndUnmatched(nextIncluded, nextUnmatched);
  }

  async function addUnmatchedToTrip(name: string): Promise<void> {
    if (!trip) {
      return;
    }

    const updatedTrip = await addTripMember(trip.id, name);
    const addedMember =
      updatedTrip.members.find(
        (member) => member.toLowerCase() === name.trim().toLowerCase(),
      ) ?? name.trim();
    const nextIncluded = included.includes(addedMember)
      ? included
      : [...included, addedMember];
    const nextUnmatched = unmatchedNames.filter((item) => item !== name);

    setTrip(updatedTrip);
    await updateIncludedAndUnmatched(nextIncluded, nextUnmatched);
  }

  async function ignoreUnmatchedName(name: string): Promise<void> {
    const nextUnmatched = unmatchedNames.filter((item) => item !== name);

    await updateIncludedAndUnmatched(included, nextUnmatched);
  }

  async function handlePersonalToggle(checked: boolean): Promise<void> {
    const me = trip?.members.find((member) => member === "Me");
    const nextIncluded = checked && me ? [me] : included;

    setIsPersonal(checked);
    setIncluded(nextIncluded);
    setValidationMessage("");
    await persist({ isPersonal: checked, included: nextIncluded });
  }

  async function handleSplitChange(value: SplitType): Promise<void> {
    setSplitType(value);
    await persist({ splitType: value });
  }

  async function handleMarkReady(): Promise<void> {
    if (!expense) {
      return;
    }

    const amount = currentAmount();

    if (amount === null || amount <= 0) {
      setValidationMessage("Add an amount first.");
      return;
    }

    if (!isPersonal && included.length === 0) {
      setValidationMessage("Choose at least one person.");
      return;
    }

    if (unmatchedNames.length > 0) {
      setValidationMessage("Resolve unmatched names first.");
      return;
    }

    setIsSubmitting(true);

    const finalValues: ReviewSnapshot = {
      amount,
      category,
      note,
      location: location.trim() ? location : null,
      included,
      isPersonal,
      splitType,
    };

    await updateExpense(expense.id, {
      ...finalValues,
      confidence: "high",
    });

    if (originalParseStatus.current === "done" && originalSnapshot.current) {
      const fieldsChanged = buildChangedFields(
        originalSnapshot.current,
        finalValues,
      );
      await addParseStat(expense.id, fieldsChanged);
    }

    await setExpenseStatus(expense.id, "ready");
    router.push("/inbox");
  }

  async function handleDelete(): Promise<void> {
    if (!expense) {
      return;
    }

    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    await deleteExpense(expense.id);
    router.push("/inbox");
  }

  if (isLoading) {
    return (
      <AppShell>
        <section className="flex min-h-[60dvh] items-center justify-center">
          <p className="text-sm text-foreground/60">Loading...</p>
        </section>
      </AppShell>
    );
  }

  if (notFound || !expense || !trip) {
    return (
      <AppShell>
        <section className="pt-8">
          <h1 className="text-3xl font-semibold">Not found</h1>
          <p className="mt-3 text-sm text-foreground/65">
            This expense is not available.
          </p>
          <Link className="mt-6 inline-block text-sm font-medium" href="/inbox">
            Back to inbox
          </Link>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="flex flex-col gap-6 pt-1 pb-5">
        <header>
          <TopBar backHref="/inbox" tripName={trip.name} />
          <h1 className="mt-1 px-1 text-[1.125rem] font-semibold text-foreground">
            Review
          </h1>
          {expense.confidence === "low" ? (
            <div className="mt-5 rounded-[var(--radius-control)] border border-signal-warm/35 bg-surface-raised px-4 py-3.5">
              <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-foreground">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-signal-warm"
                />
                Double-check this one
              </p>
              <p className="mt-1 pl-4 text-[0.75rem] leading-5 text-muted">
                We weren&apos;t fully sure on the amount or who&apos;s included.
              </p>
            </div>
          ) : null}
        </header>

        <label className="flex flex-col gap-2">
          <span className="px-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Amount
          </span>
          <span className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-[1rem] text-muted">
              {"\u20b9"}
            </span>
            <input
              className="min-h-14 w-full rounded-[var(--radius-control)] border border-border bg-field pr-4 pl-9 text-[1.75rem] font-semibold text-foreground shadow-field outline-none placeholder:text-subtle focus:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
              inputMode="decimal"
              min="0"
              placeholder="0"
              type="number"
              value={amountText}
              onChange={(event) => void handleAmountChange(event.target.value)}
            />
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="px-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Note
          </span>
          <input
            className="min-h-12 w-full rounded-[var(--radius-control)] border border-border bg-field px-4 text-[0.9375rem] font-medium text-foreground shadow-field outline-none placeholder:text-subtle focus:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
            type="text"
            value={note}
            onChange={(event) => void handleNoteChange(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="px-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Location <span className="normal-case tracking-normal">· optional</span>
          </span>
          <input
            className="min-h-12 w-full rounded-[var(--radius-control)] border border-border bg-field px-4 text-[0.9375rem] font-medium text-foreground shadow-field outline-none placeholder:text-subtle focus:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
            placeholder="Add location"
            type="text"
            value={location}
            onChange={(event) => void handleLocationChange(event.target.value)}
          />
        </label>

        <section>
          <h2 className="px-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Category
          </h2>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {categoryOptions.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={category === option.value}
                onClick={() => void handleCategoryChange(option.value)}
              />
            ))}
          </div>
        </section>

        {unmatchedNames.length > 0 ? (
          <section className="rounded-[var(--radius-control)] border border-signal-warm/55 bg-surface p-4">
            <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold text-foreground">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-signal-warm"
              />
              A name we didn&apos;t recognize
            </h2>
            <p className="mt-1 pl-4 text-[0.75rem] leading-5 text-muted">
              Decide what to do with each, so the split is right.
            </p>
            <div className="mt-3 border-t border-border pt-3">
              {unmatchedNames.map((name) => (
                <div key={name} className="not-last:mb-4">
                  <h3 className="text-[0.9375rem] font-medium text-foreground">
                    &ldquo;{name}&rdquo;
                  </h3>
                  <p className="mt-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted">
                    Map to member
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {trip.members.map((member) => (
                      <Button
                        key={member}
                        className="min-h-10 px-3 text-[0.8125rem]"
                        type="button"
                        variant="secondary"
                        onClick={() => void mapUnmatchedName(name, member)}
                      >
                        {member}
                      </Button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      className="min-h-10 px-3 text-[0.8125rem]"
                      type="button"
                      variant="secondary"
                      onClick={() => void addUnmatchedToTrip(name)}
                    >
                      Add to trip
                    </Button>
                    <Button
                      className="min-h-10 px-3 text-[0.8125rem]"
                      type="button"
                      variant="ghost"
                      onClick={() => void ignoreUnmatchedName(name)}
                    >
                      Ignore
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-[var(--radius-control)] border border-border bg-surface-raised p-4">
          <label className="flex min-h-11 items-center justify-between gap-4">
            <span>
              <span className="block text-[0.9375rem] font-medium text-foreground">
                Personal expense
              </span>
              <span className="block text-[0.75rem] text-muted">
                Just mine — not shared
              </span>
            </span>
            <span className="relative inline-flex min-h-11 items-center">
              <input
                checked={isPersonal}
                className="peer sr-only"
                type="checkbox"
                onChange={(event) =>
                  void handlePersonalToggle(event.target.checked)
                }
              />
              <span className="h-7 w-12 rounded-[var(--radius-pill)] bg-border-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background" />
              <span className="pointer-events-none absolute left-1 size-5 rounded-full bg-surface shadow-pill transition-transform peer-checked:translate-x-5 peer-checked:bg-accent-contrast" />
            </span>
          </label>
        </section>

        {!isPersonal ? (
          <section className="rounded-[calc(var(--radius-control)+0.25rem)] border-2 border-border-strong bg-surface p-4 shadow-field">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[1rem] font-semibold text-foreground">
                Who&apos;s included
              </h2>
              <p className="text-[0.8125rem] font-medium text-muted">
                {included.length} of {trip.members.length}
              </p>
            </div>
            <p className="mt-1 max-w-[19rem] text-[0.75rem] leading-5 text-muted">
              Confirm exactly who shares this — a wrong tap moves real money.
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {trip.members.map((member) => {
                const isIncluded = included.includes(member);

                return (
                  <MemberPill
                    key={member}
                    name={member}
                    state={isIncluded ? "selected" : "unselected"}
                    onClick={() => void handleIncludedToggle(member)}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        {!isPersonal ? (
          <section>
            <h2 className="px-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
              Split
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["equal", "custom"] as SplitType[]).map((option) => (
                <Button
                  key={option}
                  className="capitalize"
                  type="button"
                  variant={splitType === option ? "primary" : "secondary"}
                  onClick={() => void handleSplitChange(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
            {splitType === "custom" ? (
              <p className="mt-2 text-[0.75rem] text-muted">
                You&apos;ll enter exact amounts in Splitwise.
              </p>
            ) : (
              <p className="mt-2 text-[0.75rem] text-muted">
                Split equally across {included.length}{" "}
                {included.length === 1 ? "person" : "people"}.
              </p>
            )}
          </section>
        ) : null}

        {validationMessage ? (
          <p className="rounded-[var(--radius-control)] border border-signal-warm/55 bg-surface-raised px-3 py-2 text-[0.8125rem] text-signal-warm">
            {validationMessage}
          </p>
        ) : null}

        <section className="flex flex-col gap-3 pb-4">
          <Button
            className="min-h-12 w-full text-base"
            disabled={isSubmitting}
            type="button"
            onClick={() => void handleMarkReady()}
          >
            {isSubmitting ? "Saving..." : "Mark as Ready"}
          </Button>
          <Button
            className="w-full"
            type="button"
            variant="ghost"
            onClick={() => void handleDelete()}
          >
            {deleteConfirm ? "Confirm delete" : "Delete"}
          </Button>
        </section>
      </section>
    </AppShell>
  );
}
