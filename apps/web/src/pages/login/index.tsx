import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { authClient } from "@kr8kan/auth/client";

import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { AuthCard } from "~/views/auth/AuthCard";

const allowCredentials =
  process.env.NEXT_PUBLIC_ALLOW_CREDENTIALS === "true";

export default function LoginPage() {
  const router = useRouter();
  const next = typeof router.query.next === "string" ? router.query.next : "/boards";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "magic") {
        const { error: err } = await authClient.signIn.magicLink({
          email,
          callbackURL: next,
        });
        if (err) throw new Error(err.message ?? "Could not send magic link");
        setMagicSent(true);
      } else {
        const { error: err } = await authClient.signIn.email({
          email,
          password,
        });
        if (err) throw new Error(err.message ?? "Invalid credentials");
        void router.push(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  };

  if (magicSent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We sent a sign-in link to ${email}. Without SMTP configured, the link is printed in the server log.`}
      >
        <Button variant="secondary" fullWidth onClick={() => setMagicSent(false)}>
          Use a different email
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to your board."
      footer={
        <>
          No account?{" "}
          <Link href="/signup" className="font-medium text-kr8-accent hover:underline">
            Create one
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
        {mode === "password" && (
          <>
            <Input
              label="Password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-[13px] text-kr8-fg-muted hover:text-kr8-fg"
              >
                Forgot password?
              </Link>
            </div>
          </>
        )}
        {error && <p className="text-[13px] text-kr8-danger">{error}</p>}
        <Button type="submit" fullWidth size="lg" loading={pending}>
          {mode === "magic" ? "Email me a sign-in link" : "Sign in"}
        </Button>
      </form>
      {allowCredentials && (
        <button
          onClick={() => setMode(mode === "magic" ? "password" : "magic")}
          className="mt-4 w-full text-center text-[13px] text-kr8-fg-muted hover:text-kr8-fg"
        >
          {mode === "magic"
            ? "Use email + password instead"
            : "Use a magic link instead"}
        </button>
      )}
    </AuthCard>
  );
}
