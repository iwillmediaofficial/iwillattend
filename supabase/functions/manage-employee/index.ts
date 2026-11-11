// Admin-only employee management: creates a login for a new staff member,
// or resets an existing staff member's password. Runs with the service role,
// so every request is checked against the caller's own employee record first.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const ROLES = ["admin", "hr", "manager", "employee"];
const STAFF_TYPES = ["office", "field"];
const clean = (v: unknown, max = 160) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Not signed in" }, 401);

    const { data: caller } = await admin
      .from("employees")
      .select("id, org_id, role")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!caller || !["owner", "admin", "hr"].includes(caller.role)) {
      return json({ error: "Only an owner, admin or HR user can manage employees" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "create";

    if (action === "reset_password") {
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const { data: target } = await admin
        .from("employees")
        .select("id, user_id, role, org_id")
        .eq("id", body.employee_id ?? "")
        .eq("org_id", caller.org_id)
        .maybeSingle();
      if (!target || !target.user_id) return json({ error: "Employee not found" }, 404);
      if (target.role === "owner" && caller.role !== "owner") {
        return json({ error: "Only the owner can reset the owner's password" }, 403);
      }
      if (caller.role === "hr" && target.role === "admin") {
        return json({ error: "HR cannot reset an admin's password" }, 403);
      }
      const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action !== "create") return json({ error: "Unknown action" }, 400);

    const full_name = clean(body.full_name, 120);
    const email = clean(body.email, 200)?.toLowerCase() ?? null;
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role ?? "employee";
    const staff_type = body.staff_type ?? "office";
    const branch_id = clean(body.branch_id, 40);

    if (!full_name) return json({ error: "Full name is required" }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (!ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
    if (!STAFF_TYPES.includes(staff_type)) return json({ error: "Invalid staff type" }, 400);
    if (caller.role === "hr" && role === "admin") return json({ error: "HR cannot create admins" }, 403);

    if (branch_id) {
      const { data: branch } = await admin
        .from("branches").select("id").eq("id", branch_id).eq("org_id", caller.org_id).maybeSingle();
      if (!branch) return json({ error: "Branch not found" }, 400);
    }
    if (staff_type === "office" && !branch_id) {
      return json({ error: "Office staff need a branch" }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created.user) {
      const msg = /already/i.test(createErr?.message ?? "")
        ? "A login with this email already exists"
        : createErr?.message ?? "Could not create login";
      return json({ error: msg }, 400);
    }

    const { data: employee, error: insertErr } = await admin
      .from("employees")
      .insert({
        org_id: caller.org_id,
        user_id: created.user.id,
        full_name,
        email,
        role,
        staff_type,
        branch_id,
        emp_code: clean(body.emp_code, 40),
        phone: clean(body.phone, 30),
        designation: clean(body.designation, 80),
        department: clean(body.department, 80),
      })
      .select()
      .single();

    if (insertErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      const msg = insertErr.code === "23505" ? "Employee code or email already used in this organisation" : insertErr.message;
      return json({ error: msg }, 400);
    }
    return json({ employee });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
