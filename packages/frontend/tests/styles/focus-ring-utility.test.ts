/**
 * The `focus-ring` utility in `src/index.css` is the focus contract for every
 * raw `<button>` and hand-built control (DESIGN.md: a 3px 50%-syrup ring and a
 * syrup border on keyboard focus). jsdom cannot compute it, so a typo in the
 * `@utility` block would silently strip the focus indicator from ~30 files.
 * Compile the block with Tailwind itself and assert what it emits.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const indexCss = readFileSync(resolve(__dirname, "../../src/index.css"), "utf8");

function focusRingBlock(): string {
  const start = indexCss.indexOf("@utility focus-ring {");
  expect(start).toBeGreaterThan(-1);
  // The block nests one `&:focus-visible { … }`, so match braces.
  let depth = 0;
  for (let i = indexCss.indexOf("{", start); i < indexCss.length; i++) {
    if (indexCss[i] === "{") depth++;
    if (indexCss[i] === "}" && --depth === 0) return indexCss.slice(start, i + 1);
  }
  throw new Error("unterminated @utility focus-ring block");
}

async function emit(candidates: string[]): Promise<string> {
  const compiler = await compile(`@tailwind utilities;\n${focusRingBlock()}`);
  return compiler.build(candidates);
}

describe("focus-ring utility", () => {
  // Tailwind emits the block nested (`.focus-ring { &:focus-visible { … } }`);
  // the build's CSS minifier flattens it later.
  function focusVisibleRule(css: string): string {
    const at = css.indexOf("&:focus-visible {");
    expect(at).toBeGreaterThan(-1);
    return css.slice(at);
  }

  it("draws the ring and border on keyboard focus only", async () => {
    const css = await emit(["focus-ring"]);
    const rule = focusVisibleRule(css);
    expect(rule).toMatch(/border-color:\s*var\(--ring\)/);
    expect(rule).toMatch(
      /box-shadow:\s*0 0 0 3px color-mix\(in oklab, var\(--ring\) 50%, transparent\)/,
    );
    expect(css).not.toMatch(/&:focus\s*\{/);
  });

  it("keeps a transparent outline for forced-colors mode", async () => {
    const css = await emit(["focus-ring"]);
    const rest = css.slice(css.indexOf(".focus-ring {"), css.indexOf("&:focus-visible"));
    expect(rest).toMatch(/outline:\s*2px solid transparent/);
  });

  it("emits nothing for a document that never uses it", async () => {
    expect(await emit([])).not.toContain(".focus-ring");
  });
});
