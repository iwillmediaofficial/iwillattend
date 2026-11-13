import { Printer } from "lucide-react";
import { Button, Modal } from "./ui";
import { inr, monthLabel, type Payslip } from "../lib/payroll";

function Line({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${bold ? "border-t border-slate-300 font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{inr(value)}</span>
    </div>
  );
}

export function PayslipView({ slip, orgName, month, draft, onClose }: { slip: Payslip; orgName: string; month: string; draft?: boolean; onClose: () => void }) {
  const e = slip.employee;
  return (
    <Modal title="Payslip" onClose={onClose}>
      <div className="print-area text-sm text-slate-800">
        <div className="mb-4 text-center">
          <p className="text-lg font-semibold">{orgName}</p>
          <p className="text-slate-600">Payslip for {monthLabel(month)}{draft ? " (DRAFT)" : ""}</p>
        </div>
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs">
          <div><dt className="text-slate-500">Employee</dt><dd className="font-medium">{e?.full_name ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Employee code</dt><dd className="font-medium">{e?.emp_code ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Designation</dt><dd className="font-medium">{e?.designation ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Department</dt><dd className="font-medium">{e?.department ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Paid days</dt><dd className="font-medium">{Number(slip.paid_days)} of {slip.days_in_month}</dd></div>
          <div><dt className="text-slate-500">Unpaid days</dt><dd className="font-medium">{Number(slip.unpaid_days)}{Number(slip.late_penalty_days) > 0 ? ` (incl. ${Number(slip.late_penalty_days)} for ${slip.late_count} lates)` : ""}</dd></div>
        </dl>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Earnings</p>
            <Line label="Basic" value={slip.basic} />
            <Line label="HRA" value={slip.hra} />
            <Line label="Allowances" value={slip.allowances} />
            {Number(slip.bonus) > 0 && <Line label="Bonus / incentive" value={slip.bonus} />}
            {Number(slip.ot_pay) > 0 && <Line label={`Overtime (${Number(slip.ot_hours)} h)`} value={slip.ot_pay} />}
            <Line label="Gross earnings" value={slip.gross} bold />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions</p>
            <Line label="Provident fund" value={slip.pf_employee} />
            <Line label="ESI" value={slip.esi_employee} />
            <Line label="Professional tax" value={slip.pt} />
            <Line label="TDS" value={slip.tds} />
            {Number(slip.other_deduction) > 0 && <Line label="Other deductions" value={slip.other_deduction} />}
            <Line label="Total deductions" value={slip.total_deductions} bold />
          </div>
        </div>
        <div className="mt-4 flex justify-between rounded-lg bg-indigo-50 px-4 py-3 text-base font-semibold text-indigo-900">
          <span>Net pay</span>
          <span className="tabular-nums">{inr(slip.net_pay)}</span>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Employer contributions (not deducted from pay): PF {inr(slip.pf_employer)}, ESI {inr(slip.esi_employer)}. This is a computer-generated payslip.
        </p>
      </div>
      <Button variant="outline" className="no-print mt-4 w-full" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print or save as PDF
      </Button>
    </Modal>
  );
}
