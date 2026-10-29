import Link from "next/link";
import { previewInvitation } from "@automation/db";
import { AuthShell } from "@/components/auth-shell";
import { FormMessage } from "@/components/form-message";
import { getSession } from "@/lib/session";
import { AcceptForm, CreateAccountForm } from "./forms";

export const metadata = { title: "Join your team", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await previewInvitation(token);

  if (!invitation?.usable) {
    return (
      <AuthShell
        title="Invitation not valid"
        footer={
          <Link href="/login" className="text-primary hover:underline">
            Go to sign in
          </Link>
        }
      >
        <FormMessage error="This invitation is invalid, has expired, or was already used. Ask your agency admin for a new one." />
      </AuthShell>
    );
  }

  const where = invitation.clientName
    ? `${invitation.clientName} at ${invitation.agencyName}`
    : invitation.agencyName;
  const roles = invitation.roles.join(", ");
  const session = await getSession();

  if (session) {
    const matches = session.user.email.toLowerCase() === invitation.email;
    return (
      <AuthShell title={`Join ${where}`} description={`As: ${roles}`}>
        {matches ? (
          <AcceptForm token={token} />
        ) : (
          <FormMessage
            error={`This invitation is for ${invitation.email}. You're signed in as a different user: sign out and open the link again.`}
          />
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${where}`}
      description={`You've been invited as: ${roles}. Create your account to continue.`}
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="text-primary hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <CreateAccountForm token={token} email={invitation.email} />
    </AuthShell>
  );
}
