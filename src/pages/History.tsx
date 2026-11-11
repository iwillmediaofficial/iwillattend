import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Attendance } from "../lib/types";
import { Card, Empty, PageHeader, Spinner } from "../components/ui";
import { SelfieThumb } from "../components/SelfieThumb";
import { addDays, fmtDate, fmtHours, fmtTime, hoursBetween, todayIn } from "../lib/utils";

export function History() {
  const { employee, org } = useAuth();
  const tz = org!.timezone;
  const [rows, setRows] = useState<Attendance[] | null>(null);

  useEffect(() => {
    supabase
      .from("attendance")
      .select("*")
      .eq("employee_id", employee!.id)
      .gte("work_date", addDays(todayIn(tz), -60))
      .order("work_date", { ascending: false })
      .then(({ data }) => setRows((data as Attendance[]) ?? []));
  }, [employee, tz]);

  return (
    <>
      <PageHeader title="My attendance" subtitle="Last 60 days" />
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No attendance recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <SelfieThumb path={r.check_in_selfie_path} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{fmtDate(r.work_date)}</p>
                  <p className="text-xs text-slate-500">
                    {fmtTime(r.check_in_at, tz)} → {fmtTime(r.check_out_at, tz)}
                  </p>
                </div>
                <span className="text-sm font-medium text-slate-700">{fmtHours(hoursBetween(r.check_in_at, r.check_out_at))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
