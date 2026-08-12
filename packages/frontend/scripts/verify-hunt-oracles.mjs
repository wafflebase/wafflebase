// Prove the UI hunter's free oracles actually fire — and, just as importantly, that
// they DO NOT fire on the things they are scoped to ignore.
//
// WHY THIS EXISTS AS ITS OWN LANE. The oracles are the only part of the hunter that
// can report a defect without any model involvement, so an oracle that silently
// never fires makes the whole pipeline look clean while seeing nothing. That failure
// is invisible from the outside: a run with no findings and a run with a broken
// detector produce the same empty report.
//
// It also validates the baseline measurement taken before this was built: both
// existing browser lanes were reported clean of page errors, and "clean" only means
// something if the instrument is known to work.
//
// Faults are injected from the DRIVER, never from application code. There is no
// `?fault=` query parameter and no test-only branch in the harness route — the page
// under test is the page that ships, and Playwright supplies the damage.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import { attachOracles, scanDomInvariants } from "./hunt-ui-oracles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

const HOST = "127.0.0.1";
const PORT = Number(process.env.HUNT_ORACLES_PORT || 4178);
const READY_SELECTOR = "[data-testid='hunt-harness-root'][data-hunt-harness-ready='true']";
const HOST_TESTID = "hunt-harness-host";
const TOOLBAR_TESTID = "hunt-harness-toolbar";

/** How long silence must hold before a negative control counts as quiet. */
const QUIET_WINDOW_MS = 250;
/** How long a positive control may take to fire before it counts as a miss. */
const FIRE_DEADLINE_MS = 5_000;

/**
 * Each case injects one fault and names the oracle that must notice.
 *
 * `expect: null` is a NEGATIVE control — the case creates something that superficially
 * resembles a fault and asserts the oracle stays quiet. Those matter as much as the
 * positives: a false positive costs a maintainer's attention, and the two scoping
 * rules below (backend requests, editor-host text) are the two places this hunter is
 * most likely to report its own environment as a bug.
 */
const CASES = [
  {
    name: "clean page fires nothing",
    expect: null,
    inject: async () => {},
  },
  {
    name: "pageerror on an uncaught exception",
    expect: { kind: "pageerror" },
    inject: async (page) => {
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error("injected uncaught error");
        }, 0);
      });
    },
  },
  {
    name: "console-error on console.error",
    expect: { kind: "console-error" },
    inject: async (page) => {
      await page.evaluate(() => console.error("injected console error"));
    },
  },
  {
    name: "network-fail on a failed app asset",
    expect: { kind: "network-fail" },
    inject: async (page) => {
      await page.route("**/injected-asset.js", (route) => route.abort("failed"));
      await page.evaluate(() => fetch("/injected-asset.js").catch(() => {}));
    },
  },
  {
    // The scoping rule that keeps Tier 1 usable: there is no backend by
    // construction, so a failed API call is the environment, not a defect.
    name: "network-fail STAYS QUIET for an absent backend",
    expect: null,
    inject: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/auth/**", (route) => route.abort("failed"));
      await page.evaluate(() => fetch("/auth/me/doc-styles").catch(() => {}));
    },
  },
  {
    name: "dom-invariant on a duplicate element id",
    expect: { kind: "dom-invariant", rule: "duplicate-id" },
    inject: async (page) => {
      await page.evaluate(() => {
        for (const _ of [0, 1]) {
          const el = document.createElement("div");
          el.id = "injected-duplicate";
          document.body.appendChild(el);
        }
      });
    },
  },
  {
    name: "dom-invariant on a dangling aria reference",
    expect: { kind: "dom-invariant", rule: "dangling-aria-labelledby" },
    inject: async (page) => {
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.setAttribute("aria-labelledby", "injected-missing-label");
        document.body.appendChild(el);
      });
    },
  },
  {
    name: "dom-invariant on placeholder text in the chrome",
    expect: { kind: "dom-invariant", rule: "placeholder-text" },
    inject: async (page) => {
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.textContent = "Saved by undefined";
        document.body.appendChild(el);
      });
    },
  },
  {
    // Separate from the "undefined" case above, and not redundant with it: the
    // original regex wrapped one \b(...)\b around the whole alternation, which
    // matched "undefined" and "NaN" fine but required a word character immediately
    // outside the brackets of "[object Object]" — so the most common React
    // stringification bug of all was the one alternative that never fired. A test
    // that only injects "undefined" passes either way and proves nothing about it.
    name: "dom-invariant on a bare [object Object]",
    expect: { kind: "dom-invariant", rule: "placeholder-text" },
    inject: async (page) => {
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.textContent = "[object Object]";
        document.body.appendChild(el);
      });
    },
  },
  {
    // The other scoping rule: a user's DOCUMENT may legitimately contain the word
    // "undefined". Only the application's own chrome may not. Without this the first
    // thing a typing agent does is trip the oracle on its own input.
    name: "placeholder-text STAYS QUIET inside the editor host",
    expect: null,
    inject: async (page) => {
      await page.evaluate((hostTestId) => {
        const host = document.querySelector(`[data-testid="${hostTestId}"]`);
        // Throw rather than `host?.appendChild`. If the host selector ever drifts,
        // the optional-chaining form injects NOTHING, the oracle stays quiet, and
        // this negative control PASSES for entirely the wrong reason — a vacuous
        // test that asserts the scan ignores text it was never shown.
        if (!host) throw new Error(`negative control cannot run: no [data-testid="${hostTestId}"]`);
        const el = document.createElement("div");
        el.textContent = "the user typed undefined here";
        host.appendChild(el);
      }, HOST_TESTID);
    },
  },
];

/**
 * Cell-click targeting, checked alongside the oracles because it fails the same way:
 * silently, and only in the direction of wrong findings.
 *
 * `sheet.cellCenter` is the ONLY way to click something that exists purely as pixels
 * on a canvas. When it is wrong, every probe still succeeds — the click lands, the
 * page reacts, nothing errors — it just acts on the wrong cell, and a hunter reading
 * the result concludes the app mis-handles selection. Measured live: an origin error
 * of 43px made "click C3" select C1.
 */
const TARGETING_CELLS = ["A1", "A2", "A3", "B2", "C3", "D5"];

async function checkCellTargeting(page, baseUrl) {
  const problems = [];
  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  for (const ref of TARGETING_CELLS) {
    const point = await page.evaluate((r) => window.__WB_HUNT__.read("sheet.cellCenter", [r]), ref);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      problems.push(`sheet.cellCenter(${ref}) returned ${JSON.stringify(point)}`);
      continue;
    }
    await page.mouse.click(point.x, point.y);
    const active = await page.evaluate(() => window.__WB_HUNT__.read("sheet.activeCell"));
    if (active !== ref) {
      problems.push(`clicking sheet.cellCenter(${ref}) at (${point.x},${point.y}) selected ${active}`);
    }
  }
  return problems;
}

/**
 * Every reader in the registry must actually answer.
 *
 * WHY THIS IS THE HIGHEST-VALUE CHECK IN THE FILE. Only 5 of the 15 readers were
 * exercised by anything before this — `doc.text`, `doc.canUndo`, `sheet.activeCell`,
 * `sheet.canUndo`, `sheet.cellCenter`. The other ten had no coverage at all, and a
 * reader that returns `undefined`, throws, or quietly goes stale fails in the QUIET
 * direction: its predictions become `unevaluable`, `UNEVALUABLE IS NOT VIOLATED`, and
 * the hunter simply never finds anything in that area. Every run looks clean. That is
 * the same failure the drift test guards against from the other side — "a reader never
 * called is indistinguishable from an area with no defects".
 *
 * ASSERTIONS ARE AGAINST THE KNOWN SEED, deliberately, not against "returns
 * something". A reader that always answered `null` would satisfy a truthiness check
 * and satisfy `null-or-a-range` too — that vacuity is exactly how a green test sits on
 * top of a dead reader. So each expectation names content the seed actually contains.
 *
 * What is asserted is the SHAPE and the seeded CONTENT, never a limitation: this is a
 * capability check, in the same spirit as `checkUndoCapability`, so a product
 * improvement can never read as a regression here.
 */
const READER_EXPECTATIONS = [
  // --- doc surface, against seedDocument(): three paragraphs, mixed sizes/styles ---
  ["doc", "doc.text", [], (v) =>
    typeof v === "string" && v.includes("Small") && v.includes("lazy dog") ? null : "expected the seeded prose"],
  ["doc", "doc.blockCount", [], (v) => (Number.isInteger(v) && v >= 3 ? null : "expected an integer >= 3")],
  ["doc", "doc.runs", [], (v) =>
    Array.isArray(v) && v.length >= 3 && v.every((r) => typeof r?.text === "string")
      ? null
      : "expected >=3 runs each carrying text"],
  ["doc", "doc.fontSizes", [], (v) =>
    Array.isArray(v) && v.length >= 3 && v.some((n) => Number.isFinite(n))
      ? null
      : "expected one finite size per block"],
  ["doc", "doc.blockTypes", [], (v) =>
    Array.isArray(v) && v.includes("paragraph") ? null : "expected the seeded paragraph types"],
  ["doc", "doc.styleSummary", [], (v) =>
    v && typeof v === "object" && !Array.isArray(v) ? null : "expected a style-summary object"],
  ["doc", "doc.linkCount", [], (v) => (Number.isInteger(v) && v >= 0 ? null : "expected a non-negative integer")],
  ["doc", "doc.canUndo", [], (v) => (typeof v === "boolean" ? null : "expected a boolean")],

  // --- sheet surface, against seedGrid(): A1=10 A2=20 A3=30 B1=Label C1==A1+A2 ---
  ["sheet", "sheet.cellValue", ["A1"], (v) => (String(v) === "10" ? null : "expected the seeded A1 value 10")],
  ["sheet", "sheet.cellValue", ["B1"], (v) => (String(v) === "Label" ? null : "expected the seeded B1 value Label")],
  // The two halves of the value/formula distinction the rubric warns about, pinned so
  // a reader that collapsed them would be caught here rather than by a false finding.
  ["sheet", "sheet.cellFormula", ["C1"], (v) =>
    typeof v === "string" && v.replace(/\s/g, "").includes("=A1+A2") ? null : "expected C1's seeded formula"],
  ["sheet", "sheet.cellFormula", ["A1"], (v) =>
    v === null || v === undefined ? null : `a literal cell must have no formula, got ${JSON.stringify(v)}`],
  ["sheet", "sheet.activeCell", [], (v) => (typeof v === "string" && /^[A-Z]+\d+$/.test(v) ? null : "expected a cell ref")],
  ["sheet", "sheet.canUndo", [], (v) => (typeof v === "boolean" ? null : "expected a boolean")],
  // A1 carries no style in the seed, so `null` is the right answer and an OBJECT would
  // mean the reader had started resolving inherited values — which is the other
  // reader's job, and the confusion this pair is named to avoid.
  ["sheet", "sheet.rangeStyles", [], (v) => (Array.isArray(v) ? null : "expected an array of range-style patches")],
  ["sheet", "sheet.activeCellStyle", [], (v) =>
    v === null || (v && typeof v === "object" && !Array.isArray(v)) ? null : "expected a style object or null"],
  ["sheet", "sheet.cellCenter", ["B2"], (v) =>
    v && Number.isFinite(v.x) && Number.isFinite(v.y) ? null : "expected a finite point"],
];

/** Read one reader out of page context. `read` is async, so the promise is returned
 *  DIRECTLY from evaluate — Playwright awaits that, but not one nested in an object. */
function readReader(page, name, args) {
  return page
    .evaluate(([n, a]) => window.__WB_HUNT__.read(n, a), [name, args])
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error: String(error?.message ?? error) }));
}

async function checkReaderRegistry(page, baseUrl) {
  const problems = [];
  const seen = new Set();

  for (const surface of ["doc", "sheet"]) {
    await page.goto(`${baseUrl}/harness/hunt?surface=${surface}`, { waitUntil: "networkidle" });
    await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
    // `sheet.activeCell` needs a selection to report; the doc surface needs none.
    if (surface === "sheet") {
      const p = await readReader(page, "sheet.cellCenter", ["B2"]);
      if (p.ok) await page.mouse.click(p.value.x, p.value.y);
    }
    for (const [readerSurface, name, args, check] of READER_EXPECTATIONS) {
      if (readerSurface !== surface) continue;
      seen.add(name);
      const got = await readReader(page, name, args);
      if (!got.ok) {
        problems.push(`${name}(${args.join(",")}) threw: ${got.error.slice(0, 140)}`);
        continue;
      }
      // An unusable marker is a silent `unevaluable` forever — catch it here.
      if (got.value && typeof got.value === "object" && (got.value.__oversized || got.value.__unserializable)) {
        problems.push(`${name} returned an unusable marker: ${JSON.stringify(got.value)}`);
        continue;
      }
      const why = check(got.value);
      if (why) problems.push(`${name}(${args.join(",")}): ${why}, got ${JSON.stringify(got.value)?.slice(0, 120)}`);
    }
  }

  // A selection reader that always answered null would pass a null-or-range check, so
  // it is asserted in a state where a range MUST exist.
  await page.goto(`${baseUrl}/harness/hunt?surface=doc`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  // NO canvas click here, deliberately, and this cost a diagnostic detour worth
  // recording. `checkUndoCapability` clicks the canvas because it needs a caret
  // somewhere; doing the same here left `doc.selection` null forever, because
  // `.click()` targets the canvas CENTRE and the seeded document is three short
  // paragraphs at the top — the click lands in empty space below the text.
  //
  // The hunter never clicks the doc canvas: it has no reader that resolves to a
  // point on that surface, so it relies on the editor auto-focusing and types
  // straight away. Mirroring that is both the working setup and the faithful one.
  await page.keyboard.type("xyz");
  for (const _ of [0, 1, 2]) await page.keyboard.press("Shift+ArrowLeft");
  // Poll, for the same reason `checkUndoCapability` does: the selection lands
  // asynchronously relative to the keypress, and reading immediately measures the
  // instant BEFORE it exists. Still non-vacuous — if it never becomes a range the
  // deadline expires and the assertion below fails on the last value seen.
  let sel = await readReader(page, "doc.selection", []);
  const selDeadline = Date.now() + FIRE_DEADLINE_MS;
  while (sel.ok && (sel.value === null || sel.value === undefined) && Date.now() < selDeadline) {
    await page.waitForTimeout(25);
    sel = await readReader(page, "doc.selection", []);
  }
  seen.add("doc.selection");
  if (!sel.ok) problems.push(`doc.selection threw with a live selection: ${sel.error.slice(0, 140)}`);
  else if (!sel.value?.anchor?.blockId || !Number.isFinite(sel.value?.focus?.offset)) {
    problems.push(`doc.selection must report a range when one exists, got ${JSON.stringify(sel.value)?.slice(0, 120)}`);
  }

  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const b2 = await readReader(page, "sheet.cellCenter", ["B2"]);
  if (b2.ok) {
    await page.mouse.click(b2.value.x, b2.value.y);
    await page.keyboard.press("Shift+ArrowDown");
  }
  const range = await readReader(page, "sheet.selectionRange", []);
  seen.add("sheet.selectionRange");
  if (!range.ok) problems.push(`sheet.selectionRange threw with a live range: ${range.error.slice(0, 140)}`);
  else if (range.value === null || range.value === undefined) {
    problems.push("sheet.selectionRange must report a range after shift-extending a selection, got null");
  }

  // EVERY reader, or the next one added silently inherits zero coverage — which is the
  // state this check exists to end.
  const registered = await page.evaluate(() => window.__WB_HUNT__.readers().filter((n) => !n.startsWith("dom.")));
  for (const name of registered) {
    if (!seen.has(name)) problems.push(`${name} is registered but no expectation exercises it`);
  }
  return problems;
}

/**
 * A scrolled-away cell must REFUSE, not hand back a clickable-looking point.
 *
 * `checkCellTargeting` above proves clicks land correctly, but only on an unscrolled
 * grid — and the gap between those two facts produced a false finding on the first
 * live sheet run. The agent scrolled, asked for cells that had moved above the
 * viewport, got perfectly finite negative coordinates, clicked them, selected nothing,
 * and proposed "after the grid is scrolled, mouse clicks no longer select any cell" at
 * major severity, ground A, reproducing deterministically. Clicks after a scroll are
 * fine; the cells were not there. Only a verifier timeout stopped it being reported.
 *
 * Both halves are asserted, because a reader that refuses everything after a scroll
 * would be just as broken as one that refuses nothing.
 */
async function checkOffscreenRefusal(page, baseUrl) {
  const problems = [];
  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });

  // The wheel does nothing until the grid has focus, so click first — otherwise this
  // check silently tests an unscrolled grid and proves nothing.
  const start = await page.evaluate((r) => window.__WB_HUNT__.read("sheet.cellCenter", [r]), "C5");
  if (!start || !Number.isFinite(start.x)) {
    problems.push(`could not measure C5 to focus the grid, got ${JSON.stringify(start)} — this check cannot run`);
    return problems;
  }
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);

  const after = await page.evaluate(async () => {
    try {
      // `read` is ASYNC. Returning the promise inside an object serialises it as
      // `{}` — Playwright only awaits a promise returned DIRECTLY from evaluate.
      return { ok: true, value: await window.__WB_HUNT__.read("sheet.cellCenter", ["C5"]) };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
  if (after.ok) {
    problems.push(
      `a cell scrolled above the viewport must be refused, got ${JSON.stringify(after.value)} — ` +
        "a finite off-screen point is what manufactured the scroll false-finding",
    );
  } else if (!/off-screen/.test(after.error)) {
    problems.push(`the refusal must say the cell is off-screen, got ${after.error.slice(0, 120)}`);
  }

  // ...and a cell that IS visible after the same scroll still resolves and still
  // selects, or the guard has simply broken clicking.
  const visible = await page.evaluate(async () => {
    try {
      // `read` is ASYNC. Returning the promise inside an object serialises it as
      // `{}` — Playwright only awaits a promise returned DIRECTLY from evaluate.
      return { ok: true, value: await window.__WB_HUNT__.read("sheet.cellCenter", ["C45"]) };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
  if (!visible.ok) {
    problems.push(`an on-screen cell after a scroll must still resolve, got refusal: ${visible.error.slice(0, 120)}`);
  } else if (!visible.value || !Number.isFinite(visible.value.x) || !Number.isFinite(visible.value.y)) {
    problems.push(`an on-screen cell resolved to an unusable point: ${JSON.stringify(visible.value)}`);
  } else {
    await page.mouse.click(visible.value.x, visible.value.y);
    const active = await page.evaluate(() => window.__WB_HUNT__.read("sheet.activeCell"));
    if (active !== "C45") problems.push(`clicking a visible cell after a scroll selected ${active}, expected C45`);
  }
  return problems;
}

/**
 * Undo capability, checked because a prediction that assumes it produces a
 * confident FALSE finding when it is absent.
 *
 * Measured live: `MemStore.undo()` is a no-op ("No-op for memory store (no history
 * tracking)") while `MemDocStore` keeps real undo/redo stacks. So the same
 * prediction is sound on the doc surface and unsound on the sheet surface, and the
 * bridge exposes `canUndo` so a caller can tell which it is looking at.
 *
 * This asserts the POSITIVE capability only — that docs really can undo after an
 * edit. It deliberately does NOT assert that sheets cannot: that is a limitation
 * worth fixing, not a contract worth freezing, and pinning it would make an
 * improvement look like a regression. The sheet value is reported, not enforced.
 */
async function checkUndoCapability(page, baseUrl) {
  const problems = [];

  await page.goto(`${baseUrl}/harness/hunt?surface=doc`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const before = await page.evaluate(() => window.__WB_HUNT__.read("doc.canUndo"));
  if (before !== false) problems.push(`doc.canUndo should be false on a freshly seeded document, got ${JSON.stringify(before)}`);
  // NOT getByRole("textbox"): on the doc surface that resolves to the editor's hidden
  // IME textarea — `position:fixed;top:0;left:0;width:1px;height:1px;opacity:0`
  // (docs/src/view/text-editor.ts:416-425). Clicking a 1x1 invisible element pinned at
  // the viewport origin happens to work, but it is a caret-placement path no other
  // lane in this repo uses, and Playwright's visibility/stability checks on it are a
  // plausible 30s timeout that would fail the whole lane. The canvas is the real
  // target and is what a user clicks.
  await page.locator(`[data-testid="${HOST_TESTID}"] canvas`).first().click();
  await page.keyboard.type("Q");
  // Poll rather than sleep. The undo stack is pushed asynchronously relative to the
  // keystroke, so a fixed wait is either flaky on a loaded machine or needlessly slow —
  // and this lane gates CI. Same reasoning as the positive oracle cases above.
  let after = null;
  const deadline = Date.now() + FIRE_DEADLINE_MS;
  for (;;) {
    after = await page.evaluate(() => window.__WB_HUNT__.read("doc.canUndo"));
    if (after === true || Date.now() >= deadline) break;
    await page.waitForTimeout(25);
  }
  if (after !== true) {
    problems.push(
      `doc.canUndo was still ${JSON.stringify(after)} after an edit and ${FIRE_DEADLINE_MS}ms of polling — ` +
        "either the bridge reader is broken (harness fault) or docs undo regressed (product fault); " +
        "check MemDocStore's undo stack before assuming either.",
    );
  }

  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const sheetCanUndo = await page.evaluate(() => window.__WB_HUNT__.read("sheet.canUndo"));
  if (typeof sheetCanUndo !== "boolean") problems.push(`sheet.canUndo must answer with a boolean, got ${JSON.stringify(sheetCanUndo)}`);
  else console.log(`[verify:hunt-oracles] sheet.canUndo reports ${sheetCanUndo} (MemStore has no history — informational)`);

  return problems;
}

/**
 * The sheet toolbar, end to end: does a control reach the STORED style?
 *
 * The sheet surface ran without chrome until the toolbar was mounted, and every defect
 * this hunter has filed came from a toolbar control. So the question this answers is
 * not "is Bold correct" — it is whether the loop exists at all: a real control, acting
 * on a real selection, landing in a place a reader can see.
 *
 * It asserts on `sheet.rangeStyles` — the patch list the toolbar actually appends to —
 * rather than on any per-cell style. The first version of this check asserted the
 * latter and FAILED against a working toolbar: `applyStylePatchToExistingCells` skips
 * any cell that does not already carry its own style, so styling the populated,
 * unstyled B1 left `cell.s` null while the effective style correctly read `{b:true}`.
 * That measurement is why the per-cell reader was dropped before it shipped.
 *
 * DELIBERATELY NOT ASSERTED: what the second Bold click leaves behind.
 * `toggleRangeStyle` computes `!effective[prop]` and writes it, so bold-off stores
 * `b: false` rather than deleting the key. Whether that is a defect is a real question
 * — an explicit `false` is how a cell overrides a `true` inherited from a row or column
 * style — and pinning either answer here would either bless a defect or fail the lane
 * over one. That judgement belongs to the panel; this lane's job is to prove the
 * evidence is reachable.
 */
async function checkSheetToolbar(page, baseUrl) {
  const problems = [];

  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });

  const toolbar = await page.locator(`[data-testid="${TOOLBAR_TESTID}"]`).count();
  if (toolbar === 0) {
    problems.push("no toolbar is mounted on the sheet surface — the controls the hunter needs are absent");
    return problems;
  }

  // Select a cell through the reader the hunter itself must use, so a broken targeting
  // path fails here rather than as a mysterious empty run.
  // B1, NOT an empty cell. `setRangeStyle` appends a range patch and then "only
  // touch[es] already-populated cells", so styling an EMPTY cell leaves `cell.s` null
  // for ever. Measured here: the first version of this check clicked Bold on B2, which
  // the seed never populates, and read back `null` — correct behaviour that looks
  // exactly like a broken toolbar.
  const centre = await readReader(page, "sheet.cellCenter", ["B1"]);
  if (!centre.ok || !Number.isFinite(centre.value?.x)) {
    problems.push(`sheet.cellCenter did not yield a clickable point for B1: ${JSON.stringify(centre.value ?? centre.error)}`);
    return problems;
  }
  await page.mouse.click(centre.value.x, centre.value.y);

  const before = (await readReader(page, "sheet.rangeStyles", [])).value;
  const beforeCount = Array.isArray(before) ? before.length : -1;
  if (beforeCount !== 0) {
    problems.push(`the seed should carry no range styles, so an applied one is unambiguous — got ${JSON.stringify(before)?.slice(0, 120)}`);
    return problems;
  }

  await page.getByRole("button", { name: "Bold" }).click();
  await page.waitForTimeout(500);

  let after = null;
  const deadline = Date.now() + FIRE_DEADLINE_MS;
  for (;;) {
    after = (await readReader(page, "sheet.rangeStyles", [])).value;
    if ((Array.isArray(after) ? after.length : 0) > 0 || Date.now() >= deadline) break;
    await page.waitForTimeout(25);
  }
  const applied = Array.isArray(after) ? after : [];
  if (applied.length === 0) {
    problems.push(
      `clicking Bold appended no range style — got ${JSON.stringify(after)}. ` +
        "Either the toolbar is not wired to this spreadsheet instance (harness fault), the selection " +
        "never landed on B1 (harness fault), or setRangeStyle regressed (product fault).",
    );
  } else if (!applied.some((p) => p?.style?.b === true)) {
    problems.push(`a range style was appended but none of them is bold: ${JSON.stringify(applied).slice(0, 200)}`);
  }

  // The computed reader must ALSO see it. A patch that exists but does not reach the
  // cascade would mean the two readers are not describing one surface.
  const computed = (await readReader(page, "sheet.activeCellStyle", [])).value;
  if (computed?.b !== true) {
    problems.push(`sheet.activeCellStyle should report the applied bold on the active cell, got ${JSON.stringify(computed)}`);
  }

  return problems;
}

/**
 * Colour, end to end: apply one through the real toolbar, read it back PER RUN.
 *
 * `doc.runs` gained `color`/`backgroundColor` so colour defects become findable at
 * all. `doc.styleSummary` already reported colour, but selection-scoped and collapsed
 * to `'mixed'` — under which residue left in one run of three is indistinguishable
 * from a clean apply. Per-run structure is the whole point, so the assertion below is
 * not "the colour appears somewhere": it is that the marker run carries it and a
 * neighbour still reads `undefined`.
 *
 * This also exercises the only TWO-STEP control the hunter can reach (open a popover,
 * then pick from a grid). Every live run so far has used single-click toggles, so that
 * path had never been proven. Both halves are asserted here because both must hold for
 * colour to be huntable: a reader that reports nothing and a control the agent cannot
 * open are the same outcome from outside — a surface that never yields a finding.
 *
 * `#1A73E8` is a hardcoded literal in `TEXT_COLORS`, deliberately not one of the
 * `palette.*` entries: a token refresh must not be able to silently retarget this.
 */
async function checkRunColor(page, baseUrl) {
  const problems = [];
  const HEX = "#1A73E8";
  const MARKER = "ZZQ";

  await page.goto(`${baseUrl}/harness/hunt?surface=doc`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });

  // No canvas click, for the reason `checkReaderRegistry` records: the seeded document
  // is three short paragraphs at the top, so a centre click lands in empty space. The
  // editor auto-focuses and typing goes straight in — which is also what the hunter does.
  await page.keyboard.type(MARKER);
  for (const _ of MARKER) await page.keyboard.press("Shift+ArrowLeft");

  await page.getByRole("button", { name: "Text color" }).click();
  await page.getByRole("button", { name: `Select text color ${HEX}` }).click();

  // Poll: the style lands asynchronously relative to the click, same as everywhere else
  // in this lane. Non-vacuous — if it never lands, the assertions run on the last read.
  let runs = [];
  const deadline = Date.now() + FIRE_DEADLINE_MS;
  for (;;) {
    const got = await readReader(page, "doc.runs", []);
    runs = got.ok && Array.isArray(got.value) ? got.value : [];
    if (runs.some((r) => r?.color === HEX) || Date.now() >= deadline) break;
    await page.waitForTimeout(25);
  }

  const colored = runs.filter((r) => r?.color === HEX);
  if (colored.length === 0) {
    problems.push(
      `doc.runs reported no run with color ${HEX} after applying it through the toolbar — ` +
        "either the reader dropped the field (harness fault), the swatch's accessible name changed " +
        "(harness fault, the agent targets controls by name), or applyStyle regressed (product fault).",
    );
  } else if (colored.length > 1) {
    problems.push(`applying a colour to "${MARKER}" coloured ${colored.length} runs, expected exactly 1`);
  } else if (colored[0].text !== MARKER) {
    problems.push(`the coloured run should be "${MARKER}", got ${JSON.stringify(colored[0].text)}`);
  } else if (colored[0].backgroundColor !== undefined) {
    // The two fields are independent; a reader wiring both to `style.color` would pass
    // every assertion above.
    problems.push(`a text colour must not populate backgroundColor, got ${JSON.stringify(colored[0].backgroundColor)}`);
  }

  // The per-run claim: an uncoloured neighbour must still read `undefined`. A reader
  // that stamped every run with the same colour would satisfy everything above.
  if (colored.length === 1 && !runs.some((r) => r?.text !== MARKER && r?.color === undefined)) {
    problems.push("every run reported a colour — doc.runs must distinguish a styled run from an unstyled one");
  }

  // --- what `doc.styleSummary` is, asserted rather than described --------------
  //
  // Its tool description used to read "which inline styles are present anywhere in the
  // document". It is `getRangeStyleSummary()`, which reads the CURRENT SELECTION — and
  // the explorer's only map of this surface is that description, so the wrong scope is
  // a false-finding source rather than a documentation nit. The corrected line now
  // claims selection scope, and a claim nothing checks is how the old one drifted.
  //
  // The proof is that ONE document answers differently for two selections, which a
  // document-wide summary could not do: the marker alone reports a concrete colour,
  // and widening by a single uncoloured character collapses it to 'mixed'. That
  // collapse is also the reason per-run colour had to exist — 'mixed' is precisely
  // what cannot distinguish residue in one run from a clean apply.
  const onMarker = await readReader(page, "doc.styleSummary", []);
  if (onMarker.value?.color !== HEX) {
    problems.push(`doc.styleSummary should report ${HEX} for a selection covering only the coloured run, got ${JSON.stringify(onMarker.value)}`);
  }

  // Radix restores focus to the editor's hidden textarea ASYNCHRONOUSLY as the popover
  // closes, and arrow keys sent into that window are swallowed silently — measured: five
  // presses left `doc.selection` byte-identical while the textarea already reported
  // focus and typing still worked. Wait for the close to settle rather than sleeping
  // through it. (Not an agent-facing trap: an SDK round-trip between actions is orders
  // of magnitude longer than this window. It is a hazard for anything driving faster
  // than a human, which is exactly what this lane does.)
  await page.locator("[data-radix-popper-content-wrapper]").waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", null, { timeout: 5_000 }).catch(() => {});

  // The selection is backward (anchor after focus, focus at offset 0), so ArrowLeft
  // collapses to the block start and the marker plus one more character can be taken
  // rightward. Measured, not assumed — a Shift+ArrowLeft here is a silent no-op.
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i <= MARKER.length; i++) await page.keyboard.press("Shift+ArrowRight");
  let wider = null;
  const widerDeadline = Date.now() + FIRE_DEADLINE_MS;
  for (;;) {
    wider = (await readReader(page, "doc.styleSummary", [])).value;
    if (wider?.color === "mixed" || Date.now() >= widerDeadline) break;
    await page.waitForTimeout(25);
  }
  if (wider?.color !== "mixed") {
    problems.push(
      `doc.styleSummary must be SELECTION-scoped: widening past the coloured run should read 'mixed', got ${JSON.stringify(wider)}. ` +
        "If this reads the same as the narrower selection, the reader went document-wide and its tool description is now wrong.",
    );
  }

  return problems;
}

/**
 * The seeded positive control: does a KNOWN defect actually show up?
 *
 * Everything else in this file is a negative control — it proves the hunter does not
 * report things that are fine. Nothing proved the opposite, and the two failures look
 * identical from outside: a run that finds nothing because the app is healthy and a
 * run that finds nothing because the instrument is dead both print zero.
 *
 * `?fault=drop-second-char` makes the harness swallow every second printable
 * keystroke. Typing `ABCDEF` must therefore produce `ACE`. That is the cleanest
 * possible ground-A shape — the app contradicting the agent's own input — so if the
 * funnel can carry anything, it can carry this.
 *
 * BOTH DIRECTIONS ARE ASSERTED, and the second matters as much as the first. A fault
 * that is always on would make every run report, which is a worse failure than a
 * fault that never fires: it manufactures findings rather than merely missing them.
 */
const FAULT_TYPED = "ABCDEF";
const FAULT_EXPECTED_WITH_FAULT = "ACE";

async function typeIntoDoc(page, baseUrl, query) {
  await page.goto(`${baseUrl}/harness/hunt?surface=doc${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const before = await page.evaluate(() => window.__WB_HUNT__.read("doc.text"));
  await page.locator(`[data-testid="${HOST_TESTID}"] canvas`).first().click();
  await page.keyboard.type(FAULT_TYPED);
  // Poll for settlement rather than sleeping: the text lands asynchronously relative
  // to the keystrokes, and this lane gates CI.
  let text = before;
  const deadline = Date.now() + FIRE_DEADLINE_MS;
  for (;;) {
    const next = await page.evaluate(() => window.__WB_HUNT__.read("doc.text"));
    if (next !== before && next === text) break;
    text = next;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(25);
  }
  return { before, after: text };
}

async function checkSeededFault(page, baseUrl) {
  const problems = [];

  // 1. The fault is DECLARED in the DOM, so a seeded run can never be mistaken for a
  //    real one when someone reads a report or a screenshot later.
  await page.goto(`${baseUrl}/harness/hunt?surface=doc&fault=drop-second-char`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const declared = await page.getAttribute("[data-testid='hunt-harness-root']", "data-hunt-harness-fault");
  if (declared !== "drop-second-char") {
    problems.push(`the active fault must be published on the root, got ${JSON.stringify(declared)}`);
  }

  // 2. An UNKNOWN fault id is ignored, not honoured. The registry is closed, so a
  //    typo must degrade to a clean run rather than to some other defect.
  await page.goto(`${baseUrl}/harness/hunt?surface=doc&fault=not-a-real-fault`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const unknown = await page.getAttribute("[data-testid='hunt-harness-root']", "data-hunt-harness-fault");
  if (unknown !== "none") problems.push(`an unknown fault id must be ignored, got ${JSON.stringify(unknown)}`);

  // 3. WITH the fault: every second character is dropped.
  const seeded = await typeIntoDoc(page, baseUrl, "&fault=drop-second-char");
  if (!seeded.after.includes(FAULT_EXPECTED_WITH_FAULT)) {
    problems.push(
      `?fault=drop-second-char: typed ${FAULT_TYPED}, expected the document to contain ` +
        `${FAULT_EXPECTED_WITH_FAULT}, got ${JSON.stringify(seeded.after.slice(0, 120))} — the positive ` +
        "control is not injecting, so a clean hunt run proves nothing",
    );
  }
  if (seeded.after.includes(FAULT_TYPED)) {
    problems.push(`?fault=drop-second-char: the full ${FAULT_TYPED} survived, so nothing was dropped`);
  }

  // 4. WITHOUT it: the text arrives intact. This is the half that keeps a
  //    permanently-on fault from turning every run into a false report.
  const clean = await typeIntoDoc(page, baseUrl, "");
  if (!clean.after.includes(FAULT_TYPED)) {
    problems.push(
      `the CLEAN route dropped characters: typed ${FAULT_TYPED}, got ` +
        `${JSON.stringify(clean.after.slice(0, 120))} — either the fault leaked across navigations or ` +
        "typing is genuinely broken, and those need opposite responses",
    );
  }

  return problems;
}

/**
 * The join nothing else covers: does a REAL reader value, produced by the real
 * runner, actually drive the prediction protocol to a violated verdict?
 *
 * Every piece either side of this line is unit-tested. `assessExpectation` is tested
 * against hand-written journals, and the runner is tested against scripted
 * observations. Neither proves they fit, and a hand-written fixture asserting a
 * property the pipeline does not have is the single most repeated defect in this
 * whole build — a test named for a property, passing, while the property was false.
 *
 * So this drives `runUiPlan` (a real browser, a real journal) and hands the result to
 * `assessExpectation` unmodified. It costs one extra Vite+Chromium boot (~7s) and
 * that is the price of exercising the real producer rather than a stand-in.
 *
 * The plan is the canonical ground-A shape: type something, then on a LATER action
 * predict that the document still contains it, traced to `@input:` — the agent's own
 * keystrokes. With the fault seeded that must be `violated` AND `eligible`; without
 * it, `held`. Both directions, because a protocol that always violates is worse than
 * one that never does.
 */
const FUNNEL_PLAN = {
  actions: [
    { type: "goto", surface: "doc" },
    { type: "read", reader: "doc.text" },
    { type: "type", text: FAULT_TYPED },
    {
      type: "type",
      text: "!",
      expect: {
        read: "doc.text",
        op: "contains",
        value: "@input:2",
        ground: "A",
        because: "the document must still contain what I typed a moment ago",
      },
    },
  ],
};

async function checkPredictionFunnel(repoRoot) {
  const problems = [];
  const { runUiPlan } = await import(`${repoRoot}/scripts/agent/hunt-ui-probe.mjs`);
  const { assessExpectation } = await import(`${repoRoot}/scripts/agent/hunt-ui-expect.mjs`);

  // The journal the MCP tool would have built, assembled from what the runner
  // actually returned — never hand-authored, which is the entire point.
  const journalFrom = (observations) =>
    observations.map((o, i) => ({
      action: FUNNEL_PLAN.actions[i],
      ok: o.ok === true,
      value: o.value,
      error: o.ok ? undefined : o.error,
      oracles: o.oracles ?? [],
    }));

  for (const [label, fault, wantVerdict] of [
    ["seeded", "drop-second-char", "violated"],
    ["clean", null, "held"],
  ]) {
    let observations;
    try {
      observations = runUiPlan(FUNNEL_PLAN, { repoRoot, attempts: 1, fault })[0];
    } catch (error) {
      problems.push(`${label}: the plan could not run — ${error.message}`);
      continue;
    }
    const atIndex = FUNNEL_PLAN.actions.length - 1;
    const failing = observations[atIndex];
    const prediction = assessExpectation(FUNNEL_PLAN.actions[atIndex].expect, failing?.actual, {
      journal: journalFrom(observations),
      snapshot: "",
      charter: {},
      actualError: failing?.actualError ?? null,
      atIndex,
    });
    if (prediction.verdict !== wantVerdict) {
      problems.push(
        `${label}: expected the prediction to be ${wantVerdict}, got ${prediction.verdict}` +
          ` (${prediction.detail ?? "no detail"}); read back ${JSON.stringify(String(failing?.actual).slice(0, 80))}`,
      );
    }
    // A violation that is not ELIGIBLE never becomes a candidate, so a funnel that
    // violates but grounds nothing is still a dead instrument.
    if (wantVerdict === "violated" && prediction.eligible !== true) {
      problems.push(
        `${label}: the violation was not eligible — ${prediction.why ?? "no reason given"}. A ground-A ` +
          "prediction traced to the agent's own input must ground, or nothing can ever be reported.",
      );
    }
  }
  return problems;
}

/**
 * The seeded control, through SERVE mode — the path the explorer actually uses.
 *
 * `checkPredictionFunnel` drives `--plan`, which is the REPLAY path. Those are two
 * different code paths in the runner, and covering only one is how this shipped
 * broken: `serve()` accepted `--fault` and never forwarded it to `observeAction`, so
 * the control worked under `--plan`, passed its own lane, and was inert for every
 * exploration session. A positive control that only proves itself is worth nothing.
 *
 * So this opens a real session the way `exploreUi` does and asserts the fault reaches
 * it. Both directions again, for the same reason as everywhere else.
 */
async function checkSeededFaultInServeMode(repoRoot) {
  const problems = [];
  const { openUiSession } = await import(`${repoRoot}/scripts/agent/hunt-ui-session.mjs`);

  for (const [label, fault, wantContains] of [
    ["seeded", "drop-second-char", "ACE"],
    ["clean", null, FAULT_TYPED],
  ]) {
    let session;
    try {
      session = await openUiSession({ repoRoot, fault });
      await session.act({ type: "goto", surface: "doc" });
      await session.act({ type: "type", text: FAULT_TYPED });
      const read = await session.act({ type: "read", reader: "doc.text" });
      const text = String(read?.value ?? "");
      if (!text.includes(wantContains)) {
        problems.push(
          `${label}: typed ${FAULT_TYPED} through a live session, expected the document to contain ` +
            `${wantContains}, got ${JSON.stringify(text.slice(0, 120))}`,
        );
      }
      if (fault && text.includes(FAULT_TYPED)) {
        problems.push(`${label}: the full ${FAULT_TYPED} survived serve mode — the fault is not reaching the explorer's path`);
      }
    } catch (error) {
      problems.push(`${label}: the session failed — ${error.message}`);
    } finally {
      await session?.close();
    }
  }
  return problems;
}

async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    if (!mod.chromium) throw new Error("Playwright chromium launcher is unavailable.");
    return mod;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Cannot find package 'playwright'") || message.includes("Cannot find module 'playwright'")) {
      console.error("[verify:hunt-oracles] Playwright is required. Run `pnpm install`, then");
      console.error("[verify:hunt-oracles] `pnpm --filter @wafflebase/frontend exec playwright install chromium`.");
      process.exit(1);
    }
    throw error;
  }
}

function matches(fired, expected) {
  return fired.some((f) => f.kind === expected.kind && (expected.rule === undefined || f.rule === expected.rule));
}

const playwright = await loadPlaywright();
const server = await createServer({
  configFile: path.resolve(frontendRoot, "vite.config.ts"),
  root: frontendRoot,
  logLevel: "silent",
  server: { host: HOST, port: PORT, strictPort: true },
});

let browser;
const failures = [];
try {
  await server.listen();
  const baseUrl = `http://${HOST}:${PORT}`;
  browser = await playwright.chromium.launch({ headless: true });

  for (const testCase of CASES) {
    // A fresh context per case, so one case's injected damage cannot leak into the
    // next and make a later oracle look like it fired on its own.
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();
      await page.route("**/auth/**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ styles: {} }) }),
      );
      const oracles = attachOracles(page, baseUrl);
      await page.goto(`${baseUrl}/harness/hunt?surface=doc`, { waitUntil: "networkidle" });
      await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
      // Drain anything from page load itself. A case asserts about ITS fault, and a
      // load-time event would otherwise be credited to the injection.
      oracles.drain();

      await testCase.inject(page);

      // Positive and negative cases need opposite waiting strategies, and a single
      // fixed sleep gets one of them wrong. Proving something DID happen can stop as
      // soon as it happens, so poll — a fixed delay there is either flaky (too short
      // on a loaded machine) or slow. Proving something did NOT happen has no early
      // exit: the full window must elapse before silence means anything.
      let fired = [];
      if (testCase.expect === null) {
        await page.waitForTimeout(QUIET_WINDOW_MS);
        fired = [...oracles.drain(), ...(await scanDomInvariants(page, HOST_TESTID))];
      } else {
        const deadline = Date.now() + FIRE_DEADLINE_MS;
        // Page-event drains ACCUMULATE (each drain empties the buffer, so an event
        // seen on an earlier poll would be lost); the DOM scan is a fresh snapshot of
        // current state each time and must replace, not append, or a finding would be
        // duplicated once per poll in the failure message.
        const drained = [];
        for (;;) {
          drained.push(...oracles.drain());
          fired = [...drained, ...(await scanDomInvariants(page, HOST_TESTID))];
          if (matches(fired, testCase.expect) || Date.now() >= deadline) break;
          await page.waitForTimeout(25);
        }
      }

      if (testCase.expect === null) {
        if (fired.length > 0) {
          failures.push(`${testCase.name}: expected silence, got ${JSON.stringify(fired)}`);
        } else {
          console.log(`[verify:hunt-oracles] quiet as required: ${testCase.name}`);
        }
      } else if (!matches(fired, testCase.expect)) {
        failures.push(
          `${testCase.name}: expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(fired) || "nothing"}`,
        );
      } else {
        console.log(`[verify:hunt-oracles] fired as required: ${testCase.name}`);
      }
    } finally {
      await context.close();
    }
  }

  // Targeting, in its own context so no injected fault from the cases above can
  // perturb the grid it measures.
  const targetingContext = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  });
  try {
    const page = await targetingContext.newPage();
    const problems = await checkCellTargeting(page, baseUrl);
    for (const p of problems) failures.push(`cell targeting: ${p}`);
    if (problems.length === 0) {
      console.log(`[verify:hunt-oracles] cell clicks land correctly: ${TARGETING_CELLS.join(", ")}`);
    }
    const readerProblems = await checkReaderRegistry(page, baseUrl);
    for (const p of readerProblems) failures.push(`reader registry: ${p}`);
    if (readerProblems.length === 0) {
      console.log("[verify:hunt-oracles] every registered reader answers, against the seeded content");
    }
    const offscreenProblems = await checkOffscreenRefusal(page, baseUrl);
    for (const p of offscreenProblems) failures.push(`off-screen cell: ${p}`);
    if (offscreenProblems.length === 0) {
      console.log("[verify:hunt-oracles] a scrolled-away cell refuses, and a visible one still clicks");
    }
    const sheetToolbarProblems = await checkSheetToolbar(page, baseUrl);
    for (const p of sheetToolbarProblems) failures.push(`sheet toolbar: ${p}`);
    if (sheetToolbarProblems.length === 0) {
      console.log("[verify:hunt-oracles] a sheet toolbar click appends a range style the readers can see");
    }
    const colorProblems = await checkRunColor(page, baseUrl);
    for (const p of colorProblems) failures.push(`run colour: ${p}`);
    if (colorProblems.length === 0) {
      console.log("[verify:hunt-oracles] a toolbar-applied colour reads back on exactly its own run");
    }
    const undoProblems = await checkUndoCapability(page, baseUrl);
    for (const p of undoProblems) failures.push(`undo capability: ${p}`);
    if (undoProblems.length === 0) {
      console.log("[verify:hunt-oracles] doc.canUndo tracks a real undo stack");
    }
    const faultProblems = await checkSeededFault(page, baseUrl);
    for (const p of faultProblems) failures.push(`seeded fault: ${p}`);
    if (faultProblems.length === 0) {
      console.log("[verify:hunt-oracles] ?fault=drop-second-char injects, and the clean route does not");
    }
  } finally {
    await targetingContext.close();
  }

  // Outside the context above: this one drives `runUiPlan`, which owns its own
  // browser and its own Vite. It is the last check because it is the slowest.
  const repoRoot = path.resolve(frontendRoot, "..", "..");
  const funnelProblems = await checkPredictionFunnel(repoRoot);
  for (const p of funnelProblems) failures.push(`prediction funnel: ${p}`);
  if (funnelProblems.length === 0) {
    console.log("[verify:hunt-oracles] a real reader value drives a ground-A prediction to violated, and holds when clean");
  }

  const serveProblems = await checkSeededFaultInServeMode(repoRoot);
  for (const p of serveProblems) failures.push(`seeded fault (serve mode): ${p}`);
  if (serveProblems.length === 0) {
    console.log("[verify:hunt-oracles] the seeded fault also reaches SERVE mode, which is the explorer's path");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Executable doesn't exist") || message.includes("download new browsers")) {
    console.error("[verify:hunt-oracles] Chromium is not installed for this Playwright version.");
    console.error("[verify:hunt-oracles] Run `pnpm --filter @wafflebase/frontend exec playwright install chromium`.");
    process.exit(1);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.error(`\n[verify:hunt-oracles] ${failures.length} oracle check(s) FAILED:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `[verify:hunt-oracles] all ${CASES.length} oracle checks + cell targeting + undo capability + seeded fault + prediction funnel passed.`,
);
