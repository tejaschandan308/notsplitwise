"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import {
  addDraftExpense,
  getActiveTrip,
  listExpenses,
  requestPersistentStorage,
  updateExpense,
} from "@/lib/storage";
import type { Expense, ParsedExpenseFields, Trip } from "@/lib/types";

type ParseResponse = {
  ok: boolean;
  data: ParsedExpenseFields;
  error?: string;
};

const captureCountKey = "log-now:capture-count";
const hintDismissedKey = "log-now:mic-hint-dismissed";
const persistRequestedKey = "log-now:persistent-storage-requested";

function readNumber(key: string): number {
  const value = window.localStorage.getItem(key);
  const parsed = value ? Number(value) : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldShowMicHint(): boolean {
  return (
    readNumber(captureCountKey) < 4 &&
    window.localStorage.getItem(hintDismissedKey) !== "true"
  );
}

async function parseDraftInBackground(
  draft: Expense,
  rawText: string,
  members: string[],
  peopleLocked: boolean,
  lockedIncluded: string[],
): Promise<void> {
  try {
    const response = await fetch("/api/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rawText,
        members,
        ...(peopleLocked ? { peopleLocked, lockedIncluded } : {}),
      }),
    });
    const result = (await response.json()) as ParseResponse;

    if (result.ok) {
      await updateExpense(draft.id, {
        ...result.data,
        parseStatus: "done",
      });
      return;
    }
  } catch {
    // Failed parsing should never undo the local draft.
  }

  await updateExpense(draft.id, { parseStatus: "failed" });
}

export default function CapturePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [rawText, setRawText] = useState("");
  const [draftCount, setDraftCount] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [pillsTouched, setPillsTouched] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  async function refreshDraftCount(tripId: string): Promise<void> {
    const drafts = await listExpenses(tripId, "draft");
    setDraftCount(drafts.length);
  }

  useEffect(() => {
    let ignore = false;

    async function loadCaptureState(): Promise<void> {
      const trip = await getActiveTrip();

      if (!trip) {
        router.replace("/trip/new");
        return;
      }

      const drafts = await listExpenses(trip.id, "draft");

      if (!ignore) {
        setActiveTrip(trip);
        setSelectedMembers(trip.members);
        setDraftCount(drafts.length);
        setShowHint(shouldShowMicHint());
        setIsLoading(false);
      }
    }

    loadCaptureState();

    return () => {
      ignore = true;
    };
  }, [router]);

  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  function retireHintAfterSave(): void {
    const nextCount = readNumber(captureCountKey) + 1;
    window.localStorage.setItem(captureCountKey, String(nextCount));

    if (nextCount >= 4) {
      setShowHint(false);
    }
  }

  function requestPersistenceOnce(): void {
    if (window.localStorage.getItem(persistRequestedKey) === "true") {
      return;
    }

    window.localStorage.setItem(persistRequestedKey, "true");
    void requestPersistentStorage().catch(() => undefined);
  }

  function toggleMember(member: string): void {
    const baseSelection = pillsTouched
      ? selectedMembers
      : activeTrip?.members ?? [];

    setPillsTouched(true);
    setSelectedMembers(
      baseSelection.includes(member)
        ? baseSelection.filter((name) => name !== member)
        : [...baseSelection, member],
    );
  }

  function toggleAllMembers(): void {
    if (!activeTrip) {
      return;
    }

    const allSelected = activeTrip.members.every((member) =>
      selectedMembers.includes(member),
    );

    setPillsTouched(true);
    setSelectedMembers(
      allSelected
        ? activeTrip.members.filter((member) => member === "Me")
        : activeTrip.members,
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const capture = rawText.trim();

    if (!capture || !activeTrip || isSaving) {
      return;
    }

    const peopleLocked = pillsTouched;
    const lockedIncluded = [...selectedMembers];

    setIsSaving(true);
    setError("");

    try {
      const draft = await addDraftExpense(activeTrip.id, capture);

      setRawText("");
      setPillsTouched(false);
      setSelectedMembers(activeTrip.members);
      setSaveMessage("Saved");
      retireHintAfterSave();
      requestPersistenceOnce();
      await refreshDraftCount(activeTrip.id);
      inputRef.current?.focus();

      void parseDraftInBackground(
        draft,
        capture,
        activeTrip.members,
        peopleLocked,
        lockedIncluded,
      ).catch(() => undefined);
      window.setTimeout(() => setSaveMessage(""), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save capture.");
    } finally {
      setIsSaving(false);
      inputRef.current?.focus();
    }
  }

  function dismissHint(): void {
    window.localStorage.setItem(hintDismissedKey, "true");
    setShowHint(false);
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

  if (!activeTrip) {
    return null;
  }

  return (
    <AppShell>
      <section className="flex min-h-[calc(100dvh-8rem)] flex-col justify-between gap-8 pt-4">
        <div>
          <button
            className="mb-8 min-h-10 border-0 px-0 text-left text-sm font-medium text-foreground/70"
            type="button"
            // TODO: wire trip switching in a later phase.
            onClick={() => undefined}
          >
            {activeTrip.name}
          </button>

          <form className="flex flex-col gap-3" onSubmit={handleSave}>
            <label className="sr-only" htmlFor="capture-text">
              Expense capture
            </label>
            <textarea
              ref={inputRef}
              autoFocus
              className="min-h-36 resize-none rounded-lg border border-foreground/15 bg-transparent px-4 py-4 text-lg leading-7 outline-none focus:border-foreground/45"
              id="capture-text"
              placeholder="e.g. 1240 airport lunch, me + Aman"
              value={rawText}
              onChange={(event) => {
                setRawText(event.target.value);
                setError("");
              }}
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">People</p>
                <button
                  className="min-h-11 px-2 text-sm font-medium text-foreground/70"
                  type="button"
                  onClick={toggleAllMembers}
                >
                  {activeTrip.members.every((member) =>
                    selectedMembers.includes(member),
                  )
                    ? "Clear"
                    : "Everyone"}
                </button>
              </div>
              <div
                aria-label="People included"
                className="flex flex-wrap gap-2"
              >
                {activeTrip.members.map((member) => {
                  const isSelected = selectedMembers.includes(member);

                  return (
                    <button
                      key={member}
                      aria-pressed={pillsTouched ? isSelected : undefined}
                      className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                        !pillsTouched
                          ? "border-foreground/20 bg-transparent text-foreground/50"
                          : isSelected
                            ? "border-foreground bg-foreground text-background"
                            : "border-foreground/25 bg-transparent text-foreground/70"
                      }`}
                      type="button"
                      onClick={() => toggleMember(member)}
                    >
                      {pillsTouched && isSelected ? (
                        <span aria-hidden="true" className="mr-1">
                          {"\u2713"}
                        </span>
                      ) : null}
                      {member}
                    </button>
                  );
                })}
              </div>
              {!pillsTouched ? (
                <p className="text-xs text-foreground/55">
                  Defaults to everyone, or uses people named in your text.
                </p>
              ) : null}
            </div>
            <button
              className="min-h-12 rounded-md bg-foreground px-4 text-base font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!rawText.trim() || isSaving}
              type="submit"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </form>

          {showHint ? (
            <div className="mt-3 flex items-start justify-between gap-3 text-sm text-foreground/60">
              <p>Type it, or tap mic on your keyboard to speak.</p>
              <button
                aria-label="Dismiss mic hint"
                className="min-h-7 border-0 px-1 text-foreground/50"
                type="button"
                onClick={dismissHint}
              >
                x
              </button>
            </div>
          ) : null}

          {saveMessage ? (
            <p className="mt-3 text-sm text-foreground/70">{saveMessage}</p>
          ) : null}

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </div>

        {draftCount > 0 ? (
          <Link
            className="self-start text-sm font-medium text-foreground/70"
            href="/inbox"
          >
            {`${draftCount} ${
              draftCount === 1 ? "draft" : "drafts"
            } waiting ->`}
          </Link>
        ) : null}
      </section>
    </AppShell>
  );
}
