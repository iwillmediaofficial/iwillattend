import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { AttendanceWithEmployee, EmployeeLite } from "../lib/types";
import { Button, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { SelfieThumb } from "../components/SelfieThumb";
import { AttendanceStatus, FaceBadge } from "../components/badges";
import { downloadCsv, fetchAll, fmtDate, fmtDistance, fmtHours, fmtTime, hoursBetween, todayIn } from "../lib/utils";

const faceText = (m: boolean | null, required: boolean) => (m === true ? "Matched" : m === false ? "MISMATCH" : required ? "NOT CHECKED" : "");

const inputCls = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function Reports() {
  const { org } = useAuth();
  const tz = org!.timezone;
  const today = todayIn(tz);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [empId, setEmpId] = useState("");
  const [markedOnly, setMarkedOnly] = useState(false);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [rows, setRows] = useState<AttendanceWithEmployee[] | null>(null);

  useEffect(() => {
    supabase
      .from("employees")
      .select("id, full_name, emp_code, staff_type")
      .not("role", "in", "(owner,admin)")
      .order("full_name")
      .then(({ data }) => setEmployees((data as EmployeeLite[]) ?? []));
  }, []);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetchAll<AttendanceWithEmployee>(() => {
      const q = supabase
        .from("attendance")
        .select("*, employee:employees!employee_id(id, full_name, emp_code, staff_type)")
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: false })
        .order("check_in_at")
        .order("id");
      const q2 = markedOnly ? q.or("check_in_by.not.is.null,check_out_by.not.is.null") : q;
      return (empId ? q2.eq("employee_id", empId) : q2) as never;
    })
      .then((data) => alive && setRows(data))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [from, to, empId, markedOnly]);

  const summary = useMemo(() => {
    const m = new Map<string, { name: string; code: string; days: number; hours: number; open: number }>();
    for (const r of rows ?? []) {
      const s = m.get(r.employee_id) ?? { name: r.employee?.full_name ?? "—", code: r.employee?.emp_code ?? "", days: 0, hours: 0, open: 0 };
      s.days += 1;
      const h = hoursBetween(r.check_in_at, r.check_out_at);
      if (h == null) s.open += 1;
      else s.hours += h;
      m.set(r.employee_id, s);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv(`attendance_${from}_to_${to}.csv`, [
      ["Date", "Employee", "Code", "Staff type", "Status", "Day value", "Late minutes", "Corrected", "Face at check-in", "Face at check-out", "Failed face attempts", "Check in", "Check out", "Hours", "In geofence", "Distance from branch (m)", "Check-in latitude", "Check-in longitude", "Checked in by", "Checked out by"],
      ...rows.map((r) => {
        const h = hoursBetween(r.check_in_at, r.check_out_at);
        return [
          r.work_date,
          r.employee?.full_name,
          r.employee?.emp_code,
          r.employee?.staff_type,
          r.status === "half_day" ? "Half day" : r.status === "short" ? "Short hours" : r.status === "late" ? "Late" : "Present",
          r.day_value,
          r.late_minutes,
          r.is_corrected ? "Yes" : "No",
          faceText(r.check_in_face_match, r.face_required),
          r.check_out_at ? faceText(r.check_out_face_match, r.face_required) : "",
          r.check_in_face_fails + r.check_out_face_fails,
          fmtTime(r.check_in_at, tz),
          r.check_out_at ? fmtTime(r.check_out_at, tz) : "",
          h == null ? "" : h.toFixed(2),
          r.check_in_in_geofence == null ? "" : r.check_in_in_geofence ? "Yes" : "No",
          r.check_in_distance_m == null ? "" : Math.round(r.check_in_distance_m),
          r.check_in_lat,
          r.check_in_lng,
          r.check_in_by_name ?? "",
          r.check_out_by_name ?? "",
        ];
      }),
    ]);
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Attendance records for a date range"
        action={
          <Button variant="outline" onClick={exportCsv} disabled={!rows?.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          From
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="text-xs text-slate-500">
          Employee
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} className={`mt-1 block ${inputCls}`}>
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={markedOnly} onChange={(e) => setMarkedOnly(e.target.checked)} /> Only punches made by a manager
        </label>
      </div>

      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <Empty>No attendance in this range.</Empty>
        </Card>
      ) : (
        <>
          <Card className="mb-5">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Summary by employee</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Employee</th>
                    <th className="px-4 py-2 font-medium">Days present</th>
                    <th className="px-4 py-2 font-medium">Total hours</th>
                    <th className="px-4 py-2 font-medium">Missing check-outs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s) => (
                    <tr key={s.name + s.code}>
                      <td className="px-4 py-2 font-medium">{s.name}</td>
                      <td className="px-4 py-2">{s.days}</td>
                      <td className="px-4 py-2">{fmtHours(s.hours)}</td>
                      <td className="px-4 py-2">{s.open}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Daily records ({rows.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Employee</th>
                    <th className="px-4 py-2 font-medium">In</th>
                    <th className="px-4 py-2 font-medium">Out</th>
                    <th className="px-4 py-2 font-medium">Hours</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">From branch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-4 py-2">{fmtDate(r.work_date)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <SelfieThumb path={r.check_in_selfie_path} size={28} />
                          {r.employee?.full_name}
                        </div>
                      </td>
                      <td className="px-4 py-2">{fmtTime(r.check_in_at, tz)}</td>
                      <td className="px-4 py-2">{fmtTime(r.check_out_at, tz)}</td>
                      <td className="px-4 py-2">{fmtHours(hoursBetween(r.check_in_at, r.check_out_at))}</td>
                      <td className="px-4 py-2"><span className="inline-flex flex-wrap gap-1"><AttendanceStatus row={r} />{r.check_in_face_match === false || r.check_out_face_match === false ? <FaceBadge match={false} /> : r.face_required && (r.check_in_face_match == null || (r.check_out_at && r.check_out_face_match == null)) ? <FaceBadge match={null} required /> : null}</span></td>
                      <td className="px-4 py-2">{fmtDistance(r.check_in_distance_m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
