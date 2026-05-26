import { readFileSync } from "fs";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin, type Connect } from "vite";
import { defineConfig } from "vitest/config";

const utilShimPath = path.resolve(__dirname, "./src/lib/util-shim.js");
const assertShimPath = path.resolve(__dirname, "./src/lib/assert-shim.cjs");

// Root package.json is the single source of truth for the version
// surfaced on the homepage. Read at config-eval time and inject as a
// build-time constant so the hero eyebrow and demo footer always
// match the shipped package.
const rootPkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
) as { version: string };

/**
 * Replaces the `<!--GA_SNIPPET-->` marker in index.html with the GA4
 * gtag.js bootstrap when `VITE_GA_ID` is set for the current mode.
 * When unset (dev, preview without a configured ID), the marker is
 * stripped so no script tag is emitted and no requests are made.
 */
function gaSnippet(): Plugin {
  let snippet = "";
  return {
    name: "ga-snippet",
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), "VITE_");
      const id = env.VITE_GA_ID;
      if (!id) return;
      snippet =
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n` +
        `    <script>\n` +
        `      window.dataLayer = window.dataLayer || [];\n` +
        `      function gtag(){dataLayer.push(arguments);}\n` +
        `      gtag('js', new Date());\n` +
        `      gtag('config', '${id}', { send_page_view: false });\n` +
        `    </script>`;
    },
    transformIndexHtml(html) {
      return html.replace("<!--GA_SNIPPET-->", snippet);
    },
  };
}

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
    normalizedId.includes("/packages/sheets/antlr/")
  ) {
    return "sheet-formula-parser";
  }

  if (normalizedId.includes("/packages/sheets/src/formula/")) {
    return "sheet-formula-eval";
  }

  if (
    normalizedId.includes("/packages/sheets/src/view/") ||
    normalizedId.includes("/packages/sheets/src/model/") ||
    normalizedId.includes("/packages/sheets/src/store/")
  ) {
    return "sheet-core";
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    gaSnippet(),
    antlr4tsAssertShim(),
    react(),
    tailwindcss(),
    {
      name: "docs-trailing-slash",
      configureServer(server) {
        server.middlewares.use(((req, res, next) => {
          if (req.url === "/docs") {
            res.writeHead(302, { Location: "/docs/" });
            res.end();
            return;
          }
          next();
        }) as Connect.NextHandleFunction);
      },
    },
  ],
  server: {
    proxy: {
      "/docs": {
        target: "http://localhost:5174",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@wafflebase/sheets": path.resolve(__dirname, "../sheets/src/index.ts"),
      "@wafflebase/docs": path.resolve(__dirname, "../docs/src/index.ts"),
      "@wafflebase/slides": path.resolve(__dirname, "../slides/src/index.ts"),
      util: utilShimPath,
      assert: assertShimPath,
    },
  },
  define: {
    "process.env": {},
    __APP_VERSION__: JSON.stringify(rootPkg.version),
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
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
