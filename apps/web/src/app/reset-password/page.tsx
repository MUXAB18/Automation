import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { FormMessage } from "@/components/form-message";
import { ResetPasswordForm } from "./form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const footer = (
    <Link href="/login" className="text-primary hover:underline">
      Back to sign in
    </Link>
  );
  if (!token || error) {
    return (
      <AuthShell title="Link not valid" footer={footer}>
        <div className="flex flex-col gap-4">
          <FormMessage error="This reset link is invalid or has expired." />
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Choose a new password"
      description="You'll be signed out everywhere else."
      footer={footer}
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
