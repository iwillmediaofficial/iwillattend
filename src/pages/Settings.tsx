import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Holiday, LeaveType, Shift } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorText, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { fmtDate, todayIn } from "../lib/utils";
import { DayRulesCard } from "../components/DayRulesCard";
import { OvertimeCard } from "../components/OvertimeCard";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (t: string) => t.slice(0, 5);

interface ShiftForm { id?: string; name: string; start_time: string; end_time: string; grace_minutes: string; half_day_under_hours: string; is_default: boolean; is_active: boolean }
interface LeaveForm { id?: string; name: string; annual_quota: string; is_paid: boolean; is_active: boolean }

export function Settings() {
  const { org, employee, sub, refresh } = useAuth();
  const canEditOrg = employee!.role === "owner" || employee!.role === "admin";
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [shiftForm, setShiftForm] = useState<ShiftForm | null>(null);
  const [leaveForm, setLeaveForm] = useState<LeaveForm | null>(null);
  const [hDate, setHDate] = useState("");
  const [hName, setHName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [company, setCompany] = useState({ name: org!.name, phone: org!.phone ?? "", address: org!.address ?? "", city: org!.city ?? "", state: org!.state ?? "", gstin: org!.gstin ?? "" });
  const [companySaved, setCompanySaved] = useState(false);

  const year = todayIn(org!.timezone).slice(0, 4);

  const load = useCallback(async () => {
    const [s, h, t] = await Promise.all([
      supabase.from("shifts").select("*").order("name"),
      supabase.from("holidays").select("*").gte("holiday_date", `${year}-01-01`).order("holiday_date"),
      supabase.from("leave_types").select("*").order("name"),
    ]);
    setShifts((s.data as Shift[]) ?? []);
    setHolidays((h.data as Holiday[]) ?? []);
    setTypes((t.data as LeaveType[]) ?? []);
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSaturday = (n: number) => {
    const cur = org!.alt_saturday_offs ?? [];
    return setOrgRule({ alt_saturday_offs: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort() });
  };

  const saveCompany = async (e: FormEvent) => {
    e.preventDefault();
    const txt = (v: string) => v.trim() || null;
    await setOrgRule({ name: company.name.trim(), phone: txt(company.phone), address: txt(company.address), city: txt(company.city), state: txt(company.state), gstin: txt(company.gstin)?.toUpperCase() ?? null });
    setCompanySaved(true);
  };

  const toggleOff = async (d: number) => {
    setPageError("");
    const cur = org!.weekly_offs;
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    const { error } = await supabase.from("organizations").update({ weekly_offs: next }).eq("id", org!.id);
    if (error) setPageError(error.message);
    await refresh();
  };

  const setOrgRule = async (patch: Record<string, unknown>) => {
    setPageError("");
    const { error } = await supabase.from("organizations").update(patch).eq("id", org!.id);
    if (error) setPageError(error.message);
    await refresh();
  };

  const toggleFace = async () => {
    setPageError("");
    const { error } = await supabase.from("organizations").update({ face_check_enabled: !org!.face_check_enabled }).eq("id", org!.id);
    if (error) setPageError(error.message);
    await refresh();
  };

  const saveShift = async (e: FormEvent) => {
    e.preventDefault();
    if (!shiftForm) return;
    setBusy(true);
    setError("");
    const payload = {
      name: shiftForm.name.trim(),
      start_time: shiftForm.start_time,
      end_time: shiftForm.end_time,
      grace_minutes: Number(shiftForm.grace_minutes),
      half_day_under_hours: Number(shiftForm.half_day_under_hours),
      is_active: shiftForm.is_default ? true : shiftForm.is_active,
    };
    let id = shiftForm.id;
    let err = null;
    if (id) err = (await supabase.from("shifts").update(payload).eq("id", id)).error;
    else {
      const res = await supabase.from("shifts").insert({ ...payload, org_id: org!.id }).select("id").single();
      err = res.error;
      id = res.data?.id;
    }
    // Only one shift can be the default, so clear the old one before setting the new one.
    const wasDefault = shifts?.find((s) => s.id === id)?.is_default ?? false;
    if (!err && id && shiftForm.is_default && !wasDefault) {
      err = (await supabase.from("shifts").update({ is_default: false }).eq("org_id", org!.id).eq("is_default", true)).error;
      if (!err) err = (await supabase.from("shifts").update({ is_default: true }).eq("id", id)).error;
    }
    setBusy(false);
    if (err) return setError(err.message);
    setShiftForm(null);
    await load();
  };

  const saveLeave = async (e: FormEvent) => {
    e.preventDefault();
    if (!leaveForm) return;
    setBusy(true);
    setError("");
    const payload = { name: leaveForm.name.trim(), annual_quota: Number(leaveForm.annual_quota), is_paid: leaveForm.is_paid, is_active: leaveForm.is_active };
    const { error } = leaveForm.id
      ? await supabase.from("leave_types").update(payload).eq("id", leaveForm.id)
      : await supabase.from("leave_types").insert({ ...payload, org_id: org!.id });
    setBusy(false);
    if (error) return setError(error.code === "23505" ? "A leave type with this name already exists" : error.message);
    setLeaveForm(null);
    await load();
  };

  const addHoliday = async (e: FormEvent) => {
    e.preventDefault();
    setPageError("");
    const { error } = await supabase.from("holidays").insert({ org_id: org!.id, holiday_date: hDate, name: hName.trim() });
    if (error) return setPageError(error.code === "23505" ? "A holiday already exists on that date" : error.message);
    setHDate("");
    setHName("");
    await load();
  };

  const removeHoliday = async (h: Holiday) => {
    if (!window.confirm(`Remove the holiday "${h.name}" on ${fmtDate(h.holiday_date)}?`)) return;
    const { error } = await supabase.from("holidays").delete().eq("id", h.id);
    if (error) setPageError(error.message);
    await load();
  };

  if (!shifts) return <Spinner />;

  return (
    <>
      <PageHeader title="Settings" subtitle="Shifts, weekly offs, holidays and leave rules" />
      <ErrorText>{pageError}</ErrorText>

      {sub && (
        <Card className="mb-5 p-4">
          <h2 className="mb-2 text-sm font-semibold">Subscription</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{sub.plan_name} plan</span>
            {sub.state !== "ok" ? <Badge tone="red">{sub.state}</Badge> : sub.sub_status === "trial" && sub.plan_id !== "free" ? <Badge tone="indigo">Trial</Badge> : <Badge tone="green">Active</Badge>}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {sub.active_employees} of {sub.max_employees} active employees used · Payroll {sub.payroll ? "included" : "not included"} · Face recognition {sub.face ? "included" : "not included"}
            {sub.valid_until ? ` · Valid until ${fmtDate(sub.valid_until)}` : ""}
          </p>
          <Link to="/plans" className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline">View plans and request a change</Link>
        </Card>
      )}

      <Card className="mb-5 p-4">
        <h2 className="mb-3 text-sm font-semibold">Company details</h2>
        <form onSubmit={saveCompany} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Company name" required minLength={2} maxLength={120} disabled={!canEditOrg} value={company.name} onChange={(e) => { setCompanySaved(false); setCompany({ ...company, name: e.target.value }); }} />
            <Input label="Contact phone" type="tel" maxLength={30} disabled={!canEditOrg} value={company.phone} onChange={(e) => { setCompanySaved(false); setCompany({ ...company, phone: e.target.value }); }} />
            <Input label="City" maxLength={80} disabled={!canEditOrg} value={company.city} onChange={(e) => { setCompanySaved(false); setCompany({ ...company, city: e.target.value }); }} />
            <Input label="State" maxLength={80} disabled={!canEditOrg} value={company.state} onChange={(e) => { setCompanySaved(false); setCompany({ ...company, state: e.target.value }); }} />
            <Input label="Address" maxLength={300} disabled={!canEditOrg} value={company.address} onChange={(e) => { setCompanySaved(false); setCompany({ ...company, address: e.target.value }); }} />
            <Input label="GSTIN" maxLength={20} disabled={!canEditOrg} value={company.gstin} onChange={(e) => { setCompanySaved(false); setCompany({ ...company, gstin: e.target.value }); }} />
          </div>
          {canEditOrg && (
            <div className="flex items-center gap-3">
              <Button type="submit" variant="outline">Save details</Button>
              {companySaved && !pageError && <span className="text-sm text-emerald-600">Saved</span>}
            </div>
          )}
        </form>
      </Card>

      <Card className="mb-5">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Shifts</h2>
          <Button variant="outline" onClick={() => { setError(""); setShiftForm({ name: "", start_time: "09:30", end_time: "18:30", grace_minutes: "10", half_day_under_hours: "4", is_default: shifts.length === 0, is_active: true }); }}>
            <Plus className="h-4 w-4" /> Add shift
          </Button>
        </div>
        {shifts.length === 0 ? (
          <Empty>No shifts yet. Without a shift nobody is marked late.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shifts.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {s.name} {s.is_default && <Badge tone="indigo">Default</Badge>} {!s.is_active && <Badge tone="red">Inactive</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {hhmm(s.start_time)} to {hhmm(s.end_time)} · late after {s.grace_minutes} min
                  </p>
                </div>
                <Button variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => { setError(""); setShiftForm({ id: s.id, name: s.name, start_time: hhmm(s.start_time), end_time: hhmm(s.end_time), grace_minutes: String(s.grace_minutes), half_day_under_hours: String(Number(s.half_day_under_hours)), is_default: s.is_default, is_active: s.is_active }); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Employees without their own shift use the default shift.</p>
      </Card>

      <Card className="mb-5 p-4">
        <h2 className="mb-3 text-sm font-semibold">Weekly offs</h2>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const on = org!.weekly_offs.includes(i);
            return (
              <button key={d} disabled={!canEditOrg} onClick={() => toggleOff(i)} aria-pressed={on}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600"}`}>
                {d}
              </button>
            );
          })}
        </div>
        <p className="mb-2 mt-4 text-xs font-medium text-slate-700">Saturdays off (when Saturday is otherwise a working day)</p>
        <div className="flex flex-wrap gap-2">
          {["1st", "2nd", "3rd", "4th", "5th"].map((label, i) => {
            const on = (org!.alt_saturday_offs ?? []).includes(i + 1);
            return (
              <button key={label} disabled={!canEditOrg || org!.weekly_offs.includes(6)} onClick={() => toggleSaturday(i + 1)} aria-pressed={on}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600"}`}>
                {label} Sat
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">{canEditOrg ? "Highlighted days are not counted as absent or as leave. For 2nd and 4th Saturday off, select those two." : "Only the owner or an admin can change weekly offs."}</p>
      </Card>

      <DayRulesCard canEdit={canEditOrg} />
      <OvertimeCard canEdit={canEditOrg} />

      <Card className="mb-5 space-y-3 p-4">
        <h2 className="text-sm font-semibold">Attendance pay rules</h2>
        <Select label="A day with no check-out counts as" value={org!.missing_checkout_as} disabled={!canEditOrg} onChange={(e) => setOrgRule({ missing_checkout_as: e.target.value })} hint="Applies until the employee gets the day corrected. A check-in can be closed for 18 hours; after that it is a missed check-out.">
          <option value="half_day">Half day</option>
          <option value="full_day">Full day</option>
          <option value="absent">Absent (unpaid)</option>
        </Select>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={org!.sandwich_rule} disabled={!canEditOrg} onChange={(e) => setOrgRule({ sandwich_rule: e.target.checked })} />
          <span>Sandwich rule: do not pay a weekly off or holiday when the employee was absent on the working day before and after it, or had no paid working day in the month</span>
        </label>
        <Select label="Office check-in needs a location accurate to" value={String(org!.max_accuracy_m)} disabled={!canEditOrg} onChange={(e) => setOrgRule({ max_accuracy_m: Number(e.target.value) })} hint="A less accurate reading is refused for office staff and flagged for field staff. Phones are usually within 5 to 60 m; a desktop PC is often far worse.">
          {[30, 50, 100, 200, 500, 1000, 5000].map((m) => (
            <option key={m} value={m}>{m >= 1000 ? `${m / 1000} km` : `${m} m`} or better{m === 5000 ? " (effectively off)" : ""}</option>
          ))}
        </Select>
      </Card>

      <Card className="mb-5 p-4">
        <h2 className="mb-2 text-sm font-semibold">Face recognition</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={org!.face_check_enabled} disabled={!canEditOrg || (!!sub && !sub.face)} onChange={toggleFace} />
          <span>Compare every check-in, check-out and visit selfie with the registered face of the employee</span>
        </label>
        <p className="mt-2 text-xs text-slate-500">Employees register their face once, with consent. A mismatch does not block the punch; it is flagged on the dashboard and in reports. Reset a registered face from the Employees page.{sub && !sub.face ? " Face recognition is not included in your current plan." : ""}</p>
      </Card>

      <Card className="mb-5">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Holidays ({year} onwards)</h2>
        <form onSubmit={addHoliday} className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
          <div className="w-40"><Input label="Date" type="date" required value={hDate} onChange={(e) => setHDate(e.target.value)} /></div>
          <div className="min-w-40 flex-1"><Input label="Holiday name" required maxLength={120} value={hName} onChange={(e) => setHName(e.target.value)} /></div>
          <Button type="submit"><Plus className="h-4 w-4" /> Add</Button>
        </form>
        {holidays.length === 0 ? (
          <Empty>No holidays added.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span><span className="font-medium">{h.name}</span> <span className="text-slate-500">· {fmtDate(h.holiday_date)}</span></span>
                <Button variant="ghost" aria-label={`Remove ${h.name}`} onClick={() => removeHoliday(h)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Leave types</h2>
          <Button variant="outline" onClick={() => { setError(""); setLeaveForm({ name: "", annual_quota: "12", is_paid: true, is_active: true }); }}>
            <Plus className="h-4 w-4" /> Add leave type
          </Button>
        </div>
        <ul className="divide-y divide-slate-100">
          {types.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t.name} {t.is_paid ? <Badge tone="green">Paid</Badge> : <Badge>Unpaid</Badge>} {!t.is_active && <Badge tone="red">Inactive</Badge>}
                </p>
                <p className="text-xs text-slate-500">{t.is_paid ? `${Number(t.annual_quota)} days per calendar year` : "No limit; deducted from pay"}</p>
              </div>
              <Button variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => { setError(""); setLeaveForm({ id: t.id, name: t.name, annual_quota: String(Number(t.annual_quota)), is_paid: t.is_paid, is_active: t.is_active }); }}>
                <Pencil className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {shiftForm && (
        <Modal title={shiftForm.id ? "Edit shift" : "Add shift"} onClose={() => setShiftForm(null)}>
          <form onSubmit={saveShift} className="space-y-4">
            <Input label="Shift name" required maxLength={80} value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start time" type="time" required value={shiftForm.start_time} onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })} />
              <Input label="End time" type="time" required value={shiftForm.end_time} onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })} />
              <Input label="Grace (minutes)" type="number" min={0} max={180} required hint="Late only after this many minutes." value={shiftForm.grace_minutes} onChange={(e) => setShiftForm({ ...shiftForm, grace_minutes: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shiftForm.is_default} disabled={!!shiftForm.id && !!shifts.find((s) => s.id === shiftForm.id)?.is_default} onChange={(e) => setShiftForm({ ...shiftForm, is_default: e.target.checked })} /> Default shift for the company
            </label>
            {shiftForm.id && !shiftForm.is_default && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={shiftForm.is_active} onChange={(e) => setShiftForm({ ...shiftForm, is_active: e.target.checked })} /> Active
              </label>
            )}
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Save shift</Button>
          </form>
        </Modal>
      )}

      {leaveForm && (
        <Modal title={leaveForm.id ? "Edit leave type" : "Add leave type"} onClose={() => setLeaveForm(null)}>
          <form onSubmit={saveLeave} className="space-y-4">
            <Input label="Name" required maxLength={80} value={leaveForm.name} onChange={(e) => setLeaveForm({ ...leaveForm, name: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={leaveForm.is_paid} onChange={(e) => setLeaveForm({ ...leaveForm, is_paid: e.target.checked })} /> Paid leave
            </label>
            {leaveForm.is_paid && (
              <Input label="Days per calendar year" type="number" min={0} max={366} step="0.5" required value={leaveForm.annual_quota} onChange={(e) => setLeaveForm({ ...leaveForm, annual_quota: e.target.value })} />
            )}
            {leaveForm.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={leaveForm.is_active} onChange={(e) => setLeaveForm({ ...leaveForm, is_active: e.target.checked })} /> Active
              </label>
            )}
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Save leave type</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
