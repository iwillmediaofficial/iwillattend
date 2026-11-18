import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { EmployeeLite, SiteAssignment } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { addDays, errMsg, fetchAll, fmtDate, fmtTime, todayIn } from "../lib/utils";

interface Punch {
  site_assignment_id: string;
  work_date: string;
  check_in_at: string;
}

/** Managers allot site work here. On an allotted day the employee can check in from anywhere. */
export function SiteWork() {
  const { org } = useAuth();
  const tz = org!.timezone;
  const today = todayIn(tz);
  const [rows, setRows] = useState<SiteAssignment[] | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [staff, setStaff] = useState<EmployeeLite[]>([]);
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState("");
  const [details, setDetails] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const since = addDays(today, -30);
    const [list, used] = await Promise.all([
      fetchAll<SiteAssignment>(() =>
        supabase
          .from("site_assignments")
          .select("*, employee:employees!employee_id(id, full_name, emp_code, staff_type)")
          .gte("to_date", since)
          .order("from_date", { ascending: false })
          .order("id"),
      ),
      fetchAll<Punch>(() =>
        supabase
          .from("attendance")
          .select("site_assignment_id, work_date, check_in_at")
          .not("site_assignment_id", "is", null)
          .gte("work_date", addDays(since, -93))
          .order("work_date")
          .order("id"),
      ),
    ]);
    setPunches(used);
    setRows(list);
  }, [today]);

  useEffect(() => {
    void load();
    supabase.from("employees").select("id, full_name, emp_code, staff_type").eq("is_active", true).not("role", "in", "(owner,admin)").order("full_name")
      .then(({ data }) => setStaff((data as EmployeeLite[]) ?? []));
  }, [load]);

  const usage = useMemo(() => {
    const m = new Map<string, { days: number; todayAt: string | null }>();
    for (const p of punches) {
      const u = m.get(p.site_assignment_id) ?? { days: 0, todayAt: null };
      u.days += 1;
      if (p.work_date === today) u.todayAt = p.check_in_at;
      m.set(p.site_assignment_id, u);
    }
    return m;
  }, [punches, today]);

  const shown = staff.filter((e) => e.full_name.toLowerCase().includes(search.trim().toLowerCase()));
  const allShownPicked = shown.length > 0 && shown.every((e) => picked.has(e.id));

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () =>
    setPicked((s) => {
      const n = new Set(s);
      for (const e of shown) {
        if (allShownPicked) n.delete(e.id);
        else n.add(e.id);
      }
      return n;
    });

  const start = () => {
    setError("");
    setSite("");
    setDetails("");
    setFrom(today);
    setTo(today);
    setPicked(new Set());
    setSearch("");
    setOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (picked.size === 0) return setError("Choose at least one employee.");
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("assign_site_work", {
      p_employees: [...picked], p_from: from, p_to: to, p_site: site, p_details: details,
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setOpen(false);
    await load();
  };

  const end = async (r: SiteAssignment) => {
    const used = usage.get(r.id)?.days ?? 0;
    const msg = used
      ? `End this site work for ${r.employee?.full_name ?? "this employee"}? Days already worked on site stay as they are. From the next check-in the office location rule applies again.`
      : `Cancel this site work for ${r.employee?.full_name ?? "this employee"}?`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.rpc("end_site_work", { p_id: r.id });
    if (error) window.alert(error.message);
    await load();
  };

  const state = (r: SiteAssignment) =>
    r.status === "cancelled" ? <Badge>Cancelled</Badge>
    : r.to_date < today ? <Badge>Completed</Badge>
    : r.from_date > today ? <Badge tone="amber">Upcoming</Badge>
    : <Badge tone="green">Active today</Badge>;

  return (
    <>
      <PageHeader
        title="Site work"
        subtitle="Send staff to an outside site. On those days they can check in from anywhere, without the office location rule."
        action={
          <Button onClick={start}>
            <Plus className="h-4 w-4" /> Allot site work
          </Button>
        }
      />

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No site work allotted yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const u = usage.get(r.id);
              const live = r.status === "active" && r.from_date <= today && r.to_date >= today;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {r.employee?.full_name ?? "Employee"} <span className="font-normal text-slate-500">· {r.site_name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` to ${fmtDate(r.to_date)}` : ""}
                      {u ? ` · ${u.days} day${u.days === 1 ? "" : "s"} checked in on site` : ""}
                    </p>
                    {r.details && <p className="mt-0.5 text-xs text-slate-500">{r.details}</p>}
                  </div>
                  {live && (u?.todayAt ? <Badge tone="indigo">In at {fmtTime(u.todayAt, tz)}</Badge> : <Badge tone="amber">Not checked in yet</Badge>)}
                  {state(r)}
                  {r.status === "active" && r.to_date >= today && (
                    <Button variant="ghost" onClick={() => end(r)}>{u ? "End" : "Cancel"}</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {open && (
        <Modal title="Allot site work" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            <Input label="Site or client name" required minLength={2} maxLength={120} value={site} onChange={(e) => setSite(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="From" type="date" required min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
              <Input label="To" type="date" required min={from} max={addDays(from, 92)} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Field label="Work details (optional)" hint="Address, contact person or what has to be done. The employee sees this.">
              <textarea value={details} maxLength={500} rows={2} onChange={(e) => setDetails(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </Field>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Employees ({picked.size} chosen)</span>
                <button type="button" onClick={toggleAll} className="text-xs font-medium text-brand-600 hover:underline">
                  {allShownPicked ? "Clear all" : "Select all"}
                </button>
              </div>
              <input
                type="search"
                placeholder="Search by name"
                aria-label="Search employees"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No employees found.</li>}
                {shown.map((e) => (
                  <li key={e.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} className="h-4 w-4 accent-brand-600" />
                      <span className="min-w-0 flex-1 truncate">{e.full_name}</span>
                      <span className="text-xs capitalize text-slate-500">{e.staff_type}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-slate-500">They still check in and out with a selfie, and the location is recorded. Only the office location rule is lifted.</p>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Allot site work</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
