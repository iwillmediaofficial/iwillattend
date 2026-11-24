// IWILL Attend service worker: makes the site installable and quicker to open.
//
// It keeps only the app's own files on the device. It never stores attendance, selfies,
// documents or sign-in data: anything from Supabase or the media Worker (other addresses)
// and any non-GET request goes straight to the network, untouched.
//
//   Pages            network first, so a new version is used as soon as it is deployed;
//                    the last copy (or an offline notice) only when there is no internet.
//   /assets/*        file names change with every build, so a stored copy is always right.
//   icons, models    stored copy first, refreshed in the background.

const VERSION = "v1";
const SHELL = `iwill-shell-${VERSION}`;
const STATIC = `iwill-static-${VERSION}`;

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · IWILL Attend</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f8fafc;color:#0c2e52;text-align:center;padding:24px}
img{width:72px;height:72px;border-radius:16px}h1{font-size:20px;margin:16px 0 8px}p{color:#475569;margin:0 0 20px}
button{background:#04837f;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600}</style></head>
<body><div><img src="/icon-192.png" alt=""><h1>You're offline</h1><p>IWILL Attend needs internet to check in and load your data.<br>Connect to Wi-Fi or mobile data and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(["/", "/icon-192.png", "/icon-512.png", "/logo.png", "/manifest.webmanifest"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("iwill-") && k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, media Worker, maps: never touched
  if (url.pathname.startsWith("/.well-known/") || url.pathname === "/sw.js") return;

  // Pages (the app is one page): network first, stored copy only when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(async () => (await caches.match("/")) || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
    );
    return;
  }

  // Built files have a unique name per version: a stored copy is always correct.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Icons, logo, face-check models and other public files: stored copy first, refreshed in the background.
  if (/\.(png|jpg|svg|webmanifest|json|bin|ico)$/.test(url.pathname) || url.pathname.startsWith("/models/")) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    );
  }
});
