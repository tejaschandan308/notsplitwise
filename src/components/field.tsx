import type { ReactNode } from "react";

export const inputClasses =
  "w-full min-h-12 rounded-control border border-field-border bg-surface px-3.5 text-base text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-2 focus:border-accent focus:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_30%,transparent)] disabled:opacity-60";

export const selectClasses = `${inputClasses} appearance-none bg-[length:0.75rem] bg-[right_0.9rem_center] bg-no-repeat pr-9 bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23857c6b' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")]`;

export function FieldLabel({
  htmlFor,
  children,
  hint,
  id,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
  id?: string;
}) {
  const Tag = htmlFor ? "label" : "span";

  return (
    <Tag
      className="mb-1.5 flex items-baseline justify-between gap-3 text-sm font-semibold text-ink"
      htmlFor={htmlFor}
      id={id}
    >
      <span>{children}</span>
      {hint ? (
        <span className="text-xs font-normal text-ink-3">{hint}</span>
      ) : null}
    </Tag>
  );
}

export function FieldHint({
  children,
  id,
  tone = "neutral",
}: {
  children: ReactNode;
  id?: string;
  tone?: "neutral" | "warn" | "danger";
}) {
  const toneClass =
    tone === "warn"
      ? "text-warn"
      : tone === "danger"
        ? "text-danger"
        : "text-ink-3";

  return (
    <p className={`mt-1.5 text-xs leading-5 ${toneClass}`} id={id}>
      {children}
    </p>
  );
}

/** A small uppercase section heading with a ledger rule beneath it. */
export function SectionHeading({
  children,
  id,
  aside,
}: {
  children: ReactNode;
  id?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="ledger-rule mb-3 flex items-end justify-between gap-3 pb-1.5">
      <h2
        className="text-xs font-semibold tracking-[0.08em] text-ink-2 uppercase"
        id={id}
      >
        {children}
      </h2>
      {aside ? <div className="text-xs text-ink-3">{aside}</div> : null}
    </div>
  );
}

export function Notice({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "danger" | "success";
  className?: string;
}) {
  const toneClass = {
    neutral: "border-rule bg-sunken text-ink-2",
    warn: "border-warn/40 bg-warn-soft text-ink",
    danger: "border-danger/40 bg-danger-soft text-ink",
    success: "border-accent/40 bg-accent-soft text-ink",
  }[tone];

  return (
    <div
      className={`rounded-control border px-3.5 py-3 text-sm leading-6 ${toneClass} ${className}`}
    >
      {children}
    </div>
  );
}
