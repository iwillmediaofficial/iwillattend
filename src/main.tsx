import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./index.css";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { Login, Onboarding, Signup } from "./pages/AuthPages";
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

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/punch" replace />;
}

function App() {
  const { loading, session, employee, isAdmin, isManager, isPlatformAdmin, signOut } = useAuth();

  if (loading) return <Spinner />;

  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
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
          <span className="text-sm font-semibold text-indigo-600">IWILL Attend · Platform</span>
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
        <Route path="/punch" element={<Punch />} />
        <Route path="/history" element={<History />} />
        <Route path="/leave" element={<Leave />} />
        <Route path="/approvals" element={<Guard allow={isManager}><Approvals /></Guard>} />
        <Route path="/muster" element={<Guard allow={isManager}><Muster /></Guard>} />
        <Route path="/settings" element={<Guard allow={isAdmin}><Settings /></Guard>} />
        <Route path="/payslips" element={<Payslips />} />
        <Route path="/platform" element={<Guard allow={isPlatformAdmin}><Platform /></Guard>} />
        <Route path="/payroll" element={<Guard allow={isAdmin}><Payroll /></Guard>} />
        <Route path="/visits" element={<Guard allow={employee.staff_type === "field"}><Visits /></Guard>} />
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
