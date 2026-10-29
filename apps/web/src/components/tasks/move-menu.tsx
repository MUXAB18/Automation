"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { transitionTaskAction } from "@/app/(dashboard)/tasks/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MoveView } from "./transition-dialog";

/** "Move to…" on a board card: simple moves run here; moves that need a reason or evidence open the task. */
export function MoveMenu({
  taskId,
  title,
  moves,
}: {
  taskId: string;
  title: string;
  moves: MoveView[];
}) {
  const [pending, start] = useTransition();
  if (moves.length === 0) return null;
  const run = (to: string) =>
    start(async () => {
      const data = new FormData();
      data.set("taskId", taskId);
      data.set("to", to);
      const result = await transitionTaskAction(data);
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Task updated");
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Move “${title}”`}>
          <ArrowRightLeft className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Move to…
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {moves.map((m) =>
          m.needs ? (
            <DropdownMenuItem key={m.to} asChild disabled={Boolean(m.disabledReason)}>
              <Link href={`/tasks/${taskId}`}>{m.label} …</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={m.to}
              disabled={Boolean(m.disabledReason)}
              onSelect={() => run(m.to)}
              title={m.disabledReason}
            >
              {m.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
