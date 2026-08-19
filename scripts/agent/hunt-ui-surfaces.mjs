// THE SURFACE VOCABULARY, written down once.
//
// WHY ITS OWN MODULE. Four places decided what a surface is, and they disagreed in the
// dangerous direction. `assertSafeActionPlan` refuses an unknown surface LOUDLY, before a
// browser boots. The runner and the harness page both COERCED instead:
//
//     hunt-ui-runner.mjs   const surface = action.surface === "doc" ? "doc" : "sheet";
//     page.tsx             return surface === "doc" ? "doc" : "sheet";
//
// so anything unrecognised silently became the sheet. Today that is unreachable, because
// the plan validator catches it first — which is exactly what makes it a trap rather than
// a bug. Adding a third surface means updating one list that ERRORS when you forget and
// two that DO NOT, and the failure mode of forgetting is the worst one this pipeline has:
// the explorer believes it is on slides, acts on a grid, and attributes everything it
// sees to the wrong package. Every prediction it makes would be about a surface it was
// never on.
//
// WHY NOT IN `hunt-ui-tool.mjs` WITH THE READER TABLE. `hunt-ui-probe.mjs` needs it and
// the tool already imports the probe, so putting it there is an import cycle. The
// vocabulary has to sit BELOW both, which is what this file is.
//
// NO IMPORTS, deliberately — `agent:tests` runs with `scripts/agent/node_modules` absent,
// and a vocabulary constant that can fail to load is not a vocabulary.

/**
 * Every surface the hunt harness can mount.
 *
 * `hunt-ui-tool.mjs` PINS its reader table to this list rather than deriving the list
 * from the table, which is the direction that catches both mistakes: a surface added
 * here with no readers could never predict anything, and readers added for a surface
 * missing here would be unreachable. One test asserts the two agree.
 */
export const UI_SURFACES = Object.freeze(["sheet", "doc", "slides"]);

/**
 * Confirm the harness mounted the surface that was asked for.
 *
 * THE GUARD THAT DOES NOT DEPEND ON A LIST. Single-sourcing the vocabulary fixes the
 * lists this repository owns; it cannot fix `page.tsx`, which resolves `?surface=` from a
 * URL and must keep defaulting, because a URL is typed by hand. So the runner asks the
 * BRIDGE what actually mounted and compares. That closes the loop for any coercion
 * anywhere downstream, present or future, without either side knowing the other's list.
 *
 * Reads as a refusal rather than a defect: a harness that mounted the wrong thing is not
 * the product misbehaving, and the message has to say so or the next reader of a report
 * will file it.
 */
export function assertMountedSurface(requested, mounted) {
  if (mounted === requested) return mounted;
  throw new Error(
    `[hunt-ui] asked the harness for the ${JSON.stringify(requested)} surface and it ` +
      `mounted ${JSON.stringify(mounted)}. This is a HARNESS fault, not a defect in the ` +
      "product — every reading taken here would describe a surface the plan never asked " +
      "for. Check that the surface is in UI_SURFACES and that the hunt page knows how to " +
      "mount it.",
  );
}
