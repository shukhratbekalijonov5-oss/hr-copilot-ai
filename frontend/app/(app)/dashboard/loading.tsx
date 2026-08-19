import { Skeleton, SkeletonCard, SkeletonStats } from "@/components/ui/LoadingSkeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-5">
        <SkeletonStats />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SkeletonCard className="lg:col-span-2" />
        <SkeletonCard />
        <SkeletonCard className="lg:col-span-2" />
        <SkeletonCard />
      </div>
    </div>
  );
}
