import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, ErrorText, Input } from "../components/ui";
import { errMsg } from "../lib/utils";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-3 h-12 w-12" />
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <Card className="p-5">{children}</Card>
      </div>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  };

  return (
    <Shell title="IWILL Attend" subtitle="Sign in to mark or manage attendance">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm text-slate-500">
          New company?{" "}
          <Link to="/signup" className="font-medium text-indigo-600 hover:underline">
            Register here
          </Link>
        </p>
      </form>
    </Shell>
  );
}

export function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    else if (!data.session) setSent(true); // email confirmation is switched on
    setBusy(false);
  };

  if (sent) {
    return (
      <Shell title="Check your email" subtitle="One more step">
        <p className="text-sm text-slate-600">
          We sent a confirmation link to <b>{email}</b>. Open it, then come back and sign in to set up your company.
        </p>
        <Link to="/login" className="mt-4 block text-center text-sm font-medium text-indigo-600 hover:underline">
          Back to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="Register your company" subtitle="Create the owner account first">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Work email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-sm text-slate-500">
          Already registered?{" "}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
        <p className="text-center text-xs text-slate-400">Staff do not register here. Your company admin creates your login.</p>
      </form>
    </Shell>
  );
}

export function Onboarding() {
  const { refresh, signOut, session } = useAuth();
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("create_organization", { p_org_name: orgName, p_full_name: fullName });
      if (error) throw error;
      await refresh();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Shell title="Set up your company" subtitle={session?.user.email ?? ""}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Company name" required minLength={2} maxLength={120} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        <Input label="Your full name" required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>
          Create company
        </Button>
        <button type="button" onClick={signOut} className="block w-full text-center text-sm text-slate-500 hover:underline">
          Sign out
        </button>
        <p className="text-center text-xs text-slate-400">
          If you are a staff member and see this page, your login is not linked or was deactivated. Contact your admin.
        </p>
      </form>
    </Shell>
  );
}
