import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { loadGoogleFontCache } from "./google-font-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const baselineDir = path.resolve(frontendRoot, "tests/visual/baselines");
const fontCacheDir = path.resolve(frontendRoot, "tests/visual/fonts");
const host = "127.0.0.1";
const port = Number(process.env.VISUAL_BROWSER_PORT || 4175);
const targetUrl = `http://${host}:${port}/harness/visual`;
const updateBaseline = process.env.UPDATE_VISUAL_BROWSER_BASELINE === "true";
// Refreshes `tests/visual/fonts/` from the network instead of replaying it.
// On demand only — see google-font-cache.mjs.
const recordFontCache = process.env.RECORD_GOOGLE_FONT_CACHE === "true";
const RECORD_FONTS_COMMAND =
  "pnpm frontend test:visual:browser:record (or :docker:record)";
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

// Web fonts are the one input to a capture that the page fetches rather than
// renders, so they are the one input that can differ between the run that
// recorded a baseline and the run being compared against it. index.html
// requests Inter/Fraunces/JetBrains Mono up front, and the slides
// ThemedFontPicker (plus any preview hosting named families) injects further
// Google Fonts links from a child mount effect. A bare `fonts.ready` is not
// enough for either: it can resolve before a late-injected link registers
// its faces at all, and once it has resolved nothing re-arms it — the
// screenshot then paints the browser's default serif where the baseline
// holds Inter, which is how slides-theme-panel and slides-pickers drifted
// while every system-family row around them matched.
//
// Those fetches no longer leave the machine: google-font-cache.mjs answers
// them from `tests/visual/fonts/`. That removed the *flake* (11 of the last
// 64 verify-browser runs died on a `fonts.gstatic.com` failure) but not the
// need for this wait — a face is still asynchronous, still registered only
// once a mount injects its link, and still capable of arriving after a
// screenshot.
//
// What gets *gated* is an explicit floor — the families and weights
// `index.html`'s own Google Fonts stylesheet requests, which are the
// families the baselines were recorded with. The floor is asserted
// positively: each family must be registered in `document.fonts` at all,
// must have a face that reached `loaded`, and must answer `fonts.check()`
// at every declared weight. Registration is part of the assertion because
// a wait derived purely from the registry is vacuous exactly when it
// matters — a blocked or failed `fonts.googleapis.com` registers no
// @font-face rules, so "nothing is pending" and the capture would paint
// fallback glyphs while reporting success.
//
// Everything *else* the page registers is deliberately not a gate. KaTeX
// (`src/index.css` imports `katex.min.css` on every route) registers ~16
// same-origin families, several of them italic-only or subset faces that
// no harness screenshot paints and that a `fonts.googleapis.com` refetch
// could not recover anyway; `FONT_CATALOG`'s eager Korean/Roboto set is
// likewise registered on slides/docs mounts without every screenshot
// painting it. Those are covered by a *soft*, shorter wait for quiet —
// no face left in `status: "loading"` — which is what actually catches a
// late-injected per-family link (ThemedFontPicker) whose preview text has
// already triggered its fetch. Running out of soft budget warns; it never
// fails the run.
//
// Per pass:
//   1. networkidle, so a link injected by a mount effect has resolved and
//      its faces are registered (`page.waitForLoadState` is keyed to the
//      *current* idle, not the initial one).
//   2. `fonts.load()` the floor, then poll until the floor is usable and
//      the registry is quiet. The poll re-reads `document.fonts` each
//      tick, picking up faces a paint only just triggered.
//   3. If the floor is still unmet: re-insert the Google Fonts stylesheet
//      links so Chromium refetches them, then settle again. A face whose
//      woff2 fetch failed sits in `status: "error"` for good, so waiting
//      longer cannot recover it — only a refetch can.
//
// Exhausting the refetches records the pass and lets capture continue: the
// run then fails at the end, after every screenshot, diff and per-target
// report is on disk, rather than aborting mid-capture on a TimeoutError
// that leaves nothing to look at.
//
// The floor mirrors the `css2` query in `packages/frontend/index.html`
// (family + every requested weight). Keep the two in sync: a weight the
// UI renders but the floor omits is a weight this wait cannot vouch for.
const REQUIRED_WEB_FONTS = [
  { family: "Inter", weights: [400, 500, 600, 700] },
  { family: "Fraunces", weights: [500, 600, 700] },
  { family: "JetBrains Mono", weights: [400, 500] },
];

const FONT_SETTLE_TIMEOUT_MS = 10000;
// Budget for the non-gating "no face still loading" quiet check. Kept well
// under the floor's budget so a family nothing screenshots — a stalled
// KaTeX or catalog face — costs seconds, not the full timeout, in each of
// the ~25 passes.
const FONT_QUIET_TIMEOUT_MS = 3000;
// Refetch attempts after the first settle poll comes up short. Two absorbs
// a transient 404/429 from fonts.googleapis.com; a face still unusable
// after them is not coming back this run.
const FONT_REFETCH_ATTEMPTS = 2;

// Once one pass has burned through every refetch the network is broken
// rather than flaky, and retrying in each of the ~24 remaining passes would
// add minutes of pure waiting to a run that is already going to fail. Later
// passes still do their single bounded settle.
let webFontRefetchExhausted = false;

// Passes whose required fonts never became usable: `{ label, pending }`.
// Reported and turned into a non-zero exit once capture is done.
const webFontFailures = [];

async function waitForFontsReady(page, label) {
  // Polls in-page rather than through `page.waitForFunction` so running out
  // of time yields *what* is still missing instead of a bare TimeoutError.
  const settlePass = async ({ timeoutMs, quietMs, required }) => {
    if (!document.fonts) {
      return { missing: ["(document.fonts is unavailable)"], loading: [] };
    }
    const start = performance.now();
    const deadline = start + timeoutMs;
    const quietDeadline = start + Math.min(timeoutMs, quietMs);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // FontFace.family keeps the quoting style of the @font-face rule.
    const unquote = (family) => family.replace(/^["']|["']$/g, "");
    const facesFor = (family) =>
      [...document.fonts].filter((face) => unquote(face.family) === family);

    // Only the floor is force-loaded. Forcing every registered family
    // would start fetches for faces no screenshot paints (KaTeX's
    // italic-only maths faces never match a `normal` load() and would
    // stay unloaded forever; the eager catalog families would pull
    // fonts.googleapis.com into passes that never render them).
    const loadRequired = async () => {
      const jobs = [];
      for (const { family, weights } of required) {
        for (const weight of weights) {
          // Swallowed deliberately: a rejection means the fetch failed,
          // which `missingRequired()` reports by name from the face's own
          // status — a thrown rejection here would only say "one of them".
          jobs.push(
            document.fonts.load(`${weight} 12px "${family}"`).catch(() => {}),
          );
        }
      }
      await Promise.all(jobs);
    };

    const missingRequired = () => {
      const missing = [];
      for (const { family, weights } of required) {
        const faces = facesFor(family);
        // The load-bearing assertion: an unreachable stylesheet registers
        // no faces, and `fonts.check()` would answer *true* for exactly
        // that case (no matching face → renders with a system fallback).
        if (faces.length === 0) {
          missing.push(`${family} (no @font-face registered)`);
          continue;
        }
        const statuses = [...new Set(faces.map((face) => face.status))];
        // Subset faces the text never needs stay `unloaded`, so one loaded
        // face is the bar for the family itself.
        if (!statuses.includes("loaded")) {
          missing.push(`${family} (${statuses.join("/")})`);
          continue;
        }
        for (const weight of weights) {
          if (!document.fonts.check(`${weight} 12px "${family}"`)) {
            missing.push(`${family} @${weight}`);
          }
        }
      }
      return missing;
    };

    // Families with a fetch still in flight — the signal that a late
    // link (or a paint that only just referenced a face) has not settled.
    const stillLoading = () => {
      const names = new Set();
      for (const face of document.fonts) {
        if (face.status === "loading") names.add(unquote(face.family));
      }
      return [...names];
    };

    await loadRequired();
    // `fonts.ready` drains the in-flight queue, but it can also outlive a
    // hung fetch — the poll below, not this, is the gate.
    await Promise.race([
      document.fonts.ready,
      sleep(Math.max(0, deadline - performance.now())),
    ]);

    // Evaluated at least once regardless of how much budget `fonts.ready`
    // consumed, so the report is never derived from a poll that never ran.
    let missing;
    let loading;
    for (;;) {
      missing = missingRequired();
      loading = stillLoading();
      const now = performance.now();
      const quiet = loading.length === 0 || now >= quietDeadline;
      if (missing.length === 0 && quiet) break;
      if (now >= deadline) break;
      await sleep(100);
      await loadRequired();
    }
    return { missing, loading };
  };

  // Re-inserting the same `<link>` element (rather than re-pointing its
  // `href`) re-runs Chromium's fetch-and-process steps without touching
  // the URL: no cache-busting param is appended, so a css2 request that
  // works cannot be turned into one the endpoint rejects. Reusing the
  // element also keeps the app's `data-wafflebase-font` / id bookkeeping
  // and its load listeners intact.
  const refetchPass = () => {
    const links = [...document.querySelectorAll("link[rel='stylesheet']")].filter(
      (link) => link.href.startsWith("https://fonts.googleapis.com/"),
    );
    for (const link of links) {
      const parent = link.parentNode;
      if (!parent) continue;
      const next = link.nextSibling;
      link.remove();
      parent.insertBefore(link, next);
    }
    return links.length;
  };

  const spec = {
    timeoutMs: FONT_SETTLE_TIMEOUT_MS,
    quietMs: FONT_QUIET_TIMEOUT_MS,
    required: REQUIRED_WEB_FONTS,
  };
  const maxAttempts = webFontRefetchExhausted ? 0 : FONT_REFETCH_ATTEMPTS;
  for (let attempt = 0; ; attempt += 1) {
    await page.waitForLoadState("networkidle");
    const { missing, loading } = await page.evaluate(settlePass, spec);
    if (missing.length === 0) {
      if (attempt > 0) {
        console.warn(
          `[verify:visual:browser] ${label}: webfonts settled after ${attempt} refetch(es).`,
        );
      }
      if (loading.length > 0) {
        // Not a gate: these are families outside the baseline floor (KaTeX
        // faces, eager catalog families, a lazily injected picker link).
        console.warn(
          `[verify:visual:browser] ${label}: still fetching after ${FONT_QUIET_TIMEOUT_MS}ms, ` +
            `capturing anyway: ${loading.join(", ")}`,
        );
      }
      return;
    }
    if (attempt >= maxAttempts) {
      if (maxAttempts > 0) webFontRefetchExhausted = true;
      webFontFailures.push({ label, pending: missing });
      console.error(
        `[verify:visual:browser] ${label}: required webfonts never became usable: ${missing.join(", ")}`,
      );
      return;
    }
    const refetched = await page.evaluate(refetchPass);
    if (refetched === 0) {
      // Nothing to refetch means index.html's stylesheet link is gone —
      // waiting again cannot change the outcome.
      webFontFailures.push({ label, pending: missing });
      console.error(
        `[verify:visual:browser] ${label}: no fonts.googleapis.com stylesheet to refetch; ` +
          `required webfonts unusable: ${missing.join(", ")}`,
      );
      return;
    }
  }
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

    const root = page.locator("[data-testid='visual-harness-root']");
    await root.waitFor({ state: "visible" });

    const sectionsToAwait = section ? [section] : SECTION_IDS;
    for (const sectionId of sectionsToAwait) {
      const ready = page.locator(SECTION_READY_SELECTOR[sectionId]);
      await ready.waitFor({ state: "visible", timeout: 20000 });
    }

    // After the section is mounted, not before: Chromium only requests a
    // face once text using it is laid out, so settling fonts first leaves
    // the fetches a mount triggers entirely unwaited-for.
    await waitForFontsReady(page, `${profile.id}/${section ?? "all-sections"}`);

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

async function captureScreenshots(playwright, fontCache) {
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

      // Before the first navigation: the `css2` link is in the document
      // head, so an uninstalled route would let the very request this
      // exists to intercept reach the network.
      await fontCache.install(context);

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
const fontCache = await loadGoogleFontCache({
  dir: fontCacheDir,
  record: recordFontCache,
});
const capturedById = await captureScreenshots(playwright, fontCache);

// Record mode is a maintenance pass, not a verification: it exists to
// refresh the fixtures, so it reports what it wrote and stops before any
// baseline is compared or overwritten with screenshots taken against
// whatever the network happened to serve.
if (recordFontCache) {
  if (fontCache.recordFailures.length > 0) {
    console.error(
      "[verify:visual:browser] Google Fonts refused these requests; nothing was recorded for them:",
    );
    for (const { url, status } of fontCache.recordFailures) {
      console.error(`- ${status} ${url}`);
    }
    console.error(
      "[verify:visual:browser] Re-run the record pass — a partial cache would fail every later run.",
    );
    process.exit(1);
  }
  await fontCache.save();
  console.log(
    `[verify:visual:browser] Recorded ${fontCache.recorded} new response(s); ` +
      `cache now holds ${fontCache.size}. Commit tests/visual/fonts/.`,
  );
  process.exit(0);
}

// A request the fixtures do not answer was aborted, so this pass painted
// fallback glyphs for whatever needed it — the same worthless capture a
// failed network fetch produced, and reported the same way: after every
// screenshot is on disk, never as a silent pass.
if (fontCache.misses.length > 0) {
  console.error(
    "[verify:visual:browser] Google Fonts requests missing from tests/visual/fonts/:",
  );
  for (const url of fontCache.misses) {
    console.error(`- ${url}`);
  }
  console.error(
    `[verify:visual:browser] Re-record the cache and commit it: ${RECORD_FONTS_COMMAND}`,
  );
}

await mkdir(baselineDir, { recursive: true });

// A pass that captured without the baseline floor's webfonts painted
// fallback families, so its screenshots are worthless as a comparison *and*
// as a baseline. Report it here — after every capture, before anything is
// written or compared — and let it fail the run below alongside any pixel
// mismatches it caused.
if (webFontFailures.length > 0) {
  console.error(
    "[verify:visual:browser] Required webfonts never became usable during capture:",
  );
  for (const failure of webFontFailures) {
    console.error(`- ${failure.label}: ${failure.pending.join(", ")}`);
  }
  console.error(
    "[verify:visual:browser] These screenshots paint fallback families. " +
      `The faces are served from tests/visual/fonts/, not the network: ${RECORD_FONTS_COMMAND}`,
  );
}

if (updateBaseline && (webFontFailures.length > 0 || fontCache.misses.length > 0)) {
  console.error(
    "[verify:visual:browser] Refusing to record baselines from fallback glyphs.",
  );
  process.exit(1);
}

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

if (webFontFailures.length > 0 || fontCache.misses.length > 0) {
  process.exit(1);
}

console.log(
  `[verify:visual:browser] All ${visualTargets.length * captureProfiles.length} profile targets matched.`,
);
