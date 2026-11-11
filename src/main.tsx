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

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/punch" replace />;
}

function App() {
  const { loading, session, employee, isAdmin, isManager } = useAuth();

  if (loading) return <Spinner />;

  if (!session) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (!employee) return <Onboarding />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/punch" element={<Punch />} />
        <Route path="/history" element={<History />} />
        <Route path="/leave" element={<Leave />} />
        <Route path="/approvals" element={<Guard allow={isManager}><Approvals /></Guard>} />
        <Route path="/muster" element={<Guard allow={isManager}><Muster /></Guard>} />
        <Route path="/settings" element={<Guard allow={isAdmin}><Settings /></Guard>} />
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
