"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { createTrip } from "@/lib/storage";

type AddPersonResult = {
  members: string[];
  message: string;
  added: boolean;
};

function addPerson(currentMembers: string[], rawName: string): AddPersonResult {
  const name = rawName.trim();

  if (!name) {
    return {
      members: currentMembers,
      message: "",
      added: false,
    };
  }

  if (name.toLowerCase() === "me") {
    return {
      members: currentMembers,
      message: "Me is always included automatically.",
      added: false,
    };
  }

  const alreadyAdded = currentMembers.some(
    (member) => member.toLowerCase() === name.toLowerCase(),
  );

  if (alreadyAdded) {
    return {
      members: currentMembers,
      message: `${name} is already added.`,
      added: false,
    };
  }

  return {
    members: [...currentMembers, name],
    message: "",
    added: true,
  };
}

export default function CreateTripPage() {
  const router = useRouter();
  const personInputRef = useRef<HTMLInputElement>(null);
  const [tripName, setTripName] = useState("");
  const [personName, setPersonName] = useState("");
  const [otherMembers, setOtherMembers] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canStart = tripName.trim().length > 0 && otherMembers.length > 0;

  function handleAddPerson(): void {
    const result = addPerson(otherMembers, personName);

    setOtherMembers(result.members);
    setNote(result.message);

    if (result.added) {
      setPersonName("");
      setError("");
    }

    personInputRef.current?.focus();
  }

  function handlePersonKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddPerson();
    }
  }

  function handleRemovePerson(name: string): void {
    setOtherMembers((members) => members.filter((member) => member !== name));
    setNote("");
  }

  async function handleStartTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || !canStart) {
      return;
    }

    const pendingPerson = addPerson(otherMembers, personName);
    const membersToCreate = pendingPerson.members;

    if (pendingPerson.message) {
      setNote(pendingPerson.message);
    }

    setOtherMembers(membersToCreate);
    setError("");
    setIsSubmitting(true);

    try {
      await createTrip(tripName, membersToCreate);
      router.push("/capture");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start trip.");
      setIsSubmitting(false);
      personInputRef.current?.focus();
    }
  }

  return (
    <main className="min-h-dvh bg-background px-5 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] text-foreground">
      <form
        className="mx-auto flex w-full max-w-md flex-col gap-8"
        onSubmit={handleStartTrip}
      >
        <header>
          <h1 className="text-[2rem] font-semibold leading-tight text-foreground">
            New trip
          </h1>
          <p className="mt-2 max-w-sm text-[0.9375rem] leading-6 text-muted">
            Name the trip and add the people you will split with.
          </p>
        </header>

        <label className="flex flex-col gap-2.5">
          <span className="px-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Trip name
          </span>
          <input
            className="min-h-13 rounded-control border border-border bg-field px-4 text-[1rem] font-medium text-foreground shadow-field outline-none placeholder:text-subtle focus:border-border-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            placeholder="Goa Trip"
            type="text"
            value={tripName}
            onChange={(event) => {
              setTripName(event.target.value);
              setError("");
            }}
          />
        </label>

        <section className="flex flex-col gap-4">
          <label className="flex flex-col gap-2.5">
            <span className="px-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
              Add people
            </span>
            <span className="flex gap-2">
              <input
                ref={personInputRef}
                className="min-h-13 min-w-0 flex-1 rounded-control border border-border bg-field px-4 text-[1rem] text-foreground shadow-field outline-none placeholder:text-subtle focus:border-border-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                placeholder="Aman"
                type="text"
                value={personName}
                onChange={(event) => {
                  setPersonName(event.target.value);
                  setNote("");
                  setError("");
                }}
                onKeyDown={handlePersonKeyDown}
              />
              <Button
                className="min-h-13 shrink-0"
                type="button"
                variant="secondary"
                onClick={handleAddPerson}
              >
                Add
              </Button>
            </span>
          </label>

          <p className="text-[0.8125rem] leading-5 text-muted">
            Me (you) is included automatically. Add only the other people on
            this trip.
          </p>

          {note ? (
            <p className="text-[0.8125rem] text-signal-warm">{note}</p>
          ) : null}

          {otherMembers.length > 0 ? (
            <div className="flex flex-wrap gap-2.5">
              {otherMembers.map((member) => (
                <span
                  key={member}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-border-strong bg-surface px-4 text-[0.875rem] font-medium text-foreground shadow-pill"
                >
                  {member}
                  <button
                    aria-label={`Remove ${member}`}
                    className="flex size-7 min-h-7 items-center justify-center border-0 bg-transparent p-0 text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
                    style={{
                      border: 0,
                      borderRadius: "var(--radius-pill)",
                    }}
                    type="button"
                    onClick={() => handleRemovePerson(member)}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {error ? (
          <p className="text-[0.8125rem] text-signal-warm">{error}</p>
        ) : null}

        <Button
          className="min-h-12 w-full text-base"
          disabled={!canStart || isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Starting..." : "Start Trip"}
        </Button>
      </form>
    </main>
  );
}
