import { HiCheck, HiMinus } from "react-icons/hi2";

import { SettingsLayout } from "~/components/SettingsLayout";
import { api } from "~/utils/api";

export default function PermissionsSettingsPage() {
  const matrix = api.permission.matrix.useQuery();

  return (
    <SettingsLayout title="Permissions">
      <div className="max-w-2xl space-y-4">
        <p className="text-sm text-kr8-fg-muted">
          Roles gate <em>who</em> can do <em>what</em> inside a workspace. There
          are no plan gates — every feature is unlocked on a self-hosted
          instance.
        </p>
        {matrix.data && (
          <div className="overflow-x-auto rounded-kr8-md border border-kr8-border">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-kr8-border bg-kr8-bg-muted text-left">
                  <th className="px-3 py-2 font-semibold">Permission</th>
                  {matrix.data.roles.map((role) => (
                    <th key={role} className="px-3 py-2 text-center font-semibold capitalize">
                      {role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.data.permissions.map((permission) => (
                  <tr key={permission} className="border-b border-kr8-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{permission}</td>
                    {matrix.data!.roles.map((role) => (
                      <td key={role} className="px-3 py-1.5 text-center">
                        {matrix.data!.rolePermissions[role].includes(permission) ? (
                          <HiCheck className="mx-auto h-4 w-4 text-kr8-success" />
                        ) : (
                          <HiMinus className="mx-auto h-4 w-4 text-kr8-fg-muted/40" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SettingsLayout>
  );
}
