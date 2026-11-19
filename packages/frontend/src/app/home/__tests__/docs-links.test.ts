import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const homeDir = path.resolve(here, "..");
const docsRoot = path.resolve(here, "../../../../../documentation");

/**
 * The marketing page links into the docs site by URL, and nothing else
 * notices when a docs page moves. A moved page leaves a redirect stub, so an
 * old link still "works" — through a meta refresh that drops the anchor and
 * flashes a "This page moved" page. Pin every `/docs/...` href to a real page
 * that is not one of those stubs.
 */
function docsPageFor(href: string): string | null {
  const route = href.replace(/^\/docs\//, "").replace(/#.*$/, "");
  const candidates = route.endsWith("/") || route === ""
    ? [`${route}index.md`]
    : [`${route}.md`, `${route}/index.md`];
  const hit = candidates.find((c) => existsSync(path.join(docsRoot, c)));
  return hit ? path.join(docsRoot, hit) : null;
}

const links = readdirSync(homeDir)
  .filter((f) => f.endsWith(".tsx"))
  .flatMap((file) =>
    [...readFileSync(path.join(homeDir, file), "utf8").matchAll(/"(\/docs\/[^"]*)"/g)].map(
      (m) => [file, m[1]] as const,
    ),
  );

describe("homepage docs links", () => {
  it("finds the links it is meant to check", () => {
    expect(links.length).toBeGreaterThan(5);
  });

  it.each(links)("%s links %s to a docs page that is not a moved-page stub", (_file, href) => {
    const page = docsPageFor(href);
    expect(page, `no docs page for ${href}`).not.toBeNull();
    expect(readFileSync(page!, "utf8")).not.toMatch(/http-equiv: refresh/);
  });
});
