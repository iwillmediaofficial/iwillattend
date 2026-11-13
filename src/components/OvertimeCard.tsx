import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Organization } from "../lib/types";
import { Button, Card, ErrorText, Input, Select } from "./ui";
import { EmployeeOvertimeRates } from "./EmployeeOvertimeRates";

type Ot = Pick<Organization, "ot_enabled" | "ot_mode" | "ot_multiplier" | "ot_fixed_rate" | "ot_min_minutes" | "ot_round_minutes" | "ot_max_minutes" | "ot_requires_approval" | "ot_off_days">;

const MULTIPLIERS = [1, 1.25, 1.5, 2];

/** Company-wide overtime rule. Individual employees can be given their own rule in Payroll > Salaries. */
export function OvertimeCard({ canEdit }: { canEdit: boolean }) {
  const { org, refresh, isAdmin } = useAuth();
  const [r, setR] = useState<Ot>({
    ot_enabled: org!.ot_enabled,
    ot_mode: org!.ot_mode,
    ot_multiplier: Number(org!.ot_multiplier),
    ot_fixed_rate: Number(org!.ot_fixed_rate),
    ot_min_minutes: org!.ot_min_minutes,
    ot_round_minutes: org!.ot_round_minutes,
    ot_max_minutes: org!.ot_max_minutes,
    ot_requires_approval: org!.ot_requires_approval,
    ot_off_days: org!.ot_off_days,
  });
  // The rate can be picked as 1x / 1.5x / 2x, or typed as a percentage of the normal hourly rate.
  const [custom, setCustom] = useState(!MULTIPLIERS.includes(Number(org!.ot_multiplier)));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const change = (patch: Partial<Ot>) => {
    setSaved(false);
    setR((v) => ({ ...v, ...patch }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (r.ot_enabled && r.ot_mode === "fixed" && !(r.ot_fixed_rate > 0)) return setError("Enter the fixed overtime amount per hour.");
    setBusy(true);
    setError("");
    const { error } = await supabase.from("organizations").update(r).eq("id", org!.id);
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    await refresh();
  };

  const fullDay = Number(org!.full_day_hours);

  return (
    <Card className="mb-5 p-4">
      <h2 className="text-sm font-semibold">Overtime</h2>
      <form onSubmit={save} className="mt-3 space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={r.ot_enabled} disabled={!canEdit} onChange={(e) => change({ ot_enabled: e.target.checked })} />
          <span>Pay overtime for hours worked beyond a full day ({fullDay} hours)</span>
        </label>

        {r.ot_enabled && (
          <>
            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-xs font-medium text-slate-600">How overtime is paid, for everyone by default</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="ot_mode" checked={r.ot_mode === "multiplier"} disabled={!canEdit} onChange={() => change({ ot_mode: "multiplier" })} />
                A multiple of the employee's normal hourly rate
              </label>
              {r.ot_mode === "multiplier" && (
                <div className="grid gap-3 pl-6 sm:grid-cols-2">
                  <Select label="Rate" disabled={!canEdit} value={custom ? "custom" : String(r.ot_multiplier)} onChange={(e) => { if (e.target.value === "custom") setCustom(true); else { setCustom(false); change({ ot_multiplier: Number(e.target.value) }); } }}>
                    {MULTIPLIERS.map((m) => (
                      <option key={m} value={m}>{m}× ({m * 100}% of the normal rate)</option>
                    ))}
                    <option value="custom">Other percentage…</option>
                  </Select>
                  {custom && (
                    <Input label="Percentage of normal rate" type="number" min={50} max={500} step="5" required disabled={!canEdit} value={Math.round(r.ot_multiplier * 100)} onChange={(e) => change({ ot_multiplier: Number(e.target.value) / 100 })} hint="150 means one and a half times." />
                  )}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="ot_mode" checked={r.ot_mode === "fixed"} disabled={!canEdit} onChange={() => change({ ot_mode: "fixed" })} />
                A fixed amount per overtime hour, the same for everyone
              </label>
              {r.ot_mode === "fixed" && (
                <div className="pl-6 sm:w-1/2">
                  <Input label="Amount per hour ₹" type="number" min={0} step="1" required disabled={!canEdit} value={r.ot_fixed_rate} onChange={(e) => change({ ot_fixed_rate: Number(e.target.value) })} />
                </div>
              )}
              <p className="text-xs text-slate-500">Normal hourly rate = monthly salary ÷ pay days in the month ÷ {fullDay} hours. To give one employee a different rate, or no overtime, use the list at the bottom of this card.</p>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Counts only from (minutes)" type="number" min={0} max={240} required disabled={!canEdit} hint="Extra time shorter than this is ignored." value={r.ot_min_minutes} onChange={(e) => change({ ot_min_minutes: Number(e.target.value) })} />
              <Select label="Round overtime down to" disabled={!canEdit} value={r.ot_round_minutes} onChange={(e) => change({ ot_round_minutes: Number(e.target.value) })}>
                <option value={1}>Exact minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </Select>
              <Input label="Most overtime in a day (hours)" type="number" min={0.5} max={16} step="0.5" required disabled={!canEdit} value={r.ot_max_minutes / 60} onChange={(e) => change({ ot_max_minutes: Math.round(Number(e.target.value) * 60) })} />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={r.ot_requires_approval} disabled={!canEdit} onChange={(e) => change({ ot_requires_approval: e.target.checked })} />
              <span>A manager must approve overtime before it is paid (recommended, so staying checked in does not earn pay automatically)</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={r.ot_off_days} disabled={!canEdit} onChange={(e) => change({ ot_off_days: e.target.checked })} />
              <span>On a weekly off or holiday, count every worked hour as overtime</span>
            </label>
          </>
        )}

        <ErrorText>{error}</ErrorText>
        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" loading={busy}>Save overtime rules</Button>
            {saved && <span className="text-sm text-emerald-600">Saved</span>}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Only the owner or an admin can change these rules.</p>
        )}
        <p className="text-xs text-slate-500">Overtime is worked out at check-out, so changes apply to days from now on.</p>
      </form>

      {isAdmin && (
        <div className="mt-5">
          {r.ot_enabled ? (
            <>
              {!org!.ot_enabled && (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">Overtime is not switched on yet. Click "Save overtime rules" above to turn it on.</p>
              )}
              <EmployeeOvertimeRates />
            </>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Tick the box at the top to pay overtime. A list of employees then appears here, where each one can be given their own rate (for example one at 2× and another at 1.5×) or no overtime.</p>
          )}
        </div>
      )}
    </Card>
  );
}
