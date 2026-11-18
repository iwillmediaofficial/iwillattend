import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LogIn, LogOut, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Attendance } from "../lib/types";
import { Badge, Button, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { CaptureFlow, type Capture } from "../components/CaptureFlow";
import { fetchAll, fmtTime, todayIn, uploadSelfie } from "../lib/utils";

interface Person {
  id: string;
  full_name: string;
  emp_code: string | null;
  staff_type: "office" | "field";
  face_enrolled_at: string | null;
}

type Row = Pick<Attendance, "id" | "employee_id" | "work_date" | "check_in_at" | "check_out_at" | "missing_checkout" | "check_in_by_name" | "check_out_by_name">;

type State = { kind: "out" } | { kind: "in"; row: Row } | { kind: "done"; row: Row };

const FILTERS = [
  { id: "", label: "All" },
  { id: "out", label: "Not checked in" },
  { id: "in", label: "Checked in" },
] as const;

/** Owner, Admin, HR and Manager check staff in and out with the staff member's live selfie. */
export function StaffCheckin() {
  const { org, employee } = useAuth();
  const tz = org!.timezone;
  const today = todayIn(tz);
  const enabled = org!.staff_checkin_enabled;
  const [params, setParams] = useSearchParams();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [onLeave, setOnLeave] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"" | "out" | "in">("");
  const [active, setActive] = useState<{ person: Person; mode: "in" | "out" } | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 18 * 3_600_000).toISOString();
    const [p, a, l] = await Promise.all([
      supabase.from("employees").select("id, full_name, emp_code, staff_type, face_enrolled_at")
        .eq("is_active", true).not("role", "in", "(owner,admin)").neq("id", employee!.id).order("full_name"),
      fetchAll<Row>(() =>
        supabase.from("attendance")
          .select("id, employee_id, work_date, check_in_at, check_out_at, missing_checkout, check_in_by_name, check_out_by_name")
          .or(`work_date.eq.${today},and(check_out_at.is.null,check_in_at.gt.${since})`)
          .order("check_in_at")
          .order("id"),
      ),
      supabase.from("leave_requests").select("employee_id").eq("status", "approved").eq("half_day", false).lte("from_date", today).gte("to_date", today),
    ]);
    setRows(a);
    setOnLeave(new Set(((l.data as { employee_id: string }[]) ?? []).map((x) => x.employee_id)));
    setPeople((p.data as Person[]) ?? []);
  }, [employee, today]);

  useEffect(() => {
    void load();
  }, [load]);

  // Status of each person: an open check-in (today's, or a recent one from yesterday), or today's finished day.
  const stateOf = useMemo(() => {
    const m = new Map<string, State>();
    const recent = Date.now() - 18 * 3_600_000;
    for (const r of rows) {
      const open = !r.check_out_at && !r.missing_checkout && Date.parse(r.check_in_at) > recent;
      if (open) m.set(r.employee_id, { kind: "in", row: r });
      else if (r.work_date === today && m.get(r.employee_id)?.kind !== "in") m.set(r.employee_id, { kind: "done", row: r });
    }
    return (id: string): State => m.get(id) ?? { kind: "out" };
  }, [rows, today]);

  // Opened from the Dashboard with ?emp=<id>: go straight to the camera.
  useEffect(() => {
    const id = params.get("emp");
    if (!id || !people || !enabled) return;
    const person = people.find((x) => x.id === id);
    const s = person ? stateOf(person.id) : null;
    if (person && s && s.kind !== "done") setActive({ person, mode: s.kind === "in" ? "out" : "in" });
    setParams({}, { replace: true });
  }, [params, people, enabled, stateOf, setParams]);

  const submit = async (c: Capture) => {
    const { person, mode } = active!;
    const path = await uploadSelfie(org!.id, person.id, mode, c.blob);
    const { data, error } = await supabase.rpc(mode === "in" ? "check_in_for" : "check_out_for", {
      p_employee: person.id, p_lat: c.lat, p_lng: c.lng, p_accuracy: c.accuracy, p_selfie_path: path,
    });
    if (error) throw error;
    const saved = data as Attendance;
    let face = "";
    let ok = true;
    if (c.descriptor) {
      const { data: matched, error: faceError } = await supabase.rpc("record_face_for", { p_employee: person.id, p_kind: mode, p_id: saved.id, p_descriptor: c.descriptor });
      face = faceError ? " · Face not checked" : matched ? " · Face matched" : " · Face did not match (flagged)";
      ok = !faceError && matched === true;
    }
    setResult({ text: `${person.full_name} ${mode === "in" ? "checked in" : "checked out"} at ${fmtTime(mode === "in" ? saved.check_in_at : saved.check_out_at, tz)}${face}`, ok });
    setActive(null);
    await load();
  };

  const needle = q.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => {
    if (needle && !p.full_name.toLowerCase().includes(needle) && !(p.emp_code ?? "").toLowerCase().includes(needle)) return false;
    const k = stateOf(p.id).kind;
    return !filter || (filter === "out" ? k === "out" : k === "in");
  });
  const counts = (people ?? []).reduce((acc, p) => ({ ...acc, [stateOf(p.id).kind]: (acc[stateOf(p.id).kind] ?? 0) + 1 }), {} as Record<string, number>);

  if (!enabled) {
    return (
      <>
        <PageHeader title="Check in staff" />
        <Card><Empty>Checking in staff is switched off for this company. The owner or an admin can turn it on in Settings.</Empty></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Check in staff"
        subtitle="For staff without a working phone, or a crew at a site. A live photo of the person is needed, and each punch shows that you made it."
      />

      {result && (
        <p role="status" className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${result.ok ? "bg-success-50 text-success-700" : "bg-amber-50 text-amber-800"}`}>{result.text}</p>
      )}

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-1" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === f.id ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`}>
                {f.label}{f.id === "out" && counts.out ? ` (${counts.out})` : f.id === "in" && counts.in ? ` (${counts.in})` : ""}
              </button>
            ))}
          </div>
          <label className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" aria-label="Search staff" placeholder="Search by name or code" value={q} onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
          </label>
        </div>
      </Card>

      <Card>
        {!people ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <Empty>{people.length === 0 ? "No staff to check in yet." : "Nobody matches."}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((p) => {
              const s = stateOf(p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{p.full_name[0]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.full_name}</p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                      <span className="capitalize">{p.staff_type} staff</span>
                      {s.kind === "in" && <Badge tone="green">In since {fmtTime(s.row.check_in_at, tz)}{s.row.work_date !== today ? " (yesterday)" : ""}</Badge>}
                      {s.kind === "done" && <Badge>Day complete</Badge>}
                      {s.kind === "out" && onLeave.has(p.id) && <Badge tone="amber">On leave today</Badge>}
                      {s.kind !== "out" && s.row.check_in_by_name && <Badge tone="amber">In by {s.row.check_in_by_name}</Badge>}
                    </p>
                  </div>
                  {s.kind === "out" && (
                    <Button variant="success" onClick={() => { setResult(null); setActive({ person: p, mode: "in" }); }}>
                      <LogIn className="h-4 w-4" /> Check in
                    </Button>
                  )}
                  {s.kind === "in" && (
                    <Button variant="danger" onClick={() => { setResult(null); setActive({ person: p, mode: "out" }); }}>
                      <LogOut className="h-4 w-4" /> Check out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Checking someone in on leave cancels that day of their leave, the same as when they check in themselves.
      </p>

      {active && (
        <CaptureFlow
          title={`${active.mode === "in" ? "Check in" : "Check out"} ${active.person.full_name}`}
          confirmLabel={active.mode === "in" ? "Confirm check-in" : "Confirm check-out"}
          onClose={() => setActive(null)}
          onConfirm={submit}
          face={org!.face_check_enabled && !!active.person.face_enrolled_at}
          subject={{ id: active.person.id, name: active.person.full_name }}
        />
      )}
    </>
  );
}
