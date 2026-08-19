import { Skeleton, SkeletonCard } from "@/components/ui/LoadingSkeleton";

export default function VacancyDetailLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-72" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
