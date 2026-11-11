export type Role = "owner" | "admin" | "hr" | "manager" | "employee";
export type StaffType = "office" | "field";

export interface Organization {
  id: string;
  name: string;
  timezone: string;
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
  is_active: boolean;
}

export interface Attendance {
  id: string;
  employee_id: string;
  work_date: string;
  branch_id: string | null;
  check_in_at: string;
  check_in_lat: number;
  check_in_lng: number;
  check_in_accuracy_m: number | null;
  check_in_distance_m: number | null;
  check_in_in_geofence: boolean | null;
  check_in_selfie_path: string;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_distance_m: number | null;
  check_out_in_geofence: boolean | null;
  check_out_selfie_path: string | null;
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
}

export type EmployeeLite = Pick<Employee, "id" | "full_name" | "emp_code" | "staff_type">;
export type AttendanceWithEmployee = Attendance & { employee: EmployeeLite | null };
export type VisitWithEmployee = Visit & { employee: EmployeeLite | null };

export const ADMIN_ROLES: Role[] = ["owner", "admin", "hr"];
export const MANAGER_ROLES: Role[] = ["owner", "admin", "hr", "manager"];
