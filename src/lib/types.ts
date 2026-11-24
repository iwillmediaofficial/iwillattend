export type Role = "owner" | "admin" | "hr" | "manager" | "employee";
export type StaffType = "office" | "field";

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  /** 0 = Sunday ... 6 = Saturday */
  weekly_offs: number[];
  /** Which Saturdays of the month are off, for example [2, 4]. */
  alt_saturday_offs: number[];
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  face_check_enabled: boolean;
  /** Owner, Admin, HR and Manager may check staff in and out with the staff member's selfie. */
  staff_checkin_enabled: boolean;
  /** fixed = the same days off for everyone; flexible = a number of days off per week, any day. */
  weekly_off_mode: "fixed" | "flexible";
  flex_offs_per_week: number;
  /** How a past day with no check-out is paid. */
  missing_checkout_as: "half_day" | "full_day" | "absent";
  /** Weekly offs and holidays between unpaid absences are not paid. */
  sandwich_rule: boolean;
  /** Office check-in is refused when the phone's location is less accurate than this many metres. */
  max_accuracy_m: number;
  /** Hours needed for a full day and a half day, and what happens in the gaps. */
  full_day_hours: number;
  half_day_hours: number;
  below_half_rule: "absent" | "hours" | "half";
  between_rule: "half" | "hours";
  full_day_tolerance_min: number;
  /** Overtime: company-wide rule. Employees can override it on their salary record. */
  ot_enabled: boolean;
  ot_mode: "multiplier" | "fixed";
  ot_multiplier: number;
  ot_fixed_rate: number;
  ot_min_minutes: number;
  ot_round_minutes: number;
  ot_max_minutes: number;
  ot_requires_approval: boolean;
  ot_off_days: boolean;
}

export interface Shift {
  id: string;
  org_id: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  half_day_under_hours: number;
  is_default: boolean;
  is_active: boolean;
}

export interface Holiday {
  id: string;
  holiday_date: string;
  name: string;
}

export interface LeaveType {
  id: string;
  name: string;
  annual_quota: number;
  is_paid: boolean;
  is_active: boolean;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  half_day: boolean;
  days: number;
  reason: string | null;
  status: RequestStatus;
  decision_note: string | null;
  created_at: string;
  leave_type?: Pick<LeaveType, "name" | "is_paid"> | null;
  employee?: EmployeeLite | null;
}

export interface CorrectionRequest {
  id: string;
  employee_id: string;
  work_date: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string;
  status: RequestStatus;
  decision_note: string | null;
  created_at: string;
  employee?: EmployeeLite | null;
}

export interface Branch {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  is_active: boolean;
}

export interface Employee {
  id: string;
  org_id: string;
  user_id: string | null;
  emp_code: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  department: string | null;
  role: Role;
  staff_type: StaffType;
  branch_id: string | null;
  shift_id: string | null;
  joined_on: string;
  /** Last working day, set when the employee is deactivated. */
  exit_on: string | null;
  face_enrolled_at: string | null;
  is_active: boolean;
  /** null = follow the company; otherwise this employee's own weekly-off rule. */
  weekly_off_mode: "fixed" | "flexible" | null;
  weekly_offs: number[] | null;
  flex_offs_per_week: number | null;
}

/** short = worked less than a full day and valued by the company's rules (see day_value). */
export type DayStatus = "present" | "late" | "half_day" | "short";

export interface Attendance {
  id: string;
  employee_id: string;
  work_date: string;
  branch_id: string | null;
  shift_id: string | null;
  late_minutes: number;
  status: DayStatus;
  /** True when a manager-approved correction created or changed this row. */
  is_corrected: boolean;
  /** Set by the hourly job when a check-in was never checked out. */
  missing_checkout: boolean;
  /** Checked in on an approved work-from-home day, so the office location rule was lifted. */
  is_wfh: boolean;
  /** The allotted site work this check-in was made under; the office location rule was lifted. */
  site_assignment_id: string | null;
  /** Set when a manager checked this person in or out on their behalf. */
  check_in_by: string | null;
  check_in_by_name: string | null;
  check_out_by: string | null;
  check_out_by_name: string | null;
  /** Minutes between check-in and check-out; null while the day is open. */
  worked_minutes: number | null;
  /** What the day is worth for pay, 0 to 1, fixed at check-out by the rules then in force. */
  day_value: number | null;
  /** Overtime minutes worked out at check-out; paid only when approved or automatic. */
  ot_minutes: number;
  ot_status: "pending" | "approved" | "rejected" | "auto" | null;
  check_in_at: string;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_accuracy_m: number | null;
  check_in_distance_m: number | null;
  check_in_in_geofence: boolean | null;
  check_in_selfie_path: string | null;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_distance_m: number | null;
  check_out_in_geofence: boolean | null;
  check_out_selfie_path: string | null;
  /** null = the selfie was not compared (not enrolled, face check off, or model failed to load). */
  check_in_face_match: boolean | null;
  check_out_face_match: boolean | null;
  /** The employee had a registered face at this punch, so an unchecked face is a flag. */
  face_required: boolean;
  /** Face checks that failed on the camera screen before this punch was confirmed. */
  check_in_face_fails: number;
  check_out_face_fails: number;
}

export interface Visit {
  id: string;
  employee_id: string;
  work_date: string;
  visited_at: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  selfie_path: string;
  client_name: string;
  notes: string | null;
  face_match: boolean | null;
  face_required: boolean;
  face_fails: number;
}

export type EmployeeLite = Pick<Employee, "id" | "full_name" | "emp_code" | "staff_type">;
export type AttendanceWithEmployee = Attendance & { employee: EmployeeLite | null; site?: { site_name: string } | null };

/** Site work allotted by a manager: on these days the employee checks in from the site, not the office. */
export interface SiteAssignment {
  id: string;
  employee_id: string;
  from_date: string;
  to_date: string;
  site_name: string;
  details: string | null;
  status: "active" | "cancelled";
  created_at: string;
  employee?: EmployeeLite | null;
}
export type VisitWithEmployee = Visit & { employee: EmployeeLite | null };

export const ADMIN_ROLES: Role[] = ["owner", "admin", "hr"];
export const MANAGER_ROLES: Role[] = ["owner", "admin", "hr", "manager"];
/** Owner and Admin supervise the company: no attendance, leave or salary of their own. */
export const SUPERVISOR_ROLES: Role[] = ["owner", "admin"];

export interface Plan {
  id: string;
  name: string;
  price_monthly: number;
  max_employees: number;
  payroll: boolean;
  face: boolean;
  sort_order: number;
}

/** What the signed-in user's company is entitled to right now. */
export interface Subscription {
  plan_id: string;
  plan_name: string;
  max_employees: number;
  payroll: boolean;
  face: boolean;
  /** ok = normal; expired = paid plan lapsed; suspended = switched off by the platform admin; over_limit = too many employees for 7+ days. */
  state: "ok" | "expired" | "suspended" | "over_limit";
  /** Date the company first had more active employees than its plan allows. */
  over_limit_since: string | null;
  sub_status: "trial" | "active" | "suspended";
  valid_until: string | null;
  active_employees: number;
  is_platform_admin: boolean;
}

export interface WfhRequest {
  id: string;
  employee_id: string;
  from_date: string;
  to_date: string;
  reason: string | null;
  status: RequestStatus;
  decision_note: string | null;
  created_at: string;
  employee?: EmployeeLite | null;
}
