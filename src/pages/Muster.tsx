import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Holiday, LeaveRequest } from "../lib/types";
import { Button, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { COUNT_CODES, DAY_CODES, buildMuster, monthDates, type MusterAttendance, type MusterEmployee } from "../lib/muster";
import { downloadCsv, fetchAll, todayIn } from "../lib/utils";

interface Data {
  employees: MusterEmployee[];
  attendance: MusterAttendance[];
  leaves: LeaveRequest[];
  holidays: Holiday[];
}

const cls = Object.fromEntries(DAY_CODES.map((c) => [c.code, c.cls]));
const COLS = COUNT_CODES;

export function Muster() {
  const { org } = useAuth();
  const today = todayIn(org!.timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<Data | null>(null);

  const dates = useMemo(() => monthDates(month), [month]);

  useEffect(() => {
    let alive = true;
    setData(null);
    const first = dates[0];
    const last = dates[dates.length - 1];
    Promise.all([
      // Active staff, plus anyone whose last working day falls in or after this month.
      supabase.from("employees").select("id, full_name, emp_code, joined_on, exit_on").or(`is_active.eq.true,exit_on.gte.${first}`).lte("joined_on", last).order("full_name"),
      fetchAll<MusterAttendance>(() => supabase.from("attendance").select("employee_id, work_date, status, check_out_at").gte("work_date", first).lte("work_date", last).order("id")),
      supabase.from("leave_requests").select("*, leave_type:leave_types(name, is_paid)").eq("status", "approved").lte("from_date", last).gte("to_date", first),
      supabase.from("holidays").select("*").gte("holiday_date", first).lte("holiday_date", last),
    ]).then(([e, a, l, h]) => {
      if (!alive) return;
      setData({
        employees: (e.data as Data["employees"]) ?? [],
        attendance: a,
        leaves: (l.data as unknown as LeaveRequest[]) ?? [],
        holidays: (h.data as Holiday[]) ?? [],
      });
    });
    return () => {
      alive = false;
    };
  }, [dates]);

  const rows = useMemo(
    () => (data ? buildMuster(month, today, org!, data.employees, data.attendance, data.leaves, data.holidays) : []),
    [data, month, today, org],
  );

  const exportCsv = () =>
    downloadCsv(`attendance_sheet_${month}.csv`, [
      ["Employee", "Code", ...dates.map((d) => d.slice(8)), ...COLS, "Unpaid off days", "Payable days"],
      ...rows.map((r) => [r.employee.full_name, r.employee.emp_code, ...r.days, ...COLS.map((c) => r.counts[c]), r.unpaidOff, r.payable]),
    ]);

  return (
    <>
      <PageHeader
        title="Monthly sheet"
        subtitle="Day-by-day status for every employee"
        action={
          <div className="flex items-center gap-2">
            <input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {DAY_CODES.map((c) => (
          <span key={c.code} className={`rounded px-2 py-0.5 font-medium ${c.cls}`}>{c.code} = {c.label}</span>
        ))}
      </div>

      <Card>
        {!data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No active employees.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-36 bg-slate-50 px-3 py-2 text-left font-medium">Employee</th>
                  {dates.map((d) => (
                    <th key={d} className="w-8 min-w-8 px-0.5 py-2 text-center font-medium">{Number(d.slice(8))}</th>
                  ))}
                  {COLS.map((c) => (
                    <th key={c} className="px-2 py-2 text-center font-medium">{c}</th>
                  ))}
                  <th className="px-2 py-2 text-center font-medium" title="Weekly offs and holidays not paid under the sandwich rule">Unpaid off</th>
                  <th className="px-3 py-2 text-center font-medium">Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.employee.id}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-800">{r.employee.full_name}</td>
                    {r.days.map((code, i) => (
                      <td key={i} className="px-0.5 py-1 text-center">
                        {code && <span className={`block rounded py-0.5 text-[10px] font-semibold ${cls[code] ?? "text-slate-300"}`}>{code}</span>}
                      </td>
                    ))}
                    {COLS.map((c) => (
                      <td key={c} className="px-2 py-1.5 text-center text-slate-700">{r.counts[c] || ""}</td>
                    ))}
                    <td className="px-2 py-1.5 text-center text-slate-700">{r.unpaidOff || ""}</td>
                    <td className="px-3 py-1.5 text-center font-semibold">{r.payable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-slate-500">
        Payable days = present + late + paid leave + weekly offs + holidays, with a half day counted as 0.5. A missing check-out is paid as set in Settings. {org!.sandwich_rule ? "Off days between unpaid absences are not paid (sandwich rule). " : ""}A dash means the day is before joining or after the last working day. Today stays blank until someone checks in.
      </p>
    </>
  );
}
