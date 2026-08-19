import { Skeleton, SkeletonCard, SkeletonTable } from "@/components/ui/LoadingSkeleton";

export default function ProcessingLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-96" />
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <SkeletonCard className="lg:col-span-2" />
        <SkeletonCard />
      </div>
      <div className="mt-4">
        <SkeletonTable rows={7} columns={5} />
      </div>
    </div>
  );
}
