import type { Attendance, Employee, Holiday, LeaveRequest, Organization } from "./types";

/** One cell of the monthly attendance sheet. */
export type DayCode = "P" | "WH" | "L" | "HD" | "SH" | "MC" | "LV" | "LOP" | "A" | "WO" | "H" | "-" | "";

export const DAY_CODES: { code: DayCode; label: string; cls: string }[] = [
  { code: "P", label: "Present", cls: "bg-success-50 text-success-700" },
  { code: "WH", label: "Worked from home", cls: "bg-teal-50 text-teal-700" },
  { code: "L", label: "Late", cls: "bg-amber-50 text-amber-700" },
  { code: "HD", label: "Half day", cls: "bg-orange-50 text-orange-700" },
  { code: "SH", label: "Short hours", cls: "bg-fuchsia-50 text-fuchsia-700" },
  { code: "MC", label: "Missing check-out", cls: "bg-yellow-100 text-yellow-800" },
  { code: "LV", label: "Paid leave", cls: "bg-brand-50 text-brand-700" },
  { code: "LOP", label: "Unpaid leave", cls: "bg-purple-50 text-purple-700" },
  { code: "A", label: "Absent", cls: "bg-rose-50 text-rose-700" },
  { code: "WO", label: "Weekly off", cls: "bg-slate-100 text-slate-500" },
  { code: "H", label: "Holiday", cls: "bg-sky-50 text-sky-700" },
];

export const COUNT_CODES = ["P", "WH", "L", "HD", "SH", "MC", "LV", "LOP", "A", "WO", "H"] as const;
type CountCode = (typeof COUNT_CODES)[number];

export type MusterEmployee = Pick<Employee, "id" | "full_name" | "emp_code" | "joined_on" | "exit_on"> &
  Partial<Pick<Employee, "weekly_off_mode" | "weekly_offs" | "flex_offs_per_week">>;
export type MusterAttendance = Pick<Attendance, "employee_id" | "work_date" | "status" | "check_out_at" | "day_value" | "ot_minutes" | "ot_status"> & Partial<Pick<Attendance, "is_wfh">>;
export type MusterRules = Pick<Organization, "weekly_offs" | "alt_saturday_offs" | "missing_checkout_as" | "sandwich_rule"> &
  Partial<Pick<Organization, "weekly_off_mode" | "flex_offs_per_week">>;

/** A weekly off a flexible employee planned in advance. */
export interface PlannedOff {
  employee_id: string;
  off_date: string;
}

/** The weekly-off rule for one employee: their own setting, or the company's. */
export interface WeekRule {
  mode: "fixed" | "flexible";
  days: number[];
  sats: number[];
  perWeek: number;
}

export function weekRuleOf(e: Partial<Pick<Employee, "weekly_off_mode" | "weekly_offs" | "flex_offs_per_week">>, org: MusterRules): WeekRule {
  const mode = e.weekly_off_mode ?? org.weekly_off_mode ?? "fixed";
  const own = e.weekly_off_mode === "fixed";
  return {
    mode,
    days: own ? e.weekly_offs ?? [] : org.weekly_offs,
    sats: own ? [] : org.alt_saturday_offs ?? [],
    perWeek: e.flex_offs_per_week ?? org.flex_offs_per_week ?? 1,
  };
}

/** Monday of the week a date falls in (weeks run Monday to Sunday). */
export function weekStart(d: string): string {
  const back = (dow(d) + 6) % 7;
  return shift(d, -back);
}

function shift(d: string, days: number): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** First and last date of the whole Monday-to-Sunday weeks that cover a month. */
export function musterRange(month: string): { from: string; to: string } {
  const dates = monthDates(month);
  return { from: weekStart(dates[0]), to: shift(weekStart(dates[dates.length - 1]), 6) };
}

export interface MusterRow {
  employee: MusterEmployee;
  days: DayCode[];
  counts: Record<CountCode, number>;
  /** Weekly offs and holidays that are not paid because of the sandwich rule. */
  unpaidOff: number;
  /** Days that count towards pay. */
  payable: number;
  /** Overtime minutes that will be paid (approved, or automatic when approval is off). */
  otMinutes: number;
  /** Overtime minutes still waiting for a manager's decision. */
  otPendingMinutes: number;
}

export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();

/** Weekly off: a fixed weekday, or one of the chosen Saturdays of the month (1st to 5th). */
export function isWeeklyOff(d: string, rule: Pick<WeekRule, "days" | "sats">): boolean {
  const day = dow(d);
  if (rule.days.includes(day)) return true;
  return day === 6 && rule.sats.includes(Math.floor((Number(d.slice(8)) - 1) / 7) + 1);
}

export function buildMuster(
  month: string,
  today: string,
  rules: MusterRules,
  employees: MusterEmployee[],
  attendance: MusterAttendance[],
  leaves: LeaveRequest[],
  holidays: Holiday[],
  planned: PlannedOff[] = [],
): MusterRow[] {
  const dates = monthDates(month);
  const att = new Map(attendance.map((a) => [a.employee_id + a.work_date, a]));
  const hol = new Set(holidays.map((h) => h.holiday_date));
  const approved = leaves.filter((l) => l.status === "approved");
  const mcPay = rules.missing_checkout_as === "full_day" ? 1 : rules.missing_checkout_as === "half_day" ? 0.5 : 0;

  const plannedSet = new Set(planned.map((p) => p.employee_id + p.off_date));

  return employees.map((employee) => {
    const mine = approved.filter((l) => l.employee_id === employee.id);
    const rule = weekRuleOf(employee, rules);
    const flexible = rule.mode === "flexible";
    const fullLeave = (d: string) => mine.find((l) => !l.half_day && l.from_date <= d && l.to_date >= d);
    const employed = (d: string) => d >= employee.joined_on && (!employee.exit_on || d <= employee.exit_on);

    // Flexible weekly offs, decided per Monday-to-Sunday week (the whole week, even across months):
    // planned days first, then the earliest day not worked, then, for a week spent entirely on
    // leave, the last leave day. Days still ahead are not decided yet.
    const flexOff = new Set<string>();
    if (flexible) {
      for (let w = weekStart(dates[0]); w <= dates[dates.length - 1]; w = shift(w, 7)) {
        const week = Array.from({ length: 7 }, (_, i) => shift(w, i)).filter(employed);
        let left = rule.perWeek;
        const worked = (d: string) => att.has(employee.id + d);
        const free = (d: string) => !worked(d) && !hol.has(d);
        for (const d of week) {
          if (left > 0 && plannedSet.has(employee.id + d) && free(d)) {
            left--;
            if (d <= today) flexOff.add(d);
          }
        }
        for (const d of week) {
          if (left > 0 && d < today && free(d) && !flexOff.has(d) && !fullLeave(d)) {
            flexOff.add(d);
            left--;
          }
        }
        const allLeave = week.length > 0 && week.every((d) => d < today && (hol.has(d) || (!worked(d) && fullLeave(d))));
        if (allLeave) {
          for (const d of [...week].reverse()) {
            if (left > 0 && !hol.has(d) && !flexOff.has(d)) {
              flexOff.add(d);
              left--;
            }
          }
        }
      }
    }
    const isWeekOff = (d: string) => (flexible ? flexOff.has(d) : isWeeklyOff(d, rule));
    const pay: number[] = [];
    let otMinutes = 0;
    let otPendingMinutes = 0;

    const days = dates.map<DayCode>((d, i) => {
      pay[i] = 0;
      if (d > today) return "";
      if (d < employee.joined_on || (employee.exit_on && d > employee.exit_on)) return "-";
      const a = att.get(employee.id + d);
      const off = hol.has(d) || isWeekOff(d);
      const leave = off ? undefined : mine.find((l) => l.from_date <= d && l.to_date >= d);
      const paidHalfLeave = leave?.half_day && leave.leave_type?.is_paid ? 0.5 : 0;

      if (a) {
        if (a.ot_status === "approved" || a.ot_status === "auto") otMinutes += a.ot_minutes ?? 0;
        else if (a.ot_status === "pending") otPendingMinutes += a.ot_minutes ?? 0;
        // A past day that was never checked out is paid by the company's "missing check-out" rule.
        if (!a.check_out_at && d < today) {
          pay[i] = Math.min(1, mcPay + paidHalfLeave);
          return "MC";
        }
        if (a.status === "half_day") {
          pay[i] = Math.min(1, 0.5 + paidHalfLeave);
          return "HD";
        }
        if (a.status === "short") {
          // Worked less than a full day: paid whatever the company's rule gave the day at check-out.
          pay[i] = Math.min(1, Number(a.day_value ?? 0) + paidHalfLeave);
          return "SH";
        }
        pay[i] = 1;
        // An on-time day worked from home shows as WH; it is paid exactly like P.
        return a.status === "late" ? "L" : a.is_wfh ? "WH" : "P";
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
      const isOff = (c: DayCode) => c === "H" || (!flexible && c === "WO");
      const isWorking = (c: DayCode) => c !== "" && c !== "-" && !isOff(c);
      const anyPaidWork = days.some((c, i) => isWorking(c) && pay[i] > 0);
      const unpaidAbsence = (i: number) => (days[i] === "A" || days[i] === "LOP" || days[i] === "MC" || days[i] === "SH") && pay[i] === 0;
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

    const counts = { P: 0, WH: 0, L: 0, HD: 0, SH: 0, MC: 0, LV: 0, LOP: 0, A: 0, WO: 0, H: 0 };
    for (const c of days) if (c !== "" && c !== "-") counts[c] += 1;
    return { employee, days, counts, unpaidOff, otMinutes, otPendingMinutes, payable: Math.round(pay.reduce((s, v) => s + v, 0) * 1000) / 1000 };
  });
}
