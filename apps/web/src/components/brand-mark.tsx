import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-from to-brand-to text-white shadow-md",
        className,
      )}
    >
      <TrendingUp className="size-[55%]" strokeWidth={2.5} />
    </span>
  );
}
