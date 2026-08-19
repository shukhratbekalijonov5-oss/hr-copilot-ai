import { Skeleton, SkeletonTable } from "@/components/ui/LoadingSkeleton";

export default function VacanciesLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-96" />
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-9.5 w-full max-w-xs" />
        <Skeleton className="h-9.5 w-40" />
      </div>
      <div className="mt-4">
        <SkeletonTable rows={6} columns={6} />
      </div>
    </div>
  );
}
