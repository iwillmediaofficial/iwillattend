import type { Attendance, Employee, Holiday, LeaveRequest, Organization } from "./types";

/** One cell of the monthly attendance sheet. */
export type DayCode = "P" | "L" | "HD" | "MC" | "LV" | "LOP" | "A" | "WO" | "H" | "-" | "";

export const DAY_CODES: { code: DayCode; label: string; cls: string }[] = [
  { code: "P", label: "Present", cls: "bg-emerald-50 text-emerald-700" },
  { code: "L", label: "Late", cls: "bg-amber-50 text-amber-700" },
  { code: "HD", label: "Half day", cls: "bg-orange-50 text-orange-700" },
  { code: "MC", label: "Missing check-out", cls: "bg-yellow-100 text-yellow-800" },
  { code: "LV", label: "Paid leave", cls: "bg-indigo-50 text-indigo-700" },
  { code: "LOP", label: "Unpaid leave", cls: "bg-purple-50 text-purple-700" },
  { code: "A", label: "Absent", cls: "bg-rose-50 text-rose-700" },
  { code: "WO", label: "Weekly off", cls: "bg-slate-100 text-slate-500" },
  { code: "H", label: "Holiday", cls: "bg-sky-50 text-sky-700" },
];

export const COUNT_CODES = ["P", "L", "HD", "MC", "LV", "LOP", "A", "WO", "H"] as const;
type CountCode = (typeof COUNT_CODES)[number];

export type MusterEmployee = Pick<Employee, "id" | "full_name" | "emp_code" | "joined_on" | "exit_on">;
export type MusterAttendance = Pick<Attendance, "employee_id" | "work_date" | "status" | "check_out_at">;
export type MusterRules = Pick<Organization, "weekly_offs" | "alt_saturday_offs" | "missing_checkout_as" | "sandwich_rule">;

export interface MusterRow {
  employee: MusterEmployee;
  days: DayCode[];
  counts: Record<CountCode, number>;
  /** Weekly offs and holidays that are not paid because of the sandwich rule. */
  unpaidOff: number;
  /** Days that count towards pay. */
  payable: number;
}

export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
const isOff = (c: DayCode) => c === "WO" || c === "H";

/** Weekly off: a fixed weekday, or one of the chosen Saturdays of the month (1st to 5th). */
export function isWeeklyOff(d: string, rules: Pick<Organization, "weekly_offs" | "alt_saturday_offs">): boolean {
  const day = dow(d);
  if (rules.weekly_offs.includes(day)) return true;
  return day === 6 && (rules.alt_saturday_offs ?? []).includes(Math.floor((Number(d.slice(8)) - 1) / 7) + 1);
}

export function buildMuster(
  month: string,
  today: string,
  rules: MusterRules,
  employees: MusterEmployee[],
  attendance: MusterAttendance[],
  leaves: LeaveRequest[],
  holidays: Holiday[],
): MusterRow[] {
  const dates = monthDates(month);
  const att = new Map(attendance.map((a) => [a.employee_id + a.work_date, a]));
  const hol = new Set(holidays.map((h) => h.holiday_date));
  const approved = leaves.filter((l) => l.status === "approved");
  const mcPay = rules.missing_checkout_as === "full_day" ? 1 : rules.missing_checkout_as === "half_day" ? 0.5 : 0;

  return employees.map((employee) => {
    const mine = approved.filter((l) => l.employee_id === employee.id);
    const pay: number[] = [];

    const days = dates.map<DayCode>((d, i) => {
      pay[i] = 0;
      if (d > today) return "";
      if (d < employee.joined_on || (employee.exit_on && d > employee.exit_on)) return "-";
      const a = att.get(employee.id + d);
      const off = hol.has(d) || isWeeklyOff(d, rules);
      const leave = off ? undefined : mine.find((l) => l.from_date <= d && l.to_date >= d);
      const paidHalfLeave = leave?.half_day && leave.leave_type?.is_paid ? 0.5 : 0;

      if (a) {
        // A past day that was never checked out is paid by the company's "missing check-out" rule.
        if (!a.check_out_at && d < today) {
          pay[i] = Math.min(1, mcPay + paidHalfLeave);
          return "MC";
        }
        if (a.status === "half_day") {
          pay[i] = 0.5 + paidHalfLeave;
          return "HD";
        }
        pay[i] = 1;
        return a.status === "late" ? "L" : "P";
      }
      if (leave) {
        if (!leave.leave_type?.is_paid) return "LOP";
        pay[i] = leave.half_day ? 0.5 : 1;
        return "LV";
      }
      if (hol.has(d)) {
        pay[i] = 1;
        return "H";
      }
      if (off) {
        pay[i] = 1;
        return "WO";
      }
      return d === today ? "" : "A"; // today is not over yet
    });

    // Sandwich rule: an off day is unpaid when the working days on both sides of it were
    // unpaid absences, or when the employee earned no paid working day in the whole month.
    let unpaidOff = 0;
    if (rules.sandwich_rule) {
      const isWorking = (c: DayCode) => c !== "" && c !== "-" && !isOff(c);
      const anyPaidWork = days.some((c, i) => isWorking(c) && pay[i] > 0);
      const unpaidAbsence = (i: number) => (days[i] === "A" || days[i] === "LOP" || days[i] === "MC") && pay[i] === 0;
      for (let i = 0; i < days.length; i++) {
        if (!isOff(days[i])) continue;
        let j = i;
        while (j + 1 < days.length && isOff(days[j + 1])) j++;
        let before = i - 1;
        while (before >= 0 && !isWorking(days[before])) before--;
        let after = j + 1;
        while (after < days.length && !isWorking(days[after])) after++;
        const sandwiched = before >= 0 && after < days.length && unpaidAbsence(before) && unpaidAbsence(after);
        if (!anyPaidWork || sandwiched) {
          for (let k = i; k <= j; k++) {
            pay[k] = 0;
            unpaidOff++;
          }
        }
        i = j;
      }
    }

    const counts = { P: 0, L: 0, HD: 0, MC: 0, LV: 0, LOP: 0, A: 0, WO: 0, H: 0 };
    for (const c of days) if (c !== "" && c !== "-") counts[c] += 1;
    return { employee, days, counts, unpaidOff, payable: pay.reduce((s, v) => s + v, 0) };
  });
}
