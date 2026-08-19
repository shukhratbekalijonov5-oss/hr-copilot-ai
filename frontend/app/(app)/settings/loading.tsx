import { Skeleton, SkeletonCard } from "@/components/ui/LoadingSkeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-4xl">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="mt-2 h-4 w-80" />
      <Skeleton className="mt-5 h-10 w-full max-w-lg" />
      <div className="mt-4">
        <SkeletonCard />
      </div>
    </div>
  );
}
