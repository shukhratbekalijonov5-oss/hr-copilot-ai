import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SpinnerIcon } from "@/components/ui/icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/*
 * The button system.
 *
 * `transition-[background-color,box-shadow,border-color]` rather than
 * `transition-colors`: the primary button animates a shadow on hover, and
 * `transition-colors` would leave that shadow snapping while the fill faded.
 *
 * The focus ring is a soft two-layer ring instead of a hard outline — a
 * 2px accent ring separated from the control by a surface-coloured ring, so
 * it stays visible on both the page and a card without ever touching the
 * button's own edge.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium whitespace-nowrap " +
  "transition-[background-color,box-shadow,border-color,color] duration-[var(--motion-fast)] ease-[var(--ease-out)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "disabled:pointer-events-none disabled:opacity-55";

const VARIANTS: Record<ButtonVariant, string> = {
  // `btn-raised` adds the inner top highlight and the accent-tinted hover
  // shadow. That highlight is the whole difference between a considered
  // primary button and a flat coloured rectangle.
  primary: "btn-raised bg-brand text-white hover:bg-brand-hover",
  secondary:
    "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-muted",
  ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink",
  // Restrained on purpose: a destructive action should be findable, not the
  // loudest thing on the screen next to the primary one.
  danger: "bg-critical text-white hover:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9.5 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

export function buttonStyles(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonStyles(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <SpinnerIcon className="size-4 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
