import type { Attendance, Employee, Holiday, LeaveRequest } from "./types";

/** One cell of the monthly attendance sheet. */
export type DayCode = "P" | "L" | "HD" | "LV" | "LOP" | "A" | "WO" | "H" | "-" | "";

export const DAY_CODES: { code: DayCode; label: string; cls: string }[] = [
  { code: "P", label: "Present", cls: "bg-emerald-50 text-emerald-700" },
  { code: "L", label: "Late", cls: "bg-amber-50 text-amber-700" },
  { code: "HD", label: "Half day", cls: "bg-orange-50 text-orange-700" },
  { code: "LV", label: "Paid leave", cls: "bg-indigo-50 text-indigo-700" },
  { code: "LOP", label: "Unpaid leave", cls: "bg-purple-50 text-purple-700" },
  { code: "A", label: "Absent", cls: "bg-rose-50 text-rose-700" },
  { code: "WO", label: "Weekly off", cls: "bg-slate-100 text-slate-500" },
  { code: "H", label: "Holiday", cls: "bg-sky-50 text-sky-700" },
];

export interface MusterRow {
  employee: Pick<Employee, "id" | "full_name" | "emp_code" | "joined_on">;
  days: DayCode[];
  counts: Record<"P" | "L" | "HD" | "LV" | "LOP" | "A" | "WO" | "H", number>;
  /** Days that count towards pay: present, late, paid leave, weekly offs, holidays; half days count 0.5. */
  payable: number;
}

export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();

export function buildMuster(
  month: string,
  today: string,
  weeklyOffs: number[],
  employees: MusterRow["employee"][],
  attendance: Pick<Attendance, "employee_id" | "work_date" | "status">[],
  leaves: LeaveRequest[],
  holidays: Holiday[],
): MusterRow[] {
  const dates = monthDates(month);
  const att = new Map(attendance.map((a) => [a.employee_id + a.work_date, a.status]));
  const hol = new Set(holidays.map((h) => h.holiday_date));
  const approved = leaves.filter((l) => l.status === "approved");

  return employees.map((employee) => {
    const mine = approved.filter((l) => l.employee_id === employee.id);
    const counts = { P: 0, L: 0, HD: 0, LV: 0, LOP: 0, A: 0, WO: 0, H: 0 };
    let payable = 0;
    const days = dates.map<DayCode>((d) => {
      if (d > today) return "";
      if (d < employee.joined_on) return "-";
      const status = att.get(employee.id + d);
      const off = hol.has(d) || weeklyOffs.includes(dow(d));
      const leave = off ? undefined : mine.find((l) => l.from_date <= d && l.to_date >= d);
      const paidHalfLeave = leave?.half_day && leave.leave_type?.is_paid ? 0.5 : 0;
      let code: DayCode;
      if (status) {
        code = status === "late" ? "L" : status === "half_day" ? "HD" : "P";
        payable += code === "HD" ? 0.5 + paidHalfLeave : 1;
      } else if (leave) {
        code = leave.leave_type?.is_paid ? "LV" : "LOP";
        if (code === "LV") payable += leave.half_day ? 0.5 : 1;
      } else if (hol.has(d)) {
        code = "H";
        payable += 1;
      } else if (off) {
        code = "WO";
        payable += 1;
      } else if (d === today) {
        return ""; // the day is not over yet
      } else {
        code = "A";
      }
      counts[code as keyof typeof counts] += 1;
      return code;
    });
    return { employee, days, counts, payable };
  });
}
