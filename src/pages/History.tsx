import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PencilLine } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Attendance, CorrectionRequest } from "../lib/types";
import { Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { AttendanceStatus, RequestBadge } from "../components/badges";
import { SelfieThumb } from "../components/SelfieThumb";
import { addDays, errMsg, fmtDate, fmtHours, fmtTime, hoursBetween, todayIn } from "../lib/utils";

export function History() {
  const { employee, org } = useAuth();
  const tz = org!.timezone;
  const today = todayIn(tz);
  const [rows, setRows] = useState<Attendance[] | null>(null);
  const [reqs, setReqs] = useState<CorrectionRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [tin, setTin] = useState("");
  const [tout, setTout] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const since = addDays(today, -60);
    const [a, c] = await Promise.all([
      supabase.from("attendance").select("*").eq("employee_id", employee!.id).gte("work_date", since).order("work_date", { ascending: false }),
      supabase.from("correction_requests").select("*").eq("employee_id", employee!.id).gte("work_date", since).order("created_at", { ascending: false }),
    ]);
    setRows((a.data as Attendance[]) ?? []);
    setReqs((c.data as CorrectionRequest[]) ?? []);
  }, [employee, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const startRequest = (d: string) => {
    setError("");
    setDate(d);
    setTin("");
    setTout("");
    setReason("");
    setOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("request_correction", { p_date: date, p_in: tin || null, p_out: tout || null, p_reason: reason });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setOpen(false);
    await load();
  };

  const cancel = async (r: CorrectionRequest) => {
    if (!window.confirm("Cancel this correction request?")) return;
    await supabase.rpc("cancel_request", { p_kind: "correction", p_id: r.id });
    await load();
  };

  return (
    <>
      <PageHeader
        title="My attendance"
        subtitle="Last 60 days"
        action={
          <Button variant="outline" onClick={() => startRequest(today)}>
            <PencilLine className="h-4 w-4" /> Request correction
          </Button>
        }
      />

      {reqs.length > 0 && (
        <Card className="mb-5">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Correction requests</h2>
          <ul className="divide-y divide-slate-100">
            {reqs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{fmtDate(r.work_date)}</p>
                  <p className="text-xs text-slate-500">
                    {r.requested_check_in ? `In ${fmtTime(r.requested_check_in, tz)}` : ""}
                    {r.requested_check_in && r.requested_check_out ? " · " : ""}
                    {r.requested_check_out ? `Out ${fmtTime(r.requested_check_out, tz)}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>
                  {r.decision_note && <p className="mt-0.5 text-xs text-slate-600">Manager note: {r.decision_note}</p>}
                </div>
                <RequestBadge status={r.status} />
                {r.status === "pending" && <Button variant="ghost" onClick={() => cancel(r)}>Cancel</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

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
                    {fmtTime(r.check_in_at, tz)} → {fmtTime(r.check_out_at, tz)} · {fmtHours(hoursBetween(r.check_in_at, r.check_out_at))}
                  </p>
                  <div className="mt-1"><AttendanceStatus row={r} /></div>
                </div>
                <Button variant="ghost" aria-label={`Request correction for ${fmtDate(r.work_date)}`} onClick={() => startRequest(r.work_date)}>
                  <PencilLine className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <Modal title="Request attendance correction" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            <Input label="Date" type="date" required min={addDays(today, -31)} max={today} value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Correct check-in" type="time" value={tin} onChange={(e) => setTin(e.target.value)} />
              <Input label="Correct check-out" type="time" value={tout} onChange={(e) => setTout(e.target.value)} />
            </div>
            <p className="-mt-2 text-xs text-slate-500">Fill only the time that is wrong or missing. For a day you forgot to check in, enter both.</p>
            <Field label="Reason">
              <textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Send to manager</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
