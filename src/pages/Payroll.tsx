import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Calculator, Download, Eye, Lock, LockOpen, Pencil } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, Empty, ErrorText, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { PayslipView } from "../components/PayslipView";
import {
  DEFAULT_SETTINGS, computeSlip, inr, loadMuster, monthLabel, totals,
  type PayrollRun, type PayrollSettings, type Payslip, type SalaryStructure,
} from "../lib/payroll";
import { downloadCsv, errMsg, todayIn } from "../lib/utils";
import { monthDates, type MusterEmployee } from "../lib/muster";

interface Emp { id: string; full_name: string; emp_code: string | null; joined_on: string; exit_on: string | null; designation: string | null; department: string | null }
type Tab = "run" | "salaries" | "rules";
type StructForm = { [K in keyof Omit<SalaryStructure, "employee_id" | "pf_applicable" | "esi_applicable">]: string } & { employee_id: string; pf_applicable: boolean; esi_applicable: boolean };

const SLIP_EMP = "employee:employees(full_name, emp_code, designation, department)";
const num = (v: unknown) => Number(v) || 0;

export function Payroll() {
  const { org, employee: me, sub } = useAuth();
  const today = todayIn(org!.timezone);
  const [tab, setTab] = useState<Tab>("run");
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [structs, setStructs] = useState<SalaryStructure[]>([]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [runLoading, setRunLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<Payslip | null>(null);
  const [adjust, setAdjust] = useState<{ slip: Payslip; bonus: string; other: string } | null>(null);
  const [structForm, setStructForm] = useState<StructForm | null>(null);

  const structOf = useMemo(() => new Map(structs.map((s) => [s.employee_id, s])), [structs]);
  const hasSalary = (id: string) => {
    const s = structOf.get(id);
    return !!s && num(s.basic) + num(s.hra) + num(s.allowances) > 0;
  };

  const loadBase = useCallback(async () => {
    const [s, e, st] = await Promise.all([
      supabase.from("payroll_settings").select("*").maybeSingle(),
      supabase.from("employees").select("id, full_name, emp_code, joined_on, exit_on, designation, department").eq("is_active", true).order("full_name"),
      supabase.from("salary_structures").select("*"),
    ]);
    setSettings({ ...DEFAULT_SETTINGS, ...((s.data as Partial<PayrollSettings> | null) ?? {}) });
    setEmps((e.data as Emp[]) ?? []);
    setStructs((st.data as SalaryStructure[]) ?? []);
  }, []);

  const loadRun = useCallback(async () => {
    setRunLoading(true);
    const { data: r } = await supabase.from("payroll_runs").select("id, month, status").eq("month", `${month}-01`).maybeSingle();
    setRun((r as PayrollRun | null) ?? null);
    if (r) {
      const { data } = await supabase.from("payslips").select(`*, ${SLIP_EMP}`).eq("run_id", r.id);
      const list = (data as unknown as Payslip[]) ?? [];
      setSlips(list.sort((a, b) => (a.employee?.full_name ?? "").localeCompare(b.employee?.full_name ?? "")));
    } else setSlips([]);
    setRunLoading(false);
  }, [month]);

  useEffect(() => { void loadBase(); }, [loadBase]);
  useEffect(() => { void loadRun(); }, [loadRun]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  // ---------- Run ----------
  const calculate = () => guard(async () => {
    // Active staff, plus anyone whose last working day falls in or after this month.
    const staff = await supabase.from("employees").select("id, full_name, emp_code, joined_on, exit_on, designation, department")
      .or(`is_active.eq.true,exit_on.gte.${month}-01`).lte("joined_on", monthDates(month).at(-1)!).order("full_name");
    if (staff.error) throw staff.error;
    const eligible = ((staff.data as Emp[]) ?? []).filter((e) => hasSalary(e.id));
    if (eligible.length === 0) throw new Error("No employee has a salary set. Add salaries in the Salaries tab first.");
    let runId = run?.id;
    if (!runId) {
      const { data, error } = await supabase.from("payroll_runs").insert({ org_id: org!.id, month: `${month}-01`, created_by: me!.id }).select("id").single();
      if (error) throw error;
      runId = data.id as string;
    }
    const rows = await loadMuster(month, today, org!, eligible);
    const keep = new Map(slips.map((s) => [s.employee_id, s]));
    const fresh = rows.map((row) => {
      const old = keep.get(row.employee.id);
      return { run_id: runId, org_id: org!.id, employee_id: row.employee.id, ...computeSlip(structOf.get(row.employee.id)!, settings!, row, num(old?.bonus), num(old?.other_deduction), org!) };
    });
    const del = await supabase.from("payslips").delete().eq("run_id", runId);
    if (del.error) throw del.error;
    const ins = await supabase.from("payslips").insert(fresh);
    if (ins.error) throw ins.error;
    await loadRun();
  });

  const setLocked = (locked: boolean) => guard(async () => {
    const monthDate = `${month}-01`;
    const last = monthDates(month).at(-1)!;

    if (!locked) {
      if (!window.confirm(`Reopen payroll for ${monthLabel(month)}? Payslips will be hidden from employees until you finalise again.`)) return;
      const { error } = await supabase.from("payroll_runs").update({ status: "draft", locked_at: null }).eq("id", run!.id);
      if (error) throw error;
      await supabase.from("muster_snapshots").delete().eq("month", monthDate);
      await loadRun();
      return;
    }

    if (slips.some((p) => num(p.net_pay) < 0)) throw new Error("One or more payslips have a negative net pay (shown in red). Adjust them before finalising.");
    const [pl, pc, po] = await Promise.all([
      supabase.from("attendance").select("id", { count: "exact", head: true }).eq("ot_status", "pending").gte("work_date", monthDate).lte("work_date", last),
      supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending").lte("from_date", last).gte("to_date", monthDate),
      supabase.from("correction_requests").select("id", { count: "exact", head: true }).eq("status", "pending").gte("work_date", monthDate).lte("work_date", last),
    ]);
    // The array order above is [overtime, leave, corrections].
    const pending = (pl.count ?? 0) + (pc.count ?? 0) + (po.count ?? 0);
    const warn = pending > 0 ? `${pending} leave, correction or overtime item(s) for this month are still pending. Once you finalise, they cannot be approved unless payroll is reopened, and pending overtime is not paid.\n\n` : "";
    if (!window.confirm(`${warn}Finalise payroll for ${monthLabel(month)}? Employees will see their payslips and the figures can no longer be changed.`)) return;

    // Freeze the month's attendance sheet, so later rule changes cannot rewrite it.
    const staff = await supabase.from("employees").select("id, full_name, emp_code, joined_on, exit_on")
      .or(`is_active.eq.true,exit_on.gte.${monthDate}`).lte("joined_on", last).order("full_name");
    if (staff.error) throw staff.error;
    const sheet = await loadMuster(month, today, org!, (staff.data as MusterEmployee[]) ?? []);
    await supabase.from("muster_snapshots").delete().eq("month", monthDate);
    const snap = await supabase.from("muster_snapshots").insert(
      sheet.map((r) => ({ org_id: org!.id, month: monthDate, employee_id: r.employee.id, full_name: r.employee.full_name, emp_code: r.employee.emp_code, days: r.days, counts: r.counts, unpaid_off: r.unpaidOff, payable: r.payable, ot_minutes: r.otMinutes })),
    );
    if (snap.error) throw snap.error;
    const { error } = await supabase.from("payroll_runs").update({ status: "locked", locked_at: new Date().toISOString() }).eq("id", run!.id);
    if (error) {
      await supabase.from("muster_snapshots").delete().eq("month", monthDate);
      throw error;
    }
    await loadRun();
  });

  const saveAdjust = (e: FormEvent) => {
    e.preventDefault();
    if (!adjust) return;
    void guard(async () => {
      const st = structOf.get(adjust.slip.employee_id);
      if (!st) throw new Error("This employee no longer has a salary set.");
      const bonus = Math.max(0, num(adjust.bonus));
      const other = Math.max(0, num(adjust.other));
      const s = adjust.slip;
      const t = totals({ basic: num(s.basic), hra: num(s.hra), allowances: num(s.allowances) }, bonus, other, st, settings!, num(s.tds), num(s.ot_pay));
      const { error } = await supabase.from("payslips").update({ bonus, other_deduction: other, ...t }).eq("id", s.id);
      if (error) throw error;
      setAdjust(null);
      await loadRun();
    });
  };

  const exportRegister = () =>
    downloadCsv(`payroll_register_${month}.csv`, [
      ["Employee", "Code", "Paid days", "Unpaid days", "Basic", "HRA", "Allowances", "Bonus", "OT hours", "OT pay", "Gross", "PF", "ESI", "Prof. tax", "TDS", "Other deductions", "Total deductions", "Net pay", "Employer PF", "Employer ESI"],
      ...slips.map((s) => [s.employee?.full_name, s.employee?.emp_code, s.paid_days, s.unpaid_days, s.basic, s.hra, s.allowances, s.bonus, s.ot_hours, s.ot_pay, s.gross, s.pf_employee, s.esi_employee, s.pt, s.tds, s.other_deduction, s.total_deductions, s.net_pay, s.pf_employer, s.esi_employer]),
    ]);

  const exportBank = () =>
    downloadCsv(`bank_transfer_${month}.csv`, [
      ["Employee", "Code", "Bank", "Account number", "IFSC", "Net pay"],
      ...slips.map((s) => {
        const st = structOf.get(s.employee_id);
        return [s.employee?.full_name, s.employee?.emp_code, st?.bank_name, st?.bank_account, st?.ifsc, s.net_pay];
      }),
    ]);

  // ---------- Salaries ----------
  const editStruct = (e: Emp) => {
    const s = structOf.get(e.id);
    setError("");
    setStructForm({
      employee_id: e.id,
      basic: String(num(s?.basic)), hra: String(num(s?.hra)), allowances: String(num(s?.allowances)), tds_monthly: String(num(s?.tds_monthly)),
      pf_applicable: s?.pf_applicable ?? true, esi_applicable: s?.esi_applicable ?? true,
      bank_name: s?.bank_name ?? "", bank_account: s?.bank_account ?? "", ifsc: s?.ifsc ?? "", pan: s?.pan ?? "", uan: s?.uan ?? "",
      ot_mode: s?.ot_mode ?? "company", ot_multiplier: String(num(s?.ot_multiplier) || 1.5), ot_fixed_rate: String(num(s?.ot_fixed_rate)),
    });
  };

  const saveStruct = (e: FormEvent) => {
    e.preventDefault();
    if (!structForm) return;
    void guard(async () => {
      const f = structForm;
      const txt = (v: string) => v.trim() || null;
      const { error } = await supabase.from("salary_structures").upsert({
        employee_id: f.employee_id, org_id: org!.id,
        basic: num(f.basic), hra: num(f.hra), allowances: num(f.allowances), tds_monthly: num(f.tds_monthly),
        pf_applicable: f.pf_applicable, esi_applicable: f.esi_applicable,
        bank_name: txt(f.bank_name), bank_account: txt(f.bank_account), ifsc: txt(f.ifsc)?.toUpperCase() ?? null, pan: txt(f.pan)?.toUpperCase() ?? null, uan: txt(f.uan),
        ot_mode: f.ot_mode, ot_multiplier: f.ot_mode === "multiplier" ? num(f.ot_multiplier) : null, ot_fixed_rate: f.ot_mode === "fixed" ? num(f.ot_fixed_rate) : null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setStructForm(null);
      await loadBase();
    });
  };

  // ---------- Rules ----------
  const saveRules = (e: FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      const { error } = await supabase.from("payroll_settings").upsert({ org_id: org!.id, ...settings!, updated_at: new Date().toISOString() });
      if (error) throw error;
      await loadBase();
      window.alert("Payroll rules saved. Recalculate any draft month to apply them.");
    });
  };
  const setS = <K extends keyof PayrollSettings>(k: K, v: PayrollSettings[K]) => setSettings((s) => s && { ...s, [k]: v });

  if (sub && !sub.payroll) {
    return (
      <>
        <PageHeader title="Payroll" subtitle="Salaries, monthly payroll and payslips" />
        <Card className="p-6 text-center">
          <p className="text-base font-semibold">Payroll is not included in the {sub.plan_name} plan</p>
          <p className="mt-1 text-sm text-slate-600">Upgrade to Standard or Premium to run payroll and issue payslips. Contact IWILL Attend support to upgrade.</p>
        </Card>
      </>
    );
  }
  if (!settings) return <Spinner />;

  const locked = run?.status === "locked";
  const missing = emps.filter((e) => !hasSalary(e.id));
  const monthOpen = month === today.slice(0, 7);
  const sum = (k: keyof Payslip) => slips.reduce((t, s) => t + num(s[k]), 0);
  const sf = structForm;
  const setF = <K extends keyof StructForm>(k: K, v: StructForm[K]) => setStructForm((f) => f && { ...f, [k]: v });

  return (
    <>
      <PageHeader title="Payroll" subtitle="Salaries, monthly payroll and payslips" />
      <div className="mb-5 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium">
        {([["run", "Monthly payroll"], ["salaries", "Salaries"], ["rules", "Rules"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => { setError(""); setTab(k); }} className={`flex-1 rounded-md px-3 py-1.5 ${tab === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mb-3"><ErrorText>{error}</ErrorText></div>

      {tab === "run" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            {run && (locked ? <Badge tone="green">Finalised</Badge> : <Badge tone="amber">Draft</Badge>)}
            <div className="flex-1" />
            {!locked && (
              <Button onClick={calculate} loading={busy} disabled={runLoading}>
                <Calculator className="h-4 w-4" /> {run ? "Recalculate" : "Calculate payroll"}
              </Button>
            )}
            {run && !locked && slips.length > 0 && (
              <Button variant="success" onClick={() => setLocked(true)} disabled={busy}><Lock className="h-4 w-4" /> Finalise</Button>
            )}
            {locked && me!.role === "owner" && (
              <Button variant="outline" onClick={() => setLocked(false)} disabled={busy}><LockOpen className="h-4 w-4" /> Reopen</Button>
            )}
          </div>

          {monthOpen && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{monthLabel(month)} is not over yet. Days after today are not counted, so this is only an estimate. Recalculate after month end before finalising.</p>}
          {missing.length > 0 && <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">{missing.length} active employee(s) have no salary set and are left out: {missing.slice(0, 5).map((m) => m.full_name).join(", ")}{missing.length > 5 ? "…" : ""}</p>}

          <Card>
            {runLoading ? (
              <Spinner />
            ) : slips.length === 0 ? (
              <Empty>No payroll calculated for {monthLabel(month)} yet.</Empty>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <p className="text-sm"><span className="font-semibold">{slips.length}</span> employees · Gross <span className="font-semibold">{inr(sum("gross"))}</span> · Net <span className="font-semibold">{inr(sum("net_pay"))}</span></p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={exportRegister}><Download className="h-4 w-4" /> Register</Button>
                    <Button variant="outline" onClick={exportBank}><Download className="h-4 w-4" /> Bank sheet</Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Employee</th>
                        <th className="px-3 py-2 text-right font-medium">Paid days</th>
                        <th className="px-3 py-2 text-right font-medium">Gross</th>
                        {org!.ot_enabled && <th className="px-3 py-2 text-right font-medium">Overtime</th>}
                        <th className="px-3 py-2 text-right font-medium">PF</th>
                        <th className="px-3 py-2 text-right font-medium">ESI</th>
                        <th className="px-3 py-2 text-right font-medium">PT</th>
                        <th className="px-3 py-2 text-right font-medium">TDS</th>
                        <th className="px-3 py-2 text-right font-medium">Other</th>
                        <th className="px-3 py-2 text-right font-medium">Net pay</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {slips.map((s) => (
                        <tr key={s.id} className="tabular-nums">
                          <td className="px-4 py-2 font-medium">{s.employee?.full_name}</td>
                          <td className="px-3 py-2 text-right">{num(s.paid_days)} / {s.days_in_month}</td>
                          <td className="px-3 py-2 text-right">{inr(s.gross)}</td>
                          {org!.ot_enabled && <td className="px-3 py-2 text-right">{num(s.ot_pay) ? <>{inr(s.ot_pay)}<span className="block text-[10px] text-slate-500">{num(s.ot_hours)} h</span></> : "—"}</td>}
                          <td className="px-3 py-2 text-right">{inr(s.pf_employee)}</td>
                          <td className="px-3 py-2 text-right">{inr(s.esi_employee)}</td>
                          <td className="px-3 py-2 text-right">{inr(s.pt)}</td>
                          <td className="px-3 py-2 text-right">{inr(s.tds)}</td>
                          <td className="px-3 py-2 text-right">{inr(s.other_deduction)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${num(s.net_pay) < 0 ? "text-rose-600" : ""}`}>{inr(s.net_pay)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            <Button variant="ghost" aria-label={`View payslip for ${s.employee?.full_name}`} onClick={() => setView(s)}><Eye className="h-4 w-4" /></Button>
                            {!locked && !(me!.role === "hr" && s.employee_id === me!.id) && (
                              <Button variant="ghost" aria-label={`Adjust pay for ${s.employee?.full_name}`} onClick={() => { setError(""); setAdjust({ slip: s, bonus: String(num(s.bonus)), other: String(num(s.other_deduction)) }); }}><Pencil className="h-4 w-4" /></Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {tab === "salaries" && (
        <Card>
          {emps.length === 0 ? (
            <Empty>No active employees.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Employee</th>
                    <th className="px-3 py-2 text-right font-medium">Basic</th>
                    <th className="px-3 py-2 text-right font-medium">HRA</th>
                    <th className="px-3 py-2 text-right font-medium">Allowances</th>
                    <th className="px-3 py-2 text-right font-medium">Monthly gross</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {emps.map((e) => {
                    const s = hasSalary(e.id) ? structOf.get(e.id) : undefined;
                    return (
                      <tr key={e.id} className="tabular-nums">
                        <td className="px-4 py-2 font-medium">{e.full_name}</td>
                        {s ? (
                          <>
                            <td className="px-3 py-2 text-right">{inr(s.basic)}</td>
                            <td className="px-3 py-2 text-right">{inr(s.hra)}</td>
                            <td className="px-3 py-2 text-right">{inr(s.allowances)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{inr(num(s.basic) + num(s.hra) + num(s.allowances))}</td>
                          </>
                        ) : (
                          <td colSpan={4} className="px-3 py-2 text-right text-slate-400">Not set</td>
                        )}
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" aria-label={`Edit salary for ${e.full_name}`} onClick={() => editStruct(e)}><Pencil className="h-4 w-4" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "rules" && (
        <Card className="p-5">
          <form onSubmit={saveRules} className="space-y-5">
            <Select label="Salary is divided by" value={settings.pay_days_basis} onChange={(e) => setS("pay_days_basis", e.target.value as PayrollSettings["pay_days_basis"])} hint="Used to work out the deduction for unpaid days.">
              <option value="calendar">Calendar days in the month (28 to 31)</option>
              <option value="26">Fixed 26 days</option>
              <option value="30">Fixed 30 days</option>
            </Select>
            <Input label="Late penalty: lates per half-day deduction" type="number" min={0} max={31} value={settings.lates_per_half_day} onChange={(e) => setS("lates_per_half_day", num(e.target.value))} hint="0 = lateness is only reported. 3 = every 3 lates in a month deduct half a day." />

            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={settings.pf_enabled} onChange={(e) => setS("pf_enabled", e.target.checked)} /> Provident Fund (PF)</label>
              {settings.pf_enabled && (
                <div className="grid grid-cols-3 gap-3">
                  <Input label="Employee %" type="number" step="0.01" min={0} value={settings.pf_employee_pct} onChange={(e) => setS("pf_employee_pct", num(e.target.value))} />
                  <Input label="Employer %" type="number" step="0.01" min={0} value={settings.pf_employer_pct} onChange={(e) => setS("pf_employer_pct", num(e.target.value))} />
                  <Input label="Wage ceiling ₹" type="number" min={0} value={settings.pf_wage_ceiling} onChange={(e) => setS("pf_wage_ceiling", num(e.target.value))} />
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={settings.esi_enabled} onChange={(e) => setS("esi_enabled", e.target.checked)} /> Employees' State Insurance (ESI)</label>
              {settings.esi_enabled && (
                <div className="grid grid-cols-3 gap-3">
                  <Input label="Employee %" type="number" step="0.01" min={0} value={settings.esi_employee_pct} onChange={(e) => setS("esi_employee_pct", num(e.target.value))} />
                  <Input label="Employer %" type="number" step="0.01" min={0} value={settings.esi_employer_pct} onChange={(e) => setS("esi_employer_pct", num(e.target.value))} />
                  <Input label="Gross limit ₹" type="number" min={0} value={settings.esi_gross_limit} onChange={(e) => setS("esi_gross_limit", num(e.target.value))} />
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={settings.pt_enabled} onChange={(e) => setS("pt_enabled", e.target.checked)} /> Professional Tax (PT)</label>
              {settings.pt_enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Monthly amount ₹" type="number" min={0} value={settings.pt_amount} onChange={(e) => setS("pt_amount", num(e.target.value))} />
                  <Input label="Applies when gross is at least ₹" type="number" min={0} value={settings.pt_min_gross} onChange={(e) => setS("pt_min_gross", num(e.target.value))} />
                </div>
              )}
              <p className="text-xs text-slate-500">PT slabs differ by state. This is a single flat amount; set it to your state's rate.</p>
            </fieldset>

            <p className="text-xs text-slate-500">TDS is entered per employee in the Salaries tab. Check all rates with your accountant before the first real payroll.</p>
            <Button type="submit" loading={busy}>Save rules</Button>
          </form>
        </Card>
      )}

      {view && <PayslipView slip={view} orgName={org!.name} month={`${month}-01`} draft={!locked} onClose={() => setView(null)} />}

      {adjust && (
        <Modal title={`Adjust pay: ${adjust.slip.employee?.full_name ?? ""}`} onClose={() => setAdjust(null)}>
          <form onSubmit={saveAdjust} className="space-y-4">
            <Input label="Bonus / incentive ₹" type="number" min={0} step="0.01" value={adjust.bonus} onChange={(e) => setAdjust({ ...adjust, bonus: e.target.value })} hint="Added to gross for this month." />
            <Input label="Other deduction ₹" type="number" min={0} step="0.01" value={adjust.other} onChange={(e) => setAdjust({ ...adjust, other: e.target.value })} hint="For example an advance or loan recovery." />
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Save adjustment</Button>
          </form>
        </Modal>
      )}

      {sf && (
        <Modal title={`Salary: ${emps.find((e) => e.id === sf.employee_id)?.full_name ?? ""}`} onClose={() => setStructForm(null)}>
          <form onSubmit={saveStruct} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Basic ₹ / month" type="number" min={0} step="0.01" required value={sf.basic} onChange={(e) => setF("basic", e.target.value)} />
              <Input label="HRA ₹ / month" type="number" min={0} step="0.01" value={sf.hra} onChange={(e) => setF("hra", e.target.value)} />
              <Input label="Other allowances ₹ / month" type="number" min={0} step="0.01" value={sf.allowances} onChange={(e) => setF("allowances", e.target.value)} />
              <Input label="TDS ₹ / month" type="number" min={0} step="0.01" value={sf.tds_monthly} onChange={(e) => setF("tds_monthly", e.target.value)} />
            </div>
            <p className="-mt-2 text-sm text-slate-600">Monthly gross: <b>{inr(num(sf.basic) + num(sf.hra) + num(sf.allowances))}</b></p>
            <div className="flex flex-wrap gap-5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={sf.pf_applicable} onChange={(e) => setF("pf_applicable", e.target.checked)} /> PF applies</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sf.esi_applicable} onChange={(e) => setF("esi_applicable", e.target.checked)} /> ESI applies</label>
            </div>
            {org!.ot_enabled && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
                <Select label="Overtime for this employee" value={sf.ot_mode} onChange={(e) => setF("ot_mode", e.target.value)}>
                  <option value="company">Company rule ({org!.ot_mode === "fixed" ? `${inr(org!.ot_fixed_rate)} per hour` : `${Number(org!.ot_multiplier)}× hourly rate`})</option>
                  <option value="multiplier">Own multiple of hourly rate</option>
                  <option value="fixed">Own fixed amount per hour</option>
                  <option value="none">No overtime pay</option>
                </Select>
                {sf.ot_mode === "multiplier" && <Input label="Multiple (1.5 = 150%)" type="number" min={0.5} max={5} step="0.05" required value={sf.ot_multiplier ?? ""} onChange={(e) => setF("ot_multiplier", e.target.value)} />}
                {sf.ot_mode === "fixed" && <Input label="Amount per OT hour ₹" type="number" min={0} step="1" required value={sf.ot_fixed_rate ?? ""} onChange={(e) => setF("ot_fixed_rate", e.target.value)} />}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Bank name" value={sf.bank_name ?? ""} onChange={(e) => setF("bank_name", e.target.value)} />
              <Input label="Account number" autoComplete="off" value={sf.bank_account ?? ""} onChange={(e) => setF("bank_account", e.target.value)} />
              <Input label="IFSC" value={sf.ifsc ?? ""} onChange={(e) => setF("ifsc", e.target.value)} />
              <Input label="PAN" value={sf.pan ?? ""} onChange={(e) => setF("pan", e.target.value)} />
              <Input label="UAN (PF number)" value={sf.uan ?? ""} onChange={(e) => setF("uan", e.target.value)} />
            </div>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Save salary</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
