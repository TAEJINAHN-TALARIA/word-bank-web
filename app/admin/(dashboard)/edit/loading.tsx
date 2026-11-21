import { Skeleton } from "@/components/ui/skeleton";

export default function EditLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-32" />
      <div className="flex gap-4 border-b border-border pb-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-6 w-28" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
