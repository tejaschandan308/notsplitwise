"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { Button } from "@/components/button";
import { Chip } from "@/components/chip";
import { TopBar } from "@/components/top-bar";
import { buildExportText } from "@/lib/export";
import { reparsePendingDrafts } from "@/lib/reparse";
import {
  deleteExpense,
  getActiveTrip,
  listExpenses,
  setExpenseStatus,
  updateExpense,
} from "@/lib/storage";
import type { Expense, ExpenseStatus, Trip } from "@/lib/types";

type InboxTab = Extract<ExpenseStatus, "draft" | "ready">;

const tabs: Array<{ id: InboxTab; label: string }> = [
  { id: "draft", label: "Drafts" },
  { id: "ready", label: "Ready" },
];

function formatAmount(amount: number | null): string {
  if (amount === null) {
    return "no amount yet";
  }

  return `\u20b9${amount}`;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function displayTitle(expense: Expense): string {
  return expense.note.trim() || expense.rawText;
}

function ConfidenceFlag({
  expense,
  show,
}: {
  expense: Expense;
  show: boolean;
}) {
  if (!show || expense.confidence !== "low") {
    return null;
  }

  return (
    <span
      aria-label="needs a look"
      className="inline-flex size-2 shrink-0 rounded-full bg-signal-warm"
      title="needs a look"
    >
      <span className="sr-only">needs a look</span>
    </span>
  );
}

function ParseState({ expense }: { expense: Expense }) {
  if (expense.parseStatus === "done") {
    return null;
  }

  if (expense.parseStatus === "pending") {
    return (
      <span className="text-xs text-muted" aria-label="Parsing">
        parsing...
      </span>
    );
  }

  return <span className="text-xs text-muted">not parsed yet</span>;
}

export default function InboxPage() {
  const router = useRouter();
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [currentTab, setCurrentTab] = useState<InboxTab>("draft");
  const [drafts, setDrafts] = useState<Expense[]>([]);
  const [ready, setReady] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [isArchiving, setIsArchiving] = useState(false);

  const visibleExpenses = currentTab === "draft" ? drafts : ready;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedReadyExpenses = useMemo(
    () => ready.filter((expense) => selectedSet.has(expense.id)),
    [ready, selectedSet],
  );
  const exportText = useMemo(() => {
    if (!activeTrip || selectedReadyExpenses.length === 0) {
      return "";
    }

    return buildExportText(activeTrip.name, selectedReadyExpenses);
  }, [activeTrip, selectedReadyExpenses]);

  async function refreshLists(tripId = activeTrip?.id): Promise<void> {
    if (!tripId) {
      return;
    }

    const [nextDrafts, nextReady] = await Promise.all([
      listExpenses(tripId, "draft"),
      listExpenses(tripId, "ready"),
    ]);

    setDrafts(nextDrafts);
    setReady(nextReady);
  }

  async function runReparseAndRefresh(trip: Trip): Promise<void> {
    await reparsePendingDrafts(trip);
    await refreshLists(trip.id);
  }

  useEffect(() => {
    let ignore = false;

    async function loadInbox(): Promise<void> {
      const trip = await getActiveTrip();

      if (!trip) {
        router.replace("/trip/new");
        return;
      }

      const [nextDrafts, nextReady] = await Promise.all([
        listExpenses(trip.id, "draft"),
        listExpenses(trip.id, "ready"),
      ]);

      if (!ignore) {
        setActiveTrip(trip);
        setDrafts(nextDrafts);
        setReady(nextReady);
        setIsLoading(false);
      }

      if (navigator.onLine) {
        await runReparseAndRefresh(trip);
      }
    }

    loadInbox();

    return () => {
      ignore = true;
    };
  }, [router]);

  useEffect(() => {
    if (!activeTrip) {
      return;
    }

    const trip = activeTrip;

    function handleOnlineOrFocus(): void {
      void runReparseAndRefresh(trip);
    }

    window.addEventListener("online", handleOnlineOrFocus);
    window.addEventListener("focus", handleOnlineOrFocus);

    return () => {
      window.removeEventListener("online", handleOnlineOrFocus);
      window.removeEventListener("focus", handleOnlineOrFocus);
    };
  }, [activeTrip]);

  useEffect(() => {
    if (currentTab !== "ready") {
      setSelectMode(false);
      setSelectedIds([]);
      setIsExportOpen(false);
      setCopyStatus("idle");
    }
  }, [currentTab]);

  async function handleDelete(expense: Expense): Promise<void> {
    if (deleteConfirmId !== expense.id) {
      setDeleteConfirmId(expense.id);
      setNotice("Tap delete again to confirm.");
      return;
    }

    await deleteExpense(expense.id);
    setDeleteConfirmId(null);
    setSelectedIds((ids) => ids.filter((id) => id !== expense.id));
    setNotice("Deleted.");
    await refreshLists();
  }

  async function handleRetry(expense: Expense): Promise<void> {
    if (!activeTrip) {
      return;
    }

    await updateExpense(expense.id, { parseStatus: "pending" });
    await refreshLists();
    await runReparseAndRefresh(activeTrip);
  }

  function toggleSelected(id: string): void {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
    );
  }

  function handleSelectAll(): void {
    setSelectedIds((ids) =>
      ids.length === ready.length ? [] : ready.map((expense) => expense.id),
    );
  }

  function handleExport(): void {
    if (selectedReadyExpenses.length === 0) {
      return;
    }

    setNotice("");
    setCopyStatus("idle");
    setIsExportOpen(true);
  }

  async function handleCopyExport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  function closeExportOverlay(clearSelection = false): void {
    setIsExportOpen(false);
    setCopyStatus("idle");

    if (clearSelection) {
      setSelectedIds([]);
      setSelectMode(false);
    }
  }

  async function handleArchiveExported(): Promise<void> {
    setIsArchiving(true);

    await Promise.all(
      selectedReadyExpenses.map((expense) =>
        setExpenseStatus(expense.id, "archived"),
      ),
    );

    setIsArchiving(false);
    closeExportOverlay(true);
    await refreshLists();
  }

  function handleKeepExported(): void {
    closeExportOverlay(true);
  }

  function openReview(expense: Expense): void {
    if (selectMode && currentTab === "ready") {
      toggleSelected(expense.id);
      return;
    }

    router.push(`/review/${expense.id}`);
  }

  if (isLoading) {
    return (
      <AppShell>
        <section className="flex min-h-[60dvh] items-center justify-center">
          <p className="text-sm text-muted">Loading...</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="flex flex-col pt-1 pb-5">
        <header>
          <TopBar tripName={activeTrip?.name ?? ""} />
          <div className="mt-2 flex min-h-11 items-center justify-between gap-3 px-1">
            <h1 className="text-[1.25rem] font-semibold text-foreground">
              Inbox
            </h1>
            {currentTab === "ready" ? (
              <button
                className="min-h-11 border-0 bg-transparent px-1 text-[0.875rem] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
                style={{
                  border: 0,
                  borderRadius: "var(--radius-control)",
                }}
                type="button"
                onClick={() => {
                  setSelectMode((value) => !value);
                  setSelectedIds([]);
                  setNotice("");
                }}
              >
                {selectMode ? "Done" : "Select"}
              </button>
            ) : null}
          </div>
        </header>

        <div className="mt-1 flex border-b border-border">
          {tabs.map((tab) => {
            const isActive = currentTab === tab.id;
            const count = tab.id === "draft" ? drafts.length : ready.length;

            return (
              <button
                key={tab.id}
                className={`relative flex min-h-12 items-center gap-2 border-0 bg-transparent px-1 text-[0.875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  isActive ? "text-foreground" : "text-muted"
                }`}
                style={{ border: 0 }}
                type="button"
                onClick={() => {
                  setCurrentTab(tab.id);
                  setNotice("");
                }}
              >
                {tab.label}
                <span
                  className={`inline-flex size-6 items-center justify-center rounded-full text-[0.75rem] font-semibold ${
                    isActive
                      ? "bg-accent text-accent-contrast"
                      : "bg-surface-raised text-muted"
                  }`}
                >
                  {count}
                </span>
                {isActive ? (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
                ) : null}
              </button>
            );
          })}
        </div>

        {selectMode && currentTab === "ready" ? (
          <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-20 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
            <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
              <button
                className="flex min-h-11 items-center gap-2 border-0 bg-transparent px-0 text-[0.875rem] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
                style={{
                  border: 0,
                  borderRadius: "var(--radius-control)",
                }}
                type="button"
                onClick={handleSelectAll}
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex size-5 items-center justify-center border text-[0.75rem] ${
                    selectedIds.length === ready.length && ready.length > 0
                      ? "border-accent bg-accent text-accent-contrast"
                      : "border-border-strong bg-surface text-transparent"
                  }`}
                  style={{
                    borderRadius: "calc(var(--radius-control) / 2)",
                  }}
                >
                  {"\u2713"}
                </span>
                {selectedIds.length === ready.length && ready.length > 0
                  ? "Clear all"
                  : "Select all"}
              </button>
              {selectedIds.length > 0 ? (
                <Button
                  className="min-w-28"
                  type="button"
                  onClick={handleExport}
                >
                  Export {selectedIds.length}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {notice ? <p className="mt-4 text-sm text-muted">{notice}</p> : null}

        {visibleExpenses.length === 0 ? (
          <div className="flex min-h-[19rem] flex-col items-center justify-center px-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-[var(--radius-control)] border border-border text-muted">
              <span className="flex flex-col gap-1">
                <span className="h-px w-6 bg-border-strong" />
                <span className="h-px w-6 bg-border-strong" />
                <span className="h-px w-4 bg-border-strong" />
              </span>
            </span>
            <p className="mt-5 text-[1.125rem] font-medium text-foreground">
              {currentTab === "draft" ? "All caught up" : "Nothing ready yet"}
            </p>
            <p className="mt-3 max-w-64 text-[0.875rem] leading-6 text-muted">
              {currentTab === "draft"
                ? "Captured expenses will show up here to review."
                : "Confirmed expenses land here, ready to export."}
            </p>
          </div>
        ) : (
          <div
            className={
              selectMode && currentTab === "ready" ? "pb-20" : undefined
            }
          >
            {visibleExpenses.map((expense) => (
              <article
                key={expense.id}
                className={`border-b border-border py-4 transition-colors ${
                  selectMode &&
                  currentTab === "ready" &&
                  selectedSet.has(expense.id)
                    ? "bg-surface-raised"
                    : "bg-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  {selectMode && currentTab === "ready" ? (
                    <input
                      aria-label={`Select ${displayTitle(expense)}`}
                      checked={selectedSet.has(expense.id)}
                      className="size-5 shrink-0 accent-accent"
                      type="checkbox"
                      onChange={() => toggleSelected(expense.id)}
                    />
                  ) : null}

                  <button
                    className="min-h-11 min-w-0 flex-1 border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    style={{
                      border: 0,
                      borderRadius: "var(--radius-control)",
                    }}
                    type="button"
                    onClick={() => openReview(expense)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={
                            expense.amount === null
                              ? "text-[0.9375rem] font-medium text-subtle"
                              : "text-[1rem] font-semibold text-foreground"
                          }
                        >
                          {formatAmount(expense.amount)}
                        </p>
                        {currentTab === "draft" &&
                        expense.parseStatus === "pending" ? (
                          <ParseState expense={expense} />
                        ) : null}
                        <ConfidenceFlag
                          expense={expense}
                          show={currentTab === "draft"}
                        />
                      </div>
                      <h2 className="mt-1 truncate text-[0.875rem] font-normal text-muted">
                        {displayTitle(expense)}
                      </h2>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.75rem] text-subtle">
                      <span>{relativeTime(expense.createdAt)}</span>
                      {currentTab === "ready" ? (
                        <>
                          <span aria-hidden="true">{"\u00b7"}</span>
                          <span className="truncate">
                            {expense.included.join(", ")}
                          </span>
                        </>
                      ) : null}
                      {currentTab === "draft" &&
                      expense.parseStatus === "failed" ? (
                        <>
                          <span aria-hidden="true">{"\u00b7"}</span>
                          <ParseState expense={expense} />
                        </>
                      ) : null}
                    </div>
                  </button>

                  {currentTab === "ready" ? (
                    <Chip
                      className="min-h-9 shrink-0 px-3 text-[0.75rem] capitalize text-muted"
                      disabled
                      label={expense.category ?? "other"}
                      selected={false}
                      tabIndex={-1}
                    />
                  ) : null}

                  {!selectMode ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {expense.parseStatus === "failed" &&
                      currentTab === "draft" ? (
                        <button
                          className="min-h-11 border-0 bg-transparent px-2 text-[0.75rem] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          style={{
                            border: 0,
                            borderRadius: "var(--radius-control)",
                          }}
                          type="button"
                          onClick={() => handleRetry(expense)}
                        >
                          retry
                        </button>
                      ) : null}
                      <button
                        aria-label={
                          deleteConfirmId === expense.id
                            ? "Confirm delete"
                            : "Delete"
                        }
                        className="flex size-11 items-center justify-center border border-border bg-transparent p-0 text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
                        style={{ borderRadius: "var(--radius-control)" }}
                        title={
                          deleteConfirmId === expense.id
                            ? "Confirm delete"
                            : "Delete"
                        }
                        type="button"
                        onClick={() => handleDelete(expense)}
                      >
                        {deleteConfirmId === expense.id ? (
                          <span className="text-[0.6875rem] font-semibold">
                            confirm
                          </span>
                        ) : (
                          <svg
                            aria-hidden="true"
                            className="size-4"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M4 7h16M9 11v6M15 11v6M6.5 7l1 14h9l1-14M9 7l.75-3h4.5L15 7"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.6"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {isExportOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/35 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8">
          <div
            className="max-h-[90dvh] w-full rounded-t-2xl bg-background p-4 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="export-title" className="text-xl font-semibold">
                  Export {selectedReadyExpenses.length}{" "}
                  {selectedReadyExpenses.length === 1
                    ? "expense"
                    : "expenses"}
                </h2>
                <p className="mt-1 text-sm text-foreground/60">
                  Copy this into Splitwise when you are ready.
                </p>
              </div>
              <button
                className="min-h-10 px-3 text-sm text-foreground/65"
                type="button"
                onClick={() => closeExportOverlay()}
              >
                Close
              </button>
            </div>

            <textarea
              className="mt-4 h-64 w-full resize-none rounded-lg border border-foreground/15 bg-foreground/5 p-3 font-mono text-sm leading-6 text-foreground"
              readOnly
              value={exportText}
            />

            {copyStatus === "copied" ? (
              <p className="mt-3 text-sm font-medium text-green-700">
                Copied!
              </p>
            ) : null}

            {copyStatus === "error" ? (
              <p className="mt-3 text-sm text-foreground/65">
                Couldn&apos;t copy automatically — select the text above and copy manually.
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2">
              <button
                className="min-h-11 bg-foreground px-4 text-sm font-medium text-background"
                type="button"
                onClick={handleCopyExport}
              >
                Copy to clipboard
              </button>

              {copyStatus === "copied" ? (
                <div className="rounded-lg border border-foreground/10 p-3">
                  <p className="text-sm font-medium">
                    Archive these {selectedReadyExpenses.length}{" "}
                    {selectedReadyExpenses.length === 1
                      ? "expense"
                      : "expenses"}
                    ?
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      className="min-h-10 bg-foreground px-3 text-sm font-medium text-background disabled:opacity-60"
                      disabled={isArchiving}
                      type="button"
                      onClick={handleArchiveExported}
                    >
                      {isArchiving ? "Archiving..." : "Archive"}
                    </button>
                    <button
                      className="min-h-10 px-3 text-sm"
                      type="button"
                      onClick={handleKeepExported}
                    >
                      Keep
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
