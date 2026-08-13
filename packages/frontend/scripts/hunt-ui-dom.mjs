// WHAT EXISTS ON THE PAGE, so "never tried" is computable.
//
// The coverage memory can say "you already used Bold" from past journals, but it has no
// DENOMINATOR: a control nobody has ever clicked appears in no journal, so it is
// invisible to a memory built from them. `Clear formatting` sat unclicked for eight doc
// runs purely because no text named it, and the moment one did it was exercised properly
// and answered a real question. This is that list, derived instead of written.
//
// It also ends the guessing. `target` takes `{role, name}` and nothing enumerated them,
// so the explorer had to guess accessible names and a wrong guess is a failed action —
// which is a plausible part of why the sheet persona, on a surface with fewer guessable
// names, produced nothing across six runs.
//
// DELIBERATELY NARROWER THAN `dom.snapshot`. Roles and names only: no text content, no
// positions, no state, no ordering promises beyond a stable sort. The design keeps the
// page hard to DESCRIBE so the explorer predicts rather than narrates, and a list of
// things that can be clicked does not tell it what any of them did.
//
// ITS OWN MODULE, not a function in the runner, because `hunt-ui-runner.mjs` parses argv
// and exits at import time — importing it from the oracle lane runs the CLI. The lane has
// to exercise the REAL implementation rather than a copy of the query, or the check and
// the reader drift apart and the check starts passing for the wrong reason.

/**
 * Every control that can be clicked right now, as `{role, name}`, stably sorted.
 *
 * Two exclusions, each a way the list would otherwise mislead:
 *
 *   DISABLED controls are omitted rather than reported. Offering one costs the explorer
 *   a wasted action, and a control that does nothing when clicked is exactly the shape
 *   of a false finding. Their absence leaks less than their state would.
 *
 *   ZERO-SIZE controls are omitted because they cannot be hit. A name that resolves to
 *   something unclickable sends a run at a dead target, which is the failure this reader
 *   exists to prevent rather than to cause.
 */
export function domControls(page) {
  return page.evaluate(() => {
    const ROLES = ["button", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "link"];
    const seen = new Set();
    const out = [];
    for (const el of document.querySelectorAll("button, [role], a[href]")) {
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const explicit = el.getAttribute("role");
      const role = explicit || (el.tagName === "BUTTON" ? "button" : el.tagName === "A" ? "link" : "");
      if (!ROLES.includes(role)) continue;

      // `aria-label` first, because that is what `getByRole`'s accessible-name
      // computation prefers — a list keyed on anything else would name controls the
      // explorer's own targeting cannot then find.
      const name = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
      if (name === "") continue;

      const key = `${role}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ role, name });
    }
    return out.sort((a, b) => `${a.role}${a.name}`.localeCompare(`${b.role}${b.name}`));
  });
}
