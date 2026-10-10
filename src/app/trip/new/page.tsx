"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/components/button";
import { FieldHint, FieldLabel, inputClasses, selectClasses } from "@/components/field";
import { currencyNames } from "@/lib/currency";
import { useLiveQuery } from "@/lib/hooks";
import { createTrip, getActiveTrip, toTitleCase } from "@/lib/storage";
import { CURRENCY_CODES, type CurrencyCode } from "@/lib/types";

type AddResult = { members: string[]; message: string };

function addPerson(current: string[], rawName: string): AddResult {
  const name = toTitleCase(rawName);

  if (!name) {
    return { members: current, message: "" };
  }

  if (name.toLowerCase() === "me") {
    return { members: current, message: "You’re already in as “Me”." };
  }

  if (current.some((member) => member.toLowerCase() === name.toLowerCase())) {
    return { members: current, message: `${name} is already added.` };
  }

  return { members: [...current, name], message: "" };
}

export default function CreateTripPage() {
  const router = useRouter();
  const personInputRef = useRef<HTMLInputElement>(null);
  const [tripName, setTripName] = useState("");
  const [personName, setPersonName] = useState("");
  const [others, setOthers] = useState<string[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>("INR");
  const [personMessage, setPersonMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: existingTrip } = useLiveQuery(() => getActiveTrip(), []);

  const pending = addPerson(others, personName);
  const hasPeople = pending.members.length > 0;
  const canStart = tripName.trim().length > 0 && hasPeople;

  function commitPerson(): void {
    const result = addPerson(others, personName);

    setOthers(result.members);
    setPersonMessage(result.message);

    if (!result.message) {
      setPersonName("");
    }

    personInputRef.current?.focus();
  }

  function handlePersonKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // Enter adds the typed name; on an empty box it submits the form.
    if (event.key === "Enter" && personName.trim()) {
      event.preventDefault();
      commitPerson();
    }

    if (event.key === "," ) {
      event.preventDefault();
      commitPerson();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isSubmitting) return;

    if (!tripName.trim()) {
      setError("Give the trip a name.");
      return;
    }

    if (!hasPeople) {
      setError("Add at least one person to split with.");
      personInputRef.current?.focus();
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      await createTrip(tripName, pending.members, currency);
      router.push("/capture");
    } catch {
      setError("Couldn’t save the trip on this device. Check that site storage is allowed, then try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-paper px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] text-ink sm:px-6 md:pt-16">
      <main className="mx-auto w-full max-w-lg" id="main">
        <div className="mb-8 flex items-center justify-between gap-4">
          <p className="text-sm font-semibold tracking-tight text-ink">
            Log now<span className="text-ink-3"> · </span>split later
          </p>
          {existingTrip ? (
            <Link
              className="flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-ink-2 hover:bg-sunken hover:text-ink"
              href="/capture"
            >
              Cancel
            </Link>
          ) : null}
        </div>

        <h1 className="text-3xl leading-tight font-semibold tracking-tight">
          Start a trip
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-6 text-ink-2">
          Jot expenses down as they happen. Tidy them up later, then copy a
          reference for entering them in Splitwise.
        </p>

        <form className="mt-8 flex flex-col gap-7" noValidate onSubmit={handleSubmit}>
          <div>
            <FieldLabel htmlFor="trip-name">Trip name</FieldLabel>
            <input
              autoComplete="off"
              autoFocus
              className={inputClasses}
              enterKeyHint="next"
              id="trip-name"
              maxLength={60}
              placeholder="e.g. Goa, March"
              value={tripName}
              onChange={(event) => {
                setTripName(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  personInputRef.current?.focus();
                }
              }}
            />
          </div>

          <div>
            <FieldLabel htmlFor="trip-person" hint="You’re included as “Me”">
              Who’s splitting?
            </FieldLabel>
            <ul aria-label="People on this trip" className="mb-3 flex flex-wrap gap-2">
              <li className="inline-flex min-h-11 items-center rounded-full border border-ink bg-ink px-3.5 text-sm font-medium text-paper">
                Me
              </li>
              {others.map((member) => (
                <li
                  key={member}
                  className="inline-flex min-h-11 items-center gap-0.5 rounded-full border border-rule-strong bg-surface pl-3.5 text-sm font-medium"
                >
                  {member}
                  <button
                    aria-label={`Remove ${member}`}
                    className="flex size-11 items-center justify-center rounded-full text-ink-3 hover:text-ink"
                    type="button"
                    onClick={() => {
                      setOthers((members) => members.filter((name) => name !== member));
                      personInputRef.current?.focus();
                    }}
                  >
                    <svg aria-hidden="true" className="size-3" fill="none" viewBox="0 0 12 12">
                      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                ref={personInputRef}
                aria-describedby="trip-person-hint"
                autoCapitalize="words"
                autoComplete="off"
                className={`${inputClasses} min-w-0 flex-1`}
                enterKeyHint="done"
                id="trip-person"
                maxLength={40}
                placeholder="Add a name"
                value={personName}
                onChange={(event) => {
                  setPersonName(event.target.value);
                  setPersonMessage("");
                  setError("");
                }}
                onKeyDown={handlePersonKeyDown}
              />
              <Button
                className="min-h-12 shrink-0"
                disabled={!personName.trim()}
                variant="secondary"
                onClick={commitPerson}
              >
                Add
              </Button>
            </div>
            <FieldHint id="trip-person-hint" tone={personMessage ? "warn" : "neutral"}>
              {personMessage || "Press Enter after each name. You can add people later too."}
            </FieldHint>
          </div>

          <div>
            <FieldLabel htmlFor="trip-currency">Usual currency</FieldLabel>
            <select
              aria-describedby="trip-currency-hint"
              className={`${selectClasses} sm:max-w-xs`}
              id="trip-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} · {currencyNames[code]}
                </option>
              ))}
            </select>
            <FieldHint id="trip-currency-hint">
              Used when a capture doesn’t name a currency. Each expense can be changed.
            </FieldHint>
          </div>

          {error ? (
            <p className="text-sm font-medium text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            aria-disabled={!canStart}
            className={`w-full ${canStart ? "" : "opacity-60"}`}
            disabled={isSubmitting}
            size="lg"
            type="submit"
          >
            {isSubmitting ? "Starting…" : "Start trip"}
          </Button>
        </form>

        <aside className="mt-10 border-t border-rule pt-5 text-sm leading-6 text-ink-2">
          <h2 className="font-semibold text-ink">Where your data lives</h2>
          <p className="mt-1">
            Trips and expenses are stored only in this browser on this device.
            There’s no account and no cloud copy, so clearing site data deletes
            them. The text you capture is sent to an AI service to read the
            amount and names; nothing is sent to Splitwise.
          </p>
        </aside>
      </main>
    </div>
  );
}
