# Slides PPTX Export — Lessons

## Process

- **Subagent-driven execution worked well at scale** (16 tasks + Phase 1):
  fresh implementer per task, two-verdict review (spec + quality), fix
  loop. Per-task reviews caught a steady stream of round-trip field-drop
  gaps (alt, tableStyleId, lnSpc/marL/indent/highlight/bullet styling)
  far cheaper than the final round-trip would have.
- **The round-trip suite is the real gate, not unit tests.** Unit tests
  assert the exporter's *output string*; they cannot catch a wrong
  *inverse*. The model-equivalence round-trip (import→export→reimport)
  caught bugs unit tests passed clean on — most notably `nodeType="mainSeq"`
  on `<p:seq>` instead of its `<p:cTn>` child, which **silently dropped
  every animation on re-import**. Lesson: for any importer/exporter pair,
  a round-trip fixture per feature is mandatory; output-shape unit tests
  are necessary but not sufficient.
- **"normalize() exclusion" is a smell to audit.** When a round-trip is
  made to pass by excluding a field, classify it: true importer-loss /
  render-derived (legitimate) vs. importer-reads-but-exporter-drops
  (a masked exporter gap — must fix). Four masked gaps were closed this
  way; only genuine deferrals (inline href rel-wiring, connector attached
  endpoints) remain excluded with documented reasons.

## Git incident (root cause + guard)

- **What happened:** a fix subagent, confused about branch state, ran
  `git checkout main` and cherry-picked the task commits onto a stale
  local `main`, leaving the branch pointer there — orphaning Phase 1 +
  the design + plan commits from the working branch.
- **Recovery:** nothing was lost (orphaned commits live in the reflog).
  `git reset --hard <last-good-commit>` + `git cherry-pick <unique-fix>`
  restored the correct chain. Verified by checking the recovered tree had
  Phase 1 files + all task commits.
- **Guard added:** every subsequent dispatch carried an explicit GIT
  SAFETY block — never checkout/switch/reset/cherry-pick/rebase; only
  `git add`+`git commit`; and run `git branch --show-current` to confirm
  the branch before committing, else STOP and report BLOCKED. No further
  incidents.
- **Lesson:** give subagents commit authority but NOT branch-manipulation
  authority. A subagent that hits a git surprise must escalate, not
  improvise — recovery is the controller's job (it holds the reflog
  context).
- **`git merge-base main HEAD` is unreliable after such an incident** —
  local `main` was contaminated, so merge-base pointed into our own
  history. Use the known true base (parent of the first branch commit).

## Exporter specifics worth remembering

- `Frame.rotation` and `Effects.shadow.angle` are stored in **radians**
  (importer uses `rotEmuToRad`); OOXML wants 60000ths-of-a-degree. The
  first xfrmXml draft treated rotation as degrees — caught by review, not
  by the (wrongly-degrees) unit test. Round-trip with `Math.PI/2` is the
  honest test.
- clrScheme is **absolute srgb**, not role-relative — emitting
  `<a:schemeClr>` from a role would be circular.
- All element serializers emit `<p:cNvPr id="0">`; the slide assembler
  renumbers to unique per-slide ids (root=1, elements 2+) in one regex
  pass that also builds the `name→spid` map for animation targeting.
- CLI resolves the **built** `@wafflebase/slides` dist — the slides
  package must be rebuilt before CLI picks up new `node.ts` exports.

## Deferred (documented v1 limitations)

- Inline `href` export (needs slide relationship wiring).
- Connector *attached* endpoints (`<a:stCxn>`/`<a:endCxn>`) — need
  shape-id coupling; export resolves to bounding-frame geometry only.
- Group-*targeted* animation spid coupling (a pre-existing importer gap).
- PDF export (separate; needs Canvas raster).
