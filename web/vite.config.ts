import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the panel from a project subpath.
  base: "/mcksp-admin/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: true },
});
