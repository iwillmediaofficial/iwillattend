// IWILL Attend media Worker: stores and serves private files in R2.
//
// Two kinds of file:
//   Selfies    <org>/<employee>/<name>.jpg              JPEG, up to 1 MB
//   Documents  docs/<org>/<item>/<uuid>.<pdf|jpg|png>   PDF, JPEG or PNG, up to 10 MB
//
// The browser never talks to R2 directly. It sends the signed-in user's Supabase
// token here; the Worker asks the database whether that user may write, read or
// delete the path, and only then touches the bucket. After an upload or delete it
// tells the database, signed with MEDIA_SECRET so nobody else can make that claim.
//
// Bindings: SELFIES (R2 bucket), SUPABASE_URL, SUPABASE_KEY (publishable key),
// MEDIA_SECRET (same value as private.app_secrets 'media_secret' in the database).

const UUID = "[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const SELFIE_PATH = new RegExp(`^${UUID}\\/${UUID}\\/[\\w-]{1,120}\\.jpg$`);
const DOC_PATH = new RegExp(`^docs\\/${UUID}\\/${UUID}\\/${UUID}\\.(pdf|jpg|png)$`);
const MB = 1024 * 1024;

const KINDS = {
  selfie: { max: MB, types: { jpg: "image/jpeg" }, accessFn: "selfie_access", registerFn: "register_selfie" },
  doc: { max: 10 * MB, types: { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" }, accessFn: "doc_access", registerFn: "register_doc_upload" },
};

const CORS = {
  // Access is by bearer token, never cookies, so any origin may call.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
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

// Asks the database whether this user may act on the path. Returns a Response when refused.
async function allowed(env, auth, kind, path, action, size = 0) {
  const body = kind === "selfie" ? { p_path: path, p_write: action === "write" } : { p_path: path, p_action: action, p_size: size };
  const r = await rpc(env, auth, KINDS[kind].accessFn, body);
  if (r.status === 401) return reply(401, "Your session has expired. Sign in again.");
  if (!r.ok) return reply(r.status === 400 && r.data?.message ? 413 : 403, r.data?.message ?? "You are not allowed to access this file.");
  if (r.data !== true) return reply(403, "You are not allowed to access this file.");
  return null;
}

function looksLike(ext, bytes) {
  if (ext === "jpg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (ext === "png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (ext === "pdf") return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  return false;
}

async function upload(req, env, auth, kind, path) {
  const ext = path.split(".").pop();
  const mime = KINDS[kind].types[ext];
  const limit = KINDS[kind].max;
  const sentType = (req.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (!mime || sentType !== mime) return reply(415, kind === "selfie" ? "Only JPEG selfies are accepted." : "Only PDF, JPG and PNG files are accepted.");
  const declared = Number(req.headers.get("Content-Length") ?? 0);
  if (declared > limit) return reply(413, `The file is larger than ${limit / MB} MB.`);

  const denied = await allowed(env, auth, kind, path, "write", declared);
  if (denied) return denied;

  const body = await req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > limit) return reply(413, `The file must be between 1 byte and ${limit / MB} MB.`);
  if (!looksLike(ext, new Uint8Array(body, 0, Math.min(4, body.byteLength)))) return reply(415, "The file content does not match its type.");
  if (await env.SELFIES.head(path)) return reply(409, "A file with this name already exists.");

  await env.SELFIES.put(path, body, { httpMetadata: { contentType: mime } });
  const sig = await sign(env.MEDIA_SECRET, path, body.byteLength);
  const reg = kind === "selfie"
    ? await rpc(env, auth, "register_selfie", { p_path: path, p_size: body.byteLength, p_sig: sig })
    : await rpc(env, auth, "register_doc_upload", { p_path: path, p_size: body.byteLength, p_mime: mime, p_sig: sig });
  if (!reg.ok) {
    await env.SELFIES.delete(path);
    return reply(reg.status === 400 ? 413 : 502, reg.data?.message ?? "The file could not be recorded. Try again.");
  }
  return new Response(JSON.stringify({ path, size: body.byteLength, mime }), { status: 201, headers: { "Content-Type": "application/json", ...CORS } });
}

async function download(env, auth, kind, path) {
  const denied = await allowed(env, auth, kind, path, "read");
  if (denied) return denied;
  const obj = await env.SELFIES.get(path);
  if (!obj) return reply(404, "File not found.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      ETag: obj.httpEtag,
      ...CORS,
    },
  });
}

// Documents only: selfies are never deleted through the Worker.
async function remove(env, auth, path) {
  const denied = await allowed(env, auth, "doc", path, "delete");
  if (denied) return denied;
  await env.SELFIES.delete(path);
  const r = await rpc(env, auth, "forget_doc_upload", { p_path: path, p_sig: await sign(env.MEDIA_SECRET, path, "delete") });
  if (!r.ok) return reply(502, r.data?.message ?? "The file was removed but could not be forgotten. Try again.");
  return new Response(null, { status: 204, headers: CORS });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const kind = SELFIE_PATH.test(path) ? "selfie" : DOC_PATH.test(path) ? "doc" : null;
      if (!kind) return reply(404, "Not found.");
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth.startsWith("Bearer ")) return reply(401, "Sign in to continue.");
      if (req.method === "PUT") return await upload(req, env, auth, kind, path);
      if (req.method === "GET") return await download(env, auth, kind, path);
      if (req.method === "DELETE" && kind === "doc") return await remove(env, auth, path);
      return reply(405, "Method not allowed.");
    } catch {
      return reply(500, "The media service had a problem. Try again.");
    }
  },
};
