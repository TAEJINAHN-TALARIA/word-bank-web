import { Skeleton } from "@/components/ui/skeleton";

export default function GenerationDetailLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-5 w-20" />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:max-w-md">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </dl>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:max-w-md">
          {Array.from({ length: 16 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
