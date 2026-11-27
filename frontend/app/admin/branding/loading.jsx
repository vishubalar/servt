import { Skeleton } from "@/components/ui/skeleton";
import { SkCard, SkFooter, SkForm, SkHeader } from "@/components/ui/skeleton-kit";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkHeader wide />
      <SkCard>
        <SkForm fields={2} columns={2} />
        <div className="mt-5 flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="size-7 rounded-full" />
          ))}
        </div>
      </SkCard>
      <SkCard>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <SkFooter />
      </SkCard>
    </div>
  );
}
