// IWILL Attend media Worker: stores and serves selfies in a private R2 bucket.
//
// The browser never talks to R2 directly. It sends the signed-in user's Supabase
// token here; the Worker asks the database whether that user may write or read the
// path, and only then touches the bucket. After an upload it tells the database
// about the file, signed with MEDIA_SECRET so nobody else can make that claim.
//
// Bindings: SELFIES (R2 bucket), SUPABASE_URL, SUPABASE_KEY (publishable key),
// MEDIA_SECRET (same value as private.app_secrets 'media_secret' in the database).

const PATH = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[\w-]{1,120}\.jpg$/;
const MAX_BYTES = 1024 * 1024;

const CORS = {
  // Access is by bearer token, never cookies, so any origin may call.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const reply = (status, message) =>
  new Response(JSON.stringify({ message }), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function rpc(env, auth, fn, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_KEY, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // An empty body (204) is a success with nothing to read.
  }
  return { ok: res.ok, status: res.status, data };
}

async function sign(secret, path, size) {
  const bytes = new TextEncoder().encode(`${secret}:${path}:${size}:${secret}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function allowed(env, auth, path, write) {
  const r = await rpc(env, auth, "selfie_access", { p_path: path, p_write: write });
  if (r.status === 401) return reply(401, "Your session has expired. Sign in again.");
  if (!r.ok || r.data !== true) return reply(403, "You are not allowed to access this selfie.");
  return null;
}

async function upload(req, env, auth, path) {
  if ((req.headers.get("Content-Type") ?? "").split(";")[0].trim() !== "image/jpeg") return reply(415, "Only JPEG selfies are accepted.");
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BYTES) return reply(413, "The selfie is larger than 1 MB.");

  const denied = await allowed(env, auth, path, true);
  if (denied) return denied;

  const body = await req.arrayBuffer();
  const head = new Uint8Array(body, 0, Math.min(2, body.byteLength));
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return reply(413, "The selfie must be between 1 byte and 1 MB.");
  if (head[0] !== 0xff || head[1] !== 0xd8) return reply(415, "That file is not a JPEG image.");
  if (await env.SELFIES.head(path)) return reply(409, "A selfie with this name already exists.");

  await env.SELFIES.put(path, body, { httpMetadata: { contentType: "image/jpeg" } });
  const reg = await rpc(env, auth, "register_selfie", {
    p_path: path,
    p_size: body.byteLength,
    p_sig: await sign(env.MEDIA_SECRET, path, body.byteLength),
  });
  if (!reg.ok) {
    await env.SELFIES.delete(path);
    return reply(502, reg.data?.message ?? "The selfie could not be recorded. Try again.");
  }
  return new Response(JSON.stringify({ path }), { status: 201, headers: { "Content-Type": "application/json", ...CORS } });
}

async function download(env, auth, path) {
  const denied = await allowed(env, auth, path, false);
  if (denied) return denied;
  const obj = await env.SELFIES.get(path);
  if (!obj) return reply(404, "Selfie not found.");
  return new Response(obj.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", ETag: obj.httpEtag, ...CORS },
  });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
      if (!PATH.test(path)) return reply(404, "Not found.");
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth.startsWith("Bearer ")) return reply(401, "Sign in to continue.");
      if (req.method === "PUT") return await upload(req, env, auth, path);
      if (req.method === "GET") return await download(env, auth, path);
      return reply(405, "Method not allowed.");
    } catch {
      return reply(500, "The media service had a problem. Try again.");
    }
  },
};
