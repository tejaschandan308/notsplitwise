"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useDraftCount } from "@/components/top-bar";
import { useKeyboardInset } from "@/lib/hooks";
import { reparsePendingDrafts } from "@/lib/parse-client";

export const navItems = [
  { href: "/capture", label: "Capture" },
  { href: "/inbox", label: "Inbox" },
] as const;

/** Retries drafts waiting for the AI on load, reconnect and focus. */
function useParseSweep(): void {
  useEffect(() => {
    function sweep(): void {
      if (document.visibilityState === "visible") {
        void reparsePendingDrafts();
      }
    }

    sweep();
    window.addEventListener("online", sweep);
    window.addEventListener("focus", sweep);
    document.addEventListener("visibilitychange", sweep);

    return () => {
      window.removeEventListener("online", sweep);
      window.removeEventListener("focus", sweep);
      document.removeEventListener("visibilitychange", sweep);
    };
  }, []);
}

type AppShellProps = {
  children: ReactNode;
  /** Primary actions. Pinned above the nav (or keyboard) on phones. */
  actionBar?: ReactNode;
  width?: "narrow" | "wide";
};

export function AppShell({ children, actionBar, width = "narrow" }: AppShellProps) {
  const pathname = usePathname();
  const keyboardInset = useKeyboardInset();
  const draftCount = useDraftCount();
  const keyboardOpen = keyboardInset > 0;
  const maxWidth = width === "wide" ? "max-w-3xl" : "max-w-xl";

  useParseSweep();

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <a
        className="sr-only z-[60] rounded-control bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main"
      >
        Skip to content
      </a>
      <div
        className={`mx-auto w-full ${maxWidth} px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:px-6 md:pt-6 md:pb-16 ${
          actionBar
            ? "pb-[calc(env(safe-area-inset-bottom)+12rem)]"
            : "pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
        }`}
      >
        {children}

        {actionBar ? (
          <div
            className="fixed inset-x-0 z-30 border-t border-rule bg-paper/95 backdrop-blur-sm md:static md:mt-8 md:border-0 md:bg-transparent md:backdrop-blur-none"
            style={{
              bottom: keyboardOpen
                ? `${keyboardInset}px`
                : "calc(env(safe-area-inset-bottom) + 4rem)",
            }}
          >
            <div className={`mx-auto w-full ${maxWidth} px-4 py-2.5 sm:px-6 md:p-0`}>
              {actionBar}
            </div>
          </div>
        ) : null}
      </div>

      <nav
        aria-label="Main"
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden ${
          keyboardOpen ? "hidden" : ""
        }`}
      >
        <div className="mx-auto grid h-16 max-w-xl grid-cols-2 gap-2 px-4 py-2.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center justify-center gap-2 rounded-control text-[0.9375rem] font-semibold transition-colors ${
                  isActive ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken hover:text-ink"
                }`}
                href={item.href}
              >
                {item.label}
                {item.href === "/inbox" && draftCount > 0 ? (
                  <span
                    className={`min-w-5 rounded-full px-1.5 text-center text-xs leading-5 tabular-nums ${
                      isActive ? "bg-paper text-ink" : "bg-ink text-paper"
                    }`}
                  >
                    <span className="sr-only">, </span>
                    {draftCount}
                    <span className="sr-only"> drafts</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
