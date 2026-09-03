# Lessons — PDF text layer + OCR design (#1015)

## P0 — overlaying pdf.js's own text layer

- Reusing an upstream component is not the same as reusing its
  environment. `TextLayer` ships in the installed `pdfjs-dist`, but
  `setLayerDimensions` emits
  `round(down, var(--total-scale-factor) * Npx, var(--scale-round-x))`
  against a variable only the *full* pdf.js viewer defines. Undefined, the
  whole declaration is invalid and CSS drops it silently — the failure mode
  is a layer that is subtly the wrong size with nothing logged. Taking over
  sizing ourselves was cheaper than adopting the viewer's variable surface.
- `rawDims` is the **unrotated** viewBox. Everything downstream (span
  percentages, container size) is clean because of that, but it means
  rotation has to be placed explicitly rather than inherited. A page with
  `/Rotate 90` silently 90° off is worse than no text layer at all, which is
  why that case got a unit test on the transform rather than a manual check.
- jsdom has no canvas 2D context, so `TextLayer` construction throws under
  test. Rather than mocking around it, the viewer treats a text-layer failure
  as non-fatal — which is also the correct production behavior for a
  malformed text stream. The test environment's limitation and the real
  requirement pointed the same way; worth checking for that before reaching
  for a mock.

## Review round (CodeRabbit)

- **An identity assertion proves nothing when the producer copies its
  input.** The store test asserted `read.rects !== input.rects` to show
  threads come back as plain JS rather than live Yorkie proxies — but
  `addThread` copies the anchor before storing it, so that holds either way.
  Only mutating what was read and reloading distinguishes a copy from a
  proxy. The test's own comment claimed more than the test checked, which is
  the tell.
- **A cap on the wrong axis reads as a bound.** "Extraction is bounded by the
  50 MB upload cap" was written in good faith and is simply false: cost
  scales with page count and declared image dimensions, neither a function of
  file size. When a design says X bounds Y, check that X and Y are on the
  same axis.
- **Provenance granularity should follow whatever actually varies.** The API
  carried one document-level `source` while the same document's P2 section
  had the viewer choosing per page. The document contradicted itself, and the
  reviewer found it by reading the two sections against each other — the kind
  of check that is cheap in review and invisible while writing.
- **Throttling is a quota, not an access control.** A per-user limit still
  lets an authenticated caller spend it on documents they cannot read. The
  same confusion is easy to make anywhere expense and authority get discussed
  in one paragraph.
- **A claim without a lease plus a unique constraint is a permanent lock.**
  `FOR UPDATE SKIP LOCKED` makes the claim safe; it does nothing about a
  worker that dies holding one. With one job per document enforced by a
  unique `documentId`, that leaves the document permanently un-OCR-able. The
  test has to cover both directions — an expired lease is reclaimable *and* a
  live heartbeat is not stealable — since a lease tested one way is a lease
  that can double-run.
- Five of the six findings were against a design doc for phases not built
  here. That is the cheapest possible place to take them: each was a
  paragraph, not a migration.

## Local verification

- `pnpm verify:fast` failed on four unrelated CLI link-sanitization tests
  before this branch's changes were even in play. Cause was stale
  `packages/{docs,slides,core}/dist`, not a regression; rebuilding the
  producer packages cleared it. Consumers run against built `dist`, so a
  cross-package failure that looks impossible for your diff usually is.
