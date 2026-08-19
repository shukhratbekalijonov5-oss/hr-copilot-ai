import { cn, initialsOf } from "@/lib/utils";

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-[13px]",
  lg: "size-12 text-base",
} as const;

interface AvatarProps {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-ink",
        SIZES[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
