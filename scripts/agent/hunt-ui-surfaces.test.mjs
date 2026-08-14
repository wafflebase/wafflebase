import { test } from "node:test";
import assert from "node:assert/strict";

import { assertMountedSurface, UI_SURFACES } from "./hunt-ui-surfaces.mjs";
import { UI_READERS_BY_SURFACE } from "./hunt-ui-tool.mjs";
import { assertSafeActionPlan } from "./hunt-ui-probe.mjs";

test("the reader table and the surface list name exactly the same surfaces", () => {
  // THE PIN THAT REPLACES THE DERIVATION. `UI_SURFACES` used to be `Object.keys` of this
  // table, which made a mismatch impossible and a SECOND copy of the list — in the plan
  // validator, and another in the runner — invisible. Now the list is authored and this
  // asserts the table agrees, which catches both directions: a surface declared with no
  // readers could never predict anything, and readers for a surface nobody can `goto` are
  // unreachable.
  assert.deepEqual([...UI_SURFACES].sort(), Object.keys(UI_READERS_BY_SURFACE).sort());
});

test("every declared surface actually exposes readers", () => {
  for (const surface of UI_SURFACES) {
    assert.ok(
      Array.isArray(UI_READERS_BY_SURFACE[surface]) && UI_READERS_BY_SURFACE[surface].length > 0,
      `surface ${surface} exposes no readers, so nothing on it could be predicted`,
    );
  }
});

test("the plan validator accepts every surface in the list and refuses anything else", () => {
  for (const surface of UI_SURFACES) {
    assert.doesNotThrow(() => assertSafeActionPlan({ actions: [{ type: "goto", surface }] }));
  }
  // `"slides"` specifically: the surface being prepared for. Until it is in the list it
  // must be refused rather than quietly turned into a sheet, which is what the runner
  // used to do with it.
  for (const bogus of ["slides", "Sheet", "", null, undefined, 7]) {
    assert.throws(
      () => assertSafeActionPlan({ actions: [{ type: "goto", surface: bogus }] }),
      /surface must be one of/,
      `goto surface ${JSON.stringify(bogus)} should be refused`,
    );
  }
});

test("assertMountedSurface passes only when the page mounted what was asked for", () => {
  assert.equal(assertMountedSurface("doc", "doc"), "doc");
  assert.equal(assertMountedSurface("sheet", "sheet"), "sheet");
});

test("assertMountedSurface refuses a substituted surface and blames the harness", () => {
  // The exact failure it exists to catch: the page's `?surface=` resolver defaults an
  // unrecognised value to the sheet, so asking for a surface it cannot mount comes back
  // ready, correct-looking, and wrong.
  assert.throws(() => assertMountedSurface("slides", "sheet"), (error) => {
    assert.match(error.message, /asked the harness for the "slides" surface/);
    assert.match(error.message, /mounted "sheet"/);
    // A report reader who sees this must not file it as a product defect.
    assert.match(error.message, /HARNESS fault, not a defect in the product/);
    return true;
  });
});

test("assertMountedSurface refuses a page that reports no surface at all", () => {
  // `null` is what the evaluate returns when the bridge is missing or has no `surface()`
  // — a shape that must fail rather than compare equal to anything.
  for (const mounted of [null, undefined, ""]) {
    assert.throws(() => assertMountedSurface("doc", mounted), /asked the harness for the "doc" surface/);
  }
});
