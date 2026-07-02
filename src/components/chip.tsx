import type { ButtonHTMLAttributes } from "react";

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  selected: boolean;
};

export function Chip({
  className = "",
  label,
  selected,
  style,
  ...props
}: ChipProps) {
  return (
    <button
      aria-pressed={selected}
      className={`inline-flex min-h-11 items-center justify-center rounded-pill border px-4 text-[0.875rem] font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        selected
          ? "border-accent bg-accent text-accent-contrast"
          : "border-border-strong bg-transparent text-foreground hover:border-accent"
      } ${className}`}
      style={{ borderRadius: "var(--radius-pill)", ...style }}
      type="button"
      {...props}
    >
      {label}
    </button>
  );
}
