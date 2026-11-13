import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { AttendanceWithEmployee, CorrectionRequest, LeaveRequest, WfhRequest } from "../lib/types";
import { Button, Card, Empty, ErrorText, PageHeader, Spinner } from "../components/ui";
import { RequestBadge } from "../components/badges";
import { addDays, errMsg, fmtDate, fmtTime, todayIn } from "../lib/utils";

const EMP = "employee:employees!employee_id(id, full_name, emp_code, staff_type)";

export function Approvals() {
  const { employee: me, org } = useAuth();
  const tz = org!.timezone;
  const [leaves, setLeaves] = useState<LeaveRequest[] | null>(null);
  const [corrs, setCorrs] = useState<CorrectionRequest[]>([]);
  const [wfhs, setWfhs] = useState<WfhRequest[]>([]);
  const [ots, setOts] = useState<AttendanceWithEmployee[]>([]);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const since = addDays(todayIn(tz), -45) + "T00:00:00Z";
    const [l, c] = await Promise.all([
      supabase.from("leave_requests").select(`*, leave_type:leave_types(name, is_paid), ${EMP}`).neq("status", "cancelled").gte("created_at", since).order("created_at", { ascending: false }),
      supabase.from("correction_requests").select(`*, ${EMP}`).neq("status", "cancelled").gte("created_at", since).order("created_at", { ascending: false }),
    ]);
    if (l.error || c.error) setError((l.error ?? c.error)!.message);
    setLeaves((l.data as unknown as LeaveRequest[]) ?? []);
    setCorrs((c.data as unknown as CorrectionRequest[]) ?? []);
    const w = await supabase.from("wfh_requests").select(`*, ${EMP}`).neq("status", "cancelled").gte("created_at", since).order("created_at", { ascending: false });
    setWfhs((w.data as unknown as WfhRequest[]) ?? []);
    const o = await supabase.from("attendance").select(`*, ${EMP}`).eq("ot_status", "pending").gte("work_date", since.slice(0, 10)).order("work_date", { ascending: false });
    setOts((o.data as unknown as AttendanceWithEmployee[]) ?? []);
  }, [tz]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (kind: "leave" | "correction" | "wfh", id: string, approve: boolean) => {
    let note = "";
    if (!approve) {
      const input = window.prompt("Reason for rejecting (optional):", "");
      if (input === null) return;
      note = input;
    }
    setBusyId(id);
    setError("");
    const { error } = await supabase.rpc(({ leave: "decide_leave", correction: "decide_correction", wfh: "decide_wfh" } as const)[kind], { p_id: id, p_approve: approve, p_note: note });
    if (error) setError(errMsg(error));
    setBusyId("");
    await load();
  };

  const decideOt = async (id: string, approve: boolean) => {
    setBusyId(id);
    setError("");
    const { error } = await supabase.rpc("decide_overtime", { p_id: id, p_approve: approve });
    if (error) setError(errMsg(error));
    setBusyId("");
    await load();
  };

  const revoke = async (id: string) => {
    const note = window.prompt("Revoke this approved leave? The days go back to the employee's balance.\n\nReason (optional):", "");
    if (note === null) return;
    setBusyId(id);
    setError("");
    const { error } = await supabase.rpc("revoke_leave", { p_id: id, p_note: note });
    if (error) setError(errMsg(error));
    setBusyId("");
    await load();
  };

  if (!leaves) return <Spinner />;

  const canDecide = (employeeId: string) => employeeId !== me!.id || me!.role === "owner";
  const actions = (kind: "leave" | "correction" | "wfh", r: { id: string; status: string; employee_id: string }) =>
    r.status !== "pending" ? (
      <RequestBadge status={r.status as LeaveRequest["status"]} />
    ) : canDecide(r.employee_id) ? (
      <div className="flex gap-2">
        <Button variant="success" loading={busyId === r.id} onClick={() => decide(kind, r.id, true)} aria-label="Approve"><Check className="h-4 w-4" /> Approve</Button>
        <Button variant="outline" disabled={busyId === r.id} onClick={() => decide(kind, r.id, false)} aria-label="Reject"><X className="h-4 w-4" /> Reject</Button>
      </div>
    ) : (
      <span className="text-xs text-slate-500">Needs another approver</span>
    );

  const pendingFirst = <T extends { status: string }>(xs: T[]) => [...xs.filter((x) => x.status === "pending"), ...xs.filter((x) => x.status !== "pending")];
  const pendingCount = leaves.filter((x) => x.status === "pending").length + corrs.filter((x) => x.status === "pending").length + wfhs.filter((x) => x.status === "pending").length + ots.length;

  return (
    <>
      <PageHeader title="Approvals" subtitle={`${pendingCount} pending · requests from the last 45 days`} />
      <ErrorText>{error}</ErrorText>

      <Card className="mb-5 mt-3">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Leave requests</h2>
        {leaves.length === 0 ? (
          <Empty>No leave requests.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pendingFirst(leaves).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{r.employee?.full_name} · {r.leave_type?.name}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` to ${fmtDate(r.to_date)}` : ""} · {Number(r.days)} day{Number(r.days) === 1 ? "" : "s"}{r.half_day ? " (half day)" : ""}
                  </p>
                  {r.reason && <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>}
                </div>
                {actions("leave", r)}
                {r.status === "approved" && canDecide(r.employee_id) && (
                  <Button variant="ghost" disabled={busyId === r.id} onClick={() => revoke(r.id)}>Revoke</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(org!.ot_enabled || ots.length > 0) && (
        <Card className="mb-5">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Overtime</h2>
          {ots.length === 0 ? (
            <Empty>No overtime waiting for approval.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ots.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-48 flex-1">
                    <p className="text-sm font-medium">{a.employee?.full_name} · {fmtDate(a.work_date)}</p>
                    <p className="text-xs text-slate-500">
                      {fmtTime(a.check_in_at, tz)} to {fmtTime(a.check_out_at, tz)} · worked {Math.floor((a.worked_minutes ?? 0) / 60)}h {String((a.worked_minutes ?? 0) % 60).padStart(2, "0")}m · overtime {Math.floor(a.ot_minutes / 60)}h {String(a.ot_minutes % 60).padStart(2, "0")}m
                    </p>
                  </div>
                  {canDecide(a.employee_id) ? (
                    <div className="flex gap-2">
                      <Button variant="success" loading={busyId === a.id} onClick={() => decideOt(a.id, true)}><Check className="h-4 w-4" /> Approve</Button>
                      <Button variant="outline" disabled={busyId === a.id} onClick={() => decideOt(a.id, false)}><X className="h-4 w-4" /> Reject</Button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Needs another approver</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="mb-5">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Work from home</h2>
        {wfhs.length === 0 ? (
          <Empty>No work-from-home requests.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pendingFirst(wfhs).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{r.employee?.full_name}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` to ${fmtDate(r.to_date)}` : ""}
                  </p>
                  {r.reason && <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>}
                </div>
                {actions("wfh", r)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Attendance corrections</h2>
        {corrs.length === 0 ? (
          <Empty>No correction requests.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pendingFirst(corrs).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{r.employee?.full_name} · {fmtDate(r.work_date)}</p>
                  <p className="text-xs text-slate-500">
                    {r.requested_check_in ? `Check-in ${fmtTime(r.requested_check_in, tz)}` : ""}
                    {r.requested_check_in && r.requested_check_out ? " · " : ""}
                    {r.requested_check_out ? `Check-out ${fmtTime(r.requested_check_out, tz)}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>
                </div>
                {actions("correction", r)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
