// The FREE oracles — properties that hold for any correct web application, checked
// after every action at zero model cost.
//
// The lineage is Crawljax/ATUSA's "generic invariants": a DOM should have unique
// element ids, no dangling ARIA references, and no error state on screen. None of
// these needs a specification, a baseline, or a judgment call, which is exactly why
// they are the first thing the hunter checks — anything a model does not have to
// decide is something it cannot be wrong about.
//
// Extracted from the runner so `verify-hunt-oracles.mjs` exercises the SAME code the
// hunter runs. A verification script with its own copy of the oracle would prove
// only that the copy works.

/**
 * Is a failed request evidence of a defect, or just the absent backend?
 *
 * Tier 1 runs with NO backend by construction, so every API call fails and none of
 * those failures says anything about the code under test. Scoping by URL shape
 * rather than by an endpoint list is what keeps this from being a maintenance
 * treadmill: what matters is whether the app failed to load *its own* assets, which
 * are the only same-origin paths Vite actually serves.
 *
 * `/undefined/` is in the exclusion list because `VITE_BACKEND_API_URL` is unset in
 * the harness, so `${undefined}/auth/me/doc-styles` resolves to a same-origin URL
 * beginning with that literal segment.
 */
export function isAppAssetRequest(url, baseUrl) {
  if (typeof url !== "string" || typeof baseUrl !== "string") return false;
  if (!url.startsWith(baseUrl)) return false;
  const p = url.slice(baseUrl.length).split("?")[0];
  if (p.startsWith("/auth/") || p.startsWith("/api/") || p.startsWith("/undefined/")) return false;
  return true;
}

/**
 * DOM invariants, evaluated in-page.
 *
 * The placeholder-text scan deliberately EXCLUDES the editor host. A user's document
 * may legitimately contain the word "undefined"; the application's own chrome may
 * not. Without that scoping the first thing a typing agent does is trip this, and a
 * hunter whose first finding is its own harness is worse than no hunter.
 */
export const DOM_INVARIANT_SCAN = /* js */ `(hostTestId) => {
  const findings = [];

  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    if (!id) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) findings.push({ kind: 'dom-invariant', rule: 'duplicate-id', detail: id + ' x' + count });
  }

  for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
    for (const el of document.querySelectorAll('[' + attr + ']')) {
      for (const ref of (el.getAttribute(attr) || '').split(/\\s+/).filter(Boolean)) {
        if (!document.getElementById(ref)) {
          findings.push({ kind: 'dom-invariant', rule: 'dangling-' + attr, detail: ref });
        }
      }
    }
  }

  const host = document.querySelector('[data-testid="' + hostTestId + '"]');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  // Per-alternative boundaries, NOT one \\b(...)\\b around the group. \\b asserts a
  // word/non-word transition, and '[' and ']' are both non-word, so the grouped form
  // required a word character immediately outside the brackets: "[object Object]"
  // and "value: [object Object]" both MISSED, and only "x[object Object]y" matched.
  // The bracket literals are self-delimiting and need no boundary of their own.
  const bad = /\\bundefined\\b|\\bNaN\\b|\\[object Object\\]/;
  let node;
  while ((node = walker.nextNode())) {
    if (host && host.contains(node)) continue;
    const text = (node.nodeValue || '').trim();
    if (text && bad.test(text)) {
      // One finding per action, deliberately. This is a DETECTOR: the verdict is the
      // same whether one label or five render "undefined", \`uiObservedKey\` collapses
      // repeats of a rule to a single entry anyway, and an unbounded walk over a
      // large DOM would put the whole page into the observation.
      findings.push({ kind: 'dom-invariant', rule: 'placeholder-text', detail: text.slice(0, 120) });
      break;
    }
  }

  return findings;
}`;

/**
 * Errors that mean "the page moved under us", not "the scan is broken".
 *
 * A navigation, a closed context or a detached frame mid-scan is expected — the next
 * action re-scans. Anything else is the scan itself failing.
 */
const TRANSIENT_EVAL_ERROR =
  /Execution context was destroyed|Target (page, context or browser has been )?closed|frame (was )?detached|Navigation/i;

/**
 * Run the DOM invariant scan once.
 *
 * A blanket `catch { return [] }` here would be the exact failure this whole lane
 * exists to prevent: a syntax error in `DOM_INVARIANT_SCAN` would make the oracle
 * return "no findings" forever, and a run with a dead detector is indistinguishable
 * from a clean run. So only the transient cases are swallowed; a real scan failure
 * propagates and takes the attempt down loudly.
 */
export async function scanDomInvariants(page, hostTestId) {
  try {
    return await page.evaluate(`(${DOM_INVARIANT_SCAN})(${JSON.stringify(hostTestId)})`);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (TRANSIENT_EVAL_ERROR.test(message)) return [];
    throw new Error(`hunt-ui-oracles: DOM invariant scan failed — ${message}`);
  }
}

/**
 * Subscribe to the page-level oracles.
 *
 * These fire asynchronously, so events are buffered and DRAINED after each action.
 * Attributing an error to the action that caused it is the whole point; a single
 * end-of-run tally would lose that and leave a 200-action plan saying only
 * "something threw somewhere".
 */
export function attachOracles(page, baseUrl) {
  const buffer = [];
  page.on("pageerror", (err) => {
    buffer.push({
      kind: "pageerror",
      name: err?.name ?? "Error",
      detail: String(err?.message ?? err),
      stack: typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 6).join("\n") : null,
    });
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // A failed request makes the BROWSER log a console error of its own
    // ("Failed to load resource: net::ERR_FAILED") whose location is the failed URL.
    // Without this, scoping `network-fail` to app assets achieves nothing: Tier 1 has
    // no backend, so every API call the app makes would still be reported here — by a
    // different oracle. The origin rule has to apply to messages ABOUT requests too,
    // or it only half-applies. Caught by `verify-hunt-oracles.mjs`'s negative control,
    // which is exactly what that case exists for.
    const url = msg.location?.()?.url;
    if (url && !isAppAssetRequest(url, baseUrl)) return;
    buffer.push({ kind: "console-error", detail: msg.text().slice(0, 500) });
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!isAppAssetRequest(url, baseUrl)) return;
    buffer.push({ kind: "network-fail", detail: `${req.method()} ${url} — ${req.failure()?.errorText ?? "failed"}` });
  });
  page.on("response", (res) => {
    if (res.status() < 500) return;
    if (!isAppAssetRequest(res.url(), baseUrl)) return;
    buffer.push({ kind: "network-fail", detail: `${res.status()} ${res.url()}` });
  });
  return { drain: () => buffer.splice(0, buffer.length) };
}
