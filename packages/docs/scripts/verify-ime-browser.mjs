/**
 * IME (Input Method Editor) browser verification script.
 *
 * Tests Korean IME composition across Chromium and WebKit by simulating
 * individual jamo (자소) keystrokes — exactly as a real Korean keyboard works.
 *
 * Real Korean IME event sequence for typing "한글":
 *
 *   Key ㅎ → compositionstart → input(ㅎ)
 *   Key ㅏ → input(하)
 *   Key ㄴ → input(한)
 *   Key ㄱ → compositionend(한) → input → compositionstart → input(ㄱ)
 *            (ㄴ stays as batchim, ㄱ starts new syllable)
 *   Key ㅡ → input(그)
 *   Key ㄹ → input(글)
 *   Commit → compositionend(글) → input
 *
 * Usage:
 *   pnpm document test:ime
 *
 * Prerequisites:
 *   pnpm --filter @wafflebase/document exec playwright install chromium webkit
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.IME_BROWSER_PORT || 4179);
const targetUrl = `http://${host}:${port}/`;
const bridgeKey = "__WB_DOC__";

// --- Helpers ---

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[verify:ime] FAIL: ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bridgeCall(page, method, ...args) {
  return await page.evaluate(
    ({ bridgeKey, method, args }) => {
      const bridge = window[bridgeKey];
      if (!bridge) throw new Error("bridge not initialized");
      const fn = bridge[method];
      if (typeof fn !== "function")
        throw new Error(`bridge method missing: ${method}`);
      return fn(...args);
    },
    { bridgeKey, method, args },
  );
}

async function waitForBridgeReady(page) {
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(
    (key) => {
      const bridge = window[key];
      return !!bridge && typeof bridge.isReady === "function" && bridge.isReady();
    },
    bridgeKey,
    { timeout: 10000 },
  );
}

/**
 * Simulate a sequence of Korean jamo keystrokes.
 *
 * Each element in `jamoSequence` is an object describing one keystroke:
 *   { composing: string }              — intermediate composition (fires input)
 *   { commit: string, next?: string }  — syllable boundary: compositionend + optional new compositionstart
 *
 * Example for "한글":
 *   [
 *     { composing: "ㅎ", start: true },  // ㅎ key: compositionstart + input
 *     { composing: "하" },               // ㅏ key: input
 *     { composing: "한" },               // ㄴ key: input
 *     { commit: "한", next: "ㄱ" },      // ㄱ key: compositionend(한) + compositionstart + input(ㄱ)
 *     { composing: "그" },               // ㅡ key: input
 *     { composing: "글" },               // ㄹ key: input
 *     { commit: "글" },                  // done: compositionend(글)
 *   ]
 */
async function simulateJamoSequence(page, jamoSequence) {
  await bridgeCall(page, "focus");
  await sleep(50);

  await page.evaluate(
    ({ sequence }) => {
      const textarea = document.querySelector("#editor-container textarea");
      if (!textarea) throw new Error("hidden textarea not found");
      textarea.focus();

      for (const step of sequence) {
        if (step.start) {
          // Start a new composition session
          textarea.dispatchEvent(
            new CompositionEvent("compositionstart", { data: "" }),
          );
        }

        if (step.composing !== undefined) {
          // Intermediate jamo keystroke: update textarea value and fire input
          textarea.value = step.composing;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }

        if (step.commit !== undefined) {
          // Syllable complete: compositionend + post-compositionend input
          textarea.dispatchEvent(
            new CompositionEvent("compositionend", { data: step.commit }),
          );
          textarea.dispatchEvent(new Event("input", { bubbles: true }));

          if (step.next !== undefined) {
            // Next jamo immediately starts a new composition
            textarea.dispatchEvent(
              new CompositionEvent("compositionstart", { data: "" }),
            );
            textarea.value = step.next;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }
    },
    { sequence: jamoSequence },
  );

  await sleep(150);
}

// --- Scenarios ---

/**
 * Type "한" via individual jamo: ㅎ → ㅏ → ㄴ → commit
 * Real keystrokes: h, a, s on 2-set keyboard
 */
async function runSingleSyllableScenario(page, label) {
  await simulateJamoSequence(page, [
    { composing: "ㅎ", start: true }, // ㅎ
    { composing: "하" },              // ㅏ
    { composing: "한" },              // ㄴ
    { commit: "한" },                 // commit (e.g. space, enter, or blur)
  ]);

  const text = await bridgeCall(page, "getDocText");
  assert(
    text === "한",
    `[${label}] single syllable: expected "한", got "${text}"`,
  );
  console.log(`[verify:ime] [${label}] Passed: single syllable "한"`);
}

/**
 * Type "한글" via jamo: ㅎ ㅏ ㄴ ㄱ ㅡ ㄹ → commit
 * At ㄱ, syllable boundary: "한" commits, "ㄱ" starts new composition
 */
async function runTwoSyllableScenario(page, label) {
  await simulateJamoSequence(page, [
    { composing: "ㅎ", start: true }, // ㅎ
    { composing: "하" },              // ㅏ
    { composing: "한" },              // ㄴ
    { commit: "한", next: "ㄱ" },     // ㄱ: 한 commits, ㄱ starts new
    { composing: "그" },              // ㅡ
    { composing: "글" },              // ㄹ
    { commit: "글" },                 // commit
  ]);

  const text = await bridgeCall(page, "getDocText");
  assert(
    text === "한글",
    `[${label}] two syllables: expected "한글", got "${text}"`,
  );
  console.log(`[verify:ime] [${label}] Passed: two syllables "한글"`);
}

/**
 * Type "가나다" — three syllables with boundaries at each consonant
 * ㄱ ㅏ | ㄴ ㅏ | ㄷ ㅏ
 */
async function runThreeSyllableScenario(page, label) {
  await simulateJamoSequence(page, [
    { composing: "ㄱ", start: true }, // ㄱ
    { composing: "가" },              // ㅏ
    { commit: "가", next: "ㄴ" },     // ㄴ: 가 commits, ㄴ starts new
    { composing: "나" },              // ㅏ
    { commit: "나", next: "ㄷ" },     // ㄷ: 나 commits, ㄷ starts new
    { composing: "다" },              // ㅏ
    { commit: "다" },                 // commit
  ]);

  const text = await bridgeCall(page, "getDocText");
  assert(
    text === "가나다",
    `[${label}] three syllables: expected "가나다", got "${text}"`,
  );
  console.log(`[verify:ime] [${label}] Passed: three syllables "가나다"`);
}

/**
 * Type "abc" (English, no IME) then "한글" (Korean, IME)
 */
async function runMixedInputScenario(page, label) {
  // English: direct input, no composition
  await page.evaluate(() => {
    const textarea = document.querySelector("#editor-container textarea");
    if (!textarea) throw new Error("hidden textarea not found");
    textarea.focus();
    textarea.value = "abc";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(100);

  // Korean: ㅎㅏㄴㄱㅡㄹ
  await simulateJamoSequence(page, [
    { composing: "ㅎ", start: true },
    { composing: "하" },
    { composing: "한" },
    { commit: "한", next: "ㄱ" },
    { composing: "그" },
    { composing: "글" },
    { commit: "글" },
  ]);

  const text = await bridgeCall(page, "getDocText");
  assert(
    text === "abc한글",
    `[${label}] mixed: expected "abc한글", got "${text}"`,
  );
  console.log(`[verify:ime] [${label}] Passed: mixed input "abc한글"`);
}

/**
 * Type "받침" — batchim (final consonant) handling
 * ㅂ ㅏ ㄷ ㅊ ㅣ ㅁ
 * "바" → "받" → compositionend "받" + start "ㅊ" → "치" → "침"
 */
async function runBatchimScenario(page, label) {
  await simulateJamoSequence(page, [
    { composing: "ㅂ", start: true }, // ㅂ
    { composing: "바" },              // ㅏ
    { composing: "받" },              // ㄷ (batchim)
    { commit: "받", next: "ㅊ" },     // ㅊ: 받 commits, ㅊ starts
    { composing: "치" },              // ㅣ
    { composing: "침" },              // ㅁ (batchim)
    { commit: "침" },                 // commit
  ]);

  const text = await bridgeCall(page, "getDocText");
  assert(
    text === "받침",
    `[${label}] batchim: expected "받침", got "${text}"`,
  );
  console.log(`[verify:ime] [${label}] Passed: batchim "받침"`);
}

/**
 * Type "한글" then Backspace then "자"
 * Tests composition after deletion
 */
async function runComposeAfterDeleteScenario(page, label) {
  // Type "한글"
  await simulateJamoSequence(page, [
    { composing: "ㅎ", start: true },
    { composing: "하" },
    { composing: "한" },
    { commit: "한", next: "ㄱ" },
    { composing: "그" },
    { composing: "글" },
    { commit: "글" },
  ]);

  // Backspace to delete "글" → "한"
  await page.evaluate(() => {
    const textarea = document.querySelector("#editor-container textarea");
    if (!textarea) throw new Error("hidden textarea not found");
    textarea.focus();
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
    );
  });
  await sleep(100);

  // Type "자" via IME
  await simulateJamoSequence(page, [
    { composing: "ㅈ", start: true },
    { composing: "자" },
    { commit: "자" },
  ]);

  const text = await bridgeCall(page, "getDocText");
  assert(
    text === "한자",
    `[${label}] compose-after-delete: expected "한자", got "${text}"`,
  );
  console.log(`[verify:ime] [${label}] Passed: compose after delete "한자"`);
}

/**
 * Run all scenarios on a given browser context.
 * Each scenario gets a fresh page.
 */
async function runAllScenarios(context, label) {
  console.log(`[verify:ime] Running on ${label}...`);

  const scenarios = [
    ["single-syllable", runSingleSyllableScenario],
    ["two-syllable", runTwoSyllableScenario],
    ["three-syllable", runThreeSyllableScenario],
    ["mixed-input", runMixedInputScenario],
    ["batchim", runBatchimScenario],
    ["compose-after-delete", runComposeAfterDeleteScenario],
  ];

  for (const [, scenario] of scenarios) {
    const page = await context.newPage();
    try {
      await waitForBridgeReady(page);
      await scenario(page, label);
    } finally {
      await page.close();
    }
  }

  console.log(`[verify:ime] [${label}] All scenarios passed.`);
}

// --- Main ---

function printInstallHelp() {
  console.error("[verify:ime] Playwright browsers are required.");
  console.error(
    "[verify:ime] Install: `pnpm --filter @wafflebase/document exec playwright install chromium webkit`",
  );
}

async function loadPlaywright() {
  try {
    const module = await import("playwright");
    return module;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("Cannot find package") ||
      message.includes("Cannot find module")
    ) {
      printInstallHelp();
      process.exit(1);
    }
    throw error;
  }
}

const playwright = await loadPlaywright();

const server = await createServer({
  configFile: path.resolve(packageRoot, "vite.config.ts"),
  root: packageRoot,
  logLevel: "silent",
  server: { host, port, strictPort: true },
});

let chromiumBrowser;
let webkitBrowser;
let ranAnyScenario = false;

try {
  await server.listen();
  console.log(`[verify:ime] Dev server listening on ${targetUrl}`);

  // --- Chromium ---
  try {
    chromiumBrowser = await playwright.chromium.launch({ headless: true });
    const chromiumCtx = await chromiumBrowser.newContext({
      viewport: { width: 1024, height: 768 },
      locale: "ko-KR",
    });
    await runAllScenarios(chromiumCtx, "Chromium");
    await chromiumCtx.close();
    ranAnyScenario = true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Executable doesn't exist")) {
      console.warn("[verify:ime] Chromium not installed, skipping.");
    } else {
      throw error;
    }
  }

  // --- WebKit (Safari / Mobile Safari) ---
  try {
    webkitBrowser = await playwright.webkit.launch({ headless: true });
    const iPhoneDevice = playwright.devices["iPhone 14 Pro"];
    const webkitCtx = await webkitBrowser.newContext({
      ...iPhoneDevice,
      locale: "ko-KR",
    });
    await runAllScenarios(webkitCtx, "WebKit (iPhone 14 Pro)");
    await webkitCtx.close();
    ranAnyScenario = true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Executable doesn't exist")) {
      console.warn("[verify:ime] WebKit not installed, skipping.");
    } else {
      throw error;
    }
  }

  if (!ranAnyScenario) {
    console.error("[verify:ime] No browsers available — cannot verify IME behavior.");
    printInstallHelp();
    process.exit(1);
  }

  console.log("[verify:ime] All IME browser tests passed.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command")
  ) {
    printInstallHelp();
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
} finally {
  if (chromiumBrowser) await chromiumBrowser.close();
  if (webkitBrowser) await webkitBrowser.close();
  await server.close();
}
