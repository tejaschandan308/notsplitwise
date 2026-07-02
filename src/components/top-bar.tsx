"use client";

import Link from "next/link";

type TopBarProps = {
  tripName: string;
  backHref?: string;
  isAddMemberOpen?: boolean;
  onAddMemberClick?: () => void;
  onTripClick?: () => void;
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
  onTripClick = () => undefined,
}: TopBarProps) {
  function toggleTheme(): void {
    const nextTheme: Theme = readTheme() === "dark" ? "light" : "dark";
    const root = document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(nextTheme);
    window.localStorage.setItem("log-now:theme", nextTheme);
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
        <button
          className="group flex min-h-11 min-w-0 items-center gap-2 rounded-control border-0 bg-transparent px-1 text-left text-[1.125rem] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
          style={{ borderRadius: "var(--radius-control)" }}
          type="button"
          onClick={onTripClick}
        >
          <span className="truncate">{tripName}</span>
          <span
            aria-hidden="true"
            className="size-2.5 rotate-45 border-b border-r border-muted transition-transform group-hover:translate-y-0.5"
          />
        </button>
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
