import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./index.css";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { ForgotPassword, Login, Onboarding, Signup } from "./pages/AuthPages";
import { Punch } from "./pages/Punch";
import { History } from "./pages/History";
import { Visits } from "./pages/Visits";
import { Dashboard } from "./pages/Dashboard";
import { Employees } from "./pages/Employees";
import { Branches } from "./pages/Branches";
import { Reports } from "./pages/Reports";
import { Leave } from "./pages/Leave";
import { Approvals } from "./pages/Approvals";
import { Muster } from "./pages/Muster";
import { Settings } from "./pages/Settings";
import { Payroll } from "./pages/Payroll";
import { Payslips } from "./pages/Payslips";
import { Landing } from "./pages/Landing";
import { Platform } from "./pages/Platform";
import { Plans } from "./pages/Plans";
import { Wfh } from "./pages/Wfh";
import { Privacy, Terms } from "./pages/Legal";
import { StaffCheckin } from "./pages/StaffCheckin";
import { SiteWork } from "./pages/SiteWork";
import { Assets } from "./pages/Assets";
import { MyItems } from "./pages/MyItems";

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/" replace />;
}

function App() {
  const { loading, session, employee, isAdmin, isManager, isSupervisor, isPlatformAdmin, signOut } = useAuth();
  const staff = !isSupervisor;
  const { pathname } = useLocation();

  // The legal pages open for everyone, signed in or not, and during company set-up.
  if (pathname === "/privacy") return <Privacy />;
  if (pathname === "/terms") return <Terms />;

  if (loading) return <Spinner />;

  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (!employee) {
    if (!isPlatformAdmin) return <Onboarding />;
    // Platform admin without a company: only the platform panel.
    return (
      <div className="min-h-full">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-8">
          <span className="flex items-center gap-3 text-sm font-semibold text-navy-900"><img src="/logo.png" alt="IWILL Attend" className="h-8 w-auto" /> Platform</span>
          <button onClick={signOut} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Sign out</button>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5 md:px-8">
          <Platform />
        </main>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/punch" element={<Guard allow={staff}><Punch /></Guard>} />
        <Route path="/history" element={<Guard allow={staff}><History /></Guard>} />
        <Route path="/leave" element={<Guard allow={staff}><Leave /></Guard>} />
        <Route path="/approvals" element={<Guard allow={isManager}><Approvals /></Guard>} />
        <Route path="/muster" element={<Guard allow={isManager}><Muster /></Guard>} />
        <Route path="/settings" element={<Guard allow={isAdmin}><Settings /></Guard>} />
        <Route path="/payslips" element={<Guard allow={staff}><Payslips /></Guard>} />
        <Route path="/wfh" element={<Guard allow={staff}><Wfh /></Guard>} />
        <Route path="/staff-checkin" element={<Guard allow={isManager}><StaffCheckin /></Guard>} />
        <Route path="/site-work" element={<Guard allow={isManager}><SiteWork /></Guard>} />
        <Route path="/assets" element={<Guard allow={isManager}><Assets /></Guard>} />
        <Route path="/my-items" element={<MyItems />} />
        <Route path="/plans" element={<Guard allow={isAdmin}><Plans /></Guard>} />
        <Route path="/platform" element={<Guard allow={isPlatformAdmin}><Platform /></Guard>} />
        <Route path="/payroll" element={<Guard allow={isAdmin}><Payroll /></Guard>} />
        <Route path="/visits" element={<Guard allow={staff && employee.staff_type === "field"}><Visits /></Guard>} />
        <Route path="/dashboard" element={<Guard allow={isManager}><Dashboard /></Guard>} />
        <Route path="/reports" element={<Guard allow={isManager}><Reports /></Guard>} />
        <Route path="/employees" element={<Guard allow={isAdmin}><Employees /></Guard>} />
        <Route path="/branches" element={<Guard allow={isAdmin}><Branches /></Guard>} />
        <Route path="*" element={<Navigate to={isManager ? "/dashboard" : "/punch"} replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
