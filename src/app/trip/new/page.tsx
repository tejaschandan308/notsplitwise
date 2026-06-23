"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
    <main className="min-h-dvh bg-background px-5 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] text-foreground">
      <form
        className="mx-auto flex w-full max-w-md flex-col gap-7"
        onSubmit={handleStartTrip}
      >
        <header>
          <h1 className="text-3xl font-semibold">New trip</h1>
          <p className="mt-2 text-sm text-foreground/65">
            Name the trip and add the people you will split with.
          </p>
        </header>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Trip name</span>
          <input
            className="min-h-11 rounded-md border border-foreground/15 bg-transparent px-3 text-base outline-none focus:border-foreground/45"
            placeholder="Goa Trip"
            type="text"
            value={tripName}
            onChange={(event) => {
              setTripName(event.target.value);
              setError("");
            }}
          />
        </label>

        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Add people</span>
            <span className="flex gap-2">
              <input
                ref={personInputRef}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/15 bg-transparent px-3 text-base outline-none focus:border-foreground/45"
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
              <button
                className="min-h-11 px-4 text-sm font-medium"
                type="button"
                onClick={handleAddPerson}
              >
                Add
              </button>
            </span>
          </label>

          <p className="text-sm text-foreground/60">
            Me (you) is included automatically. Add only the other people on
            this trip.
          </p>

          {note ? <p className="text-sm text-foreground/75">{note}</p> : null}

          {otherMembers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {otherMembers.map((member) => (
                <span
                  key={member}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full border border-foreground/15 px-3 text-sm"
                >
                  {member}
                  <button
                    aria-label={`Remove ${member}`}
                    className="min-h-7 rounded-full border-0 px-1 text-foreground/55"
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

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          className="min-h-12 rounded-md bg-foreground px-4 text-base font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canStart || isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Starting..." : "Start Trip"}
        </button>
      </form>
    </main>
  );
}
