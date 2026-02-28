import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const utilShimPath = path.resolve(__dirname, "./src/lib/util-shim.js");
const assertShimPath = path.resolve(__dirname, "./src/lib/assert-shim.js");

/**
 * Vite plugin that resolves `require("assert")` in antlr4ts to our
 * lightweight ESM shim during dev mode. Without this, antlr4ts loads
 * the CJS assert@2.x polyfill whose CJS-to-ESM interop breaks, making
 * `assert` a non-callable namespace object instead of a function.
 */
function antlr4tsAssertShim(): Plugin {
  return {
    name: "antlr4ts-assert-shim",
    enforce: "pre",
    resolveId(source, importer) {
      // When antlr4ts (or its submodules) tries to resolve "assert",
      // redirect to our shim instead of the assert@2.x CJS polyfill.
      if (source === "assert" && importer && importer.includes("antlr4ts")) {
        return assertShimPath;
      }
    },
  };
}

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
    normalizedId.includes("/packages/sheet/antlr/")
  ) {
    return "sheet-formula-parser";
  }

  if (normalizedId.includes("/packages/sheet/src/formula/")) {
    return "sheet-formula-eval";
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
  plugins: [antlr4tsAssertShim(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      util: utilShimPath,
      assert: assertShimPath,
    },
  },
  define: {
    "process.env": {},
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: "node-shims",
          setup(build) {
            // Intercept Node.js built-in imports during dep
            // pre-bundling so antlr4ts gets our lightweight shims.
            build.onResolve({ filter: /^util(\/)?$/ }, () => ({
              path: utilShimPath,
            }));
            build.onResolve({ filter: /^assert$/ }, () => ({
              path: assertShimPath,
            }));
          },
        },
      ],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
