/**
 * Every shell that mounts the sidebar reads its nav list from one hook.
 *
 * The app has seven `AppSidebar` mounts: `app/Layout.tsx` and the six editor
 * shells that live outside it. When each built the item list inline, Templates
 * and Analytics were added to the layout only and every editor silently kept a
 * three-entry sidebar. This test fails the moment an eighth mount appears with
 * its own list.
 *
 * Asserting the *mount → hook* edge rather than searching for a copied literal
 * is deliberate: a drifted copy is typically a SHORT list (that was the bug),
 * so any marker taken from an entry the copy omits would miss it.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** JSX that mounts the sidebar. */
const MOUNT = "<AppSidebar";
/** The one place the list may be built. */
const HOOK = "useWorkspaceNavItems";

function sourceFiles(dir: string): Array<string> {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(path)) return [];
    if (/\.test\.tsx?$/.test(path)) return [];
    return [path];
  });
}

describe("workspace nav items", () => {
  const mounts = sourceFiles(SRC)
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter(({ text }) => text.includes(MOUNT));

  it("finds the sidebar mounts it is supposed to guard", () => {
    // A marker that stops matching would make the check below vacuous.
    expect(mounts.length).toBeGreaterThan(0);
  });

  it("are read from the shared hook by every mount", () => {
    const offenders = mounts
      .filter(({ text }) => !text.includes(HOOK))
      .map(({ path }) => path.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});
