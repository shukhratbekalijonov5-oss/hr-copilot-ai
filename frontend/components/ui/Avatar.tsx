import { cn, initialsOf } from "@/lib/utils";

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-[13px]",
  lg: "size-12 text-base",
  xl: "size-16 text-lg",
} as const;

interface AvatarProps {
  name: string;
  /**
   * The account's picture. Optional by design — null is the normal state for
   * an account without one, and the initials below are the fallback, never a
   * placeholder image.
   */
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * A picture when there is one, initials when there is not.
 *
 * Plain `<img>` rather than `next/image`: the source is a short-lived signed
 * URL from object storage, so it changes on every render and there is nothing
 * for the image optimizer to cache — it would only proxy bytes it must fetch
 * again next time.
 */
export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const shared = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
    SIZES[size],
    className,
  );

  if (src) {
    return (
      /* The source is a short-lived signed storage URL that changes on every
         render, so the image optimizer has nothing to cache and would only
         proxy bytes it must fetch again next time. */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={cn(shared, "bg-surface-muted object-cover")}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(shared, "bg-brand-soft font-semibold text-brand-ink")}
    >
      {initialsOf(name)}
    </span>
  );
}
