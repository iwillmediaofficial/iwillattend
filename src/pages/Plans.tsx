import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Plan } from "../lib/types";
import { Badge, Button, Card, ErrorText, PageHeader, Spinner } from "../components/ui";
import { errMsg, fmtDate } from "../lib/utils";

interface PlanRequest { id: string; plan_id: string; note: string | null; created_at: string }

export function Plans() {
  const { sub, employee, refresh } = useAuth();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pending, setPending] = useState<PlanRequest | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const canRequest = employee!.role === "owner" || employee!.role === "admin";

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([
      supabase.from("plans").select("*").order("sort_order"),
      supabase.from("plan_requests").select("id, plan_id, note, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setPlans((p.data as Plan[]) ?? []);
    setPending((r.data as PlanRequest | null) ?? null);
  }, []);

  useEffect(() => {
    void load();
    void refresh(); // pick up a plan change made by the platform admin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const request = async (p: Plan) => {
    const note = window.prompt(`Request the ${p.name} plan?\n\nWe will contact you to confirm and arrange payment. Add a note or a good time to call (optional):`, "");
    if (note === null) return;
    setBusy(p.id);
    setError("");
    const { error } = await supabase.rpc("request_plan", { p_plan: p.id, p_note: note });
    if (error) setError(errMsg(error));
    setBusy("");
    await load();
  };

  if (!plans || !sub) return <Spinner />;

  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;

  return (
    <>
      <PageHeader title="Plans" subtitle="Your current plan and the others available" />

      <Card className="mb-5 p-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          You are on the <span className="font-semibold">{sub.plan_name}</span> plan
          {sub.state !== "ok" ? <Badge tone="red">{sub.state.replace("_", " ")}</Badge> : sub.sub_status === "trial" && sub.plan_id !== "free" ? <Badge tone="indigo">Trial</Badge> : <Badge tone="green">Active</Badge>}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {sub.active_employees} of {sub.max_employees} active employees used
          {sub.valid_until ? ` · ${sub.sub_status === "trial" ? "Trial ends" : "Valid until"} ${fmtDate(sub.valid_until)}` : ""}
        </p>
        {pending && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            You asked to move to the {planName(pending.plan_id)} plan on {fmtDate(pending.created_at.slice(0, 10))}. We will contact you to confirm.
          </p>
        )}
      </Card>
      <div className="mb-3"><ErrorText>{error}</ErrorText></div>

      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((p) => {
          const current = p.id === sub.plan_id;
          const tooSmall = sub.active_employees > p.max_employees;
          return (
            <Card key={p.id} className={`flex flex-col p-5 ${current ? "border-brand-600 ring-1 ring-brand-600" : ""}`}>
              <p className="flex items-center justify-between font-semibold">
                {p.name} {current && <Badge tone="indigo">Current</Badge>}
              </p>
              <p className="mt-2 text-2xl font-bold">
                ₹{Number(p.price_monthly).toLocaleString("en-IN")}
                <span className="text-sm font-normal text-slate-500"> / month</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
                {[
                  `Up to ${p.max_employees} active employees`,
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
              {tooSmall && <p className="mt-3 text-xs text-rose-600">You have {sub.active_employees} active employees, more than this plan allows.</p>}
              {canRequest && !current && (
                <Button className="mt-4" variant={pending?.plan_id === p.id ? "outline" : "primary"} loading={busy === p.id} disabled={pending?.plan_id === p.id} onClick={() => request(p)}>
                  {pending?.plan_id === p.id ? "Requested" : `Request ${p.name}`}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Plan changes are confirmed by our team, so a request does not change your plan immediately.{canRequest ? "" : " Only the owner or an admin can request a change."}
      </p>
    </>
  );
}
