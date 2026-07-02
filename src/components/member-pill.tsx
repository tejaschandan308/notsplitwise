import type { ButtonHTMLAttributes } from "react";

export type MemberPillState = "unset" | "selected" | "unselected";

type MemberPillProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  name: string;
  state: MemberPillState;
};

const stateClasses: Record<MemberPillState, string> = {
  unset:
    "border-border bg-transparent text-muted hover:border-border-strong hover:text-foreground",
  selected:
    "border-accent bg-accent text-accent-contrast font-semibold shadow-pill",
  unselected:
    "border-border-strong bg-transparent text-foreground hover:border-accent",
};

export function MemberPill({
  className = "",
  name,
  state,
  ...props
}: MemberPillProps) {
  const isSelected = state === "selected";

  return (
    <button
      aria-pressed={state === "unset" ? undefined : isSelected}
      className={`inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-[0.9375rem] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ${stateClasses[state]} ${className}`}
      type="button"
      {...props}
    >
      {name === "Me" ? (
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-current"
        />
      ) : null}
      {isSelected ? (
        <span aria-hidden="true" className="text-sm leading-none">
          {"\u2713"}
        </span>
      ) : null}
      <span>{name}</span>
    </button>
  );
}
