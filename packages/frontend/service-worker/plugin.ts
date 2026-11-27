import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import type { Plugin, Rollup } from "vite";

/** What the build injects into `sw.js` (see the `MANIFEST` comment there). */
export type ServiceWorkerManifest = {
  version: string;
  base: string;
  /** Paths downloaded at install: what a cold offline boot needs. */
  precache: string[];
  /** Every hashed asset of this build; cached entries outside it are pruned. */
  assets: string[];
};

const MANIFEST_TOKEN = "__WB_SW_MANIFEST__";

/**
 * Lazily imported modules an offline boot reaches before it can show
 * anything. `PrivateRoute` decides between the app and the offline screen
 * for every signed-in route, so without its chunk a private deep link opened
 * offline would fail on the import instead of saying it is offline.
 */
export const BOOT_MODULES = ["/src/PrivateRoute.tsx"];

/**
 * The precache set and asset list for one build.
 *
 * The boot set is the entry chunk and every chunk and stylesheet it imports
 * statically — exactly what `index.html` loads before first render — plus the
 * same closure for each of `bootModules`. Dynamic imports are left out: they
 * are cached when first used, so the install costs what one page load costs
 * rather than every editor in the app.
 */
export function buildManifest(
  bundle: Rollup.OutputBundle,
  options: { base: string; bootModules: string[]; indexHtml: string },
): ServiceWorkerManifest {
  const { base } = options;
  const chunks = Object.values(bundle).filter(
    (output): output is Rollup.OutputChunk => output.type === "chunk",
  );
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const precache = new Set<string>();

  const visit = (chunk: Rollup.OutputChunk) => {
    const url = base + chunk.fileName;
    if (precache.has(url)) return;
    precache.add(url);
    for (const css of chunk.viteMetadata?.importedCss ?? []) {
      precache.add(base + css);
    }
    for (const file of chunk.imports) {
      const imported = byFile.get(file);
      if (imported) visit(imported);
    }
  };

  for (const chunk of chunks) {
    const id = chunk.facadeModuleId?.replace(/\\/g, "/") ?? "";
    if (chunk.isEntry || options.bootModules.some((m) => id.endsWith(m))) {
      visit(chunk);
    }
  }

  const assets = Object.keys(bundle)
    .filter((file) => file.startsWith("assets/") && !file.endsWith(".map"))
    .map((file) => base + file)
    .sort();

  // Content-addressed: the asset names already change with their content,
  // and index.html is hashed in so that a change to it alone (a different
  // analytics ID, say) still installs a worker that caches the new shell.
  const version = createHash("sha256")
    .update(options.indexHtml)
    .update("\0")
    .update(assets.join("\n"))
    .digest("hex")
    .slice(0, 16);

  return { version, base, precache: [...precache].sort(), assets };
}

/** `sw.js` with `manifest` in place of its placeholder token. */
export function renderServiceWorker(
  source: string,
  manifest: ServiceWorkerManifest,
): string {
  if (!source.includes(MANIFEST_TOKEN)) {
    throw new Error(`service worker source is missing ${MANIFEST_TOKEN}`);
  }
  return source.replace(MANIFEST_TOKEN, JSON.stringify(manifest));
}

/** Whether `VITE_SERVICE_WORKER` leaves the worker on: anything but `off`. */
export function isServiceWorkerEnabled(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() !== "off";
}

/**
 * Writes `sw.js` beside `index.html` at build time; nothing in dev, where
 * the app never registers it. `VITE_SERVICE_WORKER=off` writes nothing, and
 * the app then unregisters any worker an earlier build installed
 * (`src/lib/service-worker.ts`).
 */
export function serviceWorker(): Plugin {
  let base = "/";
  let outDir = "";
  let enabled = true;
  return {
    name: "wafflebase-service-worker",
    apply: "build",
    configResolved(config) {
      base = config.base;
      outDir = path.resolve(config.root, config.build.outDir);
      // `config.env`, not `process.env`, so an `.env.production` line works
      // too: the app reads the same variable through `import.meta.env`.
      enabled = isServiceWorkerEnabled(config.env.VITE_SERVICE_WORKER);
    },
    writeBundle(_options, bundle) {
      if (!enabled) return;
      const html = bundle["index.html"];
      const indexHtml =
        html && html.type === "asset" ? String(html.source) : "";
      const manifest = buildManifest(bundle, {
        base,
        bootModules: BOOT_MODULES,
        indexHtml,
      });
      const source = readFileSync(path.join(__dirname, "sw.js"), "utf-8");
      writeFileSync(
        path.join(outDir, "sw.js"),
        renderServiceWorker(source, manifest),
      );
    },
  };
}
