"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Reads/writes one URL parameter; changing a filter always resets paging. State lives in the URL, so views are linkable. */
function useUrlParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { params, set, pending };
}

export function FilterBar({
  children,
  label = "Filters",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div role="search" aria-label={label} className="mb-4 flex flex-wrap items-center gap-2">
      {children}
    </div>
  );
}

/** Debounced search box (300 ms) bound to ?q= */
export function SearchInput({
  placeholder = "Search",
  name = "q",
  label,
}: {
  placeholder?: string;
  name?: string;
  label?: string;
}) {
  const { params, set, pending } = useUrlParam();
  const current = params.get(name) ?? "";
  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Adopt the URL value when it changes from elsewhere (back button, "Clear"): adjust during render.
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setValue(current);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (next: string) => {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => set({ [name]: next.trim() || undefined }), 300);
  };

  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => change(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        aria-busy={pending}
        maxLength={100}
        className={cn(
          "h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20",
          pending && "opacity-70",
        )}
      />
    </div>
  );
}

export function FilterSelect({
  name,
  label,
  options,
  allLabel,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  const { params, set, pending } = useUrlParam();
  return (
    <select
      aria-label={label}
      value={params.get(name) ?? ""}
      onChange={(e) => set({ [name]: e.target.value || undefined })}
      aria-busy={pending}
      className="h-10 cursor-pointer rounded-lg border border-border bg-card px-3 text-sm shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A toggle (e.g. "My tasks") bound to a flag parameter. */
export function FilterToggle({ name, label }: { name: string; label: string }) {
  const { params, set } = useUrlParam();
  const on = params.get(name) === "1";
  return (
    <Button
      type="button"
      variant={on ? "default" : "outline"}
      aria-pressed={on}
      onClick={() => set({ [name]: on ? undefined : "1" })}
    >
      {label}
    </Button>
  );
}

/** Appears only while one of the named filters is set. */
export function ClearFilters({ names }: { names: string[] }) {
  const { params, set } = useUrlParam();
  if (!names.some((n) => params.get(n))) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => set(Object.fromEntries(names.map((n) => [n, undefined])))}
    >
      <X className="size-4" aria-hidden />
      Clear
    </Button>
  );
}
