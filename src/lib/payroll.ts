import { supabase } from "./supabase";
import { buildMuster, monthDates, type MusterAttendance, type MusterEmployee, type MusterRow, type MusterRules } from "./muster";
import type { Holiday, LeaveRequest } from "./types";
import { fetchAll } from "./utils";

export interface PayrollSettings {
  pay_days_basis: "calendar" | "26" | "30";
  pf_enabled: boolean;
  pf_employee_pct: number;
  pf_employer_pct: number;
  pf_wage_ceiling: number;
  esi_enabled: boolean;
  esi_employee_pct: number;
  esi_employer_pct: number;
  esi_gross_limit: number;
  pt_enabled: boolean;
  pt_amount: number;
  pt_min_gross: number;
  /** 0 = lateness is only reported; N = every N lates in a month cost half a day's pay. */
  lates_per_half_day: number;
}

export const DEFAULT_SETTINGS: PayrollSettings = {
  pay_days_basis: "calendar",
  pf_enabled: true, pf_employee_pct: 12, pf_employer_pct: 12, pf_wage_ceiling: 15000,
  esi_enabled: true, esi_employee_pct: 0.75, esi_employer_pct: 3.25, esi_gross_limit: 21000,
  pt_enabled: false, pt_amount: 200, pt_min_gross: 15000,
  lates_per_half_day: 0,
};

export interface SalaryStructure {
  employee_id: string;
  basic: number;
  hra: number;
  allowances: number;
  tds_monthly: number;
  pf_applicable: boolean;
  esi_applicable: boolean;
  bank_name: string | null;
  bank_account: string | null;
  ifsc: string | null;
  pan: string | null;
  uan: string | null;
}

export interface PayrollRun {
  id: string;
  month: string;
  status: "draft" | "locked";
}

export interface SlipNumbers {
  days_in_month: number;
  paid_days: number;
  unpaid_days: number;
  late_count: number;
  late_penalty_days: number;
  basic: number;
  hra: number;
  allowances: number;
  bonus: number;
  gross: number;
  pf_employee: number;
  esi_employee: number;
  pt: number;
  tds: number;
  other_deduction: number;
  total_deductions: number;
  net_pay: number;
  pf_employer: number;
  esi_employer: number;
}

export interface Payslip extends SlipNumbers {
  id: string;
  run_id: string;
  employee_id: string;
  employee?: { full_name: string; emp_code: string | null; designation: string | null; department: string | null } | null;
  run?: PayrollRun | null;
}

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

export const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n(v));

export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(month.slice(0, 7) + "-01T00:00:00Z"));

/** Statutory deductions and totals from the earned (already pro-rated) amounts. */
export function totals(
  earned: { basic: number; hra: number; allowances: number },
  bonus: number,
  otherDeduction: number,
  st: SalaryStructure,
  s: PayrollSettings,
  /** TDS for this month, already scaled to the days paid. */
  tds: number,
) {
  const gross = r2(earned.basic + earned.hra + earned.allowances + bonus);
  let pf_employee = 0, pf_employer = 0, esi_employee = 0, esi_employer = 0;
  if (s.pf_enabled && st.pf_applicable) {
    const wage = Math.min(earned.basic, n(s.pf_wage_ceiling));
    pf_employee = Math.round((wage * n(s.pf_employee_pct)) / 100);
    pf_employer = Math.round((wage * n(s.pf_employer_pct)) / 100);
  }
  // ESI eligibility is judged on the full monthly salary, the contribution on what was earned.
  if (s.esi_enabled && st.esi_applicable && n(st.basic) + n(st.hra) + n(st.allowances) <= n(s.esi_gross_limit)) {
    esi_employee = Math.ceil((gross * n(s.esi_employee_pct)) / 100);
    esi_employer = Math.ceil((gross * n(s.esi_employer_pct)) / 100);
  }
  const pt = s.pt_enabled && gross >= n(s.pt_min_gross) && gross > 0 ? n(s.pt_amount) : 0;
  const total_deductions = r2(pf_employee + esi_employee + pt + tds + otherDeduction);
  return { gross, pf_employee, pf_employer, esi_employee, esi_employer, pt, tds, total_deductions, net_pay: r2(gross - total_deductions) };
}

export function computeSlip(st: SalaryStructure, s: PayrollSettings, row: MusterRow, bonus = 0, otherDeduction = 0): SlipNumbers {
  const dim = row.days.length;
  const counted = row.days.filter((c) => c !== "-" && c !== "").length;
  const joinedMidMonth = row.days.includes("-");
  const late_count = row.counts.L;
  const late_penalty_days = s.lates_per_half_day > 0 ? Math.floor(late_count / s.lates_per_half_day) * 0.5 : 0;
  const unpaid_days = Math.max(0, counted - row.payable) + late_penalty_days;

  let paid_days: number;
  let factor: number;
  if (s.pay_days_basis === "calendar" || joinedMidMonth) {
    paid_days = Math.max(0, row.payable - late_penalty_days);
    factor = paid_days / dim;
  } else {
    const basis = Number(s.pay_days_basis);
    paid_days = Math.max(0, basis - unpaid_days);
    factor = paid_days / basis;
  }
  factor = Math.min(1, factor);

  const earned = {
    basic: Math.round(n(st.basic) * factor),
    hra: Math.round(n(st.hra) * factor),
    allowances: Math.round(n(st.allowances) * factor),
  };
  return {
    days_in_month: dim,
    paid_days: r2(paid_days),
    unpaid_days: r2(unpaid_days),
    late_count,
    late_penalty_days,
    ...earned,
    bonus,
    other_deduction: otherDeduction,
    ...totals(earned, bonus, otherDeduction, st, s, Math.round(n(st.tds_monthly) * factor)),
  };
}

/** Builds the monthly attendance sheet for the given employees (same rules as the Monthly sheet page). */
export async function loadMuster(month: string, today: string, rules: MusterRules, employees: MusterEmployee[]): Promise<MusterRow[]> {
  const dates = monthDates(month);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const [attendance, l, h] = await Promise.all([
    fetchAll<MusterAttendance>(() => supabase.from("attendance").select("employee_id, work_date, status, check_out_at, day_value").gte("work_date", first).lte("work_date", last).order("id")),
    supabase.from("leave_requests").select("*, leave_type:leave_types(name, is_paid)").eq("status", "approved").lte("from_date", last).gte("to_date", first),
    supabase.from("holidays").select("*").gte("holiday_date", first).lte("holiday_date", last),
  ]);
  const err = l.error ?? h.error;
  if (err) throw err;
  return buildMuster(
    month, today, rules, employees,
    attendance,
    (l.data as unknown as LeaveRequest[]) ?? [],
    (h.data as Holiday[]) ?? [],
  );
}
