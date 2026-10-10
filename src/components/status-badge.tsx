import type { ExpenseStateKind } from "@/lib/expense-state";

const styles: Record<ExpenseStateKind, { box: string; mark: string }> = {
  reading: { box: "border-rule-strong text-ink-2", mark: "bg-ink-2 pulse-dot" },
  offline: { box: "border-rule-strong text-ink-2", mark: "border border-ink-2" },
  failed: { box: "border-danger/50 bg-danger-soft text-danger", mark: "bg-danger" },
  review: { box: "border-warn/50 bg-warn-soft text-warn", mark: "bg-warn" },
  complete: { box: "border-accent/40 text-accent", mark: "border border-accent" },
  ready: { box: "border-accent/40 bg-accent-soft text-accent", mark: "bg-accent" },
  archived: { box: "border-rule text-ink-3", mark: "bg-ink-3" },
};

/**
 * Compact state label. Each state differs in wording, colour and mark shape
 * (filled, hollow, pulsing) so it never depends on colour alone.
 */
export function StatusBadge({
  kind,
  label,
  className = "",
}: {
  kind: ExpenseStateKind;
  label: string;
  className?: string;
}) {
  const style = styles[kind];

  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-semibold whitespace-nowrap ${style.box} ${className}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${style.mark}`} />
      {label}
    </span>
  );
}
