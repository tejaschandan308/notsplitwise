import type { ButtonHTMLAttributes } from "react";

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  selected: boolean;
};

/** Single-choice option (category, split). Selected = ink, not accent. */
export function Chip({ className = "", label, selected, ...props }: ChipProps) {
  return (
    <button
      aria-pressed={selected}
      className={`inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors duration-150 ${
        selected
          ? "border-ink bg-ink text-paper"
          : "border-rule-strong bg-transparent text-ink hover:border-field-border hover:bg-sunken"
      } ${className}`}
      type="button"
      {...props}
    >
      {label}
    </button>
  );
}
