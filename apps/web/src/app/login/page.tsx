import { AuthShell } from "@/components/auth-shell";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  const safeNext = safeRedirectPath(next, "");
  return (
    <AuthShell
      title="Welcome back"
      description={
        reset
          ? "Your password was changed. Sign in with the new one."
          : "Sign in to manage your clients."
      }
      footer="Access is by invitation. Need an account? Ask your agency administrator."
    >
      <LoginForm next={safeNext || undefined} />
    </AuthShell>
  );
}
