import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, Empty, ErrorText, PageHeader, Spinner } from "../components/ui";
import { RequestBadge } from "../components/badges";
import type { RequestStatus } from "../lib/types";
import { downloadCsv, errMsg, fetchAll, fmtDate, todayIn } from "../lib/utils";

const PAGE = 25;
const inputCls = "mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

type Tab = "summary" | "leave" | "wfh";

interface Summary {
  employee_id: string;
  full_name: string;
  emp_code: string | null;
  leave_days: number;
  unpaid_days: number;
  by_type: { type: string; paid: boolean; days: number; quota: number | null; left: number | null }[];
  wfh_days: number;
  pending_requests: number;
}

interface Req {
  id: string;
  from_date: string;
  to_date: string;
  half_day?: boolean;
  days?: number;
  reason: string | null;
  status: RequestStatus;
  decision_note: string | null;
  decided_at: string | null;
  employee: { full_name: string } | null;
  decider: { full_name: string } | null;
  leave_type?: { name: string; is_paid: boolean } | null;
}

// Only the columns the list shows; names come from small joins.
const LEAVE_COLS = "id, from_date, to_date, half_day, days, reason, status, decision_note, decided_at, employee:employees!employee_id(full_name), decider:employees!decided_by(full_name), leave_type:leave_types(name, is_paid)";
const WFH_COLS = "id, from_date, to_date, reason, status, decision_note, decided_at, employee:employees!employee_id(full_name), decider:employees!decided_by(full_name)";

/** Leave and work-from-home history for owners, admins, HR and managers. */
export function LeaveHistory() {
  const { org } = useAuth();
  const today = todayIn(org!.timezone);
  const [tab, setTab] = useState<Tab>("summary");
  const [from, setFrom] = useState(today.slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today);
  const [empId, setEmpId] = useState("");
  const [status, setStatus] = useState<"" | RequestStatus>("");
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [summary, setSummary] = useState<Summary[] | null>(null);
  const [rows, setRows] = useState<Req[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("employees").select("id, full_name").not("role", "in", "(owner,admin)").order("full_name")
      .then(({ data }) => setStaff((data as { id: string; full_name: string }[]) ?? []));
  }, []);

  const query = useCallback(
    (kind: "leave" | "wfh") => {
      let q = supabase
        .from(kind === "leave" ? "leave_requests" : "wfh_requests")
        .select(kind === "leave" ? LEAVE_COLS : WFH_COLS)
        .lte("from_date", to)
        .gte("to_date", from)
        .order("from_date", { ascending: false })
        .order("id");
      if (empId) q = q.eq("employee_id", empId);
      if (status) q = q.eq("status", status);
      return q;
    },
    [from, to, empId, status],
  );

  // Fetch one page (one extra row tells whether there is a next page).
  const loadPage = useCallback(
    async (offset: number) => {
      if (tab === "summary") return;
      setBusy(true);
      setError("");
      const { data, error } = await query(tab).range(offset, offset + PAGE);
      setBusy(false);
      if (error) return setError(errMsg(error));
      const list = (data as unknown as Req[]) ?? [];
      setMore(list.length > PAGE);
      setRows((prev) => [...(offset === 0 ? [] : prev ?? []), ...list.slice(0, PAGE)]);
    },
    [tab, query],
  );

  // Summary: one small call, only while its tab is open and only when its filters change.
  useEffect(() => {
    if (tab !== "summary") return;
    if (from > to) return setError("The start date must be before the end date.");
    setError("");
    setSummary(null);
    let alive = true;
    supabase.rpc("leave_wfh_summary", { p_from: from, p_to: to, p_employee: empId || null })
      .then(({ data, error }) => alive && (error ? setError(errMsg(error)) : setSummary((data as Summary[]) ?? [])));
    return () => {
      alive = false;
    };
  }, [tab, from, to, empId]);

  // Request lists: the first page only, when their tab is open or a filter changes.
  useEffect(() => {
    if (tab === "summary") return;
    if (from > to) return setError("The start date must be before the end date.");
    setRows(null);
    void loadPage(0);
  }, [tab, from, to, loadPage]);

  const exportCsv = async () => {
    setBusy(true);
    setError("");
    try {
      if (tab === "summary") {
        const types = [...new Set((summary ?? []).flatMap((s) => s.by_type.map((t) => t.type)))].sort();
        downloadCsv(`leave_wfh_summary_${from}_to_${to}.csv`, [
          ["Employee", "Code", "Leave days", "Unpaid days", ...types.flatMap((t) => [`${t} days`, `${t} left this year`]), "WFH days", "Pending requests"],
          ...(summary ?? []).map((s) => [
            s.full_name, s.emp_code, s.leave_days, s.unpaid_days,
            ...types.flatMap((t) => {
              const x = s.by_type.find((b) => b.type === t);
              return [x?.days ?? 0, x?.left ?? ""];
            }),
            s.wfh_days, s.pending_requests,
          ]),
        ]);
      } else {
        // The full list is fetched only now, when it is asked for.
        const all = await fetchAll<Req>(() => query(tab) as never);
        downloadCsv(`${tab === "leave" ? "leave" : "wfh"}_requests_${from}_to_${to}.csv`, [
          ["Employee", ...(tab === "leave" ? ["Leave type", "Paid"] : []), "From", "To", ...(tab === "leave" ? ["Days"] : []), "Status", "Reason", "Decided by", "Decided on", "Note"],
          ...all.map((r) => [
            r.employee?.full_name, ...(tab === "leave" ? [r.leave_type?.name, r.leave_type?.is_paid ? "Yes" : "No"] : []),
            r.from_date, r.to_date, ...(tab === "leave" ? [r.half_day ? 0.5 : r.days] : []),
            r.status, r.reason, r.decider?.full_name, r.decided_at?.slice(0, 10), r.decision_note,
          ]),
        ]);
      }
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };

  return (
    <>
      <PageHeader
        title="Leave & WFH history"
        subtitle="Totals and requests for any period, for one person or everyone"
        action={<Button variant="outline" onClick={exportCsv} loading={busy && tab !== "summary"} disabled={tab === "summary" ? !summary?.length : !rows?.length}><Download className="h-4 w-4" /> Download CSV</Button>}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={inputCls} /></label>
        <label className="text-xs text-slate-500">To<input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={inputCls} /></label>
        <label className="text-xs text-slate-500">
          Employee
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} className={inputCls}>
            <option value="">Everyone</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </label>
        {tab !== "summary" && (
          <label className="text-xs text-slate-500">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | "")} className={inputCls}>
              <option value="">Any status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        )}
      </div>

      <div className="mb-4 flex w-fit rounded-lg bg-slate-100 p-1" role="tablist">
        {([["summary", "Summary"], ["leave", "Leave requests"], ["wfh", "WFH requests"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>

      <ErrorText>{error}</ErrorText>

      {tab === "summary" ? (
        <Card>
          {!summary ? (
            <Spinner />
          ) : summary.length === 0 ? (
            <Empty>No staff found.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Employee</th>
                    <th className="px-4 py-2 font-medium">Leave taken</th>
                    <th className="px-4 py-2 font-medium">By type (left this year)</th>
                    <th className="px-4 py-2 font-medium">WFH days</th>
                    <th className="px-4 py-2 font-medium">Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s) => (
                    <tr key={s.employee_id}>
                      <td className="px-4 py-2 font-medium">{s.full_name}</td>
                      <td className="px-4 py-2">{Number(s.leave_days)}{Number(s.unpaid_days) > 0 && <span className="text-xs text-rose-600"> ({Number(s.unpaid_days)} unpaid)</span>}</td>
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap gap-1">
                          {s.by_type.filter((t) => Number(t.days) > 0 || t.left != null).map((t) => (
                            <Badge key={t.type} tone={Number(t.days) > 0 ? "indigo" : "slate"}>
                              {t.type}: {Number(t.days)}{t.left != null ? ` (${Number(t.left)} left)` : ""}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      <td className="px-4 py-2">{s.wfh_days}</td>
                      <td className="px-4 py-2">{s.pending_requests > 0 ? <Badge tone="amber">{s.pending_requests}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Leave taken counts approved leave inside the dates above. "Left" is the balance for the year of the end date. WFH days are days actually checked in on approved work from home.
          </p>
        </Card>
      ) : (
        <Card>
          {!rows ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <Empty>No {tab === "leave" ? "leave" : "WFH"} requests in this period.</Empty>
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {r.employee?.full_name ?? "Employee"}
                        {r.leave_type && <span className="font-normal text-slate-500"> · {r.leave_type.name}{r.leave_type.is_paid ? "" : " (unpaid)"}</span>}
                      </p>
                      <p className="text-xs text-slate-600">
                        {fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` to ${fmtDate(r.to_date)}` : ""}
                        {r.half_day ? " · half day" : r.days != null ? ` · ${Number(r.days)} day${Number(r.days) === 1 ? "" : "s"}` : ""}
                      </p>
                      {r.reason && <p className="mt-0.5 text-xs text-slate-500">{r.reason}</p>}
                      {(r.decider || r.decision_note) && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {r.decider ? `By ${r.decider.full_name}${r.decided_at ? ` on ${fmtDate(r.decided_at.slice(0, 10))}` : ""}` : ""}{r.decision_note ? ` · "${r.decision_note}"` : ""}
                        </p>
                      )}
                    </div>
                    <RequestBadge status={r.status} />
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                <span>Showing {rows.length}{more ? "+" : ""}</span>
                {more && <Button variant="outline" onClick={() => void loadPage(rows.length)} loading={busy}>Load {PAGE} more</Button>}
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
