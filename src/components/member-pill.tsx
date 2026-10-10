import type { ButtonHTMLAttributes } from "react";

type MemberPillProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  name: string;
  selected: boolean;
};

/** Toggle for a person. Selected has a fill and a check, not colour alone. */
export function MemberPill({
  className = "",
  name,
  selected,
  ...props
}: MemberPillProps) {
  return (
    <button
      aria-pressed={selected}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border pr-4 pl-3 text-[0.9375rem] font-medium transition-colors duration-150 ${
        selected
          ? "border-ink bg-ink text-paper"
          : "border-rule-strong bg-transparent text-ink-2 hover:border-field-border hover:text-ink"
      } ${className}`}
      type="button"
      {...props}
    >
      <span
        aria-hidden="true"
        className={`flex size-4 items-center justify-center rounded-full border text-[0.625rem] leading-none ${
          selected ? "border-paper bg-paper text-ink" : "border-rule-strong"
        }`}
      >
        {selected ? "✓" : ""}
      </span>
      <span>{name === "Me" ? "Me" : name}</span>
    </button>
  );
}
