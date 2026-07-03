"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { listTrips, setActiveTrip } from "@/lib/storage";
import type { Trip } from "@/lib/types";

type TopBarProps = {
  tripName: string;
  backHref?: string;
  isAddMemberOpen?: boolean;
  onAddMemberClick?: () => void;
};

type Theme = "light" | "dark";

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function TopBar({
  tripName,
  backHref,
  isAddMemberOpen = false,
  onAddMemberClick,
}: TopBarProps) {
  const router = useRouter();
  const tripMenuRef = useRef<HTMLDivElement>(null);
  const tripTriggerRef = useRef<HTMLButtonElement>(null);
  const [isTripMenuOpen, setIsTripMenuOpen] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const [tripMenuMessage, setTripMenuMessage] = useState("");
  const [switchingTripId, setSwitchingTripId] = useState<string | null>(null);

  useEffect(() => {
    if (!isTripMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (
        tripMenuRef.current &&
        !tripMenuRef.current.contains(event.target as Node)
      ) {
        setIsTripMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsTripMenuOpen(false);
        tripTriggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTripMenuOpen]);

  function toggleTheme(): void {
    const nextTheme: Theme = readTheme() === "dark" ? "light" : "dark";
    const root = document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(nextTheme);
    window.localStorage.setItem("log-now:theme", nextTheme);
  }

  async function toggleTripMenu(): Promise<void> {
    if (isTripMenuOpen) {
      setIsTripMenuOpen(false);
      return;
    }

    setIsTripMenuOpen(true);
    setIsLoadingTrips(true);
    setTripMenuMessage("");

    try {
      setTrips(await listTrips());
    } catch {
      setTripMenuMessage("Could not load trips.");
    } finally {
      setIsLoadingTrips(false);
    }
  }

  async function handleTripSelect(trip: Trip): Promise<void> {
    setIsTripMenuOpen(false);

    if (trip.isActive) {
      return;
    }

    setSwitchingTripId(trip.id);

    try {
      await setActiveTrip(trip.id);
      window.location.assign("/capture");
    } catch {
      setSwitchingTripId(null);
      setTripMenuMessage("Could not switch trips.");
      setIsTripMenuOpen(true);
    }
  }

  function handleNewTrip(): void {
    setIsTripMenuOpen(false);
    router.push("/trip/new");
  }

  return (
    <header className="flex min-h-12 items-center justify-between gap-4">
      {backHref ? (
        <Link
          className="flex min-h-11 min-w-0 items-center gap-3 rounded-control px-1 text-[0.8125rem] font-medium text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
          href={backHref}
          style={{ borderRadius: "var(--radius-control)" }}
        >
          <span
            aria-hidden="true"
            className="size-2.5 rotate-45 border-b border-l border-current"
          />
          <span className="truncate">{tripName}</span>
        </Link>
      ) : (
        <div ref={tripMenuRef} className="relative min-w-0">
          <button
            ref={tripTriggerRef}
            aria-controls="trip-switcher-menu"
            aria-expanded={isTripMenuOpen}
            aria-haspopup="menu"
            className="group flex min-h-11 min-w-0 items-center gap-2 rounded-control border-0 bg-transparent px-1 text-left text-[1.125rem] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
            style={{
              border: 0,
              borderRadius: "var(--radius-control)",
            }}
            type="button"
            onClick={() => void toggleTripMenu()}
          >
            <span className="truncate">{tripName}</span>
            <span
              aria-hidden="true"
              className={`size-2.5 rotate-45 border-b border-r border-muted transition-transform ${
                isTripMenuOpen
                  ? "-translate-y-0.5 rotate-[225deg]"
                  : "group-hover:translate-y-0.5"
              }`}
            />
          </button>

          {isTripMenuOpen ? (
            <div
              id="trip-switcher-menu"
              className="absolute top-full left-0 z-40 mt-2 w-[min(20rem,calc(100vw-2.5rem))] min-w-64 overflow-hidden rounded-control border border-border bg-surface shadow-field"
              role="menu"
              aria-label="Switch trip"
              style={{ borderRadius: "var(--radius-control)" }}
            >
              <div className="max-h-72 overflow-y-auto p-1.5">
                {isLoadingTrips ? (
                  <p className="px-3 py-3 text-[0.8125rem] text-muted">
                    Loading trips...
                  </p>
                ) : null}

                {!isLoadingTrips
                  ? trips.map((trip) => (
                      <button
                        key={trip.id}
                        aria-current={trip.isActive ? "true" : undefined}
                        className="flex min-h-14 w-full items-center justify-between gap-4 border-0 bg-transparent px-3 py-2 text-left outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait"
                        disabled={switchingTripId !== null}
                        role="menuitem"
                        style={{
                          border: 0,
                          borderRadius: "var(--radius-control)",
                        }}
                        type="button"
                        onClick={() => void handleTripSelect(trip)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[0.9375rem] font-medium text-foreground">
                            {trip.name}
                          </span>
                          <span className="mt-0.5 block text-[0.75rem] text-muted">
                            {trip.members.length}{" "}
                            {trip.members.length === 1 ? "member" : "members"}
                          </span>
                        </span>
                        {trip.isActive ? (
                          <span
                            aria-label="Active trip"
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[0.75rem] font-semibold text-accent-contrast"
                          >
                            {"\u2713"}
                          </span>
                        ) : null}
                      </button>
                    ))
                  : null}

                {tripMenuMessage ? (
                  <p className="px-3 py-2 text-[0.8125rem] text-muted">
                    {tripMenuMessage}
                  </p>
                ) : null}
              </div>

              <div className="border-t border-border p-1.5">
                <button
                  className="flex min-h-11 w-full items-center gap-2 border-0 bg-transparent px-3 text-left text-[0.875rem] font-medium text-foreground outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
                  role="menuitem"
                  style={{
                    border: 0,
                    borderRadius: "var(--radius-control)",
                  }}
                  type="button"
                  onClick={handleNewTrip}
                >
                  <span aria-hidden="true" className="text-muted">
                    +
                  </span>
                  New trip
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex items-center">
        {onAddMemberClick ? (
          <button
            aria-expanded={isAddMemberOpen}
            aria-label="Add trip member"
            className="flex size-11 items-center justify-center rounded-control border-0 bg-transparent text-foreground outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
            style={{ borderRadius: "var(--radius-control)" }}
            title="Add trip member"
            type="button"
            onClick={onAddMemberClick}
          >
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M14.5 19.5v-1.25a4.25 4.25 0 0 0-4.25-4.25H6.5a4.25 4.25 0 0 0-4.25 4.25v1.25M8.38 10a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM18.5 7v6M15.5 10h6"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        ) : null}

        {onAddMemberClick ? (
          <span aria-hidden="true" className="mx-1 h-7 w-px bg-border" />
        ) : null}

        <button
          aria-label="Toggle color theme"
          className="flex size-11 items-center justify-center rounded-full border border-border bg-surface text-foreground outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
          title="Toggle color theme"
          type="button"
          onClick={toggleTheme}
        >
          <span
            aria-hidden="true"
            className="relative size-5 overflow-hidden rounded-full border border-current"
          >
            <span className="absolute inset-y-0 right-0 w-1/2 bg-current" />
          </span>
        </button>
      </div>
    </header>
  );
}
