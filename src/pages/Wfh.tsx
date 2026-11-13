import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { WfhRequest } from "../lib/types";
import { Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { RequestBadge } from "../components/badges";
import { addDays, errMsg, fmtDate, todayIn } from "../lib/utils";

export function Wfh() {
  const { employee, org } = useAuth();
  const today = todayIn(org!.timezone);
  const [rows, setRows] = useState<WfhRequest[] | null>(null);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("wfh_requests")
      .select("*")
      .eq("employee_id", employee!.id)
      .gte("to_date", addDays(today, -60))
      .order("from_date", { ascending: false });
    setRows((data as WfhRequest[]) ?? []);
  }, [employee, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("request_wfh", { p_from: from, p_to: to, p_reason: reason });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setOpen(false);
    setReason("");
    await load();
  };

  const cancel = async (r: WfhRequest) => {
    if (!window.confirm("Cancel this work-from-home request?")) return;
    const { error } = await supabase.rpc("cancel_request", { p_kind: "wfh", p_id: r.id });
    if (error) window.alert(error.message);
    await load();
  };

  return (
    <>
      <PageHeader
        title="Work from home"
        subtitle={employee!.staff_type === "office" ? "On an approved day you can check in from anywhere" : "Request days you will work from home"}
        action={
          <Button onClick={() => { setError(""); setFrom(today); setTo(today); setOpen(true); }}>
            <Plus className="h-4 w-4" /> Request WFH
          </Button>
        }
      />
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No work-from-home requests.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` to ${fmtDate(r.to_date)}` : ""}
                  </p>
                  {r.reason && <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>}
                  {r.decision_note && <p className="mt-0.5 text-xs text-slate-600">Manager note: {r.decision_note}</p>}
                </div>
                <RequestBadge status={r.status} />
                {(r.status === "pending" || (r.status === "approved" && r.to_date >= today)) && (
                  <Button variant="ghost" onClick={() => cancel(r)}>Cancel</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <Modal title="Request work from home" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="From" type="date" required min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
              <Input label="To" type="date" required min={from} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Field label="Reason (optional)">
              <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </Field>
            <p className="text-xs text-slate-500">You still check in and out with a selfie on those days; only the office location rule is lifted.</p>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Send request</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
