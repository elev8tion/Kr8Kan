import { useState } from "react";
import { useRouter } from "next/router";

import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { AuthCard } from "~/views/auth/AuthCard";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";

/** Onboarding = create a workspace. That's it — no plan selection,
 * because there are no plans. */
export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [name, setName] = useState("");

  const create = api.workspace.create.useMutation({
    onSuccess: async () => {
      await utils.user.me.invalidate();
      void router.push("/boards");
    },
    onError: (err) => toast(err.message, "error"),
  });

  return (
    <AuthCard
      title="Name your workspace"
      subtitle="Boards, members, and AI workers live inside a workspace. You can rename it any time."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() });
        }}
        className="space-y-4"
      >
        <Input
          label="Workspace name"
          autoFocus
          required
          placeholder="My studio"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" fullWidth size="lg" loading={create.isPending}>
          Create workspace
        </Button>
      </form>
    </AuthCard>
  );
}
