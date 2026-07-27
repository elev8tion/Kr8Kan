import { useState } from "react";
import Link from "next/link";

import { authClient } from "@kr8kan/auth/client";

import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { AuthCard } from "~/views/auth/AuthCard";

/**
 * Request a password reset. Only meaningful when email+password sign-in
 * is enabled; the reset email carries a link to /reset-password. Without
 * SMTP configured the link is printed in the server log (self-host dev).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { error: err } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (err) throw new Error(err.message ?? "Could not send reset email");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If an account exists for ${email}, a reset link is on its way. Without SMTP configured, the link is printed in the server log.`}
      >
        <Button variant="secondary" fullWidth onClick={() => setSent(false)}>
          Use a different email
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your account email and we'll send a reset link."
      footer={
        <>
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-medium text-kr8-accent hover:underline"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="text-[13px] text-kr8-danger">{error}</p>}
        <Button type="submit" fullWidth size="lg" loading={pending}>
          Email me a reset link
        </Button>
      </form>
    </AuthCard>
  );
}
