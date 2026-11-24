import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, CalendarCheck, Check, MapPin, MapPinned, ScanFace, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Plan } from "../lib/types";
import { InstallButton } from "../components/InstallApp";

const FEATURES = [
  { icon: MapPin, title: "Selfie + location check-in", text: "Staff check in with a live selfie. Office staff must be inside the branch geofence." },
  { icon: MapPinned, title: "Built for field staff", text: "Field teams check in from anywhere and log every client visit with a selfie and location." },
  { icon: ScanFace, title: "Face recognition", text: "Every selfie is compared with the registered face, and mismatches are flagged for managers." },
  { icon: CalendarCheck, title: "Shifts, leave and holidays", text: "Late and half-day rules, leave balances, approvals and a monthly attendance sheet." },
  { icon: Banknote, title: "Payroll for India", text: "Salary, PF, ESI, professional tax and TDS, with payslips and a bank transfer sheet." },
  { icon: ShieldCheck, title: "Your data stays yours", text: "Each company's data is isolated, and selfies are stored privately." },
];

const cta = "rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700";

export function Landing() {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    supabase.from("plans").select("*").order("sort_order").then(({ data }) => setPlans((data as Plan[]) ?? []));
  }, []);

  return (
    <div className="min-h-full bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <img src="/logo.png" alt="IWILL Attend" className="h-10 w-auto sm:h-11" />
        <nav className="flex items-center gap-2 text-sm font-medium">
          <Link to="/login" className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100">Sign in</Link>
          <Link to="/signup" className="rounded-lg bg-brand-600 px-3 py-2 text-white hover:bg-brand-700">Start free</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-4 pb-14 pt-10 text-center sm:pt-16">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-5xl">Attendance you can trust, payroll that follows</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 sm:text-lg">
          Selfie and location based attendance for office and field staff, with leave, shifts and India payroll in one place. Works in any phone browser.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/signup" className={cta}>Start your free trial</Link>
          <Link to="/login" className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sign in</Link>
        </div>
        <p className="mt-3 text-xs text-slate-500">14 days of every feature. No card needed.</p>
        <div className="mt-5 flex justify-center"><InstallButton /></div>
      </section>

      <section className="bg-slate-50 py-14">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white p-5">
              <Icon className="h-6 w-6 text-brand-600" />
              <h3 className="mt-3 font-semibold text-navy-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {plans.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-center text-2xl font-bold text-navy-900">Simple pricing</h2>
          <p className="mt-2 text-center text-sm text-slate-600">Start on the trial, then pick the plan that fits your team.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className={`flex flex-col rounded-xl border p-6 ${p.id === "standard" ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200"}`}>
                <h3 className="font-semibold text-navy-900">{p.name}</h3>
                <p className="mt-2 text-3xl font-bold text-navy-900">
                  {Number(p.price_monthly) === 0 ? "₹0" : `₹${Number(p.price_monthly).toLocaleString("en-IN")}`}
                  <span className="text-sm font-normal text-slate-500"> / month</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-700">
                  {[
                    `Up to ${p.max_employees} employees`,
                    "Selfie + location attendance",
                    "Field visits, shifts, leave and reports",
                    ...(p.payroll ? ["Payroll and payslips"] : []),
                    ...(p.face ? ["Face recognition"] : []),
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" /> {line}
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className={`mt-6 text-center ${cta}`}>Start free</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} IWILL Attend · <Link to="/privacy" className="hover:underline">Privacy Policy</Link> · <Link to="/terms" className="hover:underline">Terms of Service</Link>
      </footer>
    </div>
  );
}
