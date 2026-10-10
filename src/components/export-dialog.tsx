"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { buildExportText } from "@/lib/export";
import { archiveExpenses, getExportableExpenses } from "@/lib/storage";
import type { Expense } from "@/lib/types";
import { hasUnsavedDifferences, readUnsavedEdits } from "@/lib/unsaved-edits";

type ExportDialogProps = {
  tripName: string;
  expenses: Expense[];
  onClose: () => void;
  onArchived: (count: number) => void;
};

export function ExportDialog({
  tripName,
  expenses,
  onClose,
  onArchived,
}: ExportDialogProps) {
  const copyRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed" | "changed">("idle");
  const [archiveStatus, setArchiveStatus] = useState<"idle" | "working" | "failed">("idle");
  const [openedWith] = useState(expenses.length);
  // What storage held at the last copy check, when it differed from the
  // list passed in. A newer list from the parent replaces it again.
  const [verified, setVerified] = useState<{ from: Expense[]; list: Expense[] } | null>(null);
  const shown = verified && verified.from === expenses ? verified.list : expenses;
  const text = useMemo(() => buildExportText(tripName, shown), [tripName, shown]);
  const count = shown.length;
  const noun = count === 1 ? "expense" : "expenses";
  const dropped = Math.max(0, openedWith - count);

  function selectText(): void {
    textRef.current?.focus();
    textRef.current?.select();
  }

  async function copy(): Promise<void> {
    // Check the stored records again right before copying. If anything
    // changed or stopped being valid since this text was built, copy nothing
    // and show the current text instead, for the person to check first.
    try {
      // Also leave out anything with an edit on this device that hasn't
      // reached storage: its stored values are out of date.
      const unsaved = readUnsavedEdits();
      const current = (await getExportableExpenses(shown.map((expense) => expense.id))).filter(
        (expense) => !hasUnsavedDifferences(expense, unsaved[expense.id]),
      );

      if (buildExportText(tripName, current) !== text) {
        setVerified({ from: expenses, list: current });
        setCopyStatus("changed");
        return;
      }
    } catch {
      setCopyStatus("changed");
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
      selectText();
    }
  }

  async function archive(): Promise<void> {
    setArchiveStatus("working");

    try {
      const archived = await archiveExpenses(shown.map((expense) => expense.id));
      onArchived(archived);
    } catch {
      setArchiveStatus("failed");
    }
  }

  return (
    <Dialog
      description="A reference for entering these by hand in Splitwise. Nothing is sent to or imported into Splitwise."
      initialFocusRef={copyRef}
      title={count === 0 ? "Nothing to export" : `Export ${count} ${noun}`}
      onClose={onClose}
    >
      {dropped > 0 ? (
        <p className="mb-3 text-sm text-ink-2" role="status">
          {dropped === 1 ? "1 expense was" : `${dropped} expenses were`} left out
          because {dropped === 1 ? "it" : "they"} changed and {dropped === 1 ? "isn’t" : "aren’t"} ready
          any more.
        </p>
      ) : null}
      {count === 0 ? (
        <div>
          <p className="text-sm leading-6 text-ink-2">
            Nothing left to export. Check the expenses in Drafts and mark them ready again.
          </p>
          <Button ref={copyRef} className="mt-4 w-full sm:w-auto" size="lg" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor="export-text">
            Export text
          </label>
          <textarea
            ref={textRef}
            className="block h-[min(22rem,42dvh)] w-full resize-none rounded-control border border-rule bg-paper p-3.5 font-mono text-[0.8125rem] leading-6 text-ink focus:border-accent focus:outline-none"
            id="export-text"
            readOnly
            spellCheck={false}
            value={text}
          />

          <div aria-live="polite" className="min-h-6 pt-2 text-sm">
            {copyStatus === "copied" ? (
              <p className="flex items-center gap-2 font-semibold text-accent">
                <span aria-hidden="true">✓</span> Copied. Paste it next to Splitwise while you enter each one.
              </p>
            ) : null}
            {copyStatus === "changed" ? (
              <p className="text-danger">
                Some of these changed since the text was made. Nothing was copied.
                Check the text above, then copy again.
              </p>
            ) : null}
            {copyStatus === "failed" ? (
              <p className="text-danger">
                Couldn’t copy automatically. The text above is selected: press
                Ctrl+C (⌘C on Mac), or long-press it and choose Copy.
              </p>
            ) : null}
          </div>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button ref={copyRef} className="w-full sm:w-auto" size="lg" onClick={() => void copy()}>
              {copyStatus === "copied" ? "Copy again" : "Copy text"}
            </Button>
            <Button className="w-full sm:w-auto" size="lg" variant="secondary" onClick={selectText}>
              Select all
            </Button>
          </div>

          <section aria-labelledby="archive-heading" className="mt-6 border-t border-rule pt-4">
            <h3 className="text-sm font-semibold text-ink" id="archive-heading">
              After you’ve entered them in Splitwise
            </h3>
            <p className="mt-1 text-sm leading-6 text-ink-2">
              Archive moves these {count} {noun} out of Ready. Keeping them leaves
              everything as it is.
            </p>
            {archiveStatus === "failed" ? (
              <p className="mt-2 text-sm text-danger" role="alert">
                Couldn’t archive. Nothing was changed; try again.
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                disabled={archiveStatus === "working"}
                variant="secondary"
                onClick={() => void archive()}
              >
                {archiveStatus === "working" ? "Archiving…" : `Archive ${count}`}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Keep in Ready
              </Button>
            </div>
          </section>
        </>
      )}
    </Dialog>
  );
}
