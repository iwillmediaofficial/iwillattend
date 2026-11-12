import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Settings2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Plan } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorText, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { inr } from "../lib/payroll";
import { errMsg, fmtDate } from "../lib/utils";

interface OrgRow {
  id: string;
  name: string;
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
  active_employees: number;
  plan_id: string;
  sub_status: "trial" | "active" | "suspended";
  valid_until: string | null;
  state: "ok" | "expired" | "suspended" | "over_limit";
  last_check_in: string | null;
  paid_total: number;
}
interface Payment { id: string; plan_id: string; amount: number; paid_on: string; valid_until: string | null; reference: string | null; note: string | null }

const today = () => new Date().toISOString().slice(0, 10);

function StatusBadge({ o }: { o: OrgRow }) {
  if (o.state === "suspended") return <Badge tone="red">Suspended</Badge>;
  if (o.state === "expired") return <Badge tone="red">Expired</Badge>;
  if (o.state === "over_limit") return <Badge tone="red">Over limit, paused</Badge>;
  if (o.sub_status === "trial") return o.valid_until && o.valid_until < today() ? <Badge tone="amber">Trial ended (Free)</Badge> : <Badge tone="indigo">Trial</Badge>;
  return <Badge tone="green">Active</Badge>;
}

export function Platform() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [manage, setManage] = useState<OrgRow | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [form, setForm] = useState({ plan: "", status: "active", valid: "" });
  const [pay, setPay] = useState({ amount: "", paid_on: today(), valid: "", reference: "", note: "" });
  const [planForm, setPlanForm] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [o, p] = await Promise.all([supabase.rpc("admin_list_orgs"), supabase.from("plans").select("*").order("sort_order")]);
    if (o.error) setError(o.error.message);
    setOrgs((o.data as OrgRow[]) ?? []);
    setPlans((p.data as Plan[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openManage = async (o: OrgRow) => {
    setError("");
    setManage(o);
    setForm({ plan: o.plan_id, status: o.sub_status, valid: o.valid_until ?? "" });
    setPay({ amount: "", paid_on: today(), valid: "", reference: "", note: "" });
    const { data } = await supabase.rpc("admin_list_payments", { p_org: o.id });
    setPayments((data as Payment[]) ?? []);
  };

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, after: () => void) => {
    setBusy(true);
    setError("");
    try {
      const { error } = await fn();
      if (error) throw error;
      after();
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };

  const saveOrg = (e: FormEvent) => {
    e.preventDefault();
    void run(() => supabase.rpc("admin_update_org", { p_org: manage!.id, p_plan: form.plan, p_status: form.status, p_valid_until: form.valid || null }), () => setManage(null));
  };

  const savePayment = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => supabase.rpc("admin_record_payment", { p_org: manage!.id, p_plan: form.plan, p_amount: Number(pay.amount), p_paid_on: pay.paid_on, p_valid_until: pay.valid || null, p_reference: pay.reference, p_note: pay.note }),
      () => setManage(null),
    );
  };

  const savePlan = (e: FormEvent) => {
    e.preventDefault();
    const p = planForm!;
    void run(() => supabase.rpc("admin_update_plan", { p_id: p.id, p_price: Number(p.price_monthly), p_max_employees: Number(p.max_employees), p_payroll: p.payroll, p_face: p.face }), () => setPlanForm(null));
  };

  if (!orgs) return <Spinner />;

  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;
  const stats = [
    { label: "Companies", value: orgs.length },
    { label: "On trial", value: orgs.filter((o) => o.sub_status === "trial" && (!o.valid_until || o.valid_until >= today())).length },
    { label: "Paying", value: orgs.filter((o) => o.sub_status === "active" && o.plan_id !== "free" && o.state === "ok").length },
    { label: "Active employees", value: orgs.reduce((t, o) => t + Number(o.active_employees), 0) },
    { label: "Payments recorded", value: inr(orgs.reduce((t, o) => t + Number(o.paid_total), 0)) },
  ];

  return (
    <>
      <PageHeader title="Platform admin" subtitle="Every company using IWILL Attend. Only you can see this page." />
      {!manage && !planForm && <div className="mb-3"><ErrorText>{error}</ErrorText></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-xl font-semibold">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-5">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Companies</h2>
        {orgs.length === 0 ? (
          <Empty>No companies yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Employees</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Valid until</th>
                  <th className="px-3 py-2 font-medium">Last check-in</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{o.name}</p>
                      <p className="text-xs text-slate-500">{o.owner_name} · {o.owner_email} · joined {fmtDate(o.created_at.slice(0, 10))}</p>
                    </td>
                    <td className="px-3 py-2">{o.active_employees}</td>
                    <td className="px-3 py-2">{planName(o.plan_id)}</td>
                    <td className="px-3 py-2"><StatusBadge o={o} /></td>
                    <td className="px-3 py-2">{o.valid_until ? fmtDate(o.valid_until) : "No end date"}</td>
                    <td className="px-3 py-2">{o.last_check_in ? fmtDate(o.last_check_in) : "Never"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(o.paid_total)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" aria-label={`Manage ${o.name}`} onClick={() => openManage(o)}><Settings2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Plans (shown on the public pricing page)</h2>
        <ul className="divide-y divide-slate-100">
          {plans.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{p.name} · {inr(p.price_monthly)} / month</p>
                <p className="text-xs text-slate-500">Up to {p.max_employees} employees · Payroll {p.payroll ? "included" : "not included"} · Face recognition {p.face ? "included" : "not included"}</p>
              </div>
              <Button variant="ghost" aria-label={`Edit ${p.name} plan`} onClick={() => { setError(""); setPlanForm(p); }}><Pencil className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      </Card>

      {manage && (
        <Modal title={manage.name} onClose={() => setManage(null)}>
          <form onSubmit={saveOrg} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Select label="Plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </Select>
            </div>
            <Input label="Valid until" type="date" value={form.valid} onChange={(e) => setForm({ ...form, valid: e.target.value })} hint="Blank = no end date. A trial past this date drops to Free; an active plan past it pauses attendance." />
            <Button type="submit" variant="outline" className="w-full" loading={busy}>Save plan and status</Button>
          </form>

          <form onSubmit={savePayment} className="mt-6 space-y-4 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold">Record a payment</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Amount ₹" type="number" min={0} step="0.01" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
              <Input label="Paid on" type="date" required value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} />
              <Input label="Paid through" type="date" required value={pay.valid} onChange={(e) => setPay({ ...pay, valid: e.target.value })} />
              <Input label="Reference (UPI / bank)" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            </div>
            <Input label="Note" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            <p className="text-xs text-slate-500">Saving sets this company to Active on the plan selected above, valid through the date given.</p>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Record payment and activate</Button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold">Payment history</h3>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-500">No payments recorded.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3">
                    <span>{fmtDate(p.paid_on)} · {planName(p.plan_id)}{p.reference ? ` · ${p.reference}` : ""}</span>
                    <span className="tabular-nums">{inr(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {planForm && (
        <Modal title={`Edit plan: ${planForm.name}`} onClose={() => setPlanForm(null)}>
          <form onSubmit={savePlan} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Price ₹ / month" type="number" min={0} step="1" required value={planForm.price_monthly} onChange={(e) => setPlanForm({ ...planForm, price_monthly: Number(e.target.value) })} />
              <Input label="Max active employees" type="number" min={1} required value={planForm.max_employees} onChange={(e) => setPlanForm({ ...planForm, max_employees: Number(e.target.value) })} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={planForm.payroll} onChange={(e) => setPlanForm({ ...planForm, payroll: e.target.checked })} /> Includes payroll</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={planForm.face} onChange={(e) => setPlanForm({ ...planForm, face: e.target.checked })} /> Includes face recognition</label>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Save plan</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
