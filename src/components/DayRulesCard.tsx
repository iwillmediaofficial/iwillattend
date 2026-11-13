import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, ErrorText, Input, Select } from "./ui";
import { PRESETS, evaluateDay, presetOf, type DayRules, type PresetId } from "../lib/dayRule";
import { inr } from "../lib/payroll";

/** Company setting: how worked hours become a full day, half day or absence, with a live calculator. */
export function DayRulesCard({ canEdit }: { canEdit: boolean }) {
  const { org, refresh } = useAuth();
  const [r, setR] = useState<DayRules>({
    full_day_hours: Number(org!.full_day_hours),
    half_day_hours: Number(org!.half_day_hours),
    below_half_rule: org!.below_half_rule,
    between_rule: org!.between_rule,
    full_day_tolerance_min: Number(org!.full_day_tolerance_min),
  });
  const [hours, setHours] = useState("3");
  const [salary, setSalary] = useState("15000");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const preset = presetOf(r);
  const change = (patch: Partial<DayRules>) => {
    setSaved(false);
    setR((v) => ({ ...v, ...patch }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (r.half_day_hours > r.full_day_hours) return setError("Half-day hours cannot be more than full-day hours.");
    setBusy(true);
    setError("");
    const { error } = await supabase.from("organizations").update(r).eq("id", org!.id);
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    await refresh();
  };

  const worked = Math.max(0, Number(hours) || 0);
  const result = evaluateDay(Math.round(worked * 60), r);
  const dayRate = (Number(salary) || 0) / 30;

  return (
    <Card className="mb-5 p-4">
      <h2 className="text-sm font-semibold">Full day, half day and short hours</h2>
      <p className="mb-3 mt-1 text-xs text-slate-500">Choose how a day's worked hours are counted for pay. Pick a starting point, then adjust if needed.</p>

      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Rule preset">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => {
            const on = preset === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={on} disabled={!canEdit} onClick={() => change(PRESETS[id].knobs)}
                className={`rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                <p className="text-sm font-semibold">{PRESETS[id].name}</p>
                <p className="mt-1 text-xs text-slate-600">{PRESETS[id].summary}</p>
              </button>
            );
          })}
        </div>
        {preset === "custom" && <p className="text-xs font-medium text-indigo-700">Custom rules: the settings below do not match a preset.</p>}

        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Full day needs (hours)" type="number" min={1} max={24} step="0.25" required disabled={!canEdit} value={r.full_day_hours} onChange={(e) => change({ full_day_hours: Number(e.target.value) })} />
          <Input label="Half day needs (hours)" type="number" min={0} max={24} step="0.25" required disabled={!canEdit} value={r.half_day_hours} onChange={(e) => change({ half_day_hours: Number(e.target.value) })} />
          <Input label="Full-day tolerance (minutes)" type="number" min={0} max={120} required disabled={!canEdit} hint="This close to a full day still counts as full." value={r.full_day_tolerance_min} onChange={(e) => change({ full_day_tolerance_min: Number(e.target.value) })} />
          <Select label="Less than a half day" disabled={!canEdit} value={r.below_half_rule} onChange={(e) => change({ below_half_rule: e.target.value as DayRules["below_half_rule"] })}>
            <option value="absent">Not paid (counts as absent)</option>
            <option value="hours">Pay for the hours worked</option>
            <option value="half">Count as a half day</option>
          </Select>
          <Select label="Between half and full day" disabled={!canEdit} value={r.between_rule} onChange={(e) => change({ between_rule: e.target.value as DayRules["between_rule"] })}>
            <option value="half">Count as a half day</option>
            <option value="hours">Pay for the hours worked</option>
          </Select>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <p className="mb-3 text-sm font-semibold">What happens if…</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="An employee works (hours)" type="number" min={0} max={24} step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
            <Input label="Monthly salary ₹" type="number" min={0} step="100" value={salary} onChange={(e) => setSalary(e.target.value)} />
          </div>
          <p className="mt-3 text-sm" aria-live="polite">
            <b>{result.label}</b>
            {result.value > 0 && result.value < 1 && result.value !== 0.5 ? ` (${Math.round(result.value * 100)}% of a day)` : ""}. Pay for that day: <b>{inr(dayRate * result.value)}</b>
            <span className="text-slate-500"> of {inr(dayRate)} (salary ÷ 30, as an illustration)</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">The calculator uses the settings shown above, including changes you have not saved yet.</p>
        </div>

        <ErrorText>{error}</ErrorText>
        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" loading={busy}>Save rules</Button>
            {saved && <span className="text-sm text-emerald-600">Saved</span>}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Only the owner or an admin can change these rules.</p>
        )}
        <p className="text-xs text-slate-500">New rules apply to days checked out from now on. Days already recorded keep the result they were given.</p>
      </form>
    </Card>
  );
}
