import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useRouter } from "next/router";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { signOutEverywhere } from "~/utils/signOut";
import { api } from "~/utils/api";

export interface WorkspaceSummary {
  publicId: string;
  name: string;
  slug: string;
  role: "admin" | "member" | "guest";
  /** Operator toggle bag (eval layer etc.) — present on full rows. */
  settings?: { judgeEnabled?: boolean };
}

interface WorkspaceContextValue {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  setActiveWorkspace: (publicId: string) => void;
  isLoading: boolean;
  user: { id: string; name: string; email: string; image?: string | null } | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspace: null,
  setActiveWorkspace: () => undefined,
  isLoading: true,
  user: null,
});

const AUTH_FREE = [
  "/login",
  "/signup",
  "/invite",
  "/p/",
  "/forgot-password",
  "/reset-password",
];

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const authFree = AUTH_FREE.some((p) => router.pathname.startsWith(p));
  const me = api.user.me.useQuery(undefined, {
    enabled: !authFree,
    retry: false,
  });
  const [storedId, setStoredId] = useLocalStorage<string | null>(
    "kr8kan.workspace",
    null,
  );

  const workspaces = useMemo(
    () => (me.data?.workspaces ?? []) as WorkspaceSummary[],
    [me.data],
  );
  const activeWorkspace =
    workspaces.find((w) => w.publicId === storedId) ?? workspaces[0] ?? null;

  // Dead-session defense in depth: the middleware validates sessions at
  // the door, but a session can die mid-visit (expiry, wipe) after the
  // page loaded. If the identity query errors on a protected page, clear
  // the cookies and start over at /login.
  useEffect(() => {
    if (!authFree && me.isError) {
      void signOutEverywhere();
    }
  }, [authFree, me.isError]);

  // Fresh login with zero workspaces → onboarding
  useEffect(() => {
    if (
      !authFree &&
      me.isSuccess &&
      workspaces.length === 0 &&
      !router.pathname.startsWith("/onboarding")
    ) {
      void router.replace("/onboarding");
    }
  }, [authFree, me.isSuccess, workspaces.length, router]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      setActiveWorkspace: setStoredId,
      isLoading: !authFree && me.isLoading,
      user: me.data?.user ?? null,
    }),
    [workspaces, activeWorkspace, setStoredId, me.isLoading, me.data, authFree],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}
