"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type KeyboardEvent,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppShell } from "@/app/app-shell";
import { Button } from "@/components/button";
import { ExportDialog } from "@/components/export-dialog";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { TopBar, useActiveTrip } from "@/components/top-bar";
import { formatMoney } from "@/lib/currency";
import { describeExpense, totalsByCurrency } from "@/lib/export";
import { getExpenseState } from "@/lib/expense-state";
import { useLiveQuery, useOnline } from "@/lib/hooks";
import { parseExpense } from "@/lib/parse-client";
import { listExpenses } from "@/lib/storage";
import type { Expense, Trip } from "@/lib/types";
import { hasUnsavedDifferences, type UnsavedEdits, useUnsavedEdits } from "@/lib/unsaved-edits";

type Tab = "draft" | "ready";

function relativeTime(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h ago`;

  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function peopleText(expense: Expense, members: string[]): string {
  if (expense.isPersonal) return "Personal";
  if (
    expense.included.length === members.length &&
    members.every((member) => expense.included.includes(member))
  ) {
    return "Everyone";
  }
  return expense.included.join(", ");
}

/**
 * Ready, valid now, and with no edit on this device that hasn't reached
 * storage. Only these can be selected and exported.
 */
function isExportable(expense: Expense, members: string[], unsaved: UnsavedEdits): boolean {
  return (
    getExpenseState(expense, members, true).kind === "ready" &&
    !hasUnsavedDifferences(expense, unsaved[expense.id])
  );
}

function RowSummary({
  expense,
  trip,
  online,
}: {
  expense: Expense;
  trip: Trip;
  online: boolean;
}) {
  const state = getExpenseState(expense, trip.members, online);
  const unsaved = hasUnsavedDifferences(expense, useUnsavedEdits()[expense.id]);
  const parsed = expense.parseStatus === "done" || expense.status !== "draft";
  const title = parsed ? describeExpense(expense) : expense.rawText;
  const meta: string[] = [];

  if (parsed) {
    meta.push(expense.paidBy ? `${expense.paidBy} paid` : "Payer not set");
    meta.push(peopleText(expense, trip.members));
    if (expense.splitType === "custom" && !expense.isPersonal) meta.push("Custom split");
  }
  meta.push(relativeTime(expense.createdAt));

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {parsed ? (
            <Money amount={expense.amount} currency={expense.currency} />
          ) : null}
          <p
            className={`truncate ${
              parsed
                ? "text-[0.9375rem] text-ink"
                : "font-mono text-[0.875rem] leading-6 text-ink"
            }`}
          >
            {parsed ? title : `“${title}”`}
          </p>
        </div>
        <StatusBadge className="mt-0.5" kind={state.kind} label={state.label} />
      </div>
      {unsaved ? (
        <p className="mt-1 truncate text-xs font-semibold text-danger">
          Unsaved change on this device: open it to save or discard
        </p>
      ) : null}
      {state.kind === "review" ? (
        <p className="mt-1 truncate text-xs font-semibold text-warn">
          To fix: {state.issues.map((issue) => issue.label).join(" · ")}
        </p>
      ) : null}
      <p className="mt-1 truncate text-xs text-ink-3">{meta.join(" · ")}</p>
    </>
  );
}

function DraftList({ drafts, trip }: { drafts: Expense[]; trip: Trip }) {
  const online = useOnline();
  const [retrying, setRetrying] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  async function retry(expense: Expense): Promise<void> {
    setNotice("");
    setRetrying((ids) => [...ids, expense.id]);

    try {
      const result = await parseExpense(expense.id, { force: true });

      if (result === "offline") {
        setNotice("You’re offline. It will be read when you reconnect.");
      }
    } finally {
      setRetrying((ids) => ids.filter((id) => id !== expense.id));
    }
  }

  if (drafts.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-base font-semibold text-ink">Nothing to review</p>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-6 text-ink-2">
          New captures land here while the AI reads them.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-accent underline-offset-4 hover:underline"
          href="/capture"
        >
          Capture an expense
        </Link>
      </div>
    );
  }

  return (
    <>
      {notice ? (
        <p aria-live="polite" className="pt-3 text-sm text-ink-2">
          {notice}
        </p>
      ) : null}
      <ul className="divide-y divide-rule border-b border-rule">
        {drafts.map((expense) => {
          const failed = expense.parseStatus === "failed";
          const isRetrying = retrying.includes(expense.id);

          return (
            <li key={expense.id} className="py-1">
              <Link
                className="-mx-2 block rounded-control px-2 py-2.5 transition-colors hover:bg-sunken"
                href={`/review/${expense.id}`}
              >
                <RowSummary expense={expense} online={online} trip={trip} />
              </Link>
              {failed ? (
                <div className="flex items-center gap-1 pb-1.5">
                  <Button
                    disabled={isRetrying}
                    size="sm"
                    variant="secondary"
                    onClick={() => void retry(expense)}
                  >
                    {isRetrying ? "Retrying…" : "Retry reading"}
                  </Button>
                  <Link
                    className="flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-ink-2 hover:bg-sunken hover:text-ink"
                    href={`/review/${expense.id}`}
                  >
                    Fill in by hand
                  </Link>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ReadyList({
  ready,
  trip,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  ready: Expense[];
  trip: Trip;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const online = useOnline();
  const unsaved = useUnsavedEdits();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const exportable = ready.filter((expense) => isExportable(expense, trip.members, unsaved));
  const allSelected =
    exportable.length > 0 && exportable.every((expense) => selectedIds.includes(expense.id));
  const someSelected = selectedIds.length > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  if (ready.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-base font-semibold text-ink">Nothing ready yet</p>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-6 text-ink-2">
          Check a draft and mark it ready. Ready expenses collect here for
          export.
        </p>
      </div>
    );
  }

  return (
    <>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-rule text-sm font-semibold text-ink">
        <span className="flex w-8 justify-center">
          <input
            ref={selectAllRef}
            checked={allSelected}
            className="size-5 accent-[var(--accent)]"
            disabled={exportable.length === 0}
            type="checkbox"
            onChange={onToggleAll}
          />
        </span>
        Select all ({exportable.length})
      </label>
      <ul className="divide-y divide-rule border-b border-rule">
        {ready.map((expense) => {
          const state = getExpenseState(expense, trip.members, online);
          const selectable = state.kind === "ready" && isExportable(expense, trip.members, unsaved);
          const checked = selectedIds.includes(expense.id);

          return (
            <li
              key={expense.id}
              className={`flex items-stretch gap-3 transition-colors ${checked ? "bg-accent-soft/60" : ""}`}
            >
              <label className="flex w-8 shrink-0 cursor-pointer items-center justify-center">
                <input
                  aria-label={`Select ${describeExpense(expense)}, ${formatMoney(expense.amount, expense.currency)}`}
                  checked={checked}
                  className="size-5 accent-[var(--accent)]"
                  disabled={!selectable}
                  type="checkbox"
                  onChange={() => onToggle(expense.id)}
                />
              </label>
              <Link
                className="min-w-0 flex-1 rounded-control py-3 pr-2 transition-colors hover:bg-sunken"
                href={`/review/${expense.id}`}
              >
                <RowSummary expense={expense} online={online} trip={trip} />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Inbox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "ready" ? "ready" : "draft";
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ draft: null, ready: null });
  const { data: trip, isLoading: tripLoading } = useActiveTrip();
  const tripId = trip?.id;
  const { data: expenses } = useLiveQuery(
    async () => (tripId ? listExpenses(tripId) : []),
    [tripId],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const unsaved = useUnsavedEdits();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!tripLoading && !trip) router.replace("/trip/new");
  }, [tripLoading, trip, router]);

  const drafts = useMemo(
    () => (expenses ?? []).filter((expense) => expense.status === "draft"),
    [expenses],
  );
  const ready = useMemo(
    () => (expenses ?? []).filter((expense) => expense.status === "ready"),
    [expenses],
  );
  // Selection is re-checked on every change, including edits made in another
  // tab: anything no longer Ready and valid drops out of the export.
  const selected = useMemo(
    () =>
      trip
        ? ready.filter(
            (expense) =>
              selectedIds.includes(expense.id) &&
              isExportable(expense, trip.members, unsaved),
          )
        : [],
    [ready, selectedIds, trip, unsaved],
  );

  if (!trip || !expenses) {
    return (
      <AppShell width="wide">
        <p className="pt-24 text-center text-sm text-ink-3" role="status">
          Loading…
        </p>
      </AppShell>
    );
  }

  const activeTrip = trip;

  function selectTab(next: Tab): void {
    setNotice("");
    router.replace(next === "ready" ? `${pathname}?tab=ready` : pathname, { scroll: false });
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next: Tab = tab === "draft" ? "ready" : "draft";
      selectTab(next);
      tabRefs.current[next]?.focus();
    }
  }

  function toggleAll(): void {
    const exportable = ready.filter(
      (expense) => isExportable(expense, activeTrip.members, unsaved),
    );
    setSelectedIds((ids) =>
      exportable.every((expense) => ids.includes(expense.id))
        ? []
        : exportable.map((expense) => expense.id),
    );
  }

  const needsAttention = drafts.filter(
    (expense) => getExpenseState(expense, trip.members, true).kind !== "reading",
  ).length;
  const totals = totalsByCurrency(selected);
  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "draft", label: "Drafts", count: drafts.length },
    { id: "ready", label: "Ready", count: ready.length },
  ];

  return (
    <AppShell
      actionBar={
        tab === "ready" && ready.length > 0 ? (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1" aria-live="polite">
              <p className="text-sm font-semibold text-ink">
                {selected.length === 0 ? "None selected" : `${selected.length} selected`}
              </p>
              <p className="truncate text-xs text-ink-3">
                {totals.length > 0
                  ? totals.map(({ currency, total }) => formatMoney(total, currency)).join(" · ")
                  : "Select expenses to export"}
              </p>
            </div>
            <Button
              className="min-w-32"
              disabled={selected.length === 0}
              size="lg"
              onClick={() => setIsExportOpen(true)}
            >
              Export
            </Button>
          </div>
        ) : null
      }
      width="wide"
    >
      <TopBar />

      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {drafts.length === 0
              ? "All drafts checked."
              : `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}${
                  needsAttention > 0 ? `, ${needsAttention} to check` : ""
                }`}
          </p>
        </div>
      </div>

      <div aria-label="Expenses" className="flex gap-1 border-b border-rule" role="tablist">
        {tabs.map((item) => {
          const active = item.id === tab;

          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[item.id] = element;
              }}
              aria-controls={`panel-${item.id}`}
              aria-selected={active}
              className={`relative -mb-px flex min-h-12 items-center gap-2 border-b-2 px-3 text-[0.9375rem] font-semibold transition-colors ${
                active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
              }`}
              id={`tab-${item.id}`}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
              onClick={() => selectTab(item.id)}
              onKeyDown={handleTabKeyDown}
            >
              {item.label}
              <span className="text-xs text-ink-3 tabular-nums">{item.count}</span>
            </button>
          );
        })}
      </div>

      {notice ? (
        <p aria-live="polite" className="pt-3 text-sm font-semibold text-accent" role="status">
          {notice}
        </p>
      ) : null}

      <div aria-labelledby={`tab-${tab}`} id={`panel-${tab}`} role="tabpanel">
        {tab === "draft" ? (
          <DraftList drafts={drafts} trip={trip} />
        ) : (
          <ReadyList
            ready={ready}
            selectedIds={selectedIds}
            trip={trip}
            onToggle={(id) =>
              setSelectedIds((ids) =>
                ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
              )
            }
            onToggleAll={toggleAll}
          />
        )}
      </div>

      {isExportOpen ? (
        <ExportDialog
          expenses={selected}
          tripName={trip.name}
          onArchived={(count) => {
            setIsExportOpen(false);
            setSelectedIds([]);
            setNotice(`Archived ${count} ${count === 1 ? "expense" : "expenses"}.`);
          }}
          onClose={() => setIsExportOpen(false)}
        />
      ) : null}
    </AppShell>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <Inbox />
    </Suspense>
  );
}
