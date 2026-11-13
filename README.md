# IWILL Attend

Selfie and location based attendance, with leave, shifts, field visits and India payroll.

## Parts

| Part | Where it runs | Folder |
|---|---|---|
| Website (React + Vite) | Cloudflare Worker `iwill-attend` | `src/`, `public/` |
| Database, logins, rules | Supabase | `supabase/migrations/` |
| Selfie storage | Cloudflare Worker `iwill-attend-media` + R2 bucket `iwill-attend-selfies` | `media-worker/` |

## Run locally

Copy `.env.example` to `.env.local` and fill it in, then:

- `npm install`
- `npm run dev` for this PC (http://localhost:5173)
- `npm run dev:mobile` for phones on the same Wi-Fi (HTTPS, port 5174)

## Deploy

- **Website:** every push to `main` is built and deployed by Cloudflare (`npm run build`, then `npx wrangler deploy`). The live build reads `.env.production`.
- **Selfie Worker:** deployed by hand with `npx wrangler deploy --cwd media-worker`. Its secrets (`SUPABASE_KEY`, `MEDIA_SECRET`) are set in Cloudflare, never in this repo.
- **Database:** run new files in `supabase/migrations/` in order.
