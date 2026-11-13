import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorText, Spinner } from "./ui";
import { inr } from "../lib/payroll";

type Mode = "company" | "multiplier" | "fixed" | "none";
interface Row {
  id: string;
  name: string;
  mode: Mode;
  multiplier: string;
  fixed: string;
  dirty: boolean;
}

const fieldCls = "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/** Lets an admin give individual employees their own overtime rate, for example A at 2x and B at 1.5x. */
export function EmployeeOvertimeRates() {
  const { org, employee: me } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [e, s] = await Promise.all([
      supabase.from("employees").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("salary_structures").select("employee_id, ot_mode, ot_multiplier, ot_fixed_rate"),
    ]);
    const own = new Map(((s.data as { employee_id: string; ot_mode: Mode; ot_multiplier: number | null; ot_fixed_rate: number | null }[]) ?? []).map((x) => [x.employee_id, x]));
    setRows(
      ((e.data as { id: string; full_name: string }[]) ?? []).map((x) => {
        const o = own.get(x.id);
        return {
          id: x.id,
          name: x.full_name,
          mode: o?.ot_mode ?? "company",
          multiplier: String(Number(o?.ot_multiplier) || Number(org!.ot_multiplier)),
          fixed: String(Number(o?.ot_fixed_rate) || Number(org!.ot_fixed_rate) || 0),
          dirty: false,
        };
      }),
    );
  }, [org]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (id: string, patch: Partial<Row>) => {
    setSaved(false);
    setRows((list) => list && list.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)));
  };

  const save = async () => {
    const changed = (rows ?? []).filter((r) => r.dirty);
    for (const r of changed) {
      if (r.mode === "multiplier" && !(Number(r.multiplier) >= 0.5 && Number(r.multiplier) <= 5)) return setError(`${r.name}: enter a multiple between 0.5 and 5.`);
      if (r.mode === "fixed" && !(Number(r.fixed) > 0)) return setError(`${r.name}: enter the amount per overtime hour.`);
    }
    setBusy(true);
    setError("");
    // Only the overtime columns are sent, so an existing salary is left untouched.
    const { error } = await supabase.from("salary_structures").upsert(
      changed.map((r) => ({
        employee_id: r.id,
        org_id: org!.id,
        ot_mode: r.mode,
        ot_multiplier: r.mode === "multiplier" ? Number(r.multiplier) : null,
        ot_fixed_rate: r.mode === "fixed" ? Number(r.fixed) : null,
      })),
    );
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    await load();
  };

  if (!rows) return <Spinner />;

  const companyRule = org!.ot_mode === "fixed" ? `${inr(org!.ot_fixed_rate)} per hour` : `${Number(org!.ot_multiplier)}×`;
  const dirty = rows.some((r) => r.dirty);

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold">Different overtime for individual employees</p>
        <p className="text-xs text-slate-500">Everyone follows the company rule ({companyRule}) unless you change them here.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const locked = me!.role === "hr" && r.id === me!.id; // HR cannot set their own pay
          return (
            <li key={r.id} className="grid grid-cols-1 items-center gap-2 px-4 py-2 sm:grid-cols-[1fr_12rem_9rem]">
              <span className="text-sm font-medium">{r.name}</span>
              <select aria-label={`Overtime rule for ${r.name}`} className={fieldCls} disabled={locked} value={r.mode} onChange={(e) => change(r.id, { mode: e.target.value as Mode })}>
                <option value="company">Company rule ({companyRule})</option>
                <option value="multiplier">Own multiple</option>
                <option value="fixed">Own amount per hour</option>
                <option value="none">No overtime pay</option>
              </select>
              {r.mode === "multiplier" ? (
                <label className="flex items-center gap-1 text-sm">
                  <input aria-label={`Overtime multiple for ${r.name}`} type="number" min={0.5} max={5} step="0.05" className={fieldCls} disabled={locked} value={r.multiplier} onChange={(e) => change(r.id, { multiplier: e.target.value })} />×
                </label>
              ) : r.mode === "fixed" ? (
                <label className="flex items-center gap-1 text-sm">
                  ₹<input aria-label={`Overtime amount per hour for ${r.name}`} type="number" min={0} step="1" className={fieldCls} disabled={locked} value={r.fixed} onChange={(e) => change(r.id, { fixed: e.target.value })} />
                </label>
              ) : (
                <span className="text-xs text-slate-400">{r.mode === "none" ? "Not paid" : "—"}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-3">
        <Button type="button" variant="outline" onClick={save} loading={busy} disabled={!dirty}>Save employee rates</Button>
        {saved && !dirty && <span className="text-sm text-success-600">Saved</span>}
      </div>
      <div className="px-4 pb-3"><ErrorText>{error}</ErrorText></div>
    </div>
  );
}
