import { useEffect, useState } from "react";
import { useRouter } from "next/router";


import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { signOutEverywhere } from "~/utils/signOut";

export default function AccountSettingsPage() {
  const router = useRouter();
  const { user } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [name, setName] = useState("");

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  const update = api.user.update.useMutation({
    onSuccess: () => {
      void utils.user.me.invalidate();
      toast("Profile updated", "success");
    },
    onError: (err) => toast(err.message, "error"),
  });

  return (
    <SettingsLayout title="Account">
      <div className="space-y-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) update.mutate({ name: name.trim() });
          }}
          className="max-w-md space-y-4"
        >
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Email" value={user?.email ?? ""} disabled hint="Email is your identity on this instance." />
          <Button type="submit" loading={update.isPending}>
            Save
          </Button>
        </form>

        <div className="max-w-md rounded-kr8-md border border-kr8-border p-4">
          <h2 className="text-[15px] font-semibold">Session</h2>
          <p className="mt-1 text-sm text-kr8-fg-muted">
            Signed in as {user?.email}.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => void signOutEverywhere()}
          >
            Sign out
          </Button>
        </div>
      </div>
    </SettingsLayout>
  );
}
