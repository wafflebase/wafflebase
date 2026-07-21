// Pure check-run gate logic, shared by mark-ready.mjs and its tests.
// A required check "passes" iff its LATEST run on the SHA concluded success;
// a required check that never ran counts as NOT passed (fail closed).

/** Latest run of `name` concluded success? Missing → false. */
export function checkPassed(checkRuns, name) {
  const runs = (checkRuns || []).filter((r) => r.name === name);
  if (runs.length === 0) return false;
  runs.sort((a, b) => new Date(b.started_at ?? 0) - new Date(a.started_at ?? 0));
  return runs[0].conclusion === "success";
}

/** { allPassed, perCheck } for a list of required check names. */
export function allRequiredPassed(checkRuns, requiredNames) {
  const perCheck = Object.fromEntries(requiredNames.map((n) => [n, checkPassed(checkRuns, n)]));
  return { allPassed: requiredNames.every((n) => perCheck[n]), perCheck };
}
