import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/states";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Page not found"
      description="It may not exist, or you may not have access to it."
      action={{ label: "Back to Overview", href: "/" }}
      className="mt-10"
    />
  );
}
