"use client";

import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";

const focusableSelector =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogProps = {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Element to focus first; defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Modal sheet: labelled, traps focus, closes on Escape or backdrop, restores
 * focus to whatever opened it, and locks page scroll while open.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  initialFocusRef,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const { overflow } = document.body.style;

    document.body.style.overflow = "hidden";
    (
      initialFocusRef?.current ??
      panel?.querySelector<HTMLElement>(focusableSelector) ??
      panel
    )?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !panel) {
        return;
      }

      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(focusableSelector),
      ].filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [initialFocusRef]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="rise-in relative flex max-h-[min(92dvh,48rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-rule bg-surface shadow-raised sm:rounded-2xl"
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-5 pt-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-ink-2" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink"
            type="button"
            onClick={onClose}
          >
            <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
