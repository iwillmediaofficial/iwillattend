import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { LeaveRequest, LeaveType } from "../lib/types";
import { Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { RequestBadge } from "../components/badges";
import { errMsg, fmtDate, todayIn } from "../lib/utils";


/** Years from the joining year to this year, newest first. */
function yearsSince(joined: string | undefined, today: string): string[] {
  const first = Math.max(Number((joined ?? today).slice(0, 4)), Number(today.slice(0, 4)) - 9);
  const out: string[] = [];
  for (let y = Number(today.slice(0, 4)); y >= first; y--) out.push(String(y));
  return out;
}

export function Leave() {
  const { employee, org } = useAuth();
  const today = todayIn(org!.timezone);
  const [year, setYear] = useState(today.slice(0, 4));
  const years = yearsSince(employee?.joined_on, today);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [rows, setRows] = useState<LeaveRequest[] | null>(null);
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([
      supabase.from("leave_types").select("*").eq("is_active", true).order("name"),
      supabase.from("leave_requests").select("*, leave_type:leave_types(name, is_paid)").eq("employee_id", employee!.id).gte("from_date", `${year}-01-01`).lte("from_date", `${year}-12-31`).order("from_date", { ascending: false }),
    ]);
    setTypes((t.data as LeaveType[]) ?? []);
    setRows((r.data as unknown as LeaveRequest[]) ?? []);
  }, [employee, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const used = (id: string, statuses: string[]) =>
    (rows ?? []).filter((r) => r.leave_type_id === id && statuses.includes(r.status) && r.from_date.startsWith(year)).reduce((s, r) => s + Number(r.days), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("request_leave", { p_leave_type: typeId, p_from: from, p_to: half ? from : to, p_half_day: half, p_reason: reason });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setOpen(false);
    setReason("");
    setHalf(false);
    await load();
  };

  const cancel = async (r: LeaveRequest) => {
    if (!window.confirm(r.status === "approved" ? "Cancel this approved leave? The days go back to your balance." : "Cancel this leave request?")) return;
    const { error } = await supabase.rpc("cancel_leave", { p_id: r.id });
    if (error) window.alert(error.message);
    await load();
  };

  if (!rows) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Leave"
        subtitle={`Balances for ${year}`}
        action={
          <div className="flex gap-2">
          {years.length > 1 && (
            <select aria-label="Year" value={year} onChange={(e) => { setRows(null); setYear(e.target.value); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
          )}
          <Button onClick={() => { setError(""); setTypeId(types[0]?.id ?? ""); setOpen(true); }} disabled={types.length === 0}>
            <Plus className="h-4 w-4" /> Request leave
          </Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {types.map((t) => {
          const taken = used(t.id, ["approved"]);
          const pending = used(t.id, ["pending"]);
          return (
            <Card key={t.id} className="p-4">
              <p className="truncate text-xs text-slate-500">{t.name}</p>
              {t.is_paid ? (
                <p className="text-2xl font-semibold">
                  {Number(t.annual_quota) - taken - pending}
                  <span className="text-sm font-normal text-slate-400"> / {Number(t.annual_quota)}</span>
                </p>
              ) : (
                <p className="text-2xl font-semibold">{taken}<span className="text-sm font-normal text-slate-400"> taken</span></p>
              )}
              <p className="text-xs text-slate-500">{t.is_paid ? `${taken} taken${pending ? ` · ${pending} pending` : ""}` : "Unpaid"}</p>
            </Card>
          );
        })}
      </div>

      <Card>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">My requests</h2>
        {rows.length === 0 ? (
          <Empty>No leave requests this year.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {r.leave_type?.name} · {Number(r.days)} day{Number(r.days) === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` to ${fmtDate(r.to_date)}` : ""}{r.half_day ? " (half day)" : ""}
                  </p>
                  {r.reason && <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>}
                  {r.decision_note && <p className="mt-0.5 text-xs text-slate-600">Manager note: {r.decision_note}</p>}
                </div>
                <RequestBadge status={r.status} />
                {(r.status === "pending" || (r.status === "approved" && r.from_date > today)) && <Button variant="ghost" onClick={() => cancel(r)}>Cancel</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <Modal title="Request leave" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            <Select label="Leave type" required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.is_paid ? "" : " (unpaid)"}</option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Half day
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input label={half ? "Date" : "From"} type="date" required value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
              {!half && <Input label="To" type="date" required min={from} value={to} onChange={(e) => setTo(e.target.value)} />}
            </div>
            <Field label="Reason (optional)">
              <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </Field>
            <p className="text-xs text-slate-500">Weekly offs and holidays inside the range are not counted.</p>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>Send request</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
