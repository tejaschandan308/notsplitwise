import type { ComponentProps } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "lg" | "sm";

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-accent-ink hover:brightness-110 disabled:border-rule disabled:bg-sunken disabled:text-ink-3 disabled:hover:brightness-100",
  secondary:
    "border-field-border bg-surface text-ink hover:bg-sunken disabled:text-ink-3",
  ghost:
    "border-transparent bg-transparent text-ink-2 hover:bg-sunken hover:text-ink disabled:text-ink-3",
  danger:
    "border-transparent bg-transparent text-danger hover:bg-danger-soft disabled:text-ink-3",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-sm",
  md: "min-h-11 px-4 text-[0.9375rem]",
  lg: "min-h-13 px-5 text-base",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className = "",
): string {
  return `inline-flex items-center justify-center gap-2 rounded-control border font-semibold transition-[background-color,filter,color] duration-150 select-none active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;
}

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClasses(variant, size, className)}
      type={type}
      {...props}
    />
  );
}
