/**
 * Custom Node.js module-resolution hooks for running frontend unit tests
 * that transitively import workspace packages or use path aliases.
 *
 * Usage (automatically wired via the `test` script in package.json):
 *   node --experimental-strip-types --import ./tests/register-hooks.mjs --test …
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve as pathResolve, dirname } from "node:path";

const FRONTEND_SRC = pathResolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "src",
);

const SHEET_ROOT = pathResolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "sheet",
);

const SHEET_DIST = pathResolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "sheet",
  "dist",
  "wafflebase-sheet.es.js",
);

export async function resolve(specifier, context, nextResolve) {
  // Map @wafflebase/sheet → built ES module in sheet dist.
  // If the dist file is missing (e.g. CI before sheet build), resolve to a
  // virtual stub so tests that transitively import it can still run.
  if (specifier === "@wafflebase/sheet") {
    if (existsSync(SHEET_DIST)) {
      return nextResolve(pathToFileURL(SHEET_DIST).href, context);
    }
    return { url: "virtual:wafflebase-sheet", shortCircuit: true };
  }

  // Map @/ alias → packages/frontend/src/
  if (specifier.startsWith("@/")) {
    const rest = specifier.slice(2);
    for (const ext of [".ts", ".tsx"]) {
      const candidate = pathResolve(FRONTEND_SRC, rest + ext);
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    const exactPath = pathResolve(FRONTEND_SRC, rest);
    return nextResolve(pathToFileURL(exactPath).href, context);
  }

  if (
    specifier.startsWith("antlr4ts/") &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".mjs")
  ) {
    return nextResolve(`${specifier}.js`, context);
  }

  // Handle extensionless relative imports within frontend src/ — add .ts/.tsx
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    (
      fileURLToPath(context.parentURL).startsWith(FRONTEND_SRC) ||
      fileURLToPath(context.parentURL).startsWith(SHEET_ROOT)
    )
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    for (const ext of [".ts", ".tsx"]) {
      const candidate = pathResolve(parentDir, specifier + ext);
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }

  return nextResolve(specifier, context);
}

/**
 * Stub .tsx modules that contain JSX which Node's --experimental-strip-types
 * cannot parse. Extracts named export function/const names from the source
 * and re-exports them as no-op stubs so transitive imports from .ts files
 * (e.g. chart-registry importing renderer components) don't crash the test
 * runner.
 */
export async function load(url, context, nextLoad) {
  // Provide a minimal stub when @wafflebase/sheet dist is unavailable.
  if (url === "virtual:wafflebase-sheet") {
    return {
      format: "module",
      shortCircuit: true,
      source: [
        "export function parseRef(s) {",
        "  const m = s.match(/^([A-Z]+)(\\d+)$/i);",
        "  if (!m) return { r: 0, c: 0 };",
        "  let c = 0;",
        "  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;",
        "  return { r: Number(m[2]), c };",
        "}",
        "export function toSref({ r, c }) {",
        "  let s = '';",
        "  let n = c;",
        "  while (n > 0) { s = String.fromCharCode(((n - 1) % 26) + 65) + s; n = Math.floor((n - 1) / 26); }",
        "  return s + r;",
        "}",
      ].join("\n"),
    };
  }
  if (url.endsWith(".tsx") && fileURLToPath(url).startsWith(FRONTEND_SRC)) {
    const source = readFileSync(fileURLToPath(url), "utf-8");
    const names = [
      ...source.matchAll(/export\s+function\s+(\w+)/g),
      ...source.matchAll(/export\s+const\s+(\w+)/g),
    ].map((m) => m[1]);
    const hasDefaultExport = /export\s+default\s/.test(source);
    const stubs = names
      .map((name) => `export function ${name}() {}`)
      .join("\n");
    const defaultStub = hasDefaultExport
      ? "\nexport default function __default_stub() {}"
      : "";
    return {
      format: "module",
      shortCircuit: true,
      source: (stubs + defaultStub) || "export {};",
    };
  }
  return nextLoad(url, context);
}
