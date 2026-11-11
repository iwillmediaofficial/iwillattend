import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { ADMIN_ROLES, MANAGER_ROLES, type Branch, type Employee, type Organization } from "../lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  employee: Employee | null;
  org: Organization | null;
  branch: Branch | null;
  isAdmin: boolean;
  isManager: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<{ employee: Employee; org: Organization; branch: Branch | null } | null>(null);
  const [profileFor, setProfileFor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const load = useCallback(async (uid: string | null) => {
    if (!uid) {
      setProfile(null);
      setProfileFor(null);
      return;
    }
    const { data } = await supabase
      .from("employees")
      .select("*, org:organizations(*), branch:branches(*)")
      .eq("user_id", uid)
      .eq("is_active", true)
      .maybeSingle();
    if (data) {
      const { org, branch, ...employee } = data as Employee & { org: Organization; branch: Branch | null };
      setProfile({ employee: employee as Employee, org, branch });
    } else {
      setProfile(null);
    }
    setProfileFor(uid);
  }, []);

  useEffect(() => {
    if (sessionReady) void load(userId);
  }, [sessionReady, userId, load]);

  const value = useMemo<AuthState>(() => {
    const role = profile?.employee.role;
    return {
      loading: !sessionReady || profileFor !== userId,
      session,
      employee: profile?.employee ?? null,
      org: profile?.org ?? null,
      branch: profile?.branch ?? null,
      isAdmin: !!role && ADMIN_ROLES.includes(role),
      isManager: !!role && MANAGER_ROLES.includes(role),
      refresh: () => load(userId),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [sessionReady, profileFor, userId, session, profile, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
