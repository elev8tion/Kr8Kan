import { useState } from "react";
import { HiOutlineClipboard, HiPlus } from "react-icons/hi2";

import { Avatar } from "~/components/Avatar";
import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { Dropdown } from "~/components/Dropdown";
import { Input } from "~/components/Input";
import { ListRowsSkeleton } from "~/components/Skeleton";
import { Modal } from "~/components/Modal";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { relativeTime } from "~/utils/format";

export default function MembersPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "guest">("member");

  const workspaceId = activeWorkspace?.publicId ?? "";
  const enabled = Boolean(activeWorkspace);
  const members = api.member.list.useQuery(
    { workspacePublicId: workspaceId },
    { enabled },
  );
  const invites = api.member.invites.useQuery(
    { workspacePublicId: workspaceId },
    { enabled: enabled && activeWorkspace?.role === "admin" },
  );

  const refresh = () => {
    void utils.member.list.invalidate();
    void utils.member.invites.invalidate();
  };

  const invite = api.member.invite.useMutation({
    onSuccess: async (data: { inviteUrl: string }) => {
      refresh();
      setInviting(false);
      setEmail("");
      await navigator.clipboard.writeText(data.inviteUrl).catch(() => undefined);
      toast("Invite link copied to clipboard", "success");
    },
    onError: (err) => toast(err.message, "error"),
  });
  const updateRole = api.member.updateRole.useMutation({
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });
  const removeMember = api.member.remove.useMutation({
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });
  const revokeInvite = api.member.revokeInvite.useMutation({ onSettled: refresh });

  const isAdmin = activeWorkspace?.role === "admin";

  return (
    <Dashboard
      title="Members"
      actions={
        isAdmin ? (
          <Button
            size="sm"
            onClick={() => setInviting(true)}
            iconLeft={<HiPlus className="h-4 w-4" />}
          >
            Invite
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {members.isLoading && <ListRowsSkeleton />}

        {/* Cardified rows — no cramped tables on mobile */}
        <ul className="space-y-2">
          {(members.data ?? []).map(
            (member: {
              publicId: string;
              role: "admin" | "member" | "guest";
              createdAt: string | Date;
              user: { name: string; email: string; image?: string | null };
            }) => (
              <li
                key={member.publicId}
                className="flex items-center gap-3 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3 shadow-kr8-sm"
              >
                <Avatar
                  name={member.user.name || member.user.email}
                  image={member.user.image}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {member.user.name || member.user.email}
                  </p>
                  <p className="truncate text-[12px] text-kr8-fg-muted">
                    {member.user.email} · joined {relativeTime(member.createdAt)}
                  </p>
                </div>
                <Badge tone={member.role === "admin" ? "accent" : "neutral"}>
                  {member.role}
                </Badge>
                {isAdmin && (
                  <Dropdown
                    buttonLabel={`Manage ${member.user.email}`}
                    button={<span className="px-1 text-lg leading-none">⋯</span>}
                    items={[
                      ...(["admin", "member", "guest"] as const)
                        .filter((r) => r !== member.role)
                        .map((r) => ({
                          label: `Make ${r}`,
                          onClick: () =>
                            updateRole.mutate({
                              workspacePublicId: workspaceId,
                              memberPublicId: member.publicId,
                              role: r,
                            }),
                        })),
                      {
                        label: "Remove from workspace",
                        danger: true,
                        onClick: () =>
                          removeMember.mutate({
                            workspacePublicId: workspaceId,
                            memberPublicId: member.publicId,
                          }),
                      },
                    ]}
                  />
                )}
              </li>
            ),
          )}
        </ul>

        {isAdmin && (invites.data?.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Pending invites</h2>
            <ul className="space-y-2">
              {invites.data!.map(
                (item: {
                  publicId: string;
                  email: string | null;
                  role: string;
                  inviteUrl: string;
                }) => (
                  <li
                    key={item.publicId}
                    className="flex items-center gap-3 rounded-kr8-md border border-dashed border-kr8-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {item.email ?? "Open invite link"}
                      </p>
                      <p className="truncate font-mono text-[11px] text-kr8-fg-muted">
                        {item.inviteUrl}
                      </p>
                    </div>
                    <Badge>{item.role}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Copy invite link"
                      onClick={() => {
                        void navigator.clipboard.writeText(item.inviteUrl);
                        toast("Invite link copied", "success");
                      }}
                    >
                      <HiOutlineClipboard className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-kr8-danger"
                      onClick={() =>
                        revokeInvite.mutate({
                          workspacePublicId: workspaceId,
                          invitePublicId: item.publicId,
                        })
                      }
                    >
                      Revoke
                    </Button>
                  </li>
                ),
              )}
            </ul>
          </section>
        )}
      </div>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite member">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate({
              workspacePublicId: workspaceId,
              email: email.trim() || undefined,
              role,
            });
          }}
          className="space-y-4"
        >
          <Input
            label="Email (optional)"
            type="email"
            placeholder="teammate@example.com"
            hint="Leave empty to generate a shareable invite link."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-medium">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 py-2 text-sm"
            >
              <option value="member">Member — create and move cards</option>
              <option value="admin">Admin — full control</option>
              <option value="guest">Guest — view and comment</option>
            </select>
          </label>
          <Button type="submit" fullWidth loading={invite.isPending}>
            Create invite
          </Button>
        </form>
      </Modal>
    </Dashboard>
  );
}
