import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Plan } from "../lib/types";
import { Button, Card, ErrorText, Field, Input } from "../components/ui";
import { errMsg } from "../lib/utils";
import { InstallButton } from "../components/InstallApp";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link to="/" aria-label="IWILL Attend home"><img src="/logo.png" alt="IWILL Attend" className="mx-auto mb-4 h-14 w-auto" /></Link>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <Card className="p-5">{children}</Card>
        <div className="mt-4 flex justify-center"><InstallButton /></div>
        <p className="mt-4 text-center text-xs text-slate-500">
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link> · <Link to="/terms" className="hover:underline">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
}

/** Password field with a show/hide button. */
export function PasswordInput({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <span className="relative block">
        <input
          {...rest}
          type={show ? "text" : "password"}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-slate-500 hover:text-slate-700"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </Field>
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
    <Shell title="Sign in" subtitle="Mark or manage attendance">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="-mt-2 text-right text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-600 hover:underline">Forgot password?</Link>
        </p>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm text-slate-500">
          New company?{" "}
          <Link to="/signup" className="font-medium text-brand-600 hover:underline">
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
  const [confirm, setConfirm] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match. Type the same password in both boxes.");
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
        <Link to="/login" className="mt-4 block text-center text-sm font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="Register your company" subtitle="Step 1 of 2: create the owner account">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Work email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput label="Password" autoComplete="new-password" required minLength={8} hint="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordInput
          label="Confirm password"
          autoComplete="new-password"
          required
          minLength={8}
          hint={confirm && confirm !== password ? "Does not match the password above yet" : undefined}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-sm text-slate-500">
          Already registered?{" "}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
        <p className="text-center text-xs text-slate-500">
          By creating an account you agree to the <Link to="/terms" className="font-medium text-brand-600 hover:underline">Terms of Service</Link> and the <Link to="/privacy" className="font-medium text-brand-600 hover:underline">Privacy Policy</Link>.
        </p>
        <p className="text-center text-xs text-slate-400">Staff do not register here. Your company admin creates your login.</p>
      </form>
    </Shell>
  );
}

/** Step 2 for a new owner: choose a plan and give the company's basic details. */
export function Onboarding() {
  const { refresh, signOut, session } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState("");
  const [f, setF] = useState({ org: "", name: "", phone: "", address: "", city: "", state: "", gstin: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("plans").select("*").order("sort_order").then(({ data }) => setPlans((data as Plan[]) ?? []));
  }, []);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!plan) return setError("Choose a plan to continue.");
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("create_organization", {
        p_org_name: f.org, p_full_name: f.name, p_plan: plan, p_phone: f.phone,
        p_address: f.address, p_city: f.city, p_state: f.state, p_gstin: f.gstin,
      });
      if (error) throw error;
      await refresh();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 text-center">
        <img src="/logo.png" alt="IWILL Attend" className="mx-auto mb-4 h-14 w-auto" />
        <h1 className="text-xl font-semibold">Set up your company</h1>
        <p className="text-sm text-slate-500">Step 2 of 2 · {session?.user.email}</p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold">1. Choose your plan</h2>
          <p className="mb-4 text-xs text-slate-500">Paid plans start with a 14-day free trial. No payment is taken now, and you can change plan later.</p>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Plan">
            {plans.map((p) => {
              const on = plan === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPlan(p.id)}
                  className={`rounded-xl border p-4 text-left ${on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <p className="flex items-center justify-between font-semibold">
                    {p.name} {on && <Check className="h-4 w-4 text-brand-600" />}
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    ₹{Number(p.price_monthly).toLocaleString("en-IN")}
                    <span className="text-xs font-normal text-slate-500"> / month</span>
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    <li>Up to {p.max_employees} employees</li>
                    <li>{p.payroll ? "Payroll and payslips" : "No payroll"}</li>
                    <li>{p.face ? "Face recognition" : "No face recognition"}</li>
                  </ul>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">2. Company details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Company name" required minLength={2} maxLength={120} value={f.org} onChange={set("org")} />
            <Input label="Your full name" required maxLength={120} value={f.name} onChange={set("name")} />
            <Input label="Contact phone" type="tel" required maxLength={30} value={f.phone} onChange={set("phone")} />
            <Input label="GSTIN (optional)" maxLength={20} value={f.gstin} onChange={set("gstin")} />
          </div>
          <Input label="Address (optional)" maxLength={300} value={f.address} onChange={set("address")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="City" required maxLength={80} value={f.city} onChange={set("city")} />
            <Input label="State" required maxLength={80} value={f.state} onChange={set("state")} />
          </div>
        </Card>

        <ErrorText>{error}</ErrorText>
        <p className="text-center text-xs text-slate-500">
          By creating the company you confirm you will tell your staff how their attendance, location and selfies are used, as the <Link to="/terms" className="font-medium text-brand-600 hover:underline">Terms</Link> and <Link to="/privacy" className="font-medium text-brand-600 hover:underline">Privacy Policy</Link> explain.
        </p>
        <Button type="submit" className="w-full py-3" loading={busy}>
          Create company
        </Button>
        <button type="button" onClick={signOut} className="block w-full text-center text-sm text-slate-500 hover:underline">
          Sign out
        </button>
        <p className="text-center text-xs text-slate-400">
          If you are a staff member and see this page, your login is not linked or was deactivated. Contact your admin.
        </p>
      </form>
    </div>
  );
}

/** Calls the password-reset server function and returns its JSON, throwing its message on failure. */
async function resetCall(body: Record<string, string>): Promise<{ ok?: boolean; error?: string; expired?: boolean; wait_seconds?: number }> {
  const { data, error } = await supabase.functions.invoke("password-reset", { body });
  if (!error) return data;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      return await ctx.json();
    } catch {
      /* fall through */
    }
  }
  return { error: "Could not reach the server. Check your internet and try again." };
}

/** Forgot password: email -> 6-digit code by email -> new password. */
export function ForgotPassword() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const r = await resetCall({ action: "request", email: email.trim() });
    setBusy(false);
    if (r.wait_seconds) setWait(r.wait_seconds);
    if (r.error && !r.wait_seconds) return setError(r.error);
    setStep("code");
    setCode("");
    if (!r.wait_seconds) setWait(60);
    setInfo(r.wait_seconds ? r.error! : `If an account exists for ${email.trim()}, we've sent a 6-digit code to it. Check your inbox and spam folder.`);
  };

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match. Type the same password in both boxes.");
    setBusy(true);
    setError("");
    const r = await resetCall({ action: "reset", email: email.trim(), code, password });
    if (r.error) {
      setBusy(false);
      setError(r.error);
      if (r.expired) setCode("");
      return;
    }
    // Password changed: sign in with it, and the app opens the usual home page.
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signErr) {
      setBusy(false);
      setInfo("");
      setError("Your password was changed. Please sign in with the new password.");
    }
  };

  if (step === "email") {
    return (
      <Shell title="Forgot password" subtitle="We'll email you a 6-digit code">
        <form onSubmit={send} className="space-y-4">
          <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" loading={busy}>Send code</Button>
          <p className="text-center text-sm text-slate-500">
            <Link to="/login" className="font-medium text-brand-600 hover:underline">Back to sign in</Link>
          </p>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Enter the code" subtitle="Then choose a new password">
      <form onSubmit={reset} className="space-y-4">
        {info && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{info}</p>}
        <Input
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/D/g, "").slice(0, 6))}
          hint="Valid for 10 minutes."
        />
        <PasswordInput label="New password" autoComplete="new-password" required minLength={8} maxLength={72} hint="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          hint={confirm && confirm !== password ? "Does not match the password above yet" : undefined}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>Set new password</Button>
        <div className="flex items-center justify-between text-sm">
          <button type="button" onClick={() => { setStep("email"); setError(""); setInfo(""); }} className="text-slate-500 hover:underline">Change email</button>
          <button type="button" disabled={wait > 0 || busy} onClick={() => void send()} className="font-medium text-brand-600 hover:underline disabled:text-slate-400 disabled:no-underline">
            {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
          </button>
        </div>
      </form>
    </Shell>
  );
}
