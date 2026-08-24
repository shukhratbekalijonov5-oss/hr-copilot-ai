import { Skeleton, SkeletonCard } from "@/components/ui/LoadingSkeleton";

/**
 * The first paint, before the search has answered.
 *
 * It matters more here than on most screens: the very first search after the
 * embedding service has been idle spends seconds loading a model, and a blank
 * page for that long reads as a broken product and invites a second submit.
 * Subsequent searches never reach this — they navigate inside a transition, so
 * the previous results stay on screen while the next ones render.
 */
export default function ExternalJobsLoading() {
  return (
    <div className="mx-auto max-w-6xl">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <Skeleton className="mt-5 h-9 w-full" />
      <Skeleton className="mt-3 h-16 w-full" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Skeleton className="hidden h-96 w-full lg:block" />
        <div className="grid gap-3 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
