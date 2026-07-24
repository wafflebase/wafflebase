import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const baselineDir = path.resolve(frontendRoot, "tests/visual/baselines");
const host = "127.0.0.1";
const port = Number(process.env.VISUAL_BROWSER_PORT || 4175);
const targetUrl = `http://${host}:${port}/harness/visual`;
const updateBaseline = process.env.UPDATE_VISUAL_BROWSER_BASELINE === "true";
const captureProfiles = [
  {
    id: "desktop",
    viewport: { width: 1800, height: 5000 },
    colorScheme: "light",
  },
  {
    id: "mobile",
    viewport: { width: 430, height: 8000 },
    colorScheme: "light",
  },
  {
    id: "desktop.dark",
    viewport: { width: 1800, height: 5000 },
    colorScheme: "dark",
  },
  {
    id: "mobile.dark",
    viewport: { width: 430, height: 8000 },
    colorScheme: "dark",
  },
];

// Scenarios are grouped by harness section so each section can be
// captured from its own isolated page load — see SECTION_READY_SELECTOR
// below and the `section` query param in harness/visual/page.tsx. This
// keeps one section's mount cost (e.g. docs' editor canvases) from
// perturbing another's rendering (e.g. recharts' JS-driven, non-CSS
// chart entrance animation) during a shared capture pass.
const SECTION_SCENARIOS = {
  sheet: [
    "sheet-freeze-selection",
    "sheet-overflow-clip",
    "sheet-merge-layout",
    "sheet-formula-errors",
    "sheet-dimensions-freeze",
    "sheet-mobile-edit-panel",
    "sheet-mobile-context-menu",
    "sheet-mobile-row-menu",
    "sheet-mobile-column-menu",
    "sheet-mobile-selection-handles",
  ],
  format: [
    "format-text-decoration",
    "format-text-bg-colors",
    "format-alignment",
    "format-borders",
    "format-number",
  ],
  docs: ["docs-mixed-font-size-line", "docs-mixed-font-size-list-marker"],
  chart: ["chart-bar", "chart-line", "chart-area", "chart-pie", "chart-scatter"],
  slides: [
    "slides-canvas-default-light",
    "slides-canvas-default-dark",
    "slides-canvas-focus",
    "slides-canvas-pop",
    "slides-canvas-slate",
    "slides-canvas-wafflebase",
    "slides-canvas-layout-section-header",
    "slides-canvas-layout-title-body",
    "slides-canvas-layout-big-number",
    "slides-toolbar",
    "slides-toolbar-idle",
    "slides-toolbar-shape-selected",
    "slides-toolbar-image-selected",
    "slides-toolbar-text-element-selected",
    "slides-toolbar-text-editing",
    "slides-toolbar-multi-select",
    "slides-theme-panel",
    "slides-pickers",
    "slides-canvas-shapes-catalog-light",
    "slides-canvas-shapes-catalog-dark",
    "slides-canvas-shapes-catalog-material",
    "slides-canvas-donut-evenodd",
    "slides-canvas-callout-tail",
    "shapes-adjustments-pilot",
    "shapes-adjustments-sweep",
    "shapes-adjustments-p3b-basics",
    "shapes-adjustments-p3b-arrows",
    "shapes-action-buttons",
    "slides-multi-resize-basic",
    "slides-multi-resize-with-rotated-child",
    "slides-resize-ghost-mid-drag",
    "slides-multi-resize-ghost-mid-drag",
  ],
};

const SECTION_IDS = Object.keys(SECTION_SCENARIOS);

const SECTION_READY_SELECTOR = {
  sheet: "[data-testid='visual-harness-sheet-section'][data-visual-sheet-ready='true']",
  format:
    "[data-testid='visual-harness-format-section'][data-visual-format-ready='true']",
  docs: "[data-testid='visual-harness-docs-section'][data-visual-docs-ready='true']",
  chart: "[data-testid='visual-harness-chart-section'][data-visual-chart-ready='true']",
  slides:
    "[data-testid='visual-harness-slides-section'][data-visual-slides-ready='true']",
};

const visualTargets = [
  {
    id: "harness-root",
    locator: "[data-testid='visual-harness-root']",
    baselineFile: "harness-visual.browser.png",
    section: null,
  },
  ...SECTION_IDS.flatMap((section) =>
    SECTION_SCENARIOS[section].map((scenarioId) => ({
      id: scenarioId,
      locator: `[data-visual-scenario-id='${scenarioId}']`,
      baselineFile: `harness-visual.browser.${scenarioId}.png`,
      section,
    })),
  ),
];

// Baselines are compared with a perceptual per-pixel threshold and a small
// mismatched-pixel budget rather than byte-exact equality. Chromium's
// antialiasing along text/vector edges is not bit-reproducible across CI
// runs, so a byte-exact check flags a handful of sub-pixel-jitter pixels as a
// failure and blocks unrelated PRs (see
// docs/tasks/.../visual-harness-pixel-tolerance-*). pixelmatch's YIQ threshold
// absorbs that noise; the pixel budget catches the rare case where jitter
// pushes an edge pixel over the threshold — while genuine visual changes
// (moved layout, changed glyphs/colors) still exceed it and fail. This mirrors
// how Playwright's own test runner compares screenshots.
// Parse a numeric tolerance override. Falls back to `fallback` unless the env
// var holds a finite number that also passes `isValid`. This rejects two kinds
// of footgun: values that fail to parse (unset/`""`/`"high"` — `Number("")` is
// 0, which would revert to byte-exact; `Number("high")` is NaN, which would fail
// every comparison) and values that parse but lie outside a setting's sensible
// domain (e.g. `VISUAL_MAX_DIFF_RATIO=1` → `allowed = total` → every comparison
// silently passes). An ignored override is warned so a typo isn't invisible.
function numberEnv(name, fallback, isValid) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || (isValid && !isValid(parsed))) {
    console.warn(
      `[verify:visual:browser] Ignoring out-of-range ${name}="${raw}"; using ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

// threshold is a YIQ distance in [0, 1]; ratio is a fraction of total pixels in
// [0, 1) (1 would allow the whole image to differ); floor is a non-negative
// pixel count.
const PIXELMATCH_THRESHOLD = numberEnv(
  "VISUAL_PIXELMATCH_THRESHOLD",
  0.1,
  (v) => v >= 0 && v <= 1,
);
const MAX_DIFF_RATIO = numberEnv(
  "VISUAL_MAX_DIFF_RATIO",
  0.0001,
  (v) => v >= 0 && v < 1,
);
const MAX_DIFF_PIXELS_FLOOR = numberEnv(
  "VISUAL_MAX_DIFF_PIXELS_FLOOR",
  20,
  (v) => Number.isInteger(v) && v >= 0,
);

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// Compare two PNG buffers. Returns `{ match, detail }`, plus a `diff` PNG (for
// the caller to serialize on mismatch only). A dimension change or an
// undecodable buffer is always a mismatch — reported per-target rather than
// thrown, so one bad screenshot never aborts the whole run. Otherwise the count
// of perceptually-different pixels must stay within
// `max(floor, ceil(total * ratio))`. Callers should short-circuit on
// byte-identical buffers before calling this — decoding is only worth it once
// the bytes already differ.
function compareImages(baselineBuf, capturedBuf) {
  let baseline;
  let captured;
  try {
    baseline = PNG.sync.read(baselineBuf);
    captured = PNG.sync.read(capturedBuf);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { match: false, detail: `undecodable PNG: ${message}` };
  }

  if (
    baseline.width !== captured.width ||
    baseline.height !== captured.height
  ) {
    return {
      match: false,
      detail: `dimensions ${baseline.width}x${baseline.height} -> ${captured.width}x${captured.height}`,
    };
  }

  const { width, height } = baseline;
  const total = width * height;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    baseline.data,
    captured.data,
    diff.data,
    width,
    height,
    { threshold: PIXELMATCH_THRESHOLD },
  );
  const allowed = Math.max(
    MAX_DIFF_PIXELS_FLOOR,
    Math.ceil(total * MAX_DIFF_RATIO),
  );

  return {
    match: diffPixels <= allowed,
    detail: `${diffPixels} diff px (allowed ${allowed} of ${total})`,
    diff,
  };
}

function captureKey(profileId, targetId) {
  return `${profileId}:${targetId}`;
}

function profileUrl(profile, section) {
  const params = new URLSearchParams();
  if (profile.colorScheme === "dark") {
    params.set("theme", "dark");
  }
  if (section) {
    params.set("section", section);
  }
  const query = params.toString();
  return query ? `${targetUrl}?${query}` : targetUrl;
}

function baselineFilenameFor(target, profile) {
  if (profile.id === "desktop") {
    return target.baselineFile;
  }
  const parsed = path.parse(target.baselineFile);
  return `${parsed.name}.${profile.id}${parsed.ext}`;
}

function baselinePathFor(target, profile) {
  return path.resolve(baselineDir, baselineFilenameFor(target, profile));
}

function actualPathFor(target, profile) {
  const parsed = path.parse(baselineFilenameFor(target, profile));
  return path.resolve(baselineDir, `${parsed.name}.actual${parsed.ext}`);
}

function diffPathFor(target, profile) {
  const parsed = path.parse(baselineFilenameFor(target, profile));
  return path.resolve(baselineDir, `${parsed.name}.diff${parsed.ext}`);
}

function printPlaywrightInstallHelp() {
  console.error(
    "[verify:visual:browser] Playwright is required for browser visual checks.",
  );
  console.error(
    "[verify:visual:browser] Install project dependencies first: `pnpm install`.",
  );
  console.error(
    "[verify:visual:browser] Install Chromium once per environment: " +
      "`pnpm --filter @wafflebase/frontend exec playwright install chromium`",
  );
}

async function loadPlaywright() {
  try {
    const module = await import("playwright");
    if (!module.chromium) {
      throw new Error("Playwright chromium launcher is unavailable.");
    }
    return module;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const isMissingPackage =
      message.includes("Cannot find package 'playwright'") ||
      message.includes("Cannot find module 'playwright'");
    if (isMissingPackage) {
      printPlaywrightInstallHelp();
      process.exit(1);
    }
    throw error;
  }
}

async function readBaseline(target, profile) {
  try {
    return await readFile(baselinePathFor(target, profile));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// The slides ThemedFontPicker (and any preview that hosts named families)
// injects the Google Fonts CSS link from a child mount effect. networkidle
// + a bare fonts.ready can race the post-mount link injection —
// fonts.load() called before the link is in the DOM falls back to the
// system family and never re-resolves, leaving the screenshot half on the
// swap and half on the fallback.
//
// Sequence to defeat it:
//   1. First pass: `fonts.load()` whatever the page already knows about,
//      plus `fonts.ready` to drain the in-flight queue.
//   2. Wait for another networkidle so any link injected after mount has
//      time to fetch (`page.waitForLoadState` is keyed to the *current*
//      idle, not the initial one).
//   3. Second pass: `fonts.check()` polled until every family is live.
//      `fonts.check()` returns true only when the face is ready for
//      synchronous rendering — strictly stronger than `fonts.ready`,
//      which can resolve before late-mounted families register at all.
const VISUAL_FONT_FAMILIES = ["Noto Sans KR", "Noto Serif KR", "Nanum Gothic", "Roboto"];

async function waitForFontsReady(page) {
  await page.evaluate(async (families) => {
    if (!document.fonts) return;
    await Promise.all(
      families.flatMap((family) => [
        document.fonts.load(`400 12px "${family}"`),
        document.fonts.load(`700 12px "${family}"`),
      ]),
    );
    await document.fonts.ready;
  }, VISUAL_FONT_FAMILIES);
  await page.waitForLoadState("networkidle");
  await page.evaluate(async (families) => {
    if (!document.fonts) return;
    await Promise.all(
      families.flatMap((family) => [
        document.fonts.load(`400 12px "${family}"`),
        document.fonts.load(`700 12px "${family}"`),
      ]),
    );
    await document.fonts.ready;
  }, VISUAL_FONT_FAMILIES);
  await page.waitForFunction(
    (families) =>
      families.every(
        (family) =>
          document.fonts.check(`400 12px "${family}"`) &&
          document.fonts.check(`700 12px "${family}"`),
      ),
    VISUAL_FONT_FAMILIES,
    { timeout: 10000 },
  );
}

// Captures one page load — either the full assembled page (`section` is
// null, used only for the `harness-root` target) or a single isolated
// section (used for every per-scenario target). Isolating sections onto
// their own page loads is what keeps one section's mount cost from
// perturbing another's rendering during capture.
async function capturePass(context, profile, section, targets, captures) {
  if (targets.length === 0) return;
  const page = await context.newPage();
  try {
    page.on("pageerror", (err) =>
      console.error("[page-error]", err.message, "\n", err.stack || ""),
    );
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[page-console]", msg.text());
    });
    await page.goto(profileUrl(profile, section), { waitUntil: "networkidle" });
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;}",
    });

    await waitForFontsReady(page);

    const root = page.locator("[data-testid='visual-harness-root']");
    await root.waitFor({ state: "visible" });

    const sectionsToAwait = section ? [section] : SECTION_IDS;
    for (const sectionId of sectionsToAwait) {
      const ready = page.locator(SECTION_READY_SELECTOR[sectionId]);
      await ready.waitFor({ state: "visible", timeout: 20000 });
    }

    for (const target of targets) {
      const locator = page.locator(target.locator).first();
      await locator.waitFor({ state: "visible" });
      const screenshot = await locator.screenshot({
        type: "png",
        animations: "disabled",
      });
      captures.set(captureKey(profile.id, target.id), screenshot);
    }
  } finally {
    await page.close();
  }
}

async function captureScreenshots(playwright) {
  const server = await createServer({
    configFile: path.resolve(frontendRoot, "vite.config.ts"),
    root: frontendRoot,
    logLevel: "silent",
    server: {
      host,
      port,
      strictPort: true,
    },
  });

  let browser;
  try {
    await server.listen();
    browser = await playwright.chromium.launch({ headless: true });

    const captures = new Map();
    const harnessRootTarget = visualTargets.find((t) => t.id === "harness-root");

    for (const profile of captureProfiles) {
      const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: profile.colorScheme,
      });

      try {
        // Root pass: the full assembled page (every section mounted
        // together), used only for the one `harness-root` full-page
        // baseline — that target is meant to catch whole-page layout
        // regressions, so it intentionally keeps today's shared-page
        // composition.
        await capturePass(context, profile, null, [harnessRootTarget], captures);

        // Per-section passes: each section gets its own isolated page
        // load, so one section's mount cost (e.g. docs' editor canvases)
        // can never perturb another's rendering (e.g. recharts' JS-driven
        // chart entrance animation) during a shared capture pass.
        for (const section of SECTION_IDS) {
          const targets = visualTargets.filter((t) => t.section === section);
          await capturePass(context, profile, section, targets, captures);
        }
      } finally {
        await context.close();
      }
    }

    return captures;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const needsBrowserInstall =
      message.includes("Executable doesn't exist") ||
      message.includes("Please run the following command to download new browsers");
    if (needsBrowserInstall) {
      printPlaywrightInstallHelp();
      process.exit(1);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await server.close();
  }
}

const playwright = await loadPlaywright();
const capturedById = await captureScreenshots(playwright);

await mkdir(baselineDir, { recursive: true });

if (updateBaseline && process.env.WAFFLEBASE_DOCKER_BROWSER !== "true") {
  console.warn(
    "[verify:visual:browser] WARNING: Updating baselines outside Docker.",
  );
  console.warn(
    "[verify:visual:browser] For CI-consistent baselines, use: bash scripts/run-browser-tests-docker.sh visual:update",
  );
}

if (updateBaseline) {
  for (const profile of captureProfiles) {
    for (const target of visualTargets) {
      const captured = capturedById.get(captureKey(profile.id, target.id));
      if (!captured) {
        throw new Error(`Missing captured screenshot for ${captureKey(profile.id, target.id)}.`);
      }
      const baselinePath = baselinePathFor(target, profile);
      const baselineFile = baselineFilenameFor(target, profile);
      await writeFile(baselinePath, captured);
      console.log(`[verify:visual:browser] Updated baseline ${baselineFile}.`);
    }
  }
  process.exit(0);
}

const missingTargets = [];
const mismatchedTargets = [];

for (const profile of captureProfiles) {
  for (const target of visualTargets) {
    const baseline = await readBaseline(target, profile);
    const baselineFile = baselineFilenameFor(target, profile);

    if (!baseline) {
      missingTargets.push({ profile, target, baselineFile });
      continue;
    }

    const captured = capturedById.get(captureKey(profile.id, target.id));
    if (!captured) {
      throw new Error(`Missing captured screenshot for ${captureKey(profile.id, target.id)}.`);
    }

    // Fast path: byte-identical buffers are trivially a match and skip the
    // (comparatively expensive) PNG decode + pixel diff.
    if (baseline.equals(captured)) {
      console.log(
        `[verify:visual:browser] Baseline matched ${baselineFile} (${shortHash(captured)}).`,
      );
      continue;
    }

    const comparison = compareImages(baseline, captured);
    if (comparison.match) {
      console.log(
        `[verify:visual:browser] Baseline matched ${baselineFile} within tolerance (${comparison.detail}).`,
      );
      continue;
    }

    const actualPath = actualPathFor(target, profile);
    await writeFile(actualPath, captured);
    let diffPath = null;
    if (comparison.diff) {
      diffPath = diffPathFor(target, profile);
      await writeFile(diffPath, PNG.sync.write(comparison.diff));
    }
    mismatchedTargets.push({
      baselineFile,
      detail: comparison.detail,
      baselineHash: shortHash(baseline),
      actualHash: shortHash(captured),
      actualPath,
      diffPath,
    });
  }
}

if (missingTargets.length > 0) {
  console.error("[verify:visual:browser] Missing baseline screenshots:");
  for (const missing of missingTargets) {
    console.error(`- ${missing.baselineFile}`);
  }
}

if (mismatchedTargets.length > 0) {
  console.error("[verify:visual:browser] Visual baseline mismatches detected:");
  for (const mismatch of mismatchedTargets) {
    console.error(`- ${mismatch.baselineFile}`);
    console.error(`  detail:        ${mismatch.detail}`);
    console.error(`  baseline hash: ${mismatch.baselineHash}`);
    console.error(`  actual hash:   ${mismatch.actualHash}`);
    console.error(`  actual output: ${mismatch.actualPath}`);
    if (mismatch.diffPath) {
      console.error(`  diff output:   ${mismatch.diffPath}`);
    }
  }
}

if (missingTargets.length > 0 || mismatchedTargets.length > 0) {
  console.error(
    "[verify:visual:browser] Inspect mismatches and refresh intended baselines: " +
      "`pnpm frontend test:visual:browser:update`.",
  );
  process.exit(1);
}

console.log(
  `[verify:visual:browser] All ${visualTargets.length * captureProfiles.length} profile targets matched.`,
);
