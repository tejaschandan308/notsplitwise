"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { Button } from "@/components/button";
import { MemberPill } from "@/components/member-pill";
import { TopBar } from "@/components/top-bar";
import {
  addDraftExpense,
  addTripMember,
  getActiveTrip,
  getExpense,
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

function resolveLockedSelection(
  selection: string[],
  members: string[],
): string[] {
  const included = members.filter((member) => selection.includes(member));

  if (included.length > 0) {
    return included;
  }

  return members.includes("Me") ? ["Me"] : [...members];
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
      const persistedDraft = await getExpense(draft.id);

      if (!persistedDraft) {
        return;
      }

      const persistedLockedIncluded =
        Array.isArray(persistedDraft.lockedIncluded) &&
        persistedDraft.lockedIncluded.length > 0
          ? persistedDraft.lockedIncluded
          : persistedDraft.included;
      const parsedUpdate = persistedDraft.peopleLocked
        ? {
            ...result.data,
            included: persistedLockedIncluded,
            unmatchedNames: [],
          }
        : result.data;

      await updateExpense(draft.id, {
        ...parsedUpdate,
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
  const memberInputRef = useRef<HTMLInputElement>(null);
  const pillsTouchedRef = useRef(false);
  const selectedMembersRef = useRef<string[]>([]);
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
  const [isMemberInputOpen, setIsMemberInputOpen] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [memberMessage, setMemberMessage] = useState("");
  const [isAddingMember, setIsAddingMember] = useState(false);

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
        selectedMembersRef.current = trip.members;
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

  useEffect(() => {
    if (isMemberInputOpen) {
      memberInputRef.current?.focus();
    }
  }, [isMemberInputOpen]);

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
    const baseSelection = pillsTouchedRef.current
      ? selectedMembersRef.current
      : activeTrip?.members ?? [];
    const nextSelection = baseSelection.includes(member)
      ? baseSelection.filter((name) => name !== member)
      : [...baseSelection, member];

    pillsTouchedRef.current = true;
    selectedMembersRef.current = nextSelection;
    setPillsTouched(true);
    setSelectedMembers(nextSelection);
  }

  function toggleAllMembers(): void {
    if (!activeTrip) {
      return;
    }

    const allSelected = activeTrip.members.every((member) =>
      selectedMembersRef.current.includes(member),
    );
    const shouldClear = pillsTouchedRef.current && allSelected;
    const nextSelection = shouldClear
      ? activeTrip.members.filter((member) => member === "Me")
      : activeTrip.members;

    pillsTouchedRef.current = true;
    selectedMembersRef.current = nextSelection;
    setPillsTouched(true);
    setSelectedMembers(nextSelection);
  }

  async function handleAddMember(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const name = memberName.trim();

    if (!name) {
      setMemberMessage("Enter a name");
      return;
    }

    if (!activeTrip || isAddingMember) {
      return;
    }

    setIsAddingMember(true);
    setMemberMessage("");

    try {
      const updatedTrip = await addTripMember(activeTrip.id, name);

      if (updatedTrip.members.length === activeTrip.members.length) {
        setMemberMessage("Already added");
        return;
      }

      const addedMembers = updatedTrip.members.filter(
        (member) => !activeTrip.members.includes(member),
      );
      const nextSelection = pillsTouchedRef.current
        ? [...selectedMembersRef.current, ...addedMembers]
        : updatedTrip.members;

      selectedMembersRef.current = nextSelection;
      setSelectedMembers(nextSelection);
      setActiveTrip(updatedTrip);
      setMemberName("");
      setMemberMessage("");
      setIsMemberInputOpen(false);
    } catch {
      setMemberMessage("Could not add member");
    } finally {
      setIsAddingMember(false);
    }
  }

  function closeMemberInput(): void {
    setMemberName("");
    setMemberMessage("");
    setIsMemberInputOpen(false);
    inputRef.current?.focus();
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const capture = rawText.trim();

    if (!capture || !activeTrip || isSaving) {
      return;
    }

    const latestPillsTouched = pillsTouchedRef.current;
    const selection = [...selectedMembersRef.current];
    const peopleLockedSent = latestPillsTouched;
    const lockedIncludedSent = peopleLockedSent
      ? resolveLockedSelection(selection, activeTrip.members)
      : [];

    setIsSaving(true);
    setError("");

    try {
      const draft = await addDraftExpense(activeTrip.id, capture);

      if (peopleLockedSent) {
        await updateExpense(draft.id, {
          included: lockedIncludedSent,
          peopleLocked: true,
          lockedIncluded: lockedIncludedSent,
          unmatchedNames: [],
        });
      }

      setRawText("");
      pillsTouchedRef.current = false;
      selectedMembersRef.current = activeTrip.members;
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
        peopleLockedSent,
        lockedIncludedSent,
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

  const allMembersSelected = activeTrip.members.every((member) =>
    selectedMembers.includes(member),
  );
  const toggleAllLabel =
    pillsTouched && allMembersSelected ? "Clear" : "Everyone";

  return (
    <AppShell>
      <section className="flex min-h-[calc(100dvh-8rem)] flex-col pt-1">
        <TopBar
          isAddMemberOpen={isMemberInputOpen}
          tripName={activeTrip.name}
          // TODO: wire trip switching in a later phase.
          onTripClick={() => undefined}
          onAddMemberClick={() => {
            if (isMemberInputOpen) {
              closeMemberInput();
            } else {
              setMemberMessage("");
              setIsMemberInputOpen(true);
            }
          }}
        />

        {isMemberInputOpen ? (
          <form
            className="mt-3 flex flex-wrap items-start gap-2 rounded-control border border-border bg-surface p-3 shadow-field"
            onSubmit={handleAddMember}
          >
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="new-trip-member">
                New trip member
              </label>
              <input
                ref={memberInputRef}
                className="min-h-11 w-full rounded-control border border-border bg-field px-3 text-[0.9375rem] text-foreground outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-focus"
                id="new-trip-member"
                placeholder="Name"
                value={memberName}
                onChange={(event) => {
                  setMemberName(event.target.value);
                  setMemberMessage("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {memberMessage ? (
                <p className="mt-1.5 text-xs text-signal-warm">
                  {memberMessage}
                </p>
              ) : null}
            </div>
            <Button
              className="px-3"
              disabled={isAddingMember}
              type="submit"
              variant="secondary"
            >
              {isAddingMember ? "Adding..." : "Add"}
            </Button>
            <Button
              className="px-3"
              type="button"
              variant="ghost"
              onClick={closeMemberInput}
            >
              Cancel
            </Button>
          </form>
        ) : null}

        <div className="mt-20 sm:mt-24">
          <form className="flex flex-col" onSubmit={handleSave}>
            <label
              className="mb-3 px-1 text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-muted"
              htmlFor="capture-text"
            >
              Add an expense
            </label>
            <textarea
              ref={inputRef}
              autoFocus
              className="min-h-56 resize-none rounded-[1.25rem] border border-border bg-field px-6 py-7 text-[2rem] font-medium leading-[1.42] text-foreground shadow-field outline-none transition-colors placeholder:text-subtle focus:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
              id="capture-text"
              placeholder="e.g. 1240 airport lunch, me + Aman"
              value={rawText}
              onChange={(event) => {
                setRawText(event.target.value);
                setError("");
              }}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <div
                aria-label="People included"
                className="contents"
              >
                {activeTrip.members.map((member) => {
                  const state = selectedMembers.includes(member)
                    ? "selected"
                    : "unselected";

                  return (
                    <MemberPill
                      key={member}
                      name={member}
                      state={state}
                      onClick={() => toggleMember(member)}
                    />
                  );
                })}
              </div>
              <button
                className="ml-1 inline-flex min-h-11 items-center border-y-0 border-r-0 border-l border-border bg-transparent px-4 text-[0.9375rem] font-semibold text-foreground outline-none transition-colors hover:text-muted focus-visible:ring-2 focus-visible:ring-focus"
                type="button"
                onClick={toggleAllMembers}
              >
                {toggleAllLabel}
              </button>
            </div>
            <Button
              className="mt-5 min-h-[3.25rem] w-full text-base"
              disabled={!rawText.trim() || isSaving}
              type="submit"
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </form>

          {showHint ? (
            <div className="mt-4 flex min-h-8 items-center justify-between gap-3 text-[0.8125rem] text-muted">
              <p className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="relative inline-block h-4 w-3"
                >
                  <span className="absolute left-1 top-0 h-2.5 w-1.5 rounded-full border border-current" />
                  <span className="absolute bottom-0 left-0 h-2 w-3 rounded-b-full border-b border-l border-r border-current" />
                </span>
                Type it, or tap the mic on your keyboard to speak.
              </p>
              <button
                aria-label="Dismiss mic hint"
                className="flex size-11 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-subtle outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
                type="button"
                onClick={dismissHint}
              >
                x
              </button>
            </div>
          ) : null}

          <div className="mt-1 min-h-6" aria-live="polite">
            {saveMessage ? (
              <p className="capture-saved-feedback flex items-center gap-2 text-[0.8125rem] font-medium text-muted">
                <span
                  aria-hidden="true"
                  className="flex size-4 items-center justify-center rounded-full border border-border-strong text-[0.625rem]"
                >
                  {"\u2713"}
                </span>
                {saveMessage}
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="mt-2 text-[0.8125rem] text-signal-warm">{error}</p>
          ) : null}
        </div>

        {draftCount > 0 ? (
          <Link
            className="mt-auto self-center px-3 py-3 text-[0.875rem] font-medium text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            href="/inbox"
          >
            {`${draftCount} ${
              draftCount === 1 ? "draft" : "drafts"
            } waiting \u2192`}
          </Link>
        ) : null}
      </section>
    </AppShell>
  );
}
