import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Building2, CalendarClock, ClipboardCheck, CreditCard, FileBarChart, Fingerprint, FolderArchive, FolderOpen, Globe, HardHat, House, IndianRupee, KeyRound, UserCheck, ReceiptText, LayoutDashboard, LogOut, MapPinned, Palmtree, Settings as SettingsIcon, Table2, Users } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import type { Subscription } from "../lib/types";
import { addDays, fmtDate, todayIn } from "../lib/utils";
import { ChangePassword } from "./ChangePassword";

function subscriptionNotice(sub: Subscription | null, isAdmin: boolean, tz: string): { text: string; danger: boolean } | null {
  if (!sub) return null;
  if (sub.state === "suspended") return { text: "This company account is suspended, so attendance is paused. Please contact IWILL Attend support.", danger: true };
  if (sub.state === "over_limit") return { text: `Attendance is paused: ${sub.active_employees} employees are active but the ${sub.plan_name} plan allows ${sub.max_employees}. Upgrade, or deactivate staff, to resume.`, danger: true };
  if (sub.state === "expired") return { text: `The subscription ended on ${fmtDate(sub.valid_until!)}. Attendance is paused until it is renewed.`, danger: true };
  if (!isAdmin) return null;
  const today = todayIn(tz);
  if (sub.active_employees > sub.max_employees) {
    const pauseOn = addDays(sub.over_limit_since ?? today, 8);
    return { text: `${sub.active_employees} employees are active but the ${sub.plan_name} plan allows ${sub.max_employees}. Attendance will pause on ${fmtDate(pauseOn)} unless you upgrade or deactivate staff.`, danger: true };
  }
  if (sub.sub_status === "trial" && sub.valid_until) {
    if (sub.valid_until < today) return { text: `Your free trial has ended. You are now on the Free plan: up to ${sub.max_employees} employees, without payroll or face recognition. Open Plans to request an upgrade.`, danger: false };
    const days = Math.round((Date.parse(sub.valid_until) - Date.parse(today)) / 86_400_000);
    return { text: `Free trial of ${sub.plan_name}: ${days === 0 ? "ends today" : `${days} day${days === 1 ? "" : "s"} left`}.`, danger: false };
  }
  if (sub.active_employees >= sub.max_employees) return { text: `You have reached the ${sub.plan_name} plan limit of ${sub.max_employees} active employees. Upgrade to add more.`, danger: false };
  return null;
}

export function Layout() {
  const { session, employee, org, sub, isAdmin, isManager, isSupervisor, isPlatformAdmin, signOut } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const staff = !isSupervisor; // Owner and Admin have no attendance of their own
  const notice = subscriptionNotice(sub, isAdmin, org?.timezone ?? "Asia/Kolkata");

  const items = [
    { to: "/punch", label: "Attendance", icon: Fingerprint, show: staff },
    { to: "/visits", label: "Visits", icon: MapPinned, show: staff && employee?.staff_type === "field" },
    { to: "/history", label: "History", icon: CalendarClock, show: staff },
    { to: "/leave", label: "Leave", icon: Palmtree, show: staff },
    { to: "/wfh", label: "WFH", icon: House, show: staff },
    { to: "/payslips", label: "Payslips", icon: ReceiptText, show: staff },
    { to: "/my-items", label: "My items", icon: FolderOpen, show: staff && !isManager },
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: isManager },
    { to: "/approvals", label: "Approvals", icon: ClipboardCheck, show: isManager },
    { to: "/staff-checkin", label: "Check in staff", icon: UserCheck, show: isManager && !!org?.staff_checkin_enabled },
    { to: "/site-work", label: "Site work", icon: HardHat, show: isManager },
    { to: "/assets", label: "Assets", icon: FolderArchive, show: isManager },
    { to: "/muster", label: "Monthly sheet", icon: Table2, show: isManager },
    { to: "/reports", label: "Reports", icon: FileBarChart, show: isManager },
    { to: "/payroll", label: "Payroll", icon: IndianRupee, show: isAdmin },
    { to: "/employees", label: "Employees", icon: Users, show: isAdmin },
    { to: "/branches", label: "Branches", icon: Building2, show: isAdmin },
    { to: "/settings", label: "Settings", icon: SettingsIcon, show: isAdmin },
    { to: "/plans", label: "Plans", icon: CreditCard, show: isAdmin },
    { to: "/platform", label: "Platform", icon: Globe, show: isPlatformAdmin },
  ].filter((i) => i.show);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-4">
          <img src="/logo.png" alt="IWILL Attend" className="mb-1 h-9 w-auto" />
          <p className="truncate text-xs text-slate-500">{org?.name}</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`
              }
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="truncate px-3 text-sm font-medium">{employee?.full_name}</p>
          <p className="px-3 text-xs capitalize text-slate-500">{employee?.role}</p>
          <button onClick={() => setChangingPassword(true)} className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <KeyRound className="h-4 w-4" /> Change password
          </button>
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <p className="mt-2 px-3 text-[11px] text-slate-400">
            <Link to="/privacy" className="hover:underline">Privacy</Link> · <Link to="/terms" className="hover:underline">Terms</Link>
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="min-w-0">
          <img src="/logo.png" alt="IWILL Attend" className="h-7 w-auto" />
          <p className="truncate text-xs text-slate-500">{org?.name}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <button onClick={() => setChangingPassword(true)} aria-label="Change password" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <KeyRound className="h-5 w-5" />
          </button>
          <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {changingPassword && session?.user.email && <ChangePassword email={session.user.email} onClose={() => setChangingPassword(false)} />}

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-8">
        <div className="mx-auto max-w-6xl">
          {notice && (
            <p className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${notice.danger ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{notice.text}</p>
          )}
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white md:hidden">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-w-[4.5rem] flex-1 shrink-0 whitespace-nowrap flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium ${isActive ? "text-brand-600" : "text-slate-500"}`
            }
          >
            <Icon className="h-5 w-5" /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
