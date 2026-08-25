import { forwardRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from "react-native";
import { cn } from "@/lib/utils";

/**
 * The mobile UI kit.
 *
 * One file because these shapes only make sense together: every screen is
 * built from this handful, and keeping them adjacent is what stops a screen
 * inventing its own card padding. Colours come exclusively from the Tailwind
 * tokens defined in `global.css`, so light and dark are one implementation.
 */

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export function Title({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text className={cn("text-[26px] font-semibold tracking-tight text-ink", className)}>
      {children}
    </Text>
  );
}

export function SectionTitle({
  children,
  className,
  ...props
}: TextProps & { children: ReactNode; className?: string }) {
  return (
    <Text className={cn("text-[15px] font-semibold text-ink", className)} {...props}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  className,
  ...props
}: TextProps & { children: ReactNode; className?: string }) {
  return (
    <Text className={cn("text-[13.5px] leading-5 text-ink-muted", className)} {...props}>
      {children}
    </Text>
  );
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text className={cn("text-[12px] text-ink-subtle", className)}>{children}</Text>
  );
}

/** A metric. Tabular-ish weight and tight tracking so a row reads as data. */
export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="min-w-0 flex-1 rounded-card border border-line bg-surface p-3.5">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </Text>
      <Text className="mt-1.5 text-[24px] font-semibold tracking-tight text-ink">
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({ className, children, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View
      className={cn("rounded-card border border-line bg-surface p-4", className)}
      {...props}
    >
      {children}
    </View>
  );
}

/**
 * A surface whose content a model produced.
 *
 * Pale accent tint plus an accent hairline — the same language the web app
 * uses, so "a model wrote this" is legible at a glance without the screen
 * turning purple.
 */
export function AiCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <View className={cn("overflow-hidden rounded-card border border-ai-line bg-ai-tint", className)}>
      <View className="h-px w-full bg-ai-ink/40" />
      <View className="p-4">{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends Omit<PressableProps, "children"> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
  className?: string;
}

/**
 * `hitSlop` is on every button rather than only the small ones: a 44pt
 * target is the accessibility floor, and a compact button in a dense list is
 * exactly where a missed tap is most likely.
 */
export const Button = forwardRef<View, ButtonProps>(function Button(
  { title, variant = "primary", loading, icon, className, disabled, ...props },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      accessibilityLabel={title}
      disabled={isDisabled}
      hitSlop={8}
      className={cn(
        "min-h-[44px] flex-row items-center justify-center gap-2 rounded-control px-4",
        variant === "primary" && "bg-brand active:bg-brand-hover",
        variant === "secondary" && "border border-line bg-surface active:bg-surface-muted",
        variant === "ghost" && "active:bg-surface-muted",
        isDisabled && "opacity-55",
        className,
      )}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "primary" ? "#fff" : undefined} />
      ) : (
        icon
      )}
      <Text
        className={cn(
          "text-[14px] font-semibold",
          variant === "primary" ? "text-white" : "text-ink",
        )}
      >
        {title}
      </Text>
    </Pressable>
  );
});

export type BadgeTone = "neutral" | "brand" | "positive" | "warning" | "critical" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted border-line",
  brand: "bg-brand-soft border-brand/20",
  positive: "bg-positive-soft border-positive/20",
  warning: "bg-warning-soft border-warning/20",
  critical: "bg-critical-soft border-critical/20",
  info: "bg-info-soft border-info/20",
};

const BADGE_TEXT: Record<BadgeTone, string> = {
  neutral: "text-ink-muted",
  brand: "text-brand-ink",
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  info: "text-info",
};

/** Status is always a WORD plus a tone — never a colour on its own. */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  return (
    <View className={cn("self-start rounded-md border px-2 py-0.5", BADGE_TONES[tone])}>
      <Text className={cn("text-[11.5px] font-medium", BADGE_TEXT[tone])}>{label}</Text>
    </View>
  );
}

export function Chip({ label }: { label: string }) {
  return (
    <View className="self-start rounded-md border border-line bg-surface-muted px-2 py-0.5">
      <Text className="text-[11.5px] text-ink-muted">{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View className="items-center gap-2 rounded-card border border-line bg-surface px-6 py-10">
      {icon ? (
        <View className="mb-1 size-10 items-center justify-center rounded-control border border-line bg-surface-muted">
          {icon}
        </View>
      ) : null}
      <Text className="text-center text-[14px] font-semibold text-ink">{title}</Text>
      {description ? (
        <Text className="text-center text-[13px] leading-5 text-ink-muted">
          {description}
        </Text>
      ) : null}
      {action ? <View className="mt-2">{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  retryLabel: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      className="gap-2 rounded-card border border-critical/25 bg-critical-soft p-4"
    >
      <Text className="text-[13.5px] font-semibold text-critical">{title}</Text>
      {description ? <Body>{description}</Body> : null}
      {onRetry ? (
        <Button title={retryLabel} variant="secondary" onPress={onRetry} className="mt-1 self-start" />
      ) : null}
    </View>
  );
}

/** A skeleton shaped like the thing it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <View className={cn("rounded-md bg-surface-muted", className)} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View className="gap-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} className="rounded-card border border-line bg-surface p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </View>
      ))}
    </View>
  );
}
