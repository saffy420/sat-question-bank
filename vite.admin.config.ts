import { defineConfig } from "vite";

// Keep the existing role-gated /admin.js URL; inline CSS avoids a new asset route.
export default defineConfig({
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "public",
    emptyOutDir: false,
    lib: {
      entry: "admin-ui/index.tsx",
      formats: ["es"],
      fileName: () => "admin.js",
    },
    rollupOptions: { external: (id) => id.startsWith("/shared/") },
    minify: true,
  },
});
