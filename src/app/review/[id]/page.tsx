"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
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
      <section className="flex flex-col gap-6 pt-4">
        <header>
          <Link className="text-sm font-medium text-foreground/65" href="/inbox">
            Back
          </Link>
          <p className="mt-5 text-sm text-foreground/55">{trip.name}</p>
          <h1 className="text-3xl font-semibold">Review</h1>
          {expense.confidence === "low" ? (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Double-check this one.
            </p>
          ) : null}
        </header>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Amount</span>
          <input
            className="min-h-11 rounded-md border border-foreground/15 bg-transparent px-3 text-base outline-none focus:border-foreground/45"
            inputMode="decimal"
            min="0"
            placeholder="Enter amount"
            type="number"
            value={amountText}
            onChange={(event) => void handleAmountChange(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Note</span>
          <input
            className="min-h-11 rounded-md border border-foreground/15 bg-transparent px-3 text-base outline-none focus:border-foreground/45"
            type="text"
            value={note}
            onChange={(event) => void handleNoteChange(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Location</span>
          <input
            className="min-h-11 rounded-md border border-foreground/15 bg-transparent px-3 text-base outline-none focus:border-foreground/45"
            placeholder="Optional"
            type="text"
            value={location}
            onChange={(event) => void handleLocationChange(event.target.value)}
          />
        </label>

        <section>
          <h2 className="text-sm font-medium">Category</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {categoryOptions.map((option) => (
              <button
                key={option.value}
                className={`min-h-10 px-3 text-sm ${
                  category === option.value
                    ? "bg-foreground text-background"
                    : "text-foreground/70"
                }`}
                type="button"
                onClick={() => void handleCategoryChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {unmatchedNames.length > 0 ? (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <h2 className="font-semibold">Resolve names</h2>
            <p className="mt-1 text-sm">
              These names are not in this trip yet.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              {unmatchedNames.map((name) => (
                <div key={name} className="rounded-md bg-white/70 p-3">
                  <h3 className="font-medium">{name}</h3>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide">
                    Map to member
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {trip.members.map((member) => (
                      <button
                        key={member}
                        className="min-h-9 px-3 text-sm"
                        type="button"
                        onClick={() => void mapUnmatchedName(name, member)}
                      >
                        {member}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="min-h-9 px-3 text-sm font-medium"
                      type="button"
                      onClick={() => void addUnmatchedToTrip(name)}
                    >
                      Add to trip
                    </button>
                    <button
                      className="min-h-9 px-3 text-sm"
                      type="button"
                      onClick={() => void ignoreUnmatchedName(name)}
                    >
                      Ignore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-foreground/10 p-4">
          <label className="flex min-h-11 items-center justify-between gap-4">
            <span>
              <span className="block font-medium">Personal expense</span>
              <span className="block text-sm text-foreground/55">
                Only you are included.
              </span>
            </span>
            <input
              checked={isPersonal}
              className="h-5 w-5"
              type="checkbox"
              onChange={(event) => void handlePersonalToggle(event.target.checked)}
            />
          </label>
        </section>

        {!isPersonal ? (
          <section className="rounded-xl border-2 border-foreground/20 p-4">
            <h2 className="text-lg font-semibold">Who's included</h2>
            <p className="mt-1 text-sm text-foreground/60">
              Tap to confirm who shares this.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {trip.members.map((member) => {
                const isIncluded = included.includes(member);

                return (
                  <button
                    key={member}
                    className={`min-h-11 px-4 text-sm font-medium ${
                      isIncluded
                        ? "bg-foreground text-background"
                        : "text-foreground/65"
                    }`}
                    type="button"
                    onClick={() => void handleIncludedToggle(member)}
                  >
                    {member}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {!isPersonal ? (
          <section>
            <h2 className="text-sm font-medium">Split</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["equal", "custom"] as SplitType[]).map((option) => (
                <button
                  key={option}
                  className={`min-h-10 px-3 text-sm capitalize ${
                    splitType === option
                      ? "bg-foreground text-background"
                      : "text-foreground/70"
                  }`}
                  type="button"
                  onClick={() => void handleSplitChange(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            {splitType === "custom" ? (
              <p className="mt-2 text-sm text-foreground/60">
                You'll enter exact amounts in Splitwise.
              </p>
            ) : null}
          </section>
        ) : null}

        {validationMessage ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {validationMessage}
          </p>
        ) : null}

        <section className="flex flex-col gap-3 pb-4">
          <button
            className="min-h-12 rounded-md bg-foreground px-4 text-base font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
            disabled={isSubmitting}
            type="button"
            onClick={() => void handleMarkReady()}
          >
            {isSubmitting ? "Saving..." : "Mark as Ready"}
          </button>
          <button
            className="min-h-11 px-4 text-sm text-foreground/65"
            type="button"
            onClick={() => void handleDelete()}
          >
            {deleteConfirm ? "Confirm delete" : "Delete"}
          </button>
        </section>
      </section>
    </AppShell>
  );
}
