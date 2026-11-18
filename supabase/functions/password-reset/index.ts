// Forgot password by email code (OTP), sent through Resend.
//
//   POST { action: "request", email }                  -> emails a 6-digit code
//   POST { action: "reset", email, code, password }    -> sets the new password
//
// The code is made here with a secure random generator and only a keyed hash of it
// is stored (private.password_reset_codes). It is valid for 10 minutes, works once,
// and 5 wrong tries cancel it. Limits: one code per 60 s and 5 per hour per email,
// 20 per hour per network address. A request for an unknown or deactivated email
// gets the same answer as a real one, so the page cannot reveal who is registered.
//
// Secrets: RESEND_API_KEY (set in Supabase > Edge Functions > Secrets).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.iwillattend.in",
  "https://iwillattend.in",
  "https://iwill-attend.iwillmediaofficial.workers.dev",
];
const FROM = "IWILL Attend <no-reply@iwillattend.in>";
const LOGO = "https://www.iwillattend.in/logo.png";

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

async function hashCode(email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${email.toLowerCase().trim()}:${code}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sixDigits(): string {
  // Rejection sampling keeps every code equally likely.
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, "0");
}

function emailHtml(code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0c2e52">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="padding:24px 28px 8px"><img src="${LOGO}" alt="IWILL Attend" height="40" style="display:block;height:40px"></td></tr>
<tr><td style="padding:8px 28px 0">
<h1 style="font-size:20px;margin:12px 0 8px">Your password reset code</h1>
<p style="font-size:15px;line-height:1.5;color:#334155;margin:0 0 20px">Enter this code in IWILL Attend to set a new password.</p>
<div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;background:#e0f5f4;color:#04837f;border-radius:10px;padding:16px 0">${code}</div>
<p style="font-size:14px;line-height:1.5;color:#334155;margin:20px 0 0">The code is valid for <b>10 minutes</b> and can be used once.</p>
<p style="font-size:13px;line-height:1.5;color:#64748b;margin:12px 0 24px">If you did not ask to reset your password, you can ignore this email. Your password stays the same. Never share this code with anyone.</p>
</td></tr>
<tr><td style="background:#0c2e52;color:#cbd5e1;font-size:12px;padding:14px 28px">IWILL Attend · www.iwillattend.in</td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { action?: string; email?: string; code?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) return json({ error: "Enter your email address." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (body.action === "request") {
      const code = sixDigits();
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
      const { data, error } = await admin.rpc("pw_reset_issue", { p_email: email, p_ip: ip, p_code_hash: await hashCode(email, code) });
      if (error) throw error;
      const r = data as { status: string; wait_seconds?: number };
      if (r.status === "invalid") return json({ error: "Enter a valid email address." }, 400);
      if (r.status === "wait") return json({ error: `Please wait ${r.wait_seconds} seconds before asking for another code.`, wait_seconds: r.wait_seconds }, 429);
      if (r.status === "limit") return json({ error: "Too many codes were requested. Please try again in an hour." }, 429);
      if (r.status === "sent") {
        const key = Deno.env.get("RESEND_API_KEY");
        if (!key) throw new Error("RESEND_API_KEY is not set");
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM,
            to: [email],
            subject: `${code} is your IWILL Attend password reset code`,
            html: emailHtml(code),
            text: `Your IWILL Attend password reset code is ${code}. It is valid for 10 minutes and can be used once. If you did not ask for it, ignore this email.`,
          }),
        });
        if (!res.ok) {
          console.error("Resend error", res.status, await res.text());
          return json({ error: "The email could not be sent right now. Please try again in a few minutes." }, 502);
        }
      }
      // Same answer whether or not the email has an account.
      return json({ ok: true });
    }

    if (body.action === "reset") {
      const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (code.length !== 6) return json({ error: "Enter the 6-digit code from the email." }, 400);
      if (password.length < 8 || password.length > 72) return json({ error: "The new password must be 8 to 72 characters." }, 400);

      const { data, error } = await admin.rpc("pw_reset_check", { p_email: email, p_code_hash: await hashCode(email, code) });
      if (error) throw error;
      const r = data as { status: string; id?: string; user_id?: string; tries_left?: number };
      if (r.status === "expired") return json({ error: "This code has expired or was already used. Ask for a new code.", expired: true }, 400);
      if (r.status === "locked") return json({ error: "Too many wrong tries. This code is cancelled; ask for a new one.", expired: true }, 400);
      if (r.status === "wrong") return json({ error: `That code is not right. ${r.tries_left} ${r.tries_left === 1 ? "try" : "tries"} left.` }, 400);

      const { error: upErr } = await admin.auth.admin.updateUserById(r.user_id!, { password });
      if (upErr) return json({ error: upErr.message }, 400); // e.g. password too weak; the code stays usable
      await admin.rpc("pw_reset_consume", { p_id: r.id });
      return json({ ok: true });
    }

    return json({ error: "Invalid request" }, 400);
  } catch (e) {
    console.error("password-reset failed", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
