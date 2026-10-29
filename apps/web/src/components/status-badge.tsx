import type { ClientStatus } from "@automation/db";
import { Badge } from "@/components/ui/badge";

const TONES = { active: "success", paused: "warning", archived: "neutral" } as const;

export function StatusBadge({ status }: { status: ClientStatus }) {
  return <Badge tone={TONES[status]}>{status}</Badge>;
}
