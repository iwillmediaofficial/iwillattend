import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Pencil, Plus, ScanFace } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Branch, Employee, Role, Shift, StaffType } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorText, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { errMsg } from "../lib/utils";

interface Form {
  id?: string;
  full_name: string;
  email: string;
  password: string;
  emp_code: string;
  phone: string;
  designation: string;
  department: string;
  role: Role;
  staff_type: StaffType;
  branch_id: string;
  shift_id: string;
  joined_on: string;
  exit_on: string;
  is_active: boolean;
}

const blank: Form = {
  full_name: "", email: "", password: "", emp_code: "", phone: "", designation: "", department: "",
  role: "employee", staff_type: "office", branch_id: "", shift_id: "", joined_on: "", exit_on: "", is_active: true,
};

/** Calls the manage-employee function and surfaces its error message. */
async function callManage(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-employee", { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = await ctx.json().catch(() => null);
      if (j?.error) msg = j.error;
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function Employees() {
  const { employee: me } = useAuth();
  const [rows, setRows] = useState<Employee[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [reset, setReset] = useState<Employee | null>(null);
  const [newPass, setNewPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [e, b, s] = await Promise.all([
      supabase.from("employees").select("*").order("full_name"),
      supabase.from("branches").select("*").eq("is_active", true).order("name"),
      supabase.from("shifts").select("*").eq("is_active", true).order("name"),
    ]);
    setShifts((s.data as Shift[]) ?? []);
    setRows((e.data as Employee[]) ?? []);
    setBranches((b.data as Branch[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";
  const canAssignRoles = me!.role === "owner" || me!.role === "admin";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (form.staff_type === "office" && !form.branch_id) {
      setError("Office staff need a branch. Add a branch first, or choose Field staff.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const common = {
        full_name: form.full_name.trim(),
        emp_code: form.emp_code.trim() || null,
        phone: form.phone.trim() || null,
        designation: form.designation.trim() || null,
        department: form.department.trim() || null,
        staff_type: form.staff_type,
        branch_id: form.branch_id || null,
      };
      const extra: Record<string, unknown> = { shift_id: form.shift_id || null };
      if (form.joined_on) extra.joined_on = form.joined_on;
      if (form.id) {
        const isOwnerRow = form.role === "owner";
        if (!form.is_active && !form.exit_on) throw new Error("Enter the last working day so the final month is paid correctly.");
        const patch: Record<string, unknown> = { ...common, ...extra, is_active: form.is_active, exit_on: form.is_active ? null : form.exit_on };
        if (canAssignRoles && !isOwnerRow && form.id !== me!.id) patch.role = form.role;
        const { error } = await supabase.from("employees").update(patch).eq("id", form.id);
        if (error) throw error;
      } else {
        const res = await callManage({ action: "create", ...common, email: form.email.trim(), password: form.password, role: form.role });
        const { error } = await supabase.from("employees").update(extra).eq("id", res.employee.id);
        if (error) throw error;
      }
      setForm(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };

  const doReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!reset) return;
    setBusy(true);
    setError("");
    try {
      await callManage({ action: "reset_password", employee_id: reset.id, password: newPass });
      setReset(null);
      setNewPass("");
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };

  const resetFace = async (r: Employee) => {
    if (!window.confirm(`Delete the registered face of ${r.full_name}? They will have to register again before their next check-in.`)) return;
    const { error } = await supabase.rpc("reset_face", { p_employee: r.id });
    if (error) window.alert(error.message);
    await load();
  };

  const edit = (r: Employee) => {
    setError("");
    setForm({
      id: r.id, full_name: r.full_name, email: r.email, password: "", emp_code: r.emp_code ?? "", phone: r.phone ?? "",
      designation: r.designation ?? "", department: r.department ?? "", role: r.role, staff_type: r.staff_type,
      branch_id: r.branch_id ?? "", shift_id: r.shift_id ?? "", joined_on: r.joined_on, exit_on: r.exit_on ?? "", is_active: r.is_active,
    });
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => f && { ...f, [k]: v });

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Create staff logins and assign branches"
        action={
          <Button onClick={() => { setError(""); setForm(blank); }}>
            <Plus className="h-4 w-4" /> Add employee
          </Button>
        }
      />
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No employees yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{r.full_name}</p>
                      <p className="text-xs text-slate-500">{r.email}</p>
                    </td>
                    <td className="px-4 py-2">{r.emp_code ?? "—"}</td>
                    <td className="px-4 py-2 capitalize">{r.role}</td>
                    <td className="px-4 py-2 capitalize">{r.staff_type}</td>
                    <td className="px-4 py-2">{branchName(r.branch_id)}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex flex-wrap gap-1">
                        {r.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}
                        {r.face_enrolled_at ? <Badge tone="indigo">Face registered</Badge> : <Badge>No face</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" onClick={() => edit(r)} aria-label={`Edit ${r.full_name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {r.face_enrolled_at && (
                        <Button variant="ghost" onClick={() => resetFace(r)} aria-label={`Reset registered face for ${r.full_name}`} title="Reset registered face">
                          <ScanFace className="h-4 w-4" />
                        </Button>
                      )}
                      {r.id !== me!.id && (
                        <Button variant="ghost" onClick={() => { setError(""); setNewPass(""); setReset(r); }} aria-label={`Reset password for ${r.full_name}`}>
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form && (
        <Modal title={form.id ? "Edit employee" : "Add employee"} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-4">
            <Input label="Full name" required maxLength={120} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
            {form.id ? (
              <Input label="Login email" value={form.email} disabled />
            ) : (
              <>
                <Input label="Login email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
                <Input label="Initial password" type="text" required minLength={8} autoComplete="off" hint="At least 8 characters. Share it with the employee." value={form.password} onChange={(e) => set("password", e.target.value)} />
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Employee code" value={form.emp_code} onChange={(e) => set("emp_code", e.target.value)} />
              <Input label="Phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              <Input label="Designation" value={form.designation} onChange={(e) => set("designation", e.target.value)} />
              <Input label="Department" value={form.department} onChange={(e) => set("department", e.target.value)} />
              <Select label="Staff type" value={form.staff_type} onChange={(e) => set("staff_type", e.target.value as StaffType)}>
                <option value="office">Office (geofenced)</option>
                <option value="field">Field (any location)</option>
              </Select>
              {form.role === "owner" ? (
                <Input label="Role" value="Owner" disabled />
              ) : (
                <Select label="Role" value={form.role} disabled={!!form.id && (!canAssignRoles || form.id === me!.id)} onChange={(e) => set("role", e.target.value as Role)}>
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="hr">HR</option>
                  {canAssignRoles && <option value="admin">Admin</option>}
                </Select>
              )}
            </div>
            <Select label="Branch" value={form.branch_id} onChange={(e) => set("branch_id", e.target.value)} hint={form.staff_type === "office" ? "Required for office staff." : "Optional for field staff."}>
              <option value="">No branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Shift" value={form.shift_id} onChange={(e) => set("shift_id", e.target.value)}>
                <option value="">Company default</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.start_time.slice(0, 5)})
                  </option>
                ))}
              </Select>
              <Input label="Joining date" type="date" value={form.joined_on} hint={form.id ? undefined : "Blank means today."} onChange={(e) => set("joined_on", e.target.value)} />
            </div>
            {form.id && form.id !== me!.id && form.role !== "owner" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} /> Active (can sign in and mark attendance)
              </label>
            )}
            {form.id && !form.is_active && (
              <Input label="Last working day" type="date" required value={form.exit_on} onChange={(e) => set("exit_on", e.target.value)} hint="Attendance and pay are counted up to this date." />
            )}
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>
              {form.id ? "Save changes" : "Create employee"}
            </Button>
          </form>
        </Modal>
      )}

      {reset && (
        <Modal title={`Reset password: ${reset.full_name}`} onClose={() => setReset(null)}>
          <form onSubmit={doReset} className="space-y-4">
            <Input label="New password" type="text" required minLength={8} autoComplete="off" hint="At least 8 characters." value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>
              Set new password
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
