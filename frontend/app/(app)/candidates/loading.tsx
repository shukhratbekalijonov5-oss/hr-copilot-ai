import { Skeleton, SkeletonTable } from "@/components/ui/LoadingSkeleton";

export default function CandidatesLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-96" />
      <div className="mt-5 flex flex-col gap-2 lg:flex-row">
        <Skeleton className="h-9.5 w-full lg:max-w-xs" />
        <Skeleton className="h-9.5 flex-1" />
      </div>
      <div className="mt-4">
        <SkeletonTable rows={8} columns={6} />
      </div>
    </div>
  );
}
