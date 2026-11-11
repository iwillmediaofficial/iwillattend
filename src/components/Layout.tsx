import { NavLink, Outlet } from "react-router-dom";
import { Building2, CalendarClock, ClipboardCheck, FileBarChart, Fingerprint, LayoutDashboard, LogOut, MapPinned, Palmtree, Settings as SettingsIcon, Table2, Users } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { employee, org, isAdmin, isManager, signOut } = useAuth();

  const items = [
    { to: "/punch", label: "Attendance", icon: Fingerprint, show: true },
    { to: "/visits", label: "Visits", icon: MapPinned, show: employee?.staff_type === "field" },
    { to: "/history", label: "History", icon: CalendarClock, show: true },
    { to: "/leave", label: "Leave", icon: Palmtree, show: true },
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: isManager },
    { to: "/approvals", label: "Approvals", icon: ClipboardCheck, show: isManager },
    { to: "/muster", label: "Monthly sheet", icon: Table2, show: isManager },
    { to: "/reports", label: "Reports", icon: FileBarChart, show: isManager },
    { to: "/employees", label: "Employees", icon: Users, show: isAdmin },
    { to: "/branches", label: "Branches", icon: Building2, show: isAdmin },
    { to: "/settings", label: "Settings", icon: SettingsIcon, show: isAdmin },
  ].filter((i) => i.show);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-base font-semibold text-indigo-600">IWILL Attend</p>
          <p className="truncate text-xs text-slate-500">{org?.name}</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`
              }
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="truncate px-3 text-sm font-medium">{employee?.full_name}</p>
          <p className="px-3 text-xs capitalize text-slate-500">{employee?.role}</p>
          <button onClick={signOut} className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-indigo-600">IWILL Attend</p>
          <p className="truncate text-xs text-slate-500">{org?.name}</p>
        </div>
        <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-8">
        <div className="mx-auto max-w-6xl">
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
              `flex min-w-[4.5rem] flex-1 shrink-0 whitespace-nowrap flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium ${isActive ? "text-indigo-600" : "text-slate-500"}`
            }
          >
            <Icon className="h-5 w-5" /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
