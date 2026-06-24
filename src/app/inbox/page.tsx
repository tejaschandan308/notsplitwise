"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/app-shell";
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

  return `Rs ${amount}`;
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
    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
      <span className="h-2 w-2 rounded-full bg-amber-500" />
      needs a look
    </span>
  );
}

function ParseState({ expense }: { expense: Expense }) {
  if (expense.parseStatus === "done") {
    return null;
  }

  if (expense.parseStatus === "pending") {
    return (
      <span className="text-xs text-foreground/55" aria-label="Parsing">
        parsing...
      </span>
    );
  }

  return <span className="text-xs text-foreground/55">not parsed yet</span>;
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
          <p className="text-sm text-foreground/60">Loading...</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="flex flex-col gap-5 pt-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-foreground/55">{activeTrip?.name}</p>
            <h1 className="text-3xl font-semibold">Inbox</h1>
          </div>
          {currentTab === "ready" ? (
            <button
              className="min-h-10 px-3 text-sm"
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
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-foreground/5 p-1">
          {tabs.map((tab) => {
            const isActive = currentTab === tab.id;
            const count = tab.id === "draft" ? drafts.length : ready.length;

            return (
              <button
                key={tab.id}
                className={`min-h-10 border-0 text-sm font-medium ${
                  isActive ? "bg-background shadow-sm" : "text-foreground/60"
                }`}
                type="button"
                onClick={() => {
                  setCurrentTab(tab.id);
                  setNotice("");
                }}
              >
                {tab.label}{" "}
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {selectMode && currentTab === "ready" ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-3">
            <button className="min-h-10 px-3 text-sm" onClick={handleSelectAll}>
              {selectedIds.length === ready.length ? "Clear all" : "Select All"}
            </button>
            {selectedIds.length > 0 ? (
              <button
                className="min-h-10 bg-foreground px-3 text-sm font-medium text-background"
                type="button"
                onClick={handleExport}
              >
                Export
              </button>
            ) : null}
          </div>
        ) : null}

        {notice ? <p className="text-sm text-foreground/60">{notice}</p> : null}

        {visibleExpenses.length === 0 ? (
          <p className="rounded-lg border border-foreground/10 p-5 text-sm text-foreground/60">
            {currentTab === "draft"
              ? "No drafts - captured expenses show up here."
              : "Nothing ready yet."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleExpenses.map((expense) => (
              <article
                key={expense.id}
                className="rounded-lg border border-foreground/10 p-4"
              >
                <div className="flex gap-3">
                  {selectMode && currentTab === "ready" ? (
                    <input
                      aria-label={`Select ${displayTitle(expense)}`}
                      checked={selectedSet.has(expense.id)}
                      className="mt-1 h-5 w-5"
                      type="checkbox"
                      onChange={() => toggleSelected(expense.id)}
                    />
                  ) : null}

                  <button
                    className="min-h-0 flex-1 border-0 p-0 text-left"
                    type="button"
                    onClick={() => openReview(expense)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p
                          className={
                            expense.amount === null
                              ? "text-sm text-foreground/45"
                              : "font-semibold"
                          }
                        >
                          {formatAmount(expense.amount)}
                        </p>
                        <h2 className="mt-1 font-medium">
                          {displayTitle(expense)}
                        </h2>
                      </div>
                      <span className="shrink-0 text-xs text-foreground/45">
                        {relativeTime(expense.createdAt)}
                      </span>
                    </div>

                    {currentTab === "ready" ? (
                      <p className="mt-2 text-sm text-foreground/60">
                        {expense.category ?? "other"} ·{" "}
                        {expense.included.join(", ")}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <ConfidenceFlag
                        expense={expense}
                        show={currentTab === "draft"}
                      />
                      <ParseState expense={expense} />
                    </div>
                  </button>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  {expense.parseStatus === "failed" &&
                  currentTab === "draft" ? (
                    <button
                      className="min-h-9 px-3 text-sm text-foreground/65"
                      type="button"
                      onClick={() => handleRetry(expense)}
                    >
                      retry
                    </button>
                  ) : null}
                  <button
                    className="min-h-9 px-3 text-sm text-foreground/65"
                    type="button"
                    onClick={() => handleDelete(expense)}
                  >
                    {deleteConfirmId === expense.id ? "confirm delete" : "delete"}
                  </button>
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
