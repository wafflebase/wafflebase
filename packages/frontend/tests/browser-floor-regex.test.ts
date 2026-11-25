import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RegExp lookbehind is a SyntaxError before Safari 16.4, below the browser
 * floor the build ships to (Vite's default `modules` target, Safari 14). A
 * pattern built at module scope fails while the module evaluates, taking
 * every importer's chunk with it, so none may reach the bundle — from this
 * package or from the shared `core` code it compiles in.
 */
const ROOTS = [
  resolve(__dirname, "../src"),
  resolve(__dirname, "../../core/src"),
];
const LOOKBEHIND = /\(\?<[=!]/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(?:ts|tsx)$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

describe("browser floor", () => {
  it("ships no regex lookbehind", () => {
    const offenders = ROOTS.flatMap(sources).filter((path) =>
      LOOKBEHIND.test(readFileSync(path, "utf8")),
    );
    expect(offenders.map((p) => relative(resolve(__dirname, ".."), p))).toEqual([]);
  });
});
