import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  base: "/cd",
  plugins: [tailwindcss(), react()],
  server: {
    allowedHosts: ["5023-171-235-176-49.ngrok-free.app"],
  },
});
