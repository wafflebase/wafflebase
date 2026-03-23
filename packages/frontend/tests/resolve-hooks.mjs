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
  "sheets",
);

const SHEET_DIST = pathResolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "sheets",
  "dist",
  "wafflebase-sheet.es.js",
);

const SHEET_SRC_INDEX = pathResolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "sheets",
  "src",
  "index.ts",
);

const DOCS_ROOT = pathResolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "docs",
);

const DOCS_DIST = pathResolve(DOCS_ROOT, "dist", "wafflebase-document.es.js");
const DOCS_SRC_INDEX = pathResolve(DOCS_ROOT, "src", "index.ts");

export async function resolve(specifier, context, nextResolve) {
  // Map @wafflebase/sheets → built ES module in sheet dist.
  // If the dist file is missing, fall back to the workspace source.
  if (specifier === "@wafflebase/sheets") {
    if (existsSync(SHEET_DIST)) {
      return nextResolve(pathToFileURL(SHEET_DIST).href, context);
    }
    if (existsSync(SHEET_SRC_INDEX)) {
      return nextResolve(pathToFileURL(SHEET_SRC_INDEX).href, context);
    }
    return { url: "virtual:wafflebase-sheet", shortCircuit: true };
  }

  // Map @wafflebase/docs → built ES module or source fallback.
  if (specifier === "@wafflebase/docs") {
    if (existsSync(DOCS_DIST)) {
      return nextResolve(pathToFileURL(DOCS_DIST).href, context);
    }
    if (existsSync(DOCS_SRC_INDEX)) {
      return nextResolve(pathToFileURL(DOCS_SRC_INDEX).href, context);
    }
    return { url: "virtual:wafflebase-docs", shortCircuit: true };
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
  // Also remap .js → .ts for TypeScript source files in workspace packages
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const inResolvedPkg =
      parentPath.startsWith(FRONTEND_SRC) ||
      parentPath.startsWith(SHEET_ROOT) ||
      parentPath.startsWith(DOCS_ROOT);

    if (inResolvedPkg) {
      const parentDir = dirname(parentPath);

      // Remap .js imports to .ts (TypeScript sources use .js extensions for ESM)
      if (specifier.endsWith(".js")) {
        const tsCandidate = pathResolve(parentDir, specifier.replace(/\.js$/, ".ts"));
        if (existsSync(tsCandidate)) {
          return nextResolve(pathToFileURL(tsCandidate).href, context);
        }
      }

      for (const ext of [".ts", ".tsx"]) {
        const candidate = pathResolve(parentDir, specifier + ext);
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
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
  // Provide a minimal stub when @wafflebase/sheets dist is unavailable.
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
  // Provide a minimal stub when @wafflebase/docs dist is unavailable.
  if (url === "virtual:wafflebase-docs") {
    return {
      format: "module",
      shortCircuit: true,
      source: [
        "export const DEFAULT_BLOCK_STYLE = { alignment: 'left', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 };",
        "export const DEFAULT_INLINE_STYLE = {};",
        "export function generateBlockId() { return 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2); }",
        "export function createEmptyBlock() { return { id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }; }",
        "export function resolvePageSetup(s) { return s || { paperSize: { name: 'Letter', width: 816, height: 1056 }, orientation: 'portrait', margins: { top: 96, bottom: 96, left: 96, right: 96 } }; }",
        "export function normalizeBlockStyle(s) { return { ...DEFAULT_BLOCK_STYLE, ...s }; }",
        "export function getBlockText() { return ''; }",
        "export function getBlockTextLength() { return 0; }",
        "export function inlineStylesEqual() { return true; }",
        "export function getEffectiveDimensions() { return { width: 624, height: 864 }; }",
        "export const PAPER_SIZES = {};",
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
