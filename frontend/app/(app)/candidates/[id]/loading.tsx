import { Skeleton, SkeletonCard } from "@/components/ui/LoadingSkeleton";

export default function CandidateDetailLoading() {
  return (
    <div className="mx-auto max-w-[90rem]">
      <Skeleton className="h-4 w-48" />
      <div className="mt-4">
        <SkeletonCard />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Skeleton className="h-[32rem]" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full max-w-md" />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
