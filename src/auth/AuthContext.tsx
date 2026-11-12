import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { ADMIN_ROLES, MANAGER_ROLES, type Branch, type Employee, type Organization, type Subscription } from "../lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  employee: Employee | null;
  org: Organization | null;
  branch: Branch | null;
  sub: Subscription | null;
  isPlatformAdmin: boolean;
  isAdmin: boolean;
  isManager: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<{ employee: Employee; org: Organization; branch: Branch | null; sub: Subscription | null } | null>(null);
  const [profileFor, setProfileFor] = useState<string | null | undefined>(undefined);
  // A platform admin login that does not belong to any company.
  const [platformOnly, setPlatformOnly] = useState(false);

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
      setPlatformOnly(false);
      setProfile(null);
      setProfileFor(null);
      return;
    }
    const { data } = await supabase
      .from("employees")
      // Name the linking column: other tables also connect employees to organisations,
      // and without this the API refuses the query as ambiguous.
      .select("*, org:organizations!org_id(*), branch:branches!branch_id(*)")
      .eq("user_id", uid)
      .eq("is_active", true)
      .maybeSingle();
    if (data) {
      const { org, branch, ...employee } = data as Employee & { org: Organization; branch: Branch | null };
      const { data: subData } = await supabase.rpc("my_subscription");
      const sub = (subData as Subscription | null) ?? null;
      // Face check only runs when the company's plan includes it.
      setProfile({ employee: employee as Employee, org: { ...org, face_check_enabled: org.face_check_enabled && (sub?.face ?? true) }, branch, sub });
      setPlatformOnly(false);
    } else {
      const { data: pa } = await supabase.rpc("is_platform_admin");
      setPlatformOnly(pa === true);
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
      sub: profile?.sub ?? null,
      isPlatformAdmin: profile?.sub?.is_platform_admin ?? platformOnly,
      isAdmin: !!role && ADMIN_ROLES.includes(role),
      isManager: !!role && MANAGER_ROLES.includes(role),
      refresh: () => load(userId),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [sessionReady, profileFor, userId, session, profile, platformOnly, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
