import { useRouter } from "next/router";

import { Button } from "~/components/Button";
import { AuthCard } from "~/views/auth/AuthCard";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";

export default function InvitePage() {
  const router = useRouter();
  const { toast } = useToast();
  const utils = api.useUtils();
  const code = typeof router.query.code === "string" ? router.query.code : "";

  const info = api.member.inviteInfo.useQuery({ code }, { enabled: Boolean(code) });
  const accept = api.member.acceptInvite.useMutation({
    onSuccess: async () => {
      await utils.user.me.invalidate();
      toast("Welcome aboard", "success");
      void router.push("/boards");
    },
    onError: (err) => {
      if (err.data?.code === "UNAUTHORIZED") {
        void router.push(`/login?next=/invite/${code}`);
      } else {
        toast(err.message, "error");
      }
    },
  });

  if (info.isLoading) {
    return (
      <AuthCard title="Checking invite…">
        <p className="text-sm text-kr8-fg-muted">One moment.</p>
      </AuthCard>
    );
  }

  if (info.isError || !info.data || info.data.expired) {
    return (
      <AuthCard
        title="Invite not valid"
        subtitle="This invite link is unknown, already used, or expired. Ask for a fresh one."
      >
        <Button variant="secondary" fullWidth onClick={() => void router.push("/login")}>
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Join ${info.data.workspaceName}`}
      subtitle={`You've been invited as ${info.data.role}. Sign in first if you haven't yet.`}
    >
      <Button
        fullWidth
        size="lg"
        loading={accept.isPending}
        onClick={() => accept.mutate({ code })}
      >
        Accept invite
      </Button>
    </AuthCard>
  );
}
