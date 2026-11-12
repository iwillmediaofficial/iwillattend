import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Plan } from "../lib/types";
import { Button, Card, ErrorText, Field, Input } from "../components/ui";
import { errMsg } from "../lib/utils";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link to="/" aria-label="IWILL Attend home"><img src="/icon.svg" alt="" className="mx-auto mb-3 h-12 w-12" /></Link>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <Card className="p-5">{children}</Card>
      </div>
    </div>
  );
}

/** Password field with a show/hide button. */
function PasswordInput({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <span className="relative block">
        <input
          {...rest}
          type={show ? "text" : "password"}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
    <Shell title="IWILL Attend" subtitle="Sign in to mark or manage attendance">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
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
    <Shell title="Register your company" subtitle="Step 1 of 2: create the owner account">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Work email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput label="Password" autoComplete="new-password" required minLength={8} hint="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
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
        <img src="/icon.svg" alt="" className="mx-auto mb-3 h-12 w-12" />
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
                  className={`rounded-xl border p-4 text-left ${on ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <p className="flex items-center justify-between font-semibold">
                    {p.name} {on && <Check className="h-4 w-4 text-indigo-600" />}
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
