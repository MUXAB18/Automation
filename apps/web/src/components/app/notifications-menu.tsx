"use client";

import { useTransition } from "react";
import { Bell, CheckCheck, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { markNotificationsReadAction } from "@/app/(dashboard)/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  /** Pre-formatted on the server ("2 hours ago"). */
  when: string;
  unread: boolean;
  sample: boolean;
};

export function NotificationsMenu({
  items,
  unread,
}: {
  items: NotificationItem[];
  unread: number;
}) {
  const [pending, start] = useTransition();
  const markAll = () =>
    start(async () => {
      await markNotificationsReadAction();
      toast.success("All notifications marked as read");
    });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-11 rounded-full border border-border/60 bg-card shadow-card hover:bg-card"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 ? (
            <span
              className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white"
              aria-hidden
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={markAll} disabled={pending}>
              <CheckCheck className="size-4" aria-hidden />
              Mark all read
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Bell className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">You&rsquo;re all caught up</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Approvals, failed syncs and finished reports will show up here.
            </p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={cn("px-4 py-3", n.unread && "bg-primary-soft/40")}>
                <div className="flex items-start gap-2">
                  {n.unread ? (
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                      aria-label="Unread"
                    />
                  ) : (
                    <span className="size-2 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {n.title}
                      {n.sample ? (
                        <Badge tone="info" className="gap-1">
                          <FlaskConical className="size-3" aria-hidden />
                          Sample
                        </Badge>
                      ) : null}
                    </p>
                    {n.body ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">{n.when}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
