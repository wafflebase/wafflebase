import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");

  if (
    normalizedId.includes("node_modules/react") ||
    normalizedId.includes("node_modules/react-dom") ||
    normalizedId.includes("node_modules/scheduler")
  ) {
    return "vendor-react";
  }

  if (
    normalizedId.includes("node_modules/@radix-ui") ||
    normalizedId.includes("node_modules/lucide-react") ||
    normalizedId.includes("node_modules/sonner") ||
    normalizedId.includes("node_modules/vaul")
  ) {
    return "vendor-ui";
  }

  if (
    normalizedId.includes("node_modules/@tanstack") ||
    normalizedId.includes("node_modules/react-router")
  ) {
    return "vendor-app";
  }

  if (normalizedId.includes("node_modules/@yorkie-js")) {
    return "vendor-yorkie";
  }

  if (
    normalizedId.includes("node_modules/antlr4ts") ||
    normalizedId.includes("/packages/sheet/antlr/") ||
    normalizedId.includes("/packages/sheet/src/formula/")
  ) {
    return "sheet-formula";
  }

  if (
    normalizedId.includes("/packages/sheet/src/view/") ||
    normalizedId.includes("/packages/sheet/src/model/") ||
    normalizedId.includes("/packages/sheet/src/store/")
  ) {
    return "sheet-core";
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    "process.env": {},
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
