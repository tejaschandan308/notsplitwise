"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { selectClasses } from "@/components/field";
import { currencyNames } from "@/lib/currency";
import { useLiveQuery, useOnline } from "@/lib/hooks";
import {
  getActiveTrip,
  listExpenses,
  listTrips,
  setActiveTrip,
  setTripCurrency,
} from "@/lib/storage";
import { CURRENCY_CODES, type CurrencyCode, type Trip } from "@/lib/types";

/** Active trip, kept live so switching trips updates every screen. */
export function useActiveTrip() {
  return useLiveQuery(() => getActiveTrip(), []);
}

export function useDraftCount(): number {
  const { data } = useLiveQuery(async () => {
    const trip = await getActiveTrip();

    return trip ? (await listExpenses(trip.id, "draft")).length : 0;
  }, []);

  return data ?? 0;
}

type Theme = "light" | "dark";

function subscribeTheme(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light");
  const next: Theme = theme === "dark" ? "light" : "dark";

  function toggle(): void {
    const root = document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(next);

    try {
      window.localStorage.setItem("log-now:theme", next);
    } catch {
      // Theme still applies for this visit.
    }
  }

  return (
    <button
      aria-label={`Switch to ${next} theme`}
      className="flex size-11 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
      title={`Switch to ${next} theme`}
      type="button"
      onClick={toggle}
    >
      <svg aria-hidden="true" className="size-[1.15rem]" fill="none" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor" />
      </svg>
    </button>
  );
}

function TripSwitcher({ trip }: { trip: Trip | undefined }) {
  const router = useRouter();
  const panelId = useId();
  const currencyId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { data: trips } = useLiveQuery(() => listTrips(), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = panelRef.current;
    (
      panel?.querySelector<HTMLElement>('[aria-current="true"]') ??
      panel?.querySelector<HTMLElement>("button, a, select")
    )?.focus();

    function handlePointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    if ((event.target as HTMLElement).tagName === "SELECT") {
      return;
    }

    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>("[data-trip-item]") ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;

    event.preventDefault();
    items[(index + delta + items.length) % items.length]?.focus();
  }

  async function switchTo(target: Trip): Promise<void> {
    if (target.isActive) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    try {
      await setActiveTrip(target.id);
      setOpen(false);
      setMessage("");
      router.push("/capture");
    } catch {
      setMessage("Couldn’t switch trips. Try again.");
    }
  }

  async function changeCurrency(currency: CurrencyCode): Promise<void> {
    if (!trip) return;

    try {
      await setTripCurrency(trip.id, currency);
      setMessage(`New captures will use ${currency}. Saved expenses keep theirs.`);
    } catch {
      setMessage("Couldn’t save the currency. Try again.");
    }
  }

  return (
    <div ref={containerRef} className="relative -ml-2 min-w-0">
      <button
        ref={triggerRef}
        aria-controls={panelId}
        aria-expanded={open}
        className="group flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-control px-2 text-left transition-colors hover:bg-sunken"
        type="button"
        onClick={() => {
          setMessage("");
          setOpen((value) => !value);
        }}
      >
        <span className="min-w-0">
          <span className="block text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-3 uppercase">
            Trip
          </span>
          <span className="block truncate text-base leading-tight font-semibold text-ink">
            {trip?.name ?? "…"}
          </span>
        </span>
        <svg
          aria-hidden="true"
          className={`mt-3 size-3 shrink-0 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 12 8"
        >
          <path d="M1 1.5l5 5 5-5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </svg>
        <span className="sr-only">, switch trip</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          aria-label="Trips"
          className="rise-in absolute top-full left-0 z-40 mt-1.5 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-rule bg-surface shadow-raised"
          id={panelId}
          role="region"
          onKeyDown={moveFocus}
        >
          <ul className="max-h-72 overflow-y-auto p-1.5">
            {(trips ?? []).map((item) => (
              <li key={item.id}>
                <button
                  aria-current={item.isActive ? "true" : undefined}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sunken"
                  data-trip-item
                  type="button"
                  onClick={() => void switchTo(item)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9375rem] font-medium text-ink">
                      {item.name}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {item.members.length} people · {item.currency}
                    </span>
                  </span>
                  {item.isActive ? (
                    <span className="text-xs font-semibold text-accent">Current</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {trip ? (
            <div className="border-t border-rule px-3 py-3">
              <label className="mb-1 block text-xs font-semibold text-ink-2" htmlFor={currencyId}>
                Default currency for {trip.name}
              </label>
              <select
                className={`${selectClasses} min-h-11 text-sm`}
                id={currencyId}
                value={trip.currency}
                onChange={(event) =>
                  void changeCurrency(event.target.value as CurrencyCode)
                }
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} · {currencyNames[code]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {message ? (
            <p aria-live="polite" className="px-4 pb-2 text-xs text-ink-2">
              {message}
            </p>
          ) : null}

          <div className="border-t border-rule p-1.5">
            <Link
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-sunken"
              data-trip-item
              href="/trip/new"
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true" className="text-ink-3">+</span>
              New trip
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DesktopNav() {
  const pathname = usePathname();
  const draftCount = useDraftCount();

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {[
        { href: "/capture", label: "Capture" },
        { href: "/inbox", label: "Inbox" },
      ].map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-control px-3.5 text-sm font-semibold transition-colors ${
              active ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken hover:text-ink"
            }`}
            href={item.href}
          >
            {item.label}
            {item.href === "/inbox" && draftCount > 0 ? (
              <span className="text-xs tabular-nums opacity-80">
                {draftCount}
                <span className="sr-only"> drafts</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function OfflineIndicator() {
  const online = useOnline();

  if (online) {
    return null;
  }

  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-rule-strong px-2.5 text-xs font-semibold text-ink-2"
      role="status"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full border border-ink-2" />
      Offline
      <span className="sr-only">. Captures are saved on this device.</span>
    </span>
  );
}

type TopBarProps = {
  /**
   * Replaces the trip switcher with a back link (e.g. on Review).
   * `onNavigate` can cancel the navigation with `event.preventDefault()`.
   */
  back?: {
    href: string;
    label: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  };
  /** Extra controls, shown before the theme toggle. */
  actions?: ReactNode;
};

export function TopBar({ back, actions }: TopBarProps) {
  const { data: trip } = useActiveTrip();

  return (
    <header className="mb-5 flex min-h-14 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {back ? (
          <Link
            className="-ml-2 flex min-h-11 items-center gap-2 rounded-control px-2 text-sm font-semibold text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
            href={back.href}
            onNavigate={back.onNavigate}
          >
            <svg aria-hidden="true" className="size-3" fill="none" viewBox="0 0 8 12">
              <path d="M6.5 1l-5 5 5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
            {back.label}
          </Link>
        ) : (
          <TripSwitcher trip={trip ?? undefined} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <OfflineIndicator />
        <DesktopNav />
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}
