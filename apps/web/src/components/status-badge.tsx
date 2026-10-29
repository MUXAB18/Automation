import type { CustomerStatus } from "@automation/db";
import { Badge } from "@/components/ui/badge";

const TONES = { active: "success", paused: "warning", archived: "neutral" } as const;

export function StatusBadge({ status }: { status: CustomerStatus }) {
  return <Badge tone={TONES[status]}>{status}</Badge>;
}
