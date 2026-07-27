import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { authClient } from "@kr8kan/auth/client";

import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { AuthCard } from "~/views/auth/AuthCard";

/**
 * Consume a password-reset token (from the email link's ?token= query)
 * and set a new password. better-auth invalidates the token on use.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const token =
    typeof router.query.token === "string" ? router.query.token : null;
  const tokenError = router.query.error === "INVALID_TOKEN";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: err } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (err) throw new Error(err.message ?? "Reset failed");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        subtitle="Your password has been changed. Sign in with it now."
      >
        <Button fullWidth size="lg" onClick={() => void router.push("/login")}>
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  if (!token || tokenError) {
    return (
      <AuthCard
        title="Invalid reset link"
        subtitle="This link is missing its token or has expired. Request a fresh one."
      >
        <Button
          fullWidth
          size="lg"
          onClick={() => void router.push("/forgot-password")}
        >
          Request a new link
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="Minimum 8 characters."
      footer={
        <Link
          href="/login"
          className="font-medium text-kr8-accent hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Input
          label="New password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="Confirm password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-[13px] text-kr8-danger">{error}</p>}
        <Button type="submit" fullWidth size="lg" loading={pending}>
          Set new password
        </Button>
      </form>
    </AuthCard>
  );
}
