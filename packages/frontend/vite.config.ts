import {
  cpSync,
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from "fs";
import { createRequire } from "module";
import path from "path";
// Imported by relative path, not as `@wafflebase/debug-report/plugin`, and
// that is load-bearing. Vite's config bundler externalizes every bare
// specifier — it resolves the id to an absolute path and marks it external —
// so a bare import here would hand `src/plugin/index.ts` to Node itself.
// Node can only load TypeScript from 22.18, where type stripping became the
// default, which silently made 22.14-22.17 unable to run `pnpm dev`,
// `frontend:test` or `frontend:build` at all. A relative specifier is bundled
// by esbuild instead, so any Node 22 works.
import { debugReportPlugin } from "../debug-report/src/plugin/index.ts";
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

/**
 * Serves pdf.js's `cmaps/` and `standard_fonts/` assets at stable URLs
 * (`/pdfjs/cmaps/…`, `/pdfjs/standard_fonts/…`) in dev, and copies them into
 * the build output. The PDF viewer passes these as `cMapUrl` /
 * `standardFontDataUrl` to `getDocument()`; without them, CID-keyed fonts
 * (e.g. CJK PDFs) render blank and non-embedded standard fonts fall back
 * incorrectly. Resolved from the installed `pdfjs-dist` so the assets always
 * match the pinned version (no committed binaries).
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(path.join(__dirname, "vite.config.ts"));
  const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const mounts: Array<{ prefix: string; dir: string; out: string }> = [
    { prefix: "/pdfjs/cmaps/", dir: path.join(pdfjsDir, "cmaps"), out: "pdfjs/cmaps" },
    {
      prefix: "/pdfjs/standard_fonts/",
      dir: path.join(pdfjsDir, "standard_fonts"),
      out: "pdfjs/standard_fonts",
    },
  ];
  let outDir = path.resolve(__dirname, "dist");
  return {
    name: "pdfjs-assets",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const mount = mounts.find((m) => url.startsWith(m.prefix));
        if (!mount) return next();
        const file = path.join(mount.dir, url.slice(mount.prefix.length));
        // Require a regular file strictly inside the mount directory. The
        // trailing path.sep blocks `..` traversal and sibling dirs sharing the
        // prefix (…/cmaps_evil); isFile() rejects directory reads such as the
        // mount root itself, which would otherwise EISDIR the stream and hang
        // the request (an unhandled stream error can also take down the dev
        // server).
        const stat =
          file.startsWith(mount.dir + path.sep) && existsSync(file)
            ? statSync(file)
            : null;
        if (!stat || !stat.isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(stat.size));
        const stream = createReadStream(file);
        stream.on("error", () => {
          res.statusCode = 500;
          res.end();
        });
        stream.pipe(res);
      }) as Connect.NextHandleFunction);
    },
    writeBundle() {
      for (const m of mounts) {
        cpSync(m.dir, path.join(outDir, m.out), { recursive: true });
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

  // Split BEFORE the `vendor-ui` catch-all below. `alert-dialog` and
  // `scroll-area` have exactly one consumer in the app — the version-history
  // panel (`ui/alert-dialog.tsx` / `ui/scroll-area.tsx` are imported nowhere
  // else) — which is code-split via `LazyHistoryPanel` (see
  // `history-panel-lazy.tsx`). Left in `vendor-ui` they ship on every route
  // regardless, because `vendor-ui` also holds the Radix primitives the
  // shell uses eagerly (sidebar, dialog, tooltip, toggle), so making the
  // panel lazy moved only the panel's own ~7 kB and none of these bytes.
  // Measured: with the panel lazy but this split absent, `vendor-ui` was
  // byte-identical to the statically-imported build.
  if (
    normalizedId.includes("node_modules/@radix-ui/react-alert-dialog") ||
    normalizedId.includes("node_modules/@radix-ui/react-scroll-area")
  ) {
    return "vendor-ui-history";
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

  // Parquet decoding is only reachable from the lazy sheet import surface.
  // Keep its reader and codecs in the existing sheet core chunk instead of
  // emitting one chunk per dynamic import.
  if (
    normalizedId.includes("node_modules/hyparquet") ||
    normalizedId.includes("node_modules/fzstd") ||
    normalizedId.includes("node_modules/hysnappy")
  ) {
    return "sheet-core";
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

  // The revision-history preview surface (`revision-preview.tsx`) mounts
  // whichever engine a previewed revision needs, so it is a new
  // separately-lazy-loaded importer of two previously more-narrowly-
  // reached engine bundles. An actual before/after build diff (git
  // 76187ca32, before this feature, vs. the commit that added
  // `revision-preview.tsx`; see harness.config.json's
  // `maxChunkCountRevisionPreviewReason` for the numbers) confirms both
  // chunks below appear only after that change — Rollup's exact hoist
  // heuristic is not asserted here beyond that measured fact, since
  // `slides-view.tsx`/`board-view.tsx` and `notes-view.tsx` were already
  // each reachable from more than one lazy route (including
  // `shared-document.tsx`'s share-link mounts) without triggering it:
  //
  // - The slides canvas editor (`@wafflebase/slides` `view/editor/editor.ts`,
  //   which itself pulls in the `@wafflebase/docs` layout engine for
  //   in-slide text rendering) previously shipped duplicated inline inside
  //   the `slides-detail-`/`board-view-` route chunks (both already
  //   1500 kB-overridden). It now hoists into an anonymous shared chunk
  //   named only `editor-<hash>.js` — indistinguishable, by that generated
  //   name, from the notes editor bundle below (which collides on the same
  //   `editor.ts` basename and hoists for the same reason) or a small
  //   same-named `editor.ts` elsewhere in the app. Naming it explicitly
  //   gives the chunk-size budget in harness.config.json a stable, narrow
  //   pattern to target. Matched on the full path, not a directory prefix:
  //   `view/editor/` also holds `hit-test-elements.ts`,
  //   `snap-candidates.ts`, `text-box-editor.ts` and more, all
  //   barrel-exported alongside it.
  if (normalizedId.endsWith("/packages/slides/src/view/editor/editor.ts")) {
    return "slides-editor-engine";
  }

  // - The notes editor (`@wafflebase/notes` `view/editor.ts`: CodeMirror +
  //   the markdown-it preview engine + the optional Vim keymap) previously
  //   shipped fully inlined inside the `notes-view-` route chunk (already
  //   1400 kB-overridden). It now hoists into its own shared chunk the
  //   same way — `notes-view-*.js` itself shrank from ~1.3 MB to ~8 kB as
  //   a result. Named for the same reason as the slides editor above.
  if (normalizedId.endsWith("/packages/notes/src/view/editor.ts")) {
    return "notes-editor-engine";
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Dev-only: writes confirmed reports into `.wb-reports/` and hosts the
    // drafting call, so the model credential stays in this process and never
    // reaches the browser (`docs/design/debug-report.md`).
    debugReportPlugin({ repoRoot: path.resolve(__dirname, "../..") }),
    gaSnippet(),
    antlr4tsAssertShim(),
    pdfjsAssets(),
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
      "@wafflebase/notes": path.resolve(__dirname, "../notes/src/index.ts"),
      "@wafflebase/slides": path.resolve(__dirname, "../slides/src/index.ts"),
      "@wafflebase/board": path.resolve(__dirname, "../board/src/index.ts"),
      // The `/react` alias comes FIRST: Vite matches these in order, so the
      // bare-name entry would otherwise swallow the subpath.
      "@wafflebase/debug-report/testing": path.resolve(
        __dirname,
        "../debug-report/src/testing/index.ts",
      ),
      "@wafflebase/debug-report/react": path.resolve(
        __dirname,
        "../debug-report/src/ui/index.ts",
      ),
      "@wafflebase/debug-report": path.resolve(
        __dirname,
        "../debug-report/src/index.ts",
      ),
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
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    setupFiles: ["tests/setup.ts"],
    globals: false,
  },
});
