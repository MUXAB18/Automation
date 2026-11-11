"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

/** Select a discovered property for syncing (and map it to one of the client's websites), or deselect it. */
export function SourceControls({
  accountId,
  sourceId,
  active,
  websiteId,
  websites,
  disabledReason,
  action,
}: {
  accountId: string;
  sourceId: string;
  active: boolean;
  websiteId: string | null;
  websites: { id: string; domain: string }[];
  disabledReason?: string;
  action: (formData: FormData) => Promise<{ error?: string; success?: string }>;
}) {
  const [site, setSite] = useState(websiteId ?? "");
  const [pending, start] = useTransition();
  const run = (next: boolean) =>
    start(async () => {
      const data = new FormData();
      data.set("accountId", accountId);
      data.set("sourceId", sourceId);
      data.set("active", next ? "1" : "0");
      data.set("websiteId", site);
      const result = await action(data);
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Saved");
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        value={site}
        onChange={(e) => setSite(e.target.value)}
        aria-label="Website"
        className="h-9 w-48 text-xs"
        disabled={pending}
      >
        <option value="">No website mapped</option>
        {websites.map((w) => (
          <option key={w.id} value={w.id}>
            {w.domain}
          </option>
        ))}
      </NativeSelect>
      {active ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(true)}
          >
            Save website
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(false)}
          >
            Deselect
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={pending || Boolean(disabledReason)}
          title={disabledReason}
          onClick={() => run(true)}
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Select and sync
        </Button>
      )}
    </div>
  );
}
