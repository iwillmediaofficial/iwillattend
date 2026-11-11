import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev`        -> http://localhost:5173 (this PC only)
// `npm run dev:mobile` -> https://<PC Wi-Fi IP>:5174 for phones on the same Wi-Fi.
// Phones only allow camera and GPS over HTTPS, so mobile mode uses a self-signed certificate.
export default defineConfig(({ mode }) => {
  const mobile = mode === "mobile";
  return {
    plugins: [react(), tailwindcss(), ...(mobile ? [basicSsl()] : [])],
    server: mobile ? { host: true, port: 5174, strictPort: true } : { port: 5173, strictPort: true },
  };
});
