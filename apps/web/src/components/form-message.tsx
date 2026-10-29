import { AlertCircle, CheckCircle2 } from "lucide-react";

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        {success}
      </p>
    );
  }
  return null;
}
