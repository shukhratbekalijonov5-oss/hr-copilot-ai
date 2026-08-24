import { Skeleton, SkeletonCard } from "@/components/ui/LoadingSkeleton";

/** The tracked list before it answers. */
export default function ExternalApplicationsLoading() {
  return (
    <div className="mx-auto max-w-6xl">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <Skeleton className="mt-5 h-10 w-full" />
      <ul className="mt-4 grid gap-3 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index}>
            <SkeletonCard />
          </li>
        ))}
      </ul>
    </div>
  );
}
