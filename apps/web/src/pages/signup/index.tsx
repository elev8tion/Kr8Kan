import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { authClient } from "@kr8kan/auth/client";

import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { AuthCard } from "~/views/auth/AuthCard";

const allowCredentials =
  process.env.NEXT_PUBLIC_ALLOW_CREDENTIALS === "true";
const disableSignUp = process.env.NEXT_PUBLIC_DISABLE_SIGN_UP === "true";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (allowCredentials) {
        const { error: err } = await authClient.signUp.email({
          name: name || email.split("@")[0]!,
          email,
          password,
        });
        if (err) throw new Error(err.message ?? "Sign-up failed");
        void router.push("/onboarding");
      } else {
        // Magic-link sign-up: first link creates the account.
        const { error: err } = await authClient.signIn.magicLink({
          email,
          callbackURL: "/onboarding",
        });
        if (err) throw new Error(err.message ?? "Could not send magic link");
        setMagicSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setPending(false);
    }
  };

  if (disableSignUp) {
    return (
      <AuthCard
        title="Sign-up is disabled"
        subtitle="This is a private Kr8Kan instance. Ask the operator for an invite link."
      >
        <Link href="/login">
          <Button variant="secondary" fullWidth>
            Back to sign in
          </Button>
        </Link>
      </AuthCard>
    );
  }

  if (magicSent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We sent a link to ${email}. Opening it creates your account. Without SMTP configured, the link is printed in the server log.`}
      >
        <Button variant="secondary" fullWidth onClick={() => setMagicSent(false)}>
          Use a different email
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="One account, your own instance. No plans, no billing."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-kr8-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {allowCredentials && (
          <Input
            label="Name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {allowCredentials && (
          <Input
            label="Password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            hint="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {error && <p className="text-[13px] text-kr8-danger">{error}</p>}
        <Button type="submit" fullWidth size="lg" loading={pending}>
          {allowCredentials ? "Create account" : "Email me a sign-up link"}
        </Button>
      </form>
    </AuthCard>
  );
}
