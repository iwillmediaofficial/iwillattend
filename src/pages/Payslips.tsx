import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { Card, Empty, PageHeader, Spinner } from "../components/ui";
import { PayslipView } from "../components/PayslipView";
import { inr, monthLabel, type Payslip } from "../lib/payroll";

export function Payslips() {
  const { employee, org } = useAuth();
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [view, setView] = useState<Payslip | null>(null);

  useEffect(() => {
    supabase
      .from("payslips")
      .select("*, run:payroll_runs(id, month, status), employee:employees(full_name, emp_code, designation, department)")
      .eq("employee_id", employee!.id)
      .then(({ data }) => {
        const all = ((data as unknown as Payslip[]) ?? []).filter((p) => p.run?.status === "locked");
        setRows(all.sort((a, b) => (b.run!.month > a.run!.month ? 1 : -1)));
      });
  }, [employee]);

  return (
    <>
      <PageHeader title="My payslips" subtitle="Available once the month's payroll is finalised" />
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No payslips yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li key={p.id}>
                <button onClick={() => setView(p)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <FileText className="h-5 w-5 text-indigo-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{monthLabel(p.run!.month)}</p>
                    <p className="text-xs text-slate-500">Paid days {Number(p.paid_days)} of {p.days_in_month}</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{inr(p.net_pay)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {view && <PayslipView slip={view} orgName={org!.name} month={view.run!.month} onClose={() => setView(null)} />}
    </>
  );
}
