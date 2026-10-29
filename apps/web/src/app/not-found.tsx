import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/states";

// Outside the dashboard shell (for example when the layout itself refuses a section).
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center p-6">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="It may not exist, or you may not have access to it."
        action={{ label: "Back to Overview", href: "/" }}
        className="w-full"
      />
    </main>
  );
}
